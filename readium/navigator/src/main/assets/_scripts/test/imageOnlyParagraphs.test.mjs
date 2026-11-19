import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IMAGE_ONLY_ATTRIBUTE,
  isImageOnlyParagraph,
  markImageOnlyParagraphs,
} from "../src/imageOnlyParagraphs.mjs";

function paragraph({ text = "", media = [] }) {
  const attributes = {};
  return {
    attributes,
    textContent: text,
    querySelector(selector) {
      const tags = selector.split(",").map((s) => s.trim());
      return media.find((tag) => tags.includes(tag)) ?? null;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };
}

function documentWith(paragraphs) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, "p");
      return paragraphs;
    },
  };
}

describe("isImageOnlyParagraph", () => {
  it("is true for a paragraph holding only an image", () => {
    assert.equal(isImageOnlyParagraph(paragraph({ media: ["img"] })), true);
  });

  it("is true for a paragraph holding only an svg and whitespace", () => {
    assert.equal(
      isImageOnlyParagraph(paragraph({ text: " \n\t", media: ["svg"] })),
      true
    );
  });

  it("is false for a paragraph with text beside its image", () => {
    assert.equal(
      isImageOnlyParagraph(
        paragraph({ text: "nce upon a time", media: ["img"] })
      ),
      false
    );
  });

  it("is false for a text paragraph", () => {
    assert.equal(isImageOnlyParagraph(paragraph({ text: "Chapter 1" })), false);
  });

  it("is false for an empty paragraph", () => {
    assert.equal(isImageOnlyParagraph(paragraph({})), false);
  });
});

describe("markImageOnlyParagraphs", () => {
  it("marks only the image-only paragraphs", () => {
    const picture = paragraph({ media: ["img"] });
    const dropCap = paragraph({ text: "nce upon a time", media: ["img"] });
    const text = paragraph({ text: "Once upon a time" });

    markImageOnlyParagraphs(documentWith([picture, dropCap, text]));

    assert.deepEqual(picture.attributes, { [IMAGE_ONLY_ATTRIBUTE]: "" });
    assert.deepEqual(dropCap.attributes, {});
    assert.deepEqual(text.attributes, {});
  });
});
