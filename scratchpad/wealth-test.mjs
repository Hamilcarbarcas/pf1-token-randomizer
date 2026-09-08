/* Exercises encounter/wealth.mjs (DESIGN.md §14) against stub actors whose items
 * implement just enough of the PF1 item API: isPhysical, type, subType, inContainer,
 * getValue, getTotalCurrency, items.
 *
 *   node scratchpad/wealth-test.mjs
 */

import {
  WEALTH_PARTS, encounterCarriedValue, sumCarriedValue, treasureShortfall,
} from "../src/scripts/encounter/wealth.mjs";

globalThis.pf1 = { config: { currency: { standardRate: 100 } } };

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);

// gp -> cp, matching inLowestDenomination
const cp = (gp) => gp * 100;

/** A physical item. `gp` is its full stack value. */
function item({ name = "thing", type = "equipment", subType = null, gp = 0,
                equipped = false, contents = null, currency = 0 } = {}) {
  const it = {
    name, type, subType, isPhysical: true, inContainer: false,
    system: { equipped },
    getValue: () => cp(gp),
    getTotalCurrency: () => cp(currency),
  };
  if (type === "container") {
    it.items = contents ?? [];
    for (const c of it.items) c.inContainer = true;
  }
  return it;
}

/** A non-physical item — feats, attacks, spells. Must never be valued. */
const nonPhysical = (name) => ({ name, type: "feat", isPhysical: false, inContainer: false, system: {} });

const actor = (items, currencyGp = 0) => ({
  name: "stub",
  items,
  getTotalCurrency: () => cp(currencyGp),
});

console.log("\n── buckets ──");
{
  const a = actor([
    item({ name: "chain shirt", gp: 250, equipped: true }),
    item({ name: "spare sword", type: "weapon", gp: 300 }),
    item({ name: "potion", type: "consumable", gp: 50 }),
    item({ name: "arrows", type: "loot", subType: "ammo", gp: 10 }),
  ], 40);
  const r = encounterCarriedValue(a);
  eq("equipped gear", r.parts.equippedGear, 250);
  eq("carried gear", r.parts.carriedGear, 300);
  eq("consumables", r.parts.consumables, 50);
  eq("ammunition", r.parts.ammo, 10);
  eq("coins", r.parts.coins, 40);
  eq("total with everything on", r.gp, 650);
  eq("items visited", r.items, 4);
  eq("partsCp keeps the exact copper", r.partsCp.equippedGear, cp(250));
  eq("cp total is the exact integer", r.cp, cp(650));
  ok("every bucket is reported in gp",
     WEALTH_PARTS.every(k => r.parts[k] === r.partsCp[k] / 100));
}

console.log("\n── sub-gp values survive the gp conversion ──");
{
  // Copper given directly, as PF1's inLowestDenomination returns it — summing these in
  // gp would drift, which is why the module sums copper and converts once at the end.
  const raw = (name, cpValue) => {
    const it = item({ name, type: "loot", subType: "gear" });
    it.getValue = () => cpValue;
    return it;
  };
  const a = actor(Array.from({ length: 10 }, (_, i) => raw(`trinket ${i}`, 7)));
  a.getTotalCurrency = () => 0;
  const r = encounterCarriedValue(a);
  eq("ten 7 cp items total 70 cp exactly", r.cp, 70);
  eq("...and 0.7 gp", r.gp, 0.7);
  ok("adding the same values as gp would have drifted",
     Array(10).fill(0.07).reduce((s, v) => s + v, 0) !== 0.7);
}

console.log("\n── non-physical items are never valued (§14.2) ──");
{
  const a = actor([
    nonPhysical("Power Attack"),
    nonPhysical("Bite"),
    item({ name: "dagger", type: "weapon", gp: 2 }),
  ]);
  const r = encounterCarriedValue(a);
  eq("only the physical item is visited", r.items, 1);
  eq("total is just the dagger", r.gp, 2);
}

console.log("\n── the three toggles (§14.2) ──");
{
  const a = actor([
    item({ name: "plate", gp: 1500, equipped: true }),
    item({ name: "rope", type: "loot", subType: "gear", gp: 1 }),
    item({ name: "potion", type: "consumable", gp: 50 }),
    item({ name: "bolts", type: "loot", subType: "ammo", gp: 10 }),
  ], 100);
  eq("all on", encounterCarriedValue(a).gp, 1661);
  eq("equipped off drops worn gear", encounterCarriedValue(a, { equipped: false }).gp, 161);
  eq("coins off drops currency", encounterCarriedValue(a, { coins: false }).gp, 1561);
  eq("consumables off drops potions AND ammo",
     encounterCarriedValue(a, { consumables: false }).gp, 1601);
  eq("all three off leaves only loose gear",
     encounterCarriedValue(a, { equipped: false, coins: false, consumables: false }).gp, 1);
  ok("parts are reported whether counted or not",
     encounterCarriedValue(a, { equipped: false }).parts.equippedGear === 1500);
  ok("counted flags mirror the toggles", (() => {
    const c = encounterCarriedValue(a, { consumables: false }).counted;
    return c.consumables === false && c.ammo === false && c.carriedGear === true;
  })());
}

console.log("\n── containers ──");
{
  const a = actor([
    item({
      name: "backpack", type: "container", gp: 2, currency: 25,
      contents: [
        item({ name: "packed potion", type: "consumable", gp: 50 }),
        item({ name: "packed statuette", type: "loot", subType: "treasure", gp: 200 }),
      ],
    }),
  ], 10);
  const r = encounterCarriedValue(a);
  eq("container's own price counts as carried gear", r.parts.carriedGear, 2 + 200);
  eq("packed consumable lands in the consumables bucket", r.parts.consumables, 50);
  eq("container currency joins actor currency", r.parts.coins, 25 + 10);
  eq("everything totals once", r.gp, 287);
  eq("contained items are visited", r.items, 3);

  // The whole reason for walking manually instead of getValue({recursive:true}):
  eq("a toggle reaches INSIDE a container",
     encounterCarriedValue(a, { consumables: false }).gp, 237);
}
{
  const inner = item({ name: "pouch", type: "container", gp: 1, currency: 5,
                       contents: [item({ name: "gem", type: "loot", subType: "treasure", gp: 100 })] });
  const a = actor([item({ name: "chest", type: "container", gp: 10, contents: [inner] })]);
  const r = encounterCarriedValue(a);
  eq("nested containers recurse", r.gp, 116);
  eq("nested container currency is found", r.parts.coins, 5);
}
{
  const packed = item({ name: "packed armour", gp: 400, equipped: true });
  const a = actor([item({ name: "sack", type: "container", gp: 1, contents: [packed] })]);
  const r = encounterCarriedValue(a);
  eq("an equipped-flagged item inside a bag is carried, not worn", r.parts.equippedGear, 0);
  eq("...and lands in carried gear instead", r.parts.carriedGear, 401);
}

console.log("\n── degenerate input ──");
{
  const r = encounterCarriedValue(null);
  eq("null actor totals 0", r.gp, 0);
  ok("null actor still returns every bucket", WEALTH_PARTS.every(k => r.parts[k] === 0));
  eq("actor with no items totals 0", encounterCarriedValue(actor([])).gp, 0);
}
{
  const bad = item({ name: "cursed", gp: 5 });
  bad.getValue = () => { throw new Error("boom"); };
  const a = actor([bad, item({ name: "ok", gp: 7 })]);
  console.log("    (one console error below is expected)");
  eq("an item that throws is skipped, not fatal", encounterCarriedValue(a).gp, 7);
}

console.log("\n── sumCarriedValue ──");
{
  const a1 = actor([item({ name: "sword", type: "weapon", gp: 100, equipped: true })], 10);
  const a2 = actor([item({ name: "shield", gp: 50, equipped: true })], 5);
  const r = sumCarriedValue([a1, a2]);
  eq("summed total", r.gp, 165);
  eq("summed buckets", r.parts.equippedGear, 150);
  eq("summed coins", r.parts.coins, 15);
  eq("summed item count", r.items, 2);
  eq("toggles apply across the group", sumCarriedValue([a1, a2], { coins: false }).gp, 150);
  eq("an empty encounter sums to 0", sumCarriedValue([]).gp, 0);
}

console.log("\n── treasureShortfall (§14.3) ──");
{
  const r = treasureShortfall(5450, 1890);
  eq("to generate", r.toGenerate, 3560);
  eq("not over-funded", r.overFunded, 0);
}
{
  const r = treasureShortfall(1000, 2500);
  eq("over-funded reports 0 to generate", r.toGenerate, 0);
  eq("...and the surplus separately", r.overFunded, 1500);
}
eq("a zero budget is not negative", treasureShortfall(0, 500).toGenerate, 0);
eq("garbage input clamps to 0", treasureShortfall(NaN, undefined).toGenerate, 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
