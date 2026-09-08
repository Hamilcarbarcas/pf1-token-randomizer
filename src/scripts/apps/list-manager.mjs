/* Name database + adjective list editor.
 */

import { LOG, MODULE_ID } from "../core/const.mjs";
import { ApplicationV2, HandlebarsApplicationMixin } from "../core/appv2.mjs";
import { promptForText } from "../core/util.mjs";
import { loadAdjectiveLists, loadNameDatabase, loadUserAdjectives, loadUserNames, nameKey, namesToTSV, parseAdjectiveFile, parseNameFile, saveUserAdjectives, saveUserNames } from "../names/data.mjs";

// ─── List Manager (name database + adjective lists) ──────────────────────────────

/** Open a file picker for the given accept filter and run `handler(file)` with error toasts. */
function pickFile(accept, handler) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      await handler(file);
    } catch (err) {
      console.error(`${LOG} File import error:`, err);
      ui.notifications?.error(game.i18n.format("TR.Notif.ImportFailed", { message: err.message }));
    }
  });
  input.click();
}

/** Trigger a client-side download of text content (used for TSV export). */
function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


class TokenRandomizerListManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-lists"],
    tag: "div",
    window: { title: "TR.Window.Lists", icon: "fas fa-list", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      importNames: TokenRandomizerListManager.#onImportNames,
      exportNames: TokenRandomizerListManager.#onExportNames,
      addAdjList: TokenRandomizerListManager.#onAddAdjList,
      replaceAdjList: TokenRandomizerListManager.#onReplaceAdjList,
      deleteAdjList: TokenRandomizerListManager.#onDeleteAdjList
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/list-manager.hbs` }
  };

  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = "token-randomizer-lists";
    return applied;
  }

  async _prepareContext(options) {
    const db = await loadNameDatabase(true); // force so counts reflect recent imports
    const names = db.names ?? [];
    const adjDb = await loadAdjectiveLists(true);
    const adjLists = Object.keys(adjDb.lists).sort().map(name => {
      const source = adjDb.sources[name];
      return {
        name,
        count: adjDb.lists[name].length,
        source,
        isBundled: source === "bundled",
        isOverridden: source === "overridden",
        isCustom: source === "custom"
      };
    });
    return {
      nameCount: names.length,
      givenCount: names.filter(n => n.type === "given").length,
      surnameCount: names.filter(n => n.type === "surname").length,
      hasNames: names.length > 0,
      adjLists,
      hasAdjLists: adjLists.length > 0
    };
  }

  // ── Name database ──

  static #onImportNames(event, target) {
    pickFile(".csv,.tsv,.txt,.json", async (file) => {
      const parsed = await parseNameFile(file);
      if (!parsed.length) {
        ui.notifications?.warn(game.i18n.localize("TR.Notif.NoNameEntries"));
        return;
      }
      // Merge into the USER database only; the bundled sample is never pulled in here.
      const userNames = await loadUserNames();
      const existing = new Set(userNames.map(nameKey));
      let added = 0;
      for (const entry of parsed) {
        const key = nameKey(entry);
        if (!existing.has(key)) {
          userNames.push(entry);
          existing.add(key);
          added++;
        }
      }
      await saveUserNames(userNames);
      await loadNameDatabase(true);
      ui.notifications?.info(
        game.i18n.format("TR.Notif.NamesImported", { added, skipped: parsed.length - added, total: userNames.length })
      );
      this.render();
    });
  }

  static async #onExportNames(event, target) {
    const db = await loadNameDatabase(true);
    const names = db.names ?? [];
    if (!names.length) {
      ui.notifications?.warn(game.i18n.localize("TR.Notif.NameDbEmpty"));
      return;
    }
    downloadText(`${MODULE_ID}-names.tsv`, namesToTSV(names), "text/tab-separated-values");
  }

  // ── Adjective lists ──

  static async #onAddAdjList(event, target) {
    const raw = await promptForText(game.i18n.localize("TR.Prompt.NewAdjList.Title"), game.i18n.localize("TR.Prompt.NewAdjList.Label"), "");
    if (raw === null) return;
    const name = raw.trim();
    if (!name) {
      ui.notifications?.warn(game.i18n.localize("TR.Notif.ListNameRequired"));
      return;
    }
    pickFile(".txt,.csv,.json", async (file) => {
      const words = await parseAdjectiveFile(file);
      const user = await loadUserAdjectives();
      user[name] = words;
      await saveUserAdjectives(user);
      await loadAdjectiveLists(true);
      ui.notifications?.info(game.i18n.format("TR.Notif.AdjListSaved", { name, count: words.length }));
      this.render();
    });
  }

  static #onReplaceAdjList(event, target) {
    const name = target.dataset.list;
    pickFile(".txt,.csv,.json", async (file) => {
      const words = await parseAdjectiveFile(file);
      const user = await loadUserAdjectives();
      user[name] = words;
      await saveUserAdjectives(user);
      await loadAdjectiveLists(true);
      ui.notifications?.info(game.i18n.format("TR.Notif.AdjListReplaced", { name, count: words.length }));
      this.render();
    });
  }

  static async #onDeleteAdjList(event, target) {
    const name = target.dataset.list;
    const adjDb = await loadAdjectiveLists();
    const revert = adjDb.sources[name] === "overridden";
    const safe = foundry.utils.escapeHTML?.(name) ?? name;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(revert ? "TR.Dialog.RevertAdj.Title" : "TR.Dialog.DeleteAdj.Title") },
      content: revert
        ? game.i18n.format("TR.Dialog.RevertAdj.Content", { name: safe })
        : game.i18n.format("TR.Dialog.DeleteAdj.Content", { name: safe })
    });
    if (!confirmed) return;
    const user = await loadUserAdjectives();
    delete user[name];
    await saveUserAdjectives(user);
    await loadAdjectiveLists(true);
    ui.notifications?.info(revert ? game.i18n.format("TR.Notif.AdjListReverted", { name }) : game.i18n.format("TR.Notif.AdjListDeleted", { name }));
    this.render();
  }
}


export {
  TokenRandomizerListManager,
};
