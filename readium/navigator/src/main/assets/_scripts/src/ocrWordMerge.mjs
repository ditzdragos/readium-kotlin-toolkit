//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/*
 * RR-8613: an OCR picture book anchors read-aloud on one invisible
 * `.text-overlay` per word, and some books ship a word cut across two of them —
 * `hats` as `ha` + `ts`, `children` as `chi` + `ldren`. Every consumer reads the
 * page as text: `document.body.textContent` puts the source's inter-element
 * whitespace between the two boxes, so the tokenizer sees two words, the
 * decoding graph is built to expect two, and the child is asked to say `ts`.
 *
 * Rejoining them in the DOM fixes all of that at once, because the extraction
 * and the navigator both resolve offsets against this same tree — the invariant
 * a text-only repair would break.
 *
 * The two halves of a cut word are adjacent in OCR order and their boxes carry
 * on where the other stopped, while two real words are held apart by a space.
 * The page states what one of its spaces is worth, so the threshold is read off
 * the page rather than guessed: gaps are measured against the box height that
 * carries them, and a pair joins only when its gap is a small fraction of the
 * page's typical one. A page whose every gap is narrow therefore cannot drag the
 * threshold down with it — the fallback is absolute.
 */

const OVERLAY_SELECTOR = ".text-overlay";
const CONTAINER_SELECTOR = ".ocr-container";

// A gap this much narrower than the page's typical one is not a space.
const JOIN_GAP_RATIO = 0.4;
// Used when the page offers no gap to learn from. A rendered space is never
// this narrow next to the height of the box holding it.
const FALLBACK_GAP_RATIO = 0.06;
// Two boxes are on one line when they share this much of the shorter one.
const LINE_OVERLAP_RATIO = 0.5;
// A cut word's halves are set at one angle; the OCR emits both from one box.
const ROTATION_TOLERANCE_DEGREES = 2;
// A word cut in two is cut between two of its own characters, so a mark sitting
// at the cut means the page already reads two words there and joining the boxes
// would only drag a decoration across both: a compound the OCR split at its own
// hyphen ("ODD-" + "SHAPED,", their boxes touching -- page 5 of 9781250406361)
// is not a word cut in two. Read at the cut only, so a word that keeps its own
// closing mark -- "ldren." -- is still a word that was cut.
const WORD_BOUNDARY = /[\s\p{P}\p{S}]/u;

function percent(value) {
  if (typeof value !== "string" || !value.includes("%")) {
    return null;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The box the overlay is authored in, in percentages of its container.
 *
 * Read from the inline style rather than from layout: it is the same source
 * `getOCRCorrectedRect` places decorations from, it needs no rendered page, and
 * an `.ocr-container` with only absolutely-positioned children lays out zero
 * pixels wide (RR-8790), which would make every gap here meaningless.
 */
function authoredBox(element) {
  const style = element.style;
  if (!style) {
    return null;
  }
  const left = percent(style.left);
  const top = percent(style.top);
  const width = percent(style.width);
  const height = percent(style.height);
  if (left === null || top === null || width === null || height === null) {
    return null;
  }
  if (!(width > 0) || !(height > 0)) {
    return null;
  }
  return { left, top, width, height };
}

function rotationDegrees(element) {
  const transform = element.style ? element.style.transform : "";
  if (!transform) {
    return 0;
  }
  const match = transform.match(/rotate\(([-\d.]+)deg\)/);
  if (!match) {
    return 0;
  }
  const angle = parseFloat(match[1]);
  return Number.isFinite(angle) ? angle : 0;
}

function sharesLine(first, second) {
  const overlap =
    Math.min(first.top + first.height, second.top + second.height) -
    Math.max(first.top, second.top);
  return overlap >= Math.min(first.height, second.height) * LINE_OVERLAP_RATIO;
}

function gapRatio(first, second) {
  const gap = second.left - (first.left + first.width);
  return gap / Math.max(first.height, second.height);
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function text(element) {
  return element.textContent ? element.textContent.trim() : "";
}

/**
 * Whether the pair could be one word cut in two, ignoring geometry.
 *
 * A word carries no space and no mark at the cut, and an overlay that already
 * holds several words was never cut out of one.
 */
function couldBeOneWord(first, second) {
  const before = text(first);
  const after = text(second);
  if (!before || !after) {
    return false;
  }
  if (/\s/.test(before) || /\s/.test(after)) {
    return false;
  }
  return (
    !WORD_BOUNDARY.test(before.slice(-1)) &&
    !WORD_BOUNDARY.test(after.charAt(0))
  );
}

function candidatePairs(overlays) {
  const pairs = [];
  for (let index = 0; index < overlays.length - 1; index += 1) {
    const first = overlays[index];
    const second = overlays[index + 1];
    if (!sharesLine(first.box, second.box)) {
      continue;
    }
    if (second.box.left < first.box.left) {
      continue;
    }
    pairs.push({ index, ratio: gapRatio(first.box, second.box) });
  }
  return pairs;
}

function joinRatioThreshold(pairs) {
  const typical = median(pairs.map((pair) => pair.ratio).filter((r) => r > 0));
  if (typical === null || typical <= 0) {
    return FALLBACK_GAP_RATIO;
  }
  return Math.min(typical * JOIN_GAP_RATIO, FALLBACK_GAP_RATIO);
}

function unionBox(first, second) {
  const left = Math.min(first.left, second.left);
  const top = Math.min(first.top, second.top);
  const right = Math.max(first.left + first.width, second.left + second.width);
  const bottom = Math.max(first.top + first.height, second.top + second.height);
  return { left, top, width: right - left, height: bottom - top };
}

function applyBox(element, box) {
  element.style.left = `${box.left}%`;
  element.style.top = `${box.top}%`;
  element.style.width = `${box.width}%`;
  element.style.height = `${box.height}%`;
}

/**
 * Rejoins words this page cut across two overlays, in place.
 *
 * The surviving overlay carries the whole word and the box the two halves
 * covered together, so the word reads as one to the tokenizer and a decoration
 * placed on it spans all of it.
 *
 * @param {Document | Element} root
 * @returns {number} how many overlays were absorbed into their predecessor
 */
export function mergeSplitOcrWords(root) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return 0;
  }

  let merged = 0;
  for (const container of root.querySelectorAll(CONTAINER_SELECTOR)) {
    merged += mergeContainer(container);
  }
  return merged;
}

function mergeContainer(container) {
  const overlays = [...container.querySelectorAll(OVERLAY_SELECTOR)]
    .map((element) => ({ element, box: authoredBox(element) }))
    .filter((overlay) => overlay.box !== null);

  if (overlays.length < 2) {
    return 0;
  }

  const threshold = joinRatioThreshold(candidatePairs(overlays));

  let merged = 0;
  let target = overlays[0];
  for (let index = 1; index < overlays.length; index += 1) {
    const next = overlays[index];
    if (isCutWord(target, next, threshold)) {
      absorb(target, next);
      merged += 1;
    } else {
      target = next;
    }
  }
  return merged;
}

function isCutWord(target, next, threshold) {
  if (!sharesLine(target.box, next.box)) {
    return false;
  }
  if (next.box.left < target.box.left) {
    return false;
  }
  if (gapRatio(target.box, next.box) >= threshold) {
    return false;
  }
  if (
    Math.abs(rotationDegrees(target.element) - rotationDegrees(next.element)) >
    ROTATION_TOLERANCE_DEGREES
  ) {
    return false;
  }
  return couldBeOneWord(target.element, next.element);
}

function absorb(target, next) {
  target.element.textContent = text(target.element) + text(next.element);
  target.box = unionBox(target.box, next.box);
  applyBox(target.element, target.box);
  next.element.remove();
}

function documentParsed() {
  if (document.readyState !== "loading") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
}

/**
 * Rejoins this page's cut words as soon as its overlays exist.
 *
 * Must settle before anything measures an overlay or reads the page as text:
 * a merge moves boxes, and the extraction's offsets have to address the tree
 * the navigator will resolve them against.
 */
export function rejoinSplitOcrWords() {
  return documentParsed().then(() => mergeSplitOcrWords(document));
}
