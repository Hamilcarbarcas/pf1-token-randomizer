/* Skill rank distribution — the model in DESIGN.md §2 and §4.
 */

import { LOG, MODULE_ID } from "../core/const.mjs";
import { weightedPick } from "../core/util.mjs";

// ─── Skill Logic ───────────────────────────────────────────────────────────────
// Distributes skill ranks over a weighted pool, within the actor's legal rank budget
// and the per-skill cap. See DESIGN.md §2 (system internals) and §4 (the model).

const DEFAULT_SKILL_WEIGHT = 5;

// Out of the box: mostly class skills with the occasional non-class one, spread evenly.
// Both group weights are meaningful at 0 — see DESIGN.md §4.2 for the tier rule.
const SKILL_DEFAULTS = {
  enabled: false,
  entries: [],
  // Category weights (DESIGN.md §4.4). The hand-picked list and class skills are equally
  // likely; everything else is an occasional outlier.
  listWeight: 5,
  classWeight: 5,
  nonClassWeight: 1,
  focus: { list: 0, class: 0, nonClass: 0 },
  excluded: [],
  // Off by default: a statblock's existing ranks are hand-authored data, so the
  // randomizer adds to them rather than destroying them unless explicitly told to.
  wipeExisting: false,
  profile: null
};

// Skills that cannot hold ranks on their parent row: the system always gives them a
// subSkills object, the sheet omits their rank input, and the rank accounting reads
// only their subskills. They never enter the pool implicitly — only as an explicit
// entry naming its subskills (DESIGN.md §4.8).
const FALLBACK_ARBITRARY_SKILLS = ["art", "crf", "lor", "prf", "pro"];

// ─── Skill aliases ───────────────────────────────────────────────────────────────
// A pseudo-key standing for a set of real skills, so "Knowledge (any)" is one row in
// the list (and one chip in the exclusions) instead of ten. The `*` prefix cannot
// collide with a real key: the system's are three lowercase letters.
//
// PF1 exposes no grouping for the Knowledge skills — they are only recognisable by
// sharing a compendium journal page — so the members are listed explicitly here.
const KNOWLEDGE_SKILLS = ["kar", "kdu", "ken", "kge", "khi", "klo", "kna", "kno", "kpl", "kre"];

const SKILL_ALIASES = {
  "*knowledge": { label: "TR.Skill.KnowledgeAny", keys: KNOWLEDGE_SKILLS },
  // Same family, narrowed to whatever this actor treats as a class skill. Resolves to
  // nothing in the defaults dialog, where there is no actor to ask.
  "*knowledgeClass": { label: "TR.Skill.KnowledgeClass", keys: KNOWLEDGE_SKILLS, classOnly: true }
};

function isSkillAlias(key) {
  return Object.hasOwn(SKILL_ALIASES, key);
}

/**
 * The real skill keys an alias covers: those the system defines, and — for a `classOnly`
 * alias — those this actor marks as class skills.
 */
function aliasSkillKeys(key, actor = null) {
  const alias = SKILL_ALIASES[key];
  if (!alias) return [];
  const registry = getSkillRegistry();
  const skills = actor?.system?.skills ?? {};
  return alias.keys.filter(k => registry[k] && (!alias.classOnly || skills[k]?.cs));
}

/**
 * Expand any aliases in an exclusion list to the real keys they cover, so every
 * exclusion check is a plain key lookup. Exclusion is absolute, so an excluded alias
 * vetoes each of its members individually too.
 */
function expandExcludedSkills(excluded, actor = null) {
  const out = new Set();
  for (const key of excluded ?? []) {
    if (isSkillAlias(key)) for (const k of aliasSkillKeys(key, actor)) out.add(k);
    else out.add(key);
  }
  return out;
}

/** The system's skill registry (key → i18n label), read live so added skills are seen. */
function getSkillRegistry() {
  return pf1?.config?.skills ?? {};
}

function isArbitrarySkill(key) {
  return (pf1?.config?.arbitrarySkills ?? FALLBACK_ARBITRARY_SKILLS).includes(key);
}

/** Localized label for a skill key or alias, falling back to the raw key. */
function skillLabel(key) {
  const label = SKILL_ALIASES[key]?.label ?? getSkillRegistry()[key];
  return label ? game.i18n.localize(label) : key;
}

/** List-entry weights floor at 1: a hand-added skill is never a fallback (DESIGN.md §4.2). */
function clampSkillWeight(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_SKILL_WEIGHT;
  return Math.max(1, Math.min(10, n));
}

/**
 * Group weights and focus sliders run 0–10, where 0 carries its own meaning (fallback
 * tier / no stickiness). A missing value reads as 0, not as the list default.
 */
function clampGroupWeight(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

function useBackgroundSkills() {
  try {
    return !!game.settings.get("pf1", "allowBackgroundSkills");
  } catch {
    return false; // system setting missing (very old PF1) — treat the rule as off
  }
}

function isBackgroundSkill(key) {
  return (pf1?.config?.backgroundSkills ?? []).includes(key);
}

/**
 * The actor's legal skill-rank budget, re-deriving the system's own accounting
 * (actor-sheet.mjs `_prepareSkills`). Racial HD are class items too, so bestiary NPCs
 * get a budget; only an actor with no class items at all comes back at 0.
 * Mindless actors (nil Int) get favored-class picks and nothing else, matching core.
 *
 * Returns the two pools separately. Background points are only ever spendable on
 * background skills; adventure points go anywhere. See DESIGN.md §2.6.1.
 */
function computeSkillBudget(actor) {
  const abilities = actor?.system?.abilities;
  const isMindless = abilities?.int?.value === null;
  const intMod = isMindless ? 0 : (abilities?.int?.mod ?? 0);
  const withBackground = useBackgroundSkills();

  let adventure = 0;
  let background = 0;
  for (const cls of actor?.itemTypes?.class ?? []) {
    if (cls.subType === "mythic") continue;
    if (pf1.config.favoredClassTypes.includes(cls.subType)) adventure += cls.system.fc?.skill?.value || 0;
    if (isMindless) continue;
    const hd = cls.hitDice;
    if (!hd) continue;
    // Int from HD applies even when the class grants zero skills per level.
    adventure += Math.max(1, (cls.system.skillsPerLevel || 0) + intMod) * hd;
    if (withBackground && pf1.config.backgroundSkillClasses.includes(cls.subType)) {
      background += hd * pf1.config.backgroundSkillsPerLevel;
    }
  }
  // Where a Change-driven bonus (a `bonusSkillRanks` target) lands. PF1 has no
  // background-specific Change target, so everything arriving this way counts as an
  // adventure rank — even when a house rule means it as a background one. See the hook
  // below for how such a rule corrects it.
  adventure += actor?.system?.details?.skills?.bonus || 0;

  const budget = {
    adventure: Math.max(0, Math.floor(adventure)),
    background: Math.max(0, Math.floor(background)),
    get total() { return this.adventure + this.background; }
  };

  /**
   * Let other modules reconcile a house rule the actor data cannot express. Listeners
   * mutate `budget.adventure` / `budget.background` in place.
   *
   * The motivating case: a module grants a free *background* rank, but the only lever
   * PF1 offers is `bonusSkillRanks`, which physically lands in the adventure pool. Such
   * a module patches its own sheet display to re-pool it — and without this hook we
   * would read the raw data and spend that rank on an adventure skill.
   */
  Hooks.callAll("pf1TokenRandomizerSkillBudget", actor, budget);
  budget.adventure = Math.max(0, Math.floor(budget.adventure || 0));
  budget.background = Math.max(0, Math.floor(budget.background || 0));
  return budget;
}

/** Max ranks in any one skill: the actor's character level (total class + racial HD). */
function skillRankCap(actor) {
  return Math.max(1, actor?.system?.attributes?.hd?.total || 1);
}

// ─── Subskill Groups ─────────────────────────────────────────────────────────────
// A group is a named list of subskill names under one parent skill (e.g. "Smithing"
// under Craft). A subskill row referencing a group draws ONE member per token, uniformly
// — the row's weight is what competes with sibling rows, exactly as an adjective list's
// weight competes while the word inside it is drawn evenly. See DESIGN.md §4.9.

function getSubSkillGroups() {
  const raw = game.settings.get(MODULE_ID, "subskill-groups");
  return Array.isArray(raw) ? raw : [];
}

/** The groups defined for one parent skill, in stored order. */
function getSubSkillGroupsFor(skillKey) {
  return getSubSkillGroups().filter(g => g?.skill === skillKey);
}

function getSubSkillGroup(id) {
  return getSubSkillGroups().find(g => g?.id === id) ?? null;
}

// Seed speciality lists, offered as autocomplete out of the box (DESIGN.md §4.10).
// Lore is deliberately empty: its specialities are campaign-specific.
const DEFAULT_KNOWN_SUBSKILLS = {
  art: "choreography; criticism; literature; musical composition; philosophy; playwriting",
  crf: "alchemy; armorsmithing; basketweaving; bookbinding; bowmaking; blacksmithing; calligraphy; "
     + "carpentry; cobbling; gemcutting; jewelry; leatherworking; locksmithing; painting; pottery; "
     + "sculpting; shipmaking; stonemasonry; taxidermy; trapmaking; weaponsmithing; weaving",
  prf: "acting; comedy; dancing; keyboard instruments; oratory; percussion instruments; "
     + "string instruments; weapon drill; wind instruments; singing",
  pro: "apothecary; boater; bookkeeper; brewer; cook; driver; farmer; fisher; guide; herbalist; "
     + "herder; hunter; innkeeper; lumberjack; miller; miner; porter; rancher; sailor; scribe; "
     + "siege engineer; stablehand; tanner; teamster; woodcutter",
  lor: ""
};

// Bumped when DEFAULT_KNOWN_SUBSKILLS gains entries a live world should pick up. The
// seed runs once per version and only fills skills the GM has left empty, so it can
// never overwrite an edited list. A `default` alone would not be enough: changing a
// setting's default moves nothing in a world where the Setting document already exists.
const KNOWN_SUBSKILL_SEED_VERSION = 1;

async function seedKnownSubSkills() {
  if (!game.user?.isGM) return;
  if (game.settings.get(MODULE_ID, "known-subskills-seed") >= KNOWN_SUBSKILL_SEED_VERSION) return;

  const current = getKnownSubSkills();
  const merged = { ...current };
  let added = 0;
  for (const [key, value] of Object.entries(DEFAULT_KNOWN_SUBSKILLS)) {
    const names = parseSubSkillList(value);
    if (!names.length) continue;
    if (parseSubSkillList(current[key]).length) continue; // GM has their own list — leave it
    merged[key] = names;
    added++;
  }
  if (added) await game.settings.set(MODULE_ID, "known-subskills", merged);
  await game.settings.set(MODULE_ID, "known-subskills-seed", KNOWN_SUBSKILL_SEED_VERSION);
  if (added) console.log(`${LOG} Seeded default speciality lists for ${added} skill(s).`);
}

/**
 * Known speciality names per arbitrary skill, used purely to autocomplete the subskill
 * name field (an HTML <datalist>). Stored as one semicolon-separated string per skill;
 * typing something not on the list is always allowed. See DESIGN.md §4.10.
 */
function getKnownSubSkills() {
  const raw = game.settings.get(MODULE_ID, "known-subskills");
  return (raw && typeof raw === "object") ? raw : {};
}

/**
 * Normalize a speciality list to trimmed, de-duped names. Accepts the stored array form
 * and the semicolon-separated string the seed constant is written in (and that older
 * saves used), so both round-trip through the same path.
 */
function parseSubSkillList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(";");
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const name = String(entry ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function getKnownSubSkillsFor(skillKey) {
  return parseSubSkillList(getKnownSubSkills()[skillKey]);
}

/** A group's usable member names (trimmed, de-duped, blanks dropped). */
function groupMembers(group) {
  const seen = new Set();
  const out = [];
  for (const raw of group?.members ?? []) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Resolve one arbitrary entry's named subskills against an actor into pool candidates.
 * Subskill ids are positional per actor (`crf1`, `crf2`, …), so an existing subskill is
 * matched by NAME; when there is no match, the first free id is claimed and `create`
 * carries the payload to write, copying the parent's ability/rt/cs/acp as the system's
 * own "add subskill" control does.
 */
function resolveSubSkillCandidates(actor, entry) {
  const key = entry.key;
  const parent = actor.system.skills?.[key];
  if (!parent) return [];

  const existing = parent.subSkills ?? {};
  const idByName = new Map();
  for (const [id, sub] of Object.entries(existing)) {
    const name = String(sub?.name ?? "").trim().toLowerCase();
    if (name && !idByName.has(name)) idByName.set(name, id);
  }

  const claimed = new Set(Object.keys(existing));
  // Subskill ids this entry has already taken, so a group prefers an unclaimed member
  // rather than colliding with a sibling row (whose weight would then be lost to the
  // pool's de-dup).
  const takenByEntry = new Set();

  /** The id an existing subskill of this name would resolve to, or null. */
  const idFor = (name) => idByName.get(name.trim().toLowerCase()) ?? null;

  const out = [];
  for (const sub of entry.subSkills ?? []) {
    let name;
    if (sub?.group) {
      const members = groupMembers(getSubSkillGroup(sub.group));
      if (!members.length) continue; // deleted group, or one with no usable members
      const free = members.filter(m => {
        const existingId = idFor(m);
        return !existingId || !takenByEntry.has(existingId);
      });
      const from = free.length ? free : members;
      name = from[Math.floor(Math.random() * from.length)];
    } else {
      name = String(sub?.name ?? "").trim();
    }
    if (!name) continue;

    let id = idByName.get(name.toLowerCase());
    let create = null;
    if (!id) {
      let n = 1;
      while (claimed.has(`${key}${n}`)) n++;
      id = `${key}${n}`;
      idByName.set(name.toLowerCase(), id);
      create = {
        name,
        ability: parent.ability,
        rank: 0,
        rt: parent.rt ?? false,
        cs: parent.cs ?? false,
        acp: parent.acp ?? false
      };
    }
    claimed.add(id);
    takenByEntry.add(id);
    out.push({
      id: `${key}.${id}`,
      path: `system.skills.${key}.subSkills.${id}`,
      label: `${skillLabel(key)} (${name})`,
      weight: clampSkillWeight(sub.weight),
      // Subskills only ever arrive through an explicit entry, so they focus with the list.
      source: "list",
      background: isBackgroundSkill(key),
      current: existing[id]?.rank || 0,
      create
    });
  }
  return out;
}

/**
 * Build the draw's **slots** (DESIGN.md §4.2). A slot is one row of the draw — a skill
 * list entry, or one class/non-class skill — holding the concrete skills it can resolve
 * to. Because the draw picks a slot first and a member second, a row covering many
 * skills (Knowledge (any), a Craft entry with three specialities) competes as ONE unit
 * against Perception, rather than flooding the draw with ten chances.
 *
 * `slot.locks` marks a row that narrows to its first-drawn member for the rest of the
 * run — a Craft entry becomes Craft (armorsmithing). The Knowledge aliases never lock,
 * so they can land on a different Knowledge each time.
 *
 * Exclusions are the only thing that removes a skill outright. A skill claimed by an
 * earlier slot is dropped from later ones, so an explicitly listed Knowledge (arcana)
 * beats the alias, and both beat the class/non-class sweep.
 */
function buildSkillSlots(actor, settings) {
  const skills = actor.system.skills ?? {};
  const excluded = expandExcludedSkills(settings.excluded, actor);
  const slots = [];
  const claimed = new Set();   // member ids already spoken for
  const listedKeys = new Set(); // parent keys handled by an explicit entry

  const plainMember = (key, source) => ({
    id: key,
    path: `system.skills.${key}`,
    label: skillLabel(key),
    weight: 1,
    source,
    background: isBackgroundSkill(key),
    current: skills[key]?.rank || 0,
    create: null
  });

  const addSlot = (slot) => {
    slot.members = slot.members.filter(m => !claimed.has(m.id));
    if (!slot.members.length) return;
    for (const m of slot.members) { claimed.add(m.id); m.source = slot.source; }
    slots.push(slot);
  };

  const entries = settings.entries ?? [];
  // Concrete entries first, then aliases: an explicitly listed Knowledge (arcana) keeps
  // its own weight regardless of where Knowledge (any) sits in the list.
  for (const entry of entries) {
    const key = entry?.key;
    if (!key || isSkillAlias(key) || excluded.has(key) || !skills[key]) continue;
    listedKeys.add(key);
    const weight = clampSkillWeight(entry.weight);
    if (isArbitrarySkill(key)) {
      // Specialities carry their own weights, and the row narrows to one once drawn.
      addSlot({
        id: `list:${key}`, source: "list", weight,
        memberMode: "weighted", locks: true,
        members: resolveSubSkillCandidates(actor, entry)
      });
    } else {
      addSlot({
        id: `list:${key}`, source: "list", weight,
        memberMode: "uniform", locks: false,
        members: [plainMember(key, "list")]
      });
    }
  }
  for (const entry of entries) {
    const key = entry?.key;
    if (!isSkillAlias(key)) continue;
    const members = aliasSkillKeys(key, actor)
      .filter(k => !excluded.has(k) && skills[k])
      .map(k => plainMember(k, "list"));
    // Deliberately does NOT lock: each draw may land on a different Knowledge.
    addSlot({
      id: `list:${key}`, source: "list", weight: clampSkillWeight(entry.weight),
      memberMode: "uniform", locks: false, members
    });
  }

  for (const [key, skill] of Object.entries(skills)) {
    if (excluded.has(key) || listedKeys.has(key)) continue;
    if (!getSkillRegistry()[key]) continue; // skip per-actor custom skills
    const source = skill?.cs ? "class" : "nonClass";
    if (isArbitrarySkill(key)) {
      // Parent rows hold no ranks, so these are only playable through specialities the
      // actor already has. We never invent one here — that is what a list entry is for.
      const members = Object.entries(skill?.subSkills ?? {}).map(([subId, sub]) => ({
        id: `${key}.${subId}`,
        path: `system.skills.${key}.subSkills.${subId}`,
        label: `${skillLabel(key)} (${sub?.name ?? subId})`,
        weight: 1,
        source,
        background: isBackgroundSkill(key),
        current: sub?.rank || 0,
        create: null
      }));
      addSlot({ id: `${source}:${key}`, source, weight: 1, memberMode: "uniform", locks: true, members });
    } else {
      addSlot({
        id: `${source}:${key}`, source, weight: 1,
        memberMode: "uniform", locks: false,
        members: [plainMember(key, source)]
      });
    }
  }

  return slots;
}

/** Every concrete skill across all slots, for writing and reporting. */
function slotMembers(slots) {
  return slots.flatMap(s => s.members);
}

const SKILL_SOURCES = ["list", "class", "nonClass"];

/** Pick uniformly from a non-empty array. */
function uniformPick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Spend the two rank pools across the candidates, one point at a time.
 *
 * Two phases give the background-skill asymmetry for free (DESIGN.md §2.6.1): background
 * points can only land on background skills, adventure points land anywhere. Background
 * points with nowhere to go are simply lost, as the rule intends.
 *
 * Each point is a TWO-STAGE draw (§4.4):
 *   1. pick a category — list / class / non-class — by the three group weights;
 *   2. pick a skill inside it: by entry weight for the list, uniformly for the other two.
 * So a list entry's weight is relative only to its siblings in the list, never to a
 * class skill. Only categories with room are considered, and a category weighted 0 is
 * drawn from only when no category weighted 1+ has room — the tier rule, lifted from
 * individual skills to categories.
 *
 * Focus (§4.6) is stickiness: after placing a rank, the next one repeats the same skill
 * with probability focus/10, read from the source of that last pick. It is checked
 * before the category roll, otherwise a three-category spread would dilute focus 10 down
 * to a one-in-three chance of continuing. It is still gated on that skill's category
 * being one we would have drawn from, so a fallback category can never hog ranks while a
 * weighted one has room. `last` survives the phase change on purpose, so a focused
 * background skill keeps going on adventure points.
 *
 * `fromExisting` starts each candidate at the ranks it already has instead of 0 — the
 * "clear existing ranks" toggle turned off. The cap then applies to the running total.
 * Returned ranks are always the FINAL value to write, not the delta.
 */
function distributeSkillRanks(slots, budget, cap, { weights = {}, focus = {} } = {}, fromExisting = false) {
  const ranks = {};
  for (const m of slotMembers(slots)) ranks[m.id] = fromExisting ? Math.min(cap, m.current || 0) : 0;

  const catWeight = (source) => clampGroupWeight(weights?.[source]);
  const stickiness = (m) => clampGroupWeight(focus?.[m.source]) / 10;
  // slot id -> the member ids that slot has narrowed to (DESIGN.md §4.2).
  const narrowed = new Map();
  let last = null;
  let spent = 0;

  /** The members of one slot that could take a rank right now. */
  const drawable = (slot, isEligible, ignoreLocks) => {
    const open = slot.members.filter(m => ranks[m.id] < cap && isEligible(m));
    if (ignoreLocks || !slot.locks) return open;
    const allowed = narrowed.get(slot.id);
    return allowed ? open.filter(m => allowed.has(m.id)) : open;
  };

  /** One rank: category, then slot, then member. Returns null when nothing can take it. */
  const drawOne = (isEligible, ignoreLocks) => {
    const open = [];
    for (const slot of slots) {
      const members = drawable(slot, isEligible, ignoreLocks);
      if (members.length) open.push({ slot, members });
    }
    if (!open.length) return null;

    const byCategory = {};
    for (const o of open) (byCategory[o.slot.source] ??= []).push(o);
    const available = SKILL_SOURCES.filter(s => byCategory[s]?.length);
    const weighted = available.filter(s => catWeight(s) >= 1);
    const fromCats = weighted.length ? weighted : available;

    // Focus first, so a three-category spread can't dilute it (§4.4).
    if (last && fromCats.includes(last.source) && Math.random() < stickiness(last)) {
      const hit = open.find(o => o.members.some(m => m.id === last.id));
      if (hit) return { slot: hit.slot, member: last };
    }

    const category = weighted.length
      ? weightedPick(fromCats, s => catWeight(s))
      : uniformPick(fromCats);
    // List rows compete by their own weight; class/non-class rows are a flat draw.
    const chosen = category === "list"
      ? weightedPick(byCategory[category], o => o.slot.weight)
      : uniformPick(byCategory[category]);
    const member = chosen.slot.memberMode === "weighted"
      ? weightedPick(chosen.members, m => m.weight)
      : uniformPick(chosen.members);
    return { slot: chosen.slot, member };
  };

  const spend = (points, isEligible) => {
    for (let i = 0; i < points; i++) {
      // Only when nothing at all can take a rank under the current narrowing do locked
      // rows open up another speciality — "if the character runs out of places to put
      // ranks, they can pick up additional subskills if available".
      const res = drawOne(isEligible, false) ?? drawOne(isEligible, true);
      if (!res) break;

      ranks[res.member.id]++;
      if (res.slot.locks) {
        let allowed = narrowed.get(res.slot.id);
        if (!allowed) narrowed.set(res.slot.id, allowed = new Set());
        allowed.add(res.member.id);
      }
      last = res.member;
      spent++;
    }
  };

  spend(budget.background || 0, m => m.background);
  spend(budget.adventure || 0, () => true);
  return { ranks, spent };
}


export {
  DEFAULT_KNOWN_SUBSKILLS,
  DEFAULT_SKILL_WEIGHT,
  FALLBACK_ARBITRARY_SKILLS,
  SKILL_ALIASES,
  SKILL_DEFAULTS,
  aliasSkillKeys,
  buildSkillSlots,
  clampGroupWeight,
  clampSkillWeight,
  computeSkillBudget,
  distributeSkillRanks,
  expandExcludedSkills,
  getKnownSubSkills,
  getKnownSubSkillsFor,
  getSkillRegistry,
  getSubSkillGroups,
  getSubSkillGroupsFor,
  groupMembers,
  isArbitrarySkill,
  isSkillAlias,
  parseSubSkillList,
  seedKnownSubSkills,
  skillLabel,
  skillRankCap,
  slotMembers,
  useBackgroundSkills,
};
