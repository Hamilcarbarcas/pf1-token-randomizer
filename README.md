# PF1 Token Randomizer

A Foundry VTT module for the **Pathfinder 1e** system that randomizes **ability scores**, **names**, and **carried treasure** for unlinked NPC tokens as they are dropped onto a scene. Configuration is per-actor (from the actor sheet).

**Manifest URL:** `https://github.com/Hamilcarbarcas/pf1-token-randomizer/releases/latest/download/module.json`

## Requirements

- Foundry VTT v13
- PF1e system v11.10

## Features

- **Per-actor configuration.** A *Randomizer* button is added to the header of character and NPC sheets with unlinked tokens. Each actor stores its own settings. The button glows gold when any randomizer is active for that actor.
- **Three independent randomizers**, each toggled on/off separately:
  - **Ability Scores** — generated from a chosen method, then fitted to per-ability min/max constraints with optional priority weighting.
  - **Name** — assembled from modular **segments** (database names, random adjectives, static text) joined left to right, with weighted filters.
  - **Treasure** — a gold-value formula converted into a pp/gp/sp/cp coin spread.
- **World defaults.** A *Token Randomizer Defaults* menu (in module settings) sets the baseline applied to every new actor. A separate *Token Randomizer Lists* menu manages the name database and adjective lists, and a *Token Randomizer Stat Methods* menu adds custom ability-score arrays and dice formulas.
- **Only touches unlinked tokens.** Linked tokens (which share the actor's real data) are never modified. Re-randomization is suppressed when a token is recreated by a scene/region teleport.
- **Obscured NPC names** *(optional)*. Show players an alternate name for a token unless they have at least **Observer** permission on it — substituted in chat and the combat tracker. Configured per name component, with a per-token override. See [Obscured NPC names](#obscured-npc-names).

---

## Usage

### Configuring a single actor

Open a character or NPC sheet with an unlinked token and click the **🎲 Randomizer** button in the window header. The dialog has three tabs — enable whichever randomizers you want, configure them, and click **Save**. Settings are stored on that actor. Use **Reset to Defaults** to copy the world default settings back into the dialog.

### Setting world defaults

Go to **Game Settings → Configure Settings → PF1 Token Randomizer → Configure Defaults**. This opens the same dialog in "defaults" mode. Whatever you save here becomes the starting configuration for newly created actors. The name database and adjective lists are managed separately under **Manage Lists** (see below).

### How randomization fires

When an **unlinked** token is placed on a scene by a GM, each enabled randomizer runs against that token's copy of the actor. The token is then flagged so that moving it between scenes/regions does not re-roll it.

---

## The three randomizers

### Ability Scores

![Ability Scores tab](assets/Randomizer%20-%20Ability%20Scores.png)

Pick a **generation method**:

| Method | Result |
| --- | --- |
| Standard Array | 13, 12, 11, 10, 9, 8 |
| Elite Array | 15, 14, 13, 12, 11, 8 |
| Champion Array | 18, 17, 14, 13, 10, 9 |
| Random Low | 3d6 per ability |
| Random High | 4d6 drop lowest per ability |
| Random Extreme | 4d6 drop lowest, with the lowest result raised to 18 |

You can also define your own methods (see [Custom stat methods](#custom-stat-methods) below); they appear in this same dropdown.

The six generated values are then assigned to abilities subject to:

- **Min / Max constraints** — each ability's value is fitted into its allowed range (and clamped if no generated value fits).
- **Priority assignment** *(optional)* — give abilities a priority of 1–6 (6 highest). Higher-priority abilities claim the higher available scores first; equal priorities are assigned randomly. Priority is secondary to min/max.
- **Nil** — check *Nil* to leave an ability blank ("—") instead of assigning a score. The modifier becomes +0 and the ability is treated as absent (e.g. a mindless creature with no Intelligence). This is **not** the same as a score of 0, which would give a −5 modifier. Nil abilities are excluded from the score pool so the rest still get full values.

#### Custom stat methods

Beyond the built-in methods, you can define your own under **Game Settings → Configure Settings → PF1 Token Randomizer → Manage Stat Methods**. Custom methods appear in the generation-method dropdown for every actor and the defaults dialog, labelled with their values/formula in parentheses. There are two kinds:

- **Array** — six fixed values, exactly like Standard/Elite/Champion. Order does not matter; the six values are a pool that is assigned to abilities using each actor's min/max and priority settings.
- **Formula** — a dice formula rolled once per ability, using the same syntax as the game's other formula fields (so `4d6dl1` is 4d6 drop-lowest, and `2d6+6` or `3d6` also work). Drop/keep modifiers (`dl`, `kh`, …) and `@`-references to the actor's roll data are supported.

Deleting a custom method that an actor still references leaves that actor's saved selection showing as *(unavailable)* in the dropdown; until you pick a different method, it falls back to straight 10s when the token is placed.

### Name

![Name tab](assets/Randomizer%20-%20Name.png)

The token's name is **built from an ordered list of segments**, joined left to right with single spaces. Add as many as you like, reorder them with the ▲▼ arrows, and delete the ones you don't want. A **Sample** line at the top shows a live example (click the 🎲 to reroll it). If every segment resolves to nothing, the token name is left unchanged.

Components are shown in a framed **Name Components** box; click a component's header to collapse/expand it, and use **Clear** to remove them all. There are three component types:

- **Roster Name** — draws a name from the name database. Pick the **name type** (*Given name*, *Surname*, or *Given + Surname* — the last draws one of each from the same roll), then add one or more **filters**. Each filter is a Race / Region / Gender combination (any of which can be left as *Any*) with a **weight**. One filter is chosen at random in proportion to its weight, then a name is drawn uniformly from the names matching it. So three filters at equal weight are drawn from equally, regardless of how many names each matches.
- **Adjective** — draws a random adjective. Check the **adjective lists** you want to draw from and set each one's weight; a list is picked by weight, then a random word from within it. The module ships with **threatening**, **friendly**, **serious**, and **goofy** lists, and you can add your own.
- **Actor Name** — inserts the base actor's current name. Unlike a Static component, this tracks the actor: rename the actor and the inserted name follows automatically. It has no settings.
- **Static** — a fixed string you type (e.g. `the Bold`), the same for every token.

Add components with the **+ Roster Name / + Adjective / + Actor Name / + Static** buttons at the bottom of the box.

Each component expands to its own editor:

![Roster Name component](assets/Randomizer%20-%20Name%20-%20Roster%20Name.png)

*Roster Name — name type, one or more weighted Race / Region / Gender filters, and (when obscuring is on) a visibility control.*

![Adjective component](assets/Randomizer%20-%20Name%20-%20Adjective.png)

*Adjective — check the lists to draw from and weight each one.*

![Actor Name component](assets/Randomizer%20-%20Name%20-%20Actor%20Name.png)

*Actor Name — no settings of its own beyond visibility; it tracks the base actor's name.*

**Duplicate avoidance.** When a token is placed, its rolled name is checked against the other tokens of the same actor already on the scene; if it collides, the name is re-rolled (up to 5 attempts) to keep siblings distinct. If no unique name can be found in 5 tries — or the name has no random components — the duplicate is kept, and a warning is shown that a random name couldn't be made unique.

> **Weights** are relative: only their ratios matter, and each slider runs 1–10. Setting several to the same value makes them equally likely.

#### Name database & adjective lists

Both are managed under **Game Settings → Configure Settings → PF1 Token Randomizer → Manage Lists**.

**Name database.** The effective pool is the bundled **sample** (`data/names.json`) until you import your own, after which the sample is ignored and only your custom names are used. Your database is stored at `worlds/<your-world>/pf1-token-randomizer-names.json` — in the world folder, so it survives module updates, is never synced to player clients, and travels with world backups.

- **Import** — merge names from a file (exact duplicates are skipped):
  - **CSV / TSV / TXT** — a header row with at least a `name` column; optional `type` (`given`/`surname`, defaulting to `given`), `race`, `region`, `gender`.
    ```csv
    name,type,race,region,gender
    Aldric,given,Human,Heartlands,Male
    Thorne,surname,Human,Heartlands,
    ```
  - **JSON** — a bare array or `{ "names": [ ... ] }`:
    ```json
    { "names": [ { "name": "Bromli", "type": "given", "race": "Dwarf", "region": "Ironpeak", "gender": "Male" } ] }
    ```
- **Export as TSV** — dump the current database (with the `type` column) to a file that round-trips back through Import.

Databases from before the `type` column keep working — entries without a type are treated as **given names**.

**Adjective lists.** Each list is a simple single-column list of words with a name. Bundled lists ship with the module; uploading a list with the **same name overrides** it (revertible), and any **other name adds** a new list. Custom lists can be deleted. Upload a **TXT** (one word per line), **CSV**, or a **JSON** array. Your lists live at `worlds/<your-world>/pf1-token-randomizer-adjectives.json`.

#### Obscured NPC names

Enable **Obscured NPC Names** under **Game Settings → Configure Settings → PF1 Token Randomizer** to let a token show a different name to players who don't have at least **Observer** permission on it. GMs and observers always see the real name; everyone else sees the obscured one — substituted in **chat message headers** and the **combat tracker**.

When the setting is on, every component in the Name builder gains a **Visibility** control:

- **Both names** — the component appears in the real *and* obscured name (the default).
- **Real name only** — the component is shown only to observers. You can optionally give it an **obscured substitute** string that non-observers see in its place; leave it blank to simply drop the component for them.
- **Obscured name only** — the component appears only in the obscured name (a decoy label that observers don't see).

Both names are built together when the token is placed, so a component's random draw is the same in each. The second **"Players see:"** preview line shows the obscured result live.

For linked or named tokens that don't go through the placement builder — or any one-off adjustment — open the token's **configuration → Identity** tab, where an **Obscure name from non-observers** checkbox and an **Obscured name** field let you set the override directly on that token.

**On-hover reveal.** A **Show Obscured Name on Hover** sub-setting (on by default) fills a common gap: if you keep NPC display names set to *Hovered by Owner* (so players get no name on mouse-over), a player who hovers — or Alt-highlights — such a token will see its **obscured** name instead of nothing. It only fills the gap: tokens whose display mode already shows everyone a name are left as-is, so this never reveals a name the display mode was hiding on purpose.

> **This is a presentation-layer feature, not a security boundary.** The token's real name is still sent to every client, so a determined player can read it via the browser console. It hides the name in the normal interface, nothing more.

### Treasure

![Treasure tab](assets/Randomizer%20-%20Treasure.png)

Replaces the actor's carried currency (pp/gp/sp/cp) with a freshly generated amount.

- **Total Value** — a gold-piece formula supporting dice and actor roll data, e.g. `2d6*100` or `@cr * 50`. The shorthand `@cr` resolves to the actor's total CR.
- **Coin Distribution** — how the total *value* is split across coin types (computed as gold-equivalent, then converted to coins; each coin count is rounded down, so the realized total may land slightly under the target).
  - **Fixed** — enter a percentage per coin. The four percentages are normalized by their sum, so they need not add up to exactly 100.
  - **Randomized** *(toggle "Randomize Distribution")* — enter a Min/Max (0–100) per coin; a random weight is rolled in each range and the four weights are normalized into proportions.

---

## Notes & limitations

- **Unlinked tokens only.** Linked tokens and the prototype actor are never modified.
- **Treasure replaces, not adds.** Existing currency on the token is overwritten.
- Randomization runs once per token. A token recreated by a scene/region teleport keeps its rolled values (tracked via a `randomized` token flag).
- **Obscured names hide, they don't secure.** The substitution happens per client at display time; the real name is still synced to every client and readable via the console. Coverage is limited to chat headers, the combat tracker, and the on-hover canvas nameplate (gap-fill only) — other surfaces (third-party UIs, chat card bodies, and nameplates for tokens whose display mode already shows a name) still show the real name.

---

## API (for other modules & macros)

So other code can resolve the name a given user *should* see — and never accidentally read the real name off `token.name` / `speaker.alias` for an obscured NPC — the module exposes helpers on its module object once `setup` has run:

```js
const tr = game.modules.get("pf1-token-randomizer").api;

tr.getDisplayName(tokenDoc, user = game.user);      // obscured name if the gate applies, else token.name
tr.getSpeakerDisplayName(speaker, user = game.user); // same, resolved from a ChatMessage speaker (falls back to alias)
tr.shouldObscure(tokenDoc, user = game.user);       // boolean: is the obscure gate active for this user?
tr.getObscuredName(tokenDoc);                        // the raw stored obscured name, or ""
```

All routes funnel through the same `shouldObscure` gate the UI substitutions use (feature enabled + token opted in + non-empty obscured name + user lacks Observer). GMs always hold Observer, so they always get the real name. As with the display features, this is presentation-layer only — the real name is still synced to every client.

---

## License

Released under the [GNU GPL v3](LICENSE).
