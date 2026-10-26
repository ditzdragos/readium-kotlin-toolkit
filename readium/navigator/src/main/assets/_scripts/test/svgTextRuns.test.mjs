import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { continuesWord, joinSvgTextRuns } from "../src/svgTextRuns.mjs";

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
