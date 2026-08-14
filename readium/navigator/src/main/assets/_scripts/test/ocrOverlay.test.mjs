import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clipOcrRectToRange,
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
  measureText = null,
} = {}) {
  const el = {
    nodeType: 1,
    className,
    parentElement: parent,
    style: { transform },
    textContent: text,
    // Boundary points on the shared document-order axis. `ocrPage`/`phrasePage`
    // space these out per overlay; a standalone element still needs its own
    // span, or `selectNodeContents` reads undefined and every comparison
    // against it answers "outside".
    start: 0,
    end: text.length,
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
      createElement: () => {
        const probe = {
          style: {},
          textContent: "",
          appendChild() {},
          remove() {},
        };
        Object.defineProperty(probe, "offsetWidth", {
          get: () => (measureText ? measureText(probe.textContent) : textWidth),
        });
        return probe;
      },
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
function boundaries(start, end, owner = null) {
  return {
    start,
    end,
    owner,
    selectNodeContents(element) {
      this.start = element.start;
      this.end = element.end;
      this.owner = element;
    },
    setStart(container, offset) {
      this.owner = container.parentElement;
      this.start = this.owner.start + offset;
    },
    setEnd(container, offset) {
      this.owner = container.parentElement;
      this.end = this.owner.start + offset;
    },
    collapse(toStart) {
      if (toStart) this.end = this.start;
      else this.start = this.end;
    },
    toString() {
      if (!this.owner) return "";
      const base = this.owner.start;
      return (this.owner.textContent ?? "").slice(
        this.start - base,
        this.end - base
      );
    },
    compareBoundaryPoints(how, other) {
      const mine =
        how === Range.START_TO_START || how === Range.END_TO_START
          ? this.start
          : this.end;
      const theirs =
        how === Range.START_TO_START || how === Range.START_TO_END
          ? other.start
          : other.end;
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

    // The same eight fields the authored box carries: a caller positioning a
    // vertical-rl decoration reads `right`, and a missing one lands as NaN.
    const left = 100 + (44 - 257) / 2;
    const top = 200 + (257 - 44) / 2;
    assert.deepEqual(boxes[0].rect, {
      left,
      top,
      right: left + 257,
      bottom: top + 44,
      width: 257,
      height: 44,
      x: left,
      y: top,
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

/**
 * An `.ocr-container` holding a single `.text-overlay` that bounds a whole run
 * of words rather than one word.
 */
function phraseOverlay(text, measureText, transform = "") {
  return phrasePage([text], measureText, transform)[0];
}

/** An `.ocr-container` whose overlays each bound a run of words. */
function phrasePage(texts, measureText, transform = "") {
  const container = element({ className: "ocr-container" });
  let cursor = 0;
  return texts.map((text) => {
    const overlay = element({
      className: "text-overlay",
      parent: container,
      text,
      measureText,
      transform,
    });
    overlay.start = cursor;
    overlay.end = cursor + text.length;
    overlay.textNode = { nodeType: 3, parentElement: overlay };
    // Runs never touch: a range ending on one cannot spill into the next.
    cursor = overlay.end + 5;
    return overlay;
  });
}

/** A range running from one overlay's text into another's. */
function rangeAcross(from, fromOffset, to, toOffset) {
  const range = boundaries(from.start + fromOffset, to.start + toOffset, from);
  range.startContainer = from.textNode;
  range.startOffset = fromOffset;
  range.endContainer = to.textNode;
  range.endOffset = toOffset;
  return range;
}

/** A range over `text.slice(from, to)` inside a phrase overlay. */
function rangeOverPhrase(overlay, from, to) {
  const range = boundaries(from, to, overlay);
  range.startContainer = overlay.textNode;
  range.startOffset = from;
  range.endContainer = overlay.textNode;
  range.endOffset = to;
  return range;
}

/** A stand-in font in which every character advances the same width. */
const perCharacter = (width) => (text) => text.length * width;

describe("ocrOverlayBoxes on an overlay holding several words", () => {
  // RR-8328: the word being read is one of several the box bounds, so painting
  // the whole box underlines its neighbours at the same time.
  const PHRASE = "time and Oliver";
  const PHRASE_BOX = { left: 100, top: 200, width: 150, height: 20 };
  const AND = PHRASE.indexOf("and");
  const OLIVER = PHRASE.indexOf("Oliver");

  it("clips the box to the word the range covers", () => {
    const overlay = phraseOverlay(PHRASE, perCharacter(10));

    const boxes = ocrOverlayBoxes(
      rangeOverPhrase(overlay, AND, AND + 3),
      () => PHRASE_BOX
    );

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].rect.left, 150);
    assert.equal(boxes[0].rect.width, 30);
    assert.equal(boxes[0].rect.top, PHRASE_BOX.top);
    assert.equal(boxes[0].rect.height, PHRASE_BOX.height);
  });

  it("clips to the first word without shifting the box's left edge", () => {
    const overlay = phraseOverlay(PHRASE, perCharacter(10));

    const boxes = ocrOverlayBoxes(
      rangeOverPhrase(overlay, 0, 4),
      () => PHRASE_BOX
    );

    assert.equal(boxes[0].rect.left, PHRASE_BOX.left);
    assert.equal(boxes[0].rect.width, 40);
  });

  it("clips to the last word without overrunning the box's right edge", () => {
    const overlay = phraseOverlay(PHRASE, perCharacter(10));

    const boxes = ocrOverlayBoxes(
      rangeOverPhrase(overlay, OLIVER, PHRASE.length),
      () => PHRASE_BOX
    );

    assert.equal(boxes[0].rect.left, 190);
    assert.equal(boxes[0].rect.right, PHRASE_BOX.left + PHRASE_BOX.width);
  });

  it("leaves the whole box to a range that covers the whole run", () => {
    const overlay = phraseOverlay(PHRASE, perCharacter(10));

    const boxes = ocrOverlayBoxes(
      rangeOverPhrase(overlay, 0, PHRASE.length),
      () => PHRASE_BOX
    );

    assert.deepEqual(boxes[0].rect, PHRASE_BOX);
  });

  it("keeps the space a read span trails off the decorated run", () => {
    const overlay = phraseOverlay(PHRASE, perCharacter(10));

    // A read-word span runs to where the next word starts, so it carries the
    // space between them, and the artwork has no glyph there to decorate.
    const boxes = ocrOverlayBoxes(
      rangeOverPhrase(overlay, 0, AND),
      () => PHRASE_BOX
    );

    assert.equal(boxes[0].rect.width, 40);
  });

  it("measures against the run, not the padding around it", () => {
    // Some books pad the text inside the overlay; the box still bounds only the
    // glyphs, so the padding must not shift the share the word takes up.
    const overlay = phraseOverlay(`  ${PHRASE}  `, perCharacter(10));

    const boxes = ocrOverlayBoxes(
      rangeOverPhrase(overlay, AND + 2, AND + 5),
      () => PHRASE_BOX
    );

    assert.equal(boxes[0].rect.left, 150);
    assert.equal(boxes[0].rect.width, 30);
  });

  it("places a clipped box where the whole box's turn carries it", () => {
    // The decoration is turned about its own centre, so a clipped box anchored
    // at the clipped left edge would swing off the word it marks.
    const overlay = phraseOverlay(PHRASE, perCharacter(10), "rotate(90deg)");

    const boxes = ocrOverlayBoxes(
      rangeOverPhrase(overlay, 0, 4),
      () => PHRASE_BOX
    );

    assert.equal(boxes[0].rotationAngle, 90);
    assert.equal(boxes[0].rect.width, 40);
    // The box centre is (175, 210); the clipped centre (120, 210) turns a
    // quarter about it to (175, 155).
    assert.ok(Math.abs(boxes[0].rect.left - 155) < 1e-6);
    assert.ok(Math.abs(boxes[0].rect.top - 145) < 1e-6);
  });

  it("clips only the run a span stops inside", () => {
    const [read, next] = phrasePage(
      ["It was Christmas", PHRASE],
      perCharacter(10)
    );
    const READ_BOX = { left: 0, top: 200, width: 160, height: 20 };
    const rects = { [read.textContent]: READ_BOX, [PHRASE]: PHRASE_BOX };

    const boxes = ocrOverlayBoxes(
      rangeAcross(read, 0, next, 4),
      (overlay) => rects[overlay.textContent]
    );

    assert.equal(boxes.length, 2);
    assert.deepEqual(boxes[0].rect, READ_BOX);
    assert.equal(boxes[1].rect.left, PHRASE_BOX.left);
    assert.equal(boxes[1].rect.width, 40);
  });
});

/**
 * A `white-space: pre` probe reports its widest line rather than the run's
 * advance, so a run left verbatim across a line break measures short.
 */
const perCharacterWidestLine = (width) => (text) =>
  Math.max(...text.split("\n").map((line) => line.length)) * width;

describe("measuring an overlay run the way the reader lays it out", () => {
  const BOX = { left: 100, top: 200, width: 150, height: 20 };

  it("collapses a line break, which would otherwise measure one line", () => {
    // Pretty-printed OCR markup puts the run across two source lines. Measured
    // verbatim under `pre` every prefix reports the same widest line, the
    // fractions collapse to a point, and the underline disappears entirely.
    const overlay = phraseOverlay(
      "time and\nOliver",
      perCharacterWidestLine(10)
    );
    const range = rangeOverPhrase(overlay, "time and\n".length, 15);

    const boxes = ocrOverlayBoxes(range, () => BOX);

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].rect.left, 190);
    assert.equal(boxes[0].rect.width, 60);
  });

  it("collapses a doubled space, which would otherwise measure wide", () => {
    const overlay = phraseOverlay("time  and Oliver", perCharacter(10));
    const range = rangeOverPhrase(overlay, "time  and ".length, 16);

    const boxes = ocrOverlayBoxes(range, () => BOX);

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].rect.left, 190);
    assert.equal(boxes[0].rect.width, 60);
  });
});

describe("an overlay the range reaches but decorates none of", () => {
  it("draws nothing there rather than marking the whole run", () => {
    // A read span runs to where the next word starts, so it can stop inside the
    // next overlay's leading whitespace. Keeping that authored box would mark
    // every word in it: the RR-8328 smear, one box further along.
    const [first, second] = phrasePage(
      ["time and", "  Oliver"],
      perCharacter(10)
    );
    const range = rangeAcross(first, 0, second, 1);

    const boxes = ocrOverlayBoxes(range, (overlay) =>
      overlay === first
        ? { left: 100, top: 200, width: 80, height: 20 }
        : { left: 200, top: 200, width: 80, height: 20 }
    );

    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].rect.left, 100);
    assert.equal(boxes[0].rect.width, 80);
  });
});

describe("clipOcrRectToRange", () => {
  // The word-help card and the mastered-word star anchor to this rect, so on a
  // book bounding several words in one overlay they would point at the whole
  // phrase while the underline marks one word.
  const PHRASE = "time and Oliver";
  const BOX = { left: 100, top: 200, width: 150, height: 20 };

  it("clips the rect to the word the range covers", () => {
    const overlay = phraseOverlay(PHRASE, perCharacter(10));
    const range = rangeOverPhrase(overlay, PHRASE.indexOf("and"), 8);

    const rect = clipOcrRectToRange(BOX, range);

    assert.equal(rect.left, 150);
    assert.equal(rect.width, 30);
  });

  it("keeps the whole box when the range covers the whole run", () => {
    const overlay = phraseOverlay(PHRASE, perCharacter(10));

    assert.deepEqual(clipOcrRectToRange(BOX, rangeInside(overlay)), BOX);
  });

  it("keeps the whole box when the range covers no glyphs", () => {
    // Unlike a decoration, these always need somewhere to point.
    const [, second] = phrasePage(["time and", "  Oliver"], perCharacter(10));

    assert.deepEqual(
      clipOcrRectToRange(BOX, rangeAcross(second, 0, second, 1)),
      BOX
    );
  });

  it("leaves a rect alone when the range is not in an overlay", () => {
    assert.deepEqual(clipOcrRectToRange(BOX, rangeInside(element())), BOX);
  });
});
