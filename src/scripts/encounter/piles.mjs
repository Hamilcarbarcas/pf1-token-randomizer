/* Item Piles interop (DESIGN.md §19).
 *
 * Entirely optional and deliberately thin: one helper that turns tokens into lootable
 * piles. Containers are NOT a target type — a GM makes a pile however they like and adds
 * its token to the encounter as a member, where it behaves like any other target. See
 * §19.4 for why the built-in container system was removed.
 */

import { LOG } from "../core/const.mjs";

const ITEM_PILES = "item-piles";

/** Whether containers are available at all. Checked at every entry point, never cached. */
function itemPilesActive() {
  return !!game.modules?.get(ITEM_PILES)?.active && !!game.itempiles?.API;
}

/**
 * §19.3 — turn tokens into lootable piles. Independent of any encounter: this is the
 * "the fight is over, make the corpses lootable" button.
 */
async function pilesFromTokens(tokens = null, { defeatedOnly = false } = {}) {
  if (!itemPilesActive()) {
    return ui.notifications?.warn(game.i18n.localize("TR.Pile.NotInstalled"));
  }
  let list = tokens ?? canvas?.tokens?.controlled ?? [];
  if (defeatedOnly) list = list.filter(t => t.combatant?.isDefeated ?? t.document?.combatant?.isDefeated);
  if (!list.length) return ui.notifications?.warn(game.i18n.localize("TR.Encounter.NoSelection"));

  try {
    const docs = list.map(t => t.document ?? t);
    await game.itempiles.API.turnTokensIntoItemPiles(docs);
    ui.notifications?.info(game.i18n.format("TR.Pile.Converted", { count: docs.length }));
  } catch (err) {
    console.error(`${LOG} Could not convert tokens to piles:`, err);
    ui.notifications?.error(game.i18n.localize("TR.Pile.ConvertFailed"));
  }
}

export {
  ITEM_PILES,
  itemPilesActive,
  pilesFromTokens,
};
