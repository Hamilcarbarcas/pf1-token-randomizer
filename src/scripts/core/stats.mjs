/* Ability-score generation methods: the built-in table, the custom records
 * layered over it, the dice helpers, and constraint-aware assignment.
 */

import { ABILITY_KEYS, LOG, MODULE_ID } from "./const.mjs";

// Built-in `label` values are i18n keys; getAllStatMethods() localizes them at use time.
const STAT_METHODS = {
  "standard": { label: "TR.StatMethod.Standard", values: [13, 12, 11, 10, 9, 8] },
  "elite": { label: "TR.StatMethod.Elite", values: [15, 14, 13, 12, 11, 8] },
  "champion": { label: "TR.StatMethod.Champion", values: [18, 17, 14, 13, 10, 9] },
  "random-low": { label: "TR.StatMethod.RandomLow", roll: () => rollDice(3, 6) },
  "random-high": { label: "TR.StatMethod.RandomHigh", roll: () => rollDice(4, 6, 1) },
  "random-extreme": { label: "TR.StatMethod.RandomExtreme", roll: () => rollDice(4, 6, 1), postProcess: boostLowestTo18 }
};

// ─── Custom Stat Methods (user-defined arrays & formulas) ───────────────────────
// GMs can define extra generation methods in the "Manage Stat Methods" menu; they
// are stored as a world setting and merged into STAT_METHODS at use time. Each record
// is one of:
//   • { id, type: "array",   label, values: [6 numbers] }  — fixed array (like Elite)
//   • { id, type: "formula", label, formula: "4d6dl1"    }  — dice formula, rolled per ability
// Custom ids are random ("custom-<id>") so they never collide with the built-ins.

/** Read the raw custom-method records from settings (always an array). */
function getCustomStatMethods() {
  const raw = game.settings.get(MODULE_ID, "custom-stat-methods");
  return Array.isArray(raw) ? raw : [];
}

/**
 * The full generation-method map: built-ins plus any valid custom records, keyed by
 * id. Malformed customs (wrong value count, blank formula) are skipped so a bad entry
 * can never break the dropdown or generation. The composed label mirrors the built-in
 * style, appending the values/formula in parentheses.
 */
function getAllStatMethods() {
  const all = {};
  // Localize built-in labels (stored as i18n keys) as they are copied in.
  for (const [key, config] of Object.entries(STAT_METHODS)) {
    all[key] = { ...config, label: game.i18n.localize(config.label) };
  }
  for (const m of getCustomStatMethods()) {
    if (!m?.id) continue;
    if (m.type === "formula") {
      const formula = String(m.formula ?? "").trim();
      if (!formula) continue;
      all[m.id] = { label: `${m.label || m.id} (${formula})`, formula };
    } else {
      const values = Array.isArray(m.values) ? m.values.map(Number) : [];
      if (values.length !== ABILITY_KEYS.length || values.some(v => !Number.isFinite(v))) continue;
      all[m.id] = { label: `${m.label || m.id} (${values.join(", ")})`, values };
    }
  }
  return all;
}

// ─── Dice Helpers ──────────────────────────────────────────────────────────────

/**
 * Roll dice and optionally drop lowest
 */
function rollDice(count, sides, dropLowest = 0) {
  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  rolls.sort((a, b) => b - a);
  return rolls.slice(0, count - dropLowest).reduce((sum, val) => sum + val, 0);
}

/**
 * Replace the lowest value in an array of scores with 18
 */
function boostLowestTo18(scores) {
  let minIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < scores[minIdx]) minIdx = i;
  }
  scores[minIdx] = 18;
  return scores;
}

/**
 * Evaluate a per-ability score formula (e.g. "4d6dl1", "3d6", "2d6+6") once, using
 * the same dice engine and roll data as the treasure formula so `@`-references and
 * dice modifiers behave like every other formula field. Rounds to an integer and
 * falls back to 10 on any parse error.
 */
async function rollFormulaScore(formula, actor) {
  try {
    const rollData = actor?.getRollData?.() ?? {};
    const roll = new pf1.dice.RollPF(String(formula), rollData);
    await roll.evaluate({ async: true });
    return Math.round(roll.total ?? 10);
  } catch (err) {
    console.error(`${LOG} Stat score formula error:`, err);
    ui.notifications?.warn(game.i18n.format("TR.Notif.ScoreFormulaError", { formula }));
    return 10;
  }
}

async function generateScores(method, actor = null) {
  const config = getAllStatMethods()[method];
  if (!config) return [10, 10, 10, 10, 10, 10];
  if (config.values) return [...config.values];
  if (config.formula) {
    const scores = [];
    for (let i = 0; i < ABILITY_KEYS.length; i++) scores.push(await rollFormulaScore(config.formula, actor));
    return scores;
  }
  if (config.roll) {
    let scores = ABILITY_KEYS.map(() => config.roll());
    if (config.postProcess) scores = config.postProcess(scores);
    return scores;
  }
  return [10, 10, 10, 10, 10, 10];
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ─── Ability Score Assignment ──────────────────────────────────────────────────

function assignScoresWithConstraints(scores, constraints, prioritizeEnabled = false, priorities = {}, abilityKeys = ABILITY_KEYS) {
  const sortedScores = [...scores].sort((a, b) => b - a);
  const result = {};
  const usedIndices = new Set();

  let abilityOrder;
  if (prioritizeEnabled) {
    const grouped = {};
    for (const ability of abilityKeys) {
      const pri = priorities[ability] ?? 0;
      if (!grouped[pri]) grouped[pri] = [];
      grouped[pri].push(ability);
    }
    for (const pri of Object.keys(grouped)) {
      shuffleArray(grouped[pri]);
    }
    abilityOrder = Object.keys(grouped)
      .sort((a, b) => Number(b) - Number(a))
      .flatMap(pri => grouped[pri]);
  } else {
    abilityOrder = shuffleArray([...abilityKeys]);
  }

  for (const ability of abilityOrder) {
    const min = constraints[ability]?.min ?? 3;
    const max = constraints[ability]?.max ?? 18;
    const pri = prioritizeEnabled ? (priorities[ability] ?? 0) : 0;

    const fittingIndices = [];
    for (let i = 0; i < sortedScores.length; i++) {
      if (usedIndices.has(i)) continue;
      if (sortedScores[i] >= min && sortedScores[i] <= max) {
        fittingIndices.push(i);
      }
    }

    if (fittingIndices.length > 0) {
      let chosenIdx;
      if (prioritizeEnabled && pri > 0) {
        chosenIdx = fittingIndices[0]; // highest available
      } else {
        chosenIdx = fittingIndices[Math.floor(Math.random() * fittingIndices.length)];
      }
      result[ability] = sortedScores[chosenIdx];
      usedIndices.add(chosenIdx);
      continue;
    }

    // No fitting score — find closest
    let bestIdx = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < sortedScores.length; i++) {
      if (usedIndices.has(i)) continue;
      const score = sortedScores[i];
      const distance = score < min ? min - score : score - max;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      result[ability] = sortedScores[bestIdx];
      usedIndices.add(bestIdx);
    }
  }

  // Clamp
  for (const ability of abilityKeys) {
    const min = constraints[ability]?.min ?? 3;
    const max = constraints[ability]?.max ?? 18;
    if (result[ability] < min) result[ability] = min;
    if (result[ability] > max) result[ability] = max;
  }
  return result;
}


export {
  assignScoresWithConstraints,
  generateScores,
  getAllStatMethods,
  getCustomStatMethods,
  shuffleArray,
};
