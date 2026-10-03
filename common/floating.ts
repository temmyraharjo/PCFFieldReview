/**
 * Helpers for flyouts appended to document.body (the review panel, the
 * multi-select suggestion list), so the form's fixed-size field cell can't
 * clip them.
 *
 * Two things on a model-driven form can push such a flyout away from where
 * it's meant to be (e.g. to the bottom of the page):
 * - a host stylesheet overriding `position`, which the `!important` inline
 *   styles below win against;
 * - an ancestor with a transform, filter or `contain`, which makes a
 *   position: fixed element position against that ancestor instead of the
 *   viewport. placeFixed measures where the element actually landed and
 *   corrects for the offset.
 */

/** Makes `el` a viewport-positioned flyout above the form. Call once, after appending it to the document. */
export function makeFloating(el: HTMLElement): void {
    el.style.setProperty("position", "fixed", "important");
    el.style.setProperty("z-index", "10000", "important");
    el.style.setProperty("margin", "0", "important");
    el.style.setProperty("right", "auto", "important");
    el.style.setProperty("bottom", "auto", "important");
}

/** Places `el` so its top-left corner is at viewport coordinates (left, top). */
export function placeFixed(el: HTMLElement, left: number, top: number): void {
    el.style.setProperty("left", `${left}px`, "important");
    el.style.setProperty("top", `${top}px`, "important");
    const actual = el.getBoundingClientRect();
    const dx = left - actual.left;
    const dy = top - actual.top;
    if (Math.abs(dx) > 0.5) el.style.setProperty("left", `${left + dx}px`, "important");
    if (Math.abs(dy) > 0.5) el.style.setProperty("top", `${top + dy}px`, "important");
}
