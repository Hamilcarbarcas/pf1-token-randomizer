/* The tabbed per-actor / defaults dialog (DESIGN.md §1.3), and the sheet
 * header button it is opened from.
 */

import { ABILITY_KEYS, ABILITY_NAMES, COIN_KEYS, COIN_NAMES, DEFAULT_SEGMENT_WEIGHT, MODULE_ID, isRandomizableActor } from "../core/const.mjs";
import { ApplicationV2, HandlebarsApplicationMixin } from "../core/appv2.mjs";
import { promptForText } from "../core/util.mjs";
import { getAllStatMethods } from "../core/stats.mjs";
import { buildNameSegmentViewModels, loadAdjectiveLists, loadNameDatabase } from "../names/data.mjs";
import { DEFAULT_SKILL_WEIGHT, SKILL_ALIASES, aliasSkillKeys, clampGroupWeight, clampSkillWeight, computeSkillBudget, getKnownSubSkillsFor, getSkillRegistry, getSubSkillGroupsFor, groupMembers, isArbitrarySkill, isSkillAlias, skillLabel, skillRankCap, useBackgroundSkills } from "../skills/logic.mjs";
import { getActorNameRandomizerSettings, getActorRandomizerSettings, getActorSkillRandomizerSettings, getActorTreasureRandomizerSettings, getDefaultNameRandomizerSettings, getDefaultRandomizerSettings, getDefaultSkillRandomizerSettings, getDefaultTreasureRandomizerSettings, isAnyRandomizerEnabled, normalizeSkillSettings } from "../core/settings.mjs";
import { buildNames } from "../randomizers/workers.mjs";
import { getSkillProfiles, toSkillProfileConfig } from "../skills/profiles.mjs";

// ─── Settings Dialog (ApplicationV2, Tabbed) ─────────────────────────────────────


class TokenRandomizerSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    this.isDefaults = !this.actor;
    this.activeTab = "ability-scores";
    this.draftAbilitySettings = null;
    this.draftNameSettings = null;
    this.draftTreasureSettings = null;
    this.draftSkillSettings = null;
    // UI-only collapse state for name components, tracked by segment index (kept in
    // sync as segments are added/removed/reordered so it isn't written to settings).
    this.collapsedSegments = new Set();
    // UI-only collapse state for the framed boxes, keyed by box name.
    this.collapsedBoxes = new Set();
  }

  static DEFAULT_OPTIONS = {
    classes: ["pf1-token-randomizer", "token-randomizer-settings"],
    tag: "div",
    window: { title: "TR.Window.Settings", icon: "fas fa-dice", resizable: true },
    position: { width: 480, height: "auto" },
    // All class methods are installed before static field initializers run, so the
    // private static handlers below are safe to reference here.
    actions: {
      switchTab: TokenRandomizerSettings.#onSwitchTab,
      reset: TokenRandomizerSettings.#onReset,
      save: TokenRandomizerSettings.#onSave,
      cancel: TokenRandomizerSettings.#onCancel,
      addSegment: TokenRandomizerSettings.#onAddSegment,
      removeSegment: TokenRandomizerSettings.#onRemoveSegment,
      clearSegments: TokenRandomizerSettings.#onClearSegments,
      toggleSegment: TokenRandomizerSettings.#onToggleSegment,
      moveSegmentUp: TokenRandomizerSettings.#onMoveSegmentUp,
      moveSegmentDown: TokenRandomizerSettings.#onMoveSegmentDown,
      addFilter: TokenRandomizerSettings.#onAddFilter,
      removeFilter: TokenRandomizerSettings.#onRemoveFilter,
      rerollPreview: TokenRandomizerSettings.#onRerollPreview,
      removeSkillEntry: TokenRandomizerSettings.#onRemoveSkillEntry,
      addSubSkill: TokenRandomizerSettings.#onAddSubSkill,
      removeSubSkill: TokenRandomizerSettings.#onRemoveSubSkill,
      removeExcludedSkill: TokenRandomizerSettings.#onRemoveExcludedSkill,
      toggleBox: TokenRandomizerSettings.#onToggleBox,
      loadSkillProfile: TokenRandomizerSettings.#onLoadSkillProfile,
      saveSkillProfile: TokenRandomizerSettings.#onSaveSkillProfile
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/src/templates/randomizer-settings.hbs` }
  };

  /** Give each actor (and the defaults dialog) a stable, distinct window id. */
  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    applied.uniqueId = options.actor ? `token-randomizer-${options.actor.id}` : "token-randomizer-defaults";
    return applied;
  }

  get title() {
    return this.isDefaults
      ? game.i18n.localize("TR.Title.Defaults")
      : game.i18n.format("TR.Title.Actor", { name: this.actor?.name ?? game.i18n.localize("TR.ActorPlaceholder") });
  }

  async _prepareContext(options) {
    // Initialize draft settings on first render; preserved across re-renders.
    if (!this.draftAbilitySettings) {
      this.draftAbilitySettings = this.isDefaults
        ? foundry.utils.deepClone(getDefaultRandomizerSettings())
        : foundry.utils.deepClone(getActorRandomizerSettings(this.actor));
    }
    if (!this.draftNameSettings) {
      this.draftNameSettings = this.isDefaults
        ? foundry.utils.deepClone(getDefaultNameRandomizerSettings())
        : foundry.utils.deepClone(getActorNameRandomizerSettings(this.actor));
    }
    if (!this.draftTreasureSettings) {
      this.draftTreasureSettings = this.isDefaults
        ? foundry.utils.deepClone(getDefaultTreasureRandomizerSettings())
        : foundry.utils.deepClone(getActorTreasureRandomizerSettings(this.actor));
    }
    if (!this.draftSkillSettings) {
      this.draftSkillSettings = this.isDefaults
        ? foundry.utils.deepClone(getDefaultSkillRandomizerSettings())
        : foundry.utils.deepClone(getActorSkillRandomizerSettings(this.actor));
    }

    // Ability methods (built-ins + custom arrays/formulas).
    const allMethods = getAllStatMethods();
    const methods = Object.entries(allMethods).map(([key, config]) => ({
      key,
      label: config.label,
      selected: this.draftAbilitySettings.method === key
    }));
    // If the saved method was deleted from the custom list, keep it visible (and
    // selected) as an "unavailable" option so the selection isn't silently changed.
    if (!allMethods[this.draftAbilitySettings.method]) {
      methods.push({ key: this.draftAbilitySettings.method, label: game.i18n.format("TR.StatMethod.Unavailable", { method: this.draftAbilitySettings.method }), selected: true });
    }

    // Abilities with constraints & priorities. The two fields these replaced were
    // clamped independently, so worlds can hold a saved range with its minimum above
    // its maximum. The slider renders such a pair re-ordered; normalise the draft to
    // match, or the display and the value that would be saved disagree.
    const abilities = ABILITY_KEYS.map(key => {
      const constraint = (this.draftAbilitySettings.constraints[key] ??= { min: 3, max: 18, nil: false });
      let [lo, hi] = [constraint.min ?? 3, constraint.max ?? 18];
      if (lo > hi) [lo, hi] = [hi, lo]; // Swap, as the slider does, rather than invent a value.
      constraint.min = Math.max(0, Math.min(lo, 24));
      constraint.max = Math.max(constraint.min + 1, Math.min(hi, 25));
      return {
        key,
        name: game.i18n.localize(ABILITY_NAMES[key]),
        min: constraint.min,
        max: constraint.max,
        priority: this.draftAbilitySettings.priorities?.[key] ?? 0,
        nil: constraint.nil ?? false
      };
    });

    // Name builder options. Cache the loaded pools on the instance so the live
    // preview can be regenerated on slider drags without re-querying/re-rendering.
    if (!Array.isArray(this.draftNameSettings.segments)) this.draftNameSettings.segments = [];
    const db = await loadNameDatabase();
    const adjDb = await loadAdjectiveLists();
    this._nameDb = db;
    this._adjDb = adjDb;
    // Base-actor name for `actor` components; a placeholder in the defaults dialog.
    this._actorName = this.actor?.name ?? game.i18n.localize("TR.ActorPlaceholder");
    const obscureFeatureEnabled = game.settings.get(MODULE_ID, "enable-obscured-npc-names");
    const nameSegments = buildNameSegmentViewModels(this.draftNameSettings.segments, db, adjDb, this.collapsedSegments, obscureFeatureEnabled);
    // One build gives a consistent real/obscured pair for both preview lines.
    const preview = buildNames(this.draftNameSettings, db, adjDb, this._actorName);
    const namePreview = preview.real;
    const obscuredPreview = preview.obscured;
    const names = db.names ?? [];
    const givenCount = names.filter(n => n.type === "given").length;
    const surnameCount = names.filter(n => n.type === "surname").length;

    return {
      isDefaults: this.isDefaults,
      actorName: this.actor?.name || game.i18n.localize("TR.DefaultSettings"),
      activeTab: this.activeTab,
      ...this._prepareSkillContext(),
      // Ability tab
      abilityEnabled: this.draftAbilitySettings.enabled,
      prioritizeEnabled: this.draftAbilitySettings.prioritizeEnabled,
      methods,
      abilities,
      // Name tab
      nameEnabled: this.draftNameSettings.enabled,
      obscureFeatureEnabled,
      nameSegments,
      namePreview,
      obscuredPreview,
      nameCount: names.length,
      givenCount,
      surnameCount,
      // Treasure tab
      treasureEnabled: this.draftTreasureSettings.enabled,
      treasureGoldFormula: this.draftTreasureSettings.goldFormula ?? "",
      treasureRandomizeDistribution: this.draftTreasureSettings.randomizeDistribution,
      coins: COIN_KEYS.map(key => ({
        key,
        name: game.i18n.localize(COIN_NAMES[key]),
        pct: this.draftTreasureSettings.distribution[key]?.pct ?? 0,
        min: this.draftTreasureSettings.distribution[key]?.min ?? 0,
        max: this.draftTreasureSettings.distribution[key]?.max ?? 100
      }))
    };
  }

  /**
   * Render model for the Skills tab. The rank budget and the actor's class skills are
   * live facts about *this* actor, so in defaults mode (no actor) they are reported as
   * "computed at placement" rather than guessed at.
   */
  _prepareSkillContext() {
    const draft = this.draftSkillSettings;
    const registry = getSkillRegistry();
    const actorSkills = this.actor?.system?.skills ?? {};

    const listed = new Set((draft.entries ?? []).map(e => e?.key));
    const excluded = new Set(draft.excluded ?? []);
    const sortByLabel = (a, b) => a.label.localeCompare(b.label);

    const entries = (draft.entries ?? []).map((entry, index) => {
      const arbitrary = isArbitrarySkill(entry.key);
      const alias = isSkillAlias(entry.key);
      const subSkills = entry.subSkills ?? [];
      const groups = arbitrary ? getSubSkillGroupsFor(entry.key) : [];
      return {
        index,
        key: entry.key,
        label: skillLabel(entry.key),
        weight: clampSkillWeight(entry.weight),
        isArbitrary: arbitrary,
        isAlias: alias,
        // Member count, so a Knowledge (any) row says what it stands for. A class-only
        // alias can't be counted without an actor, so the defaults dialog shows none.
        aliasCount: alias ? aliasSkillKeys(entry.key, this.actor).length : 0,
        aliasUnknownCount: alias && !this.actor && SKILL_ALIASES[entry.key]?.classOnly,
        // A class skill only in the per-actor dialog; the defaults dialog has no actor.
        // An alias counts as one if any of its members is.
        isClassSkill: alias
          ? aliasSkillKeys(entry.key, this.actor).some(k => actorSkills[k]?.cs)
          : !!actorSkills[entry.key]?.cs,
        // Autocomplete source for the literal-name fields on this parent skill.
        knownId: `tr-known-${entry.key}`,
        known: arbitrary ? getKnownSubSkillsFor(entry.key) : [],
        subSkills: subSkills.map((sub, subIndex) => {
          const vm = { index: subIndex, weight: clampSkillWeight(sub?.weight) };
          if (sub?.group) {
            const group = groups.find(g => g.id === sub.group);
            vm.isGroup = true;
            vm.group = sub.group;
            // A group deleted out from under the row stays visible and selected as
            // "(unavailable)", so the reference isn't silently rewritten.
            vm.groupOptions = groups.map(g => ({ value: g.id, label: `${g.name} (${groupMembers(g).length})`, selected: g.id === sub.group }));
            if (!group) {
              vm.groupMissing = true;
              vm.groupOptions.push({ value: sub.group, label: game.i18n.localize("TR.Skill.GroupUnavailable"), selected: true });
            }
          } else {
            vm.name = sub?.name ?? "";
          }
          return vm;
        }),
        hasGroups: groups.length > 0,
        // An arbitrary entry needs at least one row that can actually resolve: a
        // non-blank literal name, or a group reference. Flagged inline, rejected on Save.
        needsSubSkills: arbitrary && !subSkills.some(s => s?.group || String(s?.name ?? "").trim())
      };
    });

    // Aliases sit alongside the real skills in both pickers. An alias is offered until
    // it is itself chosen; its members stay individually selectable either way.
    const options = (skip) => [...Object.keys(registry), ...Object.keys(SKILL_ALIASES)]
      .filter(key => !skip.has(key))
      .map(key => ({ value: key, label: skillLabel(key) }))
      .sort(sortByLabel);

    // Budget readout (§4.1). Zero is a real, silent failure mode, so it is called out.
    const withBackground = useBackgroundSkills();
    let budgetLabel;
    let budgetZero = false;
    if (this.actor) {
      const budget = computeSkillBudget(this.actor);
      budgetZero = budget.total === 0;
      const cap = skillRankCap(this.actor);
      budgetLabel = withBackground
        ? game.i18n.format("TR.Skill.BudgetActorBg", { ranks: budget.adventure, bg: budget.background, cap })
        : game.i18n.format("TR.Skill.BudgetActor", { ranks: budget.adventure, cap });
    } else {
      budgetLabel = game.i18n.localize("TR.Skill.BudgetDeferred");
    }

    const focus = draft.focus ?? {};
    const profiles = getSkillProfiles();
    return {
      skillEnabled: draft.enabled,
      skillBudgetLabel: budgetLabel,
      skillBudgetZero: budgetZero,
      skillUseBackground: withBackground,
      skillListWeight: clampGroupWeight(draft.listWeight),
      skillClassWeight: clampGroupWeight(draft.classWeight),
      skillNonClassWeight: clampGroupWeight(draft.nonClassWeight),
      skillFocusList: clampGroupWeight(focus.list),
      skillFocusClass: clampGroupWeight(focus.class),
      skillFocusNonClass: clampGroupWeight(focus.nonClass),
      // Only meaningful with an actor in hand; the defaults dialog can't know.
      skillNoClassSkills: !!this.actor && !Object.values(actorSkills).some(s => s?.cs),
      skillWipeExisting: draft.wipeExisting === true,
      skillEntries: entries,
      skillAddOptions: options(listed),
      skillExcluded: [...excluded].filter(key => registry[key] || isSkillAlias(key))
        .map(key => ({ key, label: skillLabel(key) })).sort(sortByLabel),
      skillExcludeOptions: options(excluded),
      skillListCollapsed: this.collapsedBoxes.has("skill-list"),
      skillExcludedCollapsed: this.collapsedBoxes.has("skill-excluded"),
      nameComponentsCollapsed: this.collapsedBoxes.has("name-components"),
      skillProfiles: profiles.map(p => ({ id: p.id, name: p.name })),
      skillHasProfiles: profiles.length > 0,
      // Combined so the template emits one `disabled` attribute, not two.
      skillProfilesUsable: draft.enabled && profiles.length > 0,
      skillProfileName: draft.profile?.name ?? "",
      skillProfileModified: !!draft.profile?.modified
    };
  }

  /**
   * AppV2 dispatches `data-action` clicks to the static handlers above; here we
   * wire up the live <input>/<select> change handlers that mutate the draft and
   * (where a section needs to enable/disable) trigger a re-render.
   */
  _onRender(context, options) {
    const html = this.element;
    const on = (selector, event, handler) => {
      html.querySelectorAll(selector).forEach(el => el.addEventListener(event, handler));
    };

    // ── Ability Score Tab ──
    on(".randomizer-enabled", "change", (e) => {
      this.draftAbilitySettings.enabled = e.currentTarget.checked;
      this.render();
    });
    on(".randomizer-method", "change", (e) => {
      this.draftAbilitySettings.method = e.currentTarget.value;
    });
    on(".prioritize-enabled", "change", (e) => {
      this.draftAbilitySettings.prioritizeEnabled = e.currentTarget.checked;
      this.render();
    });
    on(".ability-priority", "change", (e) => {
      const ability = e.currentTarget.dataset.ability;
      const value = parseInt(e.currentTarget.value) || 0;
      if (!this.draftAbilitySettings.priorities) this.draftAbilitySettings.priorities = {};
      this.draftAbilitySettings.priorities[ability] = Math.max(0, Math.min(value, 6));
    });
    // The slider owns the ordering and the minimum gap, so both ends arrive already
    // valid; no re-render, which would tear the control out from under a drag.
    on(".ability-range", "change", (e) => {
      const ability = e.currentTarget.dataset.ability;
      const { min, max } = e.currentTarget.value;
      this.draftAbilitySettings.constraints[ability].min = min;
      this.draftAbilitySettings.constraints[ability].max = max;
    });
    on(".ability-nil", "change", (e) => {
      const ability = e.currentTarget.dataset.ability;
      this.draftAbilitySettings.constraints[ability].nil = e.currentTarget.checked;
      this.render();
    });

    // ── Name Tab (segment builder) ──
    const seg = (el) => this.draftNameSettings.segments[Number(el.dataset.segment)];
    const clampWeight = (v) => Math.max(1, Math.min(10, parseInt(v) || DEFAULT_SEGMENT_WEIGHT));

    on(".name-enabled", "change", (e) => {
      this.draftNameSettings.enabled = e.currentTarget.checked;
      this.render();
    });
    on(".segment-nametype", "change", (e) => {
      seg(e.currentTarget).nameType = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".segment-static-text", "change", (e) => {
      seg(e.currentTarget).text = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".segment-obscure-mode", "change", (e) => {
      seg(e.currentTarget).obscure = e.currentTarget.value;
      this.render(); // re-render to show/hide the "dm" alternate-text field
    });
    on(".segment-obscured-text", "change", (e) => {
      seg(e.currentTarget).obscuredText = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".filter-race", "change", (e) => {
      const f = seg(e.currentTarget).filters[Number(e.currentTarget.dataset.filter)];
      f.race = e.currentTarget.value;
      f.region = ""; // region choices depend on race — reset to Any
      this.render();
    });
    on(".filter-region", "change", (e) => {
      seg(e.currentTarget).filters[Number(e.currentTarget.dataset.filter)].region = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".filter-gender", "change", (e) => {
      seg(e.currentTarget).filters[Number(e.currentTarget.dataset.filter)].gender = e.currentTarget.value;
      this._refreshPreview();
    });
    on(".filter-weight", "input", (e) => {
      const val = clampWeight(e.currentTarget.value);
      seg(e.currentTarget).filters[Number(e.currentTarget.dataset.filter)].weight = val;
      this._updateWeightLabel(e.currentTarget, val);
    });
    on(".adj-enabled", "change", (e) => {
      const s = seg(e.currentTarget);
      const listName = e.currentTarget.dataset.list;
      if (!Array.isArray(s.lists)) s.lists = [];
      if (e.currentTarget.checked) {
        if (!s.lists.some(l => l.list === listName)) s.lists.push({ list: listName, weight: DEFAULT_SEGMENT_WEIGHT });
      } else {
        s.lists = s.lists.filter(l => l.list !== listName);
      }
      this.render();
    });
    on(".adj-weight", "input", (e) => {
      const val = clampWeight(e.currentTarget.value);
      const entry = (seg(e.currentTarget).lists ?? []).find(l => l.list === e.currentTarget.dataset.list);
      if (entry) entry.weight = val;
      this._updateWeightLabel(e.currentTarget, val);
    });

    // ── Treasure Tab ──
    on(".treasure-enabled", "change", (e) => {
      this.draftTreasureSettings.enabled = e.currentTarget.checked;
      this.render();
    });
    on(".treasure-gold-formula", "change", (e) => {
      this.draftTreasureSettings.goldFormula = e.currentTarget.value;
    });
    on(".treasure-randomize-distribution", "change", (e) => {
      this.draftTreasureSettings.randomizeDistribution = e.currentTarget.checked;
      this.render();
    });
    on(".treasure-pct", "change", (e) => {
      const coin = e.currentTarget.dataset.coin;
      const value = parseInt(e.currentTarget.value);
      this.draftTreasureSettings.distribution[coin].pct = isNaN(value) ? 0 : Math.max(0, value);
    });
    on(".treasure-min", "change", (e) => {
      const coin = e.currentTarget.dataset.coin;
      const parsed = parseInt(e.currentTarget.value);
      this.draftTreasureSettings.distribution[coin].min = isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, 100));
      this.render();
    });
    on(".treasure-max", "change", (e) => {
      const coin = e.currentTarget.dataset.coin;
      const parsed = parseInt(e.currentTarget.value);
      this.draftTreasureSettings.distribution[coin].max = isNaN(parsed) ? 100 : Math.max(0, Math.min(parsed, 100));
      this.render();
    });

    // ── Skills Tab ──
    const skillEntry = (el) => this.draftSkillSettings.entries[Number(el.dataset.entry)];

    on(".skill-enabled", "change", (e) => {
      this.draftSkillSettings.enabled = e.currentTarget.checked;
      this.render();
    });
    // Group weights (0 = fallback tier) and the three focus sliders all share a shape:
    // clamp 0–10, write to a draft path, update the readout without re-rendering.
    const groupSlider = (selector, apply) => on(selector, "input", (e) => {
      const val = clampGroupWeight(e.currentTarget.value);
      apply(val);
      this.#markSkillProfileModified();
      this._setWeightLabel(e.currentTarget, val);
    });
    groupSlider(".skill-list-weight", v => { this.draftSkillSettings.listWeight = v; });
    groupSlider(".skill-class-weight", v => { this.draftSkillSettings.classWeight = v; });
    groupSlider(".skill-nonclass-weight", v => { this.draftSkillSettings.nonClassWeight = v; });
    // Focus is per-group, so it reads its key off the element rather than using the helper.
    on(".skill-focus", "input", (e) => {
      const val = clampGroupWeight(e.currentTarget.value);
      if (!this.draftSkillSettings.focus) this.draftSkillSettings.focus = {};
      this.draftSkillSettings.focus[e.currentTarget.dataset.group] = val;
      this.#markSkillProfileModified();
      this._setWeightLabel(e.currentTarget, val);
    });
    on(".skill-wipe-existing", "change", (e) => {
      this.draftSkillSettings.wipeExisting = e.currentTarget.checked;
      this.#markSkillProfileModified();
    });
    on(".skill-weight", "input", (e) => {
      const val = clampSkillWeight(e.currentTarget.value);
      skillEntry(e.currentTarget).weight = val;
      this.#markSkillProfileModified();
      this._setWeightLabel(e.currentTarget, val);
    });
    on(".subskill-name", "change", (e) => {
      const subs = skillEntry(e.currentTarget).subSkills ?? [];
      const sub = subs[Number(e.currentTarget.dataset.sub)];
      if (sub) sub.name = e.currentTarget.value;
      this.#markSkillProfileModified();
    });
    on(".subskill-group", "change", (e) => {
      const subs = skillEntry(e.currentTarget).subSkills ?? [];
      const sub = subs[Number(e.currentTarget.dataset.sub)];
      if (sub) sub.group = e.currentTarget.value;
      this.#markSkillProfileModified();
      this.render();
    });
    on(".subskill-weight", "input", (e) => {
      const val = clampSkillWeight(e.currentTarget.value);
      const sub = (skillEntry(e.currentTarget).subSkills ?? [])[Number(e.currentTarget.dataset.sub)];
      if (sub) sub.weight = val;
      this.#markSkillProfileModified();
      this._setWeightLabel(e.currentTarget, val);
    });
    // The two "add" pickers are <select>s rather than buttons: there are ~37 choices, so
    // a dropdown is the only sane control. They reset to their blank option on re-render.
    on(".skill-add-select", "change", (e) => {
      const key = e.currentTarget.value;
      if (!key) return;
      const entry = { key, weight: DEFAULT_SKILL_WEIGHT };
      if (isArbitrarySkill(key)) entry.subSkills = [];
      this.draftSkillSettings.entries.push(entry);
      this.#markSkillProfileModified();
      this.render();
    });
    on(".skill-exclude-select", "change", (e) => {
      const key = e.currentTarget.value;
      if (!key) return;
      if (!Array.isArray(this.draftSkillSettings.excluded)) this.draftSkillSettings.excluded = [];
      if (!this.draftSkillSettings.excluded.includes(key)) this.draftSkillSettings.excluded.push(key);
      this.#markSkillProfileModified();
      this.render();
    });
  }

  /**
   * Stamp a loaded profile as diverged, so the Skills tab stops claiming the draft still
   * matches "City Guard" the moment anything is changed (DESIGN.md §6.3).
   */
  #markSkillProfileModified() {
    if (this.draftSkillSettings.profile) this.draftSkillSettings.profile.modified = true;
  }

  /** Regenerate the live name-preview sample(s) in place (no full re-render). */
  _refreshPreview() {
    if (!this._nameDb || !this._adjDb) return;
    // One build keeps the real/obscured pair consistent across both preview lines.
    const built = buildNames(this.draftNameSettings, this._nameDb, this._adjDb, this._actorName);
    const setPreview = (selector, value) => {
      const el = this.element?.querySelector(selector);
      if (!el) return;
      // textContent (not innerHTML) since names come from user-supplied data.
      if (value) el.textContent = value;
      else el.innerHTML = `<em>${game.i18n.localize("TR.Empty")}</em>`;
    };
    setPreview(".name-preview-value", built.real);
    setPreview(".obscured-preview-value", built.obscured); // no-op when feature is off
  }

  /** Update the numeric readout next to a slider, in place (keeps drag focus alive). */
  _setWeightLabel(rangeEl, val) {
    const label = rangeEl.parentElement?.querySelector(".weight-value");
    if (label) label.textContent = String(val);
  }

  /** As above, plus a name-preview refresh (Name tab sliders only). */
  _updateWeightLabel(rangeEl, val) {
    this._setWeightLabel(rangeEl, val);
    this._refreshPreview();
  }

  // ── Action handlers (data-action) ──

  static #onAddSegment(event, target) {
    const type = target.dataset.type;
    let segment;
    if (type === "database") {
      segment = { type: "database", nameType: "given", filters: [{ race: "", region: "", gender: "", weight: DEFAULT_SEGMENT_WEIGHT }] };
    } else if (type === "adjective") {
      segment = { type: "adjective", lists: [] };
    } else if (type === "actor") {
      segment = { type: "actor" };
    } else {
      segment = { type: "static", text: "" };
    }
    this.draftNameSettings.segments.push(segment);
    this.render();
  }

  static #onRemoveSegment(event, target) {
    const i = Number(target.dataset.segment);
    this.draftNameSettings.segments.splice(i, 1);
    // Shift collapse indices above the removed one down by one.
    const next = new Set();
    for (const c of this.collapsedSegments) {
      if (c < i) next.add(c);
      else if (c > i) next.add(c - 1);
    }
    this.collapsedSegments = next;
    this.render();
  }

  static async #onClearSegments(event, target) {
    if (!this.draftNameSettings.segments.length) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("TR.Dialog.ClearSegments.Title") },
      content: game.i18n.localize("TR.Dialog.ClearSegments.Content")
    });
    if (!ok) return;
    this.draftNameSettings.segments = [];
    this.collapsedSegments.clear();
    this.render();
  }

  static #onToggleSegment(event, target) {
    const i = Number(target.dataset.segment);
    if (this.collapsedSegments.has(i)) this.collapsedSegments.delete(i);
    else this.collapsedSegments.add(i);
    // Toggle in place (no re-render) so open editors and slider focus are preserved.
    target.closest(".name-segment")?.classList.toggle("collapsed");
  }

  static #onMoveSegmentUp(event, target) {
    const i = Number(target.dataset.segment);
    const s = this.draftNameSettings.segments;
    if (i > 0) {
      [s[i - 1], s[i]] = [s[i], s[i - 1]];
      this.#swapCollapsed(i - 1, i);
      this.render();
    }
  }

  static #onMoveSegmentDown(event, target) {
    const i = Number(target.dataset.segment);
    const s = this.draftNameSettings.segments;
    if (i < s.length - 1) {
      [s[i + 1], s[i]] = [s[i], s[i + 1]];
      this.#swapCollapsed(i, i + 1);
      this.render();
    }
  }

  /** Swap the collapsed state of two segment indices (used when reordering). */
  #swapCollapsed(a, b) {
    const set = this.collapsedSegments;
    const ha = set.has(a);
    const hb = set.has(b);
    set.delete(a);
    set.delete(b);
    if (hb) set.add(a);
    if (ha) set.add(b);
  }

  static #onAddFilter(event, target) {
    const s = this.draftNameSettings.segments[Number(target.dataset.segment)];
    if (!Array.isArray(s.filters)) s.filters = [];
    s.filters.push({ race: "", region: "", gender: "", weight: DEFAULT_SEGMENT_WEIGHT });
    this.render();
  }

  static #onRemoveFilter(event, target) {
    const s = this.draftNameSettings.segments[Number(target.dataset.segment)];
    s.filters.splice(Number(target.dataset.filter), 1);
    this.render();
  }

  static #onRerollPreview(event, target) {
    this._refreshPreview();
  }

  // ── Skills tab ──

  static #onRemoveSkillEntry(event, target) {
    this.draftSkillSettings.entries.splice(Number(target.dataset.entry), 1);
    this.#markSkillProfileModified();
    this.render();
  }

  static #onAddSubSkill(event, target) {
    const entry = this.draftSkillSettings.entries[Number(target.dataset.entry)];
    if (!Array.isArray(entry.subSkills)) entry.subSkills = [];
    if (target.dataset.kind === "group") {
      const groups = getSubSkillGroupsFor(entry.key);
      if (!groups.length) return; // the button is only rendered when groups exist
      entry.subSkills.push({ group: groups[0].id, weight: DEFAULT_SKILL_WEIGHT });
    } else {
      entry.subSkills.push({ name: "", weight: DEFAULT_SKILL_WEIGHT });
    }
    this.#markSkillProfileModified();
    this.render();
  }

  static #onRemoveSubSkill(event, target) {
    const entry = this.draftSkillSettings.entries[Number(target.dataset.entry)];
    entry.subSkills.splice(Number(target.dataset.sub), 1);
    this.#markSkillProfileModified();
    this.render();
  }

  /** Collapse/expand a framed box in place, so open editors and focus survive. */
  static #onToggleBox(event, target) {
    const box = target.dataset.box;
    if (this.collapsedBoxes.has(box)) this.collapsedBoxes.delete(box);
    else this.collapsedBoxes.add(box);
    target.closest(".tr-box")?.classList.toggle("collapsed");
  }

  static #onRemoveExcludedSkill(event, target) {
    const key = target.dataset.key;
    this.draftSkillSettings.excluded = (this.draftSkillSettings.excluded ?? []).filter(k => k !== key);
    this.#markSkillProfileModified();
    this.render();
  }

  /**
   * Copy a saved profile into the draft (DESIGN.md §6.3). `enabled` is left alone — the
   * profile describes *how* to randomize, not whether this actor does.
   */
  static #onLoadSkillProfile(event, target) {
    const select = this.element?.querySelector(".skill-profile-select");
    const id = select?.value;
    if (!id) return;
    const profile = getSkillProfiles().find(p => p.id === id);
    if (!profile) {
      ui.notifications?.warn(game.i18n.localize("TR.Notif.SkillProfileMissing"));
      return;
    }
    Object.assign(this.draftSkillSettings, foundry.utils.deepClone(profile.config ?? {}));
    this.draftSkillSettings = normalizeSkillSettings(this.draftSkillSettings);
    this.draftSkillSettings.profile = { id: profile.id, name: profile.name };
    ui.notifications?.info(game.i18n.format("TR.Notif.SkillProfileLoaded", { name: profile.name }));
    this.render();
  }

  /**
   * Write the current draft to the world profile list. This commits immediately and
   * independently of the dialog's own Save/Cancel: a profile is world data, not part of
   * the actor draft, so cancelling the dialog must not un-save it.
   */
  static async #onSaveSkillProfile(event, target) {
    const invalid = TokenRandomizerSettings.#findInvalidSkillEntry(this.draftSkillSettings);
    if (invalid) {
      ui.notifications?.warn(game.i18n.format("TR.Notif.SkillEntryNeedsSubSkills", { skill: skillLabel(invalid.key) }));
      return;
    }
    const raw = await promptForText(
      game.i18n.localize("TR.Prompt.NewSkillProfile.Title"),
      game.i18n.localize("TR.Prompt.NewSkillProfile.Label"),
      this.draftSkillSettings.profile?.name ?? ""
    );
    if (raw === null) return;
    const name = raw.trim();
    if (!name) {
      ui.notifications?.warn(game.i18n.localize("TR.Notif.SkillProfileNameRequired"));
      return;
    }

    const profiles = getSkillProfiles();
    const existing = profiles.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const safe = foundry.utils.escapeHTML?.(name) ?? name;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("TR.Dialog.OverwriteSkillProfile.Title") },
        content: game.i18n.format("TR.Dialog.OverwriteSkillProfile.Content", { name: safe })
      });
      if (!ok) return;
      existing.config = toSkillProfileConfig(this.draftSkillSettings);
    } else {
      profiles.push({
        id: `profile-${foundry.utils.randomID()}`,
        name,
        config: toSkillProfileConfig(this.draftSkillSettings)
      });
    }
    await game.settings.set(MODULE_ID, "skill-profiles", profiles);
    const saved = profiles.find(p => p.name.toLowerCase() === name.toLowerCase());
    this.draftSkillSettings.profile = { id: saved.id, name: saved.name };
    ui.notifications?.info(game.i18n.format("TR.Notif.SkillProfileSaved", { name }));
    this.render();
  }

  /**
   * The first arbitrary entry with nothing that can resolve to a subskill, or null
   * (DESIGN.md §4.8). A group reference counts as defined even if the group itself was
   * later deleted — that is reported in the row, not as a save-blocking error.
   */
  static #findInvalidSkillEntry(settings) {
    return (settings.entries ?? []).find(
      e => isArbitrarySkill(e?.key) && !(e.subSkills ?? []).some(s => s?.group || String(s?.name ?? "").trim())
    ) ?? null;
  }

  static #onSwitchTab(event, target) {
    this.activeTab = target.dataset.tab;
    this.render();
  }

  static #onReset(event, target) {
    this.draftAbilitySettings = foundry.utils.deepClone(getDefaultRandomizerSettings());
    this.draftNameSettings = foundry.utils.deepClone(getDefaultNameRandomizerSettings());
    this.draftTreasureSettings = foundry.utils.deepClone(getDefaultTreasureRandomizerSettings());
    // Also drops any loaded profile stamp, since the whole Skills draft is replaced.
    this.draftSkillSettings = foundry.utils.deepClone(getDefaultSkillRandomizerSettings());
    this.render();
  }

  static async #onSave(event, target) {
    // An arbitrary skill with no subskills can never receive ranks, so refuse to save it
    // silently — abort and keep the dialog open, as the stat-method manager does.
    const invalid = TokenRandomizerSettings.#findInvalidSkillEntry(this.draftSkillSettings);
    if (invalid) {
      this.activeTab = "skills";
      this.render();
      ui.notifications?.warn(game.i18n.format("TR.Notif.SkillEntryNeedsSubSkills", { skill: skillLabel(invalid.key) }));
      return;
    }

    if (this.isDefaults) {
      await game.settings.set(MODULE_ID, "ability-randomizer-defaults", this.draftAbilitySettings);
      await game.settings.set(MODULE_ID, "name-randomizer-defaults", this.draftNameSettings);
      await game.settings.set(MODULE_ID, "treasure-randomizer-defaults", this.draftTreasureSettings);
      await game.settings.set(MODULE_ID, "skill-randomizer-defaults", this.draftSkillSettings);
      ui.notifications?.info(game.i18n.localize("TR.Notif.DefaultsSaved"));
    } else {
      await this.actor.setFlag(MODULE_ID, "abilityRandomizer", this.draftAbilitySettings);
      await this.actor.setFlag(MODULE_ID, "nameRandomizer", this.draftNameSettings);
      await this.actor.setFlag(MODULE_ID, "treasureRandomizer", this.draftTreasureSettings);
      await this.actor.setFlag(MODULE_ID, "skillRandomizer", this.draftSkillSettings);
      ui.notifications?.info(game.i18n.format("TR.Notif.ActorSaved", { name: this.actor.name }));
      const actorRef = this.actor;
      setTimeout(() => {
        const sheet = actorRef.sheet;
        if (sheet?.rendered) updateRandomizerButtonColor(sheet);
      }, 100);
    }
    this.close();
  }

  static #onCancel(event, target) {
    this.close();
  }
}

// Color the button after the sheet renders
function updateRandomizerButtonColor(sheet) {
  if (!game.user?.isGM) return;
  const actor = sheet.actor;
  if (!isRandomizableActor(actor) || actor.isToken) return;
  if (actor.prototypeToken?.actorLink) return;

  const randomizerActive = isAnyRandomizerEnabled(actor);
  // Header buttons are in the window frame, so we must search sheet.element, not the inner html
  const el = sheet.element?.[0] ?? sheet.element;
  if (!el) return;
  const btn = el.querySelector?.(".token-randomizer-settings");
  if (btn) {
    if (randomizerActive) {
      btn.style.color = "#e8a63e";
      btn.title = game.i18n.localize("TR.Button.RandomizerActive");
    } else {
      btn.style.color = "";
      btn.title = game.i18n.localize("TR.Button.Randomizer");
    }
  }
}

export {
  TokenRandomizerSettings,
  updateRandomizerButtonColor,
};
