/* The ApplicationV2 handles every window class in apps/ builds on.
 *
 * Its own module because reading `foundry.applications.api` happens at import time:
 * anything that re-exported it would become un-importable outside a running world,
 * which would cost the pure layers (DESIGN.md §13, §14, §16) their offline testability.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export {
  ApplicationV2,
  HandlebarsApplicationMixin,
};
