import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fontShorthand,
  mergeRectsSeparatedByKerning,
  spaceAdvance,
} from "../src/kernedRects.mjs";

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
 * the publisher drops an empty `margin-left` span between the letters. A space
 * in that font advances 5.82px.
 */
const michael = [
  rect(401.26, 27.73),
  rect(430.99, 10.76),
  rect(444.74, 13.13),
  rect(461.88, 11.09),
  rect(474.97, 11.09),
  rect(488.06, 6.72),
];

describe("mergeRectsSeparatedByKerning", () => {
  it("joins the letter runs an empty kerning span splits apart", () => {
    const merged = mergeRectsSeparatedByKerning(michael, 5.82);

    assert.equal(merged.length, 1);
    assert.equal(round(merged[0].left), 401.26);
    assert.equal(round(merged[0].right), 494.78);
    assert.equal(merged[0].top, 100);
    assert.equal(merged[0].bottom, 132);
  });

  it("keeps rects a full space apart", () => {
    const words = [rect(10, 40), rect(55.9, 40)];

    assert.equal(mergeRectsSeparatedByKerning(words, 5.82).length, 2);
  });

  it("keeps rects on different lines apart", () => {
    const lines = [rect(10, 40, 100), rect(52, 40, 140)];

    assert.equal(mergeRectsSeparatedByKerning(lines, 5.82).length, 2);
  });

  it("merges each line of a multi-line range on its own", () => {
    const merged = mergeRectsSeparatedByKerning(
      [rect(10, 40, 100), rect(52, 40, 100), rect(10, 40, 140)],
      5.82
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0].right, 92);
    assert.equal(merged[1].right, 50);
  });

  it("swallows the zero-width rect an empty span contributes", () => {
    const merged = mergeRectsSeparatedByKerning(
      [rect(401.26, 27.73), rect(430.99, 0), rect(430.99, 10.76)],
      5.82
    );

    assert.equal(merged.length, 1);
    assert.equal(round(merged[0].right), 441.75);
  });

  it("leaves the rects alone without a usable measurement", () => {
    assert.equal(mergeRectsSeparatedByKerning(michael, 0).length, 6);
    assert.equal(mergeRectsSeparatedByKerning(michael, NaN).length, 6);
  });

  it("does not merge across an overlapping rect from another line", () => {
    const overlapping = [rect(10, 40, 100), rect(48, 40, 100, 60)];

    assert.equal(mergeRectsSeparatedByKerning(overlapping, 5.82).length, 2);
  });
});

describe("fontShorthand", () => {
  it("builds the shorthand browsers leave empty on a paragraph", () => {
    assert.equal(
      fontShorthand({
        fontStyle: "normal",
        fontWeight: "400",
        fontSize: "28px",
        fontFamily: "FournierMT_Regular",
      }),
      "normal 400 28px FournierMT_Regular"
    );
  });

  it("gives up without a family or a size", () => {
    assert.equal(fontShorthand({ fontSize: "28px" }), "");
    assert.equal(fontShorthand({ fontFamily: "serif" }), "");
  });
});

describe("spaceAdvance", () => {
  const style = {
    fontStyle: "normal",
    fontWeight: "400",
    fontSize: "28px",
    fontFamily: "FournierMT_Regular",
    letterSpacing: "normal",
    wordSpacing: "0px",
  };

  it("measures a space in the decorated font", () => {
    assert.equal(
      spaceAdvance(style, (font, text) => {
        assert.equal(font, "normal 400 28px FournierMT_Regular");
        assert.equal(text, " ");
        return 5.82;
      }),
      5.82
    );
  });

  it("adds the spacing the page puts between words and letters", () => {
    assert.equal(
      spaceAdvance(
        { ...style, wordSpacing: "4px", letterSpacing: "2px" },
        () => 5.82
      ),
      11.82
    );
  });

  it("returns 0 when the font cannot be measured", () => {
    assert.equal(
      spaceAdvance(style, () => 0),
      0
    );
    assert.equal(
      spaceAdvance({}, () => 5.82),
      0
    );
  });
});
