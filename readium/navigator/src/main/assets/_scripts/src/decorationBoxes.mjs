// RR-6457: a book's own `div { margin }` rule also matches the decoration DOM and moves it off the word.

/** Beats a book's bare `div` rule (same specificity, later) but loses to any template class. */
export const TEMPLATE_MARGIN_RESET =
  "div:where([data-group] *, .visible-area *) { margin: 0; }";

export function decorationBox(document) {
  const box = document.createElement("div");
  box.style.margin = "0px";
  return box;
}
