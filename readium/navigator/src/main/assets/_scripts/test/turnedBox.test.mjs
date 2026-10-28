import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { turnedBoxAround } from "../src/turnedBox.mjs";
import {
  ASCENT,
  DESCENT,
  SVG_SCALE,
  TUMBLE,
  assertReachesEveryCorner,
  curvedWord,
  degrees,
  placedGlyph,
} from "./support/lettering.mjs";

describe("turnedBoxAround", () => {
  it("turns a word set along a curve by the mean of its glyphs' turns", () => {
    const glyphs = curvedWord(TUMBLE);

    const box = turnedBoxAround(glyphs);

    const meanTurn =
      TUMBLE.reduce((sum, matrix) => sum + degrees(matrix), 0) / TUMBLE.length;
    assert.ok(Math.abs(box.rotationAngle - meanTurn) < 0.5);
    assertReachesEveryCorner(assert, box, glyphs);
  });

  it("turns a single glyph's box by the glyph's own angle", () => {
    const glyph = placedGlyph(TUMBLE[2], 20);

    const box = turnedBoxAround([glyph]);

    assert.ok(Math.abs(box.rotationAngle - degrees(TUMBLE[2])) < 0.01);
    assert.ok(Math.abs(box.rect.width - SVG_SCALE * 20) < 0.01);
    assert.ok(
      Math.abs(box.rect.height - SVG_SCALE * (ASCENT + DESCENT)) < 0.01
    );
  });

  it("leaves a level word upright", () => {
    const glyphs = [0, 15, 30].map((x) => placedGlyph([1, 0, 0, 1, x, 30], 15));

    const box = turnedBoxAround(glyphs);

    assert.equal(box.rotationAngle, 0);
    assert.deepEqual(
      [box.rect.left, box.rect.top, box.rect.right, box.rect.bottom].map(
        Math.round
      ),
      [0, 6, 90, 74]
    );
  });

  it("leaves upright glyphs of different sizes level", () => {
    const capital = placedGlyph([1, 0, 0, 1, 0, 60], 30, 60);
    const smallLetters = [30, 40].map((x) =>
      placedGlyph([1, 0, 0, 1, x, 60], 10, 14)
    );

    const box = turnedBoxAround([capital, ...smallLetters]);

    assert.equal(box.rotationAngle, 0);
    assert.equal(box.rect.bottom, SVG_SCALE * (60 + DESCENT));
  });

  it("leaves a raised glyph's word level", () => {
    const base = placedGlyph([1, 0, 0, 1, 0, 60], 20, 20);
    const raised = placedGlyph([1, 0, 0, 1, 20, 45], 12, 12);

    assert.equal(turnedBoxAround([base, raised]).rotationAngle, 0);
  });
});
