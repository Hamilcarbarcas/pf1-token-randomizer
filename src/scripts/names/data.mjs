/* The name and adjective databases: load, merge, dedupe, persist, import/export.
 */

import { DEFAULT_SEGMENT_WEIGHT, LOG, MODULE_ID } from "../core/const.mjs";

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
function buildNameSegmentViewModels(segments, db, adjDb, collapsed, obscureEnabled = false) {
  const races = getUniqueValues(db, "race");
  const genders = getUniqueValues(db, "gender");
  const adjNames = Object.keys(adjDb.lists).sort();
  const list = segments ?? [];
  const obscureModeLabels = {
    both: game.i18n.localize("TR.Obscure.Mode.Both"),
    dm: game.i18n.localize("TR.Obscure.Mode.Dm"),
    obscured: game.i18n.localize("TR.Obscure.Mode.Obscured")
  };
  return list.map((seg, index) => {
    const vm = {
      index,
      isFirst: index === 0,
      isLast: index === list.length - 1,
      collapsed: collapsed?.has(index) ?? false
    };
    // Obscure controls (only surfaced when the feature is on). Every segment type gets
    // them, including `actor`, so the actor segment grows a body when the feature is on.
    if (obscureEnabled) {
      const mode = seg.obscure ?? "both";
      vm.obscureEnabled = true;
      vm.obscure = mode;
      vm.obscuredText = seg.obscuredText ?? "";
      vm.showObscuredText = mode === "dm";
      vm.obscureOptions = ["both", "dm", "obscured"].map(value => ({
        value, label: obscureModeLabels[value], selected: mode === value
      }));
    }
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
    // The actor segment normally has no body; it gains one (for the obscure controls)
    // only when the feature is on. Every other type always has a body.
    vm.hasBody = !vm.isActor || obscureEnabled;
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


export {
  buildNameSegmentViewModels,
  loadAdjectiveLists,
  loadNameDatabase,
  loadUserAdjectives,
  loadUserNames,
  nameKey,
  namesToTSV,
  parseAdjectiveFile,
  parseNameFile,
  saveUserAdjectives,
  saveUserNames,
};
