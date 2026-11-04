//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// A word this many times taller than the text beside it is display type: a giant alphabet-book
// letter, not a default `h1`, which is set at twice its body's size.
const DISPLAY_TYPE_SCALE = 2.5;

/**
 * The height of the text beside a word whose first line is [height] tall, when the word is display
 * type next to it, else null. [neighbourHeights] are asked in turn, and the first neighbour that is
 * not small enough ends the check, so an ordinary word pays for one. A missing neighbour (null,
 * zero) is skipped: a letter that opens its page has text on one side only.
 *
 * @param {number} height
 * @param {(() => number | null)[]} neighbourHeights
 * @returns {number | null}
 */
export function displayTypeBodyHeight(height, neighbourHeights) {
  let bodyHeight = 0;
  for (const measure of neighbourHeights) {
    const neighbourHeight = measure();
    if (!(neighbourHeight > 0)) continue;
    if (height < DISPLAY_TYPE_SCALE * neighbourHeight) return null;
    bodyHeight = Math.max(bodyHeight, neighbourHeight);
  }
  return bodyHeight > 0 ? bodyHeight : null;
}

/**
 * The index in [text] of the nearest non-space character after [offset] when [forward], else
 * before it, or -1 when there is none.
 *
 * @param {string} text
 * @param {number} offset
 * @param {boolean} forward
 */
export function neighbourCharacterIndex(text, offset, forward) {
  const step = forward ? 1 : -1;
  for (
    let i = forward ? offset : offset - 1;
    i >= 0 && i < text.length;
    i += step
  ) {
    if (/\S/.test(text[i])) return i;
  }
  return -1;
}

/**
 * [text] as CSS `text-transform` [transform] draws it, so its ink is measured on the glyphs shown:
 * a lowercase "e" set in capitals is an "E".
 *
 * @param {string} text
 * @param {string} transform
 */
export function renderedText(text, transform) {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(
        /(^|\s)(\S)/g,
        (_, space, letter) => space + letter.toUpperCase()
      );
    default:
      return text;
  }
}

/**
 * [rect] narrowed to the word's ink, with a body-text descent of room above and below it: the
 * descent of this font at [bodyHeight], the height of the text beside the word.
 *
 * A text rect spans the font's whole ascent and descent. At body size that is a few pixels of
 * slack; at display size it is a band as tall as a line of body text, so an underline at its
 * bottom floats far below the glyph and its top can sit off the page (RR-9367).
 *
 * [metrics] are the font's `fontBoundingBox*` and the text's `actualBoundingBox*` from
 * `CanvasRenderingContext2D.measureText`, in the computed font size; the rect may be scaled by a
 * transform, which their ratio to the rect height undoes. Returns null when the metrics do not
 * describe the rect.
 *
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {{ fontAscent: number, fontDescent: number, inkAscent: number, inkDescent: number }} metrics
 * @param {number} bodyHeight
 */
export function inkFittedRect(rect, metrics, bodyHeight) {
  const em = metrics.fontAscent + metrics.fontDescent;
  const scale = rect.height / em;
  if (!(scale > 0) || !Number.isFinite(scale)) return null;

  const baseline = rect.top + metrics.fontAscent * scale;
  const gap = (bodyHeight * metrics.fontDescent) / em;
  const top = Math.max(rect.top, baseline - metrics.inkAscent * scale - gap);
  const bottom = Math.min(
    rect.top + rect.height,
    baseline + Math.max(metrics.inkDescent, 0) * scale + gap
  );
  if (!(bottom > top)) return null;

  return {
    left: rect.left,
    right: rect.left + rect.width,
    width: rect.width,
    top,
    bottom,
    height: bottom - top,
  };
}
