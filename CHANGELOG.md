# Changelog

<!--
  Release process: before tagging v<x.y.z>, rename the "Unreleased" heading
  below to "## [<x.y.z>] - <YYYY-MM-DD>". The release workflow extracts the
  section whose heading matches the pushed tag and uses it as the GitHub
  release body. If no matching section exists, the release fails.
-->

## [Unreleased]

### Added
- **Skill randomizer.** A fourth tab that deals out skill ranks when an unlinked token is placed.
  - **Rank budget** is the actor's own legal skill-point total, derived the same way the character sheet derives it (skill points per level + Int modifier, per class hit die, plus favoured-class picks and any skill-rank bonus). Racial hit dice count. No skill can exceed max ranks (character level). The tab shows the computed figure for the actor being edited, and calls out the case where it is zero.
  - **Background skills** are supported. With Pathfinder's *background skills* optional rule on, the budget splits and the two pools obey the rule's asymmetry: background ranks are spent first and only on background skills, then adventure ranks are spent anywhere. Background ranks with nowhere to land are lost, as the rule intends.
  - **Three weighted groups** — the hand-picked **skill list**, the actor's **class skills**, and all **other skills**, each with its own 0–10 weight. Every rank is dealt in two steps: the three weights pick the *group*, then the group picks the *skill* — by entry weight within the list, evenly at random for class and other skills. So a list entry's weight is relative only to its siblings and never competes directly with a class skill. A group weight of **0** means *last resort*: drawn only once every group weighted 1+ has run out of room, so class 10 / other 0 fills every class skill before anything else scores a point. Defaults are 5 / 5 / 1.
  - **A list row counts as one entry however many skills it covers.** Knowledge (any), a Craft entry with three specialities, and a bare Perception all at weight 5 give an equal chance of each. Once a row wins, it picks one of its own skills — by speciality weight for a Craft entry, evenly for a Knowledge alias.
  - **Rows settle on a speciality.** A Craft entry becomes *Craft (armorsmithing)* on the first rank it wins and keeps it for the rest of that token, so you get one competent crafter rather than three dabblers. The same applies to a Craft or Profession reached through the Class or Other groups, which draw only from specialities the actor already has. A settled row opens up another only if the character runs out of anywhere else to put ranks entirely.
  - **Knowledge (any)** and **Knowledge (class skills)** in both the add and exclude pickers, covering the whole family (or just the actor's class Knowledges) in one row. Unlike Craft they never settle, so later ranks can land on a different Knowledge — while focus still pins the exact skill it last hit. Excluding an alias excludes every skill it covers, and a separately listed Knowledge is claimed by its own row rather than counted twice.
  - **Focus**, one slider per group — the chance the next rank repeats the same skill. At 0 ranks spread thin across many skills; at 10 each skill fills to maximum before the draw moves on.
  - **Excluded skills** are never written to at all — no ranks by any route, and skipped by the clear-out, so they keep the ranks the statblock came with. If the only skills with room are excluded, the remaining points go unspent.
  - **Clear existing ranks first** (default **off**) — by default the rolled ranks are added on top of whatever the actor already has, so a hand-built statblock keeps its ranks; turn it on to zero every skill first and get the roll alone. Either way the max-ranks cap applies to the running total. If nothing in the configuration can receive a rank, the actor's skills are left untouched rather than cleared.
  - **Craft / Perform / Profession / Art / Lore** are handled through their specialities, since Pathfinder 1e keeps no ranks on those parent rows. Adding one requires naming at least one speciality; each is matched to an existing speciality on the actor by name, or created — only if it draws ranks.
  - **Subskill groups.** A new *Manage Subskill Groups* menu defines named sets of specialities under one skill (e.g. *Smithing* under Craft: Weaponsmithing / Armorsmithing / Blacksmithing). Used in the Skills tab, a group draws one member at random per token. A group's specialities are chosen through a **Select Items** picker modelled on the system's trait selectors — a checkbox list of that skill's known specialities plus a custom-entry field — and shown on the group as removable chips. The same menu holds per-skill **autocomplete lists** that feed those checkboxes and suggest speciality names as you type in the Skills tab, without restricting what you can type. They are edited like the system's damage vulnerabilities and immunities — type a name, press Enter, and it becomes a removable chip. Groups and autocomplete lists each collapse to hide their chips, and the window opens with everything collapsed and its member counts showing. Artistry, Craft, Perform and Profession ship pre-filled (Lore is left empty as campaign-specific); the shipped lists only fill a skill whose list is empty and never overwrite an edited one, and a **Restore defaults** button puts them back.
  - **Profiles.** Save the whole Skills tab as a named profile from either an actor's dialog or Configure Defaults, and load it onto any actor. Loading copies the settings rather than linking, so later profile edits never reach actors already configured. A new *Manage Skill Profiles* menu renames, reorders and deletes them.
- Skills are randomized after ability scores, so a randomized Intelligence feeds the rank budget.

- **Encounter Treasure** *(optional; off by default, enable in module settings and reload)*. A GM window that treats a whole encounter as the unit of loot, rather than rolling per creature.
  - **Encounter CR from summed XP.** Add tokens by drag, selection or combat; the window derives the encounter's CR the way the encounter-building rules do. Six CR 5 creatures are a CR 10 encounter worth one budget, not six. Slow / Medium / Fast pace, with overrides for the CR or the gp figure.
  - **Existing wealth counts against the budget**, as the SRD intends, with toggles for worn gear, coins and consumables — so a well-equipped NPC generates less loot rather than double-dipping.
  - **A rolled mix, not a budget split.** Each category has an independent chance of appearing, an item-value range and a category-value range; categories roll in shuffled order and claim a slice of the whole hoard. Whatever no category claims becomes coin, so items plus coin always equal the budget exactly.
  - **Hoard profiles** — *Dragon Hoard*, *Bandit Camp*, *Wizard's Study* and *Beast Lair* ship as presets, and any mix can be saved as a new one. Loading merges rather than replaces, and the bar marks a hoard *(modified)* once it drifts.
  - **Distribution** by drag, or Even / Random / By CR, with a pinned Unassigned tray. Two independent locks — one keeps an item through a re-generate, the other through *Return All* — and targets can be locked out of bulk distribution, or out of the coin split alone, entirely.
  - **Coin is derived**, never typed: it is whatever the budget has left. Denomination mix is set by count weights with a randomness slider, and a second slider spans even-to-random for the per-target split. Every split adds back up to the pool exactly, and an over-budget hoard is flagged rather than silently clamped.
  - **Apply and Undo.** Nothing reaches an actor until *Apply*; *Undo* removes exactly what it created. Apply pre-checks every target, so a deleted token repairs the encounter instead of half-writing it. Generated gear is equipped per a world setting, honouring PF1's slot limits — which the system itself does not enforce.
  - **Item Piles** *(optional, off by default)* — the *Loot Piles Control* setting adds a *Loot Piles from Selected* button to the token controls, converting the selected tokens into lootable piles. A pile token added to an encounter as a member receives loot like any other target.
  - **`@crLow` / `@crMed` / `@crHigh`** roll-data shorthands in the existing Treasure tab, giving the SRD treasure value for the actor's CR at each pace.

- **`pf1TokenRandomizerSkillBudget` hook**, so another module can correct how the rank budget splits between the adventure and background pools. PF1 has no background-specific Change target, so a module granting a free *background* rank must route it through `bonusSkillRanks` — which physically lands in the adventure pool. Such a module usually repaints its own sheet, but this one reads actor data, and would otherwise spend that rank on an adventure skill. Listeners mutate the budget in place; the result is clamped afterwards.

### Changed
- **Coin distribution weights are now coin *counts*, not shares of value.** An even split of 100 gp is now 9 pp / 9 gp / 9 sp / 10 cp — roughly equal piles — where it previously meant 25 gp of each (2 pp and 2,500 cp). The full value is also placed rather than floored away. A single-denomination setting is unaffected; any actor whose distribution uses more than one denomination will produce a different spread.
- **Ability score constraints are now set with a two-knob range slider** in place of the separate *Min* and *Max* number fields. Drag either knob, or type an exact score in the field at either end. The knobs cannot cross or meet, so a range with its minimum above its maximum — previously possible, since the two fields were clamped independently — can no longer be entered. A saved range that is already inverted is re-ordered when the tab is opened.
- The minimum end of an ability range now goes up to **24** rather than 18. The two fields had different ceilings (18 and 25); both ends now share the one 0–25 domain, one point apart.
- The randomizer tab bar is taller, so *Ability Scores* wrapping to two lines no longer shifts the row.
- The Name tab's **Name Components** box is now collapsible, matching the new collapsible boxes on the Skills tab. Its *Clear* button has moved from the header (now a collapse control) to the foot of the box.

### Fixed
- The *Ability Scores* tab label no longer breaks to two lines on some tabs but not others. A tall tab (Name) put a scrollbar on the settings window that a short one (Skills) did not, narrowing the tab bar by the scrollbar's width only on the tall tabs; the gutter is now reserved on every tab, and the tab labels are tighter so the longest one stays on one line at the usual window widths.
- **Using a placed token as an actor's prototype no longer kills the randomizer for that actor.** Foundry's *Assign as Prototype Token* copies the selected token's data over the prototype wholesale, module flags included — so if that token had already been randomized, its one-token-only "already randomized" mark became a permanent part of the actor, and every token placed from it afterwards was skipped. The mark is now stripped from the prototype the moment an assignment happens, and any actor already affected repairs itself the next time one of its tokens is placed (that token gets randomized normally).
- A world with no imported names or custom adjective lists no longer logs a `404 (Not Found)` for `pf1-token-randomizer-names.json` / `-adjectives.json` in the browser console. The miss was already handled — an absent file simply means "no user data" — but the browser reports every 404 regardless, so the world folder is now checked for the file before it is fetched.
- Unsupported actor types (vehicles, traps, haunts, basic actors) are no longer randomized. They have no *Randomizer* button, so they were silently falling back to the **world default** settings at token placement — writing ability scores and currency onto actors that have neither. Randomization is now limited to **character** and **NPC** actors at every entry point.

## [1.0.0] 2026-07-17

### Changed
- All user-facing text (settings menus, dialogs, notifications, the settings/list/stat-method windows, and header button) is now localizable via `game.i18n` (English `lang/en.json` included).

### Added
- **Modular name builder.** Token names are now assembled from an ordered list of components (in a framed, collapsible "Name Components" box) instead of a single filtered pick. Component types:
  - **Roster Name** — draws given names, surnames, or both from the name database, using one or more weighted Race/Region/Gender filters (each dimension optional).
  - **Adjective** — draws a random word from one or more weighted, module-provided adjective lists (**threatening**, **friendly**, **serious**, **goofy** ship by default).
  - **Actor Name** — inserts the base actor's current name, tracking any later rename (no settings).
  - **Static** — a fixed string.
- Components support reordering (▲▼), collapse-on-click headers, a Clear-all button, per-item weight sliders, and a live sample preview.
- **Duplicate-name avoidance.** A newly placed token re-rolls its name (up to 5 tries) to avoid matching other tokens of the same actor already on the scene; if it can't find a unique name, it keeps the duplicate and shows a warning. Skipped for names with no random components.
- **Name types.** Name database entries carry a `type` (`given`/`surname`); the importer accepts a `type` column/field.
- **Token Randomizer Lists** settings menu for managing the name database and adjective lists, including **name export to TSV** and adjective list add / replace / override / delete.
- **Custom stat methods.** A new *Manage Stat Methods* settings menu lets GMs define extra ability-score generation methods that appear in the method dropdown alongside the built-ins:
  - **Array** — six fixed values, like Standard/Elite/Champion (assigned via the actor's min/max and priority, order-independent).
  - **Formula** — a dice formula rolled once per ability (e.g. `4d6dl1`, `2d6+6`), using the game's standard formula syntax including drop/keep modifiers and `@`-references.
  - A saved method that is later deleted shows as *(unavailable)* on the actor and falls back to straight 10s until reselected.
- **Obscured NPC names.** A new *Enable Obscured NPC Names* setting lets a token show an alternate name to any user without at least **Observer** permission on it — currently substituted in **chat message headers** and the **combat tracker** (GMs and observers always see the real name).
  - A *Show Obscured Name on Hover* sub-setting (on by default) also reveals the obscured name on the canvas when a player mouses over or Alt-highlights an NPC whose display mode would otherwise show them no name — without overriding names the display mode already grants.
  - Each name component in the **Name** tab gains a **Visibility** control — *Both names*, *Real name only* (with an optional obscured substitute string), or *Obscured name only* — so the real and obscured names are built together at token placement. A second live "Players see:" preview shows the obscured result.
  - A per-token override (checkbox + obscured-name field) is added to the token configuration's **Identity** tab, covering linked/named tokens that never pass through the placement builder.
  - Note: this hides the name in the interface only; it is not a security boundary — a determined player can still read the real name via the browser console.

### Changed
- Name import moved out of *Configure Defaults* into the new *Manage Lists* menu.
- The bundled sample name database now uses split given/surname entries.

### Migration
- Existing per-actor and default name settings are migrated automatically: a config that selected a Race/Region/Gender becomes a single weighted Roster Name component (given names), while a config with no filter selected — the plain default — becomes a single Actor Name component. The old **Regional Variance** option is removed — the same effect is achievable by adding an *Any*-region filter with the desired weight.
- Existing name databases without a `type` column are read as given names (non-destructive; the file is rewritten with the column on the next import/export).

## [0.9.0] - 2026-06-28

### Added
- Initial release.
