/* Exercises the encounter record (DESIGN.md §12, §13.3) and the storage seam (§12.1).
 * The store is driven against a stub `game.settings`, which is what makes the debounce
 * and lost-update behaviour assertable at all.
 *
 *   node scratchpad/encounter-test.mjs
 */

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);

// ── stub world, installed before the modules load ──
let store = [];
let writes = 0;
globalThis.game = {
  settings: {
    get: () => store,
    set: async (m, k, v) => { writes++; store = JSON.parse(JSON.stringify(v)); },
  },
};
globalThis.pf1 = { config: { currency: { standardRate: 100 } } };

const {
  createEncounter, normalizeEncounter, createMember, memberFromToken, defaultMixFor,
  addMember, removeMember, encounterBudget, encounterPlan, hoardValue, unassignedLines,
  assignLine, isApplied, clearAssignments, toggleTargetLock, distributableTargets,
  coinTargets,
} = await import("../src/scripts/encounter/record.mjs");
const {
  listEncounters, loadEncounter, saveEncounter, deleteEncounter, flushEncounterSaves,
  hasPendingSaves, SAVE_DELAY_MS,
} = await import("../src/scripts/encounter/store.mjs");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log("\n── record creation and normalization (§12) ──");
{
  const e = createEncounter({ name: "Bandit Camp" });
  eq("name is kept", e.name, "Bandit Camp");
  ok("an id is generated", typeof e.id === "string" && e.id.startsWith("enc-"));
  eq("pace defaults to medium", e.pace, "medium");
  eq("no CR override by default", e.crOverride, null);
  eq("no budget override by default", e.budgetOverride, null);
  eq("not applied", isApplied(e), false);
  ok("all three countExisting toggles default on",
     e.countExisting.equipped && e.countExisting.coins && e.countExisting.consumables);
}
{
  // The defence that matters: a record from an older build must not crash a consumer.
  const e = normalizeEncounter({ id: "enc-1" });
  ok("missing members become an array", Array.isArray(e.members));
  ok("missing assignment becomes an object", typeof e.assignment === "object");
  ok("missing currency pool is filled", e.currency.pool.gp === 0);
  eq("an absent countExisting reads as all-on", e.countExisting.coins, true);
  eq("an explicit false survives", normalizeEncounter({ countExisting: { coins: false } }).countExisting.coins, false);
  eq("a junk pace falls back to medium", normalizeEncounter({ pace: "brisk" }).pace, "medium");
  eq("an empty-string override reads as none", normalizeEncounter({ crOverride: "" }).crOverride, null);
  eq("a numeric string override is coerced", normalizeEncounter({ crOverride: "12" }).crOverride, 12);
}
{
  const e = normalizeEncounter({ lines: [{ name: "gem", value: -5, qty: 0 }] });
  eq("a negative line value clamps to 0", e.lines[0].value, 0);
  eq("a zero quantity clamps to 1", e.lines[0].qty, 1);
  ok("a line without an id is given one", !!e.lines[0].id);
  eq("origin defaults to rolled", e.lines[0].origin, "rolled");
}

console.log("\n── members (§12.2) ──");
{
  const m = memberFromToken({
    uuid: "Scene.s1.Token.t1", name: "Bandit", texture: { src: "b.webp" },
    actor: { uuid: "Actor.a1", system: { details: { cr: { total: 5 } } } },
  });
  eq("token uuid captured", m.tokenUuid, "Scene.s1.Token.t1");
  eq("actor uuid captured", m.actorUuid, "Actor.a1");
  eq("CR cached from the actor", m.cr, 5);
  eq("name cached", m.name, "Bandit");
  eq("not missing", m.missing, false);

  const bare = memberFromToken({ uuid: "Scene.s1.Token.t2", name: "Thing" });
  eq("a token with no actor still yields CR 0", bare.cr, 0);
}
{
  let list = [];
  list = addMember(list, createMember({ tokenUuid: "t1", cr: 5 }));
  list = addMember(list, createMember({ tokenUuid: "t1", cr: 5 }));
  eq("the same token cannot be added twice", list.length, 1);
  list = addMember(list, createMember({ tokenUuid: null, name: "manual", cr: 3 }));
  list = addMember(list, createMember({ tokenUuid: null, name: "manual2", cr: 3 }));
  eq("members with no token are always added", list.length, 3);
  eq("removal by uuid", removeMember(list, "t1").length, 2);
  eq("removal by index for manual members", removeMember(list, null, 1).length, 2);
}

console.log("\n── budget derivation (§13.3) ──");
{
  const e = createEncounter({ members: [5, 5, 5, 5, 5, 5].map(cr => createMember({ cr })) });
  const b = encounterBudget(e);
  eq("XP sums", b.totalXP, 9600);
  eq("derived CR", b.derivedCR, 10);
  eq("effective CR is the derived one", b.cr, 10);
  eq("budget at medium", b.budget, 5450);
  eq("source is derived", b.source, "derived");
  eq("member count", b.memberCount, 6);
}
{
  const e = createEncounter({ members: [createMember({ cr: 5 })], pace: "fast" });
  eq("pace selects the column", encounterBudget(e).budget, 2300);
}
{
  const e = createEncounter({ members: [createMember({ cr: 5 })], crOverride: 12 });
  const b = encounterBudget(e);
  eq("a CR override beats the derived CR", b.cr, 12);
  eq("...and drives the budget", b.budget, 9000);
  eq("...and is reported as the source", b.source, "cr");
  eq("the derived CR is still reported", b.derivedCR, 5);
}
{
  const e = createEncounter({ members: [createMember({ cr: 5 })], crOverride: 12, budgetOverride: 777 });
  const b = encounterBudget(e);
  eq("a gp override beats everything", b.budget, 777);
  eq("...and is reported as the source", b.source, "override");
}
{
  const e = createEncounter({ members: [] });
  const b = encounterBudget(e);
  eq("an empty encounter has no CR", b.cr, null);
  eq("...and no budget", b.budget, 0);
}
{
  const e = createEncounter({ members: [createMember({ cr: 40 })], crOverride: 40 });
  ok("a CR past the table is flagged", encounterBudget(e).exceedsTable);
}
{
  const e = createEncounter({
    members: [createMember({ tokenUuid: "gone", cr: 8, missing: true }), createMember({ cr: 8 })],
  });
  const b = encounterBudget(e);
  eq("a missing member still contributes its cached CR", b.totalXP, 9600);
  eq("...and is counted as missing", b.missingCount, 1);
}

console.log("\n── encounterPlan (§14.3) ──");
{
  const e = createEncounter({ members: [5, 5, 5, 5, 5, 5].map(cr => createMember({ cr })) });
  const p = encounterPlan(e, 1890);
  eq("budget", p.budget, 5450);
  eq("carried", p.carried, 1890);
  eq("to generate", p.toGenerate, 3560);
  eq("not over-funded", p.overFunded, 0);
  eq("CR still reported", p.cr, 10);

  const rich = encounterPlan(e, 9000);
  eq("an over-funded encounter generates nothing", rich.toGenerate, 0);
  eq("...and reports the surplus", rich.overFunded, 3550);
}

console.log("\n── mix defaults and migration (§16 revised) ──");
{
  const cats = [{ id: "coins", isCoinSink: true }, { id: "gems", isCoinSink: false }];
  const m = defaultMixFor(cats);
  eq("every category gets a mix entry", Object.keys(m.categories).length, 2);
  ok("...enabled, mid chance, and an item-value range",
     m.categories.gems.enabled && m.categories.gems.chance === 5 &&
     m.categories.gems.itemWeightMin < m.categories.gems.itemWeightMax);
  ok("each category gets its own value range",
     m.categories.gems.valueMin < m.categories.gems.valueMax);
}
{
  // A record from the weight-split model migrates: weight 0 meant excluded.
  const e = normalizeEncounter({ weights: { coins: 5, gems: 0, art: 8 } });
  eq("a positive weight becomes an enabled category", e.mix.categories.coins.enabled, true);
  eq("...carrying its number across as the chance", e.mix.categories.art.chance, 8);
  eq("weight 0 becomes disabled", e.mix.categories.gems.enabled, false);
  eq("count formulas are dropped", e.countFormulas, undefined);
}
{
  const inv = normalizeEncounter({ mix: { categories: { a: { valueMin: 80, valueMax: 20 } } } });
  ok("an inverted value range is corrected",
     inv.mix.categories.a.valueMin <= inv.mix.categories.a.valueMax);
  eq("chance clamps to 1-10",
     normalizeEncounter({ mix: { categories: { a: { chance: 99 } } } }).mix.categories.a.chance, 10);
  // A record from before the range went per-category seeds every category from the
  // shared one it used to carry.
  const migrated = normalizeEncounter({ mix: { biteMin: 5, biteMax: 60, categories: { a: {}, b: {} } } });
  eq("a shared range seeds each category", migrated.mix.categories.a.valueMin, 5);
  eq("...for every one of them", migrated.mix.categories.b.valueMax, 60);
  const fresh = normalizeEncounter({ mix: { categories: { a: {} } } });
  ok("a category with no range gets the default",
     fresh.mix.categories.a.valueMax > fresh.mix.categories.a.valueMin);
  // Item values used to be a single number; it migrates to a band around it.
  const single = normalizeEncounter({ mix: { categories: { a: { itemWeight: 8 } } } });
  eq("a single item weight becomes a band: low", single.mix.categories.a.itemWeightMin, 7);
  eq("...and high", single.mix.categories.a.itemWeightMax, 9);
  const edge = normalizeEncounter({ mix: { categories: { a: { itemWeight: 10 } } } });
  eq("the band clamps at the top of the scale", edge.mix.categories.a.itemWeightMax, 10);
  const inv2 = normalizeEncounter({ mix: { categories: { a: { itemWeightMin: 9, itemWeightMax: 2 } } } });
  ok("an inverted item-value range is corrected",
     inv2.mix.categories.a.itemWeightMin <= inv2.mix.categories.a.itemWeightMax);
}

console.log("\n── the two locks are independent (§17.2) ──");
{
  const e = normalizeEncounter({
    lockedTargets: ["t1", "t2"],
    lines: [
      { id: "l1" },                // neither
      { id: "l2", pinned: true },  // survives Return All
      { id: "l3", locked: true },  // survives a re-generate, NOT Return All
    ],
    assignment: { l1: "t1", l2: "t3", l3: "t3" },
  });
  const kept = clearAssignments(e);
  eq("an item on a locked target survives Return All", kept.l1, "t1");
  eq("a pinned item survives Return All", kept.l2, "t3");
  eq("a re-roll lock does NOT survive Return All", kept.l3, undefined);
  eq("an unlocked line on an open target is returned",
     Object.keys(clearAssignments(normalizeEncounter({
       lines: [{ id: "l1" }], assignment: { l1: "t9" } }))).length, 0);
  eq("toggling a target lock adds it", toggleTargetLock([], "t9").length, 1);
  eq("...and toggling again removes it", toggleTargetLock(["t9"], "t9").length, 0);
  eq("locked targets are excluded from distribution",
     distributableTargets(e, [{ id: "t1" }, { id: "t9" }]).length, 1);
}
{
  // §17.3b — the coin lock. A third list, independent of the other two: the point of it
  // is a target that keeps taking items while taking no coin.
  const e = normalizeEncounter({ lockedTargets: ["t1"], coinExcluded: ["t2"] });
  eq("the coin list round-trips", e.coinExcluded.length, 1);
  eq("a record with no coin list normalizes to empty",
     normalizeEncounter({}).coinExcluded.length, 0);
  eq("a coin-excluded target is skipped by the coin split",
     coinTargets(e, [{ id: "t1" }, { id: "t2" }]).length, 1);
  eq("...and it is t2 that is skipped", coinTargets(e, [{ id: "t1" }, { id: "t2" }])[0].id, "t1");
  eq("an ITEM-locked target still takes coin",
     coinTargets(e, [{ id: "t1" }]).length, 1);
  eq("a COIN-locked target still takes items",
     distributableTargets(e, [{ id: "t2" }]).length, 1);
  eq("plain ids work as well as target objects", coinTargets(e, ["t1", "t2"]).length, 1);
  eq("the shared toggle adds to the coin list too",
     toggleTargetLock(e.coinExcluded, "t3").length, 2);
}
{
  // Both flags ride along with the line, so a tray lock is still set after a round trip
  // through a target that displayed the item as unpinned.
  const e = normalizeEncounter({ lines: [{ id: "l1", locked: true, pinned: false }] });
  eq("the re-roll lock persists", e.lines[0].locked, true);
  eq("...and is independent of the pin", e.lines[0].pinned, false);
  const both = normalizeEncounter({ lines: [{ id: "l1", locked: true, pinned: true }] });
  ok("an item can hold both at once", both.lines[0].locked && both.lines[0].pinned);
  eq("absent flags default off", normalizeEncounter({ lines: [{ id: "x" }] }).lines[0].pinned, false);
}

console.log("\n── lines and assignment ──");
{
  const e = normalizeEncounter({
    lines: [{ id: "l1", value: 100 }, { id: "l2", value: 50, qty: 3 }],
    currency: { pool: { pp: 1, gp: 5, sp: 2, cp: 50 } },
  });
  eq("line value counts quantity", hoardValue(e).lines, 100 + 150);
  eq("coin pool converts to gp", hoardValue(e).coins, 10 + 5 + 0.2 + 0.5);
  eq("both lines start unassigned", unassignedLines(e).length, 2);

  e.assignment = assignLine(e.assignment, "l1", "Scene.s1.Token.t1");
  eq("assigning removes a line from the tray", unassignedLines(e).length, 1);
  e.assignment = assignLine(e.assignment, "l1", null);
  eq("unassigning returns it", unassignedLines(e).length, 2);
}

console.log("\n── storage: the four functions (§12.1) ──");
{
  store = []; writes = 0;
  const a = createEncounter({ name: "A" });
  await saveEncounter(a, { immediate: true });
  eq("an immediate save writes once", writes, 1);
  eq("it can be listed", listEncounters().length, 1);
  eq("it can be loaded by id", loadEncounter(a.id).name, "A");
  eq("an unknown id loads null", loadEncounter("enc-nope"), null);

  const b = createEncounter({ name: "B" });
  await saveEncounter(b, { immediate: true });
  eq("a second encounter appends", listEncounters().length, 2);

  await deleteEncounter(a.id);
  eq("delete removes one", listEncounters().length, 1);
  eq("...the right one", listEncounters()[0].name, "B");
  await deleteEncounter("enc-nope");
  eq("deleting a missing id is harmless", listEncounters().length, 1);
}

console.log("\n── storage: the debounce ──");
{
  store = []; writes = 0;
  const e = createEncounter({ name: "draft" });
  saveEncounter(e);
  saveEncounter({ ...e, name: "draft2" });
  const p = saveEncounter({ ...e, name: "draft3" });
  eq("three rapid saves write nothing yet", writes, 0);
  ok("a save is pending", hasPendingSaves());
  await p;
  eq("they coalesce into one write", writes, 1);
  eq("the newest state wins", loadEncounter(e.id).name, "draft3");
  ok("nothing is pending afterwards", !hasPendingSaves());
}
{
  store = []; writes = 0;
  const e = createEncounter({ name: "x" });
  const p = saveEncounter(e);
  await saveEncounter({ ...e, name: "forced" }, { immediate: true });
  eq("an immediate save pre-empts the timer", writes, 1);
  await p;
  eq("the debounced promise still resolves", writes, 1);
  eq("the forced state is what landed", loadEncounter(e.id).name, "forced");
  await sleep(SAVE_DELAY_MS + 50);
  eq("the cancelled timer never fires a second write", writes, 1);
}
{
  store = []; writes = 0;
  const e = createEncounter({ name: "doomed" });
  saveEncounter(e);
  await deleteEncounter(e.id);
  await sleep(SAVE_DELAY_MS + 50);
  eq("a pending save cannot resurrect a deleted encounter", listEncounters().length, 0);
}

console.log("\n── storage: the lost update (§12.1) ──");
{
  store = []; writes = 0;
  const a = createEncounter({ name: "A" });
  const b = createEncounter({ name: "B" });
  await saveEncounter(a, { immediate: true });
  await saveEncounter(b, { immediate: true });

  // Two windows open. One holds a stale snapshot of A taken before B existed.
  const staleA = loadEncounter(a.id);
  staleA.name = "A edited";
  await saveEncounter(staleA, { immediate: true });

  eq("both encounters survive", listEncounters().length, 2);
  eq("the edit landed", loadEncounter(a.id).name, "A edited");
  eq("the other was not clobbered", loadEncounter(b.id).name, "B");
}
{
  store = [];
  const a = createEncounter({ name: "gone" });
  await saveEncounter(a, { immediate: true });
  const held = loadEncounter(a.id);
  await deleteEncounter(a.id);
  await saveEncounter(held, { immediate: true });
  eq("saving a deleted record restores it rather than losing the work", listEncounters().length, 1);
}
{
  store = "not an array";
  eq("a corrupt setting lists nothing rather than throwing", listEncounters().length, 0);
  store = [];
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
