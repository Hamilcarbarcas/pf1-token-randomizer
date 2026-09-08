/* Saved Skills-tab snapshots (DESIGN.md §6).
 */

import { MODULE_ID } from "../core/const.mjs";

// ─── Skill Profiles ──────────────────────────────────────────────────────────────
// Named snapshots of a Skills-tab config (DESIGN.md §6). Loading one COPIES it into the
// draft and stamps provenance — the actor never re-reads the profile at placement, so
// editing or deleting a profile can't reach through to actors already configured.

/** The config keys a profile stores: the whole Skills tab minus its own bookkeeping. */
const SKILL_PROFILE_KEYS = ["entries", "listWeight", "classWeight", "nonClassWeight", "focus", "excluded", "wipeExisting"];

function getSkillProfiles() {
  const raw = game.settings.get(MODULE_ID, "skill-profiles");
  return Array.isArray(raw) ? raw : [];
}

/** Strip a Skills draft down to the storable profile config. */
function toSkillProfileConfig(settings) {
  const config = {};
  for (const key of SKILL_PROFILE_KEYS) config[key] = foundry.utils.deepClone(settings[key]);
  return config;
}


export {
  getSkillProfiles,
  toSkillProfileConfig,
};
