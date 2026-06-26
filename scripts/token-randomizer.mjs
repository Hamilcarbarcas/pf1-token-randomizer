/* PF1 Token Randomizer
 *
 * Randomizes ability scores, names, and carried treasure for unlinked tokens
 * when they are placed on a scene. Adds a configuration button to PF1 character
 * and NPC sheets, plus a module-level "defaults" dialog for new actors.
 */

const MODULE_ID = "pf1-token-randomizer";
const LOG = "PF1 Token Randomizer |";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_NAMES = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

// ─── Treasure / Currency ────────────────────────────────────────────────────────
const COIN_KEYS = ["pp", "gp", "sp", "cp"];
const COIN_NAMES = { pp: "Platinum", gp: "Gold", sp: "Silver", cp: "Copper" };
// Value of one coin of each type, expressed in gold pieces.
const COIN_GP_VALUE = { pp: 10, gp: 1, sp: 0.1, cp: 0.01 };

const STAT_METHODS = {
  "standard": { label: "Standard Array (13,12,11,10,9,8)", values: [13, 12, 11, 10, 9, 8] },
  "elite": { label: "Elite Array (15,14,13,12,11,8)", values: [15, 14, 13, 12, 11, 8] },
  "champion": { label: "Champion Array (18,17,14,13,10,9)", values: [18, 17, 14, 13, 10, 9] },
  "random-low": { label: "Random Low (3d6)", roll: () => rollDice(3, 6) },
  "random-high": { label: "Random High (4d6 drop lowest)", roll: () => rollDice(4, 6, 1) },
  "random-extreme": { label: "Random Extreme (4d6 drop lowest, lowest → 18)", roll: () => rollDice(4, 6, 1), postProcess: boostLowestTo18 }
};

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
  return `${entry.name}|${entry.race ?? ""}|${entry.region ?? ""}|${entry.gender ?? ""}`;
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
    const response = await fetch(`modules/${MODULE_ID}/data/names.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return json.names ?? [];
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
    return json.names ?? [];
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

/**
 * Parse an imported file into normalized name entries. Supports JSON
 * ({ names: [...] } or a bare array) and delimited text (CSV / TSV / TXT with a
 * header row containing at least a "name" column; optional race/region/gender).
 */
async function parseNameFile(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data.names ?? []);
    return arr
      .map(e => ({
        name: String(e.name ?? "").trim(),
        race: String(e.race ?? "").trim(),
        region: String(e.region ?? "").trim(),
        gender: String(e.gender ?? "").trim()
      }))
      .filter(e => e.name);
  }

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error("file must have a header row and at least one data row.");
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  if (nameIdx === -1) throw new Error("file must have a 'name' column.");
  const raceIdx = headers.indexOf("race");
  const regionIdx = headers.indexOf("region");
  const genderIdx = headers.indexOf("gender");

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.trim());
    if (!cols[nameIdx]) continue;
    out.push({
      name: cols[nameIdx],
      race: raceIdx >= 0 ? (cols[raceIdx] || "") : "",
      region: regionIdx >= 0 ? (cols[regionIdx] || "") : "",
      gender: genderIdx >= 0 ? (cols[genderIdx] || "") : ""
    });
  }
  return out;
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

function generateScores(method) {
  const config = STAT_METHODS[method];
  if (!config) return [10, 10, 10, 10, 10, 10];
  if (config.values) return [...config.values];
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
 * data (e.g. "2d6*100", "@details.cr.total * 50"). Returns 0 on empty/invalid.
 */
async function resolveGoldValue(formula, actor) {
  if (!formula || !String(formula).trim()) return 0;
  try {
    const rollData = actor?.getRollData?.() ?? {};
    const roll = new pf1.dice.RollPF(String(formula), rollData);
    await roll.evaluate({ async: true });
    return Math.max(0, roll.total ?? 0);
  } catch (err) {
    console.error(`${LOG} Treasure gold formula error:`, err);
    ui.notifications?.warn(`Treasure randomizer: could not parse gold formula "${formula}".`);
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

function getActorNameRandomizerSettings(actor) {
  const flags = actor?.getFlag?.(MODULE_ID, "nameRandomizer") ?? actor?.flags?.[MODULE_ID]?.nameRandomizer;
  const defaults = getDefaultNameRandomizerSettings();
  if (!flags) return defaults;
  return foundry.utils.mergeObject(defaults, flags, { inplace: false });
}

function getDefaultNameRandomizerSettings() {
  return game.settings.get(MODULE_ID, "name-randomizer-defaults") || {
    enabled: false,
    race: "",
    region: "",
    gender: "",
    regionalVariance: 0
  };
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

  let scores = generateScores(settings.method);
  if (STAT_METHODS[settings.method]?.values) shuffleArray(scores);

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

async function randomizeTokenName(tokenDoc) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  if (tokenDoc.actorLink) return;

  const settings = getActorNameRandomizerSettings(actor);
  if (!settings.enabled) return;

  const db = await loadNameDatabase();
  let candidates = db.names ?? [];

  if (settings.race) candidates = candidates.filter(n => n.race === settings.race);
  if (settings.region) {
    const variance = settings.regionalVariance ?? 0;
    if (variance > 0 && Math.random() * 100 < variance) {
      // Skip region filter — pick from any region (race/gender still apply)
    } else {
      candidates = candidates.filter(n => n.region === settings.region);
    }
  }
  if (settings.gender) candidates = candidates.filter(n => n.gender === settings.gender);

  if (candidates.length === 0) {
    console.warn(`${LOG} No names match the selected filters.`);
    return;
  }

  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  await tokenDoc.update({ name: chosen.name });
  console.log(`${LOG} Randomized token name to: ${chosen.name}`);
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
  }

  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-settings"],
    tag: "div",
    window: { title: "Randomizer Settings", icon: "fas fa-dice", resizable: true },
    position: { width: 480, height: "auto" },
    // All class methods are installed before static field initializers run, so the
    // private static handlers below are safe to reference here.
    actions: {
      switchTab: TokenRandomizerSettings.#onSwitchTab,
      reset: TokenRandomizerSettings.#onReset,
      save: TokenRandomizerSettings.#onSave,
      cancel: TokenRandomizerSettings.#onCancel,
      importData: TokenRandomizerSettings.#onImportData
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/randomizer-settings.hbs` }
  };

  /** Give each actor (and the defaults dialog) a stable, distinct window id. */
  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = options.actor ? `token-randomizer-${options.actor.id}` : "token-randomizer-defaults";
    return applied;
  }

  get title() {
    return this.isDefaults
      ? "Default Randomizer Settings"
      : `${this.actor?.name ?? "Actor"} — Randomizer Settings`;
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

    // Ability methods
    const methods = Object.entries(STAT_METHODS).map(([key, config]) => ({
      key,
      label: config.label,
      selected: this.draftAbilitySettings.method === key
    }));

    // Abilities with constraints & priorities
    const abilities = ABILITY_KEYS.map(key => ({
      key,
      name: ABILITY_NAMES[key],
      min: this.draftAbilitySettings.constraints[key]?.min ?? 3,
      max: this.draftAbilitySettings.constraints[key]?.max ?? 18,
      priority: this.draftAbilitySettings.priorities?.[key] ?? 0,
      nil: this.draftAbilitySettings.constraints[key]?.nil ?? false
    }));

    // Name database options
    const db = await loadNameDatabase();
    const races = getUniqueValues(db, "race");
    const genders = getUniqueValues(db, "gender");

    // Filter regions by selected race
    const selectedRace = this.draftNameSettings.race;
    let filteredDb = db;
    if (selectedRace) {
      filteredDb = { names: (db.names ?? []).filter(n => n.race === selectedRace) };
    }
    const regions = getUniqueValues(filteredDb, "region");

    // Clear region if it's no longer valid for the selected race
    if (this.draftNameSettings.region && !regions.includes(this.draftNameSettings.region)) {
      this.draftNameSettings.region = "";
    }

    return {
      isDefaults: this.isDefaults,
      actorName: this.actor?.name || "Default Settings",
      activeTab: this.activeTab,
      // Ability tab
      abilityEnabled: this.draftAbilitySettings.enabled,
      prioritizeEnabled: this.draftAbilitySettings.prioritizeEnabled,
      methods,
      abilities,
      // Name tab
      nameEnabled: this.draftNameSettings.enabled,
      nameRace: this.draftNameSettings.race,
      nameRegion: this.draftNameSettings.region,
      nameGender: this.draftNameSettings.gender,
      nameRegionalVariance: this.draftNameSettings.regionalVariance ?? 0,
      hasRegionSelected: !!this.draftNameSettings.region,
      races,
      regions,
      genders,
      nameCount: (db.names ?? []).length,
      // Treasure tab
      treasureEnabled: this.draftTreasureSettings.enabled,
      treasureGoldFormula: this.draftTreasureSettings.goldFormula ?? "",
      treasureRandomizeDistribution: this.draftTreasureSettings.randomizeDistribution,
      coins: COIN_KEYS.map(key => ({
        key,
        name: COIN_NAMES[key],
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

    // ── Name Tab ──
    on(".name-enabled", "change", (e) => {
      this.draftNameSettings.enabled = e.currentTarget.checked;
      this.render();
    });
    on(".name-race", "change", (e) => {
      this.draftNameSettings.race = e.currentTarget.value;
      this.render();
    });
    on(".name-region", "change", (e) => {
      this.draftNameSettings.region = e.currentTarget.value;
      this.render();
    });
    on(".name-regional-variance", "input", (e) => {
      const value = parseInt(e.currentTarget.value) || 0;
      this.draftNameSettings.regionalVariance = Math.max(0, Math.min(value, 100));
      const label = html.querySelector(".regional-variance-value");
      if (label) label.textContent = `${this.draftNameSettings.regionalVariance}%`;
    });
    on(".name-gender", "change", (e) => {
      this.draftNameSettings.gender = e.currentTarget.value;
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

  // ── Action handlers (data-action) ──

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
      ui.notifications?.info("Default randomizer settings saved.");
    } else {
      await this.actor.setFlag(MODULE_ID, "abilityRandomizer", this.draftAbilitySettings);
      await this.actor.setFlag(MODULE_ID, "nameRandomizer", this.draftNameSettings);
      await this.actor.setFlag(MODULE_ID, "treasureRandomizer", this.draftTreasureSettings);
      ui.notifications?.info(`Randomizer settings saved for ${this.actor.name}.`);
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

  static async #onImportData(event, target) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,.txt,.json";
    input.addEventListener("change", async (changeEvent) => {
      const file = changeEvent.target.files[0];
      if (!file) return;
      try {
        const parsed = await parseNameFile(file);
        if (!parsed.length) {
          ui.notifications?.warn("No usable name entries found in the file.");
          return;
        }

        // Merge into the existing USER database only. The shipped sample is never
        // pulled in here — the first import seeds a clean, sample-free user pool.
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
        await loadNameDatabase(true); // refresh merged cache
        ui.notifications?.info(
          `Imported ${added} new names (${parsed.length - added} duplicates skipped). ` +
          `Custom name pool: ${userNames.length}.`
        );
        this.render();
      } catch (err) {
        console.error(`${LOG} Import error:`, err);
        ui.notifications?.error(`Failed to import names: ${err.message}`);
      }
    });
    input.click();
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
    label: "Randomizer",
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
      btn.style.color = "#f0c050";
      btn.title = "Randomizer (Active)";
    } else {
      btn.style.color = "";
      btn.title = "Randomizer";
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
    name: "Ability Randomizer Default Settings",
    hint: "Default settings for the ability score randomizer.",
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
    name: "Name Randomizer Default Settings",
    hint: "Default settings for the name randomizer.",
    scope: "world",
    config: false,
    type: Object,
    default: {
      enabled: false,
      race: "",
      region: "",
      gender: "",
      regionalVariance: 0
    }
  });

  game.settings.register(MODULE_ID, "treasure-randomizer-defaults", {
    name: "Treasure Randomizer Default Settings",
    hint: "Default settings for the treasure/currency randomizer.",
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

  game.settings.registerMenu(MODULE_ID, "randomizer-defaults-menu", {
    name: "Token Randomizer Defaults",
    label: "Configure Defaults",
    hint: "Set the default randomizer settings applied to new actors, and manage the name database.",
    icon: "fas fa-dice",
    type: TokenRandomizerSettings,
    restricted: true
  });
});

window.TokenRandomizerSettings = TokenRandomizerSettings;
