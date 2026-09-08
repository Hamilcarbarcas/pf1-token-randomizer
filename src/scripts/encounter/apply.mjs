/* Writing an encounter's loot to the world, and taking it back (DESIGN.md §18).
 *
 * The only place in the feature that touches an actor. Everything above it plans; this
 * commits. Two properties matter more than anything else here:
 *
 *   • it records exactly what it created, so Undo can be exact rather than heuristic;
 *   • it is best-effort on the way back — an item the players already sold cannot be
 *     reclaimed, and saying so is better than failing or driving a purse negative.
 */

import { LOG, MODULE_ID } from "../core/const.mjs";
import { COIN_ORDER, poolToCp } from "../core/coins.mjs";
import { reallocateCoin } from "./distribute.mjs";
import { equipPlanFor } from "./equip.mjs";

/** The flag every created item carries, so it is identifiable without the record. */
const LOOT_FLAG = "encounterLoot";

/**
 * Group a record's lines by the target they are assigned to.
 * Unassigned lines are not written — the tray is a staging area, not a destination.
 */
function linesByTarget(record) {
  const byTarget = new Map();
  const assignment = record?.assignment ?? {};
  for (const line of record?.lines ?? []) {
    const target = assignment[line.id];
    if (!target) continue;
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(line);
  }
  return byTarget;
}

/** Coin owed to each target, from the split. Targets with none are omitted. */
function coinsByTarget(record) {
  const out = new Map();
  for (const [target, coins] of Object.entries(record?.currency?.split ?? {})) {
    if (poolToCp(coins) > 0) out.set(target, coins);
  }
  return out;
}

/**
 * What Apply would do, without doing it — the confirmation dialog's source of truth and
 * the reason a GM is never asked to approve a number they cannot see.
 */
function applyPlan(record) {
  const items = linesByTarget(record);
  const coins = coinsByTarget(record);
  const targets = new Set([...items.keys(), ...coins.keys()]);
  let itemCount = 0;
  for (const lines of items.values()) itemCount += lines.reduce((s, l) => s + l.qty, 0);
  const unassigned = (record?.lines ?? []).filter(l => !(record?.assignment ?? {})[l.id]);
  return {
    targets: targets.size,
    itemCount,
    coinTargets: coins.size,
    unassignedCount: unassigned.reduce((s, l) => s + l.qty, 0),
    unassignedValue: unassigned.reduce((s, l) => s + l.value * l.qty, 0)
  };
}

/**
 * Which of an encounter's targets no longer resolve.
 *
 * Run BEFORE anything is written. Discovering a dead token halfway through Apply leaves
 * the encounter half-committed: the items bound for it are never created, yet they are
 * still assigned to an id whose card the window no longer draws, so they read as having
 * vanished. Checking first turns that into a repairable state (§18.4).
 */
async function findMissingTargets(record) {
  const ids = new Set([
    ...Object.values(record?.assignment ?? {}).filter(Boolean),
    ...Object.keys(record?.currency?.split ?? {})
  ]);
  const missing = [];
  for (const id of ids) {
    if (!(await resolveActor(id))) missing.push(id);
  }
  return missing;
}

/**
 * Repair a record whose targets have partly gone away: return their items to the tray and
 * share their coin out among the survivors (§18.4). Pure apart from the ids handed in.
 *
 * @returns {{record: object, returned: number, coinMoved: number}}
 */
function pruneMissingTargets(record, missingIds, denomWeights = null) {
  const gone = new Set(missingIds ?? []);
  const assignment = {};
  let returned = 0;
  for (const [lineId, target] of Object.entries(record?.assignment ?? {})) {
    if (gone.has(target)) returned++;
    else assignment[lineId] = target;
  }
  const { split, moved } = reallocateCoin(record?.currency?.split ?? {}, [...gone], denomWeights);
  return {
    record: { ...record, assignment, currency: { ...record.currency, split } },
    returned,
    coinMoved: moved
  };
}

async function resolveActor(uuid) {
  try {
    const doc = await fromUuid(uuid);
    return doc?.actor ?? (doc?.documentName === "Actor" ? doc : null);
  } catch (err) {
    console.error(`${LOG} Could not resolve target ${uuid}:`, err);
    return null;
  }
}

/**
 * Build the item data for one line.
 *
 * The compendium document is the source, not the line: the line only carries the price
 * (which may have been jittered per §15.4) and the quantity.
 */
async function itemDataFor(line, encounterId) {
  const source = await fromUuid(line.uuid);
  if (!source) {
    console.warn(`${LOG} Loot item no longer exists: ${line.uuid} ("${line.name}")`);
    return null;
  }
  const data = source.toObject();
  delete data._id;
  data.system ??= {};
  data.system.quantity = line.qty;
  // The rolled price is the authority — the budget was spent against it.
  if (Number.isFinite(line.value)) data.system.price = line.value;
  data.flags ??= {};
  data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), [LOOT_FLAG]: { encounterId, lineId: line.id } };
  return data;
}

/**
 * Write the encounter to the world.
 *
 * One `createEmbeddedDocuments` and at most one `update` per actor, so each re-preps
 * once rather than per item.
 *
 * @returns {{applied: object, errors: string[]}} the §18.2 record, and anything skipped
 */
async function applyEncounter(record, { equipDefault = true } = {}) {
  const errors = [];
  const applied = {
    at: Date.now(),
    byUserId: game.user?.id ?? null,
    items: [],       // { actorUuid, itemIds: [] }
    currency: []     // { actorUuid, delta: {pp,gp,sp,cp} }
  };

  const items = linesByTarget(record);
  const coins = coinsByTarget(record);
  for (const target of new Set([...items.keys(), ...coins.keys()])) {
    const actor = await resolveActor(target);
    if (!actor) {
      errors.push(game.i18n.format("TR.Encounter.ApplyNoActor", { target }));
      continue;
    }

    // ── items ──
    const lines = items.get(target) ?? [];
    const payload = [];
    for (const line of lines) {
      const data = await itemDataFor(line, record.id);
      if (!data) {
        errors.push(game.i18n.format("TR.Encounter.ApplyMissingItem", { name: line.name }));
        continue;
      }
      payload.push({ data, line });
    }

    if (payload.length) {
      try {
        const created = await actor.createEmbeddedDocuments("Item", payload.map(p => p.data));
        applied.items.push({ actorUuid: actor.uuid, itemIds: created.map(i => i.id) });

        // Equipping is a second pass: it needs the created ids, and it may have to
        // unequip an incumbent that the same call just competed with (§17.4).
        const plan = equipPlanFor(actor, created, payload.map(p => p.line), equipDefault);
        if (plan.length) await actor.updateEmbeddedDocuments("Item", plan);
      } catch (err) {
        console.error(`${LOG} Could not create loot on ${actor.name}:`, err);
        errors.push(game.i18n.format("TR.Encounter.ApplyItemsFailed", { name: actor.name }));
      }
    }

    // ── currency ──
    const delta = coins.get(target);
    if (delta) {
      try {
        const current = actor.system?.currency ?? {};
        const update = {};
        for (const k of COIN_ORDER) {
          update[`system.currency.${k}`] = (Number(current[k]) || 0) + (Number(delta[k]) || 0);
        }
        await actor.update(update);
        applied.currency.push({ actorUuid: actor.uuid, delta: { ...delta } });
      } catch (err) {
        console.error(`${LOG} Could not add coin to ${actor.name}:`, err);
        errors.push(game.i18n.format("TR.Encounter.ApplyCoinFailed", { name: actor.name }));
      }
    }
  }

  return { applied, errors };
}

/**
 * Take it back.
 *
 * Best-effort by design (§18.2): an item the players have moved, sold or deleted, or coin
 * they have spent, cannot be reclaimed. Each shortfall is reported rather than silently
 * swallowed, and currency is floored at zero — driving a purse negative to balance the
 * books would be a worse lie than admitting the coin is gone.
 */
async function undoEncounter(record) {
  const errors = [];
  const applied = record?.applied;
  if (!applied?.at) return { errors: [game.i18n.localize("TR.Encounter.UndoNotApplied")] };

  for (const entry of applied.items ?? []) {
    const actor = await resolveActor(entry.actorUuid);
    if (!actor) {
      errors.push(game.i18n.format("TR.Encounter.UndoNoActor", { target: entry.actorUuid }));
      continue;
    }
    // Only ids that are still there: deleting a missing one throws and would abandon
    // the rest of the batch.
    const present = (entry.itemIds ?? []).filter(id => actor.items.get(id));
    const gone = (entry.itemIds ?? []).length - present.length;
    if (gone > 0) {
      errors.push(game.i18n.format("TR.Encounter.UndoItemsGone", { count: gone, name: actor.name }));
    }
    if (present.length) {
      try {
        await actor.deleteEmbeddedDocuments("Item", present);
      } catch (err) {
        console.error(`${LOG} Could not remove loot from ${actor.name}:`, err);
        errors.push(game.i18n.format("TR.Encounter.UndoItemsFailed", { name: actor.name }));
      }
    }
  }

  for (const entry of applied.currency ?? []) {
    const actor = await resolveActor(entry.actorUuid);
    if (!actor) continue;
    try {
      const current = actor.system?.currency ?? {};
      const update = {};
      let short = false;
      for (const k of COIN_ORDER) {
        const have = Number(current[k]) || 0;
        const owed = Number(entry.delta?.[k]) || 0;
        if (owed > have) short = true;
        update[`system.currency.${k}`] = Math.max(0, have - owed);
      }
      await actor.update(update);
      if (short) errors.push(game.i18n.format("TR.Encounter.UndoCoinShort", { name: actor.name }));
    } catch (err) {
      console.error(`${LOG} Could not remove coin from ${actor.name}:`, err);
      errors.push(game.i18n.format("TR.Encounter.UndoCoinFailed", { name: actor.name }));
    }
  }

  return { errors };
}

export {
  LOOT_FLAG,
  linesByTarget,
  coinsByTarget,
  applyPlan,
  findMissingTargets,
  pruneMissingTargets,
  itemDataFor,
  applyEncounter,
  undoEncounter,
};
