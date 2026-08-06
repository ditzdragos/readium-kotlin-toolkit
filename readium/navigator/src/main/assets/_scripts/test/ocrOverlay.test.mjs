import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getClosestRotationDegrees,
  ocrOverlayGeometry,
  rotationDegreesFromTransform,
  textRunsAlongBoxHeight,
} from "../src/ocrOverlay.mjs";

globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

globalThis.DOMMatrixReadOnly = class {
  constructor(transform) {
    const values = transform.match(/matrix\(([^)]+)\)/);
    if (!values) {
      throw new Error(`unsupported transform: ${transform}`);
    }
    const [a, b] = values[1].split(",").map((v) => parseFloat(v));
    this.a = a;
    this.b = b;
  }
};

globalThis.window = {
  getComputedStyle: (element) => element.computedStyle ?? { transform: "none" },
};

function element({
  className = "",
  transform = "",
  parent = null,
  box = null,
  text = "word",
  textWidth = 0,
} = {}) {
  const el = {
    nodeType: 1,
    className,
    parentElement: parent,
    style: { transform },
    textContent: text,
    computedStyle: {
      transform: transform || "none",
      fontSize: "16px",
      lineHeight: "19.2px",
    },
    clientWidth: box ? box.w : 0,
    clientHeight: box ? box.h : 0,
    // A probe span inherits the overlay's font, so it reports the word's own
    // width — never the box's, the way `scrollWidth` would.
    ownerDocument: {
      createElement: () => ({
        style: {},
        offsetWidth: textWidth,
        remove() {},
      }),
    },
    appendChild() {},
  };
  el.closest = (selector) => {
    const wanted = selector.replace(".", "");
    let current = el;
    while (current) {
      if (current.className.split(" ").includes(wanted)) return current;
      current = current.parentElement;
    }
    return null;
  };
  return el;
}

function rangeInside(parent) {
  return { startContainer: { nodeType: 3, parentElement: parent } };
}

// "See You Later, Alligator" (9781510704855), page 004_Chapter001_0003.html,
// the word "I'll": a hand-lettered line sloping down to the right.
const OCR_BOX = { left: 256.8, top: 392, width: 42.9, height: 51.4 };

// Overlay boxes measured on "See You Later, Alligator" (9781510704855), word
// widths measured in the reader's WebView at a 16px font with a 19.2px line
// height. Only `kangaroo` is authored a quarter turn off; the rest are the
// near-misses a coarser rule gets wrong.
const KANGAROO = { box: { w: 44, h: 257 }, textWidth: 67 };
const KANGAROO_RECT = { left: 100, top: 200, width: 44, height: 257 };

describe("rotationDegreesFromTransform", () => {
  it("reads the inline degrees form authored by OCR overlays", () => {
    assert.equal(rotationDegreesFromTransform("rotate(7.64402deg)"), 7.64402);
    assert.equal(rotationDegreesFromTransform("rotate(-3.5deg)"), -3.5);
  });

  it("recovers the angle from the computed matrix form", () => {
    const angle = rotationDegreesFromTransform(
      "matrix(0.991114, 0.133018, -0.133018, 0.991114, 0, 0)"
    );
    assert.ok(Math.abs(angle - 7.64402) < 0.001);
  });

  it("returns undefined when there is no rotation", () => {
    assert.equal(rotationDegreesFromTransform("none"), undefined);
    assert.equal(rotationDegreesFromTransform(""), undefined);
    assert.equal(
      rotationDegreesFromTransform("matrix(1, 0, 0, 1, 12, 30)"),
      undefined
    );
  });
});

describe("getClosestRotationDegrees", () => {
  it("stops at the boundary element", () => {
    const rotated = element({
      className: "ocr-container",
      transform: "rotate(4deg)",
    });
    const overlay = element({ className: "text-overlay", parent: rotated });

    assert.equal(getClosestRotationDegrees(overlay, overlay), undefined);
    assert.equal(getClosestRotationDegrees(overlay, rotated), 4);
  });
});

describe("ocrOverlayGeometry", () => {
  it("offers the overlay box and its rotation for an unwrapped word", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({
      className: "text-overlay",
      transform: "rotate(7.64402deg)",
      parent: container,
    });

    const geometry = ocrOverlayGeometry(rangeInside(overlay), OCR_BOX, 1);

    assert.deepEqual(geometry.box, OCR_BOX);
    assert.equal(geometry.rotationAngle, 7.64402);
  });

  it("withholds the box once the invisible text has wrapped", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({
      className: "text-overlay",
      transform: "rotate(7.64402deg)",
      parent: container,
    });

    const geometry = ocrOverlayGeometry(rangeInside(overlay), OCR_BOX, 3);

    assert.equal(geometry.box, null);
    assert.equal(geometry.rotationAngle, 7.64402);
  });

  it("reports no rotation for an upright overlay", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({ className: "text-overlay", parent: container });

    const geometry = ocrOverlayGeometry(rangeInside(overlay), OCR_BOX, 1);

    assert.deepEqual(geometry.box, OCR_BOX);
    assert.equal(geometry.rotationAngle, undefined);
  });

  it("stays out of the way of ordinary reflowable text", () => {
    const paragraph = element({ className: "chapter" });

    const geometry = ocrOverlayGeometry(rangeInside(paragraph), null, 1);

    assert.equal(geometry.box, null);
    assert.equal(geometry.rotationAngle, undefined);
  });

  it("turns a swapped overlay onto the axis the word reads along", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({
      className: "text-overlay",
      transform: "rotate(-35.7686deg)",
      parent: container,
      box: KANGAROO.box,
      text: "kangaroo",
      textWidth: KANGAROO.textWidth,
    });

    const geometry = ocrOverlayGeometry(rangeInside(overlay), KANGAROO_RECT, 1);

    assert.deepEqual(geometry.box, {
      left: 100 + (44 - 257) / 2,
      top: 200 + (257 - 44) / 2,
      width: 257,
      height: 44,
    });
    assert.ok(Math.abs(geometry.rotationAngle - 54.2314) < 0.001);
  });

  it("keeps the turn upright for an overlay tilted the other way", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({
      className: "text-overlay",
      transform: "rotate(35.7686deg)",
      parent: container,
      box: KANGAROO.box,
      text: "kangaroo",
      textWidth: KANGAROO.textWidth,
    });

    const geometry = ocrOverlayGeometry(rangeInside(overlay), KANGAROO_RECT, 1);

    assert.ok(Math.abs(geometry.rotationAngle + 54.2314) < 0.001);
  });
});

describe("textRunsAlongBoxHeight", () => {
  const cases = [
    ["kangaroo", { w: 44, h: 257 }, 67, true],
    ["a", { w: 8, h: 13 }, 9, false],
    ["be", { w: 16, h: 19 }, 17, false],
    ["while", { w: 38, h: 20 }, 37, false],
    ["crocodile", { w: 93, h: 45 }, 66, false],
    ["Toodle", { w: 109, h: 51 }, 49, false],
    ["oo", { w: 39, h: 38 }, 18, false],
    // "Blue, Barry & Pancakes: Big Time Trouble" (9781250908476), page 3. A
    // single letter is naturally portrait, and its box on its own is wide
    // enough to pass for a whole line — only the word itself tells them apart.
    ["A", { w: 30, h: 43 }, 10, false],
    ["I", { w: 26, h: 41 }, 4, false],
  ];

  for (const [word, box, textWidth, expected] of cases) {
    it(`${expected ? "turns" : "leaves"} "${word}"`, () => {
      const overlay = element({
        className: "text-overlay",
        box,
        text: word,
        textWidth,
      });

      assert.equal(textRunsAlongBoxHeight(overlay), expected);
    });
  }

  it("ignores an overlay it cannot measure", () => {
    assert.equal(textRunsAlongBoxHeight(null), false);
  });

  it("leaves a word that merely fills a box taller than a line", () => {
    const overlay = element({
      className: "text-overlay",
      box: { w: 30, h: 43 },
      text: "A",
      textWidth: 10,
    });

    // The box alone clears the threshold; reading it instead of the word is
    // what drew the line beside "A" and "I" rather than under them.
    assert.ok(overlay.clientWidth > 19.2 * 1.2);
    assert.equal(textRunsAlongBoxHeight(overlay), false);
  });
});
