//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

function safeRatio(a, b) {
  if (a === 0 && b === 0) {
    return 1;
  }
  if (a === 0 || b === 0) {
    return 0;
  }
  return a < b ? a / b : b / a;
}

function inlineStyleValue(span, property) {
  const style = span.style;
  if (!style) {
    return "";
  }
  return style[property] || "";
}

function isPlaced(element) {
  return (
    inlineStyleValue(element, "left") !== "" ||
    inlineStyleValue(element, "bottom") !== ""
  );
}

function isSpan(element) {
  return (element.tagName || "").toLowerCase() === "span";
}

function isInsidePlacedRun(span) {
  for (let el = span.parentElement; el && isSpan(el); el = el.parentElement) {
    if (isPlaced(el)) {
      return true;
    }
  }
  return false;
}

/**
 * Only a span the page places at its own coordinate can start a new text
 * segment. An unplaced span sits at no coordinate, so both `left` and `bottom`
 * read as 0, every ratio degenerates and the gap rule below fires on all of
 * them - dropping a space inside whatever word the publisher wrapped:
 * - an empty span that only nudges kerning through a margin;
 * - a span nested in a placed run, which flows inline with the text around it
 *   (`ke<span style="margin-left:5.3px">ep</span>`), so the run's own text
 *   already holds every space the page renders.
 */
export function isSpacingCandidate(span) {
  if (isPlaced(span)) {
    return true;
  }
  return (span.textContent || "") !== "" && !isInsidePlacedRun(span);
}

function needsSpacing(previousSpan, currentSpan) {
  const currentBottom = parseFloat(
    inlineStyleValue(currentSpan, "bottom") || "0"
  );
  const previousBottom = parseFloat(
    inlineStyleValue(previousSpan, "bottom") || "0"
  );
  const currentLeft = parseFloat(inlineStyleValue(currentSpan, "left") || "0");
  const previousLeft = parseFloat(
    inlineStyleValue(previousSpan, "left") || "0"
  );

  const bottomDifference = safeRatio(previousBottom, currentBottom);
  const leftDifference = safeRatio(previousLeft, currentLeft);

  return (
    bottomDifference < 0.87 || leftDifference > 0.99 || leftDifference < 0.1
  );
}

/**
 * Returns the spans that start a new text segment and therefore need a
 * space in front of them, so that extracting the page as text does not stitch
 * two segments into one word.
 */
export function spansNeedingSpacing(spans) {
  const spansByParent = new Map();
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (!isSpacingCandidate(span)) {
      continue;
    }
    const parentKey = span.parentElement || span;
    if (!spansByParent.has(parentKey)) {
      spansByParent.set(parentKey, []);
    }
    spansByParent.get(parentKey).push(span);
  }

  const needing = [];
  for (const siblingSpans of spansByParent.values()) {
    for (let i = 1; i < siblingSpans.length; i++) {
      if (needsSpacing(siblingSpans[i - 1], siblingSpans[i])) {
        needing.push(siblingSpans[i]);
      }
    }
  }
  return needing;
}

export function processSpansForTextSpacing(document) {
  const spans = document.querySelectorAll("span");
  if (spans.length === 0) {
    return;
  }

  const needing = spansNeedingSpacing(spans);
  for (let i = 0; i < needing.length; i++) {
    const span = needing[i];
    if (span.parentElement) {
      span.parentElement.insertBefore(document.createTextNode(" "), span);
    }
  }
}
