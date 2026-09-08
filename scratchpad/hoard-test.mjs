/* Exercises §15: treasure sources, candidate filtering and the shipped defaults.
 * No Foundry, no compendium — index entries are stubs. The §16 roller that spends
 * against these pools has its own suite in rollmix-test.mjs.
 *
 *   node scratchpad/hoard-test.mjs
 */

import { candidatesFromIndex, normalizeSource, parseSourceUuid, folderIdsFor, coinSinkCategory }
  from "../src/scripts/encounter/sources.mjs";


let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);
const near = (name, got, want, tol = 1e-6) =>
  ok(name, Math.abs(got - want) <= tol, `got ${got}, want ~${want}`);

console.log("\n── shipped defaults are reachable (§15.1) ──");
{
  // Regression: both settings default to [], which is an array — so an Array.isArray
  // test alone returns the empty setting forever and no category ever has a source.
  let stored = [];
  globalThis.game = { settings: { get: () => stored }, i18n: { has: () => false } };
  const { getTreasureCategories, getTreasureSources } =
    await import("../src/scripts/encounter/sources.mjs");

  ok("an empty setting falls back to the shipped categories", getTreasureCategories().length > 0);
  ok("an empty setting falls back to the shipped sources", getTreasureSources().length > 0);
  const cats = getTreasureCategories();
  const srcs = getTreasureSources();
  const gear = cats.find(c => c.id === "cat-gear");
  ok("Mundane Gear has at least one source", srcs.some(s => s.categoryId === gear.id));
  ok("every shipped source names a real category",
     srcs.every(s => cats.some(c => c.id === s.categoryId)));
  ok("exactly one category is the coin sink", cats.filter(c => c.isCoinSink).length === 1);

  stored = [{ id: "src-custom", uuid: "Compendium.a.b", categoryId: "cat-gems", weight: 7 }];
  const custom = getTreasureSources();
  eq("a non-empty setting is used as-is", custom.length, 1);
  eq("...with its own values", custom[0].weight, 7);
}

console.log("\n── source uuid parsing (§15.2) ──");
{
  eq("bare pack", parseSourceUuid("Compendium.pf1.items").packId, "pf1.items");
  eq("bare pack has no folder", parseSourceUuid("Compendium.pf1.items").folderId, null);
  const f = parseSourceUuid("Compendium.mod.treasure.Folder.abc123");
  eq("folder uuid: pack", f.packId, "mod.treasure");
  eq("folder uuid: folder", f.folderId, "abc123");
  eq("garbage uuid yields no pack", parseSourceUuid("nonsense").packId, null);
  eq("empty uuid yields no pack", parseSourceUuid("").packId, null);
}

console.log("\n── candidate filtering (§15.2) ──");
{
  const entries = [
    { _id: "a", name: "gem", type: "loot", system: { price: 100, subType: "treasure" } },
    { _id: "b", name: "cheap", type: "loot", system: { price: 5 } },
    { _id: "c", name: "dear", type: "loot", system: { price: 5000 } },
    { _id: "d", name: "priceless", type: "loot", system: {} },
    { _id: "e", name: "free", type: "loot", system: { price: 0 } },
    { _id: "f", name: "nan", type: "loot", system: { price: "lots" } },
  ];
  const src = normalizeSource({ id: "s1", uuid: "Compendium.m.p", categoryId: "gems" });
  const all = candidatesFromIndex(entries, src);
  eq("priceless / zero / NaN entries are dropped", all.length, 3);
  ok("no zero-value candidate survives", all.every(c => c.value > 0));
  eq("uuid is reconstructed from the pack and id", all[0].uuid, "Compendium.m.p.Item.a");

  const clamped = candidatesFromIndex(entries, normalizeSource(
    { id: "s1", uuid: "Compendium.m.p", categoryId: "gems", minValue: 10, maxValue: 1000 }));
  eq("min/max clamps filter the pool", clamped.length, 1);
  eq("...to the item inside the band", clamped[0].value, 100);

  const noMax = candidatesFromIndex(entries, normalizeSource(
    { id: "s1", uuid: "Compendium.m.p", categoryId: "gems", minValue: 10, maxValue: 0 }));
  eq("maxValue 0 means unbounded", noMax.length, 2);
}

console.log("\n── folder filtering ──");
{
  const entries = [
    { _id: "a", name: "in", type: "loot", system: { price: 10 }, folder: "f1" },
    { _id: "b", name: "sub", type: "loot", system: { price: 20 }, folder: "f2" },
    { _id: "c", name: "out", type: "loot", system: { price: 30 }, folder: "f9" },
  ];
  const src = normalizeSource({ id: "s1", uuid: "Compendium.m.p", categoryId: "gems" });
  eq("null filter keeps everything", candidatesFromIndex(entries, src, null).length, 3);
  eq("one folder", candidatesFromIndex(entries, src, new Set(["f1"])).length, 1);
  eq("folder plus descendant", candidatesFromIndex(entries, src, new Set(["f1", "f2"])).length, 2);

  const pack = { folders: [{ id: "f2", folder: { id: "f1" } }, { id: "f3", folder: { id: "f2" } }] };
  eq("recursive walk finds grandchildren", folderIdsFor(pack, "f1", true).size, 3);
  eq("non-recursive stops at the folder", folderIdsFor(pack, "f1", false).size, 1);
  eq("no folder means no filter", folderIdsFor(pack, null, true), null);
}


console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
