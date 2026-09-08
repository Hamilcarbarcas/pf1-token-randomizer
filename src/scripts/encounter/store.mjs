/* Encounter persistence (DESIGN.md §12.1).
 *
 * These four functions are the ONLY code that touches the `encounters` setting.
 * Everything above them works on plain objects, which is what makes [E1] cheap to
 * revisit: moving to a JournalEntryPage subtype is a rewrite of this file and nothing
 * else.
 *
 * Two hazards the setting shape forces:
 *   • the whole array is rewritten on every save, so writes are debounced;
 *   • read-modify-write loses updates, so a save re-reads and replaces only its own
 *     record rather than writing back a snapshot taken minutes ago.
 */

import { LOG, MODULE_ID } from "../core/const.mjs";
import { normalizeEncounter } from "./record.mjs";

const SETTING = "encounters";
const SAVE_DELAY_MS = 500;

// id -> { record, timer, promise, resolve }
const _pending = new Map();

function readAll() {
  try {
    const raw = game.settings.get(MODULE_ID, SETTING);
    return Array.isArray(raw) ? raw : [];
  } catch (err) {
    console.error(`${LOG} Could not read encounters:`, err);
    return [];
  }
}

async function writeAll(list) {
  return game.settings.set(MODULE_ID, SETTING, list);
}

/** Every stored encounter, normalized. Cheap enough to call on render. */
function listEncounters() {
  return readAll().map(normalizeEncounter);
}

/** One encounter by id, or null. */
function loadEncounter(id) {
  const found = readAll().find(e => e?.id === id);
  return found ? normalizeEncounter(found) : null;
}

/**
 * Commit one record. Re-reads the setting first and replaces only the entry with this
 * id, so a second GM editing a different encounter is not clobbered by a stale snapshot.
 * A record whose id is gone (deleted elsewhere) is appended rather than dropped — losing
 * a GM's work to a race is worse than resurrecting a row they can delete again.
 */
async function commitEncounter(record) {
  const list = readAll();
  const i = list.findIndex(e => e?.id === record.id);
  if (i >= 0) list[i] = record;
  else list.push(record);
  await writeAll(list);
  return record;
}

/**
 * Save a record. Debounced by default — the window writes on every slider drag, and the
 * whole array is rewritten each time. Pass `{ immediate: true }` on Apply and on close,
 * where the write must not be lost to a closing window.
 *
 * Repeated calls for one id coalesce onto the latest record and share one promise.
 */
function saveEncounter(record, { immediate = false } = {}) {
  if (!record?.id) {
    console.error(`${LOG} Refusing to save an encounter with no id.`);
    return Promise.resolve(null);
  }

  const existing = _pending.get(record.id);
  if (existing) {
    existing.record = record;                 // coalesce onto the newest state
    clearTimeout(existing.timer);
    if (immediate) {
      _pending.delete(record.id);
      return commitEncounter(existing.record)
        .then(r => { existing.resolve(r); return r; })
        .catch(err => { console.error(`${LOG} Encounter save failed:`, err); existing.resolve(null); return null; });
    }
    existing.timer = setTimeout(() => flushOne(record.id), SAVE_DELAY_MS);
    return existing.promise;
  }

  if (immediate) return commitEncounter(record);

  const entry = { record };
  entry.promise = new Promise(resolve => { entry.resolve = resolve; });
  entry.timer = setTimeout(() => flushOne(record.id), SAVE_DELAY_MS);
  _pending.set(record.id, entry);
  return entry.promise;
}

async function flushOne(id) {
  const entry = _pending.get(id);
  if (!entry) return null;
  _pending.delete(id);
  clearTimeout(entry.timer);
  try {
    const saved = await commitEncounter(entry.record);
    entry.resolve(saved);
    return saved;
  } catch (err) {
    console.error(`${LOG} Encounter save failed:`, err);
    entry.resolve(null);
    return null;
  }
}

/** Write every pending save now. Call before anything that reads the setting directly. */
async function flushEncounterSaves() {
  const ids = [...(_pending.keys())];
  return Promise.all(ids.map(flushOne));
}

/** Whether a save is still queued — for a window asking "is my work committed?". */
function hasPendingSaves() {
  return _pending.size > 0;
}

/**
 * Delete an encounter. Cancels any queued save for it first, or the debounce would
 * resurrect the record a moment after it was removed.
 */
async function deleteEncounter(id) {
  const entry = _pending.get(id);
  if (entry) {
    clearTimeout(entry.timer);
    _pending.delete(id);
    entry.resolve(null);
  }
  const list = readAll().filter(e => e?.id !== id);
  await writeAll(list);
  return true;
}

export {
  SETTING,
  SAVE_DELAY_MS,
  listEncounters,
  loadEncounter,
  saveEncounter,
  deleteEncounter,
  flushEncounterSaves,
  hasPendingSaves,
};
