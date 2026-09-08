/* Coin value and denomination split (DESIGN.md §1.1). Part II builds on this.
 */

import { COIN_KEYS, LOG } from "../core/const.mjs";
import { denominationCounts } from "../core/coins.mjs";
import { treasureForCR } from "../core/cr.mjs";

// ─── Treasure Logic ──────────────────────────────────────────────────────────

/**
 * Resolve the gold-value formula to a number. Supports dice and PF1 actor roll
 * data, plus the `@cr` shorthand (e.g. "2d6*100", "@cr * 50"). Returns 0 on
 * empty/invalid.
 */
async function resolveGoldValue(formula, actor) {
  if (!formula || !String(formula).trim()) return 0;
  try {
    const rollData = actor?.getRollData?.() ?? {};
    // Convenience alias: `@cr` → the actor's total CR (details.cr.total), so users
    // don't have to type the full path. Defaults to 0 for actors without a CR.
    rollData.cr = foundry.utils.getProperty(rollData, "details.cr.total") ?? 0;
    // Table aliases (DESIGN.md §13.4): the SRD treasure value for this CR at each
    // pace. These are PER-ENCOUNTER figures applied to one token, so a formula that
    // uses them on a group of creatures wants a divisor — see the README.
    rollData.crLow = rollData.crSlow = treasureForCR(rollData.cr, "slow");
    rollData.crMed = rollData.crMedium = treasureForCR(rollData.cr, "medium");
    rollData.crHigh = rollData.crFast = treasureForCR(rollData.cr, "fast");
    const roll = new pf1.dice.RollPF(String(formula), rollData);
    await roll.evaluate({ async: true });
    return Math.max(0, roll.total ?? 0);
  } catch (err) {
    console.error(`${LOG} Treasure gold formula error:`, err);
    ui.notifications?.warn(game.i18n.format("TR.Notif.GoldFormulaError", { formula }));
    return 0;
  }
}

/**
 * Produce the proportion (0–1) of total value assigned to each coin type.
 * Fixed mode normalizes the four percentages by their sum; randomized mode picks
 * a random integer within each [min,max] then normalizes those by their sum.
 * Returns all-zero proportions if the weights sum to 0.
 */
function computeDistributionProportions(settings) {
  const weights = {};
  for (const k of COIN_KEYS) {
    const d = settings.distribution?.[k] ?? {};
    if (settings.randomizeDistribution) {
      const a = Math.max(0, Math.min(100, d.min ?? 0));
      const b = Math.max(0, Math.min(100, d.max ?? 100));
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      weights[k] = lo + Math.floor(Math.random() * (hi - lo + 1));
    } else {
      weights[k] = Math.max(0, d.pct ?? 0);
    }
  }
  const sum = COIN_KEYS.reduce((s, k) => s + weights[k], 0);
  const props = {};
  for (const k of COIN_KEYS) props[k] = sum > 0 ? weights[k] / sum : 0;
  return props;
}

/**
 * Convert a total gold value and per-type proportions into coin counts.
 *
 * **The proportions are relative coin COUNTS, not shares of value** — an even mix means
 * roughly as many coppers as platinum, not an equal number of gp in each. 100 gp split
 * evenly is 9 pp / 9 gp / 9 sp / 10 cp, where the old value-based reading gave 2 pp and
 * 2 500 cp. Shared with the encounter window so both behave alike (DESIGN.md §17.3).
 *
 * The full value is now placed rather than floored away: the remainder is made into
 * change from the largest weighted denomination down.
 */
function distributionToCoins(goldValue, props) {
  return denominationCounts(Math.round((Number(goldValue) || 0) * 100), props);
}


export {
  computeDistributionProportions,
  distributionToCoins,
  resolveGoldValue,
};
