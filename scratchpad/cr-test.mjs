/* Exercises core/cr.mjs directly (DESIGN.md §13). No Foundry, no world — the module
 * falls back to its built-in XP ladder when pf1 is absent.
 *
 *   node scratchpad/cr-test.mjs
 */

import {
  TREASURE_BY_CR, MAX_TABLE_CR, PACE_KEYS,
  crToKey, crExceedsTable, treasureForCR, xpForCR, encounterCRFromXP, encounterCR, formatCR,
} from "../src/scripts/core/cr.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);

console.log("\n── table shape ──");
const keys = Object.keys(TREASURE_BY_CR).map(Number);
eq("35 rows (5 fractional + 30 integer)", keys.length, 35);
ok("every row has three columns", keys.every(k => TREASURE_BY_CR[k].length === 3));
ok("every row ascends slow < medium < fast",
   keys.every(k => { const [s, m, f] = TREASURE_BY_CR[k]; return s < m && m < f; }));
ok("each column ascends with CR", PACE_KEYS.every((_, col) => {
  const sorted = [...keys].sort((a, b) => a - b);
  return sorted.every((k, i) => i === 0 || TREASURE_BY_CR[k][col] > TREASURE_BY_CR[sorted[i - 1]][col]);
}));

console.log("\n── the fraction sentinels (§13.1) ──");
eq("1/8 sentinel 0.125", crToKey(0.125), 0.125);
eq("1/6 sentinel 0.1625 — NOT 1/6", crToKey(0.1625), 0.1625);
eq("1/3 sentinel 0.3375 — NOT 1/3", crToKey(0.3375), 0.3375);
eq("a hand-typed 0.1667 still finds the 1/6 row", crToKey(0.1667), 0.1625);
eq("a hand-typed 0.3333 still finds the 1/3 row", crToKey(0.3333), 0.3375);
eq("1/6 row is 30/45/65 gp", TREASURE_BY_CR[crToKey(0.1625)].join("/"), "30/45/65");
eq("CR 0 is below the table", crToKey(0), null);
eq("a negative CR is below the table", crToKey(-3), null);
eq("0.05 is below the table", crToKey(0.05), null);

console.log("\n── clamping ──");
eq("CR 31 clamps to the last row", crToKey(31), MAX_TABLE_CR);
ok("CR 31 is flagged as past the table", crExceedsTable(31));
ok("CR 30 is not flagged", !crExceedsTable(30));
eq("CR 7.4 rounds to 7", crToKey(7.4), 7);
eq("CR 7.5 rounds to 8", crToKey(7.5), 8);

console.log("\n── treasureForCR / pace aliases ──");
eq("CR 10 medium", treasureForCR(10, "medium"), 5450);
eq("CR 10 slow", treasureForCR(10, "slow"), 3650);
eq("CR 10 fast", treasureForCR(10, "fast"), 8200);
eq("'low' is an alias for slow", treasureForCR(10, "low"), 3650);
eq("'med' is an alias for medium", treasureForCR(10, "med"), 5450);
eq("'high' is an alias for fast", treasureForCR(10, "high"), 8200);
eq("pace defaults to medium", treasureForCR(10), 5450);
eq("an unknown pace falls back to medium", treasureForCR(10, "brisk"), 5450);
eq("CR 1/2 medium", treasureForCR(0.5, "medium"), 130);
eq("CR 30 fast", treasureForCR(30, "fast"), 630000);
eq("below the table yields 0", treasureForCR(0, "medium"), 0);

console.log("\n── XP ladder ──");
eq("CR 1 = 400 XP", xpForCR(1), 400);
eq("CR 5 = 1600 XP", xpForCR(5), 1600);
eq("CR 10 = 9600 XP", xpForCR(10), 9600);
eq("CR 1/8 = 50 XP (400 x CR)", xpForCR(0.125), 50);
eq("CR 1/2 = 200 XP", xpForCR(0.5), 200);
eq("CR 0 = 0 XP", xpForCR(0), 0);

console.log("\n── encounter CR from XP (§13.2) ──");
eq("one CR 5 stays CR 5", encounterCRFromXP(1600), 5);
eq("6 x CR 5 = 9600 XP = CR 10", encounterCRFromXP(6 * 1600), 10);
eq("XP between rows rounds DOWN to the lower row", encounterCRFromXP(9599), 9);
eq("2 x CR 1 = 800 XP = CR 3", encounterCRFromXP(800), 3);
eq("0 XP has no CR", encounterCRFromXP(0), null);
eq("49 XP is below the first row", encounterCRFromXP(49), null);
eq("50 XP is exactly CR 1/8", encounterCRFromXP(50), 0.125);
eq("more XP than CR 30 clamps to 30", encounterCRFromXP(99_999_999), 30);

console.log("\n── encounterCR (the group case) ──");
{
  const r = encounterCR([5, 5, 5, 5, 5, 5]);
  eq("six bandits: XP", r.totalXP, 9600);
  eq("six bandits: CR", r.cr, 10);
  eq("six bandits: medium budget", treasureForCR(r.cr, "medium"), 5450);
  ok("group budget is far below six solo budgets",
     treasureForCR(r.cr, "medium") < 6 * treasureForCR(5, "medium"),
     `${treasureForCR(r.cr, "medium")} vs ${6 * treasureForCR(5, "medium")}`);
}
{
  const r = encounterCR([8, 5, 5, 2, 2, 0.5]);
  eq("mixed group: XP", r.totalXP, 4800 + 1600 + 1600 + 600 + 600 + 200);
  eq("mixed group: CR", r.cr, 9);
}
eq("an empty encounter has no CR", encounterCR([]).cr, null);
eq("an empty encounter has 0 XP", encounterCR([]).totalXP, 0);
eq("CR 0 members contribute nothing", encounterCR([0, 0, 0]).cr, null);
{
  const withZeroes = encounterCR([5, 0, 0]);
  eq("CR 0 members do not change a real CR", withZeroes.cr, 5);
}

console.log("\n── formatCR ──");
eq("0.1625 prints as 1/6", formatCR(0.1625), "1/6");
eq("0.5 prints as 1/2", formatCR(0.5), "1/2");
eq("12 prints as 12", formatCR(12), "12");
eq("null prints as a dash", formatCR(null), "—");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
