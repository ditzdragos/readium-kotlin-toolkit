// RR-6457: a book's own `div { margin }` rule also matches the decoration DOM and moves it off the word.

/** Beats a book's `div`, `body div` or `html div` rule but loses to any template class. */
export const TEMPLATE_MARGIN_RESET =
  "html body div:where(body > [data-group] *, body > .visible-area *) { margin: 0; }";

export function decorationBox(document) {
  const box = document.createElement("div");
  box.style.margin = "0px";
  return box;
}
