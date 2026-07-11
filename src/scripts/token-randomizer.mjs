/* PF1 Token Randomizer
 *
 * Randomizes ability scores, names, and carried treasure for unlinked tokens
 * when they are placed on a scene. Adds a configuration button to PF1 character
 * and NPC sheets, plus a module-level "defaults" dialog for new actors.
 */

const MODULE_ID = "pf1-token-randomizer";
const LOG = "PF1 Token Randomizer |";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
// Values are i18n keys, resolved via game.i18n.localize() at use time.
const ABILITY_NAMES = {
  str: "TR.Ability.str",
  dex: "TR.Ability.dex",
  con: "TR.Ability.con",
  int: "TR.Ability.int",
  wis: "TR.Ability.wis",
  cha: "TR.Ability.cha"
};

// ─── Treasure / Currency ────────────────────────────────────────────────────────
const COIN_KEYS = ["pp", "gp", "sp", "cp"];
// Values are i18n keys, resolved via game.i18n.localize() at use time.
const COIN_NAMES = { pp: "TR.Coin.pp", gp: "TR.Coin.gp", sp: "TR.Coin.sp", cp: "TR.Coin.cp" };
// Value of one coin of each type, expressed in gold pieces.
const COIN_GP_VALUE = { pp: 10, gp: 1, sp: 0.1, cp: 0.01 };

// Built-in `label` values are i18n keys; getAllStatMethods() localizes them at use time.
const STAT_METHODS = {
  "standard": { label: "TR.StatMethod.Standard", values: [13, 12, 11, 10, 9, 8] },
  "elite": { label: "TR.StatMethod.Elite", values: [15, 14, 13, 12, 11, 8] },
  "champion": { label: "TR.StatMethod.Champion", values: [18, 17, 14, 13, 10, 9] },
  "random-low": { label: "TR.StatMethod.RandomLow", roll: () => rollDice(3, 6) },
  "random-high": { label: "TR.StatMethod.RandomHigh", roll: () => rollDice(4, 6, 1) },
  "random-extreme": { label: "TR.StatMethod.RandomExtreme", roll: () => rollDice(4, 6, 1), postProcess: boostLowestTo18 }
};

// ─── Custom Stat Methods (user-defined arrays & formulas) ───────────────────────
// GMs can define extra generation methods in the "Manage Stat Methods" menu; they
// are stored as a world setting and merged into STAT_METHODS at use time. Each record
// is one of:
//   • { id, type: "array",   label, values: [6 numbers] }  — fixed array (like Elite)
//   • { id, type: "formula", label, formula: "4d6dl1"    }  — dice formula, rolled per ability
// Custom ids are random ("custom-<id>") so they never collide with the built-ins.

/** Read the raw custom-method records from settings (always an array). */
function getCustomStatMethods() {
  const raw = game.settings.get(MODULE_ID, "custom-stat-methods");
  return Array.isArray(raw) ? raw : [];
}

/**
 * The full generation-method map: built-ins plus any valid custom records, keyed by
 * id. Malformed customs (wrong value count, blank formula) are skipped so a bad entry
 * can never break the dropdown or generation. The composed label mirrors the built-in
 * style, appending the values/formula in parentheses.
 */
function getAllStatMethods() {
  const all = {};
  // Localize built-in labels (stored as i18n keys) as they are copied in.
  for (const [key, config] of Object.entries(STAT_METHODS)) {
    all[key] = { ...config, label: game.i18n.localize(config.label) };
  }
  for (const m of getCustomStatMethods()) {
    if (!m?.id) continue;
    if (m.type === "formula") {
      const formula = String(m.formula ?? "").trim();
      if (!formula) continue;
      all[m.id] = { label: `${m.label || m.id} (${formula})`, formula };
    } else {
      const values = Array.isArray(m.values) ? m.values.map(Number) : [];
      if (values.length !== ABILITY_KEYS.length || values.some(v => !Number.isFinite(v))) continue;
      all[m.id] = { label: `${m.label || m.id} (${values.join(", ")})`, values };
    }
  }
  return all;
}

// ─── Name Database ───────────────────────────────────────────────────────────────
// The effective name pool is the union of two sources:
//   • Baseline  — data/names.json shipped inside the module (read-only; gets
//     overwritten on every module update, which is fine since nothing writes it).
//   • User data — worlds/<world-id>/pf1-token-randomizer-names.json, written by the
//     CSV/JSON importer. Lives in the world folder so it survives module updates,
//     is GM-only (not synced to player clients), and travels with world backups.
let _nameDatabase = null;   // merged (baseline ∪ user), deduped — render/roll cache

function userNamesPath() {
  return `worlds/${game.world.id}/${MODULE_ID}-names.json`;
}

function nameKey(entry) {
  return `${entry.name}|${entry.type ?? "given"}|${entry.race ?? ""}|${entry.region ?? ""}|${entry.gender ?? ""}`;
}

// Valid name-part types. Entries that predate this column (or arrive without one)
// are treated as given names, matching the pre-segment behaviour where the whole
// database was a pool of first names.
const NAME_TYPES = ["given", "surname"];

/** Coerce a raw entry into a normalized name record, defaulting a missing type to "given". */
function normalizeNameEntry(entry) {
  const type = String(entry.type ?? "").trim().toLowerCase();
  return {
    name: String(entry.name ?? "").trim(),
    type: NAME_TYPES.includes(type) ? type : "given",
    race: String(entry.race ?? "").trim(),
    region: String(entry.region ?? "").trim(),
    gender: String(entry.gender ?? "").trim()
  };
}

function dedupeNames(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = nameKey(entry);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

async function loadBaselineNames() {
  try {
    const response = await fetch(`modules/${MODULE_ID}/src/data/names.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return (json.names ?? []).map(normalizeNameEntry).filter(e => e.name);
  } catch (err) {
    console.warn(`${LOG} Could not load baseline name database.`, err);
    return [];
  }
}

async function loadUserNames() {
  try {
    // Cache-bust so a freshly imported file is read back immediately.
    const response = await fetch(`${userNamesPath()}?t=${Date.now()}`);
    if (!response.ok) return []; // 404 = no user data yet
    const json = await response.json();
    // Normalize on load so pre-`type` databases keep working: every entry without
    // a recognized type is read back as a given name. This is non-destructive — the
    // file itself is only rewritten with the type column on the next import/export.
    return (json.names ?? []).map(normalizeNameEntry).filter(e => e.name);
  } catch {
    return [];
  }
}

async function saveUserNames(names) {
  const blob = new Blob([JSON.stringify({ names }, null, 2)], { type: "application/json" });
  const file = new File([blob], `${MODULE_ID}-names.json`, { type: "application/json" });
  const formData = new FormData();
  formData.append("source", "data");
  formData.append("target", `worlds/${game.world.id}`);
  formData.append("upload", file);
  const response = await fetch("/upload", { method: "POST", body: formData });
  if (!response.ok) throw new Error(`upload failed (HTTP ${response.status})`);
}

async function loadNameDatabase(force = false) {
  if (_nameDatabase && !force) return _nameDatabase;
  const user = await loadUserNames();
  // The shipped sample is demo-only: it is used *only* when the world has no
  // custom database yet. As soon as a user database exists, the sample is ignored
  // entirely, so the GM's name pool is never polluted with our demo entries.
  const source = user.length > 0 ? user : await loadBaselineNames();
  _nameDatabase = { names: dedupeNames(source) };
  return _nameDatabase;
}

function getUniqueValues(db, field) {
  const vals = new Set();
  for (const entry of (db?.names ?? [])) {
    if (entry[field]) vals.add(entry[field]);
  }
  return [...vals].sort();
}

/** Build a <select> option model with a leading "Any" (empty value) choice. */
function selectOptions(values, selected, anyLabel = game.i18n.localize("TR.Any")) {
  const opts = [{ value: "", label: anyLabel, selected: !selected }];
  for (const v of values) opts.push({ value: v, label: v, selected: v === selected });
  return opts;
}

/**
 * Turn the draft segment list into a render model for the name-builder template.
 * Each segment gets type flags and its type-specific controls (database filter rows
 * with per-row select options, adjective list toggles, or a static text field).
 */
function buildNameSegmentViewModels(segments, db, adjDb, collapsed) {
  const races = getUniqueValues(db, "race");
  const genders = getUniqueValues(db, "gender");
  const adjNames = Object.keys(adjDb.lists).sort();
  const list = segments ?? [];
  return list.map((seg, index) => {
    const vm = {
      index,
      isFirst: index === 0,
      isLast: index === list.length - 1,
      collapsed: collapsed?.has(index) ?? false
    };
    if (seg.type === "database") {
      vm.isDatabase = true;
      const nameType = seg.nameType ?? "given";
      vm.nameTypeOptions = [
        { value: "given", label: game.i18n.localize("TR.NameType.Given"), selected: nameType === "given" },
        { value: "surname", label: game.i18n.localize("TR.NameType.Surname"), selected: nameType === "surname" },
        { value: "both", label: game.i18n.localize("TR.NameType.Both"), selected: nameType === "both" }
      ];
      vm.filters = (seg.filters ?? []).map((f, fi) => {
        // Region choices depend on the row's race so users can't pick an impossible combo.
        const regionSource = f.race ? { names: (db.names ?? []).filter(n => n.race === f.race) } : db;
        return {
          index: fi,
          weight: f.weight ?? DEFAULT_SEGMENT_WEIGHT,
          raceOptions: selectOptions(races, f.race ?? ""),
          regionOptions: selectOptions(getUniqueValues(regionSource, "region"), f.region ?? ""),
          genderOptions: selectOptions(genders, f.gender ?? "")
        };
      });
    } else if (seg.type === "adjective") {
      vm.isAdjective = true;
      vm.noLists = adjNames.length === 0;
      const enabled = new Map((seg.lists ?? []).map(l => [l.list, l.weight ?? DEFAULT_SEGMENT_WEIGHT]));
      vm.lists = adjNames.map(name => ({
        name,
        enabled: enabled.has(name),
        weight: enabled.get(name) ?? DEFAULT_SEGMENT_WEIGHT
      }));
    } else if (seg.type === "actor") {
      // No settings — just inserts the base actor's name at resolution time.
      vm.isActor = true;
    } else {
      vm.isStatic = true;
      vm.text = seg.text ?? "";
    }
    return vm;
  });
}

/**
 * Parse an imported file into normalized name entries. Supports JSON
 * ({ names: [...] } or a bare array) and delimited text (CSV / TSV / TXT with a
 * header row containing at least a "name" column; optional type/race/region/gender).
 * A missing/unknown `type` normalizes to "given".
 */
async function parseNameFile(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data.names ?? []);
    return arr.map(normalizeNameEntry).filter(e => e.name);
  }

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error("file must have a header row and at least one data row.");
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  if (nameIdx === -1) throw new Error("file must have a 'name' column.");
  const typeIdx = headers.indexOf("type");
  const raceIdx = headers.indexOf("race");
  const regionIdx = headers.indexOf("region");
  const genderIdx = headers.indexOf("gender");

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.trim());
    if (!cols[nameIdx]) continue;
    out.push(normalizeNameEntry({
      name: cols[nameIdx],
      type: typeIdx >= 0 ? (cols[typeIdx] || "") : "",
      race: raceIdx >= 0 ? (cols[raceIdx] || "") : "",
      region: regionIdx >= 0 ? (cols[regionIdx] || "") : "",
      gender: genderIdx >= 0 ? (cols[genderIdx] || "") : ""
    }));
  }
  return out;
}

/** Serialize the name database to TSV (header + one row per entry) for export. */
function namesToTSV(names) {
  const header = ["name", "type", "race", "region", "gender"].join("\t");
  const rows = names.map(n => [n.name, n.type ?? "given", n.race ?? "", n.region ?? "", n.gender ?? ""].join("\t"));
  return [header, ...rows].join("\r\n");
}

// ─── Adjective Lists ─────────────────────────────────────────────────────────────
// Adjective lists are single-column word lists, each identified by a name. The
// effective set is the union of:
//   • Bundled  — data/adjectives.json shipped with the module (functional defaults).
//   • User     — worlds/<world-id>/pf1-token-randomizer-adjectives.json, written by
//     the list manager. A user list with the same name as a bundled one OVERRIDES it;
//     user lists with new names are ADDED. This lives in the world folder for the same
//     reasons as the name database (survives updates, GM-only, travels with backups).
let _adjectiveLists = null; // { name: string[] } merged cache

function userAdjectivesPath() {
  return `worlds/${game.world.id}/${MODULE_ID}-adjectives.json`;
}

/** Coerce a raw { name: words } map into trimmed, de-duped, non-empty word arrays. */
function normalizeAdjectiveLists(raw) {
  const out = {};
  for (const [name, words] of Object.entries(raw ?? {})) {
    const key = String(name).trim();
    if (!key || !Array.isArray(words)) continue;
    const cleaned = [...new Set(words.map(w => String(w).trim()).filter(Boolean))];
    if (cleaned.length) out[key] = cleaned;
  }
  return out;
}

async function loadBundledAdjectives() {
  try {
    const response = await fetch(`modules/${MODULE_ID}/src/data/adjectives.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return normalizeAdjectiveLists(json.lists);
  } catch (err) {
    console.warn(`${LOG} Could not load bundled adjective lists.`, err);
    return {};
  }
}

async function loadUserAdjectives() {
  try {
    const response = await fetch(`${userAdjectivesPath()}?t=${Date.now()}`);
    if (!response.ok) return {}; // 404 = no user data yet
    const json = await response.json();
    return normalizeAdjectiveLists(json.lists);
  } catch {
    return {};
  }
}

async function saveUserAdjectives(lists) {
  const blob = new Blob([JSON.stringify({ lists }, null, 2)], { type: "application/json" });
  const file = new File([blob], `${MODULE_ID}-adjectives.json`, { type: "application/json" });
  const formData = new FormData();
  formData.append("source", "data");
  formData.append("target", `worlds/${game.world.id}`);
  formData.append("upload", file);
  const response = await fetch("/upload", { method: "POST", body: formData });
  if (!response.ok) throw new Error(`upload failed (HTTP ${response.status})`);
}

/**
 * Return the merged adjective lists (bundled ∪ user, user wins), plus per-list
 * source metadata used by the list manager: "bundled" (default only), "overridden"
 * (bundled name replaced by a user upload), or "custom" (user-only list).
 */
async function loadAdjectiveLists(force = false) {
  if (_adjectiveLists && !force) return _adjectiveLists;
  const bundled = await loadBundledAdjectives();
  const user = await loadUserAdjectives();
  const lists = { ...bundled, ...user };
  const sources = {};
  for (const name of Object.keys(lists)) {
    if (user[name] && bundled[name]) sources[name] = "overridden";
    else if (user[name]) sources[name] = "custom";
    else sources[name] = "bundled";
  }
  _adjectiveLists = { lists, sources };
  return _adjectiveLists;
}

/** Parse an uploaded single-column adjective file (one word per line, or a JSON array). */
async function parseAdjectiveFile(file) {
  const text = await file.text();
  let words;
  if (file.name.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text);
    words = Array.isArray(data) ? data : (data.words ?? data.adjectives ?? []);
  } else {
    words = text.split(/\r?\n/);
  }
  const cleaned = [...new Set(words.map(w => String(w).trim()).filter(Boolean))];
  if (!cleaned.length) throw new Error("no words found in file.");
  return cleaned;
}

// ─── Dice Helpers ──────────────────────────────────────────────────────────────

/**
 * Roll dice and optionally drop lowest
 */
function rollDice(count, sides, dropLowest = 0) {
  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  rolls.sort((a, b) => b - a);
  return rolls.slice(0, count - dropLowest).reduce((sum, val) => sum + val, 0);
}

/**
 * Replace the lowest value in an array of scores with 18
 */
function boostLowestTo18(scores) {
  let minIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < scores[minIdx]) minIdx = i;
  }
  scores[minIdx] = 18;
  return scores;
}

/**
 * Evaluate a per-ability score formula (e.g. "4d6dl1", "3d6", "2d6+6") once, using
 * the same dice engine and roll data as the treasure formula so `@`-references and
 * dice modifiers behave like every other formula field. Rounds to an integer and
 * falls back to 10 on any parse error.
 */
async function rollFormulaScore(formula, actor) {
  try {
    const rollData = actor?.getRollData?.() ?? {};
    const roll = new pf1.dice.RollPF(String(formula), rollData);
    await roll.evaluate({ async: true });
    return Math.round(roll.total ?? 10);
  } catch (err) {
    console.error(`${LOG} Stat score formula error:`, err);
    ui.notifications?.warn(game.i18n.format("TR.Notif.ScoreFormulaError", { formula }));
    return 10;
  }
}

async function generateScores(method, actor = null) {
  const config = getAllStatMethods()[method];
  if (!config) return [10, 10, 10, 10, 10, 10];
  if (config.values) return [...config.values];
  if (config.formula) {
    const scores = [];
    for (let i = 0; i < ABILITY_KEYS.length; i++) scores.push(await rollFormulaScore(config.formula, actor));
    return scores;
  }
  if (config.roll) {
    let scores = ABILITY_KEYS.map(() => config.roll());
    if (config.postProcess) scores = config.postProcess(scores);
    return scores;
  }
  return [10, 10, 10, 10, 10, 10];
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ─── Ability Score Assignment ──────────────────────────────────────────────────

function assignScoresWithConstraints(scores, constraints, prioritizeEnabled = false, priorities = {}, abilityKeys = ABILITY_KEYS) {
  const sortedScores = [...scores].sort((a, b) => b - a);
  const result = {};
  const usedIndices = new Set();

  let abilityOrder;
  if (prioritizeEnabled) {
    const grouped = {};
    for (const ability of abilityKeys) {
      const pri = priorities[ability] ?? 0;
      if (!grouped[pri]) grouped[pri] = [];
      grouped[pri].push(ability);
    }
    for (const pri of Object.keys(grouped)) {
      shuffleArray(grouped[pri]);
    }
    abilityOrder = Object.keys(grouped)
      .sort((a, b) => Number(b) - Number(a))
      .flatMap(pri => grouped[pri]);
  } else {
    abilityOrder = shuffleArray([...abilityKeys]);
  }

  for (const ability of abilityOrder) {
    const min = constraints[ability]?.min ?? 3;
    const max = constraints[ability]?.max ?? 18;
    const pri = prioritizeEnabled ? (priorities[ability] ?? 0) : 0;

    const fittingIndices = [];
    for (let i = 0; i < sortedScores.length; i++) {
      if (usedIndices.has(i)) continue;
      if (sortedScores[i] >= min && sortedScores[i] <= max) {
        fittingIndices.push(i);
      }
    }

    if (fittingIndices.length > 0) {
      let chosenIdx;
      if (prioritizeEnabled && pri > 0) {
        chosenIdx = fittingIndices[0]; // highest available
      } else {
        chosenIdx = fittingIndices[Math.floor(Math.random() * fittingIndices.length)];
      }
      result[ability] = sortedScores[chosenIdx];
      usedIndices.add(chosenIdx);
      continue;
    }

    // No fitting score — find closest
    let bestIdx = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < sortedScores.length; i++) {
      if (usedIndices.has(i)) continue;
      const score = sortedScores[i];
      const distance = score < min ? min - score : score - max;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      result[ability] = sortedScores[bestIdx];
      usedIndices.add(bestIdx);
    }
  }

  // Clamp
  for (const ability of abilityKeys) {
    const min = constraints[ability]?.min ?? 3;
    const max = constraints[ability]?.max ?? 18;
    if (result[ability] < min) result[ability] = min;
    if (result[ability] > max) result[ability] = max;
  }
  return result;
}

// ─── Treasure Logic ──────────────────────────────────────────────────────────

/**
 * Resolve the gold-value formula to a number. Supports dice and PF1 actor roll
 * data, plus the `@cr` shorthand (e.g. "2d6*100", "@cr * 50"). Returns 0 on
 * empty/invalid.
 */
async function resolveGoldValue(formula, actor) {
  if (!formula || !String(formula).trim()) return 0;
  try {
    const rollData = actor?.getRollData?.() ?? {};
    // Convenience alias: `@cr` → the actor's total CR (details.cr.total), so users
    // don't have to type the full path. Defaults to 0 for actors without a CR.
    rollData.cr = foundry.utils.getProperty(rollData, "details.cr.total") ?? 0;
    const roll = new pf1.dice.RollPF(String(formula), rollData);
    await roll.evaluate({ async: true });
    return Math.max(0, roll.total ?? 0);
  } catch (err) {
    console.error(`${LOG} Treasure gold formula error:`, err);
    ui.notifications?.warn(game.i18n.format("TR.Notif.GoldFormulaError", { formula }));
    return 0;
  }
}

/**
 * Produce the proportion (0–1) of total value assigned to each coin type.
 * Fixed mode normalizes the four percentages by their sum; randomized mode picks
 * a random integer within each [min,max] then normalizes those by their sum.
 * Returns all-zero proportions if the weights sum to 0.
 */
function computeDistributionProportions(settings) {
  const weights = {};
  for (const k of COIN_KEYS) {
    const d = settings.distribution?.[k] ?? {};
    if (settings.randomizeDistribution) {
      const a = Math.max(0, Math.min(100, d.min ?? 0));
      const b = Math.max(0, Math.min(100, d.max ?? 100));
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      weights[k] = lo + Math.floor(Math.random() * (hi - lo + 1));
    } else {
      weights[k] = Math.max(0, d.pct ?? 0);
    }
  }
  const sum = COIN_KEYS.reduce((s, k) => s + weights[k], 0);
  const props = {};
  for (const k of COIN_KEYS) props[k] = sum > 0 ? weights[k] / sum : 0;
  return props;
}

/**
 * Convert a total gold value and per-type proportions into coin counts.
 * Each denomination's coin count is floored; the leftover fractional value is
 * discarded (so the realized total may be slightly under the requested value).
 */
function distributionToCoins(goldValue, props) {
  const coins = {};
  for (const k of COIN_KEYS) {
    const goldShare = goldValue * props[k];
    // Small epsilon guards against float error (e.g. 0.03/0.01 = 2.9999…).
    coins[k] = Math.floor(goldShare / COIN_GP_VALUE[k] + 1e-9);
  }
  return coins;
}

// ─── Settings Helpers ──────────────────────────────────────────────────────────

function getActorRandomizerSettings(actor) {
  const flags = actor?.getFlag?.(MODULE_ID, "abilityRandomizer") ?? actor?.flags?.[MODULE_ID]?.abilityRandomizer;
  const defaults = getDefaultRandomizerSettings();
  if (!flags) return defaults;
  return foundry.utils.mergeObject(defaults, flags, { inplace: false });
}

function getDefaultRandomizerSettings() {
  return game.settings.get(MODULE_ID, "ability-randomizer-defaults") || {
    enabled: false,
    method: "standard",
    prioritizeEnabled: false,
    priorities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    constraints: {
      str: { min: 3, max: 18, nil: false },
      dex: { min: 3, max: 18, nil: false },
      con: { min: 3, max: 18, nil: false },
      int: { min: 3, max: 18, nil: false },
      wis: { min: 3, max: 18, nil: false },
      cha: { min: 3, max: 18, nil: false }
    }
  };
}

const DEFAULT_SEGMENT_WEIGHT = 5;

/**
 * Bring a stored name-randomizer config up to the current segment-based schema.
 * The pre-1.0 shape was flat — { enabled, race, region, gender, regionalVariance } —
 * and drew a single whole name from a filtered pool. A config that actually selected
 * a Race/Region/Gender migrates to one `database` segment holding that filter at
 * default weight; `regionalVariance` is dropped (it is superseded by per-filter
 * weighting). A config with no filter selected — i.e. the plain default — becomes a
 * single `actor` (Actor Name) component instead. Already migrated configs (those with
 * a `segments` array) pass through unchanged.
 */
function migrateNameSettings(settings) {
  if (!settings) return { enabled: false, segments: [{ type: "actor" }] };
  if (Array.isArray(settings.segments)) return settings;
  if (!settings.race && !settings.region && !settings.gender) {
    return { enabled: !!settings.enabled, segments: [{ type: "actor" }] };
  }
  return {
    enabled: !!settings.enabled,
    segments: [{
      type: "database",
      nameType: "given",
      filters: [{
        race: settings.race ?? "",
        region: settings.region ?? "",
        gender: settings.gender ?? "",
        weight: DEFAULT_SEGMENT_WEIGHT
      }]
    }]
  };
}

function getActorNameRandomizerSettings(actor) {
  const flags = actor?.getFlag?.(MODULE_ID, "nameRandomizer") ?? actor?.flags?.[MODULE_ID]?.nameRandomizer;
  const defaults = getDefaultNameRandomizerSettings();
  if (!flags) return defaults;
  // Migrate the raw flags first: the old shape stores its data in top-level keys
  // that would be lost if merged against a `segments`-based default.
  return foundry.utils.mergeObject(defaults, migrateNameSettings(flags), { inplace: false });
}

function getDefaultNameRandomizerSettings() {
  return migrateNameSettings(game.settings.get(MODULE_ID, "name-randomizer-defaults"));
}

function getActorTreasureRandomizerSettings(actor) {
  const flags = actor?.getFlag?.(MODULE_ID, "treasureRandomizer") ?? actor?.flags?.[MODULE_ID]?.treasureRandomizer;
  const defaults = getDefaultTreasureRandomizerSettings();
  if (!flags) return defaults;
  return foundry.utils.mergeObject(defaults, flags, { inplace: false });
}

function getDefaultTreasureRandomizerSettings() {
  return game.settings.get(MODULE_ID, "treasure-randomizer-defaults") || {
    enabled: false,
    goldFormula: "",
    randomizeDistribution: false,
    distribution: {
      pp: { pct: 0, min: 0, max: 100 },
      gp: { pct: 100, min: 0, max: 100 },
      sp: { pct: 0, min: 0, max: 100 },
      cp: { pct: 0, min: 0, max: 100 }
    }
  };
}

/**
 * Check whether ANY randomizer feature is enabled for an actor
 */
function isAnyRandomizerEnabled(actor) {
  const abilitySettings = getActorRandomizerSettings(actor);
  const nameSettings = getActorNameRandomizerSettings(actor);
  const treasureSettings = getActorTreasureRandomizerSettings(actor);
  return abilitySettings.enabled || nameSettings.enabled || treasureSettings.enabled;
}

// ─── Token Creation Logic ──────────────────────────────────────────────────────

async function randomizeTokenAbilityScores(tokenDoc) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (tokenDoc.actorLink) return;

  const settings = getActorRandomizerSettings(actor);
  if (!settings.enabled) return;

  // Abilities flagged as "nil" are set to null — mechanically equivalent to typing
  // "-" in the score field (mod becomes +0 and the score is treated as absent),
  // rather than 0 (which would yield a -5 modifier). These are excluded from the
  // generated score pool so the remaining abilities still receive full values.
  const nilAbilities = ABILITY_KEYS.filter((a) => settings.constraints[a]?.nil);
  const activeAbilities = ABILITY_KEYS.filter((a) => !settings.constraints[a]?.nil);

  let scores = await generateScores(settings.method, actor);
  // Fixed arrays are an unordered pool, so shuffle before constraint assignment;
  // formula/roll methods are already independent per ability and are left as-is.
  if (getAllStatMethods()[settings.method]?.values) shuffleArray(scores);

  const assigned = assignScoresWithConstraints(
    scores,
    settings.constraints,
    settings.prioritizeEnabled,
    settings.priorities,
    activeAbilities
  );

  const updateData = {};
  for (const ability of activeAbilities) {
    updateData[`system.abilities.${ability}.value`] = assigned[ability];
  }
  for (const ability of nilAbilities) {
    updateData[`system.abilities.${ability}.value`] = null;
  }
  await tokenDoc.actor.update(updateData);
  console.log(`${LOG} Randomized ability scores for ${actor.name}:`, assigned, nilAbilities.length ? { nil: nilAbilities } : "");
}

/**
 * Pick one item from `items` with probability proportional to its weight (Model A:
 * the weight selects the bucket, not the individual entry). All-zero weights fall
 * back to a uniform pick so a fully-weighted-out segment is never silently dead.
 */
function weightedPick(items, weightFn) {
  if (!items.length) return null;
  const weights = items.map(i => Math.max(0, Number(weightFn(i)) || 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Resolve a `database` segment to a string: pick one filter (weighted), then draw a
 * uniform name from the pool matching that filter's race/region/gender (blank = Any)
 * and the requested type. `both` draws a given AND a surname from the same filter roll.
 */
function resolveDatabaseSegment(seg, db) {
  const filters = (seg.filters ?? []).filter(Boolean);
  if (!filters.length) return "";
  const filter = weightedPick(filters, f => f.weight);
  if (!filter) return "";
  const names = db.names ?? [];
  const pool = (type) => names.filter(n =>
    n.type === type &&
    (!filter.race || n.race === filter.race) &&
    (!filter.region || n.region === filter.region) &&
    (!filter.gender || n.gender === filter.gender));
  const pickUniform = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)].name : "";
  if (seg.nameType === "both") {
    return [pickUniform(pool("given")), pickUniform(pool("surname"))].filter(Boolean).join(" ");
  }
  return pickUniform(pool(seg.nameType === "surname" ? "surname" : "given"));
}

/** Resolve an `adjective` segment: pick one enabled list (weighted), then a uniform word. */
function resolveAdjectiveSegment(seg, adjDb) {
  const available = (seg.lists ?? []).filter(l => l && adjDb.lists[l.list]?.length);
  if (!available.length) return "";
  const chosen = weightedPick(available, l => l.weight);
  const words = adjDb.lists[chosen.list];
  return words[Math.floor(Math.random() * words.length)];
}

/**
 * Assemble a random name from the ordered segment list. Each segment resolves to a
 * string; empty results are skipped, and the parts are joined with single spaces.
 * `actorName` is the live base-actor name used by `actor` segments. Returns "" when
 * nothing resolved (caller then leaves the token name unchanged).
 */
function buildRandomName(settings, db, adjDb, actorName = "") {
  const parts = [];
  for (const seg of settings.segments ?? []) {
    let part = "";
    if (seg.type === "database") part = resolveDatabaseSegment(seg, db);
    else if (seg.type === "adjective") part = resolveAdjectiveSegment(seg, adjDb);
    else if (seg.type === "static") part = String(seg.text ?? "").trim();
    else if (seg.type === "actor") part = String(actorName ?? "").trim();
    if (part) parts.push(part);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// How many times to re-roll a colliding name before giving up and accepting a duplicate.
const MAX_NAME_TRIES = 5;

/**
 * Collect the names already in use on the scene by other tokens of the same base
 * actor (linked or not), so a freshly placed token can avoid duplicating them.
 */
function usedSiblingNames(tokenDoc) {
  const scene = tokenDoc.parent;
  const names = new Set();
  if (!scene?.tokens) return names;
  for (const other of scene.tokens.contents) {
    if (other.id === tokenDoc.id) continue;
    if (other.actorId !== tokenDoc.actorId) continue;
    if (other.name) names.add(other.name);
  }
  return names;
}

async function randomizeTokenName(tokenDoc) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (tokenDoc.actorLink) return;

  const settings = getActorNameRandomizerSettings(actor);
  if (!settings.enabled) return;

  const db = await loadNameDatabase();
  const adjDb = await loadAdjectiveLists();

  // Uniqueness only makes sense when the name can actually vary. A name built purely
  // from static text is intentionally fixed, so we don't chase uniqueness or warn.
  const canVary = (settings.segments ?? []).some(s => s.type === "database" || s.type === "adjective");
  const used = canVary ? usedSiblingNames(tokenDoc) : new Set();
  const actorName = tokenDoc.baseActor?.name ?? actor.name;

  let name = "";
  let unique = true;
  for (let attempt = 0; attempt < MAX_NAME_TRIES; attempt++) {
    name = buildRandomName(settings, db, adjDb, actorName);
    if (!name) break; // all segments resolved empty — nothing to place
    unique = !used.has(name);
    if (unique) break;
  }

  if (!name) {
    console.warn(`${LOG} Name randomizer produced an empty name; leaving token name unchanged.`);
    return;
  }

  await tokenDoc.update({ name });

  if (!unique) {
    const label = tokenDoc.baseActor?.name ?? actor.name;
    ui.notifications?.warn(
      game.i18n.format("TR.Notif.DuplicateName", { label, tries: MAX_NAME_TRIES, name })
    );
    console.warn(`${LOG} Settled on duplicate name "${name}" for ${label} after ${MAX_NAME_TRIES} tries.`);
  } else {
    console.log(`${LOG} Randomized token name to: ${name}`);
  }
}

async function randomizeTokenTreasure(tokenDoc) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (tokenDoc.actorLink) return;

  const settings = getActorTreasureRandomizerSettings(actor);
  if (!settings.enabled) return;

  const goldValue = await resolveGoldValue(settings.goldFormula, actor);
  const props = computeDistributionProportions(settings);
  const coins = distributionToCoins(goldValue, props);

  // Replace existing currency outright.
  await actor.update({
    "system.currency.pp": coins.pp,
    "system.currency.gp": coins.gp,
    "system.currency.sp": coins.sp,
    "system.currency.cp": coins.cp
  });
  console.log(`${LOG} Randomized treasure for ${actor.name}: ${goldValue.toFixed(2)} gp value →`, coins);
}

// ─── Settings Dialog (ApplicationV2, Tabbed) ─────────────────────────────────────

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class TokenRandomizerSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    this.isDefaults = !this.actor;
    this.activeTab = "ability-scores";
    this.draftAbilitySettings = null;
    this.draftNameSettings = null;
    this.draftTreasureSettings = null;
    // UI-only collapse state for name components, tracked by segment index (kept in
    // sync as segments are added/removed/reordered so it isn't written to settings).
    this.collapsedSegments = new Set();
  }

  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-settings"],
    tag: "div",
    window: { title: "TR.Window.Settings", icon: "fas fa-dice", resizable: true },
    position: { width: 480, height: "auto" },
    // All class methods are installed before static field initializers run, so the
    // private static handlers below are safe to reference here.
    actions: {
      switchTab: TokenRandomizerSettings.#onSwitchTab,
      reset: TokenRandomizerSettings.#onReset,
      save: TokenRandomizerSettings.#onSave,
      cancel: TokenRandomizerSettings.#onCancel,
      addSegment: TokenRandomizerSettings.#onAddSegment,
      removeSegment: TokenRandomizerSettings.#onRemoveSegment,
      clearSegments: TokenRandomizerSettings.#onClearSegments,
      toggleSegment: TokenRandomizerSettings.#onToggleSegment,
      moveSegmentUp: TokenRandomizerSettings.#onMoveSegmentUp,
      moveSegmentDown: TokenRandomizerSettings.#onMoveSegmentDown,
      addFilter: TokenRandomizerSettings.#onAddFilter,
      removeFilter: TokenRandomizerSettings.#onRemoveFilter,
      rerollPreview: TokenRandomizerSettings.#onRerollPreview
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/randomizer-settings.hbs` }
  };

  /** Give each actor (and the defaults dialog) a stable, distinct window id. */
  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = options.actor ? `token-randomizer-${options.actor.id}` : "token-randomizer-defaults";
    return applied;
  }

  get title() {
    return this.isDefaults
      ? game.i18n.localize("TR.Title.Defaults")
      : game.i18n.format("TR.Title.Actor", { name: this.actor?.name ?? game.i18n.localize("TR.ActorPlaceholder") });
  }

  async _prepareContext(options) {
    // Initialize draft settings on first render; preserved across re-renders.
    if (!this.draftAbilitySettings) {
      this.draftAbilitySettings = this.isDefaults
        ? foundry.utils.deepClone(getDefaultRandomizerSettings())
        : foundry.utils.deepClone(getActorRandomizerSettings(this.actor));
    }
    if (!this.draftNameSettings) {
      this.draftNameSettings = this.isDefaults
        ? foundry.utils.deepClone(getDefaultNameRandomizerSettings())
        : foundry.utils.deepClone(getActorNameRandomizerSettings(this.actor));
    }
    if (!this.draftTreasureSettings) {
      this.draftTreasureSettings = this.isDefaults
        ? foundry.utils.deepClone(getDefaultTreasureRandomizerSettings())
        : foundry.utils.deepClone(getActorTreasureRandomizerSettings(this.actor));
    }

    // Ability methods (built-ins + custom arrays/formulas).
    const allMethods = getAllStatMethods();
    const methods = Object.entries(allMethods).map(([key, config]) => ({
      key,
      label: config.label,
      selected: this.draftAbilitySettings.method === key
    }));
    // If the saved method was deleted from the custom list, keep it visible (and
    // selected) as an "unavailable" option so the selection isn't silently changed.
    if (!allMethods[this.draftAbilitySettings.method]) {
      methods.push({ key: this.draftAbilitySettings.method, label: game.i18n.format("TR.StatMethod.Unavailable", { method: this.draftAbilitySettings.method }), selected: true });
    }

    // Abilities with constraints & priorities
    const abilities = ABILITY_KEYS.map(key => ({
      key,
      name: game.i18n.localize(ABILITY_NAMES[key]),
      min: this.draftAbilitySettings.constraints[key]?.min ?? 3,
      max: this.draftAbilitySettings.constraints[key]?.max ?? 18,
      priority: this.draftAbilitySettings.priorities?.[key] ?? 0,
      nil: this.draftAbilitySettings.constraints[key]?.nil ?? false
    }));

    // Name builder options. Cache the loaded pools on the instance so the live
    // preview can be regenerated on slider drags without re-querying/re-rendering.
    if (!Array.isArray(this.draftNameSettings.segments)) this.draftNameSettings.segments = [];
    const db = await loadNameDatabase();
    const adjDb = await loadAdjectiveLists();
    this._nameDb = db;
    this._adjDb = adjDb;
    // Base-actor name for `actor` components; a placeholder in the defaults dialog.
    this._actorName = this.actor?.name ?? game.i18n.localize("TR.ActorPlaceholder");
    const nameSegments = buildNameSegmentViewModels(this.draftNameSettings.segments, db, adjDb, this.collapsedSegments);
    const namePreview = buildRandomName(this.draftNameSettings, db, adjDb, this._actorName);
    const names = db.names ?? [];
    const givenCount = names.filter(n => n.type === "given").length;
    const surnameCount = names.filter(n => n.type === "surname").length;

    return {
      isDefaults: this.isDefaults,
      actorName: this.actor?.name || game.i18n.localize("TR.DefaultSettings"),
      activeTab: this.activeTab,
      // Ability tab
      abilityEnabled: this.draftAbilitySettings.enabled,
      prioritizeEnabled: this.draftAbilitySettings.prioritizeEnabled,
      methods,
      abilities,
      // Name tab
      nameEnabled: this.draftNameSettings.enabled,
      nameSegments,
      namePreview,
      nameCount: names.length,
      givenCount,
      surnameCount,
      // Treasure tab
      treasureEnabled: this.draftTreasureSettings.enabled,
      treasureGoldFormula: this.draftTreasureSettings.goldFormula ?? "",
      treasureRandomizeDistribution: this.draftTreasureSettings.randomizeDistribution,
      coins: COIN_KEYS.map(key => ({
        key,
        name: game.i18n.localize(COIN_NAMES[key]),
        pct: this.draftTreasureSettings.distribution[key]?.pct ?? 0,
        min: this.draftTreasureSettings.distribution[key]?.min ?? 0,
        max: this.draftTreasureSettings.distribution[key]?.max ?? 100
      }))
    };
  }

  /**
   * AppV2 dispatches `data-action` clicks to the static handlers above; here we
   * wire up the live <input>/<select> change handlers that mutate the draft and
   * (where a section needs to enable/disable) trigger a re-render.
   */
  _onRender(context, options) {
    const html = this.element;
    const on = (selector, event, handler) => {
      html.querySelectorAll(selector).forEach(el => el.addEventListener(event, handler));
    };

    // ── Ability Score Tab ──
    on(".randomizer-enabled", "change", (e) => {
      this.draftAbilitySettings.enabled = e.currentTarget.checked;
      this.render();
    });
    on(".randomizer-method", "change", (e) => {
      this.draftAbilitySettings.method = e.currentTarget.value;
    });
    on(".prioritize-enabled", "change", (e) => {
      this.draftAbilitySettings.prioritizeEnabled = e.currentTarget.checked;
      this.render();
    });
    on(".ability-priority", "change", (e) => {
      const ability = e.currentTarget.dataset.ability;
      const value = parseInt(e.currentTarget.value) || 0;
      if (!this.draftAbilitySettings.priorities) this.draftAbilitySettings.priorities = {};
      this.draftAbilitySettings.priorities[ability] = Math.max(0, Math.min(value, 6));
    });
    on(".ability-min", "change", (e) => {
      const ability = e.currentTarget.dataset.ability;
      const parsed = parseInt(e.currentTarget.value);
      const value = isNaN(parsed) ? 3 : parsed;
      this.draftAbilitySettings.constraints[ability].min = Math.max(0, Math.min(value, 18));
      this.render();
    });
    on(".ability-max", "change", (e) => {
      const ability = e.currentTarget.dataset.ability;
      const parsed = parseInt(e.currentTarget.value);
      const value = isNaN(parsed) ? 18 : parsed;
      this.draftAbilitySettings.constraints[ability].max = Math.max(0, Math.min(value, 25));
      this.render();
    });
    on(".ability-nil", "change", (e) => {
      const ability = e.currentTarget.dataset.ability;
      this.draftAbilitySettings.constraints[ability].nil = e.currentTarget.checked;
      this.render();
    });

    // ── Name Tab (segment builder) ──
    const seg = (el) => this.draftNameSettings.segments[Number(el.dataset.segment)];
    const clampWeight = (v) => Math.max(1, Math.min(10, parseInt(v) || DEFAULT_SEGMENT_WEIGHT));

    on(".name-enabled", "change", (e) => {
      this.draftNameSettings.enabled = e.currentTarget.checked;
      this.render();
    });
    on(".segment-nametype", "change", (e) => {
      seg(e.currentTarget).nameType = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".segment-static-text", "change", (e) => {
      seg(e.currentTarget).text = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".filter-race", "change", (e) => {
      const f = seg(e.currentTarget).filters[Number(e.currentTarget.dataset.filter)];
      f.race = e.currentTarget.value;
      f.region = ""; // region choices depend on race — reset to Any
      this.render();
    });
    on(".filter-region", "change", (e) => {
      seg(e.currentTarget).filters[Number(e.currentTarget.dataset.filter)].region = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".filter-gender", "change", (e) => {
      seg(e.currentTarget).filters[Number(e.currentTarget.dataset.filter)].gender = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".filter-weight", "input", (e) => {
      const val = clampWeight(e.currentTarget.value);
      seg(e.currentTarget).filters[Number(e.currentTarget.dataset.filter)].weight = val;
      this._updateWeightLabel(e.currentTarget, val);
    });
    on(".adj-enabled", "change", (e) => {
      const s = seg(e.currentTarget);
      const listName = e.currentTarget.dataset.list;
      if (!Array.isArray(s.lists)) s.lists = [];
      if (e.currentTarget.checked) {
        if (!s.lists.some(l => l.list === listName)) s.lists.push({ list: listName, weight: DEFAULT_SEGMENT_WEIGHT });
      } else {
        s.lists = s.lists.filter(l => l.list !== listName);
      }
      this.render();
    });
    on(".adj-weight", "input", (e) => {
      const val = clampWeight(e.currentTarget.value);
      const entry = (seg(e.currentTarget).lists ?? []).find(l => l.list === e.currentTarget.dataset.list);
      if (entry) entry.weight = val;
      this._updateWeightLabel(e.currentTarget, val);
    });

    // ── Treasure Tab ──
    on(".treasure-enabled", "change", (e) => {
      this.draftTreasureSettings.enabled = e.currentTarget.checked;
      this.render();
    });
    on(".treasure-gold-formula", "change", (e) => {
      this.draftTreasureSettings.goldFormula = e.currentTarget.value;
    });
    on(".treasure-randomize-distribution", "change", (e) => {
      this.draftTreasureSettings.randomizeDistribution = e.currentTarget.checked;
      this.render();
    });
    on(".treasure-pct", "change", (e) => {
      const coin = e.currentTarget.dataset.coin;
      const value = parseInt(e.currentTarget.value);
      this.draftTreasureSettings.distribution[coin].pct = isNaN(value) ? 0 : Math.max(0, value);
    });
    on(".treasure-min", "change", (e) => {
      const coin = e.currentTarget.dataset.coin;
      const parsed = parseInt(e.currentTarget.value);
      this.draftTreasureSettings.distribution[coin].min = isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, 100));
      this.render();
    });
    on(".treasure-max", "change", (e) => {
      const coin = e.currentTarget.dataset.coin;
      const parsed = parseInt(e.currentTarget.value);
      this.draftTreasureSettings.distribution[coin].max = isNaN(parsed) ? 100 : Math.max(0, Math.min(parsed, 100));
      this.render();
    });
  }

  /** Regenerate the live name-preview sample in place (no full re-render). */
  _refreshPreview() {
    const el = this.element?.querySelector(".name-preview-value");
    if (!el || !this._nameDb || !this._adjDb) return;
    const name = buildRandomName(this.draftNameSettings, this._nameDb, this._adjDb, this._actorName);
    // textContent (not innerHTML) since names come from user-supplied data.
    if (name) el.textContent = name;
    else el.innerHTML = `<em>${game.i18n.localize("TR.Empty")}</em>`;
  }

  /** Update the numeric readout next to a weight slider and refresh the preview. */
  _updateWeightLabel(rangeEl, val) {
    const label = rangeEl.parentElement?.querySelector(".weight-value");
    if (label) label.textContent = String(val);
    this._refreshPreview();
  }

  // ── Action handlers (data-action) ──

  static #onAddSegment(event, target) {
    const type = target.dataset.type;
    let segment;
    if (type === "database") {
      segment = { type: "database", nameType: "given", filters: [{ race: "", region: "", gender: "", weight: DEFAULT_SEGMENT_WEIGHT }] };
    } else if (type === "adjective") {
      segment = { type: "adjective", lists: [] };
    } else if (type === "actor") {
      segment = { type: "actor" };
    } else {
      segment = { type: "static", text: "" };
    }
    this.draftNameSettings.segments.push(segment);
    this.render();
  }

  static #onRemoveSegment(event, target) {
    const i = Number(target.dataset.segment);
    this.draftNameSettings.segments.splice(i, 1);
    // Shift collapse indices above the removed one down by one.
    const next = new Set();
    for (const c of this.collapsedSegments) {
      if (c < i) next.add(c);
      else if (c > i) next.add(c - 1);
    }
    this.collapsedSegments = next;
    this.render();
  }

  static async #onClearSegments(event, target) {
    if (!this.draftNameSettings.segments.length) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Dialog.ClearSegments.Title") },
      content: game.i18n.localize("TR.Dialog.ClearSegments.Content")
    });
    if (!ok) return;
    this.draftNameSettings.segments = [];
    this.collapsedSegments.clear();
    this.render();
  }

  static #onToggleSegment(event, target) {
    const i = Number(target.dataset.segment);
    if (this.collapsedSegments.has(i)) this.collapsedSegments.delete(i);
    else this.collapsedSegments.add(i);
    // Toggle in place (no re-render) so open editors and slider focus are preserved.
    target.closest(".name-segment")?.classList.toggle("collapsed");
  }

  static #onMoveSegmentUp(event, target) {
    const i = Number(target.dataset.segment);
    const s = this.draftNameSettings.segments;
    if (i > 0) {
      [s[i - 1], s[i]] = [s[i], s[i - 1]];
      this.#swapCollapsed(i - 1, i);
      this.render();
    }
  }

  static #onMoveSegmentDown(event, target) {
    const i = Number(target.dataset.segment);
    const s = this.draftNameSettings.segments;
    if (i < s.length - 1) {
      [s[i + 1], s[i]] = [s[i], s[i + 1]];
      this.#swapCollapsed(i, i + 1);
      this.render();
    }
  }

  /** Swap the collapsed state of two segment indices (used when reordering). */
  #swapCollapsed(a, b) {
    const set = this.collapsedSegments;
    const ha = set.has(a);
    const hb = set.has(b);
    set.delete(a);
    set.delete(b);
    if (hb) set.add(a);
    if (ha) set.add(b);
  }

  static #onAddFilter(event, target) {
    const s = this.draftNameSettings.segments[Number(target.dataset.segment)];
    if (!Array.isArray(s.filters)) s.filters = [];
    s.filters.push({ race: "", region: "", gender: "", weight: DEFAULT_SEGMENT_WEIGHT });
    this.render();
  }

  static #onRemoveFilter(event, target) {
    const s = this.draftNameSettings.segments[Number(target.dataset.segment)];
    s.filters.splice(Number(target.dataset.filter), 1);
    this.render();
  }

  static #onRerollPreview(event, target) {
    this._refreshPreview();
  }

  static #onSwitchTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static #onReset(event, target) {
    this.draftAbilitySettings = foundry.utils.deepClone(getDefaultRandomizerSettings());
    this.draftNameSettings = foundry.utils.deepClone(getDefaultNameRandomizerSettings());
    this.draftTreasureSettings = foundry.utils.deepClone(getDefaultTreasureRandomizerSettings());
    this.render();
  }

  static async #onSave(event, target) {
    if (this.isDefaults) {
      await game.settings.set(MODULE_ID, "ability-randomizer-defaults", this.draftAbilitySettings);
      await game.settings.set(MODULE_ID, "name-randomizer-defaults", this.draftNameSettings);
      await game.settings.set(MODULE_ID, "treasure-randomizer-defaults", this.draftTreasureSettings);
      ui.notifications?.info(game.i18n.localize("TR.Notif.DefaultsSaved"));
    } else {
      await this.actor.setFlag(MODULE_ID, "abilityRandomizer", this.draftAbilitySettings);
      await this.actor.setFlag(MODULE_ID, "nameRandomizer", this.draftNameSettings);
      await this.actor.setFlag(MODULE_ID, "treasureRandomizer", this.draftTreasureSettings);
      ui.notifications?.info(game.i18n.format("TR.Notif.ActorSaved", { name: this.actor.name }));
      const actorRef = this.actor;
      setTimeout(() => {
        const sheet = actorRef.sheet;
        if (sheet?.rendered) updateRandomizerButtonColor(sheet);
      }, 100);
    }
    this.close();
  }

  static #onCancel(event, target) {
    this.close();
  }
}

// ─── List Manager (name database + adjective lists) ──────────────────────────────

/** Open a file picker for the given accept filter and run `handler(file)` with error toasts. */
function pickFile(accept, handler) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      await handler(file);
    } catch (err) {
      console.error(`${LOG} File import error:`, err);
      ui.notifications?.error(game.i18n.format("TR.Notif.ImportFailed", { message: err.message }));
    }
  });
  input.click();
}

/** Trigger a client-side download of text content (used for TSV export). */
function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Single-line text prompt via DialogV2. Resolves to the string, or null if cancelled. */
async function promptForText(title, label, initial = "") {
  const safe = foundry.utils.escapeHTML?.(initial) ?? initial;
  return foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>${label}</label><input type="text" name="entryValue" value="${safe}" autofocus /></div>`,
    ok: { label: game.i18n.localize("TR.OK"), callback: (event, button) => button.form.elements.entryValue.value },
    rejectClose: false
  });
}

class TokenRandomizerListManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-lists"],
    tag: "div",
    window: { title: "TR.Window.Lists", icon: "fas fa-list", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      importNames: TokenRandomizerListManager.#onImportNames,
      exportNames: TokenRandomizerListManager.#onExportNames,
      addAdjList: TokenRandomizerListManager.#onAddAdjList,
      replaceAdjList: TokenRandomizerListManager.#onReplaceAdjList,
      deleteAdjList: TokenRandomizerListManager.#onDeleteAdjList
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/list-manager.hbs` }
  };

  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = "token-randomizer-lists";
    return applied;
  }

  async _prepareContext(options) {
    const db = await loadNameDatabase(true); // force so counts reflect recent imports
    const names = db.names ?? [];
    const adjDb = await loadAdjectiveLists(true);
    const adjLists = Object.keys(adjDb.lists).sort().map(name => {
      const source = adjDb.sources[name];
      return {
        name,
        count: adjDb.lists[name].length,
        source,
        isBundled: source === "bundled",
        isOverridden: source === "overridden",
        isCustom: source === "custom"
      };
    });
    return {
      nameCount: names.length,
      givenCount: names.filter(n => n.type === "given").length,
      surnameCount: names.filter(n => n.type === "surname").length,
      hasNames: names.length > 0,
      adjLists,
      hasAdjLists: adjLists.length > 0
    };
  }

  // ── Name database ──

  static #onImportNames(event, target) {
    pickFile(".csv,.tsv,.txt,.json", async (file) => {
      const parsed = await parseNameFile(file);
      if (!parsed.length) {
        ui.notifications?.warn(game.i18n.localize("TR.Notif.NoNameEntries"));
        return;
      }
      // Merge into the USER database only; the bundled sample is never pulled in here.
      const userNames = await loadUserNames();
      const existing = new Set(userNames.map(nameKey));
      let added = 0;
      for (const entry of parsed) {
        const key = nameKey(entry);
        if (!existing.has(key)) {
          userNames.push(entry);
          existing.add(key);
          added++;
        }
      }
      await saveUserNames(userNames);
      await loadNameDatabase(true);
      ui.notifications?.info(
        game.i18n.format("TR.Notif.NamesImported", { added, skipped: parsed.length - added, total: userNames.length })
      );
      this.render();
    });
  }

  static async #onExportNames(event, target) {
    const db = await loadNameDatabase(true);
    const names = db.names ?? [];
    if (!names.length) {
      ui.notifications?.warn(game.i18n.localize("TR.Notif.NameDbEmpty"));
      return;
    }
    downloadText(`${MODULE_ID}-names.tsv`, namesToTSV(names), "text/tab-separated-values");
  }

  // ── Adjective lists ──

  static async #onAddAdjList(event, target) {
    const raw = await promptForText(game.i18n.localize("TR.Prompt.NewAdjList.Title"), game.i18n.localize("TR.Prompt.NewAdjList.Label"), "");
    if (raw === null) return;
    const name = raw.trim();
    if (!name) {
      ui.notifications?.warn(game.i18n.localize("TR.Notif.ListNameRequired"));
      return;
    }
    pickFile(".txt,.csv,.json", async (file) => {
      const words = await parseAdjectiveFile(file);
      const user = await loadUserAdjectives();
      user[name] = words;
      await saveUserAdjectives(user);
      await loadAdjectiveLists(true);
      ui.notifications?.info(game.i18n.format("TR.Notif.AdjListSaved", { name, count: words.length }));
      this.render();
    });
  }

  static #onReplaceAdjList(event, target) {
    const name = target.dataset.list;
    pickFile(".txt,.csv,.json", async (file) => {
      const words = await parseAdjectiveFile(file);
      const user = await loadUserAdjectives();
      user[name] = words;
      await saveUserAdjectives(user);
      await loadAdjectiveLists(true);
      ui.notifications?.info(game.i18n.format("TR.Notif.AdjListReplaced", { name, count: words.length }));
      this.render();
    });
  }

  static async #onDeleteAdjList(event, target) {
    const name = target.dataset.list;
    const adjDb = await loadAdjectiveLists();
    const revert = adjDb.sources[name] === "overridden";
    const safe = foundry.utils.escapeHTML?.(name) ?? name;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(revert ? "TR.Dialog.RevertAdj.Title" : "TR.Dialog.DeleteAdj.Title") },
      content: revert
        ? game.i18n.format("TR.Dialog.RevertAdj.Content", { name: safe })
        : game.i18n.format("TR.Dialog.DeleteAdj.Content", { name: safe })
    });
    if (!confirmed) return;
    const user = await loadUserAdjectives();
    delete user[name];
    await saveUserAdjectives(user);
    await loadAdjectiveLists(true);
    ui.notifications?.info(revert ? game.i18n.format("TR.Notif.AdjListReverted", { name }) : game.i18n.format("TR.Notif.AdjListDeleted", { name }));
    this.render();
  }
}

// ─── Stat Method Manager (custom arrays & formulas) ──────────────────────────────

class TokenRandomizerStatMethods extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-stat-methods"],
    tag: "div",
    window: { title: "TR.Window.StatMethods", icon: "fas fa-dice-d6", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      addMethod: TokenRandomizerStatMethods.#onAddMethod,
      removeMethod: TokenRandomizerStatMethods.#onRemoveMethod,
      save: TokenRandomizerStatMethods.#onSave,
      cancel: TokenRandomizerStatMethods.#onCancel
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/stat-methods.hbs` }
  };

  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = "token-randomizer-stat-methods";
    return applied;
  }

  async _prepareContext(options) {
    // Draft copy so edits are only committed on Save (Cancel discards them).
    if (!this.draft) this.draft = foundry.utils.deepClone(getCustomStatMethods());
    return {
      methods: this.draft.map((m, index) => {
        const isFormula = m.type === "formula";
        return {
          index,
          isFormula,
          isArray: !isFormula,
          typeClass: isFormula ? "is-formula" : "is-array",
          label: m.label ?? "",
          formula: m.formula ?? "",
          // Six value fields, padded to the ability count so the grid is always full.
          values: isFormula ? [] : ABILITY_KEYS.map((_, i) => m.values?.[i] ?? 10)
        };
      })
    };
  }

  /** Wire the label / value / formula inputs into the draft (committed on Save). */
  _onRender(context, options) {
    const html = this.element;
    const on = (selector, event, handler) => {
      html.querySelectorAll(selector).forEach(el => el.addEventListener(event, handler));
    };
    on(".stat-method-label", "change", (e) => {
      this.draft[Number(e.currentTarget.dataset.index)].label = e.currentTarget.value;
    });
    on(".stat-method-value", "change", (e) => {
      const m = Number(e.currentTarget.dataset.method);
      const slot = Number(e.currentTarget.dataset.slot);
      if (!Array.isArray(this.draft[m].values)) this.draft[m].values = [];
      this.draft[m].values[slot] = e.currentTarget.value; // raw; parsed/validated on Save
    });
    on(".stat-method-formula", "change", (e) => {
      this.draft[Number(e.currentTarget.dataset.index)].formula = e.currentTarget.value;
    });
  }

  static #onAddMethod(event, target) {
    const type = target.dataset.type;
    if (type === "formula") {
      this.draft.push({ id: `custom-${foundry.utils.randomID()}`, type: "formula", label: "", formula: "4d6dl1" });
    } else {
      this.draft.push({ id: `custom-${foundry.utils.randomID()}`, type: "array", label: "", values: [15, 14, 13, 12, 10, 8] });
    }
    this.render();
  }

  static #onRemoveMethod(event, target) {
    this.draft.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onSave(event, target) {
    // Validate every row before committing; abort (keeping the dialog open) on the
    // first problem so nothing is silently dropped.
    const cleaned = [];
    for (let i = 0; i < this.draft.length; i++) {
      const row = this.draft[i];
      const label = String(row.label ?? "").trim();
      if (!label) {
        ui.notifications?.warn(game.i18n.format("TR.Notif.StatMethodNeedsName", { num: i + 1 }));
        return;
      }
      if (row.type === "formula") {
        const formula = String(row.formula ?? "").trim();
        if (!formula) {
          ui.notifications?.warn(game.i18n.format("TR.Notif.FormulaMethodNeedsFormula", { label }));
          return;
        }
        if (!Roll.validate(formula)) {
          ui.notifications?.warn(game.i18n.format("TR.Notif.InvalidFormula", { label, formula }));
          return;
        }
        cleaned.push({ id: row.id ?? `custom-${foundry.utils.randomID()}`, type: "formula", label, formula });
      } else {
        const values = (row.values ?? []).map(v => Number.parseInt(v, 10));
        if (values.length !== ABILITY_KEYS.length || values.some(v => !Number.isFinite(v))) {
          ui.notifications?.warn(game.i18n.format("TR.Notif.ArrayNeedsValues", { label, count: ABILITY_KEYS.length }));
          return;
        }
        if (values.some(v => v < 1)) {
          ui.notifications?.warn(game.i18n.format("TR.Notif.ArrayMinValue", { label }));
          return;
        }
        cleaned.push({ id: row.id ?? `custom-${foundry.utils.randomID()}`, type: "array", label, values });
      }
    }
    await game.settings.set(MODULE_ID, "custom-stat-methods", cleaned);
    ui.notifications?.info(
      cleaned.length === 1
        ? game.i18n.localize("TR.Notif.StatMethodsSavedOne")
        : game.i18n.format("TR.Notif.StatMethodsSavedMany", { count: cleaned.length })
    );
    this.close();
  }

  static #onCancel(event, target) {
    this.close();
  }
}

// ─── Header Button Hook ────────────────────────────────────────────────────────

Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  if (!game.user?.isGM) return;

  const actor = sheet.actor;
  if (!actor) return;
  if (!["character", "npc"].includes(actor.type)) return;
  if (actor.isToken) return;
  if (actor.prototypeToken?.actorLink) return;

  buttons.unshift({
    label: game.i18n.localize("TR.Button.Randomizer"),
    class: "token-randomizer-settings",
    icon: "fas fa-dice",
    onclick: () => {
      new TokenRandomizerSettings({ actor }).render(true);
    }
  });
});

// Color the button after the sheet renders
function updateRandomizerButtonColor(sheet) {
  if (!game.user?.isGM) return;
  const actor = sheet.actor;
  if (!actor || actor.isToken) return;
  if (actor.prototypeToken?.actorLink) return;

  const randomizerActive = isAnyRandomizerEnabled(actor);
  // Header buttons are in the window frame, so we must search sheet.element, not the inner html
  const el = sheet.element?.[0] ?? sheet.element;
  if (!el) return;
  const btn = el.querySelector?.(".token-randomizer-settings");
  if (btn) {
    if (randomizerActive) {
      btn.style.color = "#e8a63e";
      btn.title = game.i18n.localize("TR.Button.RandomizerActive");
    } else {
      btn.style.color = "";
      btn.title = game.i18n.localize("TR.Button.Randomizer");
    }
  }
}

Hooks.on("renderActorSheet", (sheet, html) => {
  updateRandomizerButtonColor(sheet);
});

// ─── Token Creation Hook ───────────────────────────────────────────────────────

Hooks.on("createToken", async (tokenDoc, options, userId) => {
  if (game.userId !== userId) return;
  if (!game.user?.isGM) return;
  if (tokenDoc.actorLink) return;

  // Skip if already randomized — region teleport recreates the token from
  // existing data (including this flag), which would otherwise re-randomize.
  if (tokenDoc.getFlag(MODULE_ID, "randomized")) return;

  await randomizeTokenAbilityScores(tokenDoc);
  await randomizeTokenName(tokenDoc);
  await randomizeTokenTreasure(tokenDoc);

  // Mark as randomized so teleporting to another scene doesn't re-randomize.
  if (isAnyRandomizerEnabled(tokenDoc.actor)) {
    await tokenDoc.setFlag(MODULE_ID, "randomized", true);
  }
});

// ─── Register Settings ─────────────────────────────────────────────────────────

Hooks.once("init", () => {
  // Comparison helper used by the settings template ({{#if (eq a b)}}).
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }

  game.settings.register(MODULE_ID, "ability-randomizer-defaults", {
    name: "TR.Settings.AbilityDefaults.Name",
    hint: "TR.Settings.AbilityDefaults.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: {
      enabled: false,
      method: "standard",
      prioritizeEnabled: false,
      priorities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      constraints: {
        str: { min: 3, max: 18, nil: false },
        dex: { min: 3, max: 18, nil: false },
        con: { min: 3, max: 18, nil: false },
        int: { min: 3, max: 18, nil: false },
        wis: { min: 3, max: 18, nil: false },
        cha: { min: 3, max: 18, nil: false }
      }
    }
  });

  game.settings.register(MODULE_ID, "name-randomizer-defaults", {
    name: "TR.Settings.NameDefaults.Name",
    hint: "TR.Settings.NameDefaults.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: {
      enabled: false,
      segments: [{ type: "actor" }]
    }
  });

  game.settings.register(MODULE_ID, "treasure-randomizer-defaults", {
    name: "TR.Settings.TreasureDefaults.Name",
    hint: "TR.Settings.TreasureDefaults.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: {
      enabled: false,
      goldFormula: "",
      randomizeDistribution: false,
      distribution: {
        pp: { pct: 0, min: 0, max: 100 },
        gp: { pct: 100, min: 0, max: 100 },
        sp: { pct: 0, min: 0, max: 100 },
        cp: { pct: 0, min: 0, max: 100 }
      }
    }
  });

  game.settings.register(MODULE_ID, "custom-stat-methods", {
    name: "TR.Settings.CustomStatMethods.Name",
    hint: "TR.Settings.CustomStatMethods.Hint",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.registerMenu(MODULE_ID, "randomizer-defaults-menu", {
    name: "TR.Menu.Defaults.Name",
    label: "TR.Menu.Defaults.Label",
    hint: "TR.Menu.Defaults.Hint",
    icon: "fas fa-dice",
    type: TokenRandomizerSettings,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "randomizer-lists-menu", {
    name: "TR.Menu.Lists.Name",
    label: "TR.Menu.Lists.Label",
    hint: "TR.Menu.Lists.Hint",
    icon: "fas fa-list",
    type: TokenRandomizerListManager,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "randomizer-stat-methods-menu", {
    name: "TR.Menu.StatMethods.Name",
    label: "TR.Menu.StatMethods.Label",
    hint: "TR.Menu.StatMethods.Hint",
    icon: "fas fa-dice-d6",
    type: TokenRandomizerStatMethods,
    restricted: true
  });
});

window.TokenRandomizerSettings = TokenRandomizerSettings;
window.TokenRandomizerListManager = TokenRandomizerListManager;
window.TokenRandomizerStatMethods = TokenRandomizerStatMethods;
