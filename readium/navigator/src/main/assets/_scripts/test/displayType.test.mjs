import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  displayTypeBodyHeight,
  inkFittedRect,
  neighbourCharacterIndex,
  renderedText,
} from "../src/displayType.mjs";

// Measured on "E is for Elephant" (9780744043068), page002.xhtml: a 2000px "e" scaled 5.76 times
// beside " is for elephant" scaled 1.376 times, both in the book's f0 face.
const F0 = { fontAscent: 1540, fontDescent: 460 };
const LETTER_E = {
  rect: { left: 109.6, top: -84.9, width: 335, height: 699.6 },
  metrics: { ...F0, inkAscent: 937.5, inkDescent: 31.25 },
};
const LETTER_E_SCALE = 699.6 / 2000;
const LETTER_E_BASELINE = LETTER_E.rect.top + F0.fontAscent * LETTER_E_SCALE;
const LETTER_E_INK_TOP = LETTER_E_BASELINE - 937.5 * LETTER_E_SCALE;
const LETTER_E_INK_BOTTOM = LETTER_E_BASELINE + 31.25 * LETTER_E_SCALE;
const LETTER_E_FONT_BOTTOM = LETTER_E.rect.top + LETTER_E.rect.height;
const IS_FOR_HEIGHT = 167.1;

function heights(...values) {
  return values.map((value) => () => value);
}

describe("displayTypeBodyHeight", () => {
  it("takes a letter four times the height of the text beside it as display type", () => {
    assert.equal(
      displayTypeBodyHeight(699.6, heights(null, IS_FOR_HEIGHT)),
      IS_FOR_HEIGHT
    );
  });

  it("measures the room around display type against its tallest neighbour", () => {
    assert.equal(
      displayTypeBodyHeight(699.6, heights(62.1, IS_FOR_HEIGHT)),
      IS_FOR_HEIGHT
    );
  });

  it("does not take a word as display type when one neighbour is as tall", () => {
    assert.equal(
      displayTypeBodyHeight(699.6, heights(IS_FOR_HEIGHT, 699.6)),
      null
    );
  });

  it("does not take a default h1, twice its body's size, as display type", () => {
    assert.equal(displayTypeBodyHeight(45, heights(22)), null);
  });

  it("does not take a word with no measured neighbour as display type", () => {
    assert.equal(displayTypeBodyHeight(699.6, heights(null, 0)), null);
  });

  it("stops asking for neighbours once one rules display type out", () => {
    const asked = [];
    const neighbours = [
      () => {
        asked.push("before");
        return 167.1;
      },
      () => {
        asked.push("after");
        return 20;
      },
    ];

    assert.equal(displayTypeBodyHeight(167.1, neighbours), null);
    assert.deepEqual(asked, ["before"]);
  });
});

describe("neighbourCharacterIndex", () => {
  it("finds the next character past the spaces after a word", () => {
    assert.equal(neighbourCharacterIndex("is  for", 2, true), 4);
  });

  it("finds the last character before the spaces ahead of a word", () => {
    assert.equal(neighbourCharacterIndex("is  for", 4, false), 1);
  });

  it("finds no neighbour inside a node that holds only the word", () => {
    assert.equal(neighbourCharacterIndex("e ", 1, true), -1);
    assert.equal(neighbourCharacterIndex(" e", 1, false), -1);
  });
});

describe("renderedText", () => {
  it("measures a letter set in capitals as the capital it shows", () => {
    assert.equal(renderedText("e", "uppercase"), "E");
  });

  it("capitalizes the first letter of each word", () => {
    assert.equal(
      renderedText("is for elephant", "capitalize"),
      "Is For Elephant"
    );
  });

  it("leaves text without a transform as it is", () => {
    assert.equal(renderedText("Elephant", "none"), "Elephant");
  });
});

describe("inkFittedRect", () => {
  const fitted = inkFittedRect(LETTER_E.rect, LETTER_E.metrics, IS_FOR_HEIGHT);

  it("puts the bottom of a display letter just under its glyph, not at its font's descent", () => {
    assert.ok(fitted.bottom > LETTER_E_INK_BOTTOM);
    assert.ok(fitted.bottom < LETTER_E_INK_BOTTOM + IS_FOR_HEIGHT / 2);
    assert.ok(fitted.bottom < LETTER_E_FONT_BOTTOM - 100);
  });

  it("keeps the top of a display letter on the page above its glyph", () => {
    assert.ok(fitted.top > 0);
    assert.ok(fitted.top < LETTER_E_INK_TOP);
  });

  it("keeps the rect's horizontal extent", () => {
    assert.equal(fitted.left, 109.6);
    assert.equal(fitted.width, 335);
    assert.equal(fitted.right, 444.6);
    assert.ok(Math.abs(fitted.height - (fitted.bottom - fitted.top)) < 1e-9);
  });

  it("never grows the rect past the font's own ascent and descent", () => {
    const deepInk = { ...F0, inkAscent: 1900, inkDescent: 900 };

    const grown = inkFittedRect(LETTER_E.rect, deepInk, IS_FOR_HEIGHT);

    assert.equal(grown.top, LETTER_E.rect.top);
    assert.ok(Math.abs(grown.bottom - LETTER_E_FONT_BOTTOM) < 1e-9);
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
