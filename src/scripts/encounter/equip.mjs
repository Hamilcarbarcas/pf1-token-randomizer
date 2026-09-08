/* Equipping generated gear, and the slot arithmetic PF1 leaves to us (DESIGN.md §17.4).
 *
 * `canEquip` in the system only guards the in-container case — nothing stops an actor
 * wearing three breastplates — so the capacity rules are ours to enforce.
 */

// Slots that hold more than one, or any number. Everything else holds exactly one.
// Two rings is legal, so the THIRD is the one that displaces something.
const SLOT_CAPACITY = { ring: 2, slotless: Infinity, other: Infinity };
const DEFAULT_CAPACITY = 1;

// Types that can be equipped at all. Weapons are included but exempt from displacement:
// carrying several is normal and PF1 has no weapon slot to contend for.
const EQUIPPABLE = new Set(["weapon", "equipment", "armor", "shield"]);

function capacityOf(slot) {
  return SLOT_CAPACITY[slot] ?? DEFAULT_CAPACITY;
}

function isEquippable(item) {
  return EQUIPPABLE.has(item?.type);
}

/** The slot an item competes for, or null when it competes for nothing. */
function slotOf(item) {
  if (!isEquippable(item)) return null;
  if (item.type === "weapon") return null;   // exempt — see EQUIPPABLE
  return item.system?.slot ?? item.subType ?? null;
}

/**
 * Work out the `updateEmbeddedDocuments` payload for equipping newly created loot.
 *
 * Returns updates for the new items **and** for any incumbent that has to come off. An
 * incumbent is *unequipped, never deleted* — the creature keeps the item, it just stops
 * wearing it.
 *
 * @param {Actor} actor      the actor the items were created on
 * @param {Array} created    the created Item documents, in payload order
 * @param {Array} lines      the lines they came from, same order
 * @param {boolean} equipDefault  the world setting; a line's own `equip` overrides it
 * @returns {Array} update objects, possibly empty
 */
function equipPlanFor(actor, created, lines, equipDefault = true) {
  const updates = [];
  // How many things already occupy each slot, so the cap is measured against reality
  // rather than against this batch alone.
  const occupancy = new Map();
  const newIds = new Set(created.map(i => i.id));
  for (const item of actor.items ?? []) {
    if (newIds.has(item.id)) continue;          // counted as we place them, below
    if (!item.system?.equipped) continue;
    const slot = slotOf(item);
    if (!slot) continue;
    if (!occupancy.has(slot)) occupancy.set(slot, []);
    occupancy.get(slot).push(item);
  }

  created.forEach((item, i) => {
    const line = lines[i];
    const wants = line?.equip ?? equipDefault;
    if (!wants || !isEquippable(item)) return;

    const slot = slotOf(item);
    if (slot) {
      const held = occupancy.get(slot) ?? [];
      const cap = capacityOf(slot);
      // Displace in item order: arbitrary, but deterministic, which is what matters when
      // a GM re-runs and expects the same result.
      while (held.length >= cap) {
        const evicted = held.shift();
        if (!evicted) break;
        updates.push({ _id: evicted.id, "system.equipped": false });
      }
      held.push(item);
      occupancy.set(slot, held);
    }

    updates.push({ _id: item.id, "system.equipped": true });
  });

  return updates;
}

export {
  SLOT_CAPACITY,
  EQUIPPABLE,
  capacityOf,
  isEquippable,
  slotOf,
  equipPlanFor,
};
