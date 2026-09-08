/* The four placement workers run from the createToken hook, plus name
 * assembly. Ordering matters: skills read Int after abilities rewrite it (§4.1).
 */

import { ABILITY_KEYS, LOG, MODULE_ID } from "../core/const.mjs";
import { weightedPick } from "../core/util.mjs";
import { assignScoresWithConstraints, generateScores, getAllStatMethods, shuffleArray } from "../core/stats.mjs";
import { loadAdjectiveLists, loadNameDatabase } from "../names/data.mjs";
import { computeDistributionProportions, distributionToCoins, resolveGoldValue } from "./treasure.mjs";
import { buildSkillSlots, computeSkillBudget, distributeSkillRanks, expandExcludedSkills, getSkillRegistry, isArbitrarySkill, skillRankCap, slotMembers } from "../skills/logic.mjs";
import { getActorNameRandomizerSettings, getActorRandomizerSettings, getActorSkillRandomizerSettings, getActorTreasureRandomizerSettings } from "../core/settings.mjs";

// ─── Token Creation Logic ──────────────────────────────────────────────────────

async function randomizeTokenAbilityScores(tokenDoc) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (tokenDoc.actorLink) return;

  const settings = getActorRandomizerSettings(actor);
  if (!settings.enabled) return;

  // Abilities flagged as "nil" are set to null — mechanically equivalent to typing
  // "-" in the score field (mod becomes +0 and the score is treated as absent),
  // rather than 0 (which would yield a -5 modifier). These are excluded from the
  // generated score pool so the remaining abilities still receive full values.
  const nilAbilities = ABILITY_KEYS.filter((a) => settings.constraints[a]?.nil);
  const activeAbilities = ABILITY_KEYS.filter((a) => !settings.constraints[a]?.nil);

  let scores = await generateScores(settings.method, actor);
  // Fixed arrays are an unordered pool, so shuffle before constraint assignment;
  // formula/roll methods are already independent per ability and are left as-is.
  if (getAllStatMethods()[settings.method]?.values) shuffleArray(scores);

  const assigned = assignScoresWithConstraints(
    scores,
    settings.constraints,
    settings.prioritizeEnabled,
    settings.priorities,
    activeAbilities
  );

  const updateData = {};
  for (const ability of activeAbilities) {
    updateData[`system.abilities.${ability}.value`] = assigned[ability];
  }
  for (const ability of nilAbilities) {
    updateData[`system.abilities.${ability}.value`] = null;
  }
  await tokenDoc.actor.update(updateData);
  console.log(`${LOG} Randomized ability scores for ${actor.name}:`, assigned, nilAbilities.length ? { nil: nilAbilities } : "");
}


/**
 * Resolve a `database` segment to a string: pick one filter (weighted), then draw a
 * uniform name from the pool matching that filter's race/region/gender (blank = Any)
 * and the requested type. `both` draws a given AND a surname from the same filter roll.
 */
function resolveDatabaseSegment(seg, db) {
  const filters = (seg.filters ?? []).filter(Boolean);
  if (!filters.length) return "";
  const filter = weightedPick(filters, f => f.weight);
  if (!filter) return "";
  const names = db.names ?? [];
  const pool = (type) => names.filter(n =>
    n.type === type &&
    (!filter.race || n.race === filter.race) &&
    (!filter.region || n.region === filter.region) &&
    (!filter.gender || n.gender === filter.gender));
  const pickUniform = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)].name : "";
  if (seg.nameType === "both") {
    return [pickUniform(pool("given")), pickUniform(pool("surname"))].filter(Boolean).join(" ");
  }
  return pickUniform(pool(seg.nameType === "surname" ? "surname" : "given"));
}

/** Resolve an `adjective` segment: pick one enabled list (weighted), then a uniform word. */
function resolveAdjectiveSegment(seg, adjDb) {
  const available = (seg.lists ?? []).filter(l => l && adjDb.lists[l.list]?.length);
  if (!available.length) return "";
  const chosen = weightedPick(available, l => l.weight);
  const words = adjDb.lists[chosen.list];
  return words[Math.floor(Math.random() * words.length)];
}

/** Resolve one segment to its drawn string (a single random draw per segment). */
function resolveSegment(seg, db, adjDb, actorName) {
  if (seg.type === "database") return resolveDatabaseSegment(seg, db);
  if (seg.type === "adjective") return resolveAdjectiveSegment(seg, adjDb);
  if (seg.type === "static") return String(seg.text ?? "").trim();
  if (seg.type === "actor") return String(actorName ?? "").trim();
  return "";
}

/**
 * Assemble the real (observer-visible) and obscured (non-observer) names from the
 * ordered segment list in a SINGLE pass. Each segment is resolved once, then its one
 * drawn value is routed into the two names by its `obscure` tag, so a "both" segment
 * shows the same rolled value in each — not two independent rolls:
 *   • "both"     — value in both names.
 *   • "dm"       — value in the real name; `obscuredText` (or nothing) in the obscured name.
 *   • "obscured" — value in the obscured name only.
 * A segment with no tag (pre-obscure configs) is treated as "both".
 * `actorName` is the live base-actor name used by `actor` segments. Either name is
 * "" when nothing resolved into it.
 */
function buildNames(settings, db, adjDb, actorName = "") {
  const realParts = [];
  const obscuredParts = [];
  for (const seg of settings.segments ?? []) {
    const value = resolveSegment(seg, db, adjDb, actorName);
    const mode = seg.obscure ?? "both";
    if (mode === "dm") {
      if (value) realParts.push(value);
      const alt = String(seg.obscuredText ?? "").trim();
      if (alt) obscuredParts.push(alt);
    } else if (mode === "obscured") {
      if (value) obscuredParts.push(value);
    } else { // "both"
      if (value) { realParts.push(value); obscuredParts.push(value); }
    }
  }
  const join = (parts) => parts.join(" ").replace(/\s+/g, " ").trim();
  return { real: join(realParts), obscured: join(obscuredParts) };
}

// How many times to re-roll a colliding name before giving up and accepting a duplicate.
const MAX_NAME_TRIES = 5;

/**
 * Collect the names already in use on the scene by other tokens of the same base
 * actor (linked or not), so a freshly placed token can avoid duplicating them.
 */
function usedSiblingNames(tokenDoc) {
  const scene = tokenDoc.parent;
  const names = new Set();
  if (!scene?.tokens) return names;
  for (const other of scene.tokens.contents) {
    if (other.id === tokenDoc.id) continue;
    if (other.actorId !== tokenDoc.actorId) continue;
    if (other.name) names.add(other.name);
  }
  return names;
}

async function randomizeTokenName(tokenDoc) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (tokenDoc.actorLink) return;

  const settings = getActorNameRandomizerSettings(actor);
  if (!settings.enabled) return;

  const db = await loadNameDatabase();
  const adjDb = await loadAdjectiveLists();

  // Uniqueness only makes sense when the name can actually vary. A name built purely
  // from static text is intentionally fixed, so we don't chase uniqueness or warn.
  const canVary = (settings.segments ?? []).some(s => s.type === "database" || s.type === "adjective");
  const used = canVary ? usedSiblingNames(tokenDoc) : new Set();
  const actorName = tokenDoc.baseActor?.name ?? actor.name;

  let names = { real: "", obscured: "" };
  let unique = true;
  for (let attempt = 0; attempt < MAX_NAME_TRIES; attempt++) {
    names = buildNames(settings, db, adjDb, actorName);
    if (!names.real) break; // all segments resolved empty — nothing to place
    unique = !used.has(names.real); // uniqueness is chased on the REAL name only
    if (unique) break;
  }

  const name = names.real;
  if (!name) {
    console.warn(`${LOG} Name randomizer produced an empty name; leaving token name unchanged.`);
    return;
  }

  // The real name is what the token is actually called (observers/GM see it). When the
  // segment tags produced a distinct obscured name, stash it on the token so display-
  // time substitution has something to show non-observers, and default the per-token
  // obscure toggle on. Whether that substitution actually happens is gated separately
  // by the global setting (added in a later phase); storage here is unconditional so
  // enabling the feature later works for tokens placed after this point.
  const update = { name };
  if (names.obscured && names.obscured !== name) {
    update[`flags.${MODULE_ID}.obscuredName`] = names.obscured;
    update[`flags.${MODULE_ID}.obscure`] = true;
  }
  await tokenDoc.update(update);

  if (!unique) {
    const label = tokenDoc.baseActor?.name ?? actor.name;
    ui.notifications?.warn(
      game.i18n.format("TR.Notif.DuplicateName", { label, tries: MAX_NAME_TRIES, name })
    );
    console.warn(`${LOG} Settled on duplicate name "${name}" for ${label} after ${MAX_NAME_TRIES} tries.`);
  } else {
    console.log(`${LOG} Randomized token name to: ${name}`);
  }
}

async function randomizeTokenTreasure(tokenDoc) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (tokenDoc.actorLink) return;

  const settings = getActorTreasureRandomizerSettings(actor);
  if (!settings.enabled) return;

  const goldValue = await resolveGoldValue(settings.goldFormula, actor);
  const props = computeDistributionProportions(settings);
  const coins = distributionToCoins(goldValue, props);

  // Replace existing currency outright.
  await actor.update({
    "system.currency.pp": coins.pp,
    "system.currency.gp": coins.gp,
    "system.currency.sp": coins.sp,
    "system.currency.cp": coins.cp
  });
  console.log(`${LOG} Randomized treasure for ${actor.name}: ${goldValue.toFixed(2)} gp value →`, coins);
}

/**
 * Deal out skill ranks (DESIGN.md §4). Must run AFTER the ability randomizer: the rank
 * budget reads Intelligence, which that worker may have just rewritten (or nulled), and
 * the actor has re-prepared by the time its `update()` resolves.
 */
async function randomizeTokenSkills(tokenDoc) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (tokenDoc.actorLink) return;

  const settings = getActorSkillRandomizerSettings(actor);
  if (!settings.enabled) return;

  const skills = actor.system.skills;
  if (!skills) return;

  const budget = computeSkillBudget(actor);
  const cap = skillRankCap(actor);
  const slots = buildSkillSlots(actor, settings);

  // Bail before touching anything when there is nowhere to put ranks. Clearing is a
  // preparation step for a distribution, not a feature of its own: without this guard,
  // merely ticking "enable" on an unconfigured tab would zero out the statblock's skills.
  if (!slots.length) {
    console.warn(`${LOG} Skill randomizer is enabled for ${actor.name} but no skill can receive ranks (empty list, and class skills are off or unavailable). Leaving skills untouched.`);
    return;
  }

  // Opt-in: an absent key means "don't wipe", matching the shipped default.
  const wipe = settings.wipeExisting === true;
  const updateData = {};

  // Wipe first: without it a statblock's own ranks compound on top of the roll and blow
  // past the legal budget. Excluded skills are skipped entirely, so they keep whatever
  // the statblock came with — that is the one job exclusion has that a zero weight does
  // not. Per-actor custom skills are left alone (they are outside this feature's scope).
  if (wipe) {
    const excluded = expandExcludedSkills(settings.excluded, actor);
    for (const [key, skill] of Object.entries(skills)) {
      if (excluded.has(key) || !getSkillRegistry()[key]) continue;
      if (isArbitrarySkill(key)) {
        // Clear every speciality of a parent that is in play at all — whether it got
        // there as a list entry or through the class/non-class sweep — so the result is
        // this roll and nothing else.
        for (const subId of Object.keys(skill?.subSkills ?? {})) {
          updateData[`system.skills.${key}.subSkills.${subId}.rank`] = 0;
        }
      } else {
        updateData[`system.skills.${key}.rank`] = 0;
      }
    }
  }

  const { ranks, spent } = distributeSkillRanks(slots, budget, cap, {
    weights: {
      list: settings.listWeight,
      class: settings.classWeight,
      nonClass: settings.nonClassWeight
    },
    focus: settings.focus
  }, !wipe);
  const assigned = {};
  for (const m of slotMembers(slots)) {
    const rank = ranks[m.id] ?? 0;
    if (m.create) {
      // Only materialize a named subskill that actually drew ranks, so a zero roll
      // doesn't litter the actor with empty Craft/Perform rows.
      if (rank > 0) updateData[m.path] = { ...m.create, rank };
    } else {
      updateData[`${m.path}.rank`] = rank;
    }
    if (rank > 0) assigned[m.label] = rank;
  }

  if (!Object.keys(updateData).length) return;
  await actor.update(updateData);

  const total = budget.total;
  if (total === 0) {
    console.warn(`${LOG} Skill randomizer budget is 0 for ${actor.name} (no class items?); ranks cleared only.`);
  } else if (spent < total) {
    console.warn(`${LOG} Skill randomizer left ${total - spent} of ${total} ranks unspent for ${actor.name} — everything with room is capped or excluded (cap ${cap}/skill).`);
  }
  console.log(`${LOG} Randomized skills for ${actor.name}: ${spent}/${total} ranks (${budget.adventure} adventure + ${budget.background} background), cap ${cap} →`, assigned);
}


export {
  buildNames,
  randomizeTokenAbilityScores,
  randomizeTokenName,
  randomizeTokenSkills,
  randomizeTokenTreasure,
};
