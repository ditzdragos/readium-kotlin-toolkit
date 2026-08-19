import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gapBridgesRange, mergeRectRuns } from "../src/rangeRects.mjs";

function round(value) {
  return Math.round(value * 100) / 100;
}

function rect(left, width, top = 100, height = 32) {
  return {
    left,
    width,
    right: left + width,
    top,
    height,
    bottom: top + height,
  };
}

/**
 * The rects "Michael" produces on page 8 of Zen Ghosts (9780545629232), where
 * the publisher drops an empty `margin-left` span between the letters.
 */
const michael = [
  rect(401.26, 27.73),
  rect(430.99, 10.76),
  rect(444.74, 13.13),
  rect(461.88, 11.09),
  rect(474.97, 11.09),
  rect(488.06, 6.72),
];

const always = () => true;
const never = () => false;

describe("mergeRectRuns", () => {
  it("joins the letter runs an empty kerning span splits apart", () => {
    const merged = mergeRectRuns(michael, always);

    assert.equal(merged.length, 1);
    assert.equal(round(merged[0].left), 401.26);
    assert.equal(round(merged[0].right), 494.78);
    assert.equal(merged[0].top, 100);
    assert.equal(merged[0].bottom, 132);
  });

  it("keeps rects the range does not cover between apart", () => {
    assert.equal(mergeRectRuns(michael, never).length, 6);
  });

  it("never merges across lines, whatever the gap says", () => {
    const lines = [rect(10, 40, 100), rect(52, 40, 140)];

    assert.equal(mergeRectRuns(lines, always).length, 2);
  });

  it("merges each line of a multi-line range on its own", () => {
    const merged = mergeRectRuns(
      [rect(10, 40, 100), rect(52, 40, 100), rect(10, 40, 140)],
      always
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0].right, 92);
    assert.equal(merged[1].right, 50);
  });

  it("stops a run at the one gap that is not the range's", () => {
    const merged = mergeRectRuns(michael, (a) => round(a.right) !== 441.75);

    assert.equal(merged.length, 2);
    assert.equal(round(merged[0].right), 441.75);
    assert.equal(round(merged[1].left), 444.74);
  });

  it("asks about each pair in reading order", () => {
    const asked = [];
    mergeRectRuns([rect(10, 20), rect(40, 20), rect(70, 20)], (a, b) => {
      asked.push([a.right, b.left]);
      return true;
    });

    assert.deepEqual(asked, [
      [30, 40],
      [60, 70],
    ]);
  });

  it("passes a single rect straight through", () => {
    assert.equal(mergeRectRuns([michael[0]], never).length, 1);
    assert.equal(mergeRectRuns([], never).length, 0);
  });
});

describe("gapBridgesRange", () => {
  function documentHitting(caret, seen) {
    return {
      caretRangeFromPoint: (x, y) => {
        if (seen) {
          seen.push({ x, y });
        }
        return caret;
      },
    };
  }

  const caret = { startContainer: { name: "text" }, startOffset: 4 };

  it("probes the middle of the gap, at the height of the line", () => {
    const seen = [];
    const range = { comparePoint: () => 0 };

    gapBridgesRange(range, documentHitting(caret, seen))(
      rect(401.26, 27.73),
      rect(430.99, 10.76)
    );

    assert.deepEqual(seen, [{ x: (428.99 + 430.99) / 2, y: 116 }]);
  });

  it("bridges when the caret under the gap is inside the range", () => {
    const range = {
      comparePoint: (node, offset) => {
        assert.equal(node, caret.startContainer);
        assert.equal(offset, 4);
        return 0;
      },
    };

    assert.equal(
      gapBridgesRange(range, documentHitting(caret))(michael[0], michael[1]),
      true
    );
  });

  it("refuses when the caret lands outside the range", () => {
    const range = { comparePoint: () => -1 };

    assert.equal(
      gapBridgesRange(range, documentHitting(caret))(michael[0], michael[1]),
      false
    );
  });

  it("refuses when nothing can be hit, or the test throws", () => {
    assert.equal(
      gapBridgesRange({ comparePoint: () => 0 }, documentHitting(null))(
        michael[0],
        michael[1]
      ),
      false
    );

    const throwing = {
      comparePoint: () => {
        throw new Error("wrong document");
      },
    };
    assert.equal(
      gapBridgesRange(throwing, documentHitting(caret))(michael[0], michael[1]),
      false
    );
  });

  it("refuses when the engine cannot hit-test at all", () => {
    assert.equal(gapBridgesRange({}, {})(michael[0], michael[1]), false);
    assert.equal(gapBridgesRange(null, null)(michael[0], michael[1]), false);
  });
});
