/* Bulk distribution of lines and coin across targets (DESIGN.md §17.2, §17.3).
 *
 * Pure. A "target" is an opaque id — a member's token uuid — so nothing here knows or
 * cares what it is handing loot to.
 */

import {
  COIN_CP, COIN_ORDER, blendWeights, cpToCoins, denominationCounts, largestDenomination,
  poolToCp,
} from "../core/coins.mjs";
import { xpForCR } from "../core/cr.mjs";
import { weightedPick } from "../core/util.mjs";

const DISTRIBUTION_MODES = ["even", "random", "byCR", "all"];

/**
 * Assign lines to targets.
 *
 * @param {Array}  lines    the lines to place (already filtered — e.g. only the tray)
 * @param {Array}  targets  target ids; `weights` keys must line up with these
 * @param {string} mode     "even" | "random" | "byCR" | "all"
 * @param {object} [opts]   { rng, weights: {targetId: number}, target: id for "all" }
 * @returns {object} a patch of { lineId: targetId } — merge it over the assignment
 */
function distributeLines(lines, targets, mode, { rng = Math.random, weights = {}, target = null } = {}) {
  const out = {};
  const list = lines ?? [];
  if (!list.length) return out;

  if (mode === "all") {
    if (!target) return out;
    for (const l of list) out[l.id] = target;
    return out;
  }

  const ids = targets ?? [];
  if (!ids.length) return out;

  if (mode === "even") {
    // Round-robin. Deliberately not shuffled: an even split should be reproducible and
    // obvious, and "random" is right there for the other behaviour.
    list.forEach((l, i) => { out[l.id] = ids[i % ids.length]; });
    return out;
  }

  if (mode === "byCR") {
    // A target with no weight can still be drawn — weightedPick falls back to uniform
    // when every weight is zero, which is what an encounter of CR 0 members needs.
    for (const l of list) out[l.id] = weightedPick(ids, id => weights[id] ?? 0, rng) ?? ids[0];
    return out;
  }

  // "random"
  for (const l of list) out[l.id] = ids[Math.floor(rng() * ids.length)];
  return out;
}

/** Per-target weights from an encounter's members: XP, so the boss carries more (§17.2). */
function crWeights(members) {
  const w = {};
  for (const m of members ?? []) {
    const id = m.tokenUuid ?? m.actorUuid;
    if (!id) continue;
    w[id] = (w[id] ?? 0) + xpForCR(m.cr);
  }
  return w;
}

// ─── Currency (§17.3) ────────────────────────────────────────────────────────

/**
 * Split a coin pool across targets.
 *
 * Allocation happens entirely in copper and is exact: shares are floored, then the
 * leftover copper is handed out one at a time by largest fractional remainder (ties to
 * the earlier target). So the parts always add back up to the pool — no coin is created
 * and none evaporates, which is the property a GM will notice being wrong.
 *
 * @param {object} pool     { pp, gp, sp, cp }
 * @param {Array}  targets  target ids
 * @param {string} mode     "even" | "random" | "byCR"
 * @param {object} [opts]   { rng, weights }
 * @returns {object} { targetId: { pp, gp, sp, cp } }
 */
function splitCurrency(pool, targets, mode = "even",
                      { rng = Math.random, weights = {}, randomness = 0, denomWeights = null } = {}) {
  const ids = targets ?? [];
  const out = {};
  if (!ids.length) return out;

  const total = poolToCp(pool);
  const maxDenom = largestDenomination(pool);
  for (const id of ids) out[id] = { pp: 0, gp: 0, sp: 0, cp: 0 };
  if (total <= 0) return out;

  // One slider spans the whole range: at 0 an even split is as equal as the integers
  // allow and a byCR split is as proportional as they allow; at 1 both are effectively
  // random. "random" as a separate mode is just randomness 1 over equal weights.
  let raw;
  if (mode === "byCR") raw = ids.map(id => Math.max(0, Number(weights[id]) || 0));
  else raw = ids.map(() => 1);
  if (raw.every(w => w <= 0)) raw = ids.map(() => 1);
  const r = mode === "random" ? 1 : randomness;
  raw = blendWeights(raw, r, rng);

  let sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) { raw = ids.map(() => 1); sum = ids.length; }

  const exact = raw.map(w => (w / sum) * total);
  const floors = exact.map(v => Math.floor(v));
  let left = total - floors.reduce((a, b) => a + b, 0);

  // Largest fractional part first, so the leftover copper lands where it was closest to
  // being earned rather than always on the first target.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  for (let k = 0; k < order.length && left > 0; k++, left--) floors[order[k].i]++;
  // More leftover than targets cannot happen (left < ids.length), but guard anyway.
  for (let i = 0; left > 0; i = (i + 1) % ids.length, left--) floors[i]++;

  // Each target's share is re-broken into coins. With denomWeights that is a count-based
  // split (§17.3); without, plain change capped at the pool's largest denomination.
  ids.forEach((id, i) => {
    out[id] = denomWeights
      ? denominationCounts(floors[i], denomWeights, { randomness: 0, rng })
      : cpToCoins(floors[i], maxDenom);
  });
  return out;
}

/**
 * Move coin off targets that no longer exist, onto the ones that do.
 *
 * The orphaned pot is shared out **in proportion to the shares the survivors already
 * hold**, so the shape of the roll that already happened is preserved rather than
 * re-rolled — a GM who tuned a split should not have it randomised out from under them
 * because one token was deleted. Survivors holding nothing at all fall back to an even
 * share, since proportions of zero say nothing.
 *
 * Exact: the returned split totals what it started with, to the copper.
 *
 * @param {object} split        { targetId: {pp,gp,sp,cp} }
 * @param {Array}  missingIds   targets that no longer resolve
 * @param {object} [denomWeights] re-break each survivor's new total by count (§17.3)
 * @returns {{split: object, moved: number}} the new split, and the copper reassigned
 */
function reallocateCoin(split, missingIds, denomWeights = null) {
  const gone = new Set(missingIds ?? []);
  const entries = Object.entries(split ?? {});
  const survivors = entries.filter(([id]) => !gone.has(id));
  const pot = entries.filter(([id]) => gone.has(id)).reduce((s, [, c]) => s + poolToCp(c), 0);

  const out = {};
  // Nowhere to put it: the pool is derived, so the coin simply goes back to being
  // unsplit rather than being invented onto a target that never held it.
  if (!survivors.length) return { split: out, moved: pot };

  const current = survivors.map(([, c]) => poolToCp(c));
  if (pot <= 0) {
    survivors.forEach(([id], i) => {
      out[id] = denomWeights ? denominationCounts(current[i], denomWeights) : { ...split[id] };
    });
    return { split: out, moved: 0 };
  }

  const base = current.reduce((a, b) => a + b, 0);
  const weights = base > 0 ? current : current.map(() => 1);
  const wSum = weights.reduce((a, b) => a + b, 0);

  const exact = weights.map(w => (w / wSum) * pot);
  const add = exact.map(v => Math.floor(v));
  let left = pot - add.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  for (let k = 0; k < order.length && left > 0; k++, left--) add[order[k].i]++;
  for (let i = 0; left > 0; i = (i + 1) % survivors.length, left--) add[i]++;

  survivors.forEach(([id], i) => {
    const total = current[i] + add[i];
    out[id] = denomWeights ? denominationCounts(total, denomWeights) : cpToCoins(total, "pp");
  });
  return { split: out, moved: pot };
}

/** Sum a split back up, for asserting that nothing was created or lost. */
function totalOfSplit(split) {
  return Object.values(split ?? {}).reduce((sum, coins) => sum + poolToCp(coins), 0);
}

export {
  COIN_ORDER,
  COIN_CP,
  DISTRIBUTION_MODES,
  distributeLines,
  crWeights,
  poolToCp,
  cpToCoins,
  largestDenomination,
  blendWeights,
  denominationCounts,
  splitCurrency,
  reallocateCoin,
  totalOfSplit,
};
