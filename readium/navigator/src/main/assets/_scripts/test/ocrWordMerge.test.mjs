import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeSplitOcrWords } from "../src/ocrWordMerge.mjs";

function overlay({ text, left, top = 10, width, height = 4, rotate = null }) {
  const element = {
    className: "text-overlay",
    style: {
      left: `${left}%`,
      top: `${top}%`,
      width: `${width}%`,
      height: `${height}%`,
      transform: rotate === null ? "" : `rotate(${rotate}deg)`,
    },
    textContent: `\n    ${text}\n   `,
  };
  element.remove = () => {
    element.parent.children = element.parent.children.filter(
      (child) => child !== element
    );
  };
  return element;
}

function unstyledOverlay(text) {
  const element = { className: "text-overlay", style: {}, textContent: text };
  element.remove = () => {};
  return element;
}

function container(children) {
  const element = {
    className: "ocr-container",
    children,
    querySelectorAll: (selector) =>
      selector === ".text-overlay" ? [...element.children] : [],
  };
  children.forEach((child) => {
    child.parent = element;
  });
  return element;
}

function page(containers) {
  return {
    querySelectorAll: (selector) =>
      selector === ".ocr-container" ? containers : [],
  };
}

function words(node) {
  return node.children.map((child) => child.textContent.trim());
}

// "She has a basket full of fun hats for them to" — the gap the page holds its
// real words apart with is a quarter of the box height; the cut inside "hats"
// has none.
function lineWithCutWord() {
  return container([
    overlay({ text: "fun", left: 0, width: 5 }),
    overlay({ text: "ha", left: 6, width: 3 }),
    overlay({ text: "ts", left: 9, width: 2 }),
    overlay({ text: "for", left: 12, width: 4 }),
  ]);
}

describe("mergeSplitOcrWords", () => {
  it("rejoins a word the page cut across two overlays", () => {
    const ocr = lineWithCutWord();

    const merged = mergeSplitOcrWords(page([ocr]));

    assert.equal(merged, 1);
    assert.deepEqual(words(ocr), ["fun", "hats", "for"]);
  });

  it("gives the rejoined word the box its halves covered together", () => {
    const ocr = lineWithCutWord();

    mergeSplitOcrWords(page([ocr]));

    const rejoined = ocr.children[1];
    assert.equal(rejoined.style.left, "6%");
    assert.equal(rejoined.style.width, "5%");
    assert.equal(rejoined.style.top, "10%");
    assert.equal(rejoined.style.height, "4%");
  });

  it("leaves words the page holds apart with a space alone", () => {
    const ocr = container([
      overlay({ text: "fun", left: 0, width: 5 }),
      overlay({ text: "hats", left: 6, width: 5 }),
      overlay({ text: "for", left: 12, width: 4 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 0);
    assert.deepEqual(words(ocr), ["fun", "hats", "for"]);
  });

  it("rejoins a word cut into more than two overlays", () => {
    const ocr = container([
      overlay({ text: "fun", left: 0, width: 5 }),
      overlay({ text: "chi", left: 6, width: 3 }),
      overlay({ text: "ld", left: 9, width: 2 }),
      overlay({ text: "ren", left: 11, width: 3 }),
      overlay({ text: "for", left: 15, width: 4 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 2);
    assert.deepEqual(words(ocr), ["fun", "children", "for"]);
    assert.equal(ocr.children[1].style.width, "8%");
  });

  it("does not rejoin across lines", () => {
    const ocr = container([
      overlay({ text: "ha", left: 20, top: 10, width: 3 }),
      overlay({ text: "ts", left: 0, top: 20, width: 2 }),
      overlay({ text: "for", left: 3, top: 20, width: 4 }),
      overlay({ text: "them", left: 8, top: 20, width: 5 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 0);
  });

  it("does not rejoin a pair straddling a punctuation mark", () => {
    const ocr = container([
      overlay({ text: "from.", left: 0, width: 5 }),
      overlay({ text: "The", left: 5, width: 4 }),
      overlay({ text: "children", left: 10, width: 8 }),
      overlay({ text: "are", left: 19, width: 3 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 0);
    assert.deepEqual(words(ocr), ["from.", "The", "children", "are"]);
  });

  it("rejoins a cut word whose tail carries the sentence's full stop", () => {
    const ocr = container([
      overlay({ text: "fun", left: 0, width: 5 }),
      overlay({ text: "chi", left: 6, width: 3 }),
      overlay({ text: "ldren.", left: 9, width: 5 }),
      overlay({ text: "The", left: 15, width: 4 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 1);
    assert.deepEqual(words(ocr), ["fun", "children.", "The"]);
  });

  it("rejoins a cut word whose head carries the opening quotation mark", () => {
    const ocr = container([
      overlay({ text: "said", left: 0, width: 5 }),
      overlay({ text: "\u201cha", left: 6, width: 3 }),
      overlay({ text: "ts", left: 9, width: 2 }),
      overlay({ text: "for", left: 12, width: 4 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 1);
    assert.deepEqual(words(ocr), ["said", "\u201chats", "for"]);
  });

  it("does not rejoin overlays set at different angles", () => {
    const ocr = container([
      overlay({ text: "ha", left: 6, width: 3, rotate: 0 }),
      overlay({ text: "ts", left: 9, width: 2, rotate: 12 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 0);
  });

  it("rejoins on a page that offers no other gap to learn from", () => {
    const ocr = container([
      overlay({ text: "ha", left: 6, width: 3 }),
      overlay({ text: "ts", left: 9, width: 2 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 1);
    assert.deepEqual(words(ocr), ["hats"]);
  });

  it("keeps two words apart on a page that offers no other gap", () => {
    const ocr = container([
      overlay({ text: "fun", left: 0, width: 5 }),
      overlay({ text: "hats", left: 6, width: 5 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 0);
  });

  it("ignores overlays with no authored percentage box", () => {
    const ocr = container([
      unstyledOverlay("ha"),
      unstyledOverlay("ts"),
      overlay({ text: "for", left: 12, width: 4 }),
    ]);

    assert.equal(mergeSplitOcrWords(page([ocr])), 0);
  });

  it("does nothing on a page with no OCR overlay", () => {
    assert.equal(mergeSplitOcrWords(page([])), 0);
    assert.equal(mergeSplitOcrWords(null), 0);
  });
});
