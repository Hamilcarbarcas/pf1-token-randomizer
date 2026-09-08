/* PF1 Token Randomizer — entry point.
 *
 * Randomizes ability scores, names, skill ranks and carried treasure for unlinked
 * tokens as they are placed. This file owns the hooks, the settings registration
 * and the public API; everything else lives in the modules it imports.
 */

import { LOG, MODULE_ID, isRandomizableActor } from "./core/const.mjs";
import { encounterCR, encounterCRFromXP, formatCR, treasureForCR, xpForCR } from "./core/cr.mjs";
import { encounterCarriedValue, sumCarriedValue, treasureShortfall } from "./encounter/wealth.mjs";
import {
  clearIndexCache, getTreasureCategories, getTreasureSources, registerTreasureProvider,
  resolveCategoryPools,
} from "./encounter/sources.mjs";
import { rollHoard } from "./encounter/roll-mix.mjs";
import { applyEncounter, applyPlan, undoEncounter } from "./encounter/apply.mjs";
import { equipPlanFor } from "./encounter/equip.mjs";
import { itemPilesActive, pilesFromTokens } from "./encounter/piles.mjs";
import {
  applyProfileToRecord, getHoardProfiles, profileFromRecord, saveProfileFromRecord,
} from "./encounter/profiles.mjs";
import {
  addMember, createEncounter, defaultMixFor, encounterBudget, encounterPlan,
  hoardValue, memberFromToken, normalizeEncounter, unassignedLines,
} from "./encounter/record.mjs";
import {
  deleteEncounter, flushEncounterSaves, listEncounters, loadEncounter, saveEncounter,
} from "./encounter/store.mjs";
import { resolveEncounterState, syncEncounterMembers } from "./encounter/resolve.mjs";
import { crWeights, distributeLines, splitCurrency } from "./encounter/distribute.mjs";
import { EncounterTreasureApp } from "./apps/encounter-app.mjs";
import { EncounterPicker, openEncounters } from "./apps/encounter-picker.mjs";
import { DEFAULT_KNOWN_SUBSKILLS, SKILL_DEFAULTS, buildSkillSlots, computeSkillBudget, seedKnownSubSkills, skillRankCap } from "./skills/logic.mjs";
import { isAnyRandomizerEnabled } from "./core/settings.mjs";
import { randomizeTokenAbilityScores, randomizeTokenName, randomizeTokenSkills, randomizeTokenTreasure } from "./randomizers/workers.mjs";
import { TokenRandomizerSettings, updateRandomizerButtonColor } from "./apps/settings-app.mjs";
import { TokenRandomizerListManager } from "./apps/list-manager.mjs";
import { TokenRandomizerStatMethods } from "./apps/stat-methods.mjs";
import { TokenRandomizerSkillProfiles } from "./apps/skill-profiles.mjs";
import { TokenRandomizerSubSkillGroups } from "./apps/subskill-groups.mjs";
import { defineDualRange } from "../common/elements/dual-range.mjs";

// ─── Header Button Hook ────────────────────────────────────────────────────────

Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  if (!game.user?.isGM) return;

  const actor = sheet.actor;
  if (!isRandomizableActor(actor)) return;
  if (actor.isToken) return;
  if (actor.prototypeToken?.actorLink) return;

  buttons.unshift({
    label: game.i18n.localize("TR.Button.Randomizer"),
    class: "token-randomizer-settings",
    icon: "fas fa-dice",
    onclick: () => {
      new TokenRandomizerSettings({ actor }).render(true);
    }
  });
});


Hooks.on("renderActorSheet", (sheet, html) => {
  updateRandomizerButtonColor(sheet);
});

// ─── Prototype-token contamination ─────────────────────────────────────────────
// Core's "Assign as Prototype Token" copies a placed token's data wholesale —
// toObject(), flags and all — over actor.prototypeToken. That bakes the per-placement
// `randomized` mark into the prototype, so every token stamped from it afterwards
// arrives pre-marked and skips the randomizers forever (DESIGN.md §1.5). The flag is
// meaningless on a prototype, so strip it wherever it turns up.

/** Remove the placement-only `randomized` mark from an actor's prototype token. */
async function scrubPrototypeFlag(actor) {
  if (!actor?.prototypeToken?.getFlag?.(MODULE_ID, "randomized")) return false;
  await actor.update({ [`prototypeToken.flags.${MODULE_ID}.-=randomized`]: null });
  console.warn(`${LOG} Cleared inherited "randomized" flag from prototype token of ${actor.name}.`);
  return true;
}

// The assignment itself passes noHook:true, which suppresses preUpdateActor — the
// post-update hook still fires, so catch it there. Only the acting GM cleans up, so
// concurrent GMs don't race on the same write.
Hooks.on("updateActor", async (actor, change, options, userId) => {
  if (game.userId !== userId) return;
  if (!game.user?.isGM) return;
  if (!("prototypeToken" in (change ?? {}))) return;

  if (await scrubPrototypeFlag(actor)) {
    ui.notifications?.info(game.i18n.format("TR.Notif.PrototypeScrubbed", { name: actor.name }));
  }
});

// ─── Token Creation Hook ───────────────────────────────────────────────────────

Hooks.on("createToken", async (tokenDoc, options, userId) => {
  if (game.userId !== userId) return;
  if (!game.user?.isGM) return;
  if (tokenDoc.actorLink) return;
  // Vehicles, traps, haunts and the like never get a config button, so they must never
  // be randomized off the world defaults either.
  if (!isRandomizableActor(tokenDoc.actor)) return;

  // Heal a prototype contaminated before this fix shipped (or by a client without it):
  // clear it at the source, and treat this token's inherited mark as absent so the
  // randomizers still run for it.
  let inherited = false;
  if (tokenDoc.baseActor?.prototypeToken?.getFlag?.(MODULE_ID, "randomized")) {
    inherited = true;
    await scrubPrototypeFlag(tokenDoc.baseActor);
  }

  // Skip if already randomized — region teleport recreates the token from
  // existing data (including this flag), which would otherwise re-randomize.
  if (!inherited && tokenDoc.getFlag(MODULE_ID, "randomized")) return;

  await randomizeTokenAbilityScores(tokenDoc);
  // Skills must follow abilities: the rank budget is derived from Intelligence.
  await randomizeTokenSkills(tokenDoc);
  await randomizeTokenName(tokenDoc);
  await randomizeTokenTreasure(tokenDoc);

  // Mark as randomized so teleporting to another scene doesn't re-randomize.
  if (isAnyRandomizerEnabled(tokenDoc.actor)) {
    await tokenDoc.setFlag(MODULE_ID, "randomized", true);
  }
});

// ─── Token Config: Obscured-name controls (Identity tab) ─────────────────────────
// Injects a per-token override into the token configuration so a GM can flip obscuring
// on/off and set the obscured name directly — covering linked/named tokens that never
// pass through the placement-time name builder, plus ad-hoc adjustments. The inputs are
// named `flags.<module>.<key>`, so core's form submission persists them for free.

Hooks.on("renderTokenConfig", (app, html) => {
  if (!game.user?.isGM) return;
  if (!game.settings.get(MODULE_ID, "enable-obscured-npc-names")) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  if (root.querySelector(".token-randomizer-obscure")) return; // guard against re-render

  const tokenDoc = app.document ?? app.token ?? app.object;
  const obscure = tokenDoc?.getFlag?.(MODULE_ID, "obscure") ?? false;
  const obscuredName = tokenDoc?.getFlag?.(MODULE_ID, "obscuredName") ?? "";
  const esc = (s) => foundry.utils.escapeHTML?.(String(s)) ?? String(s);

  const wrap = document.createElement("div");
  wrap.className = "token-randomizer-obscure";
  wrap.innerHTML = `
    <div class="form-group">
      <label>${game.i18n.localize("TR.TokenConfig.Obscure")}</label>
      <input type="checkbox" name="flags.${MODULE_ID}.obscure" ${obscure ? "checked" : ""}/>
      <p class="hint">${game.i18n.localize("TR.TokenConfig.ObscureHint")}</p>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize("TR.TokenConfig.ObscuredName")}</label>
      <input type="text" name="flags.${MODULE_ID}.obscuredName" value="${esc(obscuredName)}" placeholder="${game.i18n.localize("TR.TokenConfig.ObscuredNamePlaceholder")}"/>
      <p class="hint">${game.i18n.localize("TR.TokenConfig.ObscuredNameHint")}</p>
    </div>`;

  // Prefer to sit right under the token's own name field (Identity tab); fall back to
  // the identity tab section, then the form, so a core DOM change degrades gracefully.
  const nameGroup = root.querySelector('input[name="name"]')?.closest(".form-group");
  const identityTab = root.querySelector('.tab[data-tab="identity"]')
    ?? root.querySelector('.tab[data-tab="character"]');
  if (nameGroup) nameGroup.after(wrap);
  else if (identityTab) identityTab.appendChild(wrap);
  else root.querySelector("form")?.appendChild(wrap);

  // Content grew — let the auto-sized window re-fit.
  app.setPosition?.({ height: "auto" });
});

// ─── Obscured-name display substitution ──────────────────────────────────────────
// Real-name-primary model: `token.name` is always the true name; users without at
// least Observer permission are shown the stored obscured name at DISPLAY time, per
// client. Every surface funnels through the one `shouldObscure` gate below, so adding
// the canvas nameplate later is just another call site — no new policy logic.

/** The obscured name stored on a token, or "" when none/blank. */
function getObscuredName(tokenDoc) {
  return tokenDoc?.getFlag?.(MODULE_ID, "obscuredName") || "";
}

/**
 * Whether `user` should see `tokenDoc`'s obscured name instead of its real one. True
 * only when: the feature is on, the token opts in (`obscure` flag truthy), a non-empty
 * obscured name exists, and the user lacks Observer permission on the token's actor.
 * GMs always hold Observer, so they always see the real name.
 */
function shouldObscure(tokenDoc, user = game.user) {
  if (!tokenDoc) return false;
  if (!game.settings.get(MODULE_ID, "enable-obscured-npc-names")) return false;
  if (!tokenDoc.getFlag?.(MODULE_ID, "obscure")) return false;
  if (!getObscuredName(tokenDoc)) return false;
  const actor = tokenDoc.actor;
  if (!actor) return false;
  return !actor.testUserPermission(user, "OBSERVER");
}

/** Resolve a chat message's speaker to its TokenDocument, or null. */
function speakerToken(message) {
  const speaker = message?.speaker;
  if (!speaker?.token) return null;
  const scene = speaker.scene ? game.scenes.get(speaker.scene) : null;
  return scene?.tokens.get(speaker.token) ?? null;
}

/**
 * The name `user` should see for `tokenDoc`: its obscured name when the obscure
 * gate applies, otherwise its real `token.name`. This is the single authoritative
 * entry point other modules/macros should call so they never leak the real name.
 */
function getDisplayName(tokenDoc, user = game.user) {
  if (!tokenDoc) return "";
  return shouldObscure(tokenDoc, user) ? getObscuredName(tokenDoc) : (tokenDoc.name ?? "");
}

/**
 * Convenience wrapper resolving a chat-message speaker to the name `user` should see.
 * Falls back to the speaker's stored alias when there is no token to obscure.
 */
function getSpeakerDisplayName(speaker, user = game.user) {
  const scene = speaker?.scene ? game.scenes.get(speaker.scene) : null;
  const tokenDoc = speaker?.token && scene ? scene.tokens.get(speaker.token) : null;
  if (tokenDoc && shouldObscure(tokenDoc, user)) return getObscuredName(tokenDoc);
  return speaker?.alias ?? tokenDoc?.name ?? "";
}

// Public API so other modules/macros can resolve obscured names through the one gate
// above, instead of re-implementing the policy (and risking a real-name leak).
Hooks.once("setup", () => {
  const mod = game.modules.get(MODULE_ID);
  if (!mod) return;
  mod.api = Object.assign(mod.api ?? {}, {
    getObscuredName,
    shouldObscure,
    getDisplayName,
    getSpeakerDisplayName,
    // Skill randomizer internals, exposed so a GM can check what an actor would get
    // without placing a token.
    computeSkillBudget,
    skillRankCap,
    buildSkillSlots,
    // Encounter treasure value model (DESIGN.md §13), exposed for the same reason:
    // the CR arithmetic is checkable from console before any UI exists.
    treasureForCR,
    xpForCR,
    encounterCR,
    encounterCRFromXP,
    formatCR,
    // §14 — what participants already carry. GM-only: see the precondition on
    // encounterCarriedValue, which is why this is not exposed to players.
    encounterCarriedValue,
    sumCarriedValue,
    treasureShortfall,
    // §15/§16 — sources, and the roller. `rollHoard` is pure: resolve the pools with
    // resolveCategoryPools first, then hand them to it.
    getTreasureCategories,
    getTreasureSources,
    resolveCategoryPools,
    registerTreasureProvider,
    rollHoard,
    // §18 — the only code that writes to an actor.
    applyPlan,
    applyEncounter,
    undoEncounter,
    equipPlanFor,
    // §19 — containers, and the corpse-conversion helper.
    itemPilesActive,
    pilesFromTokens,
    // §20 — hoard profiles.
    getHoardProfiles,
    profileFromRecord,
    applyProfileToRecord,
    saveProfileFromRecord,
    // §12 — the record and its storage seam. These four are the only supported way to
    // touch the `encounters` setting; reading it directly misses queued saves.
    createEncounter,
    normalizeEncounter,
    memberFromToken,
    addMember,
    defaultMixFor,
    encounterBudget,
    encounterPlan,
    hoardValue,
    unassignedLines,
    listEncounters,
    loadEncounter,
    saveEncounter,
    deleteEncounter,
    flushEncounterSaves,
    // §17 — resolution and distribution, plus the windows.
    syncEncounterMembers,
    resolveEncounterState,
    distributeLines,
    splitCurrency,
    crWeights,
    encounters: {
      open: openEncounters,
      pilesFromTokens,
      App: EncounterTreasureApp,
      Picker: EncounterPicker
    },
  });
});

// ─── Encounter treasure entry points (§11) ─────────────────────────────────────
// All GM-only, and all gated on the world setting. Registration happens once at ready,
// which is why flipping the gate requires a reload.

function encounterTreasureEnabled() {
  try {
    return game.user?.isGM && game.settings.get(MODULE_ID, "encounter-treasure-enabled");
  } catch {
    return false;
  }
}

/**
 * Whether to offer the "Loot Piles from Selected" control.
 *
 * Deliberately NOT gated on encounter treasure: turning corpses into lootable piles is
 * a standalone convenience, and a GM may want it without the encounter window. Off as
 * shipped, and inert without Item Piles — the setting is forced off and greyed in the
 * config menu when the module is absent, but this is still checked, since a world that
 * had it enabled and later disabled Item Piles keeps the stored `true`.
 */
function pilesButtonEnabled() {
  try {
    return game.user?.isGM && itemPilesActive()
      && game.settings.get(MODULE_ID, "encounter-piles-button");
  } catch {
    return false;
  }
}

Hooks.on("getSceneControlButtons", (controls) => {
  // The piles control lives in the TOKEN group, not with the encounter window in Notes:
  // switching layers clears the token selection, so a control that acts on the selected
  // tokens can only ever find them on the layer that owns them.
  if (pilesButtonEnabled()) {
    const tokens = controls.tokens;
    if (tokens?.tools) {
      tokens.tools.tokenRandomizerPiles = {
        name: "tokenRandomizerPiles",
        order: 90,
        title: "TR.Pile.Corpses",
        icon: "fas fa-box-open",
        button: true,
        onChange: () => pilesFromTokens()
      };
    }
  }

  if (!encounterTreasureEnabled()) return;
  const notes = controls.notes;
  if (!notes?.tools) return;

  notes.tools.tokenRandomizerEncounters = {
    name: "tokenRandomizerEncounters",
    order: 90,
    title: "TR.Window.EncounterPicker",
    icon: "fas fa-sack-dollar",
    button: true,
    onChange: () => openEncounters()
  };
});

// Journal directory header button. The header markup is not a stable contract, so this
// tries a couple of likely containers and gives up quietly rather than throwing.
Hooks.on("renderJournalDirectory", (app, html) => {
  if (!encounterTreasureEnabled()) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".token-randomizer-encounters-btn")) return;
  const host = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  if (!host) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "token-randomizer-encounters-btn";
  btn.innerHTML = `<i class="fas fa-sack-dollar"></i> ${game.i18n.localize("TR.Encounter.DirectoryButton")}`;
  btn.addEventListener("click", () => openEncounters());
  host.appendChild(btn);
});

// A pack edited mid-session must not keep serving a stale price index (§15.2).
for (const hook of ["updateCompendium", "createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (doc) => {
    const packId = doc?.pack ?? (typeof doc === "string" ? doc : doc?.collection);
    if (packId) clearIndexCache(packId);
  });
}

// Settings writes need a logged-in GM, so the one-time speciality seed waits for `ready`.
Hooks.once("ready", () => {
  seedKnownSubSkills().catch(err => console.error(`${LOG} Seeding speciality lists failed.`, err));
});

// Chat: swap the speaker name in the message header (core `<h4 class="message-sender">`)
// for non-observers. Header only in v1 — scanning the card body is deferred.
Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!game.settings.get(MODULE_ID, "enable-obscured-npc-names")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const tokenDoc = speakerToken(message);
  if (!shouldObscure(tokenDoc)) return;

  const sender = root.querySelector(".message-sender");
  if (sender) sender.textContent = getObscuredName(tokenDoc);
});

// Combat tracker: swap each combatant's displayed name (core `.token-name strong.name`)
// for non-observers. Re-fires on turn changes, so it self-heals.
Hooks.on("renderCombatTracker", (app, html) => {
  if (!game.settings.get(MODULE_ID, "enable-obscured-npc-names")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const combat = app?.viewed ?? game.combat;
  if (!root || !combat) return;

  for (const li of root.querySelectorAll("li.combatant[data-combatant-id]")) {
    const combatant = combat.combatants.get(li.dataset.combatantId);
    const tokenDoc = combatant?.token;
    if (!shouldObscure(tokenDoc)) continue;
    const nameEl = li.querySelector(".token-name .name") ?? li.querySelector(".token-name");
    if (nameEl) nameEl.textContent = getObscuredName(tokenDoc);
  }
});

// Canvas nameplate: on hover / Alt-highlight, if the token's display mode leaves the
// player with NO name (core sets `nameplate.visible = false`), show the obscured name
// instead. Runs in `refreshToken`, after core's `_refreshState`/`_refreshNameplate`, so
// it can't be clobbered and there is no real-name flash. Never overrides a name the
// display mode already grants (guarded by `np.visible`), so tokens set to show everyone
// a name are left alone.
Hooks.on("refreshToken", (token) => {
  const isHover = token?.hover || token?.layer?.highlightObjects;
  if (!isHover) return;
  if (!game.settings.get(MODULE_ID, "obscure-name-on-hover")) return;
  const np = token.nameplate;
  if (!np || np.visible) return;
  if (!shouldObscure(token.document)) return; // also checks the master setting
  np.text = getObscuredName(token.document);
  np.visible = true;
});

// Present "Show Obscured Name on Hover" as a nested sub-option of its master toggle in
// the core Configure Settings menu: indent it, and disable/dim it while the master
// "Enable Obscured NPC Names" setting is off. Core has no native setting dependencies,
// so this is done by post-processing the rendered menu (inputs are named `<ns>.<key>`).
Hooks.on("renderSettingsConfig", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const master = root.querySelector(`[name="${MODULE_ID}.enable-obscured-npc-names"]`);
  const sub = root.querySelector(`[name="${MODULE_ID}.obscure-name-on-hover"]`);
  const subGroup = sub?.closest(".form-group");
  if (!master || !sub || !subGroup) return;

  subGroup.classList.add("tr-suboption");
  const sync = () => {
    const on = master.checked;
    sub.disabled = !on;
    subGroup.classList.toggle("tr-disabled", !on);
  };
  sync();
  master.addEventListener("change", sync);
});

// The loot-piles control cannot do anything without Item Piles, so its setting is pinned
// off and dimmed rather than left as a toggle that silently achieves nothing. Unchecking
// as well as disabling matters: a disabled checkbox still submits its own state, so a
// world that once had Item Piles writes `false` back on the next Save.
Hooks.on("renderSettingsConfig", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const input = root?.querySelector(`[name="${MODULE_ID}.encounter-piles-button"]`);
  const group = input?.closest(".form-group");
  if (!input || !group || itemPilesActive()) return;

  input.checked = false;
  input.disabled = true;
  group.classList.add("tr-disabled");
  const hint = group.querySelector(".hint");
  if (hint) hint.textContent = game.i18n.localize("TR.Settings.PilesButton.Missing");
});

// ─── Register Settings ─────────────────────────────────────────────────────────

Hooks.once("init", () => {
  // Comparison helper used by the settings template ({{#if (eq a b)}}).
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }

  // Tag is prefixed with the module id so two modules carrying this shared element
  // at different versions cannot fight over one global name. See common/DESIGN.md §2.
  defineDualRange(MODULE_ID);

  game.settings.register(MODULE_ID, "ability-randomizer-defaults", {
    name: "TR.Settings.AbilityDefaults.Name",
    hint: "TR.Settings.AbilityDefaults.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: {
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
    }
  });

  game.settings.register(MODULE_ID, "name-randomizer-defaults", {
    name: "TR.Settings.NameDefaults.Name",
    hint: "TR.Settings.NameDefaults.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: {
      enabled: false,
      segments: [{ type: "actor" }]
    }
  });

  game.settings.register(MODULE_ID, "treasure-randomizer-defaults", {
    name: "TR.Settings.TreasureDefaults.Name",
    hint: "TR.Settings.TreasureDefaults.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: {
      enabled: false,
      goldFormula: "",
      randomizeDistribution: false,
      distribution: {
        pp: { pct: 0, min: 0, max: 100 },
        gp: { pct: 100, min: 0, max: 100 },
        sp: { pct: 0, min: 0, max: 100 },
        cp: { pct: 0, min: 0, max: 100 }
      }
    }
  });

  game.settings.register(MODULE_ID, "skill-randomizer-defaults", {
    name: "TR.Settings.SkillDefaults.Name",
    hint: "TR.Settings.SkillDefaults.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(SKILL_DEFAULTS)
  });

  // Named snapshots of a Skills-tab config. Saveable from either the per-actor dialog or
  // the defaults dialog; only the Manage Skill Profiles menu can rename or delete one.
  game.settings.register(MODULE_ID, "skill-profiles", {
    name: "TR.Settings.SkillProfiles.Name",
    hint: "TR.Settings.SkillProfiles.Hint",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // The §11 gate. Controls UI *registration*, not the code path: with it off the
  // encounter modules still load but nothing surfaces. requiresReload because the scene
  // control and directory button are wired once, at startup.
  game.settings.register(MODULE_ID, "encounter-treasure-enabled", {
    name: "TR.Settings.EncounterEnabled.Name",
    hint: "TR.Settings.EncounterEnabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true
  });

  // §19.3 — the "Loot Piles from Selected" token control. Off as shipped: it is an
  // interop convenience, and a scene control is expensive screen real estate to spend on
  // a module the world may not have.
  game.settings.register(MODULE_ID, "encounter-piles-button", {
    name: "TR.Settings.PilesButton.Name",
    hint: "TR.Settings.PilesButton.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => ui.controls?.render()
  });

  // §17.4 — the starting state of each generated item's Equip flag. A line may still
  // override it either way; this only decides what an un-opinionated line does.
  game.settings.register(MODULE_ID, "encounter-equip-generated", {
    name: "TR.Settings.EquipGenerated.Name",
    hint: "TR.Settings.EquipGenerated.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Encounter treasure (DESIGN.md §15). Categories are named groups of sources; the
  // defaults ship as constants rather than as the setting `default`, so a world that
  // has never opened the config still generates (see getTreasureCategories).
  game.settings.register(MODULE_ID, "treasure-categories", {
    name: "TR.Settings.TreasureCategories.Name",
    hint: "TR.Settings.TreasureCategories.Hint",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, "treasure-sources", {
    name: "TR.Settings.TreasureSources.Name",
    hint: "TR.Settings.TreasureSources.Hint",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // §20 — named snapshots of the treasure mix. Presets ship as constants (see
  // getHoardProfiles), so this stays empty until a GM saves one.
  game.settings.register(MODULE_ID, "hoard-profiles", {
    name: "TR.Settings.HoardProfiles.Name",
    hint: "TR.Settings.HoardProfiles.Hint",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Saved encounters (§12). Written only through encounter/store.mjs, which debounces
  // and re-reads before every write — the whole array is rewritten each save.
  game.settings.register(MODULE_ID, "encounters", {
    name: "TR.Settings.Encounters.Name",
    hint: "TR.Settings.Encounters.Hint",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Named member lists a Craft/Perform/Profession/Art/Lore entry can draw one subskill
  // from. Each declares the parent skill it belongs to.
  game.settings.register(MODULE_ID, "subskill-groups", {
    name: "TR.Settings.SubSkillGroups.Name",
    hint: "TR.Settings.SubSkillGroups.Hint",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Autocomplete source for subskill name fields: { <arbitrary skill key>: "a; b; c" }.
  game.settings.register(MODULE_ID, "known-subskills", {
    name: "TR.Settings.KnownSubSkills.Name",
    hint: "TR.Settings.KnownSubSkills.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(DEFAULT_KNOWN_SUBSKILLS)
  });

  // Which seed revision this world has taken; see seedKnownSubSkills().
  game.settings.register(MODULE_ID, "known-subskills-seed", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(MODULE_ID, "custom-stat-methods", {
    name: "TR.Settings.CustomStatMethods.Name",
    hint: "TR.Settings.CustomStatMethods.Hint",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Master switch for the obscured-name feature. Gates both the per-segment obscure
  // controls in the Name tab and the display-time substitution consumers. World-scoped
  // so a client's obscure decision is consistent for everyone.
  game.settings.register(MODULE_ID, "enable-obscured-npc-names", {
    name: "TR.Settings.ObscureNames.Name",
    hint: "TR.Settings.ObscureNames.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // Sub-toggle of the above: reveal the obscured name on canvas hover / Alt-highlight
  // when the token's display mode would otherwise show the player no name. Has no
  // effect unless the master setting is on (the hover handler checks both).
  game.settings.register(MODULE_ID, "obscure-name-on-hover", {
    name: "TR.Settings.ObscureOnHover.Name",
    hint: "TR.Settings.ObscureOnHover.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.registerMenu(MODULE_ID, "randomizer-defaults-menu", {
    name: "TR.Menu.Defaults.Name",
    label: "TR.Menu.Defaults.Label",
    hint: "TR.Menu.Defaults.Hint",
    icon: "fas fa-dice",
    type: TokenRandomizerSettings,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "randomizer-lists-menu", {
    name: "TR.Menu.Lists.Name",
    label: "TR.Menu.Lists.Label",
    hint: "TR.Menu.Lists.Hint",
    icon: "fas fa-list",
    type: TokenRandomizerListManager,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "randomizer-stat-methods-menu", {
    name: "TR.Menu.StatMethods.Name",
    label: "TR.Menu.StatMethods.Label",
    hint: "TR.Menu.StatMethods.Hint",
    icon: "fas fa-dice-d6",
    type: TokenRandomizerStatMethods,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "randomizer-skill-profiles-menu", {
    name: "TR.Menu.SkillProfiles.Name",
    label: "TR.Menu.SkillProfiles.Label",
    hint: "TR.Menu.SkillProfiles.Hint",
    icon: "fas fa-book",
    type: TokenRandomizerSkillProfiles,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "randomizer-subskill-groups-menu", {
    name: "TR.Menu.SubSkillGroups.Name",
    label: "TR.Menu.SubSkillGroups.Label",
    hint: "TR.Menu.SubSkillGroups.Hint",
    icon: "fas fa-layer-group",
    type: TokenRandomizerSubSkillGroups,
    restricted: true
  });
});

window.TokenRandomizerSettings = TokenRandomizerSettings;
window.TokenRandomizerListManager = TokenRandomizerListManager;
window.TokenRandomizerStatMethods = TokenRandomizerStatMethods;
window.TokenRandomizerSkillProfiles = TokenRandomizerSkillProfiles;
window.TokenRandomizerSubSkillGroups = TokenRandomizerSubSkillGroups;
