# Changelog

<!--
  Release process: before tagging v<x.y.z>, rename the "Unreleased" heading
  below to "## [<x.y.z>] - <YYYY-MM-DD>". The release workflow extracts the
  section whose heading matches the pushed tag and uses it as the GitHub
  release body. If no matching section exists, the release fails.
-->

## [Unreleased]

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

### Changed
- Name import moved out of *Configure Defaults* into the new *Manage Lists* menu.
- The bundled sample name database now uses split given/surname entries.

### Migration
- Existing per-actor and default name settings are migrated automatically: a config that selected a Race/Region/Gender becomes a single weighted Roster Name component (given names), while a config with no filter selected — the plain default — becomes a single Actor Name component. The old **Regional Variance** option is removed — the same effect is achievable by adding an *Any*-region filter with the desired weight.
- Existing name databases without a `type` column are read as given names (non-destructive; the file is rewritten with the column on the next import/export).

## [0.9.0] - 2026-06-28

### Added
- Initial release.
