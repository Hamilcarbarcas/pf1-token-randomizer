/* Exercises encounter/distribute.mjs (DESIGN.md §17.2, §17.3).
 *
 *   node scratchpad/distribute-test.mjs
 */

import {
  distributeLines, crWeights, poolToCp, cpToCoins, largestDenomination, splitCurrency,
  totalOfSplit, denominationCounts, blendWeights,
} from "../src/scripts/encounter/distribute.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lines = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, value: 10 }));
const counts = (assignment) => {
  const c = {};
  for (const t of Object.values(assignment)) c[t] = (c[t] ?? 0) + 1;
  return c;
};

console.log("\n── distributeLines: even ──");
{
  const a = distributeLines(lines(6), ["t1", "t2", "t3"], "even");
  eq("every line is placed", Object.keys(a).length, 6);
  const c = counts(a);
  ok("round-robin splits evenly", c.t1 === 2 && c.t2 === 2 && c.t3 === 2, JSON.stringify(c));
  const b = distributeLines(lines(6), ["t1", "t2", "t3"], "even");
  ok("even is reproducible", JSON.stringify(a) === JSON.stringify(b));
}
{
  const c = counts(distributeLines(lines(7), ["t1", "t2", "t3"], "even"));
  ok("an uneven count spreads the remainder", c.t1 === 3 && c.t2 === 2 && c.t3 === 2, JSON.stringify(c));
}

console.log("\n── distributeLines: all / random / byCR ──");
{
  const a = distributeLines(lines(4), ["t1", "t2"], "all", { target: "t2" });
  ok("all-to-one places everything on the target", Object.values(a).every(v => v === "t2"));
  eq("all-to-one with no target places nothing", Object.keys(
    distributeLines(lines(4), ["t1"], "all", {})).length, 0);
}
{
  const rng = mulberry(4);
  const a = distributeLines(lines(200), ["t1", "t2"], "random", { rng });
  eq("random places every line", Object.keys(a).length, 200);
  const c = counts(a);
  ok(`random spreads across both targets (${c.t1}/${c.t2})`, c.t1 > 50 && c.t2 > 50);
}
{
  const rng = mulberry(6);
  const members = [{ tokenUuid: "boss", cr: 10 }, { tokenUuid: "mook", cr: 1 }];
  const w = crWeights(members);
  eq("CR weights are XP", w.boss, 9600);
  eq("...for each member", w.mook, 400);
  const c = counts(distributeLines(lines(400), ["boss", "mook"], "byCR", { rng, weights: w }));
  ok(`byCR favours the higher-CR target (${c.boss}/${c.mook})`, c.boss > c.mook * 5);
}
{
  const rng = mulberry(8);
  const w = crWeights([{ tokenUuid: "a", cr: 0 }, { tokenUuid: "b", cr: 0 }]);
  const a = distributeLines(lines(20), ["a", "b"], "byCR", { rng, weights: w });
  eq("all-zero CR weights still place every line", Object.keys(a).length, 20);
}
{
  const members = [{ tokenUuid: "t1", cr: 5 }, { tokenUuid: "t1", cr: 5 }, { actorUuid: "a1", cr: 2 }];
  const w = crWeights(members);
  eq("duplicate targets accumulate weight", w.t1, 3200);
  eq("a member with no token falls back to its actor", w.a1, 600);
  eq("a member with neither is skipped", Object.keys(crWeights([{ cr: 5 }])).length, 0);
}

console.log("\n── distributeLines: degenerate ──");
{
  eq("no lines places nothing", Object.keys(distributeLines([], ["t1"], "even")).length, 0);
  eq("no targets places nothing", Object.keys(distributeLines(lines(3), [], "even")).length, 0);
  eq("null input is safe", Object.keys(distributeLines(null, null, "even")).length, 0);
}

console.log("\n── coin conversion ──");
{
  eq("pool to copper", poolToCp({ pp: 1, gp: 2, sp: 3, cp: 4 }), 1000 + 200 + 30 + 4);
  eq("an empty pool is 0 cp", poolToCp({}), 0);
  eq("negative counts are ignored", poolToCp({ gp: -5 }), 0);
  eq("largest denomination of a gp pool", largestDenomination({ gp: 10, sp: 5 }), "gp");
  eq("largest denomination with platinum", largestDenomination({ pp: 1, gp: 10 }), "pp");
  eq("an empty pool reports cp", largestDenomination({}), "cp");
}
{
  const c = cpToCoins(3425, "gp");
  ok("3425 cp capped at gp is 34 gp 2 sp 5 cp",
     c.pp === 0 && c.gp === 34 && c.sp === 2 && c.cp === 5, JSON.stringify(c));
  const p = cpToCoins(3425, "pp");
  ok("the same capped at pp uses platinum", p.pp === 3 && p.gp === 4, JSON.stringify(p));
}

console.log("\n── denominationCounts: weights are COUNTS, not value ──");
{
  const even = { pp: 25, gp: 25, sp: 25, cp: 25 };
  const c = denominationCounts(10000, even);
  ok("100 gp with equal weights is 9/9/9/10",
     c.pp === 9 && c.gp === 9 && c.sp === 9 && c.cp === 10, JSON.stringify(c));
  eq("...and is exact", poolToCp(c), 10000);
  ok("counts are near-equal, so this is not a value split",
     Math.max(c.pp, c.gp, c.sp, c.cp) - Math.min(c.pp, c.gp, c.sp, c.cp) <= 1);
  // A value-based split would have given 25 gp of each: 2 pp and 2500 cp.
  ok("a value split would have looked nothing like this", c.cp < 100 && c.pp < 20);
}
{
  for (const [label, w, cp] of [
    ["gold only", { pp: 0, gp: 1, sp: 0, cp: 0 }, 10000],
    ["copper only", { pp: 0, gp: 0, sp: 0, cp: 1 }, 10000],
    ["no platinum", { pp: 0, gp: 40, sp: 30, cp: 30 }, 10000],
    ["awkward total", { pp: 5, gp: 40, sp: 30, cp: 25 }, 54321],
    ["one copper", { pp: 5, gp: 40, sp: 30, cp: 25 }, 1],
    ["huge", { pp: 25, gp: 25, sp: 25, cp: 25 }, 12345678],
  ]) {
    eq(`${label}: exact to the copper`, poolToCp(denominationCounts(cp, w)), cp);
  }
  const noPp = denominationCounts(10000, { pp: 0, gp: 40, sp: 30, cp: 30 });
  eq("a zero-weighted denomination is never produced", noPp.pp, 0);
  const gold = denominationCounts(10000, { pp: 0, gp: 1, sp: 0, cp: 0 });
  ok("gold-only puts everything in gold", gold.gp === 100 && gold.sp === 0 && gold.cp === 0);
}
{
  eq("zero value yields no coins", poolToCp(denominationCounts(0, { gp: 1 })), 0);
  eq("negative value yields no coins", poolToCp(denominationCounts(-50, { gp: 1 })), 0);
  const fallback = denominationCounts(10000, { pp: 0, gp: 0, sp: 0, cp: 0 });
  eq("all-zero weights fall back to gold", fallback.gp, 100);
  eq("null weights are safe", poolToCp(denominationCounts(500, null)), 500);
}
{
  const rng = mulberry(77);
  const w = { pp: 25, gp: 25, sp: 25, cp: 25 };
  let drifted = 0;
  const shapes = new Set();
  for (let i = 0; i < 200; i++) {
    const c = denominationCounts(10000, w, { randomness: 1, rng });
    if (poolToCp(c) !== 10000) drifted++;
    shapes.add(JSON.stringify(c));
  }
  eq("randomness never breaks the total", drifted, 0);
  ok(`randomness 1 produces varied mixes (${shapes.size} distinct)`, shapes.size > 20);
  const fixed = new Set();
  for (let i = 0; i < 20; i++) fixed.add(JSON.stringify(denominationCounts(10000, w, { randomness: 0, rng })));
  eq("randomness 0 is deterministic", fixed.size, 1);
}
{
  const rng = mulberry(5);
  const w = { pp: 0, gp: 50, sp: 50, cp: 0 };
  let leaked = 0;
  for (let i = 0; i < 200; i++) {
    const c = denominationCounts(10000, w, { randomness: 1, rng });
    // cp may appear as change for a remainder, but platinum must never be invented.
    if (c.pp > 0) leaked++;
  }
  eq("a weighted-out denomination stays out at full randomness", leaked, 0);
}

console.log("\n── blendWeights ──");
{
  const rng = mulberry(3);
  const base = [1, 1, 1, 1];
  const at0 = blendWeights(base, 0, rng);
  ok("randomness 0 returns the base proportions", at0.every(v => Math.abs(v - 0.25) < 1e-9));
  const at1 = blendWeights(base, 1, rng);
  ok("randomness 1 departs from them", at1.some(v => Math.abs(v - 0.25) > 0.02));
  ok("blended weights still sum to 1", Math.abs(at1.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const zeroed = blendWeights([1, 0, 1, 0], 1, rng);
  ok("a zero base weight stays zero at full randomness", zeroed[1] === 0 && zeroed[3] === 0);
  eq("all-zero base yields all zero", blendWeights([0, 0], 1, rng).every(v => v === 0), true);
}

console.log("\n── splitCurrency: the randomness slider ──");
{
  const pool = { gp: 1000 };
  const rng = mulberry(9);
  const even = splitCurrency(pool, ["a", "b", "c", "d"], "even", { randomness: 0, rng });
  const shares = Object.values(even).map(poolToCp);
  ok("randomness 0 splits as evenly as the integers allow",
     Math.max(...shares) - Math.min(...shares) <= 1, JSON.stringify(shares));
  eq("...and remains exact", totalOfSplit(even), 100000);
}
{
  const rng = mulberry(11);
  let spread = 0;
  for (let i = 0; i < 100; i++) {
    const s = splitCurrency({ gp: 1000 }, ["a", "b", "c", "d"], "even", { randomness: 1, rng });
    const v = Object.values(s).map(poolToCp);
    spread += Math.max(...v) - Math.min(...v);
    if (totalOfSplit(s) !== 100000) { ok("exactness at randomness 1", false); break; }
  }
  ok(`randomness 1 makes an even split uneven (avg spread ${Math.round(spread / 100)} cp)`,
     spread / 100 > 1000);
}
{
  const rng = mulberry(13);
  const w = { boss: 9600, mook: 400 };
  const strict = splitCurrency({ gp: 1000 }, ["boss", "mook"], "byCR", { weights: w, randomness: 0, rng });
  const ratio = poolToCp(strict.boss) / poolToCp(strict.mook);
  ok(`randomness 0 tracks the CR ratio closely (${ratio.toFixed(1)}x, want 24x)`,
     ratio > 20 && ratio < 28);
  eq("byCR at randomness 0 is still exact", totalOfSplit(strict), 100000);
}
{
  const rng = mulberry(17);
  const s = splitCurrency({ pp: 2, gp: 5, sp: 7, cp: 3 }, ["a", "b"], "even",
                          { denomWeights: { pp: 0, gp: 50, sp: 30, cp: 20 }, rng });
  eq("denomWeights re-break each share and stay exact", totalOfSplit(s), 2 * 1000 + 5 * 100 + 7 * 10 + 3);
  ok("...honouring the zero-weighted denomination",
     Object.values(s).every(c => c.pp === 0), JSON.stringify(s));
}

console.log("\n── splitCurrency: nothing is created or lost ──");
{
  const pool = { pp: 0, gp: 137, sp: 0, cp: 0 };
  const s = splitCurrency(pool, ["t1", "t2", "t3", "t4"], "even");
  eq("the split adds back up to the pool", totalOfSplit(s), poolToCp(pool));
  const one = s.t1;
  ok("137 gp four ways is 34 gp 2 sp 5 cp each",
     one.gp === 34 && one.sp === 2 && one.cp === 5, JSON.stringify(one));
  ok("no platinum appears from a gp-only pool",
     Object.values(s).every(c => c.pp === 0));
}
{
  // The remainder rule: 1 gp left over must reach someone, as silver and copper.
  const pool = { gp: 10 };
  const s = splitCurrency(pool, ["a", "b", "c"], "even");
  eq("10 gp three ways still totals 1000 cp", totalOfSplit(s), 1000);
  ok("each gets 3 gp 3 sp 3 cp, one gets an extra copper",
     Object.values(s).every(c => c.gp === 3 && c.sp === 3),
     JSON.stringify(s));
  eq("the extra copper is handed out", Object.values(s).filter(c => c.cp === 4).length, 1);
}
{
  const pool = { pp: 2, gp: 5, sp: 7, cp: 3 };
  for (const mode of ["even", "random", "byCR"]) {
    const rng = mulberry(21);
    const s = splitCurrency(pool, ["a", "b", "c"], mode, { rng, weights: { a: 3, b: 2, c: 1 } });
    eq(`${mode}: exact, no copper created or lost`, totalOfSplit(s), poolToCp(pool));
  }
}
{
  const pool = { cp: 2 };
  const s = splitCurrency(pool, ["a", "b", "c", "d"], "even");
  eq("fewer coins than targets still totals correctly", totalOfSplit(s), 2);
  eq("...leaving some targets empty", Object.values(s).filter(c => c.cp === 0).length, 2);
}

console.log("\n── splitCurrency: modes ──");
{
  const rng = mulberry(12);
  const s = splitCurrency({ gp: 1000 }, ["a", "b"], "byCR", { rng, weights: { a: 9600, b: 400 } });
  ok(`byCR follows the weights (${s.a.gp} / ${s.b.gp} gp)`, s.a.gp > s.b.gp * 5);
  eq("byCR is still exact", totalOfSplit(s), 100000);
}
{
  // The reason random is a partition rather than N independent rolls.
  const rng = mulberry(15);
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const s = splitCurrency({ gp: 1000 }, ["a", "b", "c", "d"], "random", { rng });
    const shares = Object.values(s).map(c => poolToCp(c) / 100000);
    worst = Math.max(worst, Math.max(...shares));
  }
  ok(`random never hands one target nearly everything (worst share ${(worst * 100).toFixed(1)}%)`,
     worst < 0.95);
}
{
  const s = splitCurrency({ gp: 100 }, ["a", "b"], "byCR", { weights: { a: 0, b: 0 } });
  eq("all-zero weights fall back to an even split", totalOfSplit(s), 10000);
  ok("...evenly", s.a.gp === 50 && s.b.gp === 50, JSON.stringify(s));
}

console.log("\n── splitCurrency: degenerate ──");
{
  eq("no targets yields nothing", Object.keys(splitCurrency({ gp: 10 }, [], "even")).length, 0);
  const empty = splitCurrency({}, ["a", "b"], "even");
  eq("an empty pool still returns a zeroed entry per target", Object.keys(empty).length, 2);
  eq("...totalling nothing", totalOfSplit(empty), 0);
  eq("a null pool is safe", totalOfSplit(splitCurrency(null, ["a"], "even")), 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
