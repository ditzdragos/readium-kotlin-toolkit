//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

const SAME_LINE_TOLERANCE = 1;

function onSameLine(rect1, rect2) {
  return (
    Math.abs(rect1.top - rect2.top) <= SAME_LINE_TOLERANCE &&
    Math.abs(rect1.bottom - rect2.bottom) <= SAME_LINE_TOLERANCE
  );
}

function union(rect1, rect2) {
  const left = Math.min(rect1.left, rect2.left);
  const right = Math.max(rect1.right, rect2.right);
  const top = Math.min(rect1.top, rect2.top);
  const bottom = Math.max(rect1.bottom, rect2.bottom);
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

/**
 * Running text never yields a gap between client rects: a space sits inside the
 * text run, so a whole phrase measures as one rect. A gap therefore marks an
 * element boundary, and when it is narrower than a space it cannot be a word
 * boundary either - it is a publisher nudging kerning with an empty span, which
 * would otherwise draw one decoration per letter.
 */
export function mergeRectsSeparatedByKerning(rects, maxGap) {
  if (!(maxGap > 0) || rects.length < 2) {
    return rects;
  }

  const ordered = rects
    .slice()
    .sort((rect1, rect2) => rect1.top - rect2.top || rect1.left - rect2.left);

  const merged = [];
  for (const rect of ordered) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      onSameLine(previous, rect) &&
      rect.left - previous.right < maxGap
    ) {
      merged[merged.length - 1] = union(previous, rect);
    } else {
      merged.push(rect);
    }
  }
  return merged;
}

export function fontShorthand(style) {
  const family = style.fontFamily || "";
  const size = style.fontSize || "";
  if (family === "" || size === "") {
    return "";
  }
  const weight = style.fontWeight || "normal";
  const slant = style.fontStyle || "normal";
  return `${slant} ${weight} ${size} ${family}`;
}

function lengthInPixels(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function spaceAdvance(style, measureText) {
  const font = fontShorthand(style);
  if (font === "") {
    return 0;
  }
  const width = measureText(font, " ");
  if (!(width > 0)) {
    return 0;
  }
  return (
    width +
    lengthInPixels(style.wordSpacing) +
    lengthInPixels(style.letterSpacing)
  );
}

let measuringContext;

function canvasMeasureText(font, text) {
  if (measuringContext === undefined) {
    measuringContext =
      typeof document !== "undefined" && document.createElement
        ? document.createElement("canvas").getContext("2d")
        : null;
  }
  if (!measuringContext) {
    return 0;
  }
  measuringContext.font = font;
  return measuringContext.measureText(text).width;
}

/**
 * The widest gap that still sits inside one word, for the font the range is
 * drawn in. 0 when it cannot be measured, which leaves the rects untouched.
 */
export function kerningGapLimit(range) {
  const node = range && range.startContainer;
  if (!node) {
    return 0;
  }
  const element =
    node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element || typeof getComputedStyle !== "function") {
    return 0;
  }
  return spaceAdvance(getComputedStyle(element), canvasMeasureText);
}
