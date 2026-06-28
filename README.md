# PF1 Token Randomizer

A Foundry VTT module for the **Pathfinder 1e** system that randomizes **ability scores**, **names**, and **carried treasure** for unlinked NPC tokens the moment they are dropped onto a scene. Configuration is per-actor (from the character/NPC sheet) with a world-wide set of defaults applied to new actors.

Drop five copies of the same goblin actor and end up with five goblins that have different stat spreads, different names, and different pocket change — without touching the prototype actor.

> Requires Foundry VTT **v13+** and the **Pathfinder 1st Edition** system. GM-only.

---

## Features

- **Per-actor configuration.** A *Randomizer* button (🎲) appears in the header of character and NPC sheets. Each actor stores its own settings. The button glows gold when any randomizer is active for that actor.
- **Three independent randomizers**, each toggled on/off separately:
  - **Ability Scores** — generated from a chosen method, then fitted to per-ability min/max constraints with optional priority weighting.
  - **Name** — drawn from a name database, filterable by race, region, and gender.
  - **Treasure** — a gold-value formula converted into a pp/gp/sp/cp coin spread.
- **World defaults.** A *Token Randomizer Defaults* menu (in module settings) sets the baseline applied to every new actor, and manages the name database.
- **Only touches unlinked tokens.** Linked tokens (which share the actor's real data) are never modified. Re-randomization is suppressed when a token is recreated by a scene/region teleport.

---

## Installation

1. In Foundry, go to **Add-on Modules → Install Module**.
2. Paste the manifest URL into the bottom field:
   ```
   https://github.com/Hamilcarbarcas/pf1-token-randomizer/releases/latest/download/module.json
   ```
3. Enable **PF1 Token Randomizer** in your world's module settings.

---

## Usage

### Configuring a single actor

Open a character or NPC sheet and click the **🎲 Randomizer** button in the window header. The dialog has three tabs — enable whichever randomizers you want, configure them, and click **Save**. Settings are stored on that actor. Use **Reset to Defaults** to copy the world default settings back into the dialog.

### Setting world defaults

Go to **Game Settings → Configure Settings → PF1 Token Randomizer → Configure Defaults**. This opens the same dialog in "defaults" mode. Whatever you save here becomes the starting configuration for newly created actors, and this is also where you **import the name database** (see below).

### How randomization fires

When an **unlinked** token is placed on a scene by a GM, each enabled randomizer runs against that token's copy of the actor. The token is then flagged so that moving it between scenes/regions does not re-roll it.

---

## The three randomizers

### 🎲 Ability Scores

Pick a **generation method**:

| Method | Result |
| --- | --- |
| Standard Array | 13, 12, 11, 10, 9, 8 |
| Elite Array | 15, 14, 13, 12, 11, 8 |
| Champion Array | 18, 17, 14, 13, 10, 9 |
| Random Low | 3d6 per ability |
| Random High | 4d6 drop lowest per ability |
| Random Extreme | 4d6 drop lowest, with the lowest result raised to 18 |

The six generated values are then assigned to abilities subject to:

- **Min / Max constraints** — each ability's value is fitted into its allowed range (and clamped if no generated value fits).
- **Priority assignment** *(optional)* — give abilities a priority of 1–6 (6 highest). Higher-priority abilities claim the higher available scores first; equal priorities are assigned randomly. Priority is secondary to min/max.
- **Nil** — check *Nil* to leave an ability blank ("—") instead of assigning a score. The modifier becomes +0 and the ability is treated as absent (e.g. a mindless creature with no Intelligence). This is **not** the same as a score of 0, which would give a −5 modifier. Nil abilities are excluded from the score pool so the rest still get full values.

### ✍️ Name

The token's name is replaced with a random entry from the **name database**, optionally filtered by:

- **Race**, **Region**, **Gender** — leave any filter blank to include all.
- **Regional Variance** *(shown when a region is selected)* — a percent chance to ignore the region filter for a given token and pull a name from any region (race/gender filters still apply). Useful for "mostly local, occasionally foreign" populations.

If no name matches the active filters, the name is left unchanged.

#### Name database

The effective name pool is sourced as follows:

- **No custom data yet** → the module's bundled **sample** (`data/names.json`, just a handful of demo names) is used.
- **A custom database has been imported** → the sample is ignored entirely and only your custom names are used.

Your custom database is stored at `worlds/<your-world>/pf1-token-randomizer-names.json`. It lives in the world folder, so it survives module updates, is never synced to player clients, and travels with world backups.

**Importing names** (from the *Configure Defaults* dialog → Name tab → *Import Names*):

- **CSV / TSV / TXT** — a header row with at least a `name` column; optional `race`, `region`, `gender` columns.
  ```csv
  name,race,region,gender
  Aldric Thorne,Human,Heartlands,Male
  Faelar Nightbreeze,Elf,Silverwood,Female
  ```
- **JSON** — either a bare array of entries or `{ "names": [ ... ] }`:
  ```json
  { "names": [ { "name": "Bromli Stonehand", "race": "Dwarf", "region": "Ironpeak", "gender": "Male" } ] }
  ```

Imports **merge** into your existing custom database; exact duplicates (same name/race/region/gender) are skipped.

### 💰 Treasure

Replaces the actor's carried currency (pp/gp/sp/cp) with a freshly generated amount.

- **Total Value** — a gold-piece formula supporting dice and actor roll data, e.g. `2d6*100` or `@cr * 50`. The shorthand `@cr` resolves to the actor's total CR.
- **Coin Distribution** — how the total *value* is split across coin types (computed as gold-equivalent, then converted to coins; each coin count is rounded down, so the realized total may land slightly under the target).
  - **Fixed** — enter a percentage per coin. The four percentages are normalized by their sum, so they need not add up to exactly 100.
  - **Randomized** *(toggle "Randomize Distribution")* — enter a Min/Max (0–100) per coin; a random weight is rolled in each range and the four weights are normalized into proportions.

---

## Notes & limitations

- **GM-only.** All randomization runs on the GM client that places the token; players never trigger it.
- **Unlinked tokens only.** Linked tokens and the prototype actor are never modified.
- **Treasure replaces, not adds.** Existing currency on the token is overwritten.
- Randomization runs once per token. A token recreated by a scene/region teleport keeps its rolled values (tracked via a `randomized` token flag).

---

## License

Released under the [GNU GPL v3](LICENSE).
