/* Rolling the treasure mix (DESIGN.md §16, revised).
 *
 * Replaces the weighted budget split. Each category carries an INDEPENDENT chance of
 * appearing at all, and a category that appears claims a random "bite" of the hoard and
 * fills it with items. Whatever is never claimed becomes coin.
 *
 * The point is to move the decision from "what fraction of this hoard is gems" — which
 * only a GM who has already pictured the hoard can answer — to "how often do gems turn
 * up", which is a judgement about the world rather than about this encounter.
 *
 * Pure and synchronous: pools and the budget come in, lines and a coin figure come out.
 */

import { weightedPick } from "../core/util.mjs";

// Category chance and item weight are both 1-10 sliders.
const SLIDER_MAX = 10;

// A category's value range is a percentage of the WHOLE hoard, not of what is left, so
// two 50% rolls fill it between them and the third category finds nothing. That is the
// intent: order matters, which is why it is shuffled.
const DEFAULT_VALUE_MIN = 15;
const DEFAULT_VALUE_MAX = 45;

// A category stops filling when less than this share of its own allocation remains.
const DEFAULT_CATEGORY_FLOOR_PCT = 10;

// ...or when it is down to this few affordable choices, which stops a thin pool from
// producing a run of the same cheap item. Only applied AFTER something has been placed:
// a pool holding three items must still be able to yield one.
const MIN_CHOICES = 5;

// Absolute ceiling on lines, so a pathological pool cannot spin.
const MAX_LINES = 100;

// ...and on total items in one category. A line cap alone is not enough: duplicate draws
// stack onto ONE line, so a pool of 1 gp trinkets against a large allocation would loop
// thousands of times while the line count stayed at 1. Hitting the cap hands the rest of
// the allocation back, which ends up as coin.
const MAX_ITEMS_PER_CATEGORY = 25;

/** Fisher-Yates, with an injectable rng so a test can pin the order. */
function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clampPct(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

/**
 * Choose one item for a target value.
 *
 * Candidates within tolerance of the target are preferred; failing that the nearest
 * affordable one at or below it, and only if everything is dearer, the cheapest thing
 * that fits. Ties are broken by source weight so a weighted source still matters.
 */
function pickNear(pool, target, ceiling, rng, tolerance = 0.35) {
  const affordable = pool.filter(c => c.value > 0 && c.value <= ceiling);
  if (!affordable.length) return null;

  const inBand = affordable.filter(c => c.value >= target * (1 - tolerance) && c.value <= target * (1 + tolerance));
  if (inBand.length) return weightedPick(inBand, c => c.weight, rng);

  const below = affordable.filter(c => c.value <= target);
  const from = below.length ? below : affordable;
  let best = from[0];
  for (const c of from) {
    const better = below.length ? c.value > best.value : c.value < best.value;
    if (better) best = c;
  }
  return weightedPick(from.filter(c => c.value === best.value), c => c.weight, rng);
}

/**
 * Spend one category's allocation.
 *
 * `itemWeight` (1-10) sets how large a share of what is left each item takes: at 1 the
 * category fills with many cheap things, at 10 it is likely to be one expensive one.
 * That single control replaces the per-category count formula — the number of items
 * falls out of the item size and the floor rather than being rolled separately.
 */
function fillCategory(pool, allocation, { itemWeightMin = 3, itemWeightMax = 7,
                                          floorPct = DEFAULT_CATEGORY_FLOOR_PCT,
                                          rng = Math.random, nextId = () => 0, lineCap = MAX_LINES } = {}) {
  const lines = [];
  let left = allocation;
  if (!pool?.length || !(left > 0)) return { lines, left };

  const floor = allocation * (clampPct(floorPct, DEFAULT_CATEGORY_FLOOR_PCT) / 100);
  // A range, drawn per item: one category can hold a mix of sizes.
  const wLo = Math.min(10, Math.max(1, Number(itemWeightMin) || 3));
  const wHi = Math.max(wLo, Math.min(10, Number(itemWeightMax) || 7));
  let placed = 0;

  while (left > floor && lines.length < lineCap && placed < MAX_ITEMS_PER_CATEGORY) {
    const affordable = pool.filter(c => c.value > 0 && c.value <= left);
    if (!affordable.length) break;
    // The thin-pool guard only applies once something has been placed, or a category
    // whose whole pool is three items would generate nothing at all. It is also skipped
    // while the pool itself is smaller than the floor, so a two-item catalogue can still
    // stack rather than stopping after one draw.
    if (placed > 0 && pool.length >= MIN_CHOICES && affordable.length < MIN_CHOICES) break;

    const share = Math.min(1, Math.max(0.05, (wLo + rng() * (wHi - wLo)) / SLIDER_MAX));
    const target = left * share;
    const pick = pickNear(pool, target, left, rng);
    if (!pick) break;

    // §15.4 price jitter, applied to the copy. A jittered price that no longer fits
    // falls back to the catalogue price rather than inventing a discounted item.
    let value = applyVariance(pick, rng);
    if (value > left) value = pick.value;
    if (value > left) break;

    // A repeat draw stacks rather than adding a second row: three separate amethysts
    // read like a bug, "amethyst x3" reads like treasure. A stack keeps the first
    // draw's price, so the row's value is qty x value.
    const existing = lines.find(l => l.uuid === pick.uuid);
    if (existing) { existing.qty += 1; left -= existing.value; }
    else { lines.push(makeLine(pick, nextId(), value)); left -= value; }
    placed++;
  }

  return { lines, left };
}

/** Per-draw price jitter (§15.4), applied to the copy rather than the catalogue entry. */
function applyVariance(candidate, rng) {
  const pct = Math.max(0, Number(candidate.variance) || 0);
  if (pct <= 0) return candidate.value;
  const f = 1 + (rng() * 2 - 1) * (pct / 100);
  return Math.max(0.01, Math.round(candidate.value * f * 100) / 100);
}

function makeLine(candidate, id, value) {
  return {
    id: `line-${id}`,
    uuid: candidate.uuid,
    name: candidate.name,
    img: candidate.img,
    type: candidate.type,
    subType: candidate.subType,
    value: value ?? candidate.value,
    qty: 1,
    locked: false,
    categoryId: candidate.categoryId,
    sourceId: candidate.sourceId,
    origin: "rolled",
    equip: null
  };
}

/**
 * Roll a hoard.
 *
 * @param {object}   args
 * @param {number}   args.total       gp to spend (the encounter's to-generate figure)
 * @param {Array}    args.categories  normalized category records
 * @param {object}   args.mix         { categories: {id: {enabled, chance, itemWeight}},
 *                                      biteMin, biteMax, floorPct }
 * @param {object}   args.pools       { categoryId: candidate[] }
 * @param {Function} [args.rng]
 * @returns {{lines, coins, byCategory, order, spent}}
 *   `coins` is every bite the coin category claimed plus everything never claimed at
 *   all, so lines + coins always equals the budget.
 */
function rollHoard({ total, categories, mix, pools, rng = Math.random }) {
  const budget = Math.max(0, Number(total) || 0);
  const cfgAll = mix?.categories ?? {};
  const floorPct = clampPct(mix?.floorPct, DEFAULT_CATEGORY_FLOOR_PCT);

  const lines = [];
  const byCategory = {};
  let coins = 0;
  let remaining = budget;
  let idCounter = 0;
  const nextId = () => idCounter++;

  // Only categories that are switched on and can actually deliver. A category with no
  // candidates would otherwise roll its chance, claim a bite and produce nothing.
  const eligible = (categories ?? []).filter(cat => {
    const cfg = cfgAll[cat.id];
    if (!cfg?.enabled) return false;
    return cat.isCoinSink || (pools?.[cat.id]?.length ?? 0) > 0;
  });

  // Independent chances mean the order decides who gets to the budget first, so it is
  // shuffled per roll rather than following the list.
  const order = shuffle(eligible, rng);

  for (const cat of order) {
    if (remaining <= 0) break;
    const cfg = cfgAll[cat.id];
    const chance = Math.min(SLIDER_MAX, Math.max(0, Number(cfg.chance) || 0)) / SLIDER_MAX;
    if (rng() >= chance) {
      byCategory[cat.id] = { rolled: false, allocation: 0, spent: 0, lines: 0 };
      continue;
    }

    // Each category has its own value range, so gems and magic items can want
    // differently sized slices of the same hoard.
    const lo = clampPct(cfg.valueMin, DEFAULT_VALUE_MIN);
    const hi = Math.max(lo, clampPct(cfg.valueMax, DEFAULT_VALUE_MAX));
    const pct = lo + rng() * (hi - lo);
    const allocation = Math.min(remaining, budget * (pct / 100));

    if (cat.isCoinSink) {
      coins += allocation;
      remaining -= allocation;
      byCategory[cat.id] = { rolled: true, allocation, spent: allocation, lines: 0 };
      continue;
    }

    const r = fillCategory(pools[cat.id], allocation, {
      itemWeightMin: cfg.itemWeightMin, itemWeightMax: cfg.itemWeightMax,
      floorPct, rng, nextId, lineCap: MAX_LINES - lines.length
    });
    const spent = allocation - r.left;
    lines.push(...r.lines);
    // Anything the category could not spend goes back into the pot for the categories
    // after it, rather than being written off to coin — a stingy category should not
    // starve the ones that follow.
    remaining -= spent;
    byCategory[cat.id] = { rolled: true, allocation, spent, lines: r.lines.length };
  }

  // Everything never claimed is coin. This is what keeps lines + coins == budget.
  coins += Math.max(0, remaining);

  const spent = lines.reduce((s, l) => s + l.value * l.qty, 0);
  return { lines, coins, byCategory, order: order.map(c => c.id), spent };
}

export {
  SLIDER_MAX,
  DEFAULT_VALUE_MIN,
  DEFAULT_VALUE_MAX,
  DEFAULT_CATEGORY_FLOOR_PCT,
  MIN_CHOICES,
  MAX_LINES,
  MAX_ITEMS_PER_CATEGORY,
  shuffle,
  pickNear,
  applyVariance,
  fillCategory,
  rollHoard,
};
