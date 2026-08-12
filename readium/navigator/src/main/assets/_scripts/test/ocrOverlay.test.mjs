import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getClosestRotationDegrees,
  ocrOverlayBoxes,
  overlayElementsInRange,
  rotationDegreesFromTransform,
  textRunsAlongBoxHeight,
} from "../src/ocrOverlay.mjs";

globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

globalThis.Range = {
  START_TO_START: 0,
  START_TO_END: 1,
  END_TO_END: 2,
  END_TO_START: 3,
};

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
      createRange: () => boundaries(0, 0),
    },
    children: [],
    get firstElementChild() {
      return el.children[0] ?? null;
    },
    contains: (node) => {
      let current = node?.nodeType === 3 ? node.parentElement : node;
      while (current) {
        if (current === el) return true;
        current = current.parentElement;
      }
      return false;
    },
    querySelectorAll: (selector) => {
      const wanted = selector.replace(".", "");
      return el.children.filter((child) =>
        child.className.split(" ").includes(wanted)
      );
    },
    appendChild() {},
  };
  if (parent) {
    parent.children.push(el);
  }
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

/**
 * A pair of boundary points on one document-order axis, comparable the way the
 * DOM compares two ranges.
 */
function boundaries(start, end) {
  return {
    start,
    end,
    selectNodeContents(element) {
      this.start = element.start;
      this.end = element.end;
    },
    compareBoundaryPoints(how, other) {
      const mine = how === Range.END_TO_START ? this.start : this.end;
      const theirs = how === Range.END_TO_START ? other.end : other.start;
      if (mine === theirs) return 0;
      return mine < theirs ? -1 : 1;
    },
  };
}

function rangeInside(parent) {
  const range = boundaries(parent.start ?? 0, parent.end ?? 1);
  range.startContainer = { nodeType: 3, parentElement: parent };
  return range;
}

/** An `.ocr-container` holding one `.text-overlay` per word, in reading order. */
function ocrPage(words) {
  const container = element({ className: "ocr-container" });
  const overlays = words.map((word, index) => {
    const overlay = element({
      className: "text-overlay",
      parent: container,
      text: typeof word === "string" ? word : word.text,
      transform: typeof word === "string" ? "" : word.transform ?? "",
    });
    // Words never touch: a range ending on one cannot spill into the next.
    overlay.start = index * 10;
    overlay.end = index * 10 + 5;
    return overlay;
  });
  return { container, overlays };
}

/** A range covering `words[from]` through `words[to]` inclusive. */
function rangeOverWords(overlays, from, to) {
  const range = boundaries(overlays[from].start, overlays[to].end);
  range.startContainer = { nodeType: 3, parentElement: overlays[from] };
  // Both ends of a restored span land in whitespace between the overlays, whose
  // parent is the container itself.
  range.endContainer = {
    nodeType: 3,
    parentElement: overlays[to].parentElement,
  };
  return range;
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

describe("overlayElementsInRange", () => {
  it("covers every word a restored reading span reaches", () => {
    const { overlays } = ocrPage(["YOU'RE", "NOT", "MAKING", "ME", "GO", "TO"]);

    const covered = overlayElementsInRange(rangeOverWords(overlays, 0, 3));

    assert.deepEqual(
      covered.map((overlay) => overlay.textContent),
      ["YOU'RE", "NOT", "MAKING", "ME"]
    );
  });

  it("leaves out the word a range stops short of", () => {
    const { overlays } = ocrPage(["I", "HAVE", "TYPE"]);
    const range = rangeOverWords(overlays, 0, 1);
    range.end = overlays[2].start;

    const covered = overlayElementsInRange(range);

    assert.deepEqual(
      covered.map((overlay) => overlay.textContent),
      ["I", "HAVE"]
    );
  });

  it("stays out of the way of ordinary reflowable text", () => {
    const paragraph = element({ className: "chapter" });

    assert.deepEqual(overlayElementsInRange(rangeInside(paragraph)), []);
  });
});

describe("ocrOverlayBoxes", () => {
  it("offers the overlay box and its rotation for one word", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({
      className: "text-overlay",
      transform: "rotate(7.64402deg)",
      parent: container,
    });

    const boxes = ocrOverlayBoxes(rangeInside(overlay), () => OCR_BOX);

    assert.equal(boxes.length, 1);
    assert.deepEqual(boxes[0].rect, OCR_BOX);
    assert.equal(boxes[0].rotationAngle, 7.64402);
  });

  it("gives a span of words one box each, never the first word's alone", () => {
    const { overlays } = ocrPage(["YOU'RE", "NOT", "MAKING"]);
    const rects = {
      "YOU'RE": { left: 136, top: 96, width: 47, height: 14 },
      NOT: { left: 185, top: 96, width: 29, height: 14 },
      MAKING: { left: 120, top: 112, width: 48, height: 12 },
    };

    const boxes = ocrOverlayBoxes(
      rangeOverWords(overlays, 0, 2),
      (overlay) => rects[overlay.textContent]
    );

    assert.deepEqual(
      boxes.map((box) => box.rect),
      [rects["YOU'RE"], rects.NOT, rects.MAKING]
    );
  });

  it("still boxes a word whose invisible text wrapped", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({ className: "text-overlay", parent: container });

    const boxes = ocrOverlayBoxes(rangeInside(overlay), () => OCR_BOX);

    assert.deepEqual(
      boxes.map((box) => box.rect),
      [OCR_BOX]
    );
  });

  it("reports no rotation for an upright overlay", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({ className: "text-overlay", parent: container });

    const boxes = ocrOverlayBoxes(rangeInside(overlay), () => OCR_BOX);

    assert.equal(boxes[0].rotationAngle, undefined);
  });

  it("stays out of the way of ordinary reflowable text", () => {
    const paragraph = element({ className: "chapter" });

    assert.deepEqual(
      ocrOverlayBoxes(rangeInside(paragraph), () => null),
      []
    );
  });

  it("forfeits the span when one of its words has no authored box", () => {
    const { overlays } = ocrPage(["I", "HAVE"]);

    // Boxing only "HAVE" would leave "I" undecorated: the caller drops its
    // client rects as soon as one box comes back.
    const boxes = ocrOverlayBoxes(rangeOverWords(overlays, 0, 1), (overlay) =>
      overlay.textContent === "HAVE" ? OCR_BOX : null
    );

    assert.deepEqual(boxes, []);
  });

  it("forfeits a span that reaches past its container", () => {
    const { container, overlays } = ocrPage(["I", "HAVE"]);
    const range = rangeOverWords(overlays, 0, 1);
    const elsewhere = element({ className: "caption" });
    range.endContainer = { nodeType: 3, parentElement: elsewhere };

    assert.equal(container.contains(range.endContainer), false);
    assert.deepEqual(
      ocrOverlayBoxes(range, () => OCR_BOX),
      []
    );
  });

  it("finds a rotation authored on a wrapper inside the overlay", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({ className: "text-overlay", parent: container });
    element({
      className: "rotated",
      parent: overlay,
      transform: "rotate(7.64402deg)",
    });

    const boxes = ocrOverlayBoxes(rangeInside(overlay), () => OCR_BOX);

    assert.equal(boxes[0].rotationAngle, 7.64402);
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

    const boxes = ocrOverlayBoxes(rangeInside(overlay), () => KANGAROO_RECT);

    assert.deepEqual(boxes[0].rect, {
      left: 100 + (44 - 257) / 2,
      top: 200 + (257 - 44) / 2,
      width: 257,
      height: 44,
    });
    assert.ok(Math.abs(boxes[0].rotationAngle - 54.2314) < 0.001);
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

    const boxes = ocrOverlayBoxes(rangeInside(overlay), () => KANGAROO_RECT);

    assert.ok(Math.abs(boxes[0].rotationAngle + 54.2314) < 0.001);
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

      assert.equal(
        textRunsAlongBoxHeight(overlay, { width: box.w, height: box.h }),
        expected
      );
    });
  }

  it("ignores an overlay it cannot measure", () => {
    assert.equal(textRunsAlongBoxHeight(null, OCR_BOX), false);
    assert.equal(
      textRunsAlongBoxHeight(element({ className: "text-overlay" }), null),
      false
    );
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
    assert.equal(
      textRunsAlongBoxHeight(overlay, { width: 30, height: 43 }),
      false
    );
  });

  // "Good-bye Stacey, Good-bye" (9781338616064) wraps its overlays in an
  // `inline-block` `.ocr-container` whose only children are absolutely
  // positioned, so the container lays out zero pixels wide and every
  // percentage width under it collapses with it.
  for (const [word, textWidth, box] of [
    ["YOU'RE", 58, { width: 47, height: 14 }],
    ["MAKING", 66, { width: 48, height: 12 }],
    ["DIABETES.", 81, { width: 64, height: 16 }],
  ]) {
    it(`leaves "${word}" when the container collapsed its width`, () => {
      const overlay = element({
        className: "text-overlay",
        box: { w: 0, h: box.height },
        text: word,
        textWidth,
      });

      assert.equal(overlay.clientWidth, 0);
      assert.equal(textRunsAlongBoxHeight(overlay, box), false);
    });
  }
});
