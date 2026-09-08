/* Load the split module graph under stubbed Foundry globals.
 * Catches what a syntax check cannot: a missing export, an import that resolves to
 * undefined, or an evaluation-order cycle. Nothing is called — we only prove the
 * graph evaluates and that every hook/menu the entry point registers is wired. */

globalThis.HTMLElement = class {};

const registered = { hooks: [], settings: [], menus: [] };

// ApplicationV2 owns these as getter-only. Assigning one throws during construction —
// the failure mode that took `this.state = ...` down in the live world, and which a stub
// with plain properties silently tolerates.
const RESERVED = ["id", "state", "window", "form", "element", "rendered", "title",
                  "classList", "hasFrame", "minimized"];

class ApplicationV2 {
  static DEFAULT_OPTIONS = {};
  static PARTS = {};
  constructor(options = {}) { this.options = options; }
}
for (const name of RESERVED) {
  Object.defineProperty(ApplicationV2.prototype, name, {
    configurable: true,
    get() { return undefined; },
  });
}
const HandlebarsApplicationMixin = (Base) => class extends Base {};

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2,
      HandlebarsApplicationMixin,
      DialogV2: { prompt: async () => null, confirm: async () => false },
    },
    handlebars: { renderTemplate: async () => "" },
    // Foundry's custom-element base class, which the dual-range element extends.
    elements: { AbstractFormInputElement: class extends globalThis.HTMLElement {} },
  },
  utils: {
    mergeObject: (a, b) => ({ ...(a ?? {}), ...(b ?? {}) }),
    deepClone: (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o))),
    randomID: () => "abcdefgh",
    escapeHTML: (s) => s,
    getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o),
    setProperty: () => true,
    expandObject: (o) => o,
    flattenObject: (o) => o,
    duplicate: (o) => JSON.parse(JSON.stringify(o)),
  },
};

const cbs = {};
globalThis.Hooks = {
  on: (h, fn) => { registered.hooks.push(h); (cbs[h] ??= []).push(fn); },
  once: (h, fn) => { registered.hooks.push(h); (cbs[h] ??= []).push(fn); },
  callAll: () => {},
  off: () => {},
};

// World settings the hook checks below want to vary. Everything else reads undefined,
// which is the "never configured" case.
const settingValues = {};

globalThis.game = {
  settings: {
    register: (m, k) => registered.settings.push(k),
    registerMenu: (m, k) => registered.menus.push(k),
    get: (m, k) => settingValues[k],
    set: async () => {},
  },
  i18n: { localize: (s) => s, format: (s) => s, has: () => true },
  user: { isGM: true, id: "u1" },
  users: [],
  modules: { _m: { active: true, api: {} }, get() { return this._m; } },
  actors: [],
  messages: { size: 0 },
  scenes: { viewed: null },
  system: { id: "pf1" },
};

globalThis.ui = { notifications: { warn() {}, error() {}, info() {} }, controls: { render() {} } };
// Item Piles, present by default so the interop path is the one under test; the checks
// below take it away again.
globalThis.game.itempiles = { API: { turnTokensIntoItemPiles: async () => {} } };
globalThis.pf1 = {
  config: { skills: {}, arbitrarySkills: [], backgroundSkills: [], currency: { standardRate: 100, standard: "gp" } },
  dice: { RollPF: class { async evaluate() {} get total() { return 0; } } },
  utils: { CR: { fromString: () => 0, fromNumber: () => "0", getXP: () => 0 } },
};
globalThis.CONFIG = { Actor: {}, Item: {} };
globalThis.window = globalThis;
globalThis.Handlebars = { helpers: {}, registerHelper(n, f) { this.helpers[n] = f; } };
// Custom elements: the module defines its own (dual-range), which needs the registry
// and a base class to extend.
globalThis.HTMLElement = class {};
const _elements = new Map();
globalThis.customElements = {
  get: (tag) => _elements.get(tag),
  define: (tag, cls) => { _elements.set(tag, cls); },
};
globalThis.loadTemplates = async () => {};
globalThis.fromUuid = async () => null;
globalThis.Roll = class {};
globalThis.FilePicker = class {};

const target = process.argv[2] ?? "c:/Code/FoundryVTT/pf1-token-randomizer/src/scripts/main.mjs";
const url = new URL("file:///" + target);
await import(url.href);

console.log("module graph evaluated OK");
console.log("  hooks registered   :", registered.hooks.length, "->", [...new Set(registered.hooks)].join(", "));
console.log("  settings registered:", registered.settings.length);
console.log("  menus registered   :", registered.menus.length, "->", registered.menus.join(", "));

const classes = ["TokenRandomizerSettings", "TokenRandomizerListManager", "TokenRandomizerStatMethods",
                 "TokenRandomizerSkillProfiles", "TokenRandomizerSubSkillGroups"];
const missing = classes.filter((c) => typeof globalThis[c] !== "function");
console.log("  window classes     :", missing.length ? "MISSING " + missing.join(", ") : "all 5 present");

// Fire the lifecycle hooks whose bodies carry the cross-module references that
// import-time evaluation never touches.
for (const h of ["init", "setup"]) {
  for (const fn of cbs[h] ?? []) await fn();
  console.log(`  ${h} fired          : ok`);
}
console.log("  settings registered:", registered.settings.length);
console.log("  menus registered   :", registered.menus.length, "->", registered.menus.join(", "));
const api = game.modules.get().api;
console.log("  api surface        :", Object.keys(api).length ? Object.keys(api).join(", ") : "(none — stub module object)");

// Construct every window class. Nothing renders — this only proves the constructors do
// not assign to an ApplicationV2 reserved name, which no amount of parsing would show.
const windows = [
  ["TokenRandomizerSettings", () => new globalThis.TokenRandomizerSettings({})],
  ["TokenRandomizerListManager", () => new globalThis.TokenRandomizerListManager({})],
  ["TokenRandomizerStatMethods", () => new globalThis.TokenRandomizerStatMethods({})],
  ["TokenRandomizerSkillProfiles", () => new globalThis.TokenRandomizerSkillProfiles({})],
  ["TokenRandomizerSubSkillGroups", () => new globalThis.TokenRandomizerSubSkillGroups({})],
  ["EncounterTreasureApp", () => new api.encounters.App({ encounterId: "enc-x" })],
  ["EncounterPicker", () => new api.encounters.Picker({})],
];
let ctorFails = 0;
for (const [name, make] of windows) {
  try { make(); }
  catch (err) { ctorFails++; console.log(`  CONSTRUCTOR FAIL ${name}: ${err.message}`); }
}
console.log("  window constructors :", ctorFails ? `${ctorFails} FAILED` : `all ${windows.length} ok`);

// ── scene controls (§19.3) ────────────────────────────────────────────────────
// The piles control acts on the token selection, so it has to live in the TOKEN group:
// activating any other layer clears that selection, which is what made it useless in
// Notes. Nothing but firing the hook proves which group it lands in.
let controlFails = 0;
const check = (name, cond) => {
  if (!cond) { controlFails++; console.log(`  CONTROL FAIL ${name}`); }
};
const fireControls = () => {
  const controls = { tokens: { tools: {} }, notes: { tools: {} } };
  for (const fn of cbs.getSceneControlButtons ?? []) fn(controls);
  return controls;
};

settingValues["encounter-piles-button"] = true;
settingValues["encounter-treasure-enabled"] = true;
let c = fireControls();
check("piles control is in the token group", !!c.tokens.tools.tokenRandomizerPiles);
check("piles control is NOT in the notes group", !c.notes.tools.tokenRandomizerPiles);
check("encounter window stays in the notes group", !!c.notes.tools.tokenRandomizerEncounters);

settingValues["encounter-piles-button"] = false;
c = fireControls();
check("the piles control is off by default", !c.tokens.tools.tokenRandomizerPiles);
check("...without taking the encounter window with it", !!c.notes.tools.tokenRandomizerEncounters);

// The two are independent: piles is interop, not part of the encounter feature.
settingValues["encounter-piles-button"] = true;
settingValues["encounter-treasure-enabled"] = false;
c = fireControls();
check("piles survives encounter treasure being off", !!c.tokens.tools.tokenRandomizerPiles);
check("the encounter window does not", !c.notes.tools.tokenRandomizerEncounters);

// Item Piles absent: the control is withheld even with the setting stored true, since a
// world can disable the module after enabling this.
const realModules = game.modules;
game.modules = { get: (id) => (id === "item-piles" ? null : realModules._m) };
settingValues["encounter-treasure-enabled"] = true;
c = fireControls();
check("no Item Piles, no control", !c.tokens.tools.tokenRandomizerPiles);

// ...and its setting is pinned off and dimmed rather than left as an inert toggle.
const input = { name: "pf1-token-randomizer.encounter-piles-button", checked: true, disabled: false };
const hint = { textContent: "" };
const group = { classes: new Set(), classList: { add: (c2) => group.classes.add(c2) },
                querySelector: (s) => (s === ".hint" ? hint : null) };
input.closest = () => group;
const root = { querySelector: (s) => (s.includes("encounter-piles-button") ? input : null) };
// v13 hands the hook an HTMLElement; the module accepts a jQuery-ish [0] too.
for (const fn of cbs.renderSettingsConfig ?? []) fn({}, [root]);
check("the setting is unchecked when Item Piles is missing", input.checked === false);
check("...and disabled", input.disabled === true);
check("...and dimmed", group.classes.has("tr-disabled"));
check("...and says why", hint.textContent === "TR.Settings.PilesButton.Missing");
game.modules = realModules;

console.log("  scene controls      :", controlFails ? `${controlFails} FAILED` : "ok (11 checks)");
process.exit(ctorFails || controlFails ? 1 : 0);
