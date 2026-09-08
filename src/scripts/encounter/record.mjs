/* The encounter record and everything derivable from it (DESIGN.md §12, §13.3).
 *
 * Pure and synchronous. Resolving uuids against the world, reading settings and writing
 * the store all happen elsewhere — this layer only shapes and reasons about the data,
 * which is what lets the budget arithmetic be tested without a world.
 */

import { crExceedsTable, encounterCRFromXP, treasureForCR, xpForCR } from "../core/cr.mjs";
import { treasureShortfall } from "./wealth.mjs";

const ENCOUNTER_SCHEMA = 1;

// §16.2 — budget-aware by default, so one preset works at CR 1 and CR 20.
const DEFAULT_COUNT_FORMULA = "1d3 + @budget / 800";

// Every category starts equally weighted. Categories with no source push their whole
// share into coins (§16.4), which is visible rather than silent — a GM who wants gems
// can see they need to point a source at one.
const DEFAULT_CATEGORY_WEIGHT = 5;

// Relative coin COUNTS, 0-100. Weighted toward the middle denominations because a purse
// of mostly platinum reads wrong, and equal counts across all four is a lot of platinum.
const DEFAULT_DENOM_WEIGHTS = { pp: 5, gp: 40, sp: 30, cp: 25 };

function clamp01to100(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function clamp1to10(v, fallback = 5) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10, Math.max(1, Math.round(n)));
}

// How much of the whole hoard one category may claim when it rolls, as a percentage
// range. Per category, so gems and magic items can want different sized slices.
const DEFAULT_CATEGORY_VALUE = { valueMin: 15, valueMax: 45 };

// Item values is a range too: each item draws its target share from inside it, so one
// category can hold a mix of sizes rather than every item aiming at the same fraction.
const DEFAULT_ITEM_VALUE = { itemWeightMin: 3, itemWeightMax: 7 };
const DEFAULT_MIX = { floorPct: 10 };

/**
 * Force the mix into its current shape, migrating a pre-revision record.
 *
 * The old model stored `weights` (a 0-10 budget split) and `countFormulas`. A weight of
 * 0 meant "excluded", which is now the `enabled` checkbox; anything above became the
 * category's chance. Count formulas are dropped — the item-weight slider replaces them.
 */
function normalizeMix(mix, legacyWeights) {
  const categories = {};
  const source = mix?.categories ?? null;
  // A pre-per-category record carried one shared range; seed every category from it.
  const sharedMin = Number(mix?.biteMin);
  const sharedMax = Number(mix?.biteMax);

  const range = (cfg) => {
    const lo = clamp01to100(cfg?.valueMin ?? (Number.isFinite(sharedMin) ? sharedMin : DEFAULT_CATEGORY_VALUE.valueMin));
    const hi = clamp01to100(cfg?.valueMax ?? (Number.isFinite(sharedMax) ? sharedMax : DEFAULT_CATEGORY_VALUE.valueMax));

    // Item values migrates from the single `itemWeight` it used to be: a band around the
    // old figure, so an existing encounter keeps roughly the same shape.
    const single = Number(cfg?.itemWeight);
    const fallbackLo = Number.isFinite(single) ? single - 1 : DEFAULT_ITEM_VALUE.itemWeightMin;
    const fallbackHi = Number.isFinite(single) ? single + 1 : DEFAULT_ITEM_VALUE.itemWeightMax;
    const ilo = clamp1to10(cfg?.itemWeightMin ?? fallbackLo);
    const ihi = clamp1to10(cfg?.itemWeightMax ?? fallbackHi);

    return {
      valueMin: Math.min(lo, hi), valueMax: Math.max(lo, hi),
      itemWeightMin: Math.min(ilo, ihi), itemWeightMax: Math.max(ilo, ihi)
    };
  };

  if (source) {
    for (const [id, cfg] of Object.entries(source)) {
      categories[id] = {
        enabled: cfg?.enabled !== false,
        chance: clamp1to10(cfg?.chance),
        ...range(cfg)
      };
    }
  } else if (legacyWeights && typeof legacyWeights === "object") {
    for (const [id, w] of Object.entries(legacyWeights)) {
      const n = Number(w) || 0;
      categories[id] = { enabled: n > 0, chance: clamp1to10(n || 5), ...range(null) };
    }
  }

  return { categories, floorPct: clamp01to100(mix?.floorPct ?? DEFAULT_MIX.floorPct) };
}

/** A fresh mix for a category set: everything on, middling chance and item size. */
function defaultMixFor(categories) {
  const cats = {};
  for (const cat of categories ?? []) {
    cats[cat.id] = { enabled: true, chance: 5, ...DEFAULT_CATEGORY_VALUE, ...DEFAULT_ITEM_VALUE };
  }
  return { ...DEFAULT_MIX, categories: cats };
}

function randomId(prefix) {
  const rand = globalThis.foundry?.utils?.randomID?.() ??
    Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}`;
}

/**
 * A member of an encounter. `cr` is cached alongside the uuids so a deleted token
 * degrades to a named row that still contributes its CR, rather than silently changing
 * the encounter's total (§12.2).
 *
 * XP is *not* cached — it is derived from `cr` on read, so there is one source of truth
 * and a system-side change to the XP ladder cannot leave a record stale.
 */
function createMember({ tokenUuid = null, actorUuid = null, name = "", img = "", cr = 0, missing = false } = {}) {
  return {
    tokenUuid,
    actorUuid,
    name: String(name ?? ""),
    img: String(img ?? ""),
    cr: Number(cr) || 0,
    // Carried through rather than reset, so a member round-trips through create →
    // normalize → save → load without quietly losing the flag that says its token is gone.
    missing: missing === true
  };
}

function memberFromToken(tokenDoc) {
  const actor = tokenDoc?.actor ?? null;
  return createMember({
    tokenUuid: tokenDoc?.uuid ?? null,
    actorUuid: actor?.uuid ?? null,
    name: tokenDoc?.name ?? actor?.name ?? "",
    img: tokenDoc?.texture?.src ?? actor?.img ?? "",
    cr: foundryGet(actor, "system.details.cr.total") ?? 0
  });
}

function foundryGet(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

function createEncounter(overrides = {}) {
  return normalizeEncounter({
    id: randomId("enc"),
    name: "",
    schema: ENCOUNTER_SCHEMA,
    ...overrides
  });
}

/**
 * Fill in every field a record may be missing. Runs on read as well as create, so a
 * record written by an older build — or hand-edited — cannot crash a consumer with an
 * undefined lookup.
 */
function normalizeEncounter(raw) {
  const r = raw ?? {};
  const countExisting = r.countExisting ?? {};
  return {
    id: r.id || randomId("enc"),
    schema: Number(r.schema) || ENCOUNTER_SCHEMA,
    name: String(r.name ?? ""),
    sceneId: r.sceneId ?? null,
    members: (Array.isArray(r.members) ? r.members : []).map(createMember),
    crOverride: numberOrNull(r.crOverride),
    pace: ["slow", "medium", "fast"].includes(r.pace) ? r.pace : "medium",
    budgetOverride: numberOrNull(r.budgetOverride),
    // §14.2 — all three default on. `!== false` so an absent key reads as on.
    countExisting: {
      equipped: countExisting.equipped !== false,
      coins: countExisting.coins !== false,
      consumables: countExisting.consumables !== false
    },
    profile: r.profile ?? null,
    // §16 revised: per-category chance + item weight, not a budget split.
    mix: normalizeMix(r.mix, r.weights),
    // Targets excluded from every bulk distribution, including Return All. Items already
    // on them stay; manual drag-and-drop still works.
    lockedTargets: Array.isArray(r.lockedTargets) ? [...r.lockedTargets] : [],
    // A THIRD, independent exclusion (§17.3b): a target locked out of coin still takes
    // items from the bulk buttons. The wolves carry the gear and not the purse.
    coinExcluded: Array.isArray(r.coinExcluded) ? [...r.coinExcluded] : [],
    lines: Array.isArray(r.lines) ? r.lines.map(normalizeLine) : [],
    assignment: { ...(r.assignment ?? {}) },
    currency: {
      // `pool` is DERIVED, not authored: it is whatever the budget has left after the
      // item lines (§17.3). Kept on the record so Apply and the picker can read the last
      // computed value without re-resolving members.
      pool: { pp: 0, gp: 0, sp: 0, cp: 0, ...(r.currency?.pool ?? {}) },
      split: { ...(r.currency?.split ?? {}) },
      // Relative coin COUNTS, not value — see denominationCounts.
      denomWeights: { ...DEFAULT_DENOM_WEIGHTS, ...(r.currency?.denomWeights ?? {}) },
      denomRandomness: clamp01to100(r.currency?.denomRandomness),
      splitRandomness: clamp01to100(r.currency?.splitRandomness)
    },
    applied: r.applied ?? null
  };
}

function normalizeLine(raw) {
  const l = raw ?? {};
  return {
    id: l.id || randomId("line"),
    uuid: l.uuid ?? null,
    name: String(l.name ?? ""),
    img: l.img ?? "",
    type: l.type ?? null,
    subType: l.subType ?? null,
    value: Math.max(0, Number(l.value) || 0),
    qty: Math.max(1, Math.floor(Number(l.qty) || 1)),
    // Two independent locks. `locked` survives a re-generate and is shown in the tray;
    // `pinned` survives Return All and is shown on the target card. An item keeps both
    // wherever it sits, so a re-roll lock set in the tray is still there after a round
    // trip through a target even though the target showed it as unpinned.
    locked: l.locked === true,
    pinned: l.pinned === true,
    categoryId: l.categoryId ?? null,
    sourceId: l.sourceId ?? null,
    origin: l.origin === "manual" ? "manual" : "rolled",
    // Tri-state: null means "use the encounter-equip-generated setting". A plain
    // boolean default of false could never fall back to it, since `false ?? x` is false.
    equip: typeof l.equip === "boolean" ? l.equip : null
  };
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Members ─────────────────────────────────────────────────────────────────

/** Add a member, ignoring a token already present. Returns a new member list. */
function addMember(members, member) {
  const list = members ?? [];
  if (member.tokenUuid && list.some(m => m.tokenUuid === member.tokenUuid)) return list;
  return [...list, member];
}

function removeMember(members, tokenUuid, index = -1) {
  const list = members ?? [];
  // Manual members have no uuid, so fall back to position for those.
  if (!tokenUuid) return list.filter((_, i) => i !== index);
  return list.filter(m => m.tokenUuid !== tokenUuid);
}

// ─── Derived figures (§13.3) ─────────────────────────────────────────────────

/**
 * The encounter's CR and the budget that follows from it, in precedence order:
 * an explicit gp override, then an explicit CR against the table, then the CR derived
 * from summed member XP.
 *
 * Missing members still count: their CR was cached precisely so a deleted token cannot
 * silently change what the encounter is worth (§12.2).
 */
function encounterBudget(record) {
  const members = record?.members ?? [];
  const totalXP = members.reduce((sum, m) => sum + xpForCR(m.cr), 0);
  const derivedCR = encounterCRFromXP(totalXP);
  const cr = record?.crOverride ?? derivedCR;
  const pace = record?.pace ?? "medium";

  let budget, source;
  if (record?.budgetOverride !== null && record?.budgetOverride !== undefined) {
    budget = Math.max(0, Number(record.budgetOverride) || 0);
    source = "override";
  } else {
    budget = treasureForCR(cr, pace);
    source = record?.crOverride !== null && record?.crOverride !== undefined ? "cr" : "derived";
  }

  return {
    totalXP,
    derivedCR,
    cr,
    pace,
    budget,
    source,
    exceedsTable: cr !== null && crExceedsTable(cr),
    memberCount: members.length,
    missingCount: members.filter(m => m.missing).length
  };
}

/**
 * Budget, existing wealth and the shortfall between them — the header readout of §14.3.
 * `carriedGp` is passed in rather than computed, because resolving members to actors is
 * async and this layer stays pure.
 */
function encounterPlan(record, carriedGp = 0) {
  const b = encounterBudget(record);
  return { ...b, ...treasureShortfall(b.budget, carriedGp) };
}

// ─── Lines and assignment ────────────────────────────────────────────────────

/** Total value of the generated lines, plus the coin pool, in gp. */
function hoardValue(record) {
  const lines = (record?.lines ?? []).reduce((s, l) => s + l.value * l.qty, 0);
  const c = record?.currency?.pool ?? {};
  const coins = (c.pp ?? 0) * 10 + (c.gp ?? 0) + (c.sp ?? 0) / 10 + (c.cp ?? 0) / 100;
  return { lines, coins, total: lines + coins };
}

/**
 * The coin pool is the budget's remainder, never an authored figure (§17.3).
 *
 *   coin = (budget - already carried) - the value of the generated item lines
 *
 * Clamped at zero. When the lines overshoot, the surplus is reported as `overBudget` so
 * the window can say how far into the red the encounter is rather than silently showing
 * no coin — an empty purse and a 900 gp overspend look identical otherwise.
 */
function coinRemainder(record, carriedGp = 0) {
  const plan = encounterPlan(record, carriedGp);
  const lines = (record?.lines ?? []).reduce((s, l) => s + l.value * l.qty, 0);
  const rest = plan.toGenerate - lines;
  return {
    gp: Math.max(0, rest),
    overBudget: rest < 0 ? -rest : 0,
    linesValue: lines,
    toGenerate: plan.toGenerate
  };
}

/** Lines not yet placed on a target — the §17.1 tray. */
function unassignedLines(record) {
  const a = record?.assignment ?? {};
  return (record?.lines ?? []).filter(l => !a[l.id]);
}

function assignLine(assignment, lineId, target) {
  const next = { ...(assignment ?? {}) };
  if (target === null || target === undefined) delete next[lineId];
  else next[lineId] = target;
  return next;
}

/**
 * Every line back to the tray — the pre-Apply undo for a mis-click (§17.2).
 *
 * Two things survive it: a **pinned line**, and anything on a **locked target**. Return
 * All is the blunt instrument, so those two are what make it safe to press.
 */
function clearAssignments(record) {
  const locked = new Set(record?.lockedTargets ?? []);
  const byId = new Map((record?.lines ?? []).map(l => [l.id, l]));
  const next = {};
  for (const [lineId, target] of Object.entries(record?.assignment ?? {})) {
    // `pinned`, not `locked`: the tray lock is about surviving a re-roll, which has
    // nothing to do with whether an item should stay on the creature carrying it.
    if (byId.get(lineId)?.pinned || locked.has(target)) next[lineId] = target;
  }
  return next;
}

/** Targets a bulk distribution may write to — everything except the locked ones. */
function distributableTargets(record, targets) {
  const locked = new Set(record?.lockedTargets ?? []);
  return (targets ?? []).filter(t => !locked.has(t.id ?? t));
}

/**
 * Targets a coin split may write to — everything except the coin-excluded ones.
 *
 * Separate from `distributableTargets`: the item lock and the coin lock are independent,
 * so a target can be excluded from one without the other. The coin split has always used
 * the full member list rather than the distributable one, which is why this needs its own
 * filter rather than reusing that lock.
 */
function coinTargets(record, targets) {
  const excluded = new Set(record?.coinExcluded ?? []);
  return (targets ?? []).filter(t => !excluded.has(t.id ?? t));
}

/**
 * Toggle an id in one of the target lock lists, returning a new list.
 *
 * Serves both `lockedTargets` and `coinExcluded` — the two lists differ in what they
 * mean, not in how they are edited.
 */
function toggleTargetLock(lockedTargets, targetId) {
  const list = lockedTargets ?? [];
  return list.includes(targetId) ? list.filter(id => id !== targetId) : [...list, targetId];
}

/** Whether this encounter has already been written to the world (§18.2). */
function isApplied(record) {
  return !!record?.applied?.at;
}

export {
  ENCOUNTER_SCHEMA,
  DEFAULT_COUNT_FORMULA,
  DEFAULT_CATEGORY_WEIGHT,
  DEFAULT_DENOM_WEIGHTS,
  DEFAULT_MIX,
  DEFAULT_CATEGORY_VALUE,
  DEFAULT_ITEM_VALUE,
  normalizeMix,
  defaultMixFor,
  createEncounter,
  normalizeEncounter,
  normalizeLine,
  createMember,
  memberFromToken,
  addMember,
  removeMember,
  encounterBudget,
  encounterPlan,
  hoardValue,
  coinRemainder,
  unassignedLines,
  assignLine,
  clearAssignments,
  distributableTargets,
  coinTargets,
  toggleTargetLock,
  isApplied,
};
