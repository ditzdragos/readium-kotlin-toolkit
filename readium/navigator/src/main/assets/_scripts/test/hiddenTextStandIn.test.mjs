import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hiddenTextStandIn } from "../src/hiddenTextStandIn.mjs";

const SHOWN = { overflow: "visible", width: "559px", height: "50px" };
const CLIPPED = { overflow: "hidden", width: "1px", height: "1px" };

function element({ style = SHOWN, text = "", alt, children = [] } = {}) {
  const node = { style, textContent: text, alt, children, parentElement: null };
  for (const child of children) {
    child.parentElement = node;
  }
  node.querySelectorAll = (selector) => {
    assert.equal(selector, "img[alt]");
    const images = [];
    const visit = (parent) => {
      for (const child of parent.children) {
        if (child.alt !== undefined) images.push(child);
        visit(child);
      }
    };
    visit(node);
    return images;
  };
  return node;
}

function chapter({ headingText, alt }) {
  const heading = element({ style: CLIPPED, text: headingText });
  const image = element({ alt });
  const body = element({
    children: [heading, element({ children: [element({ children: [image] })] })],
  });
  const document = { body };
  for (const node of [body, heading, image]) {
    node.ownerDocument = document;
  }
  return { heading, image, body };
}

function countingStyle() {
  const asked = [];
  return {
    asked,
    getStyle(node) {
      asked.push(node);
      return node.style;
    },
  };
}

describe("hiddenTextStandIn", () => {
  it("finds the image whose alt reads the clipped heading", () => {
    const { heading, image } = chapter({
      headingText: "CHAPTER ONE:\n MICKEY PRIMA",
      alt: "Chapter One: Mickey Prima",
    });

    assert.equal(hiddenTextStandIn(heading, countingStyle().getStyle), image);
  });

  it("has no stand-in when no image reads the clipped text", () => {
    const { heading } = chapter({
      headingText: "CHAPTER ONE",
      alt: "A sleeping cat",
    });

    assert.equal(hiddenTextStandIn(heading, countingStyle().getStyle), null);
  });

  it("has no stand-in for text that is shown", () => {
    const { body } = chapter({ headingText: "ONE", alt: "ONE" });
    const paragraph = element({ text: "ONE" });
    paragraph.ownerDocument = body.ownerDocument;
    body.children.push(paragraph);
    paragraph.parentElement = body;

    assert.equal(hiddenTextStandIn(paragraph, countingStyle().getStyle), null);
  });

  it("reads each element's style once across words", () => {
    const { heading, image } = chapter({ headingText: "ONE", alt: "ONE" });
    const word = element({ text: "ONE" });
    word.parentElement = heading;
    word.ownerDocument = heading.ownerDocument;
    const styles = countingStyle();

    assert.equal(hiddenTextStandIn(word, styles.getStyle), image);
    assert.equal(hiddenTextStandIn(word, styles.getStyle), image);
    assert.deepEqual(styles.asked, [word, heading]);
  });
});
