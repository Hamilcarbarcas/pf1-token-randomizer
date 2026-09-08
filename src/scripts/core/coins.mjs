/* Coin denominations and the maths for breaking a value into them.
 *
 * Imports nothing: both the Part I treasure randomizer and the encounter window need
 * this, and they sit at opposite ends of the dependency order (DESIGN.md §10.2).
 *
 * The governing rule is that denomination weights are relative **counts**, not relative
 * value. See denominationCounts.
 */

const COIN_ORDER = ["pp", "gp", "sp", "cp"];
// Value of one coin of each denomination, in copper.
const COIN_CP = { pp: 1000, gp: 100, sp: 10, cp: 1 };

/** A coin pool as a single copper figure. */
function poolToCp(pool) {
  return COIN_ORDER.reduce((sum, k) => sum + (Math.max(0, Math.floor(Number(pool?.[k]) || 0)) * COIN_CP[k]), 0);
}

/**
 * Copper back into coins, using no denomination larger than the pool started with.
 *
 * This is what stops a purse of 100 gp being handed back as platinum after a split: the
 * pool's own composition sets the ceiling, and the remainder falls down through sp and
 * cp — which is the §17.3 remainder rule, arrived at by the same route.
 */
function cpToCoins(cp, maxDenom = "pp") {
  const start = Math.max(0, COIN_ORDER.indexOf(maxDenom));
  const out = { pp: 0, gp: 0, sp: 0, cp: 0 };
  let rest = Math.max(0, Math.floor(cp));
  for (let i = start; i < COIN_ORDER.length; i++) {
    const k = COIN_ORDER[i];
    out[k] = Math.floor(rest / COIN_CP[k]);
    rest -= out[k] * COIN_CP[k];
  }
  return out;
}

/**
 * Blend a set of base weights toward a random draw.
 *
 * `randomness` 0 returns the base proportions untouched; 1 ignores them entirely. In
 * between it interpolates, so one slider spans "as even as the integers allow" through
 * "genuinely random" without needing a separate mode.
 *
 * Entries whose base weight is zero stay zero at every randomness — a denomination or
 * target weighted out is excluded, not merely unlikely.
 */
function blendWeights(base, randomness, rng) {
  const r = Math.min(1, Math.max(0, Number(randomness) || 0));
  const live = base.map(w => (Number(w) > 0 ? Number(w) : 0));
  const baseSum = live.reduce((a, b) => a + b, 0);
  if (baseSum <= 0) return live.map(() => 0);
  const norm = live.map(w => w / baseSum);
  if (r <= 0) return norm;

  const draw = live.map(w => (w > 0 ? rng() + 1e-9 : 0));
  const drawSum = draw.reduce((a, b) => a + b, 0) || 1;
  return norm.map((p, i) => (1 - r) * p + r * (draw[i] / drawSum));
}

/**
 * Break a value into coin **counts** weighted by denomination (not by value).
 *
 * The weights say how many coins of each kind there are, so equal weights across all
 * four denominations produce roughly equal *piles*, not equal worth: 100 gp becomes
 * 9 pp, 9 gp, 9 sp and 10 cp. Weighting by value instead would give 25 gp worth of each,
 * which is 2 pp and 2 500 cp — not what "an even mix of coins" means to anyone.
 *
 * The total is exact: any copper the proportional pass cannot place is made into change
 * from the largest weighted denomination down, with copper as the final fallback since
 * it always divides.
 *
 * @param {number} valueCp   total to break up, in copper
 * @param {object} weights   { pp, gp, sp, cp } — relative counts, any scale
 * @param {object} [opts]    { randomness = 0, rng = Math.random }
 * @returns {{pp: number, gp: number, sp: number, cp: number}}
 */
function denominationCounts(valueCp, weights, { randomness = 0, rng = Math.random } = {}) {
  const out = { pp: 0, gp: 0, sp: 0, cp: 0 };
  let total = Math.max(0, Math.floor(Number(valueCp) || 0));
  if (total <= 0) return out;

  const base = COIN_ORDER.map(k => Math.max(0, Number(weights?.[k]) || 0));
  let p = blendWeights(base, randomness, rng);
  // Every denomination weighted out: fall back to gold rather than returning nothing.
  if (p.every(v => v <= 0)) p = COIN_ORDER.map(k => (k === "gp" ? 1 : 0));

  // Mean copper value of one drawn coin, so the coin count follows from the total.
  const unit = COIN_ORDER.reduce((s, k, i) => s + p[i] * COIN_CP[k], 0);
  if (unit > 0) {
    const coins = total / unit;
    COIN_ORDER.forEach((k, i) => {
      const n = Math.floor(coins * p[i]);
      if (n > 0 && n * COIN_CP[k] <= total) {
        out[k] = n;
        total -= n * COIN_CP[k];
      }
    });
  }

  // Make change for the rest, preferring denominations the weights actually allow.
  for (let i = 0; i < COIN_ORDER.length; i++) {
    const k = COIN_ORDER[i];
    if (p[i] <= 0) continue;
    const n = Math.floor(total / COIN_CP[k]);
    if (n > 0) { out[k] += n; total -= n * COIN_CP[k]; }
  }
  // Copper always divides, so this cannot leave a remainder.
  if (total > 0) { out.cp += total; total = 0; }
  return out;
}

/** The largest denomination actually present in a pool; "cp" for an empty pool. */
function largestDenomination(pool) {
  for (const k of COIN_ORDER) {
    if ((Number(pool?.[k]) || 0) > 0) return k;
  }
  return "cp";
}

export {
  COIN_ORDER,
  COIN_CP,
  poolToCp,
  cpToCoins,
  largestDenomination,
  blendWeights,
  denominationCounts,
};
