/* Subskill groups and speciality autocomplete lists (DESIGN.md §4.9, §4.10).
 */

import { MODULE_ID } from "../core/const.mjs";
import { ApplicationV2, HandlebarsApplicationMixin } from "../core/appv2.mjs";
import { DEFAULT_KNOWN_SUBSKILLS, FALLBACK_ARBITRARY_SKILLS, getKnownSubSkills, getKnownSubSkillsFor, getSubSkillGroups, groupMembers, parseSubSkillList, skillLabel } from "../skills/logic.mjs";

// ─── Subskill Group Manager ──────────────────────────────────────────────────────
// Defines the named member lists a Craft/Perform/Profession/Art/Lore entry can draw one
// subskill from (DESIGN.md §4.9). Members are edited as one-per-line text, matching how
// adjective lists are supplied.

/**
 * Member picker for one subskill group, modelled on the system's trait selectors
 * (damage vulnerabilities/immunities): checkboxes over the parent skill's autocomplete
 * list, plus a custom-entry field for anything not on it.
 *
 * ApplicationV2 rather than DialogV2 because this needs real layout — DialogV2 runs its
 * content through cleanHTML, which strips the markup a checkbox grid needs.
 *
 * Members already on the group that are NOT in the autocomplete list come back as custom
 * entries, so opening and re-saving the picker never silently drops them.
 */
class TokenRandomizerSubSkillPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.skillKey = options.skillKey;
    this.groupName = options.groupName ?? "";
    this.onSubmit = options.onSubmit;

    this.known = getKnownSubSkillsFor(this.skillKey);
    const knownLower = new Set(this.known.map(n => n.toLowerCase()));
    const names = parseSubSkillList(options.names);
    this.checked = new Set(names.filter(n => knownLower.has(n.toLowerCase())).map(n => n.toLowerCase()));
    this.custom = names.filter(n => !knownLower.has(n.toLowerCase()));
  }

  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-subskill-picker"],
    tag: "div",
    window: { title: "TR.SubSkillPicker.Title", icon: "fas fa-check-double", resizable: true },
    position: { width: 420, height: "auto" },
    actions: {
      removeCustom: TokenRandomizerSubSkillPicker.#onRemoveCustom,
      submit: TokenRandomizerSubSkillPicker.#onSubmit,
      cancel: TokenRandomizerSubSkillPicker.#onCancel
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/subskill-picker.hbs` }
  };

  /** One window per group, so pickers for different groups don't share a DOM id. */
  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = `token-randomizer-subskill-picker-${options.groupId ?? "new"}`;
    return applied;
  }

  get title() {
    return this.groupName
      ? game.i18n.format("TR.SubSkillPicker.TitleFor", { name: this.groupName })
      : game.i18n.localize("TR.SubSkillPicker.Title");
  }

  async _prepareContext(options) {
    return {
      skillLabel: skillLabel(this.skillKey),
      hasKnown: this.known.length > 0,
      known: this.known.map(name => ({ name, checked: this.checked.has(name.toLowerCase()) })),
      custom: this.custom,
      count: this.checked.size + this.custom.length
    };
  }

  _onRender(context, options) {
    const html = this.element;
    html.querySelectorAll(".picker-known").forEach(el => el.addEventListener("change", (e) => {
      const name = e.currentTarget.dataset.name.toLowerCase();
      if (e.currentTarget.checked) this.checked.add(name);
      else this.checked.delete(name);
      this.render(); // refresh the running count
    }));

    // Same type-and-Enter behaviour as the autocomplete editor.
    const commit = (input) => {
      const name = input.value.trim();
      input.value = "";
      if (!name) return false;
      const lower = name.toLowerCase();
      // Typing something already on the list just ticks its box instead of duplicating it.
      if (this.known.some(n => n.toLowerCase() === lower)) {
        this.checked.add(lower);
        return true;
      }
      if (this.custom.some(n => n.toLowerCase() === lower)) return false;
      this.custom.push(name);
      return true;
    };
    const input = html.querySelector(".picker-custom-input");
    input?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!commit(e.currentTarget)) return;
      this._refocus = true;
      this.render();
    });
    input?.addEventListener("blur", (e) => { if (commit(e.currentTarget)) this.render(); });

    if (this._refocus) {
      this._refocus = false;
      input?.focus();
    }
  }

  static #onRemoveCustom(event, target) {
    this.custom = this.custom.filter(n => n !== target.dataset.name);
    this.render();
  }

  static #onSubmit(event, target) {
    // Known entries keep autocomplete-list order; custom ones follow in entry order.
    const picked = [
      ...this.known.filter(n => this.checked.has(n.toLowerCase())),
      ...this.custom
    ];
    this.onSubmit?.(picked);
    this.close();
  }

  static #onCancel(event, target) {
    this.close();
  }
}

class TokenRandomizerSubSkillGroups extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-subskill-groups"],
    tag: "div",
    window: { title: "TR.Window.SubSkillGroups", icon: "fas fa-layer-group", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      addGroup: TokenRandomizerSubSkillGroups.#onAddGroup,
      removeGroup: TokenRandomizerSubSkillGroups.#onRemoveGroup,
      selectItems: TokenRandomizerSubSkillGroups.#onSelectItems,
      removeMember: TokenRandomizerSubSkillGroups.#onRemoveMember,
      toggleGroup: TokenRandomizerSubSkillGroups.#onToggleGroup,
      toggleKnown: TokenRandomizerSubSkillGroups.#onToggleKnown,
      removeKnown: TokenRandomizerSubSkillGroups.#onRemoveKnown,
      restoreKnown: TokenRandomizerSubSkillGroups.#onRestoreKnown,
      save: TokenRandomizerSubSkillGroups.#onSave,
      cancel: TokenRandomizerSubSkillGroups.#onCancel
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/subskill-groups.hbs` }
  };

  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = "token-randomizer-subskill-groups";
    return applied;
  }

  async _prepareContext(options) {
    // Draft copies so edits only commit on Save (Cancel discards them).
    if (!this.draft) this.draft = foundry.utils.deepClone(getSubSkillGroups());
    // Held as arrays while editing; the stored form may be an array or a legacy
    // semicolon string, so everything comes in through parseSubSkillList.
    if (!this.knownDraft) {
      const stored = getKnownSubSkills();
      this.knownDraft = {};
      for (const key of (pf1?.config?.arbitrarySkills ?? FALLBACK_ARBITRARY_SKILLS)) {
        this.knownDraft[key] = parseSubSkillList(stored[key]);
      }
    }
    const arbitrary = (pf1?.config?.arbitrarySkills ?? FALLBACK_ARBITRARY_SKILLS);

    // UI-only collapse state, never written to settings. Groups key on their stable id
    // (so reordering keeps it), autocomplete blocks on their skill key. Everything
    // present at open starts collapsed — the chip lists run long and this window is
    // mostly consulted, not edited. Anything added later is absent from these sets, so
    // a newly added group opens expanded, which is what you want right after creating it.
    if (!this.collapsedGroups) {
      this.collapsedGroups = new Set(this.draft.map(g => g.id));
      this.collapsedKnown = new Set(arbitrary);
    }

    const skillOptions = (selected) => arbitrary.map(key => ({
      value: key,
      label: skillLabel(key),
      selected: key === selected
    }));

    return {
      groups: this.draft.map((g, index) => {
        const members = groupMembers(g);
        return {
          index,
          id: g.id,
          name: g.name ?? "",
          members,
          count: members.length,
          collapsed: this.collapsedGroups.has(g.id),
          skillOptions: skillOptions(g.skill)
        };
      }),
      // Only the five arbitrary skills can have subskills at all, so only they can host
      // a group; each row picks its parent from that short list.
      hasGroups: this.draft.length > 0,
      known: arbitrary.map(key => {
        const names = this.knownDraft[key] ?? [];
        return {
          key,
          label: skillLabel(key),
          names,
          count: names.length,
          collapsed: this.collapsedKnown.has(key)
        };
      })
    };
  }

  _onRender(context, options) {
    const html = this.element;
    const on = (selector, event, handler) => {
      html.querySelectorAll(selector).forEach(el => el.addEventListener(event, handler));
    };
    on(".group-name", "change", (e) => {
      this.draft[Number(e.currentTarget.dataset.index)].name = e.currentTarget.value;
    });
    on(".group-skill", "change", (e) => {
      this.draft[Number(e.currentTarget.dataset.index)].skill = e.currentTarget.value;
      this.render();
    });
    // Speciality entry works like the system's trait fields: type a name, press Enter,
    // it becomes a chip. Committing on blur too means text typed and then Saved isn't
    // silently dropped.
    const commit = (input) => {
      const name = input.value.trim();
      input.value = "";
      if (!name) return false;
      const key = input.dataset.skill;
      const list = this.knownDraft[key] ?? (this.knownDraft[key] = []);
      if (list.some(n => n.toLowerCase() === name.toLowerCase())) return false;
      list.push(name);
      return true;
    };
    on(".known-input", "keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault(); // don't submit or close the window
      if (!commit(e.currentTarget)) return;
      // Re-render for the new chip, then put the caret back so a run of entries flows.
      this._focusKnown = e.currentTarget.dataset.skill;
      this.render();
    });
    on(".known-input", "blur", (e) => {
      if (commit(e.currentTarget)) this.render();
    });

    if (this._focusKnown) {
      const input = html.querySelector(`.known-input[data-skill="${this._focusKnown}"]`);
      this._focusKnown = null;
      input?.focus();
    }
  }

  /** Open the member picker for one group, writing the result back into the draft. */
  static #onSelectItems(event, target) {
    const index = Number(target.dataset.index);
    const group = this.draft[index];
    // Only one picker at a time, so a second click can't leave an orphaned window
    // writing into a stale index.
    this._picker?.close();
    this._picker = new TokenRandomizerSubSkillPicker({
      groupId: group.id,
      skillKey: group.skill,
      groupName: group.name,
      names: group.members,
      onSubmit: (picked) => {
        this.draft[index].members = picked;
        this.render();
      }
    });
    this._picker.render(true);
  }

  // Both toggles flip the class in place rather than re-rendering, so a half-typed
  // speciality in a sibling input isn't thrown away.
  static #onToggleGroup(event, target) {
    const id = target.dataset.id;
    if (this.collapsedGroups.has(id)) this.collapsedGroups.delete(id);
    else this.collapsedGroups.add(id);
    target.closest(".group-item")?.classList.toggle("collapsed");
  }

  static #onToggleKnown(event, target) {
    const key = target.dataset.skill;
    if (this.collapsedKnown.has(key)) this.collapsedKnown.delete(key);
    else this.collapsedKnown.add(key);
    target.closest(".known-block")?.classList.toggle("collapsed");
  }

  static #onRemoveMember(event, target) {
    const index = Number(target.dataset.index);
    const name = target.dataset.name;
    this.draft[index].members = groupMembers(this.draft[index]).filter(n => n !== name);
    this.render();
  }

  static #onRemoveKnown(event, target) {
    const { skill, name } = target.dataset;
    this.knownDraft[skill] = (this.knownDraft[skill] ?? []).filter(n => n !== name);
    this.render();
  }

  /** Refill the autocomplete lists with the shipped ones (committed on Save). */
  static async #onRestoreKnown(event, target) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Dialog.RestoreKnown.Title") },
      content: game.i18n.localize("TR.Dialog.RestoreKnown.Content")
    });
    if (!ok) return;
    this.knownDraft = {};
    for (const [key, value] of Object.entries(DEFAULT_KNOWN_SUBSKILLS)) {
      this.knownDraft[key] = parseSubSkillList(value);
    }
    this.render();
  }

  static #onAddGroup(event, target) {
    const arbitrary = pf1?.config?.arbitrarySkills ?? FALLBACK_ARBITRARY_SKILLS;
    this.draft.push({ id: `group-${foundry.utils.randomID()}`, name: "", skill: arbitrary[0], members: [] });
    this.render();
  }

  static async #onRemoveGroup(event, target) {
    const index = Number(target.dataset.index);
    const group = this.draft[index];
    const safe = foundry.utils.escapeHTML?.(group?.name ?? "") ?? group?.name ?? "";
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Dialog.DeleteSubSkillGroup.Title") },
      content: game.i18n.format("TR.Dialog.DeleteSubSkillGroup.Content", { name: safe })
    });
    if (!ok) return;
    this.draft.splice(index, 1);
    this.render();
  }

  static async #onSave(event, target) {
    const cleaned = [];
    const seen = new Set();
    for (let i = 0; i < this.draft.length; i++) {
      const row = this.draft[i];
      const name = String(row.name ?? "").trim();
      if (!name) {
        ui.notifications?.warn(game.i18n.format("TR.Notif.SubSkillGroupNeedsName", { num: i + 1 }));
        return;
      }
      // Names are scoped to their parent skill, so "Smithing" under Craft and under
      // Profession can coexist; two Craft Smithings cannot.
      const key = `${row.skill}|${name.toLowerCase()}`;
      if (seen.has(key)) {
        ui.notifications?.warn(game.i18n.format("TR.Notif.SubSkillGroupDuplicate", { name, skill: skillLabel(row.skill) }));
        return;
      }
      seen.add(key);
      const members = groupMembers(row);
      if (!members.length) {
        ui.notifications?.warn(game.i18n.format("TR.Notif.SubSkillGroupNeedsMembers", { name }));
        return;
      }
      cleaned.push({ id: row.id ?? `group-${foundry.utils.randomID()}`, name, skill: row.skill, members });
    }
    // Store the autocomplete lists as clean arrays, dropping skills left empty.
    const known = {};
    for (const [key, value] of Object.entries(this.knownDraft)) {
      const names = parseSubSkillList(value);
      if (names.length) known[key] = names;
    }

    await game.settings.set(MODULE_ID, "subskill-groups", cleaned);
    await game.settings.set(MODULE_ID, "known-subskills", known);
    ui.notifications?.info(
      cleaned.length === 1
        ? game.i18n.localize("TR.Notif.SubSkillGroupsSavedOne")
        : game.i18n.format("TR.Notif.SubSkillGroupsSavedMany", { count: cleaned.length })
    );
    this.close();
  }

  static #onCancel(event, target) {
    this.close();
  }
}


export {
  TokenRandomizerSubSkillGroups,
};
