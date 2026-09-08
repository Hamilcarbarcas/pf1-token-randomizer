/* Hoard profiles (DESIGN.md §20).
 *
 * A profile is a named snapshot of *what kind of loot* an encounter produces: the mix
 * and the coin knobs. Snapshot with provenance, exactly as the skill profiles work
 * (§6.3) — loading copies values in and stamps where they came from; nothing stays
 * linked afterwards.
 *
 * Deliberately NOT captured: pace, the CR and budget overrides, and the
 * already-carried toggles. Those answer "how much is this encounter worth", which is a
 * property of the encounter, not of the flavour of its loot — a GM loading "Dragon
 * Hoard" should not silently find the budget has moved.
 */

import { LOG, MODULE_ID } from "../core/const.mjs";

const SETTING = "hoard-profiles";

/** The fields a profile carries. Everything else on a record is left alone. */
const PROFILE_KEYS = ["mix", "currency"];

// Shipped presets. Category ids are the §15.1 defaults; a profile silently skips a
// category a world does not have, and leaves any it does not mention untouched.
const DEFAULT_HOARD_PROFILES = [
  {
    id: "profile-dragon", name: "TR.Hoard.Dragon",
    config: {
      mix: {
        floorPct: 10,
        categories: {
          "cat-coins": { enabled: true, chance: 9, itemWeightMin: 5, itemWeightMax: 8, valueMin: 30, valueMax: 60 },
          "cat-gems": { enabled: true, chance: 9, itemWeightMin: 6, itemWeightMax: 10, valueMin: 25, valueMax: 55 },
          "cat-art": { enabled: true, chance: 8, itemWeightMin: 6, itemWeightMax: 10, valueMin: 20, valueMax: 45 },
          "cat-gear": { enabled: true, chance: 2, itemWeightMin: 4, itemWeightMax: 7, valueMin: 5, valueMax: 15 },
          "cat-consumables": { enabled: true, chance: 2, itemWeightMin: 3, itemWeightMax: 6, valueMin: 5, valueMax: 15 },
          "cat-magic": { enabled: true, chance: 6, itemWeightMin: 7, itemWeightMax: 10, valueMin: 20, valueMax: 50 }
        }
      },
      currency: { denomWeights: { pp: 30, gp: 45, sp: 15, cp: 10 }, denomRandomness: 20, splitRandomness: 0 }
    }
  },
  {
    id: "profile-bandits", name: "TR.Hoard.Bandits",
    config: {
      mix: {
        floorPct: 10,
        categories: {
          "cat-coins": { enabled: true, chance: 9, itemWeightMin: 3, itemWeightMax: 6, valueMin: 30, valueMax: 60 },
          "cat-gems": { enabled: true, chance: 2, itemWeightMin: 3, itemWeightMax: 6, valueMin: 10, valueMax: 25 },
          "cat-art": { enabled: false, chance: 1, itemWeightMin: 3, itemWeightMax: 6, valueMin: 10, valueMax: 25 },
          "cat-gear": { enabled: true, chance: 8, itemWeightMin: 2, itemWeightMax: 5, valueMin: 20, valueMax: 45 },
          "cat-consumables": { enabled: true, chance: 5, itemWeightMin: 2, itemWeightMax: 5, valueMin: 10, valueMax: 25 },
          "cat-magic": { enabled: false, chance: 1, itemWeightMin: 5, itemWeightMax: 8, valueMin: 10, valueMax: 30 }
        }
      },
      currency: { denomWeights: { pp: 2, gp: 30, sp: 40, cp: 40 }, denomRandomness: 30, splitRandomness: 40 }
    }
  },
  {
    id: "profile-study", name: "TR.Hoard.Study",
    config: {
      mix: {
        floorPct: 10,
        categories: {
          "cat-coins": { enabled: true, chance: 3, itemWeightMin: 3, itemWeightMax: 6, valueMin: 10, valueMax: 25 },
          "cat-gems": { enabled: true, chance: 3, itemWeightMin: 4, itemWeightMax: 8, valueMin: 10, valueMax: 30 },
          "cat-art": { enabled: true, chance: 5, itemWeightMin: 5, itemWeightMax: 9, valueMin: 15, valueMax: 35 },
          "cat-gear": { enabled: true, chance: 2, itemWeightMin: 2, itemWeightMax: 5, valueMin: 5, valueMax: 15 },
          "cat-consumables": { enabled: true, chance: 9, itemWeightMin: 2, itemWeightMax: 6, valueMin: 25, valueMax: 50 },
          "cat-magic": { enabled: true, chance: 8, itemWeightMin: 6, itemWeightMax: 10, valueMin: 25, valueMax: 55 }
        }
      },
      currency: { denomWeights: { pp: 10, gp: 50, sp: 30, cp: 10 }, denomRandomness: 20, splitRandomness: 0 }
    }
  },
  {
    id: "profile-lair", name: "TR.Hoard.Lair",
    config: {
      mix: {
        floorPct: 15,
        categories: {
          "cat-coins": { enabled: true, chance: 6, itemWeightMin: 2, itemWeightMax: 5, valueMin: 20, valueMax: 40 },
          "cat-gems": { enabled: true, chance: 3, itemWeightMin: 3, itemWeightMax: 6, valueMin: 10, valueMax: 25 },
          "cat-art": { enabled: true, chance: 2, itemWeightMin: 3, itemWeightMax: 7, valueMin: 10, valueMax: 25 },
          "cat-gear": { enabled: false, chance: 1, itemWeightMin: 3, itemWeightMax: 6, valueMin: 5, valueMax: 15 },
          "cat-consumables": { enabled: false, chance: 1, itemWeightMin: 3, itemWeightMax: 6, valueMin: 5, valueMax: 15 },
          "cat-magic": { enabled: false, chance: 1, itemWeightMin: 5, itemWeightMax: 9, valueMin: 10, valueMax: 30 }
        }
      },
      currency: { denomWeights: { pp: 5, gp: 25, sp: 35, cp: 45 }, denomRandomness: 40, splitRandomness: 0 }
    }
  }
];

function localizeName(name) {
  const s = String(name ?? "");
  if (!s.startsWith("TR.")) return s;
  return globalThis.game?.i18n?.has?.(s) ? game.i18n.localize(s) : s;
}

function normalizeProfile(raw) {
  return {
    id: raw?.id || `profile-${globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 10)}`,
    name: localizeName(raw?.name),
    config: raw?.config ?? {}
  };
}

/**
 * Stored profiles, falling back to the shipped presets.
 *
 * The `.length` check is load-bearing for the same reason as §15.1: the setting's default
 * is `[]`, which IS an array, so an isArray test alone would return the empty setting
 * forever and no preset would ever be reachable.
 */
function getHoardProfiles() {
  let raw = [];
  try {
    raw = game.settings.get(MODULE_ID, SETTING);
  } catch {
    raw = [];
  }
  const list = Array.isArray(raw) && raw.length ? raw : DEFAULT_HOARD_PROFILES;
  return list.map(normalizeProfile);
}

function getHoardProfile(id) {
  return getHoardProfiles().find(p => p.id === id) ?? null;
}

/** Snapshot the parts of a record a profile carries. Pure. */
function profileFromRecord(record) {
  const config = {};
  for (const key of PROFILE_KEYS) {
    config[key] = foundryClone(record?.[key]);
  }
  // The coin POOL and split are results, not settings — a profile carries the knobs only.
  if (config.currency) {
    delete config.currency.pool;
    delete config.currency.split;
  }
  return config;
}

function foundryClone(value) {
  const clone = globalThis.foundry?.utils?.deepClone;
  if (clone) return clone(value ?? {});
  return JSON.parse(JSON.stringify(value ?? {}));
}

/**
 * Copy a profile's config into a record, returning a new record.
 *
 * **Merged, not replaced.** A category the profile does not mention keeps whatever the
 * encounter already had, so a preset written against the shipped six does not wipe a
 * category a GM added themselves.
 */
function applyProfileToRecord(record, profile) {
  const config = profile?.config ?? {};
  const next = { ...record };

  if (config.mix) {
    const categories = { ...(record?.mix?.categories ?? {}) };
    for (const [id, cfg] of Object.entries(config.mix.categories ?? {})) {
      // Only categories this world actually has; a preset naming a deleted one is skipped
      // rather than resurrecting it.
      if (categories[id]) categories[id] = { ...categories[id], ...cfg };
    }
    next.mix = { ...record.mix, ...config.mix, categories };
  }

  if (config.currency) {
    next.currency = {
      ...record.currency,
      ...config.currency,
      // Results survive a profile load: the pool is derived and the split is the GM's.
      pool: record.currency?.pool,
      split: record.currency?.split
    };
  }

  next.profile = { id: profile?.id ?? null, name: profile?.name ?? "" };
  return next;
}

/**
 * Whether a record has drifted from the profile it was loaded from, so the UI can say
 * *(modified)* rather than claiming a fidelity it no longer has.
 */
function profileDiverged(record) {
  if (!record?.profile?.id) return false;
  const profile = getHoardProfile(record.profile.id);
  // A profile deleted out from under the record counts as diverged; there is nothing
  // left to be faithful to.
  if (!profile) return true;
  return !matchesProfile(record, profile.config);
}

/**
 * Whether a record still matches everything a profile actually applied.
 *
 * A **subset** comparison, not an equality one. Loading is a merge (a category the
 * profile does not name keeps its setting, and one this world lacks is skipped), so
 * comparing whole configs would report every freshly-loaded record as modified the
 * moment the two category sets differed — which is the normal case.
 */
function matchesProfile(record, config) {
  const cfg = config ?? {};

  if (cfg.mix) {
    if (cfg.mix.floorPct !== undefined && record?.mix?.floorPct !== cfg.mix.floorPct) return false;
    for (const [id, wanted] of Object.entries(cfg.mix.categories ?? {})) {
      const have = record?.mix?.categories?.[id];
      // Not present here, so it was never applied and cannot have drifted.
      if (!have) continue;
      for (const [k, v] of Object.entries(wanted)) {
        if (have[k] !== v) return false;
      }
    }
  }

  if (cfg.currency) {
    for (const [k, v] of Object.entries(cfg.currency)) {
      if (k === "pool" || k === "split") continue;      // results, never compared
      if (k === "denomWeights") {
        for (const [coin, weight] of Object.entries(v ?? {})) {
          if (record?.currency?.denomWeights?.[coin] !== weight) return false;
        }
        continue;
      }
      if (record?.currency?.[k] !== v) return false;
    }
  }

  return true;
}

/** Write the profile list back. The only function that touches the setting. */
async function saveHoardProfiles(list) {
  try {
    await game.settings.set(MODULE_ID, SETTING, list);
    return true;
  } catch (err) {
    console.error(`${LOG} Could not save hoard profiles:`, err);
    return false;
  }
}

/**
 * Save the record's current mix under `name`, overwriting a profile of the same name.
 * Returns the profile written, or null.
 */
async function saveProfileFromRecord(record, name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return null;
  const list = getHoardProfiles();
  const config = profileFromRecord(record);
  const existing = list.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
  let profile;
  if (existing) {
    existing.config = config;
    profile = existing;
  } else {
    profile = normalizeProfile({ name: trimmed, config });
    list.push(profile);
  }
  return (await saveHoardProfiles(list)) ? profile : null;
}

async function deleteHoardProfile(id) {
  const list = getHoardProfiles().filter(p => p.id !== id);
  return saveHoardProfiles(list);
}

export {
  SETTING,
  PROFILE_KEYS,
  DEFAULT_HOARD_PROFILES,
  normalizeProfile,
  getHoardProfiles,
  getHoardProfile,
  profileFromRecord,
  applyProfileToRecord,
  profileDiverged,
  matchesProfile,
  saveProfileFromRecord,
  deleteHoardProfile,
};
