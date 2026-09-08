/* Resolving an encounter's members against the world (DESIGN.md §12.2).
 *
 * The one impure corner of the encounter domain: it turns cached uuids back into live
 * documents. Kept apart from record.mjs so that file stays synchronous and testable.
 */

import { LOG } from "../core/const.mjs";
import { sumCarriedValue } from "./wealth.mjs";

async function resolveUuid(uuid) {
  if (!uuid) return null;
  try {
    return await fromUuid(uuid);
  } catch (err) {
    console.error(`${LOG} Could not resolve ${uuid}:`, err);
    return null;
  }
}

/**
 * Refresh every member against the world.
 *
 * A member whose token is gone is **flagged, not dropped**: its cached name and CR keep
 * contributing, so deleting a token cannot silently change what the encounter is worth
 * after the loot was planned. A member that resolves has its cached fields refreshed, so
 * a renamed or re-CR'd creature stays current.
 *
 * @returns {{members: Array, actors: Array}} new member list and the live actors behind it
 */
async function syncEncounterMembers(record) {
  const out = [];
  const actors = [];
  for (const m of record?.members ?? []) {
    const tokenDoc = await resolveUuid(m.tokenUuid);
    const actor = tokenDoc?.actor ?? await resolveUuid(m.actorUuid);

    if (!tokenDoc && !actor) {
      out.push({ ...m, missing: true });
      continue;
    }
    if (actor) actors.push(actor);
    out.push({
      ...m,
      missing: false,
      actorUuid: actor?.uuid ?? m.actorUuid,
      name: tokenDoc?.name ?? actor?.name ?? m.name,
      img: tokenDoc?.texture?.src ?? actor?.img ?? m.img,
      cr: Number(actor?.system?.details?.cr?.total ?? m.cr) || 0
    });
  }
  return { members: out, actors };
}

/**
 * Members, their actors, and what they are already carrying — everything the window's
 * header needs in one pass, so a render resolves each uuid once rather than per readout.
 */
async function resolveEncounterState(record) {
  const { members, actors } = await syncEncounterMembers(record);
  const carried = sumCarriedValue(actors, record?.countExisting);
  return { members, actors, carried };
}

/** Target descriptors for the §17.1 strip: one per member that can hold loot. */
function memberTargets(members) {
  return (members ?? [])
    .map(m => ({
      id: m.tokenUuid ?? m.actorUuid,
      name: m.name,
      img: m.img,
      cr: m.cr,
      missing: m.missing === true
    }))
    // A member whose token is gone cannot receive items, so it is not a drop target —
    // but it stays visible in the member list, and its CR still counts.
    .filter(t => t.id && !t.missing);
}

export {
  syncEncounterMembers,
  resolveEncounterState,
  memberTargets,
};
