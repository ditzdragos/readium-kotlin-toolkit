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

/**
 * A ceiling on what a gap can be and still belong to the text around it. It
 * only ever refuses a merge, and it is what keeps a range covering both
 * columns of a paginated page from painting over the gutter, where the caret
 * under the gap is genuinely inside the range.
 */
function gapFitsInsideTheLine(rect1, rect2) {
  return rect2.left - rect1.right <= Math.min(rect1.height, rect2.height);
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
 * Groups the rects into visual lines, each read left to right. Lines are cut
 * against the rect that opened the group rather than the previous one, so a
 * long line cannot drift a whole line away one tolerance at a time.
 */
function byLine(rects) {
  const lines = [];
  for (const rect of rects
    .slice()
    .sort((rect1, rect2) => rect1.top - rect2.top)) {
    const line = lines[lines.length - 1];
    if (line && onSameLine(line[0], rect)) {
      line.push(rect);
    } else {
      lines.push([rect]);
    }
  }
  return lines.map((line) =>
    line.sort((rect1, rect2) => rect1.left - rect2.left)
  );
}

/**
 * A range is contiguous, so two of its rects on one line are separated only by
 * something the range itself covers - an empty span a publisher uses to nudge
 * kerning, a margin, a space - unless the layout put foreign content between
 * them, as bidi reordering and absolutely positioned boxes can. `bridges`
 * decides which of the two it is; when it cannot tell it says no and the rects
 * are left as they are. It is asked about the two original rects, never about
 * the run built so far, so the point it probes is always a real gap.
 */
export function mergeRectRuns(rects, bridges) {
  if (rects.length < 2) {
    return rects;
  }

  const merged = [];
  for (const line of byLine(rects)) {
    let previous = null;
    for (const rect of line) {
      if (
        previous &&
        gapFitsInsideTheLine(previous, rect) &&
        bridges(previous, rect)
      ) {
        merged[merged.length - 1] = union(merged[merged.length - 1], rect);
      } else {
        merged.push(rect);
      }
      previous = rect;
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
