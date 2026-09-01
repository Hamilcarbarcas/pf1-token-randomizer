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

- **`pf1TokenRandomizerSkillBudget` hook**, so another module can correct how the rank budget splits between the adventure and background pools. PF1 has no background-specific Change target, so a module granting a free *background* rank must route it through `bonusSkillRanks` — which physically lands in the adventure pool. Such a module usually repaints its own sheet, but this one reads actor data, and would otherwise spend that rank on an adventure skill. Listeners mutate the budget in place; the result is clamped afterwards.

### Changed
- The randomizer tab bar is taller, so *Ability Scores* wrapping to two lines no longer shifts the row.
- The Name tab's **Name Components** box is now collapsible, matching the new collapsible boxes on the Skills tab. Its *Clear* button has moved from the header (now a collapse control) to the foot of the box.

### Fixed
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
