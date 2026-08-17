//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

const Z_INDEX = 999;

export function visibleAreaId(pageIndex) {
  return `visible-area-${pageIndex}`;
}

/**
 * The page-sized elements enhanced decorations are drawn into, one per page index.
 *
 * Every decoration group draws into the same element for a given page, so a group only ever
 * holds a claim on one, never ownership: removing it outright takes the other groups'
 * decorations off the page with it and leaves them holding a detached element they go on
 * appending to, which is why a word underlined after a highlight relayout never appeared
 * again until a resize rebuilt every group.
 *
 * A claim is dropped with [release], which removes only the areas left empty by the group
 * that is letting go. An area another group removed first is detected on the next [acquire]
 * rather than trusted from the cache.
 */
export class VisibleAreas {
  constructor(document) {
    this.document = document;
    this.claimed = new Map();
  }

  acquire(pageIndex, viewportWidth, viewportHeight) {
    const id = visibleAreaId(pageIndex);

    let area = this.claimed.get(id);
    if (area && !area.isConnected) {
      this.claimed.delete(id);
      area = null;
    }

    if (!area) {
      area = this.document.getElementById(id);
      if (!area) {
        area = this.document.createElement("div");
        area.className = "visible-area";
        area.id = id;
        this.document.body.appendChild(area);
      }
      this.claimed.set(id, area);
    }

    // Reasserted on every layout because the areas outlive the viewport they were sized for.
    area.style.cssText =
      `position:absolute;left:${pageIndex * viewportWidth}px;top:0px;margin-top:0px;` +
      `width:${viewportWidth}px;height:${viewportHeight}px;` +
      `pointer-events:none;z-index:${Z_INDEX}`;

    return area;
  }

  release() {
    this.claimed.forEach((area) => {
      if (area.childElementCount === 0) {
        area.remove();
      }
    });
    this.claimed.clear();
  }
}
