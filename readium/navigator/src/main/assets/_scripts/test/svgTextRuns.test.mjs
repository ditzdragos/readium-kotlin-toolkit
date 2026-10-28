import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeIntoLines } from "../src/rangeRects.mjs";
import {
  continuesWord,
  joinSvgTextRuns,
  turnedBoxAround,
  turnedBoxesByLine,
} from "../src/svgTextRuns.mjs";

function box(left, right, top, bottom) {
  return { left, right, top, bottom };
}

function svg() {
  const element = { localName: "svg", childNodes: [] };
  element.removeChild = (node) => {
    element.childNodes.splice(element.childNodes.indexOf(node), 1);
  };
  element.insertBefore = (node, reference) => {
    node.parentNode = element;
    element.childNodes.splice(element.childNodes.indexOf(reference), 0, node);
  };
  return element;
}

function append(parent, node) {
  node.parentNode = parent;
  parent.childNodes.push(node);
  return node;
}

function text(parent, value, rect) {
  return append(parent, {
    localName: "text",
    nodeType: 1,
    textContent: value,
    getBoundingClientRect: () => rect,
  });
}

function whitespace(parent, value = "\n") {
  return append(parent, { nodeType: 3, nodeValue: value });
}

function element(parent, localName) {
  return append(parent, { localName, nodeType: 1 });
}

function textOf(parent) {
  return parent.childNodes
    .map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent || ""))
    .join("");
}

function documentWith(root) {
  return {
    body: {
      querySelectorAll: () =>
        root.childNodes.filter((n) => n.localName === "text"),
    },
    createTextNode: (value) => ({ nodeType: 3, nodeValue: value }),
  };
}

// Glyph boxes measured on "With All My Heart, I Love You" (9781338747836), page003.
const RUMBLE_TUMBLE = [
  ["R", box(169.2, 220.0, 104.3, 180.1)],
  ["u", box(205.1, 250.9, 100.6, 174.8)],
  ["m", box(235.7, 296.6, 97.9, 171.5)],
  ["b", box(280.1, 317.1, 98.9, 169.2)],
  ["l", box(305.0, 325.9, 99.0, 169.9)],
  ["e", box(318.6, 355.6, 99.4, 171.8)],
  [" ", box(345.8, 345.8, 156.7, 156.7)],
  ["t", box(361.0, 392.1, 103.8, 176.4)],
  ["u", box(376.6, 428.7, 106.8, 183.5)],
  ["m", box(402.5, 478.3, 114.0, 198.5)],
  ["b", box(440.6, 501.1, 128.6, 207.5)],
  ["l", box(463.5, 508.8, 138.8, 210.7)],
  ["e", box(476.2, 534.8, 144.9, 222.2)],
  [",", box(500.0, 543.3, 156.1, 226.1)],
  [" ", box(516.6, 516.6, 211.1, 211.1)],
  ["g", box(680.2, 713.2, 204.0, 274.6)],
  ["o", box(702.7, 741.9, 201.9, 274.3)],
  [".", box(727.2, 749.6, 200.8, 272.3)],
  ["D", box(198.5, 240.5, 198.1, 258.7)],
  ["a", box(238.4, 270.0, 195.4, 254.0)],
];

describe("joinSvgTextRuns", () => {
  it("joins lettering drawn one glyph per element into words", () => {
    const root = svg();
    whitespace(root);
    for (const [value, rect] of RUMBLE_TUMBLE) {
      text(root, value, rect);
      whitespace(root);
    }

    joinSvgTextRuns(documentWith(root));

    assert.equal(textOf(root), "\nRumble\n \ntumble,\n \ngo.\nDa\n");
  });

  it("keeps punctuation set in its own element on its word", () => {
    const root = svg();
    text(root, "Chop", box(315, 381, 250, 290));
    whitespace(root);
    text(root, "!", box(382, 392, 248, 288));

    joinSvgTextRuns(documentWith(root));

    assert.equal(textOf(root), "Chop!");
  });

  it("keeps words that stand apart as separate words", () => {
    const root = svg();
    text(root, "Chop", box(100, 166, 250, 290));
    whitespace(root);
    text(root, "Chop", box(180, 246, 250, 290));

    joinSvgTextRuns(documentWith(root));

    assert.equal(textOf(root), "Chop\nChop");
  });

  it("separates elements written back to back when they do not touch", () => {
    const root = svg();
    text(root, "go.", box(680, 750, 200, 272));
    text(root, "Da", box(198, 270, 195, 258));

    joinSvgTextRuns(documentWith(root));

    assert.equal(textOf(root), "go.\nDa");
  });

  it("keeps letter-spaced lettering written back to back as one word", () => {
    const root = svg();
    let left = 100;
    for (const letter of "CHAPTER") {
      text(root, letter, box(left, left + 40, 100, 160));
      left += 52;
    }

    joinSvgTextRuns(documentWith(root));

    assert.equal(textOf(root), "CHAPTER");
  });

  it("does not join across another element", () => {
    const root = svg();
    text(root, "R", box(169, 220, 104, 180));
    whitespace(root);
    element(root, "path");
    whitespace(root);
    text(root, "u", box(205, 251, 100, 175));

    joinSvgTextRuns(documentWith(root));

    assert.equal(textOf(root), "R\n\nu");
  });
});

// The transforms page003 of 9781338747836 places "tumble," with, in its SVG's user units; the
// SVG draws them at twice that size. Each glyph's box spans its advance to the next glyph.
const TUMBLE = [
  [0.9894, 0.1452, -0.1452, 0.9894, 96.5546, 27.5771],
  [0.9775, 0.2108, -0.2108, 0.9775, 104.8498, 28.7334],
  [0.9496, 0.3135, -0.3135, 0.9496, 118.5258, 31.5928],
  [0.9269, 0.3753, -0.3753, 0.9269, 138.0346, 38.2382],
  [0.9154, 0.4025, -0.4025, 0.9154, 149.7128, 43.0489],
  [0.9082, 0.4186, -0.4186, 0.9082, 156.1958, 45.8936],
  [0.9058, 0.4237, -0.4237, 0.9058, 168.0928, 51.4002],
];
const ASCENT = 27;
const DESCENT = 7;
const SVG_SCALE = 2;

function placedGlyph([a, b, c, d, e, f], advance) {
  const onScreen = (x, y) => ({
    x: SVG_SCALE * (a * x + c * y + e),
    y: SVG_SCALE * (b * x + d * y + f),
  });
  return {
    corners: [
      onScreen(0, -ASCENT),
      onScreen(advance, -ASCENT),
      onScreen(advance, DESCENT),
      onScreen(0, DESCENT),
    ],
  };
}

function curvedWord(matrices) {
  return matrices.map((matrix, index) => {
    const next = matrices[index + 1];
    const advance = next
      ? Math.hypot(next[4] - matrix[4], next[5] - matrix[5])
      : 7.5;
    return placedGlyph(matrix, advance);
  });
}

function uprightBox(glyph) {
  const xs = glyph.corners.map((corner) => corner.x);
  const ys = glyph.corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function inTurnedFrame(box, point) {
  const angle = (box.rotationAngle * Math.PI) / 180;
  const centreX = box.rect.left + box.rect.width / 2;
  const centreY = box.rect.top + box.rect.height / 2;
  const dx = point.x - centreX;
  const dy = point.y - centreY;
  return {
    along: dx * Math.cos(angle) + dy * Math.sin(angle),
    across: -dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

describe("turnedBoxesByLine", () => {
  it("gives a word set along a curve one box, turned to follow it", () => {
    const glyphs = curvedWord(TUMBLE);
    assert.ok(
      mergeIntoLines(glyphs.map(uprightBox)).length > 1,
      "upright glyph boxes step down the curve and split into lines"
    );

    const boxes = turnedBoxesByLine(glyphs);

    assert.equal(boxes.length, 1);
    const [box] = boxes;
    assert.ok(box.rotationAngle > 8 && box.rotationAngle < 25);
    for (const glyph of glyphs) {
      for (const corner of glyph.corners) {
        const { along, across } = inTurnedFrame(box, corner);
        assert.ok(Math.abs(along) <= box.rect.width / 2 + 0.01);
        assert.ok(Math.abs(across) <= box.rect.height / 2 + 0.01);
      }
    }
  });

  it("keeps the box as tall as one glyph, so its bottom edge runs under the word", () => {
    const [box] = turnedBoxesByLine(curvedWord(TUMBLE));

    assert.ok(box.rect.height < SVG_SCALE * (ASCENT + DESCENT) * 1.5);
  });

  it("gives each line of lettering its own box", () => {
    const firstLine = curvedWord(TUMBLE);
    const secondLine = curvedWord(
      TUMBLE.map(([a, b, c, d, e, f]) => [a, b, c, d, e - 60, f + 60])
    );

    assert.equal(turnedBoxesByLine([...firstLine, ...secondLine]).length, 2);
  });
});

describe("turnedBoxAround", () => {
  it("turns a single glyph's box by the glyph's own angle", () => {
    const glyph = placedGlyph(TUMBLE[2], 20);

    const box = turnedBoxAround([glyph]);

    assert.ok(
      Math.abs(
        box.rotationAngle - (Math.atan2(0.3135, 0.9496) * 180) / Math.PI
      ) < 0.01
    );
    assert.ok(Math.abs(box.rect.width - SVG_SCALE * 20) < 0.01);
    assert.ok(
      Math.abs(box.rect.height - SVG_SCALE * (ASCENT + DESCENT)) < 0.01
    );
  });

  it("leaves a level word upright", () => {
    const glyphs = [0, 15, 30].map((x) => placedGlyph([1, 0, 0, 1, x, 30], 15));

    const box = turnedBoxAround(glyphs);

    assert.ok(Math.abs(box.rotationAngle) < 0.01);
    assert.deepEqual(
      [box.rect.left, box.rect.top, box.rect.right, box.rect.bottom].map(
        Math.round
      ),
      [0, 6, 90, 74]
    );
  });
});

describe("continuesWord", () => {
  it("never continues across a space glyph", () => {
    assert.equal(
      continuesWord(
        { text: "e", rect: box(318, 355, 99, 171) },
        { text: " ", rect: box(345, 345, 156, 156) }
      ),
      false
    );
  });

  it("does not continue onto a centred next line whose box overlaps", () => {
    assert.equal(
      continuesWord(
        { text: "Once upon a time", rect: box(100, 500, 100, 172) },
        { text: "there was", rect: box(200, 400, 160, 232) }
      ),
      false
    );
  });

  it("does not continue onto the next line", () => {
    assert.equal(
      continuesWord(
        { text: "o", rect: box(100, 140, 100, 170) },
        { text: "D", rect: box(150, 190, 180, 240) }
      ),
      false
    );
  });
});
