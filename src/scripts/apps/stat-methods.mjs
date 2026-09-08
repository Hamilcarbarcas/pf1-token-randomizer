/* Custom stat method editor (arrays and formulas).
 */

import { ABILITY_KEYS, MODULE_ID } from "../core/const.mjs";
import { ApplicationV2, HandlebarsApplicationMixin } from "../core/appv2.mjs";
import { getCustomStatMethods } from "../core/stats.mjs";

// ─── Stat Method Manager (custom arrays & formulas) ──────────────────────────────

class TokenRandomizerStatMethods extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-stat-methods"],
    tag: "div",
    window: { title: "TR.Window.StatMethods", icon: "fas fa-dice-d6", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      addMethod: TokenRandomizerStatMethods.#onAddMethod,
      removeMethod: TokenRandomizerStatMethods.#onRemoveMethod,
      save: TokenRandomizerStatMethods.#onSave,
      cancel: TokenRandomizerStatMethods.#onCancel
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/stat-methods.hbs` }
  };

  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = "token-randomizer-stat-methods";
    return applied;
  }

  async _prepareContext(options) {
    // Draft copy so edits are only committed on Save (Cancel discards them).
    if (!this.draft) this.draft = foundry.utils.deepClone(getCustomStatMethods());
    return {
      methods: this.draft.map((m, index) => {
        const isFormula = m.type === "formula";
        return {
          index,
          isFormula,
          isArray: !isFormula,
          typeClass: isFormula ? "is-formula" : "is-array",
          label: m.label ?? "",
          formula: m.formula ?? "",
          // Six value fields, padded to the ability count so the grid is always full.
          values: isFormula ? [] : ABILITY_KEYS.map((_, i) => m.values?.[i] ?? 10)
        };
      })
    };
  }

  /** Wire the label / value / formula inputs into the draft (committed on Save). */
  _onRender(context, options) {
    const html = this.element;
    const on = (selector, event, handler) => {
      html.querySelectorAll(selector).forEach(el => el.addEventListener(event, handler));
    };
    on(".stat-method-label", "change", (e) => {
      this.draft[Number(e.currentTarget.dataset.index)].label = e.currentTarget.value;
    });
    on(".stat-method-value", "change", (e) => {
      const m = Number(e.currentTarget.dataset.method);
      const slot = Number(e.currentTarget.dataset.slot);
      if (!Array.isArray(this.draft[m].values)) this.draft[m].values = [];
      this.draft[m].values[slot] = e.currentTarget.value; // raw; parsed/validated on Save
    });
    on(".stat-method-formula", "change", (e) => {
      this.draft[Number(e.currentTarget.dataset.index)].formula = e.currentTarget.value;
    });
  }

  static #onAddMethod(event, target) {
    const type = target.dataset.type;
    if (type === "formula") {
      this.draft.push({ id: `custom-${foundry.utils.randomID()}`, type: "formula", label: "", formula: "4d6dl1" });
    } else {
      this.draft.push({ id: `custom-${foundry.utils.randomID()}`, type: "array", label: "", values: [15, 14, 13, 12, 10, 8] });
    }
    this.render();
  }

  static #onRemoveMethod(event, target) {
    this.draft.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onSave(event, target) {
    // Validate every row before committing; abort (keeping the dialog open) on the
    // first problem so nothing is silently dropped.
    const cleaned = [];
    for (let i = 0; i < this.draft.length; i++) {
      const row = this.draft[i];
      const label = String(row.label ?? "").trim();
      if (!label) {
        ui.notifications?.warn(game.i18n.format("TR.Notif.StatMethodNeedsName", { num: i + 1 }));
        return;
      }
      if (row.type === "formula") {
        const formula = String(row.formula ?? "").trim();
        if (!formula) {
          ui.notifications?.warn(game.i18n.format("TR.Notif.FormulaMethodNeedsFormula", { label }));
          return;
        }
        if (!Roll.validate(formula)) {
          ui.notifications?.warn(game.i18n.format("TR.Notif.InvalidFormula", { label, formula }));
          return;
        }
        cleaned.push({ id: row.id ?? `custom-${foundry.utils.randomID()}`, type: "formula", label, formula });
      } else {
        const values = (row.values ?? []).map(v => Number.parseInt(v, 10));
        if (values.length !== ABILITY_KEYS.length || values.some(v => !Number.isFinite(v))) {
          ui.notifications?.warn(game.i18n.format("TR.Notif.ArrayNeedsValues", { label, count: ABILITY_KEYS.length }));
          return;
        }
        if (values.some(v => v < 1)) {
          ui.notifications?.warn(game.i18n.format("TR.Notif.ArrayMinValue", { label }));
          return;
        }
        cleaned.push({ id: row.id ?? `custom-${foundry.utils.randomID()}`, type: "array", label, values });
      }
    }
    await game.settings.set(MODULE_ID, "custom-stat-methods", cleaned);
    ui.notifications?.info(
      cleaned.length === 1
        ? game.i18n.localize("TR.Notif.StatMethodsSavedOne")
        : game.i18n.format("TR.Notif.StatMethodsSavedMany", { count: cleaned.length })
    );
    this.close();
  }

  static #onCancel(event, target) {
    this.close();
  }
}


export {
  TokenRandomizerStatMethods,
};
