import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inkFittedRect, isDisplayType } from "../src/displayType.mjs";

// Measured on "E is for Elephant" (9780744043068), page002.xhtml: a 2000px "e" scaled 5.76 times
// beside " is for elephant" scaled 1.376 times, both in the book's f0 face.
const F0 = { fontAscent: 1540, fontDescent: 460 };
const LETTER_E = {
  rect: { left: 109.6, top: -84.9, width: 335, height: 699.6 },
  metrics: { ...F0, inkAscent: 937.5, inkDescent: 31.25 },
};
const IS_FOR_HEIGHT = 167.1;

describe("isDisplayType", () => {
  it("takes a letter four times the height of the text beside it as display type", () => {
    assert.equal(isDisplayType(699.6, [undefined, IS_FOR_HEIGHT]), true);
  });

  it("does not take a word as display type when one neighbour is as tall", () => {
    assert.equal(isDisplayType(167.1, [167.1, 62.1]), false);
  });

  it("does not take a word set at the size of its neighbours as display type", () => {
    assert.equal(isDisplayType(167.1, [167.1, 167.1]), false);
  });

  it("does not take a word with no measured neighbour as display type", () => {
    assert.equal(isDisplayType(699.6, [undefined, 0]), false);
  });
});

describe("inkFittedRect", () => {
  it("puts the bottom of a display letter just under its glyph, not at its font's descent", () => {
    const fitted = inkFittedRect(
      LETTER_E.rect,
      LETTER_E.metrics,
      IS_FOR_HEIGHT
    );

    const scale = 699.6 / 2000;
    const baseline = -84.9 + 1540 * scale;
    const inkBottom = baseline + 31.25 * scale;
    const bodyDescent = (IS_FOR_HEIGHT * 460) / 2000;
    assert.ok(Math.abs(fitted.bottom - (inkBottom + bodyDescent)) < 0.01);
    assert.ok(fitted.bottom < 614.7 - 100);
  });

  it("keeps the top of a display letter on the page above its glyph", () => {
    const fitted = inkFittedRect(
      LETTER_E.rect,
      LETTER_E.metrics,
      IS_FOR_HEIGHT
    );

    assert.ok(fitted.top > 0);
    const inkTop = -84.9 + (1540 - 937.5) * (699.6 / 2000);
    assert.ok(fitted.top < inkTop);
  });

  it("keeps the rect's horizontal extent", () => {
    const fitted = inkFittedRect(
      LETTER_E.rect,
      LETTER_E.metrics,
      IS_FOR_HEIGHT
    );

    assert.equal(fitted.left, 109.6);
    assert.equal(fitted.width, 335);
    assert.equal(fitted.right, 444.6);
    assert.ok(Math.abs(fitted.height - (fitted.bottom - fitted.top)) < 1e-9);
  });

  it("never grows the rect past the font's own ascent and descent", () => {
    const deepInk = { ...F0, inkAscent: 1900, inkDescent: 900 };

    const fitted = inkFittedRect(LETTER_E.rect, deepInk, IS_FOR_HEIGHT);

    assert.equal(fitted.top, -84.9);
    assert.ok(Math.abs(fitted.bottom - 614.7) < 1e-9);
  });

  it("gives up on metrics that do not describe the rect", () => {
    assert.equal(
      inkFittedRect(
        LETTER_E.rect,
        { fontAscent: 0, fontDescent: 0, inkAscent: 0, inkDescent: 0 },
        167
      ),
      null
    );
  });
});
