import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  continuesJoinedWord,
  continuesWord,
  joinLetteringRuns,
} from "../src/letteringRuns.mjs";

const SVG = "http://www.w3.org/2000/svg";
const XHTML = "http://www.w3.org/1999/xhtml";

function box(left, right, top, bottom) {
  return { left, right, top, bottom };
}

function node(localName, namespaceURI, props = {}) {
  const element = {
    nodeType: 1,
    localName,
    namespaceURI,
    childNodes: [],
    ...props,
  };
  element.removeChild = (child) => {
    element.childNodes.splice(element.childNodes.indexOf(child), 1);
  };
  element.insertBefore = (child, reference) => {
    child.parentNode = element;
    element.childNodes.splice(element.childNodes.indexOf(reference), 0, child);
  };
  return element;
}

function append(parent, child) {
  child.parentNode = parent;
  parent.childNodes.push(child);
  return child;
}

function svg() {
  return node("svg", SVG);
}

function group(parent) {
  return append(parent, node("g", SVG));
}

function text(parent, value, rect) {
  return append(
    parent,
    node("text", SVG, {
      textContent: value,
      getBoundingClientRect: () => rect,
    })
  );
}

function element(parent, localName) {
  return append(parent, node(localName, SVG));
}

function block(parent, value, rect, display = "block") {
  return append(
    parent,
    node("p", XHTML, {
      childNodes: [{ nodeType: 3, nodeValue: value }],
      textContent: value,
      display,
      rect,
    })
  );
}

function whitespace(parent, value = "\n") {
  return append(parent, { nodeType: 3, nodeValue: value });
}

function textOf(parent) {
  if (parent.nodeType === 3) {
    return parent.nodeValue;
  }
  return parent.childNodes.length > 0
    ? parent.childNodes.map(textOf).join("")
    : parent.textContent || "";
}

function documentWith(root) {
  const body = node("body", XHTML);
  append(body, root);
  return {
    body,
    createTextNode: (value) => ({ nodeType: 3, nodeValue: value }),
    createRange: () => {
      let contents = null;
      return {
        selectNodeContents: (element) => {
          contents = element;
        },
        getBoundingClientRect: () => contents.rect,
      };
    },
    defaultView: {
      getComputedStyle: (element) => ({ display: element.display }),
    },
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

// Glyph boxes measured on "I Play" (9781626725126): one rotated <p> per glyph or two.
const I_PLAY = {
  run: [
    ["r", box(208.8, 250.4, 495.8, 577.4)],
    ["u", box(244.6, 302.1, 498.7, 582.2)],
    ["n", box(290.6, 351.8, 498.0, 583.5)],
  ],
  jump: [
    ["ju", box(406.0, 495.5, 577.9, 656.1)],
    ["m", box(491.3, 580.7, 575.8, 664.4)],
    ["p", box(557.9, 635.9, 595.0, 687.3)],
  ],
  dance: [
    ["d", box(296.2, 354.7, 111.1, 192.1)],
    ["a", box(359.1, 411.4, 99.4, 181.4)],
    ["n", box(406.7, 483.4, 109.6, 201.0)],
    ["c", box(459.3, 529.4, 115.0, 204.4)],
    ["e", box(511.9, 582.9, 98.4, 188.1)],
  ],
  stretch: [
    ["s", box(204.0, 278.2, 157.4, 243.6)],
    ["t", box(239.7, 306.1, 140.6, 227.1)],
    ["r", box(277.8, 340.3, 126.6, 213.5)],
    ["e", box(319.0, 383.5, 116.3, 203.1)],
    ["t", box(374.1, 414.9, 114.9, 195.0)],
    ["c", box(408.8, 463.7, 114.1, 196.3)],
    ["h", box(452.0, 524.5, 119.5, 208.5)],
  ],
};

// Glyph boxes measured on "The Family Tree" (9781466808836), page 11: "C" beside a <g> holding
// the rest of the word.
const CREEAAK = [
  ["C", box(136.4, 175.5, 546.9, 590.5)],
  ["R", box(162.2, 188.4, 541.0, 574.8)],
  ["E", box(182.5, 203.5, 538.6, 567.2)],
  ["E", box(200.8, 219.5, 536.0, 562.7)],
  ["A", box(217.3, 236.3, 534.7, 561.3)],
  ["A", box(234.1, 252.5, 533.3, 558.8)],
  ["K", box(248.4, 271.6, 525.9, 555.9)],
];

describe("joinLetteringRuns", () => {
  it("joins lettering drawn one glyph per element into words", () => {
    const root = svg();
    whitespace(root);
    for (const [value, rect] of RUMBLE_TUMBLE) {
      text(root, value, rect);
      whitespace(root);
    }

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "\nRumble\n \ntumble,\n \ngo.\nDa\n");
  });

  it("keeps punctuation set in its own element on its word", () => {
    const root = svg();
    text(root, "Chop", box(315, 381, 250, 290));
    whitespace(root);
    text(root, "!", box(382, 392, 248, 288));

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "Chop!");
  });

  it("keeps words that stand apart as separate words", () => {
    const root = svg();
    text(root, "Chop", box(100, 166, 250, 290));
    whitespace(root);
    text(root, "Chop", box(180, 246, 250, 290));

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "Chop\nChop");
  });

  it("separates elements written back to back when they do not touch", () => {
    const root = svg();
    text(root, "go.", box(680, 750, 200, 272));
    text(root, "Da", box(198, 270, 195, 258));

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "go.\nDa");
  });

  it("keeps letter-spaced lettering written back to back as one word", () => {
    const root = svg();
    let left = 100;
    for (const letter of "CHAPTER") {
      text(root, letter, box(left, left + 40, 100, 160));
      left += 52;
    }

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "CHAPTER");
  });

  it("does not join across another element", () => {
    const root = svg();
    text(root, "R", box(169, 220, 104, 180));
    whitespace(root);
    element(root, "path");
    whitespace(root);
    text(root, "u", box(205, 251, 100, 175));

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "R\n\nu");
  });

  it("joins a glyph to the rest of its word grouped beside it", () => {
    const root = svg();
    const [first, ...rest] = CREEAAK;
    text(root, ...first);
    whitespace(root);
    const letters = group(root);
    whitespace(letters);
    for (const [value, rect] of rest) {
      text(letters, value, rect);
    }
    whitespace(letters);
    whitespace(root);

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "CREEAAK\n\n");
  });

  for (const [word, glyphs] of Object.entries(I_PLAY)) {
    it(`joins "${word}" set one HTML block per glyph`, () => {
      const root = node("div", XHTML);
      whitespace(root, "\r\n");
      const blocks = glyphs.map(([value, rect]) => {
        const glyph = block(root, value, rect);
        whitespace(root, "\r\n");
        return glyph;
      });

      joinLetteringRuns(documentWith(root));

      assert.equal(textOf(root), `\r\n${word}\r\n`);
      assert.deepEqual(
        blocks.map(continuesJoinedWord),
        blocks.map((_, index) => index > 0)
      );
    });
  }

  it("keeps the drawn space between inline glyphs", () => {
    const root = node("div", XHTML);
    block(root, "r", box(208.8, 250.4, 495.8, 577.4), "inline");
    whitespace(root, " ");
    block(root, "u", box(244.6, 302.1, 498.7, 582.2), "inline-block");

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "r u");
  });

  it("leaves blocks written back to back as they read", () => {
    const root = node("div", XHTML);
    block(root, "Title", box(100, 300, 100, 140));
    block(root, "Author", box(100, 300, 160, 200));

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "TitleAuthor");
  });

  it("keeps stacked blocks as separate words", () => {
    const root = node("div", XHTML);
    block(root, "Title", box(100, 300, 100, 140));
    whitespace(root);
    block(root, "Author", box(100, 300, 160, 200));

    joinLetteringRuns(documentWith(root));

    assert.equal(textOf(root), "Title\nAuthor");
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
