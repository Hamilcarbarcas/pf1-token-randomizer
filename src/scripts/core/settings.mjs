/* The per-actor / world-default getter pairs (DESIGN.md §1.1).
 * Registration itself lives in main.mjs, since the menu entries name the
 * window classes in apps/ and importing those here would invert the graph.
 */

import { DEFAULT_SEGMENT_WEIGHT, MODULE_ID, isRandomizableActor } from "./const.mjs";
import { SKILL_DEFAULTS } from "../skills/logic.mjs";

// ─── Settings Helpers ──────────────────────────────────────────────────────────

// The three getters below are also called with a null actor by the module-level
// "defaults" dialog, which is why the unsupported-type guard tests `actor &&` rather
// than `isRandomizableActor(actor)` outright: no actor means "editing the defaults",
// while an actor of an unsupported type means "this feature does not apply".
function unsupportedActor(actor) {
  return !!actor && !isRandomizableActor(actor);
}

function getActorRandomizerSettings(actor) {
  if (unsupportedActor(actor)) return { ...getDefaultRandomizerSettings(), enabled: false };
  const flags = actor?.getFlag?.(MODULE_ID, "abilityRandomizer") ?? actor?.flags?.[MODULE_ID]?.abilityRandomizer;
  const defaults = getDefaultRandomizerSettings();
  if (!flags) return defaults;
  return foundry.utils.mergeObject(defaults, flags, { inplace: false });
}

function getDefaultRandomizerSettings() {
  return game.settings.get(MODULE_ID, "ability-randomizer-defaults") || {
    enabled: false,
    method: "standard",
    prioritizeEnabled: false,
    priorities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    constraints: {
      str: { min: 3, max: 18, nil: false },
      dex: { min: 3, max: 18, nil: false },
      con: { min: 3, max: 18, nil: false },
      int: { min: 3, max: 18, nil: false },
      wis: { min: 3, max: 18, nil: false },
      cha: { min: 3, max: 18, nil: false }
    }
  };
}


/**
 * Bring a stored name-randomizer config up to the current segment-based schema.
 * The pre-1.0 shape was flat — { enabled, race, region, gender, regionalVariance } —
 * and drew a single whole name from a filtered pool. A config that actually selected
 * a Race/Region/Gender migrates to one `database` segment holding that filter at
 * default weight; `regionalVariance` is dropped (it is superseded by per-filter
 * weighting). A config with no filter selected — i.e. the plain default — becomes a
 * single `actor` (Actor Name) component instead. Already migrated configs (those with
 * a `segments` array) pass through unchanged.
 */
/**
 * Ensure every segment carries an `obscure` tag (default "both"), so pre-obscure
 * configs read back with an explicit mode. Non-destructive: an existing tag wins, and
 * any `obscuredText` is preserved.
 */
function withObscureDefaults(settings) {
  if (!Array.isArray(settings?.segments)) return settings;
  return { ...settings, segments: settings.segments.map(s => ({ obscure: "both", ...s })) };
}

function migrateNameSettings(settings) {
  if (!settings) return withObscureDefaults({ enabled: false, segments: [{ type: "actor" }] });
  if (Array.isArray(settings.segments)) return withObscureDefaults(settings);
  if (!settings.race && !settings.region && !settings.gender) {
    return withObscureDefaults({ enabled: !!settings.enabled, segments: [{ type: "actor" }] });
  }
  return withObscureDefaults({
    enabled: !!settings.enabled,
    segments: [{
      type: "database",
      nameType: "given",
      filters: [{
        race: settings.race ?? "",
        region: settings.region ?? "",
        gender: settings.gender ?? "",
        weight: DEFAULT_SEGMENT_WEIGHT
      }]
    }]
  });
}

function getActorNameRandomizerSettings(actor) {
  if (unsupportedActor(actor)) return { ...getDefaultNameRandomizerSettings(), enabled: false };
  const flags = actor?.getFlag?.(MODULE_ID, "nameRandomizer") ?? actor?.flags?.[MODULE_ID]?.nameRandomizer;
  const defaults = getDefaultNameRandomizerSettings();
  if (!flags) return defaults;
  // Migrate the raw flags first: the old shape stores its data in top-level keys
  // that would be lost if merged against a `segments`-based default.
  return foundry.utils.mergeObject(defaults, migrateNameSettings(flags), { inplace: false });
}

function getDefaultNameRandomizerSettings() {
  return migrateNameSettings(game.settings.get(MODULE_ID, "name-randomizer-defaults"));
}

function getActorTreasureRandomizerSettings(actor) {
  if (unsupportedActor(actor)) return { ...getDefaultTreasureRandomizerSettings(), enabled: false };
  const flags = actor?.getFlag?.(MODULE_ID, "treasureRandomizer") ?? actor?.flags?.[MODULE_ID]?.treasureRandomizer;
  const defaults = getDefaultTreasureRandomizerSettings();
  if (!flags) return defaults;
  return foundry.utils.mergeObject(defaults, flags, { inplace: false });
}

function getDefaultTreasureRandomizerSettings() {
  return game.settings.get(MODULE_ID, "treasure-randomizer-defaults") || {
    enabled: false,
    goldFormula: "",
    randomizeDistribution: false,
    distribution: {
      pp: { pct: 0, min: 0, max: 100 },
      gp: { pct: 100, min: 0, max: 100 },
      sp: { pct: 0, min: 0, max: 100 },
      cp: { pct: 0, min: 0, max: 100 }
    }
  };
}

/**
 * Force `focus` into its per-group object shape. An earlier draft of this feature stored
 * a single number there; merged over the object default it would survive as a number,
 * and every `focus[source]` lookup would come back undefined.
 */
function normalizeSkillSettings(settings) {
  const focus = settings?.focus;
  if (focus && typeof focus === "object") return settings;
  return { ...settings, focus: { list: 0, class: 0, nonClass: 0 } };
}

function getActorSkillRandomizerSettings(actor) {
  if (unsupportedActor(actor)) return { ...getDefaultSkillRandomizerSettings(), enabled: false };
  const flags = actor?.getFlag?.(MODULE_ID, "skillRandomizer") ?? actor?.flags?.[MODULE_ID]?.skillRandomizer;
  const defaults = getDefaultSkillRandomizerSettings();
  if (!flags) return defaults;
  return normalizeSkillSettings(foundry.utils.mergeObject(defaults, flags, { inplace: false }));
}

function getDefaultSkillRandomizerSettings() {
  return normalizeSkillSettings(
    game.settings.get(MODULE_ID, "skill-randomizer-defaults") || foundry.utils.deepClone(SKILL_DEFAULTS)
  );
}

/**
 * Check whether ANY randomizer feature is enabled for an actor
 */
function isAnyRandomizerEnabled(actor) {
  const abilitySettings = getActorRandomizerSettings(actor);
  const nameSettings = getActorNameRandomizerSettings(actor);
  const treasureSettings = getActorTreasureRandomizerSettings(actor);
  const skillSettings = getActorSkillRandomizerSettings(actor);
  return abilitySettings.enabled || nameSettings.enabled || treasureSettings.enabled || skillSettings.enabled;
}


export {
  getActorNameRandomizerSettings,
  getActorRandomizerSettings,
  getActorSkillRandomizerSettings,
  getActorTreasureRandomizerSettings,
  getDefaultNameRandomizerSettings,
  getDefaultRandomizerSettings,
  getDefaultSkillRandomizerSettings,
  getDefaultTreasureRandomizerSettings,
  isAnyRandomizerEnabled,
  normalizeSkillSettings,
};
