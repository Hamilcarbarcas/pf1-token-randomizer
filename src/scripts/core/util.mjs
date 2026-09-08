/* Generic helpers with no feature knowledge.
 *
 * Imports nothing and touches no Foundry global at import time, so the pure layers
 * that depend on it stay testable outside a world (DESIGN.md §16).
 */


/**
 * Pick one item from `items` with probability proportional to its weight (Model A:
 * the weight selects the bucket, not the individual entry). All-zero weights fall
 * back to a uniform pick so a fully-weighted-out segment is never silently dead.
 *
 * `rng` defaults to Math.random; the hoard generator (DESIGN.md §16) injects a seeded
 * one so its distribution can be asserted rather than eyeballed.
 */
function weightedPick(items, weightFn, rng = Math.random) {
  if (!items.length) return null;
  const weights = items.map(i => Math.max(0, Number(weightFn(i)) || 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Single-line text prompt via DialogV2. Resolves to the string, or null if cancelled. */
async function promptForText(title, label, initial = "") {
  const safe = foundry.utils.escapeHTML?.(initial) ?? initial;
  return foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>${label}</label><input type="text" name="entryValue" value="${safe}" autofocus /></div>`,
    ok: { label: game.i18n.localize("TR.OK"), callback: (event, button) => button.form.elements.entryValue.value },
    rejectClose: false
  });
}

export {
  promptForText,
  weightedPick,
};
