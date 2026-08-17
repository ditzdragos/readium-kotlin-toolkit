//
//  Copyright 2024 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/**
 * How many viewports beyond the visible one still get their decoration
 * elements built. A page turn rebuilds every enhanced decoration from scratch,
 * so anything skipped here stays unpainted until the next rebuild.
 */
const PAGES_KEPT_LAID_OUT = 1;

/**
 * Whether the decoration this rect belongs to has already scrolled past the
 * top-left of the viewport.
 */
export function isOutsideViewport(rect) {
  return rect.left + rect.width < 0 || rect.top + rect.height < 0;
}

/**
 * Whether the decoration this rect belongs to is far enough behind the
 * viewport that building its element would be wasted work.
 *
 * Content ahead of the reader is never skipped: it is laid out into its own
 * page container, so it costs one element and is ready when it scrolls in.
 */
export function isTooFarToLayOut(
  rect,
  viewportWidth,
  viewportHeight,
  pages = PAGES_KEPT_LAID_OUT
) {
  const horizontalMargin = pages * Math.max(viewportWidth || 0, 0);
  const verticalMargin = pages * Math.max(viewportHeight || 0, 0);

  return (
    rect.left + rect.width < -horizontalMargin ||
    rect.top + rect.height < -verticalMargin
  );
}
