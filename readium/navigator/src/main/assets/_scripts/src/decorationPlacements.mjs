//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/**
 * Where each element of a `boxes` or `lines` decoration goes, as `{ rect, turnedBox }`.
 *
 * Only `wrap` takes its geometry from the box it decorates; the other widths span the viewport or
 * the bounding box, so they stay on one element per client rect. An OCR overlay's boxes win over
 * everything; a line on SVG lettering follows its glyphs. Both box sources and the client rects
 * are asked for lazily, so a range never pays for geometry it does not use.
 *
 * @param {{ width: string, layout: string }} style
 * @param {{
 *   overlayBoxes: import("./turnedBox.mjs").TurnedBox[],
 *   svgLineBoxes: () => import("./turnedBox.mjs").TurnedBox[],
 *   clientRects: () => DOMRect[],
 * }} sources
 */
export function decorationPlacements(
  style,
  { overlayBoxes, svgLineBoxes, clientRects }
) {
  if (style.width === "wrap") {
    const boxes =
      overlayBoxes.length > 0
        ? overlayBoxes
        : style.layout === "lines"
        ? svgLineBoxes()
        : [];
    if (boxes.length > 0) {
      return boxes.map((turnedBox) => ({ rect: turnedBox.rect, turnedBox }));
    }
  }
  return clientRects().map((rect) => ({ rect, turnedBox: overlayBoxes[0] }));
}
