# PF1 Token Randomizer

A Foundry VTT module for the **Pathfinder 1e** system that randomizes **ability scores**, **names**, **skill ranks**, and **carried treasure** for unlinked NPC tokens as they are dropped onto a scene. Configuration is per-actor (from the actor sheet).

**Manifest URL:** `https://github.com/Hamilcarbarcas/pf1-token-randomizer/releases/latest/download/module.json`

## Requirements

- Foundry VTT v13
- PF1e system v11.10

## Features

- **Per-actor configuration.** A *Randomizer* button is added to the header of character and NPC sheets with unlinked tokens. Each actor stores its own settings. The button glows gold when any randomizer is active for that actor.
- **Four independent randomizers**, each toggled on/off separately:
  - **Ability Scores** — generated from a chosen method, then fitted to per-ability min/max constraints with optional priority weighting.
  - **Name** — assembled from modular **segments** (database names, random adjectives, static text) joined left to right, with weighted filters.
  - **Skills** — the actor's legal skill-rank budget dealt out over a weighted list of skills, with optional class-skill priority and reusable profiles.
  - **Treasure** — a gold-value formula converted into a pp/gp/sp/cp coin spread.
- **Encounter Treasure** *(optional, off by default)*. A GM window that treats a whole encounter as the unit of loot: gather its tokens, derive the encounter's CR from their summed XP, look up what it is worth, roll a hoard, hand it out, and write it in one reversible step. See [Encounter Treasure](#encounter-treasure).
- **World defaults.** A *Token Randomizer Defaults* menu (in module settings) sets the baseline applied to every new actor. A separate *Token Randomizer Lists* menu manages the name database and adjective lists, a *Token Randomizer Stat Methods* menu adds custom ability-score arrays and dice formulas, and *Skill Profiles* / *Subskill Groups* menus manage the skill randomizer's saved settings and speciality lists.
- **Only touches unlinked tokens.** Linked tokens (which share the actor's real data) are never modified. Re-randomization is suppressed when a token is recreated by a scene/region teleport.
- **Obscured NPC names** *(optional)*. Show players an alternate name for a token unless they have at least **Observer** permission on it — substituted in chat and the combat tracker. Configured per name component, with a per-token override. See [Obscured NPC names](#obscured-npc-names).

---

## Usage

### Configuring a single actor

Open a character or NPC sheet with an unlinked token and click the **🎲 Randomizer** button in the window header. The dialog has four tabs — enable whichever randomizers you want, configure them, and click **Save**. Settings are stored on that actor. Use **Reset to Defaults** to copy the world default settings back into the dialog.

### Setting world defaults

Go to **Game Settings → Configure Settings → PF1 Token Randomizer → Configure Defaults**. This opens the same dialog in "defaults" mode. Whatever you save here becomes the starting configuration for newly created actors. The name database and adjective lists are managed separately under **Manage Lists** (see below).

### How randomization fires

When an **unlinked** token is placed on a scene by a GM, each enabled randomizer runs against that token's copy of the actor. The token is then flagged so that moving it between scenes/regions does not re-roll it.

---

## The four randomizers

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

- **Range constraint** — each ability's value is fitted into its allowed range (and clamped if no generated value fits). Set the range with the two-knob slider: drag either knob, or type an exact score in the field at either end. The knobs cannot cross or meet, so the low end is always at least one point below the high end.
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

### Skills

Deals out skill ranks when the token is placed.

#### How many ranks

The budget is **the actor's own legal skill-point total** — there is nothing to type. It is worked out exactly the way the character sheet does: skill points per level from each class, plus the Intelligence modifier, times that class's hit dice, plus favoured-class skill picks and any skill-rank bonus. Racial hit dice count, so bestiary-style NPCs get a budget too. No skill may exceed **max ranks** (the actor's character level), same as on the sheet.

The tab shows the figure for the actor you're editing (e.g. *"24 ranks · max 5 per skill"*). If it reads **0**, that actor carries no class items at all and nothing will be dealt out — give it a class (racial hit dice count) first.

**Background skills.** If Pathfinder's *background skills* optional rule is switched on in the system settings, the readout splits — e.g. *"24 ranks + 8 background"* — and the two pools obey the rule's asymmetry. Background ranks are spent first and can only land on background skills; adventure ranks are spent afterwards and can go anywhere, background skills included. Background ranks with no background skill available to take them are simply lost, exactly as the rule intends. Note that five of the thirteen background skills are Craft, Perform, Profession, Art and Lore, which need a speciality (see below) before they can take ranks at all.

#### Which skills — three groups, two knobs each

Every skill that isn't excluded is a candidate. Which ones actually get ranks is decided by three groups, each with a **weight** and a **focus**:

| Group | What it covers |
| --- | --- |
| **Skill list** | the skills you add by hand, each with its own weight |
| **Class skills** | everything else the actor treats as a class skill |
| **Other skills** | everything else |

Each rank is dealt in **two steps**: first the three **weights** decide *which group* it goes to, then the group decides *which skill*.

**Weight (0–10)** is the relative chance of a rank going to that group. Only ratios matter, so the default **5 / 5 / 1** sends about 45% of ranks to your list, 45% to class skills, and 9% to everything else. A weight of **0** does *not* mean never — it means **last resort**: that group is only drawn from once every group weighted 1 or more has run out of room.

Once a group is chosen:

- **Skill list** — the entry weights decide which **row**, so they're relative *only to each other*. A row at 8 gets four times the ranks of one at 2 in the same list, and never competes directly against a class skill. Entries always weigh at least 1, since adding one is a deliberate choice.
- **Class skills** and **Other skills** — picked evenly at random. There's no per-skill weighting inside these; if you want a specific skill favoured, add it to the list.

**A row is one row, however many skills it covers.** *Knowledge (any)* is a single entry even though it stands for ten skills, and a *Craft* entry is a single entry however many specialities you give it. So a list holding Knowledge (any), Craft (weaponsmithing, armorsmithing, bowmaking) and Perception — all at weight 5 — gives an equal chance of a Knowledge, a Craft, or Perception. Once a row is chosen, it picks one of its own skills: by their weights for a Craft entry's specialities, evenly for a Knowledge alias.

The three weights cover the whole range of "how much do class skills matter":

- **List 0, Class 10, Other 0** — every class skill fills to maximum before anything else scores a point.
- **List 5, Class 5, Other 1** *(the default)* — your picks and class skills equally, with the occasional outlier.
- **List 10, Class 1, Other 0** — almost everything goes to the skills you chose.
- **List 0, Class 0, Other 5** — a deliberately off-book NPC.

If the actor carries nothing (class, race or feat) declaring any class skills, the tab says so and the class row has nothing to act on.

**Settling on a speciality.** A row covering several skills **narrows to the first one it picks**, and keeps it for the rest of that token. A Craft entry with three specialities becomes, say, *Craft (armorsmithing)* on the first rank it wins, and every later Craft rank goes there too — so you get one competent crafter rather than three dabblers. The same applies to a Craft or Profession that turns up through the Class or Other groups, drawing from the specialities the actor already has.

A narrowed row only opens up another speciality if the character runs out of anywhere else to put ranks entirely — if some other skill still has room, the rank goes there instead.

**Knowledge (any)** is the deliberate exception. Both pickers offer it (and **Knowledge (class skills)**, covering only the Knowledges that actor treats as class skills), covering the whole family in one row so you don't add or exclude them one at a time. It counts as a single entry when the list rolls, then picks one Knowledge at random — and unlike Craft it **never settles**, so a later rank can land on a different one. Focus still works on it: a rank landing on Knowledge (arcana) with focus set will keep filling *arcana*, because focus repeats the exact skill rather than the row. Excluding an alias excludes every skill it covers, and a specific Knowledge you list separately is claimed by its own row and dropped from the alias's, so it's never counted twice.

**Focus (0–10)** is how much a group *concentrates*. After a rank is placed, focus is the chance the next rank goes into the same skill. At **0** every rank is an independent draw and ranks spread thin across many skills. At **10** a skill keeps taking ranks until it hits maximum before the draw moves on, giving deep, narrow spreads. In between you get runs of a few ranks at a time. Focus is read from the group the last rank came from, so you can have a tightly-focused hand-picked list alongside a broadly-spread remainder.

#### Excluded skills

Excluded skills are **never written to at all**. They can't receive ranks by any route — not from the list, not from either group — *and* they're skipped by the clear-out below, so they keep whatever ranks the statblock already had. If the only skills left with room are excluded, the remaining points simply go unspent. Excluding **Knowledge (any)** excludes all ten individually, and beats a Knowledge entry in the skill list — exclusion always wins.

That's the difference between excluding a skill and setting its group's weight to 0: a 0-weight group is still a last-resort source of ranks, and its skills still get cleared; an excluded skill is untouchable either way.

#### Clearing existing ranks

**Clear existing ranks first** is **off by default**, so the rolled ranks are added on top of whatever the actor already has — a hand-built statblock keeps its ranks. Note that adding to an actor that already spent its skill points can push it past its legal total.

Turn it **on** to zero every skill before dealing, so the result is the roll and nothing else — the right choice for a bare NPC you want fully generated. Either way, excluded skills are never cleared, and the max-ranks cap applies to the running total, so adding on top still can't take a skill past its maximum.

If nothing in your configuration can actually receive a rank — an empty list with class skills switched off — the randomizer leaves the actor's skills completely untouched rather than clearing them.

#### Craft, Perform, Profession, Art and Lore

These five skills can't hold ranks on their own row in Pathfinder 1e; their ranks live in individual specialities (*Craft (weapons)*, *Perform (dance)*). Adding one to the **skill list** makes you name at least one speciality for it. Each is matched to an existing one on the actor **by name**, or created if it isn't there — and only if it actually draws ranks, so a zero roll won't litter the sheet with empty rows.

They can also turn up through the **Class skills** and **Other skills** groups, but only using specialities the actor **already has** — the randomizer won't invent *Profession (siege engineer)* on a skill it merely happened to roll. A Craft or Profession with no specialities on the sheet is simply skipped by those groups.

Rather than naming every speciality by hand on every actor, you can define a **group**: a named set of specialities under one skill, from which **one member is drawn at random per token**. For example, a *Smithing* group under Craft holding *Weaponsmithing*, *Armorsmithing* and *Blacksmithing* gives each guard one of the three. The group's weight competes with the other rows; members within it are drawn evenly. Two group rows under the same skill try not to land on the same member.

Groups are defined under **Game Settings → Configure Settings → PF1 Token Randomizer → Manage Subskill Groups** — give each a name and pick which of the five skills it belongs to, then click **Select Items** to choose its specialities: a checkbox list of that skill's autocomplete entries, plus a **Custom Entries** field at the bottom for anything not on it. The group's specialities show underneath as chips you can remove individually, and the chevron collapses that list. A group belongs to a single skill, so a Craft group is only offered on Craft entries. Deleting a group leaves any setting that used it showing *(unavailable)* rather than silently changing.

The **Autocomplete Lists** section at the top of that window is where those specialities come from: one row per skill, entered the same way as the system's damage vulnerabilities and immunities — type a name, press **Enter**, and it becomes a chip you can remove with its ×. These feed both the Select Items checkboxes and the suggestions offered as you type a speciality name in the Skills tab; you can always type something that isn't on the list.

The window opens with every list and group collapsed, each showing its member count — click a chevron to expand one. The entry field stays usable while a list is collapsed, so you can keep adding without expanding it. A group you add is expanded from the start.

Four of the five come pre-filled: **Artistry** (6), **Craft** (22), **Perform** (10) and **Profession** (25). **Lore** ships empty, since its specialities are campaign-specific. Edit them freely — the shipped lists are only used to fill a skill whose list is empty, and never overwrite one you've changed. **Restore defaults** puts the original lists back.

#### Profiles

A **profile** is a named snapshot of the whole Skills tab that you can drop onto any actor. Save one with **Save as Profile…** from either an actor's dialog or Configure Defaults; load one from the dropdown at the top of the tab.

Loading **copies** the settings in — it does not create a live link. Editing or deleting a profile later never reaches back into actors already configured from it. The tab shows which profile a config came from, and marks it *(modified)* once you change anything.

Profiles can be created from either dialog, but can only be **renamed, reordered or deleted** under **Game Settings → Configure Settings → PF1 Token Randomizer → Manage Skill Profiles**. To change what a profile *contains*, load it in Configure Defaults, edit it, and save it again under the same name.

### Treasure

![Treasure tab](assets/Randomizer%20-%20Treasure.png)

Replaces the actor's carried currency (pp/gp/sp/cp) with a freshly generated amount.

- **Total Value** — a gold-piece formula supporting dice and actor roll data, e.g. `2d6*100` or `@cr * 50`. The shorthand `@cr` resolves to the actor's total CR. Four more shorthands give the SRD treasure-per-encounter value for that CR: `@crLow`, `@crMed` and `@crHigh` (also spelled `@crSlow`, `@crMedium`, `@crFast`). **These are per-*encounter* figures applied to a single token**, so a group of creatures wants a divisor — `@crMed / 4` for a party-sized band. The [Encounter Treasure](#encounter-treasure) window solves that properly.
- **Coin Distribution** — how many coins of each type there are. The four numbers are relative **counts, not shares of value**: an even split of 100 gp is 9 pp, 9 gp, 9 sp and 10 cp — roughly equal *piles* — not 25 gp worth of each. The full value is always placed; whatever will not divide is made into change from the largest weighted denomination down.
  - **Fixed** — enter a weight per coin. They are relative, so they need not add up to 100.
  - **Randomized** *(toggle "Randomize Distribution")* — enter a Min/Max (0–100) per coin; a weight is rolled in each range.

---

## Encounter Treasure

*Off by default.* Turn on **Enable Encounter Treasure** in the module settings and reload. Open it from the **Notes** scene-control group, the Journal directory button, or `game.modules.get("pf1-token-randomizer").api.encounters.open()`. GM only.

The per-token Treasure tab answers *"what is this creature carrying?"*. This answers *"what is this fight worth?"* — which the SRD's treasure table is actually about.

### Building an encounter

Drag tokens onto the window, or use **Add Selected** / **Add Combatants**. Each member's CR is cached, so deleting a token later does not silently change what the encounter is worth — it stays listed as *(missing)* and still counts.

The encounter's CR is derived from **summed XP**, not from the toughest creature. Six CR 5 bandits are 9,600 XP — a CR 10 encounter worth 5,450 gp at medium pace, rather than six separate 1,550 gp payouts. Pick **Slow / Medium / Fast** for your campaign's wealth track, or override the CR or the gp figure directly.

Anything the members already carry is **counted against the budget**, as the SRD intends, so a well-equipped NPC generates less. Three toggles decide what counts: worn gear, coins, and consumables/ammunition. The header shows *budget — already carried — to generate*.

### Rolling the mix

Each treasure category has an **independent chance** of appearing at all (1–10), not a share of the budget. Turning every slider down genuinely produces a coin-heavy hoard. Categories are rolled in a **shuffled order**, and one that appears claims a slice of the *whole* hoard within its **Category value** range — so two large slices can leave the third category nothing, which is the intended drama.

- **Chance** — how often this category turns up.
- **Item values** — a range each item's size is drawn from. Low: many cheap things. High: one or two expensive ones.
- **Category value** — how much of the hoard this category claims when it rolls.
- The checkbox beside each name excludes it entirely.

Whatever no category claims becomes **coin**, so items plus coin always equal the budget exactly. Repeat draws stack (*Amethyst ×3*). Drag any item from a compendium or the sidebar into the mix to add it by hand.

**Profiles** save the whole mix — *Dragon Hoard*, *Bandit Camp*, *Wizard's Study* and *Beast Lair* ship as presets. Loading merges: a category the profile does not name keeps its current setting. The bar shows which profile a hoard came from, and marks it *(modified)* once you change anything. Profiles deliberately do **not** carry the pace or the budget overrides — those say how much the encounter is worth, not what kind of loot it holds.

### Handing it out

Generated items land in **Unassigned**. Drag them onto a target, or use **Even / Random / By CR**; **Return All** empties the targets again. Two independent locks:

- the **padlock** in the tray keeps an item through a re-generate;
- the **thumbtack** on a target card keeps it through *Return All*.

An item already placed on a target survives a re-generate anyway, so the way to genuinely re-roll a hoard is *Return All*, then *Generate*. A **locked target** (bottom-right of its card) is skipped by every bulk button including *Return All* — useful for the wolves in a bandit encounter.

A third, separate control: the **coin sack** left of a target's name keeps it out of the coin split while it still takes items — the wolves carry the gear but not the purse. Coin it already held is spread across the remaining targets, so the split still adds up to the pool.

Coin is whatever the budget has left after the items, so there is nothing to type. Its denomination mix is set by count weights, with a randomness slider; a second slider spans "as even as the integers allow" through "effectively random" for both the **Even** and **By CR** splits. Every split adds back up to the pool exactly.

Loot piles are not a separate concept: make one however you like and add its token as a member. Item Piles actors are CR 0, so they do not affect the budget.

If you have [Item Piles](https://foundryvtt.com/packages/item-piles), the **Loot Piles Control** setting adds a **Loot Piles from Selected** button to the *token* controls, which turns the selected tokens into lootable piles. It is off as shipped, and the setting is greyed out without Item Piles. It sits with the token tools rather than beside the encounter window because switching scene layers clears the token selection.

### Applying

Nothing is written until **Apply to Actors**. It creates the items, equips what should be worn (per the *Equip Generated Gear* setting, overridable per item), and adds the coin. **Undo** removes exactly what it created.

Apply checks every target first: if a token has been deleted, **nothing is written** — its items return to Unassigned and its coin is shared among the remaining targets in proportion to what they already hold, and you are sent back to the window.

**Treasure sources.** Out of the box, *Mundane Gear* draws from the system's own item, weapon and armour compendiums. Gems, art, consumables and magic items have no source yet and will push their whole share into coin until one is pointed at them — the window marks them *(no sources)*.

---

## Notes & limitations

- **Unlinked tokens only.** Linked tokens and the prototype actor are never modified.
- **Character and NPC actors only.** Other PF1 actor types (vehicles, traps, haunts, basic actors) are skipped entirely — they get no *Randomizer* button and are never randomized off the world defaults.
- **Treasure replaces, not adds.** Existing currency on the token is overwritten. Encounter Treasure is the opposite: it *adds* to whatever the actor already has.
- **Encounter Treasure is GM-only** and never fires on its own — it is a window you open, not something that happens at token placement.
- **Coin weights are counts, not value.** This changed in this release; a saved distribution using more than one denomination will produce a different spread than before. Single-denomination settings are unaffected.
- **Skills run after ability scores**, because the rank budget depends on Intelligence — so a randomized Int feeds the number of ranks dealt.
- **Skill limitations.** Per-actor custom skills (ones you added yourself with the ＋ button on the skills tab) are never listed, never dealt ranks, and never cleared.
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

tr.encounters.open(encounterId?);        // the picker, or one encounter directly
tr.encounters.pilesFromTokens(tokens?);  // turn tokens into Item Piles loot piles

tr.treasureForCR(cr, "medium");          // SRD treasure value for a CR at a pace
tr.encounterCR([5, 5, 5, 5, 5, 5]);      // { totalXP: 9600, cr: 10 }
tr.encounterCarriedValue(actor);         // { gp, cp, parts: { equippedGear, ... } }
tr.rollHoard({ total, categories, mix, pools });   // pure: roll a mix into lines + coin
tr.registerTreasureProvider(id, { generate });     // supply candidates from your own module

tr.computeSkillBudget(actor);            // { adventure, background, total }
tr.skillRankCap(actor);                  // max ranks in any one skill (character level)
tr.buildSkillSlots(actor, settings);     // the rows a config produces, and their members
```

### Adjusting the rank budget

Pathfinder offers no *background*-specific Change target, so a module granting a free background rank has to route it through `bonusSkillRanks` — which lands in `system.details.skills.bonus`, the **adventure** pool. A module doing that typically patches its own sheet display to re-pool the rank, but this module reads actor data rather than the sheet, and would otherwise spend it on an adventure skill.

The `pf1TokenRandomizerSkillBudget` hook lets such a module correct the split. Listeners mutate the budget in place; the result is floored and clamped at zero afterwards, so a bad listener can't produce a negative or fractional budget.

```js
Hooks.on("pf1TokenRandomizerSkillBudget", (actor, budget) => {
  if (!grantedMyFreeBackgroundRank(actor)) return;
  if (budget.adventure < 1) return;
  budget.adventure -= 1;   // move it out of the pool PF1 put it in…
  budget.background += 1;  // …and into the one the house rule means
});
```

The hook fires wherever the budget is calculated, so the figure shown in the Skills tab matches what actually gets dealt.

All routes funnel through the same `shouldObscure` gate the UI substitutions use (feature enabled + token opted in + non-empty obscured name + user lacks Observer). GMs always hold Observer, so they always get the real name. As with the display features, this is presentation-layer only — the real name is still synced to every client.

---

## License

Released under the [GNU GPL v3](LICENSE).
