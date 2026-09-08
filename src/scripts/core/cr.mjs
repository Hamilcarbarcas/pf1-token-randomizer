/* Challenge Rating ↔ XP ↔ treasure value (DESIGN.md §13).
 *
 * Pure lookups over the SRD treasure-per-encounter table and the system's XP
 * ladder. No Foundry document access, so this is testable outside a world.
 */

import { LOG } from "./const.mjs";

// SRD "Treasure per Encounter", keyed by CR: [slow, medium, fast] in gp.
// Sub-1 keys are the system's exact CR sentinels, not real fractions — see crToKey.
const TREASURE_BY_CR = {
  0.125: [20, 35, 50],
  0.1625: [30, 45, 65],
  0.25: [40, 65, 100],
  0.3375: [55, 85, 135],
  0.5: [85, 130, 200],
  1: [170, 260, 400],
  2: [350, 550, 800],
  3: [550, 800, 1200],
  4: [750, 1150, 1700],
  5: [1000, 1550, 2300],
  6: [1350, 2000, 3000],
  7: [1750, 2600, 3900],
  8: [2200, 3350, 5000],
  9: [2850, 4250, 6400],
  10: [3650, 5450, 8200],
  11: [4650, 7000, 10500],
  12: [6000, 9000, 13500],
  13: [7750, 11600, 17500],
  14: [10000, 15000, 22000],
  15: [13000, 19500, 29000],
  16: [16500, 25000, 38000],
  17: [22000, 32000, 48000],
  18: [28000, 41000, 62000],
  19: [35000, 53000, 79000],
  20: [44000, 67000, 100000],
  21: [55000, 84000, 125000],
  22: [69000, 104000, 155000],
  23: [85000, 127000, 190000],
  24: [102000, 155000, 230000],
  25: [125000, 185000, 275000],
  26: [150000, 220000, 330000],
  27: [175000, 260000, 390000],
  28: [205000, 305000, 460000],
  29: [240000, 360000, 540000],
  30: [280000, 420000, 630000]
};

const MAX_TABLE_CR = 30;

// The system stores fractional CR as five fixed decimals that are NOT the fractions
// they stand for: 1/6 is 0.1625 and 1/3 is 0.3375 (pf1 utils/lib.mjs, CR.fromString).
// A lookup that computes the fraction misses every row below CR 1, so match the
// sentinels — with a tolerance wide enough to also accept a hand-typed 0.1667.
const CR_SENTINELS = [0.125, 0.1625, 0.25, 0.3375, 0.5];
const SENTINEL_TOLERANCE = 0.01;

// Column order of every TREASURE_BY_CR row. The @crLow/@crMed/@crHigh aliases and the
// UI's pace toggle both resolve through PACE_INDEX.
const PACE_KEYS = ["slow", "medium", "fast"];
const PACE_INDEX = {
  slow: 0, low: 0,
  medium: 1, med: 1,
  fast: 2, high: 2
};

/**
 * Normalize a CR number to a TREASURE_BY_CR key: a sentinel below 1, otherwise a
 * rounded integer clamped to the table. Returns null below the table's first row
 * (CR 0 creatures are worth no XP, so they contribute nothing to an encounter).
 */
function crToKey(cr) {
  const n = Number(cr);
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const s of CR_SENTINELS) {
    if (Math.abs(n - s) <= SENTINEL_TOLERANCE) return s;
  }
  if (n < CR_SENTINELS[0]) return null;
  const i = Math.round(n);
  if (i < 1) return null;
  return Math.min(i, MAX_TABLE_CR);
}

/** Whether a CR sits past the last table row, so the UI can say the value is capped. */
function crExceedsTable(cr) {
  const n = Number(cr);
  return Number.isFinite(n) && n > MAX_TABLE_CR;
}

/**
 * Expected treasure in gp for one encounter of this CR at the given pace
 * ("slow"/"low", "medium"/"med", "fast"/"high"). 0 below the table.
 */
function treasureForCR(cr, pace = "medium") {
  const key = crToKey(cr);
  if (key === null) return 0;
  const col = PACE_INDEX[String(pace).toLowerCase()] ?? PACE_INDEX.medium;
  return TREASURE_BY_CR[key][col];
}

// Test-only fallback: the system's ladder, used when pf1 is unavailable (scratchpad
// runs). In a live world pf1.utils.CR.getXP is always the authority.
const FALLBACK_CR_XP = [
  200, 400, 600, 800, 1200, 1600, 2400, 3200, 4800, 6400, 9600, 12800, 19200, 25600,
  38400, 51200, 76800, 102400, 153600, 204800, 307200, 409600, 614400, 819200, 1228800,
  1638400, 2457600, 3276800, 4915200, 6553600, 9830400
];

let _warnedNoPf1 = false;

/** XP awarded for defeating one creature of this CR. Below CR 1 the rule is 400 × CR. */
function xpForCR(cr) {
  const n = Number(cr);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const getXP = globalThis.pf1?.utils?.CR?.getXP;
  if (typeof getXP === "function") return getXP(n) ?? 0;
  if (!_warnedNoPf1) {
    console.warn(`${LOG} pf1.utils.CR unavailable; using the built-in XP ladder.`);
    _warnedNoPf1 = true;
  }
  if (n < 1) return Math.floor(Math.max(400 * n, 0));
  return FALLBACK_CR_XP[Math.min(Math.round(n), MAX_TABLE_CR)] ?? 0;
}

// Every table row paired with its XP, descending — the ladder the reverse lookup walks.
// Built lazily so import time never touches pf1.
let _ladder = null;

function crLadder() {
  if (_ladder) return _ladder;
  _ladder = Object.keys(TREASURE_BY_CR)
    .map(Number)
    .map(cr => ({ cr, xp: xpForCR(cr) }))
    .sort((a, b) => b.xp - a.xp);
  return _ladder;
}

/**
 * The encounter CR that a total XP budget corresponds to: the highest table row whose
 * XP value the total reaches. Null when the total is below the first row (DESIGN.md
 * §13.2 — this is what collapses a group of creatures to one budget).
 */
function encounterCRFromXP(totalXP) {
  const n = Number(totalXP);
  if (!Number.isFinite(n) || n <= 0) return null;
  for (const row of crLadder()) {
    if (n >= row.xp) return row.cr;
  }
  return null;
}

/**
 * Sum a list of CRs into an encounter CR. Returns the XP total alongside it so the UI
 * can show both figures rather than an unexplained CR (DESIGN.md §13.2).
 */
function encounterCR(crs) {
  const totalXP = (crs ?? []).reduce((sum, cr) => sum + xpForCR(cr), 0);
  return { totalXP, cr: encounterCRFromXP(totalXP) };
}

/** Human-readable CR, using the system's fraction strings below 1. */
function formatCR(cr) {
  if (cr === null || cr === undefined) return "—";
  const fromNumber = globalThis.pf1?.utils?.CR?.fromNumber;
  if (typeof fromNumber === "function") return fromNumber(cr);
  const names = { 0.125: "1/8", 0.1625: "1/6", 0.25: "1/4", 0.3375: "1/3", 0.5: "1/2" };
  return names[cr] ?? String(cr);
}

export {
  TREASURE_BY_CR,
  MAX_TABLE_CR,
  PACE_KEYS,
  crToKey,
  crExceedsTable,
  treasureForCR,
  xpForCR,
  encounterCRFromXP,
  encounterCR,
  formatCR,
};
