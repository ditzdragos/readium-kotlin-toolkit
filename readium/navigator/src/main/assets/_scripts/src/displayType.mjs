//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// A word at least this many times taller than the text on both sides of it is display type: a
// giant alphabet-book letter, a heading over a caption.
const DISPLAY_TYPE_SCALE = 2;

/**
 * Whether a word whose line box is [height] tall is display type next to text whose line boxes
 * are [neighbourHeights] tall. A word with no measured neighbour has nothing to be large against.
 *
 * @param {number} height
 * @param {(number | undefined)[]} neighbourHeights
 */
export function isDisplayType(height, neighbourHeights) {
  const known = neighbourHeights.filter((h) => h > 0);
  return (
    known.length > 0 && known.every((h) => height >= DISPLAY_TYPE_SCALE * h)
  );
}

/**
 * [rect] narrowed to the word's ink, with as much room above and below it as text [bodyHeight]
 * tall has below its baseline.
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
