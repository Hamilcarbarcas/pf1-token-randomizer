/* Skill profile manager — rename, delete, reorder (DESIGN.md §6.2).
 */

import { MODULE_ID } from "../core/const.mjs";
import { ApplicationV2, HandlebarsApplicationMixin } from "../core/appv2.mjs";
import { clampGroupWeight, skillLabel } from "../skills/logic.mjs";
import { getSkillProfiles } from "../skills/profiles.mjs";

// ─── Skill Profile Manager (rename / delete / reorder) ───────────────────────────
// Profiles are CREATED from either settings dialog; this window is the only place they
// can be renamed or deleted (DESIGN.md §6.2). To change a profile's *contents*, load it
// into the defaults dialog, edit, and save over the same name.

class TokenRandomizerSkillProfiles extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-skill-profiles"],
    tag: "div",
    window: { title: "TR.Window.SkillProfiles", icon: "fas fa-book", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      removeProfile: TokenRandomizerSkillProfiles.#onRemoveProfile,
      moveProfileUp: TokenRandomizerSkillProfiles.#onMoveProfileUp,
      moveProfileDown: TokenRandomizerSkillProfiles.#onMoveProfileDown,
      save: TokenRandomizerSkillProfiles.#onSave,
      cancel: TokenRandomizerSkillProfiles.#onCancel
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/skill-profiles.hbs` }
  };

  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = "token-randomizer-skill-profiles";
    return applied;
  }

  async _prepareContext(options) {
    // Draft copy so renames/deletes only commit on Save (Cancel discards them).
    if (!this.draft) this.draft = foundry.utils.deepClone(getSkillProfiles());
    const list = this.draft;
    return {
      profiles: list.map((p, index) => {
        const config = p.config ?? {};
        const entries = config.entries ?? [];
        return {
          index,
          isFirst: index === 0,
          isLast: index === list.length - 1,
          name: p.name ?? "",
          // Enough of a fingerprint to tell two profiles apart at a glance.
          summary: game.i18n.format("TR.SkillProfile.Summary", {
            skills: entries.length,
            excluded: (config.excluded ?? []).length,
            cls: clampGroupWeight(config.classWeight),
            other: clampGroupWeight(config.nonClassWeight)
          }),
          skills: entries.map(e => skillLabel(e?.key)).join(", ")
        };
      }),
      hasProfiles: list.length > 0
    };
  }

  _onRender(context, options) {
    this.element.querySelectorAll(".skill-profile-name").forEach(el => {
      el.addEventListener("change", (e) => {
        this.draft[Number(e.currentTarget.dataset.index)].name = e.currentTarget.value;
      });
    });
  }

  static async #onRemoveProfile(event, target) {
    const index = Number(target.dataset.index);
    const profile = this.draft[index];
    const safe = foundry.utils.escapeHTML?.(profile?.name ?? "") ?? profile?.name ?? "";
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Dialog.DeleteSkillProfile.Title") },
      content: game.i18n.format("TR.Dialog.DeleteSkillProfile.Content", { name: safe })
    });
    if (!ok) return;
    this.draft.splice(index, 1);
    this.render();
  }

  static #onMoveProfileUp(event, target) {
    const i = Number(target.dataset.index);
    if (i <= 0) return;
    [this.draft[i - 1], this.draft[i]] = [this.draft[i], this.draft[i - 1]];
    this.render();
  }

  static #onMoveProfileDown(event, target) {
    const i = Number(target.dataset.index);
    if (i >= this.draft.length - 1) return;
    [this.draft[i + 1], this.draft[i]] = [this.draft[i], this.draft[i + 1]];
    this.render();
  }

  static async #onSave(event, target) {
    const seen = new Set();
    for (let i = 0; i < this.draft.length; i++) {
      const name = String(this.draft[i].name ?? "").trim();
      if (!name) {
        ui.notifications?.warn(game.i18n.format("TR.Notif.SkillProfileNeedsName", { num: i + 1 }));
        return;
      }
      const key = name.toLowerCase();
      if (seen.has(key)) {
        ui.notifications?.warn(game.i18n.format("TR.Notif.SkillProfileDuplicate", { name }));
        return;
      }
      seen.add(key);
      this.draft[i].name = name;
    }
    await game.settings.set(MODULE_ID, "skill-profiles", this.draft);
    ui.notifications?.info(
      this.draft.length === 1
        ? game.i18n.localize("TR.Notif.SkillProfilesSavedOne")
        : game.i18n.format("TR.Notif.SkillProfilesSavedMany", { count: this.draft.length })
    );
    this.close();
  }

  static #onCancel(event, target) {
    this.close();
  }
}


export {
  TokenRandomizerSkillProfiles,
};
