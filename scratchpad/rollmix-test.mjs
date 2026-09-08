/* Exercises encounter/roll-mix.mjs — the rolled treasure mix (DESIGN.md §16 revised).
 *
 *   node scratchpad/rollmix-test.mjs
 */

import {
  rollHoard, fillCategory, pickNear, shuffle, MIN_CHOICES,
} from "../src/scripts/encounter/roll-mix.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);
const near = (name, got, want, tol) =>
  ok(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}±${tol}`);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATS = [
  { id: "coins", isCoinSink: true },
  { id: "gems", isCoinSink: false },
  { id: "art", isCoinSink: false },
  { id: "gear", isCoinSink: false },
];

const pool = (prices, catId = "gems") => prices.map((value, i) => ({
  uuid: `Compendium.x.y.Item.${catId}${i}`, name: `${catId} ${value}gp`, img: "",
  type: "loot", subType: "treasure", value, sourceId: "s1", categoryId: catId,
  weight: 5, maxCount: 0, variance: 0,
}));

// The value range is per category, so the helper stamps one range across all of them
// unless a test overrides a category outright.
const mixOf = ({ value = [15, 45], categories = null, ...over } = {}) => {
  const base = {
    coins: { enabled: true, chance: 5, itemWeightMin: 5, itemWeightMax: 5 },
    gems: { enabled: true, chance: 5, itemWeightMin: 5, itemWeightMax: 5 },
    art: { enabled: true, chance: 5, itemWeightMin: 5, itemWeightMax: 5 },
    gear: { enabled: true, chance: 5, itemWeightMin: 5, itemWeightMax: 5 },
  };
  const src = categories ?? base;
  const cats = {};
  for (const [id, cfg] of Object.entries(src)) {
    cats[id] = { valueMin: value[0], valueMax: value[1], ...cfg };
  }
  return { categories: cats, floorPct: 10, ...over };
};

const value = (r) => r.lines.reduce((s, l) => s + l.value * l.qty, 0);

console.log("\n── the budget invariant holds ──");
{
  const rng = mulberry(1);
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const r = rollHoard({
      total: 5450, categories: CATS, mix: mixOf(),
      pools: { gems: pool([50, 200, 650, 1200]), art: pool([100, 900], "art"), gear: pool([5, 40, 300], "gear") },
      rng,
    });
    worst = Math.max(worst, Math.abs(value(r) + r.coins - 5450));
  }
  ok(`items + coins == budget across 300 rolls (worst drift ${worst.toExponential(1)})`, worst < 1e-6);
}

console.log("\n── independent chances ──");
{
  // Chance 10 = always, chance 0 = never. The absolute value is meaningful, which is
  // the whole reason for independent chances over relative weights.
  const rng = mulberry(2);
  let gemsHit = 0, artHit = 0;
  for (let i = 0; i < 400; i++) {
    const r = rollHoard({
      total: 2000, categories: CATS,
      mix: mixOf({ categories: {
        coins: { enabled: true, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
        gems: { enabled: true, chance: 10, itemWeightMin: 5, itemWeightMax: 5 },
        art: { enabled: true, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
        gear: { enabled: false, chance: 10, itemWeightMin: 5, itemWeightMax: 5 },
      } }),
      pools: { gems: pool([100, 400]), art: pool([100], "art"), gear: pool([100], "gear") },
      rng,
    });
    if (r.byCategory.gems?.rolled) gemsHit++;
    if (r.byCategory.art?.rolled) artHit++;
  }
  eq("chance 10 always rolls", gemsHit, 400);
  eq("chance 0 never rolls", artHit, 0);
}
{
  const rng = mulberry(3);
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const r = rollHoard({
      total: 2000, categories: CATS,
      mix: mixOf({ categories: {
        coins: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
        gems: { enabled: true, chance: 3, itemWeightMin: 5, itemWeightMax: 5 },
        art: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
        gear: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
      } }),
      pools: { gems: pool([100, 400]) }, rng,
    });
    if (r.byCategory.gems?.rolled) hits++;
  }
  near("chance 3 hits about 30% of the time", hits / 2000, 0.3, 0.04);
}
{
  const r = rollHoard({
    total: 1000, categories: CATS,
    mix: mixOf({ categories: {
      coins: { enabled: false, chance: 10, itemWeightMin: 5, itemWeightMax: 5 },
      gems: { enabled: false, chance: 10, itemWeightMin: 5, itemWeightMax: 5 },
      art: { enabled: false, chance: 10, itemWeightMin: 5, itemWeightMax: 5 },
      gear: { enabled: false, chance: 10, itemWeightMin: 5, itemWeightMax: 5 },
    } }),
    pools: { gems: pool([100]) }, rng: mulberry(4),
  });
  eq("everything disabled generates no lines", r.lines.length, 0);
  eq("...and the whole budget becomes coin", r.coins, 1000);
}
{
  const rng = mulberry(5);
  let coinHeavy = 0;
  for (let i = 0; i < 200; i++) {
    const r = rollHoard({
      total: 1000, categories: CATS,
      mix: mixOf({ categories: {
        coins: { enabled: true, chance: 1, itemWeightMin: 5, itemWeightMax: 5 },
        gems: { enabled: true, chance: 1, itemWeightMin: 5, itemWeightMax: 5 },
        art: { enabled: true, chance: 1, itemWeightMin: 5, itemWeightMax: 5 },
        gear: { enabled: true, chance: 1, itemWeightMin: 5, itemWeightMax: 5 },
      } }),
      pools: { gems: pool([100]), art: pool([100], "art"), gear: pool([100], "gear") }, rng,
    });
    if (r.coins > 700) coinHeavy++;
  }
  ok(`all sliders low gives a coin-heavy hoard (${coinHeavy}/200 over 70% coin)`, coinHeavy > 150);
}

console.log("\n── order is shuffled, and matters ──");
{
  const rng = mulberry(7);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const r = rollHoard({
      total: 5000, categories: CATS, mix: mixOf(),
      pools: { gems: pool([500]), art: pool([500], "art"), gear: pool([500], "gear") }, rng,
    });
    seen.add(r.order.join(">"));
  }
  ok(`category order varies between rolls (${seen.size} orders seen)`, seen.size > 5);
}
{
  // Bites are a share of the WHOLE hoard, so two big ones leave the third nothing.
  const rng = mulberry(11);
  const r = rollHoard({
    total: 1000, categories: CATS,
    mix: mixOf({ value: [50, 50], categories: {
      coins: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
      gems: { enabled: true, chance: 10, itemWeightMin: 10, itemWeightMax: 10 },
      art: { enabled: true, chance: 10, itemWeightMin: 10, itemWeightMax: 10 },
      gear: { enabled: true, chance: 10, itemWeightMin: 10, itemWeightMax: 10 },
    } }),
    pools: { gems: pool([500]), art: pool([500], "art"), gear: pool([500], "gear") }, rng,
  });
  const claimed = Object.values(r.byCategory).filter(c => c.allocation > 0).length;
  eq("two 50% bites exhaust the budget", claimed, 2);
  eq("...leaving the third with nothing", value(r), 1000);
}

console.log("\n── item weight: how big each item is ──");
{
  const prices = [10, 25, 50, 100, 250, 500, 1000];
  const rng = mulberry(13);
  const counts = {};
  for (const w of [1, 5, 10]) {
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const r = fillCategory(pool(prices), 1000, { itemWeightMin: w, itemWeightMax: w, rng });
      total += r.lines.reduce((s, l) => s + l.qty, 0);
    }
    counts[w] = total / 100;
  }
  ok(`weight 1 yields many items (${counts[1].toFixed(1)} avg)`, counts[1] > 3);
  ok(`weight 10 yields few (${counts[10].toFixed(1)} avg)`, counts[10] < 2.5);
  ok("item count falls as weight rises", counts[1] > counts[5] && counts[5] >= counts[10],
     JSON.stringify(counts));
}

console.log("\n── fillCategory guards ──");
{
  // The hole in the raw "stop below 5 choices" rule: a three-item pool must still work.
  const r = fillCategory(pool([100, 200, 300]), 1000, { itemWeightMin: 5, itemWeightMax: 5, rng: mulberry(17) });
  ok("a pool smaller than the choice floor still produces something", r.lines.length > 0);
}
{
  const r = fillCategory(pool([100, 120, 140, 160, 180, 200]), 10000, { itemWeightMin: 1, itemWeightMax: 1, rng: mulberry(19) });
  ok("the choice floor stops a thin pool from running away", r.lines.reduce((s, l) => s + l.qty, 0) < 40,
     String(r.lines.reduce((s, l) => s + l.qty, 0)));
}
{
  const r = fillCategory(pool([5000]), 100, { rng: mulberry(23) });
  eq("nothing affordable places nothing", r.lines.length, 0);
  eq("...and hands the whole allocation back", r.left, 100);
}
{
  const r = fillCategory([], 500, { rng: mulberry(29) });
  eq("an empty pool is a no-op", r.lines.length, 0);
  eq("...returning the allocation", r.left, 500);
}
{
  const r = fillCategory(pool([50]), 1000, { itemWeightMin: 1, itemWeightMax: 1, rng: mulberry(31) });
  const line = r.lines[0];
  ok("a repeated draw stacks into one line", r.lines.length === 1 && line.qty > 1,
     JSON.stringify(r.lines.map(l => [l.name, l.qty])));
}

console.log("\n── unspent allocation returns to the pot ──");
{
  // Gems can only spend 100 of a large bite; the rest must remain available, not be
  // written off — so the coin total plus lines still equals the budget.
  const rng = mulberry(37);
  const r = rollHoard({
    total: 1000, categories: CATS,
    mix: mixOf({ value: [90, 90], categories: {
      coins: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
      gems: { enabled: true, chance: 10, itemWeightMin: 10, itemWeightMax: 10 },
      art: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
      gear: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
    } }),
    // One item at 800: affordable once, then nothing fits in the 100 that is left.
    pools: { gems: pool([800]) }, rng,
  });
  ok("the unspendable part of a bite is not lost", value(r) + r.coins === 1000,
     `${value(r)} + ${r.coins}`);
  ok("gems spent only what it could", r.byCategory.gems.spent < r.byCategory.gems.allocation,
     `${r.byCategory.gems.spent} of ${r.byCategory.gems.allocation}`);
}

console.log("\n── coin category ──");
{
  const rng = mulberry(41);
  const r = rollHoard({
    total: 1000, categories: CATS,
    mix: mixOf({ value: [40, 40], categories: {
      coins: { enabled: true, chance: 10, itemWeightMin: 5, itemWeightMax: 5 },
      gems: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
      art: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
      gear: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
    } }),
    pools: {}, rng,
  });
  eq("the coin category claims its bite", r.byCategory.coins.allocation, 400);
  eq("...and everything unclaimed is coin too", r.coins, 1000);
  eq("no lines are produced", r.lines.length, 0);
}

console.log("\n── degenerate input ──");
{
  const rng = mulberry(43);
  eq("zero budget", rollHoard({ total: 0, categories: CATS, mix: mixOf(), pools: {}, rng }).coins, 0);
  eq("negative budget", rollHoard({ total: -5, categories: CATS, mix: mixOf(), pools: {}, rng }).coins, 0);
  eq("no categories", rollHoard({ total: 100, categories: [], mix: mixOf(), pools: {}, rng }).coins, 100);
  const noPool = rollHoard({ total: 100, categories: CATS, mix: mixOf(), pools: {}, rng });
  eq("categories with no pool are skipped entirely", noPool.lines.length, 0);
  eq("...and their budget becomes coin", noPool.coins, 100);
  eq("a missing mix does not throw",
     rollHoard({ total: 100, categories: CATS, mix: undefined, pools: {}, rng }).coins, 100);
}
{
  const r = rollHoard({
    total: 100000, categories: CATS,
    mix: mixOf({ value: [100, 100], categories: {
      coins: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
      gems: { enabled: true, chance: 10, itemWeightMin: 1, itemWeightMax: 1 },
      art: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
      gear: { enabled: false, chance: 0, itemWeightMin: 5, itemWeightMax: 5 },
    } }),
    pools: { gems: pool([1, 2, 3, 4, 5, 6, 7, 8]) }, rng: mulberry(47),
  });
  ok(`a cheap pool against a huge budget terminates (${r.lines.length} lines)`, r.lines.length <= 100);
  ok("...and the rest becomes coin", r.coins > 0);
}

console.log("\n── shuffle / pickNear ──");
{
  const rng = mulberry(53);
  const src = [1, 2, 3, 4, 5];
  const orders = new Set();
  for (let i = 0; i < 200; i++) orders.add(shuffle(src, rng).join(""));
  ok(`shuffle produces many orders (${orders.size})`, orders.size > 20);
  eq("shuffle preserves length", shuffle(src, rng).length, 5);
  eq("shuffle does not mutate the source", src.join(""), "12345");
}
{
  const rng = mulberry(59);
  const p = pool([10, 100, 1000]);
  eq("picks in-band when possible", pickNear(p, 100, 1000, rng).value, 100);
  eq("falls back to the nearest at or below", pickNear(p, 500, 1000, rng).value, 100);
  eq("falls back to the cheapest when all are dearer", pickNear(p, 1, 1000, rng).value, 10);
  eq("returns null when nothing is affordable", pickNear(p, 5, 5, rng), null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
