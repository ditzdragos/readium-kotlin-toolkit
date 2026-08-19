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
 * A range is contiguous, so two of its rects on one line are separated only by
 * something the range itself covers - an empty span a publisher uses to nudge
 * kerning, a margin, a space - unless the layout put foreign content between
 * them, as bidi reordering and absolutely positioned boxes can. `bridges`
 * decides which of the two it is; when it cannot tell it says no and the rects
 * are left as they are.
 */
export function mergeRectRuns(rects, bridges) {
  if (rects.length < 2) {
    return rects;
  }

  const ordered = rects
    .slice()
    .sort((rect1, rect2) => rect1.top - rect2.top || rect1.left - rect2.left);

  const merged = [];
  for (const rect of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && onSameLine(previous, rect) && bridges(previous, rect)) {
      merged[merged.length - 1] = union(previous, rect);
    } else {
      merged.push(rect);
    }
  }
  return merged;
}

/**
 * Asks the layout what sits in the gap between two rects: the caret position
 * under that point is inside the range exactly when the gap is the range's own.
 */
export function gapBridgesRange(range, doc) {
  if (!range || !doc || typeof doc.caretRangeFromPoint !== "function") {
    return () => false;
  }
  return (rect1, rect2) => {
    const x = (rect1.right + rect2.left) / 2;
    const y = rect1.top + rect1.height / 2;
    try {
      const caret = doc.caretRangeFromPoint(x, y);
      if (!caret) {
        return false;
      }
      return range.comparePoint(caret.startContainer, caret.startOffset) === 0;
    } catch (error) {
      return false;
    }
  };
}
