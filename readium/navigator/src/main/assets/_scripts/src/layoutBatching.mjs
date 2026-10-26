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

/**
 * Orders the changes made to one decoration group.
 *
 * Changes wait for the next frame, which makes sure the page is laid out first. A small change to a
 * laid out page, such as the next word to read, may instead run at once: laid out in the frame that
 * draws it, it held that frame past the following vsync. It still waits behind changes already
 * queued, or it could be undone by a clear queued before it.
 */
export class ChangeQueue {
  constructor(
    requestFrame = (frameCallback) => requestAnimationFrame(frameCallback),
    onError = () => {}
  ) {
    this.requestFrame = requestFrame;
    this.onError = onError;
    this.queued = [];
    this.inFrame = false;
  }

  run(changes, immediate) {
    if (immediate && this.queued.length === 0) {
      changes();
      return;
    }
    this.queued.push(changes);
    if (this.queued.length === 1) {
      this.requestFrame(() => this.flush());
    }
  }

  flush() {
    const batch = this.queued.splice(0);
    this.inFrame = true;
    try {
      batch.forEach((changes) => {
        try {
          changes();
        } catch (error) {
          this.onError(error);
        }
      });
    } finally {
      this.inFrame = false;
    }
  }
}

/**
 * Spreads a group's decorations over boxes the web view can lay out on their own.
 *
 * Decorations are absolutely positioned, and inserting one dirtied the box holding every other
 * decoration of the group, so the next layout read relaid them all: each word read aloud cost
 * more than the last, until a fast reader outran the web view. A box with size and layout
 * containment is a relayout boundary, so filling it relays out only the decorations it holds.
 *
 * Containment also makes the box a stacking context, so decorations are boxed by z-index: one
 * raised above the others still paints above them.
 */
export class DecorationBuckets {
  constructor(createBucket, capacity = 64) {
    this.createBucket = createBucket;
    this.capacity = capacity;
    this.open = new Map();
  }

  /** Places one decoration of [zIndex], returning its bucket; its element is where it goes. */
  bucketFor(zIndex) {
    let bucket = this.open.get(zIndex);
    if (!bucket || bucket.size >= this.capacity) {
      bucket = { element: this.createBucket(zIndex), zIndex, size: 0 };
      this.open.set(zIndex, bucket);
    }
    bucket.size++;
    return bucket;
  }

  /**
   * Gives back the room of a decoration taken out of [bucket]. The underline is replaced on every
   * word, so without this a bucket filled up with words long gone and left a trail of empty ones.
   */
  release(bucket) {
    bucket.size--;
    if (bucket.size <= 0 && this.open.get(bucket.zIndex) !== bucket) {
      bucket.element.remove();
    }
  }

  clear() {
    this.open.clear();
  }
}
