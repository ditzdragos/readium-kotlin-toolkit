//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

/**
 * Holds back the insertions of a relayout until every decoration of it has been measured.
 *
 * Measuring a decoration reads layout, and inserting the previous one into the live document had
 * just invalidated it, so a relayout forced one full document layout per decoration: seconds for
 * the read highlights of a long chapter. Decorations are absolutely positioned and never move the
 * text they are measured against, so deferring the insertions leaves every position unchanged.
 */
export class DeferredAppends {
  constructor() {
    this.pending = null;
  }

  append(parent, child) {
    if (this.pending) {
      this.pending.push([parent, child]);
    } else {
      parent.append(child);
    }
  }

  /** Runs [build], applying the appends it makes in order once it returns or throws. */
  run(build) {
    if (this.pending) {
      build();
      return;
    }
    const pending = [];
    this.pending = pending;
    try {
      build();
    } finally {
      this.pending = null;
      pending.forEach(([parent, child]) => parent.append(child));
    }
  }
}

/** Wraps [callback] so any number of calls within one frame run it once, on the next frame. */
export function oncePerFrame(
  callback,
  requestFrame = (frameCallback) => requestAnimationFrame(frameCallback)
) {
  let scheduled = false;
  return function () {
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestFrame(() => {
      scheduled = false;
      callback();
    });
  };
}
