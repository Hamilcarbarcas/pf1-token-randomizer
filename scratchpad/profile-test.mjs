/* Exercises §20 hoard profiles and the §15.5 provider seam.
 *
 *   node scratchpad/profile-test.mjs
 */

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);

let profileStore = [];
let sourceStore = [];
globalThis.game = {
  settings: {
    get: (m, k) => (k === "hoard-profiles" ? profileStore : sourceStore),
    set: async (m, k, v) => {
      if (k === "hoard-profiles") profileStore = JSON.parse(JSON.stringify(v));
      else sourceStore = JSON.parse(JSON.stringify(v));
    },
  },
  i18n: { has: () => false, localize: s => s, format: s => s },
};
globalThis.pf1 = { config: { currency: { standardRate: 100 } } };

const {
  DEFAULT_HOARD_PROFILES, getHoardProfiles, getHoardProfile, profileFromRecord,
  applyProfileToRecord, profileDiverged, saveProfileFromRecord, deleteHoardProfile,
} = await import("../src/scripts/encounter/profiles.mjs");
const { normalizeEncounter } = await import("../src/scripts/encounter/record.mjs");
const { registerTreasureProvider, resolveSourceCandidates, normalizeSource } =
  await import("../src/scripts/encounter/sources.mjs");

console.log("\n── shipped presets ──");
{
  const list = getHoardProfiles();
  ok("an empty setting falls back to the presets", list.length === DEFAULT_HOARD_PROFILES.length);
  ok("every preset has an id, a name and a config",
     list.every(p => p.id && p.name && p.config?.mix));
  ok("each names the shipped categories", list.every(p =>
     Object.keys(p.config.mix.categories).every(id => id.startsWith("cat-"))));
  ok("each carries coin knobs too", list.every(p => p.config.currency?.denomWeights));

  const dragon = list.find(p => p.id === "profile-dragon");
  const bandits = list.find(p => p.id === "profile-bandits");
  ok("the dragon hoard leans on gems", dragon.config.mix.categories["cat-gems"].chance >= 8);
  ok("...with big items", dragon.config.mix.categories["cat-gems"].itemWeightMax >= 9);
  ok("the bandit camp has no magic", bandits.config.mix.categories["cat-magic"].enabled === false);
  ok("...and leans on coin and gear",
     bandits.config.mix.categories["cat-coins"].chance >= 8 &&
     bandits.config.mix.categories["cat-gear"].chance >= 7);
  ok("bandits carry humbler coin than dragons",
     bandits.config.currency.denomWeights.cp > dragon.config.currency.denomWeights.cp);
}

console.log("\n── what a profile captures ──");
{
  const rec = normalizeEncounter({
    pace: "fast", crOverride: 12, budgetOverride: 999,
    countExisting: { equipped: false, coins: true, consumables: true },
    lines: [{ id: "l1", value: 50 }],
    members: [{ tokenUuid: "t1", cr: 5 }],
    currency: { pool: { pp: 1, gp: 2, sp: 3, cp: 4 }, split: { t1: { gp: 9 } } },
  });
  const config = profileFromRecord(rec);
  ok("the mix is captured", !!config.mix?.categories);
  ok("the coin knobs are captured", !!config.currency?.denomWeights);
  eq("the coin POOL is not — it is a result", config.currency.pool, undefined);
  eq("nor is the split", config.currency.split, undefined);
  eq("pace is not captured", config.pace, undefined);
  eq("nor the CR override", config.crOverride, undefined);
  eq("nor the budget override", config.budgetOverride, undefined);
  eq("nor the carried toggles", config.countExisting, undefined);
  eq("nor lines", config.lines, undefined);
  eq("nor members", config.members, undefined);
}

console.log("\n── loading a profile ──");
{
  const rec = normalizeEncounter({
    pace: "fast", budgetOverride: 500,
    mix: { categories: {
      "cat-coins": { enabled: true, chance: 1, itemWeightMin: 1, itemWeightMax: 2, valueMin: 5, valueMax: 10 },
      "cat-gems": { enabled: false, chance: 1, itemWeightMin: 1, itemWeightMax: 2, valueMin: 5, valueMax: 10 },
      "cat-homebrew": { enabled: true, chance: 7, itemWeightMin: 4, itemWeightMax: 6, valueMin: 20, valueMax: 40 },
    } },
    currency: { pool: { gp: 5 }, split: { t1: { gp: 5 } } },
  });
  const dragon = getHoardProfile("profile-dragon");
  const out = applyProfileToRecord(rec, dragon);

  ok("a category the profile names is overwritten", out.mix.categories["cat-gems"].enabled === true);
  eq("...with the profile's chance", out.mix.categories["cat-gems"].chance, 9);
  eq("a category the profile does NOT name is untouched",
     out.mix.categories["cat-homebrew"].chance, 7);
  eq("the budget is not touched", out.budgetOverride, 500);
  eq("nor the pace", out.pace, "fast");
  eq("the derived coin pool survives", out.currency.pool.gp, 5);
  eq("the GM's split survives", out.currency.split.t1.gp, 5);
  eq("coin knobs come from the profile", out.currency.denomWeights.pp, 30);
  eq("provenance is stamped", out.profile.id, "profile-dragon");
}
{
  // A preset naming a category this world deleted must not resurrect it.
  const rec = normalizeEncounter({ mix: { categories: { "cat-coins": { chance: 1 } } } });
  const out = applyProfileToRecord(rec, getHoardProfile("profile-dragon"));
  eq("only categories this world has are written", Object.keys(out.mix.categories).length, 1);
  eq("...and that one took the profile's value", out.mix.categories["cat-coins"].chance, 9);
}

console.log("\n── provenance and divergence (§6.3) ──");
{
  const rec = applyProfileToRecord(
    normalizeEncounter({ mix: { categories: { "cat-coins": {} } } }), getHoardProfile("profile-dragon"));
  eq("a freshly loaded record is not modified", profileDiverged(rec), false);
  rec.mix.categories["cat-coins"].chance = 1;
  eq("changing the mix marks it modified", profileDiverged(rec), true);

  const none = normalizeEncounter({});
  eq("a record with no profile is never modified", profileDiverged(none), false);

  // The comparison is a subset one: a profile naming six categories, loaded into a record
  // holding one, must not read as modified merely because the sets differ.
  const partial = applyProfileToRecord(
    normalizeEncounter({ mix: { categories: { "cat-coins": {} } } }), getHoardProfile("profile-bandits"));
  eq("a profile naming more categories than the record does not diverge", profileDiverged(partial), false);
  partial.currency.denomRandomness = 99;
  eq("changing a coin knob marks it modified", profileDiverged(partial), true);
  const orphan = normalizeEncounter({ profile: { id: "profile-gone", name: "Gone" } });
  eq("a deleted profile counts as diverged", profileDiverged(orphan), true);
}

console.log("\n── saving and deleting ──");
{
  profileStore = [];
  const presetCount = DEFAULT_HOARD_PROFILES.length;
  const rec = normalizeEncounter({ mix: { categories: { "cat-coins": { chance: 4 } } } });
  const saved = await saveProfileFromRecord(rec, "  My Hoard  ");
  eq("the name is trimmed", saved.name, "My Hoard");
  // Saving starts from the current list, so the presets are written alongside rather
  // than being wiped by the first save — losing them would be the surprising outcome.
  eq("the first save keeps the presets", getHoardProfiles().length, presetCount + 1);
  ok("...including the shipped ones by name",
     getHoardProfiles().some(p => p.id === "profile-dragon"));
  eq("...and round-trips its config", getHoardProfile(saved.id).config.mix.categories["cat-coins"].chance, 4);

  rec.mix.categories["cat-coins"].chance = 9;
  const again = await saveProfileFromRecord(rec, "my hoard");
  eq("the same name overwrites, case-insensitively", getHoardProfiles().length, presetCount + 1);
  eq("...with the new config", getHoardProfile(again.id).config.mix.categories["cat-coins"].chance, 9);
  eq("...keeping the same id", again.id, saved.id);

  eq("a blank name saves nothing", await saveProfileFromRecord(rec, "   "), null);
  eq("...and nothing was added", getHoardProfiles().length, presetCount + 1);

  await deleteHoardProfile(again.id);
  eq("delete removes only that one", getHoardProfiles().length, presetCount);
  ok("a preset can be deleted too, once materialized",
     (await deleteHoardProfile("profile-dragon"), !getHoardProfiles().some(p => p.id === "profile-dragon")));
}

console.log("\n── the provider seam (§15.5) ──");
{
  registerTreasureProvider("test-forge", {
    generate: ({ source }) => [
      { uuid: "forged:1", name: "Forged Blade", img: "", type: "weapon", value: 500,
        weight: source.weight, maxCount: 0, variance: 0 },
    ],
  });
  const src = normalizeSource({
    id: "src-forge", kind: "provider", providerId: "test-forge", categoryId: "cat-magic", weight: 7,
  });
  const made = await resolveSourceCandidates(src);
  eq("a provider supplies candidates", made.length, 1);
  eq("...stamped with the source", made[0].sourceId, "src-forge");
  eq("...and its category", made[0].categoryId, "cat-magic");
  eq("...carrying its own value", made[0].value, 500);
}
{
  const src = normalizeSource({ id: "s", kind: "provider", providerId: "nope", categoryId: "c" });
  eq("a missing provider yields nothing rather than throwing", (await resolveSourceCandidates(src)).length, 0);
}
{
  registerTreasureProvider("throws", { generate: () => { throw new Error("boom"); } });
  const src = normalizeSource({ id: "s", kind: "provider", providerId: "throws", categoryId: "c" });
  console.log("    (one console error below is expected)");
  eq("a provider that throws is contained", (await resolveSourceCandidates(src)).length, 0);
}
{
  eq("a provider with no generate() is rejected", registerTreasureProvider("bad", {}), false);
  eq("...as is one with no id", registerTreasureProvider("", { generate: () => [] }), false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
