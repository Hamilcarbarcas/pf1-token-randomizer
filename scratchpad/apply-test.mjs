/* Exercises §18 Apply/Undo planning and §17.4 equip arithmetic against stub actors.
 *
 *   node scratchpad/apply-test.mjs
 */

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);

globalThis.game = { user: { id: "u1" }, i18n: { localize: s => s, format: (s, o) => s + JSON.stringify(o) } };
globalThis.pf1 = { config: { currency: { standardRate: 100 } } };

const { linesByTarget, coinsByTarget, applyPlan, pruneMissingTargets } =
  await import("../src/scripts/encounter/apply.mjs");
const { reallocateCoin, totalOfSplit, poolToCp } =
  await import("../src/scripts/encounter/distribute.mjs");
const { equipPlanFor, slotOf, capacityOf, isEquippable } =
  await import("../src/scripts/encounter/equip.mjs");

const line = (o = {}) => ({
  id: "l1", uuid: "Compendium.a.b.Item.x", name: "thing", value: 100, qty: 1,
  // equip null = defer to the world setting; a boolean is an explicit override.
  locked: false, pinned: false, origin: "rolled", equip: null, ...o,
});

console.log("\n── what Apply would write ──");
{
  const record = {
    id: "enc-1",
    lines: [line({ id: "l1" }), line({ id: "l2", qty: 3 }), line({ id: "l3" })],
    assignment: { l1: "t1", l2: "t2" },          // l3 left in the tray
    currency: { split: { t1: { pp: 0, gp: 5, sp: 0, cp: 0 }, t3: { pp: 0, gp: 0, sp: 0, cp: 0 } } },
  };
  const byTarget = linesByTarget(record);
  eq("only assigned lines are written", byTarget.size, 2);
  eq("...and the tray line is not among them", byTarget.has("t3"), false);

  const coins = coinsByTarget(record);
  eq("a zero coin split is not a write", coins.size, 1);
  ok("...only the target actually owed coin", coins.has("t1"));

  const p = applyPlan(record);
  eq("targets touched", p.targets, 2);
  eq("item count counts quantity", p.itemCount, 4);
  eq("coin targets", p.coinTargets, 1);
  eq("the tray is reported, not written", p.unassignedCount, 1);
  eq("...with its value", p.unassignedValue, 100);
}
{
  const p = applyPlan({ lines: [], assignment: {}, currency: { split: {} } });
  eq("an empty encounter plans nothing", p.targets, 0);
  eq("...and reports nothing unassigned", p.unassignedCount, 0);
  eq("a null record is safe", applyPlan(null).targets, 0);
}

console.log("\n── a target that has gone away (§18.4) ──");
{
  const record = {
    id: "enc-1",
    lines: [{ id: "l1", qty: 1, value: 10 }, { id: "l2", qty: 1, value: 10 }, { id: "l3", qty: 1, value: 10 }],
    assignment: { l1: "alive", l2: "dead", l3: "dead" },
    currency: {
      denomWeights: { pp: 0, gp: 100, sp: 0, cp: 0 },
      split: {
        alive: { pp: 0, gp: 30, sp: 0, cp: 0 },
        dead: { pp: 0, gp: 70, sp: 0, cp: 0 },
      },
    },
  };
  const before = totalOfSplit(record.currency.split);
  const { record: fixed, returned, coinMoved } =
    pruneMissingTargets(record, ["dead"], record.currency.denomWeights);
  eq("items on the dead target are returned to the tray", returned, 2);
  eq("...and are genuinely unassigned", Object.keys(fixed.assignment).length, 1);
  eq("the surviving assignment is untouched", fixed.assignment.l1, "alive");
  eq("the dead target holds no coin", fixed.currency.split.dead, undefined);
  eq("no copper is created or lost", totalOfSplit(fixed.currency.split), before);
  eq("the orphaned coin is reported", coinMoved, 7000);
  eq("...and all of it reaches the only survivor", poolToCp(fixed.currency.split.alive), 10000);
}
{
  // Proportional, so a tuned split keeps its shape rather than being re-rolled.
  const split = {
    a: { pp: 0, gp: 60, sp: 0, cp: 0 },
    b: { pp: 0, gp: 20, sp: 0, cp: 0 },
    gone: { pp: 0, gp: 40, sp: 0, cp: 0 },
  };
  const { split: out } = reallocateCoin(split, ["gone"], { pp: 0, gp: 1, sp: 1, cp: 1 });
  eq("total preserved", totalOfSplit(out), 12000);
  const a = poolToCp(out.a), b = poolToCp(out.b);
  ok(`the 3:1 ratio survives (${a}:${b})`, Math.abs((a / b) - 3) < 0.1);
}
{
  // Survivors holding nothing get an even share — proportions of zero say nothing.
  const { split: out } = reallocateCoin(
    { a: { cp: 0 }, b: { cp: 0 }, gone: { pp: 0, gp: 10, sp: 0, cp: 0 } }, ["gone"]);
  eq("total preserved when survivors held nothing", totalOfSplit(out), 1000);
  eq("...split evenly", poolToCp(out.a), poolToCp(out.b));
}
{
  const { split: out, moved } = reallocateCoin({ gone: { pp: 0, gp: 5, sp: 0, cp: 0 } }, ["gone"]);
  eq("with no survivors the coin is simply unsplit", Object.keys(out).length, 0);
  eq("...and the amount is reported", moved, 500);
  eq("nothing missing changes nothing", totalOfSplit(reallocateCoin({ a: { gp: 3 } }, []).split), 300);
  eq("an empty split is safe", Object.keys(reallocateCoin({}, ["x"]).split).length, 0);
}

console.log("\n── equip: what is equippable at all ──");
{
  ok("weapons, equipment, armor and shields are", ["weapon", "equipment", "armor", "shield"]
     .every(t => isEquippable({ type: t })));
  ok("loot and consumables are not", !isEquippable({ type: "loot" }) && !isEquippable({ type: "consumable" }));
  eq("a weapon competes for no slot", slotOf({ type: "weapon", system: { slot: "armor" } }), null);
  eq("armour competes for its slot", slotOf({ type: "equipment", system: { slot: "armor" } }), "armor");
  eq("rings hold two", capacityOf("ring"), 2);
  eq("slotless is unlimited", capacityOf("slotless"), Infinity);
  eq("anything else holds one", capacityOf("chest"), 1);
}

const actorWith = (items) => ({
  name: "stub",
  items: items.map((it, i) => ({ id: it.id ?? `old${i}`, type: it.type ?? "equipment",
                                 system: { slot: it.slot, equipped: it.equipped !== false } })),
});
const made = (id, slot, type = "equipment") => ({ id, type, system: { slot } });

console.log("\n── equip: displacement ──");
{
  const actor = actorWith([{ id: "worn", slot: "armor" }]);
  const plan = equipPlanFor(actor, [made("new", "armor")], [line()], true);
  const off = plan.find(u => u._id === "worn");
  const on = plan.find(u => u._id === "new");
  ok("the incumbent is unequipped", off && off["system.equipped"] === false);
  ok("...not deleted (it is an update, not a removal)", Object.keys(off).length === 2);
  ok("the new item is equipped", on && on["system.equipped"] === true);
}
{
  // Two rings is legal; the third displaces.
  const two = actorWith([{ id: "r1", slot: "ring" }, { id: "r2", slot: "ring" }]);
  const plan = equipPlanFor(two, [made("r3", "ring")], [line()], true);
  eq("a third ring displaces exactly one", plan.filter(u => u["system.equipped"] === false).length, 1);
  eq("...the first in item order", plan.find(u => u["system.equipped"] === false)._id, "r1");

  const one = actorWith([{ id: "r1", slot: "ring" }]);
  const plan2 = equipPlanFor(one, [made("r2", "ring")], [line()], true);
  eq("a second ring displaces nothing", plan2.filter(u => u["system.equipped"] === false).length, 0);
}
{
  const actor = actorWith([{ id: "sword", slot: null, type: "weapon" }]);
  const plan = equipPlanFor(actor, [made("axe", null, "weapon")], [line()], true);
  eq("a weapon displaces nothing", plan.filter(u => u["system.equipped"] === false).length, 0);
  ok("...but is still equipped", plan.some(u => u._id === "axe" && u["system.equipped"] === true));
}
{
  const actor = actorWith([{ id: "ring", slot: "slotless" }, { id: "ring2", slot: "slotless" }]);
  const plan = equipPlanFor(actor, [made("x", "slotless")], [line()], true);
  eq("slotless never displaces", plan.filter(u => u["system.equipped"] === false).length, 0);
}
{
  // An unequipped incumbent does not occupy the slot.
  const actor = actorWith([{ id: "spare", slot: "armor", equipped: false }]);
  const plan = equipPlanFor(actor, [made("new", "armor")], [line()], true);
  eq("an unworn item is not displaced", plan.filter(u => u["system.equipped"] === false).length, 0);
}

console.log("\n── equip: the setting and the per-line override ──");
{
  const actor = actorWith([]);
  eq("the default off equips nothing",
     equipPlanFor(actor, [made("a", "armor")], [line()], false).length, 0);
  eq("a line opting IN overrides the default off",
     equipPlanFor(actor, [made("a", "armor")], [line({ equip: true })], false).length, 1);
  eq("a line opting OUT overrides the default on",
     equipPlanFor(actor, [made("a", "armor")], [line({ equip: false })], true).length, 0);
  eq("the default on equips a line with no preference",
     equipPlanFor(actor, [made("a", "armor")], [line()], true).length, 1);
  eq("non-equippable loot is never equipped",
     equipPlanFor(actor, [{ id: "gem", type: "loot", system: {} }], [line()], true).length, 0);
}
{
  // Two new items competing for one slot within a single batch.
  const actor = actorWith([]);
  const plan = equipPlanFor(actor, [made("a", "chest"), made("b", "chest")], [line(), line()], true);
  const off = plan.filter(u => u["system.equipped"] === false);
  eq("the first is displaced by the second", off.length, 1);
  eq("...and it is the earlier one", off[0]._id, "a");
  ok("the later one ends up worn",
     plan.some(u => u._id === "b" && u["system.equipped"] === true));
}
{
  eq("no created items means no plan", equipPlanFor(actorWith([]), [], [], true).length, 0);
}

console.log("\n── Item Piles interop (§19.4) ──");
{
  globalThis.game.modules = { get: () => ({ active: false }) };
  const { itemPilesActive } = await import("../src/scripts/encounter/piles.mjs");
  eq("Item Piles absent is reported, not assumed", itemPilesActive(), false);
  // Containers were removed (§19.4): a loot pile is just a token added as a member,
  // so there is no pile-specific target type left to test.
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
