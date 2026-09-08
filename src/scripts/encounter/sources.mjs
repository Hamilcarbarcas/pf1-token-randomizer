/* Treasure categories and the compendium sources that fill them (DESIGN.md §15).
 *
 * A category is a user-named group of sources; a source is a pack or a folder inside
 * one, with weight and clamps. Nothing here rolls anything — this layer turns settings
 * plus compendium indexes into candidate pools, which §16 then spends a budget against.
 */

import { LOG, MODULE_ID } from "../core/const.mjs";

// ─── Categories (§15.1) ──────────────────────────────────────────────────────

// Exactly one category may be the coin sink. It has no sources: it takes its own
// weighted share plus every other category's unspent residue (§16.4).
const DEFAULT_TREASURE_CATEGORIES = [
  { id: "cat-coins", name: "TR.Treasure.Cat.Coins", icon: "fa-coins", isCoinSink: true },
  { id: "cat-gems", name: "TR.Treasure.Cat.Gems", icon: "fa-gem", isCoinSink: false },
  { id: "cat-art", name: "TR.Treasure.Cat.Art", icon: "fa-palette", isCoinSink: false },
  { id: "cat-gear", name: "TR.Treasure.Cat.Gear", icon: "fa-shield-halved", isCoinSink: false },
  { id: "cat-consumables", name: "TR.Treasure.Cat.Consumables", icon: "fa-flask", isCoinSink: false },
  { id: "cat-magic", name: "TR.Treasure.Cat.Magic", icon: "fa-wand-sparkles", isCoinSink: false }
];

// Sources pointing at the system's own packs, so the generator has something real to
// draw from before the §15.3 catalogue exists. Gems and art get none — the system ships
// no such items, which is the gap the catalogue fills.
const DEFAULT_TREASURE_SOURCES = [
  {
    id: "src-gear", label: "TR.Treasure.Src.Gear", uuid: "Compendium.pf1.items",
    categoryId: "cat-gear", weight: 5, minValue: 1, maxValue: 0, maxCount: 0, valueVariance: 0
  },
  {
    id: "src-weapons", label: "TR.Treasure.Src.Weapons", uuid: "Compendium.pf1.weapons-and-ammo",
    categoryId: "cat-gear", weight: 3, minValue: 1, maxValue: 0, maxCount: 0, valueVariance: 0
  },
  {
    id: "src-armor", label: "TR.Treasure.Src.Armor", uuid: "Compendium.pf1.armors-and-shields",
    categoryId: "cat-gear", weight: 3, minValue: 1, maxValue: 0, maxCount: 0, valueVariance: 0
  }
];

const CATEGORY_DEFAULTS = { id: "", name: "", icon: "fa-coins", isCoinSink: false };
const SOURCE_DEFAULTS = {
  id: "", label: "", uuid: "", categoryId: "", kind: "compendium",
  weight: 5, minValue: 0, maxValue: 0, maxCount: 0, valueVariance: 0, recursive: true
};

/**
 * Shipped names are i18n keys; user-entered ones are literal text. Localize the former
 * and pass the latter through untouched, so a renamed category keeps its name and a
 * default one never surfaces as a raw "TR.Treasure.Cat.Coins".
 */
function displayText(value) {
  const s = String(value ?? "");
  if (!s.startsWith("TR.")) return s;
  return globalThis.game?.i18n?.has?.(s) ? game.i18n.localize(s) : s;
}

function normalizeCategory(raw) {
  const c = { ...CATEGORY_DEFAULTS, ...(raw ?? {}) };
  c.isCoinSink = c.isCoinSink === true;
  c.name = displayText(c.name);
  return c;
}

function normalizeSource(raw) {
  const s = { ...SOURCE_DEFAULTS, ...(raw ?? {}) };
  s.label = displayText(s.label);
  s.weight = clampNumber(s.weight, 0, 10, 5);
  s.minValue = Math.max(0, Number(s.minValue) || 0);
  s.maxValue = Math.max(0, Number(s.maxValue) || 0);
  s.maxCount = Math.max(0, Math.floor(Number(s.maxCount) || 0));
  s.valueVariance = clampNumber(s.valueVariance, 0, 100, 0);
  s.recursive = s.recursive !== false;
  return s;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getTreasureCategories() {
  const raw = game.settings.get(MODULE_ID, "treasure-categories");
  const list = Array.isArray(raw) && raw.length ? raw : DEFAULT_TREASURE_CATEGORIES;
  return list.map(normalizeCategory);
}

function getTreasureSources() {
  const raw = game.settings.get(MODULE_ID, "treasure-sources");
  // The `.length` check is load-bearing: the setting's own default is `[]`, which IS an
  // array, so an `Array.isArray` test alone would return the empty setting forever and
  // the shipped defaults would never be reachable. Same rule as getTreasureCategories.
  // Cost: a GM who deletes every source gets the defaults back rather than an empty list.
  const list = Array.isArray(raw) && raw.length ? raw : DEFAULT_TREASURE_SOURCES;
  return list.map(normalizeSource);
}

/**
 * The coin sink, or null. More than one is a misconfiguration; the first wins rather
 * than throwing, so a bad setting degrades to "the later one is an ordinary category".
 */
function coinSinkCategory(categories) {
  return (categories ?? []).find(c => c.isCoinSink) ?? null;
}

// ─── Compendium indexes (§15.2) ──────────────────────────────────────────────

// Only what selection needs. Loading whole documents for a 1000-item pack to read a
// price is the thing this exists to avoid; the few items actually drawn are loaded by
// uuid at creation time.
const INDEX_FIELDS = ["type", "system.price", "system.quantity", "system.subType", "folder"];

const _indexCache = new Map();   // packId -> Promise<index collection>

/** Drop cached indexes so an edited pack is re-read. All of them when given nothing. */
function clearIndexCache(packId = null) {
  if (packId) _indexCache.delete(packId);
  else _indexCache.clear();
}

/**
 * Split a source uuid into its pack and (optional) folder.
 * "Compendium.pf1.items" → { packId: "pf1.items", folderId: null }
 * "Compendium.mod.treasure.Folder.abc" → { packId: "mod.treasure", folderId: "abc" }
 */
function parseSourceUuid(uuid) {
  const parts = String(uuid ?? "").split(".");
  if (parts[0] !== "Compendium" || parts.length < 3) return { packId: null, folderId: null };
  const folderAt = parts.indexOf("Folder");
  if (folderAt > 0) {
    return { packId: parts.slice(1, folderAt).join("."), folderId: parts[folderAt + 1] ?? null };
  }
  return { packId: parts.slice(1).join("."), folderId: null };
}

async function getPackIndex(packId) {
  if (_indexCache.has(packId)) return _indexCache.get(packId);
  const pack = game.packs?.get(packId);
  if (!pack) {
    console.warn(`${LOG} Treasure source references a missing pack: ${packId}`);
    return [];
  }
  const promise = pack.getIndex({ fields: INDEX_FIELDS }).catch(err => {
    console.error(`${LOG} Could not index pack ${packId}:`, err);
    _indexCache.delete(packId);
    return [];
  });
  _indexCache.set(packId, promise);
  return promise;
}

/**
 * A folder plus, when `recursive`, every folder beneath it. Returns null for "no folder
 * filter", which is different from an empty set (a folder that exists but is empty).
 */
function folderIdsFor(pack, folderId, recursive) {
  if (!folderId) return null;
  const ids = new Set([folderId]);
  if (!recursive) return ids;
  const all = Array.from(pack?.folders ?? []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of all) {
      const parent = f.folder?.id ?? f.folder ?? null;
      if (parent && ids.has(parent) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
  }
  return ids;
}

// ─── Candidates (pure) ───────────────────────────────────────────────────────

/**
 * Turn index entries into candidates for one source, applying that source's clamps.
 *
 * Pure and index-shaped on purpose: everything §15 decides about *which* items are
 * eligible happens here, where it can be tested without a compendium.
 *
 * @param {Array} entries      index entries ({ _id, name, img, type, system, folder })
 * @param {object} source      a normalized source record
 * @param {Set|null} folderIds folder filter, or null for the whole pack
 */
function candidatesFromIndex(entries, source, folderIds = null) {
  const { packId } = parseSourceUuid(source.uuid);
  const out = [];
  for (const e of entries ?? []) {
    if (folderIds && !folderIds.has(e.folder?.id ?? e.folder ?? null)) continue;
    const value = Number(e.system?.price);
    // Priceless and zero-value entries can never be spent against a budget, and a
    // zero-value candidate would let the mop-up pass loop forever.
    if (!Number.isFinite(value) || value <= 0) continue;
    if (source.minValue > 0 && value < source.minValue) continue;
    if (source.maxValue > 0 && value > source.maxValue) continue;
    out.push({
      uuid: e.uuid ?? (packId ? `Compendium.${packId}.Item.${e._id}` : e._id),
      name: e.name,
      img: e.img,
      type: e.type,
      subType: e.system?.subType ?? null,
      value,
      sourceId: source.id,
      categoryId: source.categoryId,
      weight: source.weight,
      maxCount: source.maxCount,
      variance: source.valueVariance
    });
  }
  return out;
}

// ─── Providers (§15.5) ───────────────────────────────────────────────────────

// A provider synthesises candidates instead of drawing them from a pack — the seam
// pf1-magic-equipment plugs into once it can build an item to a price. Nothing depends
// on one existing.
const _providers = new Map();

function registerTreasureProvider(id, provider) {
  if (!id || typeof provider?.generate !== "function") {
    console.error(`${LOG} A treasure provider needs an id and a generate() function.`);
    return false;
  }
  _providers.set(id, provider);
  return true;
}

function getTreasureProvider(id) {
  return _providers.get(id) ?? null;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/** Candidates for one source: provider-backed or compendium-backed. */
async function resolveSourceCandidates(source) {
  if (source.kind === "provider") {
    const provider = getTreasureProvider(source.providerId);
    if (!provider) {
      console.warn(`${LOG} Treasure source "${source.label}" wants missing provider "${source.providerId}".`);
      return [];
    }
    try {
      const made = await provider.generate({ source });
      return (made ?? []).map(c => ({ ...c, sourceId: source.id, categoryId: source.categoryId }));
    } catch (err) {
      console.error(`${LOG} Treasure provider "${source.providerId}" failed:`, err);
      return [];
    }
  }

  const { packId, folderId } = parseSourceUuid(source.uuid);
  if (!packId) {
    console.warn(`${LOG} Treasure source "${source.label}" has an unusable uuid: ${source.uuid}`);
    return [];
  }
  const entries = await getPackIndex(packId);
  const folderIds = folderIdsFor(game.packs?.get(packId), folderId, source.recursive);
  return candidatesFromIndex(entries, source, folderIds);
}

/**
 * One candidate pool per category. Categories with no usable source come back empty,
 * which §16.4 turns into coins rather than a silently short hoard.
 */
async function resolveCategoryPools(categories, sources) {
  const pools = {};
  for (const cat of categories) pools[cat.id] = [];
  for (const source of sources) {
    if (!pools[source.categoryId]) continue;    // orphaned source; category was deleted
    pools[source.categoryId].push(...await resolveSourceCandidates(source));
  }
  return pools;
}

export {
  displayText,
  DEFAULT_TREASURE_CATEGORIES,
  DEFAULT_TREASURE_SOURCES,
  INDEX_FIELDS,
  normalizeCategory,
  normalizeSource,
  getTreasureCategories,
  getTreasureSources,
  coinSinkCategory,
  parseSourceUuid,
  getPackIndex,
  clearIndexCache,
  folderIdsFor,
  candidatesFromIndex,
  registerTreasureProvider,
  getTreasureProvider,
  resolveSourceCandidates,
  resolveCategoryPools,
};
