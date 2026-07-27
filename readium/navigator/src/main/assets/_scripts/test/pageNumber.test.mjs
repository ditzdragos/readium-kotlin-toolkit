import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isPageNumberText,
  isTitleNumber,
  isExplicitPageBreak,
  shouldSkipPageNumber,
} from "../src/pageNumber.mjs";

const EPUB_OPS_NAMESPACE = "http://www.idpf.org/2007/ops";

function element(tagName, { text = "", attributes = {}, parent = null } = {}) {
  return {
    tagName: tagName.toUpperCase(),
    textContent: text,
    parentElement: parent,
    getAttribute: (name) => attributes[name] ?? null,
    getAttributeNS: (namespace, name) =>
      namespace === EPUB_OPS_NAMESPACE
        ? attributes[`epub:${name}`] ?? null
        : null,
  };
}

describe("isPageNumberText", () => {
  it("accepts digits only", () => {
    assert.equal(isPageNumberText("12"), true);
    assert.equal(isPageNumberText("  7  "), true);
  });

  it("rejects anything else", () => {
    assert.equal(isPageNumberText("Chapter"), false);
    assert.equal(isPageNumberText("1a"), false);
    assert.equal(isPageNumberText(""), false);
    assert.equal(isPageNumberText(null), false);
  });
});

describe("isTitleNumber", () => {
  it("matches a heading ancestor", () => {
    const heading = element("h1", { text: "Chapter 1" });
    const span = element("span", { text: "1", parent: heading });
    assert.equal(isTitleNumber(span), true);
  });

  it("matches epub:type ordinal", () => {
    const span = element("span", {
      text: "1",
      attributes: { "epub:type": "ordinal" },
    });
    assert.equal(isTitleNumber(span), true);
  });

  it("matches role heading", () => {
    const div = element("div", { text: "1", attributes: { role: "heading" } });
    assert.equal(isTitleNumber(div), true);
  });

  it("ignores plain prose", () => {
    const paragraph = element("p", { text: "There were 3 of them." });
    assert.equal(isTitleNumber(paragraph), false);
  });

  it("ignores the chapter section itself", () => {
    const section = element("section", {
      text: "the whole chapter",
      attributes: { "epub:type": "chapter" },
    });
    const paragraph = element("p", { text: "23", parent: section });
    assert.equal(isTitleNumber(paragraph), false);
  });
});

describe("isExplicitPageBreak", () => {
  it("matches epub:type pagebreak", () => {
    const span = element("span", {
      text: "23",
      attributes: { "epub:type": "pagebreak" },
    });
    assert.equal(isExplicitPageBreak(span), true);
  });

  it("matches role doc-pagebreak", () => {
    const span = element("span", {
      text: "23",
      attributes: { role: "doc-pagebreak" },
    });
    assert.equal(isExplicitPageBreak(span), true);
  });
});

describe("shouldSkipPageNumber", () => {
  it("keeps the ordinal of a chapter title split into its own span (RR-7944)", () => {
    const heading = element("h1", { text: "Chapter 1" });
    const span = element("span", { text: "1", parent: heading });

    assert.equal(
      shouldSkipPageNumber({
        text: "1",
        before: "Chapter ",
        after: "\nThe school is alive!",
        element: span,
        isAtTopOrBottom: true,
      }),
      false
    );
  });

  it("keeps a chapter number that is the whole heading (RR-7944)", () => {
    const heading = element("h1", { text: "1" });

    assert.equal(
      shouldSkipPageNumber({
        text: "1",
        before: "",
        after: "\nThe School Is Alive",
        element: heading,
        isAtTopOrBottom: true,
      }),
      false
    );
  });

  it("keeps a number preceded by a word, whatever came earlier on the page (RR-7944)", () => {
    const paragraph = element("p", { text: "Chapter 1" });

    assert.equal(
      shouldSkipPageNumber({
        text: "1",
        before: "and the door swung shut.\n\nChapter ",
        after: "\n",
        element: paragraph,
        isAtTopOrBottom: true,
      }),
      false
    );
  });

  it("still skips a folio number alone under the text", () => {
    const paragraph = element("p", { text: "23" });

    assert.equal(
      shouldSkipPageNumber({
        text: "23",
        before: "and the door swung shut.\n\n",
        after: "\n",
        element: paragraph,
        isAtTopOrBottom: true,
      }),
      true
    );
  });

  it("still skips a folio number the publication marks as a page break, even in a heading", () => {
    const heading = element("h1", { text: "Chapter 1" });
    const span = element("span", {
      text: "23",
      attributes: { "epub:type": "pagebreak" },
      parent: heading,
    });

    assert.equal(
      shouldSkipPageNumber({
        text: "23",
        before: "",
        after: "\n",
        element: span,
        isAtTopOrBottom: true,
      }),
      true
    );
  });

  it("never skips a number in the body of the page", () => {
    const paragraph = element("p", { text: "23" });

    assert.equal(
      shouldSkipPageNumber({
        text: "23",
        before: "and the door swung shut.\n\n",
        after: "\n",
        element: paragraph,
        isAtTopOrBottom: false,
      }),
      false
    );
  });

  it("never skips a number inside a sentence", () => {
    const paragraph = element("p", { text: "There were 3 of them." });

    assert.equal(
      shouldSkipPageNumber({
        text: "3",
        before: "There were ",
        after: " of them.",
        element: paragraph,
        isAtTopOrBottom: true,
      }),
      false
    );
  });
});
