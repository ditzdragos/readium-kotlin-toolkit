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
 * everything; a word in display type is one element on its ink (RR-9367); a box or line on
 * lettering follows its glyphs, one turned box per line. The lettering boxes and the client rects
 * are asked for lazily, so a range never pays for geometry it does not use.
 *
 * @param {{ width: string, layout: string }} style
 * @param {{
 *   overlayBoxes: import("./turnedBox.mjs").TurnedBox[],
 *   displayRect: DOMRect | null,
 *   letteringLineBoxes: () => import("./turnedBox.mjs").TurnedBox[],
 *   clientRects: () => DOMRect[],
 * }} sources
 */
export function decorationPlacements(
  style,
  { overlayBoxes, displayRect, letteringLineBoxes, clientRects }
) {
  if (style.width === "wrap" && overlayBoxes.length > 0) {
    return overlayBoxes.map((turnedBox) => ({
      rect: turnedBox.rect,
      turnedBox,
    }));
  }
  if (displayRect) {
    return [{ rect: displayRect, turnedBox: overlayBoxes[0] }];
  }
  if (style.width === "wrap") {
    const boxes = letteringLineBoxes();
    if (boxes.length > 0) {
      return boxes.map((turnedBox) => ({ rect: turnedBox.rect, turnedBox }));
    }
  }
  return clientRects().map((rect) => ({ rect, turnedBox: overlayBoxes[0] }));
}
