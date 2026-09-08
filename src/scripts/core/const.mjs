/* Shared constants. Imports nothing, by design — this is the base of the
 * dependency graph and the thing that keeps every other module acyclic.
 */

/* PF1 Token Randomizer
 *
 * Randomizes ability scores, names, and carried treasure for unlinked tokens
 * when they are placed on a scene. Adds a configuration button to PF1 character
 * and NPC sheets, plus a module-level "defaults" dialog for new actors.
 */

const MODULE_ID = "pf1-token-randomizer";
const LOG = "PF1 Token Randomizer |";

// Actor types this module knows how to randomize. Everything the randomizers touch —
// ability scores, currency, PC/NPC-shaped names — only exists on these two. Other PF1
// types (vehicle, trap, haunt, basic) never get a config button, so without this gate
// they would silently inherit the *world defaults* at token placement and have
// `system.abilities` / `system.currency` written onto schemas that don't have them.
const RANDOMIZABLE_ACTOR_TYPES = ["character", "npc"];

/** Whether the randomizers apply to this actor at all (see RANDOMIZABLE_ACTOR_TYPES). */
function isRandomizableActor(actor) {
  return !!actor && RANDOMIZABLE_ACTOR_TYPES.includes(actor.type);
}

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
// Values are i18n keys, resolved via game.i18n.localize() at use time.
const ABILITY_NAMES = {
  str: "TR.Ability.str",
  dex: "TR.Ability.dex",
  con: "TR.Ability.con",
  int: "TR.Ability.int",
  wis: "TR.Ability.wis",
  cha: "TR.Ability.cha"
};

// ─── Treasure / Currency ────────────────────────────────────────────────────────
const COIN_KEYS = ["pp", "gp", "sp", "cp"];
// Values are i18n keys, resolved via game.i18n.localize() at use time.
const COIN_NAMES = { pp: "TR.Coin.pp", gp: "TR.Coin.gp", sp: "TR.Coin.sp", cp: "TR.Coin.cp" };
// Value of one coin of each type, expressed in gold pieces.
const COIN_GP_VALUE = { pp: 10, gp: 1, sp: 0.1, cp: 0.01 };

const DEFAULT_SEGMENT_WEIGHT = 5;

export {
  ABILITY_KEYS,
  ABILITY_NAMES,
  COIN_GP_VALUE,
  COIN_KEYS,
  COIN_NAMES,
  DEFAULT_SEGMENT_WEIGHT,
  LOG,
  MODULE_ID,
  isRandomizableActor,
};
