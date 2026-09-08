/* What an actor is already carrying, in gp (DESIGN.md §14).
 *
 * The SRD counts NPC gear against an encounter's treasure, so the budget is reduced
 * by whatever the participants already hold. All arithmetic is done in the lowest
 * denomination and converted once at the end, so no rounding accumulates.
 *
 * Values come from core PF1 — item.getValue / actor.getTotalCurrency — which already
 * handle stacks, charges, and the broken/timeworn multipliers.
 */

import { LOG } from "../core/const.mjs";

// Buckets every physical item falls into. Kept separate from the toggles so the UI can
// show what a toggle would add or remove without recomputing.
const WEALTH_PARTS = ["equippedGear", "carriedGear", "consumables", "ammo", "coins"];

function emptyParts() {
  return Object.fromEntries(WEALTH_PARTS.map(k => [k, 0]));
}

/** Coins per gp. Configurable in principle; 100 in every stock world. */
function standardRate() {
  return globalThis.pf1?.config?.currency?.standardRate || 100;
}

/**
 * Convert a lowest-denomination figure to gp for presentation.
 *
 * Everything is summed in copper so no rounding accumulates, but nothing outside this
 * module thinks in copper — the budget, the table and the UI are all gp. So the totals
 * and buckets are handed back in gp, with the exact integers kept alongside in `partsCp`
 * for anyone who needs to do further arithmetic without a round trip through a float.
 */
function toGp(cp) {
  return cp / standardRate();
}

/**
 * Which bucket an item belongs to. `contained` items are never "equipped" — worn gear
 * is what is on the creature, not what is in its pack, whatever `system.equipped` says
 * for an item that was dropped into a bag while still flagged.
 */
function bucketFor(item, contained) {
  if (item.type === "consumable") return "consumables";
  if (item.type === "loot" && item.subType === "ammo") return "ammo";
  if (!contained && item.system?.equipped === true) return "equippedGear";
  return "carriedGear";
}

/**
 * Total value of everything an actor holds, split into buckets.
 *
 * PRECONDITION: called as a GM. `getValue` returns the *unidentified* price when
 * `showUnidentifiedData` is true, and that getter is
 * `!game.user.isGM && system.identified === false` — so the identified price this
 * accounting wants is guaranteed only while the caller is a GM. The encounter window
 * is GM-only (§11); anything else calling this would silently undercount disguised loot.
 *
 * @param {Actor} actor
 * @param {object} [countExisting]              §14.2 toggles, all default on
 * @param {boolean} [countExisting.equipped]    count worn/wielded gear
 * @param {boolean} [countExisting.coins]       count currency
 * @param {boolean} [countExisting.consumables] count consumables AND ammunition
 * @returns {{gp: number, cp: number, parts: object, partsCp: object, counted: object,
 *   items: number}} `gp`/`parts` for reading, `cp`/`partsCp` for exact arithmetic.
 *   Buckets are reported whether or not a toggle counted them; `gp` is the counted total.
 */
function encounterCarriedValue(actor, { equipped = true, coins = true, consumables = true } = {}) {
  const partsCp = emptyParts();
  const counted = {
    equippedGear: equipped,
    carriedGear: true,
    consumables: consumables,
    ammo: consumables,
    coins: coins
  };
  let items = 0;

  const result = () => {
    const cp = WEALTH_PARTS.reduce((sum, k) => sum + (counted[k] ? partsCp[k] : 0), 0);
    const parts = Object.fromEntries(WEALTH_PARTS.map(k => [k, toGp(partsCp[k])]));
    return { gp: toGp(cp), cp, parts, partsCp, counted, items };
  };

  if (!actor) return result();

  const value = (item) => {
    try {
      // recursive:false — contents are walked here instead, so the toggles reach inside
      // containers. sellValue:1 is full value, not getValue's 50% default.
      return item.getValue({ sellValue: 1, recursive: false, inLowestDenomination: true }) || 0;
    } catch (err) {
      console.error(`${LOG} Could not value item "${item?.name}":`, err);
      return 0;
    }
  };

  const visit = (item, contained) => {
    if (!item?.isPhysical) return;
    items++;
    partsCp[bucketFor(item, contained)] += value(item);
    if (item.type !== "container") return;
    try {
      partsCp.coins += item.getTotalCurrency?.({ inLowestDenomination: true }) ?? 0;
      for (const sub of item.items ?? []) visit(sub, true);
    } catch (err) {
      console.error(`${LOG} Could not walk container "${item?.name}":`, err);
    }
  };

  // Container contents are child items, not actor-level ones, so the !inContainer
  // filter is defensive rather than load-bearing — but without it a future change to
  // that shape would double-count every packed item.
  for (const item of actor.items ?? []) {
    if (!item.isPhysical || item.inContainer) continue;
    visit(item, false);
  }

  try {
    partsCp.coins += actor.getTotalCurrency?.({ inLowestDenomination: true }) ?? 0;
  } catch (err) {
    console.error(`${LOG} Could not read currency for "${actor?.name}":`, err);
  }

  return result();
}

/**
 * The same, summed over an encounter's members. Buckets are summed too, so the window
 * can show one breakdown for the whole encounter (§14).
 */
function sumCarriedValue(actors, countExisting) {
  const partsCp = emptyParts();
  let cp = 0, items = 0, counted = null;
  for (const actor of actors ?? []) {
    const r = encounterCarriedValue(actor, countExisting);
    // Sum the copper, not the gp, so a long member list cannot drift on float addition.
    for (const k of WEALTH_PARTS) partsCp[k] += r.partsCp[k];
    cp += r.cp;
    items += r.items;
    counted ??= r.counted;
  }
  const parts = Object.fromEntries(WEALTH_PARTS.map(k => [k, toGp(partsCp[k])]));
  return { gp: toGp(cp), cp, parts, partsCp, counted: counted ?? {}, items };
}

/**
 * Budget arithmetic for the header readout (§14.3): what the encounter is worth, what
 * the participants already hold, and what is left to generate. Never goes negative —
 * an over-funded encounter reports 0 to generate and the surplus separately.
 */
function treasureShortfall(budgetGp, carriedGp) {
  const budget = Math.max(0, Number(budgetGp) || 0);
  const carried = Math.max(0, Number(carriedGp) || 0);
  const remaining = budget - carried;
  return {
    budget,
    carried,
    toGenerate: Math.max(0, remaining),
    overFunded: remaining < 0 ? -remaining : 0
  };
}

export {
  WEALTH_PARTS,
  encounterCarriedValue,
  sumCarriedValue,
  treasureShortfall,
};
