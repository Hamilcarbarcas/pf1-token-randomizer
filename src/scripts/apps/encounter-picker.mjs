/* The encounter list (DESIGN.md §11 entry points).
 *
 * Deliberately thin: new / open / rename / delete. Everything about an encounter is
 * edited in the window it opens.
 */

import { MODULE_ID } from "../core/const.mjs";
import { ApplicationV2, HandlebarsApplicationMixin } from "../core/appv2.mjs";
import { formatCR } from "../core/cr.mjs";
import { createEncounter, defaultMixFor, encounterBudget } from "../encounter/record.mjs";
import { deleteEncounter, listEncounters, saveEncounter } from "../encounter/store.mjs";
import { getTreasureCategories } from "../encounter/sources.mjs";
import { EncounterTreasureApp, formatGp } from "./encounter-app.mjs";

class EncounterPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-encounter-picker"],
    tag: "div",
    window: { title: "TR.Window.EncounterPicker", icon: "fas fa-sack-dollar", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      newEncounter: EncounterPicker.#onNew,
      openEncounter: EncounterPicker.#onOpen,
      deleteEncounter: EncounterPicker.#onDelete
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/encounter-picker.hbs` }
  };

  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = "token-randomizer-encounter-picker";
    return applied;
  }

  async _prepareContext(options) {
    const list = listEncounters();
    return {
      encounters: list.map(e => {
        const b = encounterBudget(e);
        return {
          id: e.id,
          name: e.name || game.i18n.localize("TR.Encounter.Untitled"),
          cr: formatCR(b.cr),
          members: b.memberCount,
          lines: e.lines.length,
          budget: formatGp(b.budget),
          applied: !!e.applied?.at
        };
      }),
      hasEncounters: list.length > 0
    };
  }

  static async #onNew(event, target) {
    const record = createEncounter({ name: "", sceneId: canvas?.scene?.id ?? null });
    record.mix = defaultMixFor(getTreasureCategories());
    await saveEncounter(record, { immediate: true });
    await this.render();
    new EncounterTreasureApp({ encounterId: record.id, record }).render(true);
  }

  static async #onOpen(event, target) {
    new EncounterTreasureApp({ encounterId: target.dataset.id }).render(true);
  }

  static async #onDelete(event, target) {
    const id = target.dataset.id;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Encounter.DeleteTitle") },
      content: `<p>${game.i18n.format("TR.Encounter.DeleteConfirm", { name: target.dataset.name })}</p>`
    });
    if (!ok) return;
    await deleteEncounter(id);
    // Close the window for the encounter that just went away, or it would keep
    // debouncing saves against a record no longer in the list.
    for (const app of Object.values(ui.windows ?? {})) {
      if (app instanceof EncounterTreasureApp && app.encounterId === id) await app.close();
    }
    await this.render();
  }
}

/** Open the picker, or one encounter directly. */
function openEncounters(encounterId = null) {
  if (encounterId) return new EncounterTreasureApp({ encounterId }).render(true);
  return new EncounterPicker().render(true);
}

export {
  EncounterPicker,
  openEncounters,
};
