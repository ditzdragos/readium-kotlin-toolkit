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

/**
 * Publishers emit empty spans that only nudge kerning through a margin. They
 * sit at no coordinate, so both `left` and `bottom` read as 0, every ratio
 * degenerates and the gap rule below fires on all of them - dropping a space
 * inside whatever word the publisher wrapped. Such a span also separates
 * nothing: the text either side of it is already adjacent, so the page has
 * written one word there.
 */
export function isSpacingCandidate(span) {
  const placed =
    inlineStyleValue(span, "left") !== "" ||
    inlineStyleValue(span, "bottom") !== "";
  return placed || (span.textContent || "") !== "";
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
