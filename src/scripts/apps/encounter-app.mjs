/* The encounter treasure window, phase 1 (DESIGN.md §17).
 *
 * Header (CR, XP, pace, budget/carried/to-generate) → generated lines → the pinned
 * unassigned tray → the target strip → currency → Apply (§18).
 *
 * Loot piles are not a target type: a GM makes one however they like and adds its token
 * as a member, where it behaves like any other target (§19.4).
 *
 * The record is a draft held on the instance. Edits mutate it and schedule a debounced
 * save (§12.1); Reset reloads from the store.
 */

import { LOG, MODULE_ID } from "../core/const.mjs";
import { ApplicationV2, HandlebarsApplicationMixin } from "../core/appv2.mjs";
import { promptForText } from "../core/util.mjs";
import { formatCR } from "../core/cr.mjs";
import {
  addMember, assignLine, clearAssignments, coinRemainder, coinTargets, defaultMixFor,
  distributableTargets,
  encounterPlan, hoardValue, memberFromToken, normalizeEncounter, removeMember,
  toggleTargetLock, unassignedLines,
} from "../encounter/record.mjs";
import { loadEncounter, saveEncounter } from "../encounter/store.mjs";
import { resolveEncounterState, memberTargets } from "../encounter/resolve.mjs";
import { getTreasureCategories, getTreasureSources, resolveCategoryPools } from "../encounter/sources.mjs";
import { pickNear, rollHoard } from "../encounter/roll-mix.mjs";
import {
  applyEncounter, applyPlan, findMissingTargets, pruneMissingTargets, undoEncounter,
} from "../encounter/apply.mjs";
import {
  applyProfileToRecord, deleteHoardProfile, getHoardProfile, getHoardProfiles,
  profileDiverged, saveProfileFromRecord,
} from "../encounter/profiles.mjs";
import {
  COIN_ORDER as COIN_KEYS, crWeights, denominationCounts, distributeLines, poolToCp,
  reallocateCoin, splitCurrency,
} from "../encounter/distribute.mjs";

/** A 1-10 chance slider as the percentage it stands for: 3 -> "30%". */
function chanceToPct(value) {
  return `${(Number(value) || 0) * 10}%`;
}

class EncounterTreasureApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-encounter"],
    tag: "div",
    window: { title: "TR.Window.Encounter", icon: "fas fa-sack-dollar", resizable: true },
    position: { width: 900, height: 720 },
    actions: {
      addSelected: EncounterTreasureApp.#onAddSelected,
      addCombatants: EncounterTreasureApp.#onAddCombatants,
      removeMember: EncounterTreasureApp.#onRemoveMember,
      setPace: EncounterTreasureApp.#onSetPace,
      generate: EncounterTreasureApp.#onGenerate,
      resetDraft: EncounterTreasureApp.#onReset,
      rerollLine: EncounterTreasureApp.#onRerollLine,
      toggleLock: EncounterTreasureApp.#onToggleLock,
      deleteLine: EncounterTreasureApp.#onDeleteLine,
      unassignLine: EncounterTreasureApp.#onUnassignLine,
      bulkDistribute: EncounterTreasureApp.#onBulkDistribute,
      returnAll: EncounterTreasureApp.#onReturnAll,
      splitCoins: EncounterTreasureApp.#onSplitCoins,
      togglePin: EncounterTreasureApp.#onTogglePin,
      toggleTargetLock: EncounterTreasureApp.#onToggleTargetLock,
      toggleCoinLock: EncounterTreasureApp.#onToggleCoinLock,
      toggleCategory: EncounterTreasureApp.#onToggleCategory,
      loadProfile: EncounterTreasureApp.#onLoadProfile,
      saveProfile: EncounterTreasureApp.#onSaveProfile,
      deleteProfile: EncounterTreasureApp.#onDeleteProfile,
      applyLoot: EncounterTreasureApp.#onApply,
      undoLoot: EncounterTreasureApp.#onUndo
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/src/templates/encounter.hbs`,
      // Every button re-renders, so these would otherwise snap back to the start on each
      // click. AppV2 restores scrollTop AND scrollLeft for the listed selectors, which is
      // what the horizontally-scrolling target strip needs.
      scrollable: [".encounter-target-strip", ".encounter-tray", ".encounter-member-list"]
    }
  };

  constructor(options = {}) {
    super(options);
    this.encounterId = options.encounterId ?? options.record?.id ?? null;
    this.record = options.record ? normalizeEncounter(options.record) : null;
    // Resolved once per render pass rather than per readout (§12.2). Deliberately not
    // called "state": ApplicationV2 owns id / state / window / form / element /
    // rendered / title as getter-only, and assigning one throws during construction.
    this.resolved = { members: [], actors: [], carried: { gp: 0, parts: {} } };
    // Candidate pools survive between renders so a single-line re-roll does not re-index
    // every pack; dropped on Generate and on Reset.
    this._pools = null;
    // The window's own vertical scroll lives on `.window-content`, which is OUTSIDE the
    // template part — so AppV2's part-level `scrollable` cannot reach it. Tracked here
    // and restored after each render instead.
    this._contentScroll = 0;
  }

  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    // One window per encounter, so two rows in the picker cannot fight over one draft.
    applied.uniqueId = `token-randomizer-encounter-${options.encounterId ?? options.record?.id ?? "new"}`;
    return applied;
  }

  get title() {
    const name = this.record?.name?.trim();
    return name ? `${game.i18n.localize("TR.Window.Encounter")}: ${name}`
                : game.i18n.localize("TR.Window.Encounter");
  }

  async _prepareContext(options) {
    if (!this.record) this.record = loadEncounter(this.encounterId) ?? normalizeEncounter({ id: this.encounterId });
    const categories = getTreasureCategories();

    // A category added since this record was made has no mix entry yet; fill any gaps
    // rather than replacing, so existing settings survive.
    const fresh = defaultMixFor(categories);
    for (const cat of categories) {
      this.record.mix.categories[cat.id] ??= { ...fresh.categories[cat.id] };
    }

    this.resolved = await resolveEncounterState(this.record);
    this.record.members = this.resolved.members;

    const plan = encounterPlan(this.record, this.resolved.carried.gp);
    const targets = memberTargets(this.resolved.members);
    const locked = new Set(this.record.lockedTargets ?? []);
    const coinOff = new Set(this.record.coinExcluded ?? []);
    const assignment = this.record.assignment ?? {};
    const byTarget = {};
    for (const t of targets) byTarget[t.id] = [];

    const decorate = (l) => ({
      ...l,
      // A stacked row shows its count and its TOTAL, since qty x value is what the
      // budget actually spent on it.
      qtyLabel: l.qty > 1 ? `x${l.qty}` : "",
      valueLabel: formatGp(l.value * l.qty),
      assignedTo: assignment[l.id] ?? null,
      categoryName: categories.find(c => c.id === l.categoryId)?.name ?? ""
    });
    const lines = this.record.lines.map(decorate);
    for (const l of lines) {
      if (l.assignedTo && byTarget[l.assignedTo]) byTarget[l.assignedTo].push(l);
    }

    const value = hoardValue(this.record);
    const coin = this.#recomputeCoins();
    return {
      record: this.record,
      name: this.record.name,
      // ── header ──
      cr: formatCR(plan.cr),
      derivedCR: formatCR(plan.derivedCR),
      hasCROverride: this.record.crOverride !== null,
      crOverride: this.record.crOverride ?? "",
      totalXP: plan.totalXP.toLocaleString(),
      memberCount: plan.memberCount,
      missingCount: plan.missingCount,
      exceedsTable: plan.exceedsTable,
      pace: this.record.pace,
      paceIsSlow: this.record.pace === "slow",
      paceIsMedium: this.record.pace === "medium",
      paceIsFast: this.record.pace === "fast",
      budget: formatGp(plan.budget),
      carried: formatGp(plan.carried),
      toGenerate: formatGp(plan.toGenerate),
      overFunded: plan.overFunded > 0 ? formatGp(plan.overFunded) : null,
      budgetOverride: this.record.budgetOverride ?? "",
      budgetSource: plan.source,
      countExisting: this.record.countExisting,
      carriedParts: COIN_PARTS.map(k => ({
        key: k,
        label: game.i18n.localize(`TR.Encounter.Part.${k}`),
        value: formatGp(this.resolved.carried.parts?.[k] ?? 0)
      })),
      // ── members ──
      members: this.resolved.members.map((m, index) => ({ ...m, index, crLabel: formatCR(m.cr) })),
      targets: targets.map(t => ({
        ...t,
        crLabel: formatCR(t.cr),
        lines: byTarget[t.id] ?? [],
        locked: locked.has(t.id),
        coinExcluded: coinOff.has(t.id)
      })),
      hasTargets: targets.length > 0,
      // ── the mix (§16 revised) ──
      available: formatGp(plan.toGenerate),
      profiles: getHoardProfiles().map(p => ({
        id: p.id, name: p.name, selected: p.id === this.record.profile?.id
      })),
      profileName: this.record.profile?.name ?? "",
      profileDiverged: profileDiverged(this.record),
      categories: categories.map(c => {
        const cfg = this.record.mix.categories[c.id] ?? {};
        return {
          ...c,
          enabled: cfg.enabled !== false,
          chance: cfg.chance ?? 5,
          // The slider stores 1-10 but reads as a percentage; the two are kept apart so
          // saved encounters and profiles never need migrating (§16A).
          chancePct: chanceToPct(cfg.chance ?? 5),
          itemWeightMin: cfg.itemWeightMin ?? 3,
          itemWeightMax: cfg.itemWeightMax ?? 7,
          valueMin: cfg.valueMin ?? 15,
          valueMax: cfg.valueMax ?? 45,
          hasSources: c.isCoinSink || getTreasureSources().some(s => s.categoryId === c.id)
        };
      }),
      // ── lines ──
      lines,
      tray: unassignedLines(this.record).map(decorate),
      hasLines: lines.length > 0,
      linesValue: formatGp(value.lines),
      totalValue: formatGp(value.total),
      // ── currency (§17.3 — derived, never authored) ──
      currency: this.record.currency.pool,
      coinValue: formatGp(coin.gp),
      overBudget: coin.overBudget > 0 ? formatGp(coin.overBudget) : null,
      denomWeights: COIN_KEYS.map(k => ({
        key: k,
        // Full names, not the PP/GP/SP/CP the Part I tab uses — this row has the width
        // and the abbreviations read as jargon beside a slider.
        label: game.i18n.localize(`TR.Coin.Full.${k}`),
        weight: this.record.currency.denomWeights?.[k] ?? 0,
        count: this.record.currency.pool?.[k] ?? 0
      })),
      denomRandomness: this.record.currency.denomRandomness ?? 0,
      splitRandomness: this.record.currency.splitRandomness ?? 0,
      currencySplit: targets.map(t => {
        const coins = this.record.currency.split?.[t.id] ?? { pp: 0, gp: 0, sp: 0, cp: 0 };
        // Always two decimals: a share is frequently sub-gp, and "34 gp" beside
        // "34.27 gp" reads as a different kind of number rather than a rounder one.
        return { id: t.id, name: t.name, coins, valueLabel: formatGp2(poolToCp(coins) / 100) };
      }),
      coinKeys: COIN_KEYS,
      isApplied: !!this.record.applied?.at,
      appliedWhen: this.record.applied?.at
        ? new Date(this.record.applied.at).toLocaleString()
        : null,
      plan: applyPlan(this.record)
    };
  }

  /**
   * Recompute the coin pool from the budget's remainder and break it into denominations
   * by count (§17.3). Called on every render and after anything that moves the total,
   * because the pool is derived rather than stored.
   */
  #recomputeCoins() {
    const coin = coinRemainder(this.record, this.resolved.carried.gp);
    this.record.currency.pool = denominationCounts(
      Math.round(coin.gp * 100),
      this.record.currency.denomWeights,
      { randomness: (this.record.currency.denomRandomness ?? 0) / 100 }
    );
    return coin;
  }

  /** Persist the draft (debounced) and re-render. */
  async #touch({ render = true } = {}) {
    saveEncounter(this.record);
    if (render) await this.render();
  }

  /**
   * Update the coin counts in place while a slider is being dragged. A full re-render
   * would rebuild the slider and lose the drag, the same reason the weight readouts are
   * patched by hand (§1.4).
   */
  #refreshCoinReadout() {
    this.#recomputeCoins();
    const el = this.element;
    if (!el) return;
    for (const k of COIN_KEYS) {
      const out = el.querySelector(`.encounter-coin-count[data-coin="${k}"]`);
      if (out) out.textContent = this.record.currency.pool[k] ?? 0;
    }
  }

  /** Open an item or actor sheet from a uuid. Tokens resolve to their actor. */
  async #openSheet(uuid, wantActor = false) {
    if (!uuid) return;
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return ui.notifications?.warn(game.i18n.localize("TR.Encounter.SheetGone"));
      const target = wantActor ? (doc.actor ?? doc) : doc;
      target.sheet?.render(true);
    } catch (err) {
      console.error(`${LOG} Could not open sheet for ${uuid}:`, err);
    }
  }

  _onRender(context, options) {
    const el = this.element;

    const content = el.querySelector(".window-content") ?? el.closest(".window-content");
    if (content) {
      if (this._contentScroll) content.scrollTop = this._contentScroll;
      content.addEventListener("scroll", () => { this._contentScroll = content.scrollTop; });
    }

    const on = (selector, event, handler) =>
      el.querySelectorAll(selector).forEach(n => n.addEventListener(event, handler));

    on(".encounter-name", "change", (e) => {
      this.record.name = e.currentTarget.value;
      this.#touch();
    });

    on(".encounter-cr-override", "change", (e) => {
      const v = e.currentTarget.value.trim();
      this.record.crOverride = v === "" ? null : Number(v);
      if (!Number.isFinite(this.record.crOverride)) this.record.crOverride = null;
      this.#touch();
    });

    on(".encounter-budget-override", "change", (e) => {
      const v = e.currentTarget.value.trim();
      this.record.budgetOverride = v === "" ? null : Math.max(0, Number(v) || 0);
      this.#touch();
    });

    on(".encounter-count-existing", "change", (e) => {
      const key = e.currentTarget.dataset.key;
      this.record.countExisting[key] = e.currentTarget.checked;
      this.#touch();
    });

    // Chance and item weight are both 1-10 per category; readouts patch in place so a
    // slider keeps focus mid-drag (the §1.4 pattern).
    on(".encounter-chance", "input", (e) => {
      const id = e.currentTarget.dataset.category;
      this.record.mix.categories[id].chance = Number(e.currentTarget.value);
      const out = el.querySelector(`.chance-value[data-category="${id}"]`);
      if (out) out.textContent = chanceToPct(e.currentTarget.value);
      saveEncounter(this.record);
    });

    // The dual-knob element reports {min, max} on its own `change`.
    on(".encounter-item-weight", "change", (e) => {
      const cfg = this.record.mix.categories[e.currentTarget.dataset.category];
      const { min, max } = e.currentTarget.value;
      cfg.itemWeightMin = min;
      cfg.itemWeightMax = max;
      saveEncounter(this.record);
    });

    on(".encounter-cat-value", "change", (e) => {
      const cfg = this.record.mix.categories[e.currentTarget.dataset.category];
      const { min, max } = e.currentTarget.value;
      cfg.valueMin = min;
      cfg.valueMax = max;
      saveEncounter(this.record);
    });

    // Denomination weights are counts, not value (§17.3). The coin fields are outputs of
    // these sliders, so they are driven rather than driving — there is no manual override.
    on(".encounter-denom-weight", "input", (e) => {
      const k = e.currentTarget.dataset.coin;
      this.record.currency.denomWeights[k] = Number(e.currentTarget.value);
      this.#refreshCoinReadout();
      saveEncounter(this.record);
    });

    on(".encounter-denom-randomness", "input", (e) => {
      this.record.currency.denomRandomness = Number(e.currentTarget.value);
      this.#refreshCoinReadout();
      saveEncounter(this.record);
    });

    on(".encounter-split-randomness", "input", (e) => {
      this.record.currency.splitRandomness = Number(e.currentTarget.value);
      saveEncounter(this.record);
    });

    // ── open sheets ──
    // A line's name opens the source item; a member or target's name opens its actor.
    // Both are on the label rather than the row so a drag still starts anywhere else.
    on(".encounter-open-item", "click", (e) => {
      e.stopPropagation();
      this.#openSheet(e.currentTarget.dataset.uuid);
    });
    on(".encounter-open-actor", "click", (e) => {
      e.stopPropagation();
      this.#openSheet(e.currentTarget.dataset.uuid, true);
    });

    // ── drag and drop ──
    // Lines are dragged onto a target card or back to the tray. Tokens dropped on the
    // window are added as members; items dropped on the line list are added manually.
    el.querySelectorAll("[draggable='true']").forEach(node => {
      node.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", JSON.stringify({
          type: "TokenRandomizerLine", lineId: node.dataset.lineId
        }));
        node.classList.add("dragging");
      });
      node.addEventListener("dragend", () => node.classList.remove("dragging"));
    });

    // Zones nest: a target card sits inside the tray section, which sits inside the body,
    // and all three are drop zones. Without stopPropagation a drop on a card would be
    // handled by the card (assign) and then again by each ancestor (unassign), so the
    // line would land back in the tray and dragging would look broken.
    el.querySelectorAll("[data-drop-target]").forEach(zone => {
      zone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        zone.classList.add("drag-over");
      });
      zone.addEventListener("dragleave", (ev) => {
        if (!zone.contains(ev.relatedTarget)) zone.classList.remove("drag-over");
      });
      zone.addEventListener("drop", (ev) => {
        ev.stopPropagation();
        zone.classList.remove("drag-over");
        this.#onDrop(ev, zone.dataset.dropTarget || null);
      });
    });
  }

  async #onDrop(event, target) {
    event.preventDefault();
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }

    // A line moved between the tray and a target.
    if (data?.type === "TokenRandomizerLine") {
      this.record.assignment = assignLine(this.record.assignment, data.lineId, target);
      return this.#touch();
    }

    // A token dragged from the canvas becomes a member.
    if (data?.type === "Token" || data?.type === "Actor") {
      const doc = await fromUuid(data.uuid);
      const tokenDoc = data.type === "Token" ? doc : doc?.prototypeToken;
      if (!doc) return;
      const member = data.type === "Token"
        ? memberFromToken(tokenDoc)
        : memberFromToken({ uuid: null, name: doc.name, texture: { src: doc.img }, actor: doc });
      if (data.type === "Actor") member.actorUuid = doc.uuid;
      this.record.members = addMember(this.record.members, member);
      return this.#touch();
    }

    // An item dropped onto the list is manual loot (§16.3).
    if (data?.type === "Item") {
      const item = await fromUuid(data.uuid);
      if (!item) return;
      this.record.lines.push({
        id: `line-${foundry.utils.randomID()}`,
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        type: item.type,
        subType: item.system?.subType ?? null,
        value: Number(item.system?.price) || 0,
        qty: 1,
        locked: true,          // a hand-picked item is not something a re-roll should eat
        categoryId: null,
        sourceId: null,
        origin: "manual",
        equip: false
      });
      return this.#touch();
    }
  }

  // ── members ──

  static async #onAddSelected(event, target) {
    const tokens = canvas?.tokens?.controlled ?? [];
    if (!tokens.length) return ui.notifications?.warn(game.i18n.localize("TR.Encounter.NoSelection"));
    for (const t of tokens) this.record.members = addMember(this.record.members, memberFromToken(t.document));
    this.record.sceneId ??= canvas?.scene?.id ?? null;
    await this.#touch();
  }

  static async #onAddCombatants(event, target) {
    const combatants = game.combat?.combatants ?? [];
    if (!combatants.length) return ui.notifications?.warn(game.i18n.localize("TR.Encounter.NoCombat"));
    for (const c of combatants) {
      if (!c.token) continue;
      this.record.members = addMember(this.record.members, memberFromToken(c.token));
    }
    await this.#touch();
  }

  static async #onRemoveMember(event, target) {
    const index = Number(target.dataset.index);
    const m = this.record.members[index];
    this.record.members = removeMember(this.record.members, m?.tokenUuid ?? null, index);
    await this.#touch();
  }

  // ── header ──

  static async #onSetPace(event, target) {
    this.record.pace = target.dataset.pace;
    await this.#touch();
  }

  // ── generation ──

  static async #onGenerate(event, target) {
    const categories = getTreasureCategories();
    const sources = getTreasureSources();
    const plan = encounterPlan(this.record, this.resolved.carried.gp);
    if (plan.toGenerate <= 0) {
      return ui.notifications?.warn(game.i18n.localize("TR.Encounter.NothingToGenerate"));
    }

    // Three things survive a re-generate: a line locked in the tray, a hand-dropped
    // one, and anything already placed on a target. Assignment is itself a statement
    // that the GM wants the item, so it does not also need locking.
    const assigned = new Set(Object.keys(this.record.assignment ?? {}));
    const kept = this.record.lines.filter(
      l => l.locked || l.origin === "manual" || assigned.has(l.id));
    const keptValue = kept.reduce((s, l) => s + l.value * l.qty, 0);
    const budget = Math.max(0, plan.toGenerate - keptValue);

    try {
      this._pools = await resolveCategoryPools(categories, sources);
      const hoard = rollHoard({
        total: budget, categories, mix: this.record.mix, pools: this._pools
      });

      this.record.lines = [...kept, ...hoard.lines];
      // The coin pool is not taken from the hoard: it is recomputed from the budget's
      // remainder (§17.3), so deleting or adding a line afterwards keeps it correct.
      // Assignments for lines that no longer exist would strand value in a target.
      const ids = new Set(this.record.lines.map(l => l.id));
      for (const id of Object.keys(this.record.assignment)) if (!ids.has(id)) delete this.record.assignment[id];
      this.record.currency.split = {};
      await this.#touch();
    } catch (err) {
      console.error(`${LOG} Hoard generation failed:`, err);
      ui.notifications?.error(game.i18n.localize("TR.Encounter.GenerateFailed"));
    }
  }

  static async #onReset(event, target) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Encounter.ResetTitle") },
      content: `<p>${game.i18n.localize("TR.Encounter.ResetConfirm")}</p>`
    });
    if (!ok) return;
    this.record.lines = [];
    this.record.assignment = {};
    this.record.currency = { pool: { pp: 0, gp: 0, sp: 0, cp: 0 }, split: {} };
    this._pools = null;
    await this.#touch();
  }

  static async #onRerollLine(event, target) {
    const id = target.dataset.lineId;
    const i = this.record.lines.findIndex(l => l.id === id);
    if (i < 0) return;
    const line = this.record.lines[i];
    const pool = this._pools?.[line.categoryId];
    if (!pool?.length) {
      return ui.notifications?.warn(game.i18n.localize("TR.Encounter.RerollUnavailable"));
    }
    // Re-roll against the value this line vacates, so the hoard's total is unchanged
    // in aggregate even though the item differs.
    const candidate = pickNear(pool, line.value, line.value * 1.35, Math.random);
    if (!candidate) return ui.notifications?.warn(game.i18n.localize("TR.Encounter.RerollUnavailable"));
    this.record.lines[i] = {
      ...line, uuid: candidate.uuid, name: candidate.name, img: candidate.img,
      type: candidate.type, subType: candidate.subType, value: candidate.value,
      sourceId: candidate.sourceId
    };
    await this.#touch();
  }

  static async #onToggleLock(event, target) {
    const line = this.record.lines.find(l => l.id === target.dataset.lineId);
    if (!line) return;
    line.locked = !line.locked;
    await this.#touch();
  }

  static async #onDeleteLine(event, target) {
    const id = target.dataset.lineId;
    this.record.lines = this.record.lines.filter(l => l.id !== id);
    delete this.record.assignment[id];
    await this.#touch();
  }

  static async #onUnassignLine(event, target) {
    this.record.assignment = assignLine(this.record.assignment, target.dataset.lineId, null);
    await this.#touch();
  }

  // ── bulk distribution (§17.2) ──

  static async #onBulkDistribute(event, target) {
    const mode = target.dataset.mode;
    // Locked targets are skipped by every bulk button — that is the whole point of the
    // lock. Wolves in a bandit encounter should not be handed gems.
    const targets = distributableTargets(this.record, memberTargets(this.resolved.members)).map(t => t.id);
    if (!targets.length) return ui.notifications?.warn(game.i18n.localize("TR.Encounter.NoOpenTargets"));
    const tray = unassignedLines(this.record);
    if (!tray.length) return ui.notifications?.warn(game.i18n.localize("TR.Encounter.TrayEmpty"));
    const patch = distributeLines(tray, targets, mode, { weights: crWeights(this.resolved.members) });
    this.record.assignment = { ...this.record.assignment, ...patch };
    await this.#touch();
  }

  static async #onReturnAll(event, target) {
    // Locked lines and anything on a locked target stay put.
    this.record.assignment = clearAssignments(this.record);
    await this.#touch();
  }

  static async #onTogglePin(event, target) {
    const line = this.record.lines.find(l => l.id === target.dataset.lineId);
    if (!line) return;
    line.pinned = !line.pinned;
    await this.#touch();
  }

  static async #onToggleTargetLock(event, target) {
    this.record.lockedTargets = toggleTargetLock(this.record.lockedTargets, target.dataset.id);
    await this.#touch();
  }

  static async #onLoadProfile(event, target) {
    const profile = getHoardProfile(this.element.querySelector(".encounter-profile-select")?.value);
    if (!profile) return ui.notifications?.warn(game.i18n.localize("TR.Hoard.PickFirst"));
    // Merged, not replaced: a category the profile does not mention keeps its setting.
    this.record = applyProfileToRecord(this.record, profile);
    await this.#touch();
    ui.notifications?.info(game.i18n.format("TR.Hoard.Loaded", { name: profile.name }));
  }

  static async #onSaveProfile(event, target) {
    const name = await promptForText(
      game.i18n.localize("TR.Hoard.SaveTitle"),
      game.i18n.localize("TR.Hoard.SaveLabel"),
      this.record.profile?.name ?? ""
    );
    if (!name?.trim()) return;
    const profile = await saveProfileFromRecord(this.record, name);
    if (!profile) return ui.notifications?.error(game.i18n.localize("TR.Hoard.SaveFailed"));
    // Stamp provenance, so the window stops reporting the draft as modified.
    this.record.profile = { id: profile.id, name: profile.name };
    await this.#touch();
    ui.notifications?.info(game.i18n.format("TR.Hoard.Saved", { name: profile.name }));
  }

  static async #onDeleteProfile(event, target) {
    const profile = getHoardProfile(this.element.querySelector(".encounter-profile-select")?.value);
    if (!profile) return ui.notifications?.warn(game.i18n.localize("TR.Hoard.PickFirst"));
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Hoard.DeleteTitle") },
      content: `<p>${game.i18n.format("TR.Hoard.DeleteConfirm", { name: profile.name })}</p>`
    });
    if (!ok) return;
    await deleteHoardProfile(profile.id);
    if (this.record.profile?.id === profile.id) this.record.profile = null;
    await this.#touch();
  }

  static async #onToggleCategory(event, target) {
    const id = target.dataset.category;
    const cfg = this.record.mix.categories[id];
    if (cfg) cfg.enabled = !cfg.enabled;
    await this.#touch();
  }

  /**
   * Exclude a target from the coin split, or let it back in.
   *
   * Coin it already holds is reallocated to the remaining targets in proportion to what
   * they hold, the same repair the §18.4 pre-flight makes for a deleted token. Dropping
   * the entry without redistributing would leave the split short of the pool, and Apply
   * would hand out less than the budget with nothing to show why.
   */
  static async #onToggleCoinLock(event, target) {
    const id = target.dataset.id;
    const excluded = (this.record.coinExcluded ?? []).includes(id);
    this.record.coinExcluded = toggleTargetLock(this.record.coinExcluded, id);
    if (!excluded && this.record.currency.split?.[id]) {
      const { split } = reallocateCoin(this.record.currency.split, [id],
                                       this.record.currency.denomWeights);
      this.record.currency.split = split;
    }
    await this.#touch();
  }

  static async #onSplitCoins(event, target) {
    const targets = coinTargets(this.record, memberTargets(this.resolved.members)).map(t => t.id);
    if (!targets.length) return ui.notifications?.warn(game.i18n.localize("TR.Encounter.NoCoinTargets"));
    this.#recomputeCoins();
    if (poolToCp(this.record.currency.pool) <= 0) {
      return ui.notifications?.warn(game.i18n.localize("TR.Encounter.NoCoins"));
    }
    this.record.currency.split = splitCurrency(
      this.record.currency.pool, targets, target.dataset.mode,
      {
        weights: crWeights(this.resolved.members),
        // One slider spans even/proportional through effectively random (§17.3).
        randomness: (this.record.currency.splitRandomness ?? 0) / 100,
        denomWeights: this.record.currency.denomWeights
      }
    );
    await this.#touch();
  }

  static async #onApply(event, target) {
    if (this.record.applied?.at) {
      return ui.notifications?.warn(game.i18n.localize("TR.Encounter.AlreadyApplied"));
    }
    // Pre-flight: a target that has gone away is repaired and the GM is sent back to
    // the window, rather than Apply writing half an encounter and stranding the rest.
    const missing = await findMissingTargets(this.record);
    if (missing.length) {
      const { record, returned, coinMoved } =
        pruneMissingTargets(this.record, missing, this.record.currency.denomWeights);
      this.record = record;
      await saveEncounter(this.record, { immediate: true });
      ui.notifications?.warn(game.i18n.format("TR.Encounter.TargetsGone", {
        count: missing.length, items: returned, coin: formatGp(coinMoved / 100)
      }));
      return this.render();
    }

    const plan = applyPlan(this.record);
    if (!plan.targets) {
      return ui.notifications?.warn(game.i18n.localize("TR.Encounter.NothingToApply"));
    }

    // The confirmation states what will happen, including what will NOT: value left in
    // the tray is the thing a GM is most likely to have forgotten about.
    const lines = [game.i18n.format("TR.Encounter.ApplyConfirm", {
      items: plan.itemCount, targets: plan.targets
    })];
    if (plan.unassignedCount) {
      lines.push(`<p class="encounter-warn">${game.i18n.format("TR.Encounter.ApplyLeftover", {
        count: plan.unassignedCount, value: formatGp(plan.unassignedValue)
      })}</p>`);
    }
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Encounter.ApplyTitle") },
      content: lines.join("")
    });
    if (!ok) return;

    const equipDefault = readSetting("encounter-equip-generated", true);
    const { applied, errors } = await applyEncounter(this.record, { equipDefault });
    this.record.applied = applied;
    // Forced, not debounced: what was written to actors must not be lost if the window
    // closes or the client drops before the timer fires.
    await saveEncounter(this.record, { immediate: true });
    reportIssues(errors, "TR.Encounter.ApplyDone");
    await this.render();
  }

  static async #onUndo(event, target) {
    if (!this.record.applied?.at) {
      return ui.notifications?.warn(game.i18n.localize("TR.Encounter.UndoNotApplied"));
    }
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Encounter.UndoTitle") },
      content: `<p>${game.i18n.localize("TR.Encounter.UndoConfirm")}</p>`
    });
    if (!ok) return;

    const { errors } = await undoEncounter(this.record);
    this.record.applied = null;
    await saveEncounter(this.record, { immediate: true });
    reportIssues(errors, "TR.Encounter.UndoDone");
    await this.render();
  }

  /** Force the debounced draft to disk before the window goes away (§12.1). */
  async close(options) {
    if (this.record) await saveEncounter(this.record, { immediate: true });
    return super.close(options);
  }
}

// Buckets shown in the header's "already carried" breakdown.
const COIN_PARTS = ["equippedGear", "carriedGear", "consumables", "ammo", "coins"];

/**
 * A world setting that may not be registered yet — the encounter modules load whether or
 * not the §11 gate turned their registration on.
 */
function readSetting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

/**
 * Report the outcome of an Apply or Undo.
 *
 * Partial failure is the normal case, not an exception — an item the players already sold
 * cannot be reclaimed. Each problem is surfaced individually rather than collapsed into
 * "something went wrong", because the GM has to decide what to do about each one.
 */
function reportIssues(errors, doneKey) {
  if (!errors?.length) return ui.notifications?.info(game.i18n.localize(doneKey));
  for (const message of errors.slice(0, 5)) ui.notifications?.warn(message);
  if (errors.length > 5) {
    ui.notifications?.warn(game.i18n.format("TR.Encounter.MoreIssues", { count: errors.length - 5 }));
  }
  console.warn(`${LOG} Encounter loot finished with ${errors.length} issue(s):`, errors);
}

/** gp with at most two decimals, and no trailing ".00" on a whole number. */
function formatGp(value) {
  const n = Number(value) || 0;
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** gp with exactly two decimals, for figures shown in a column beside each other. */
function formatGp2(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export {
  EncounterTreasureApp,
  formatGp,
};
