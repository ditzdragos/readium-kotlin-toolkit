//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/**
 * Decides whether a decoration that holds nothing but digits is a folio page
 * number — something oral reading must step over — or a number that belongs to
 * the prose, such as the ordinal of a chapter title.
 *
 * Kept free of DOM globals and of the other script modules so it can be run
 * directly under Node by `test/pageNumber.test.mjs`; `.mjs` so Node treats it
 * as a module while webpack still runs it through Babel.
 */

const PAGE_NUMBER_REGEX = /^\d+$/;
const HEADING_TAG_REGEX = /^H[1-6]$/;
const EPUB_OPS_NAMESPACE = "http://www.idpf.org/2007/ops";
const ANCESTOR_LOOKUP_LIMIT = 6;
const DOM_ISOLATION_MAX_LENGTH = 5;

const TITLE_ROLES = new Set(["heading", "doc-subtitle"]);
const TITLE_EPUB_TYPES = new Set([
  "title",
  "subtitle",
  "halftitle",
  "fulltitle",
  "ordinal",
  "bridgehead",
  "label",
]);
const PAGE_BREAK_ROLES = new Set(["doc-pagebreak"]);
const PAGE_BREAK_EPUB_TYPES = new Set(["pagebreak", "page-break"]);

const OCR_OVERLAY_CLASS = "text-overlay";
const OCR_CONTAINER_CLASS = "ocr-container";

export function isPageNumberText(text) {
  return !!text && PAGE_NUMBER_REGEX.test(text.trim());
}

function epubTypes(element) {
  if (typeof element.getAttribute !== "function") return [];
  const value =
    element.getAttribute("epub:type") ||
    (typeof element.getAttributeNS === "function"
      ? element.getAttributeNS(EPUB_OPS_NAMESPACE, "type")
      : null) ||
    "";
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function role(element) {
  if (typeof element.getAttribute !== "function") return "";
  return (element.getAttribute("role") || "").trim().toLowerCase();
}

function matchesAncestor(element, predicate) {
  let current = element;
  let depth = 0;
  while (current && depth < ANCESTOR_LOOKUP_LIMIT) {
    if (predicate(current)) return true;
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

/**
 * A number the publication itself marks as a page break: `epub:type="pagebreak"`
 * or `role="doc-pagebreak"`. Trusted over every other signal, including a
 * surrounding heading.
 */
export function isExplicitPageBreak(element) {
  if (!element) return false;
  return matchesAncestor(
    element,
    (node) =>
      PAGE_BREAK_ROLES.has(role(node)) ||
      epubTypes(node).some((type) => PAGE_BREAK_EPUB_TYPES.has(type))
  );
}

/**
 * A number carried by a title — `<h1>Chapter 1</h1>`, an `epub:type="ordinal"`
 * span, anything under `role="heading"`. The child is meant to read it.
 */
export function isTitleNumber(element) {
  if (!element) return false;
  return matchesAncestor(
    element,
    (node) =>
      HEADING_TAG_REGEX.test(node.tagName || "") ||
      TITLE_ROLES.has(role(node)) ||
      epubTypes(node).some((type) => TITLE_EPUB_TYPES.has(type))
  );
}

function hasClass(element, name) {
  const value = element.className;
  if (typeof value !== "string") return false;
  return value.trim().split(/\s+/).includes(name);
}

/**
 * A number inside the invisible OCR text layer that scanned picture books lay
 * over the page image: a `.text-overlay` within an `.ocr-container`.
 *
 * Every word of such a page is its own absolutely positioned overlay, so the
 * isolation tests below are true of the whole page and carry no information —
 * they would reduce the decision to "a digit somewhere near the top or bottom",
 * which is where a chapter's numeral is printed. Those books keep their folio
 * in the page image rather than the text layer, so nothing is lost by reading
 * every digit the OCR did capture.
 */
export function isOcrOverlayNumber(element) {
  if (!element) return false;
  return (
    matchesAncestor(element, (node) => hasClass(node, OCR_OVERLAY_CLASS)) &&
    matchesAncestor(element, (node) => hasClass(node, OCR_CONTAINER_CLASS))
  );
}

function isDomIsolated(element, text) {
  if (!element || typeof element.textContent !== "string") return false;
  const elementText = element.textContent.trim();
  return (
    elementText === text.trim() ||
    elementText.length <= DOM_ISOLATION_MAX_LENGTH
  );
}

/**
 * Whether nothing on the number's own line reads as prose around it. `before`
 * and `after` are 200-character windows of extracted page text, so every test
 * that stands in for "nothing precedes it" has to be anchored to the end of
 * `before` — an unanchored one fires on a blank line 200 characters back and
 * swallows the number in "Chapter 1".
 */
export function isIsolatedPageNumber({ text, before, after, element }) {
  const beforeIsIsolated =
    before.length === 0 || before.endsWith("\n") || !/[a-zA-Z0-9]/.test(before);
  const afterIsIsolated =
    after.length === 0 || after.startsWith("\n") || !/[a-zA-Z0-9]/.test(after);

  const beforeEndsWithPunctuationAndWhitespace = /[.!?;:]\s*$/.test(before);
  const beforeEndsWithBlankLine = /\n\s*\n\s*$/.test(before);
  const beforeEndsWithSignificantWhitespace = /\s{2,}$/.test(before);

  const domIsolated = isDomIsolated(element, text);

  return (
    (beforeIsIsolated && afterIsIsolated) ||
    (domIsolated && afterIsIsolated) ||
    (beforeEndsWithPunctuationAndWhitespace &&
      domIsolated &&
      after.length === 0) ||
    (beforeEndsWithBlankLine &&
      (after.length === 0 || after.startsWith("\n"))) ||
    (beforeEndsWithSignificantWhitespace && domIsolated && after.length === 0)
  );
}

/**
 * @param text the decoration's highlighted text
 * @param before text preceding it on the page, `after` the text following it
 * @param element the element holding the number
 * @param isAtTopOrBottom whether it sits in the page's top or bottom band
 */
export function shouldSkipPageNumber({
  text,
  before = "",
  after = "",
  element = null,
  isAtTopOrBottom = false,
}) {
  if (!isPageNumberText(text)) return false;
  if (!isExplicitPageBreak(element)) {
    if (isTitleNumber(element)) return false;
    if (isOcrOverlayNumber(element)) return false;
  }
  if (!isAtTopOrBottom) return false;
  return isIsolatedPageNumber({ text, before, after, element });
}
