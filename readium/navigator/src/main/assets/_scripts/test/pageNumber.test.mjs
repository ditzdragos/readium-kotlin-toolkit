import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isDrawnOutOfTextOrder,
  isPageNumberText,
  isTitleNumber,
  isExplicitPageBreak,
  isOcrOverlayNumber,
  shouldSkipPageNumber,
} from "../src/pageNumber.mjs";

const EPUB_OPS_NAMESPACE = "http://www.idpf.org/2007/ops";

function element(
  tagName,
  { text = "", attributes = {}, parent = null, className = "" } = {}
) {
  return {
    tagName: tagName.toUpperCase(),
    textContent: text,
    parentElement: parent,
    className,
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

/**
 * Rects of "DK Super Readers: Ocean Animals" (9780744073003), page006.xhtml,
 * read off a device: the folio "4" is the first span of the page's text but is
 * printed in the bottom band, under the prose that follows it (RR-7607).
 */
const OCEAN_ANIMALS_FOLIO = { top: 2049, bottom: 2093 };
const OCEAN_ANIMALS_FIRST_LINE = { top: 1705, bottom: 1797 };
const LINE_BELOW_A_HEADING = { top: 260, bottom: 300 };
const HEADING_NUMBER = { top: 200, bottom: 240 };

describe("isDrawnOutOfTextOrder", () => {
  it("is true of a number drawn below the text that follows it", () => {
    assert.equal(
      isDrawnOutOfTextOrder({
        rect: OCEAN_ANIMALS_FOLIO,
        previousRect: null,
        nextRect: OCEAN_ANIMALS_FIRST_LINE,
      }),
      true
    );
  });

  it("is true of a number drawn above the text that precedes it", () => {
    assert.equal(
      isDrawnOutOfTextOrder({
        rect: HEADING_NUMBER,
        previousRect: LINE_BELOW_A_HEADING,
        nextRect: null,
      }),
      true
    );
  });

  it("is false of a number drawn above the text that follows it", () => {
    assert.equal(
      isDrawnOutOfTextOrder({
        rect: HEADING_NUMBER,
        previousRect: null,
        nextRect: LINE_BELOW_A_HEADING,
      }),
      false
    );
  });

  it("is false of a number on the same line as its neighbours", () => {
    const line = { top: 100, bottom: 140 };
    assert.equal(
      isDrawnOutOfTextOrder({
        rect: { top: 102, bottom: 138 },
        previousRect: line,
        nextRect: line,
      }),
      false
    );
  });

  it("is false without neighbours", () => {
    assert.equal(
      isDrawnOutOfTextOrder({
        rect: OCEAN_ANIMALS_FOLIO,
        previousRect: null,
        nextRect: null,
      }),
      false
    );
  });
});

describe("shouldSkipPageNumber on a fixed-layout page", () => {
  it("skips a folio that opens the page text but is printed under it (RR-7607)", () => {
    const span = element("span", { text: "4" });

    assert.equal(
      shouldSkipPageNumber({
        text: "4",
        before: "",
        after: " Many animals live in  the ocean.",
        element: span,
        isAtTopOrBottom: true,
        isDrawnOutOfTextOrder: true,
      }),
      true
    );
  });

  it("keeps a number that opens the page text where it is drawn", () => {
    const span = element("span", { text: "4" });

    assert.equal(
      shouldSkipPageNumber({
        text: "4",
        before: "",
        after: " Many animals live in  the ocean.",
        element: span,
        isAtTopOrBottom: true,
        isDrawnOutOfTextOrder: false,
      }),
      false
    );
  });

  it("keeps a number drawn out of order inside a longer element", () => {
    const span = element("span", { text: "There were 4 of them." });

    assert.equal(
      shouldSkipPageNumber({
        text: "4",
        before: "There were ",
        after: " of them.",
        element: span,
        isAtTopOrBottom: true,
        isDrawnOutOfTextOrder: true,
      }),
      false
    );
  });

  it("keeps a chapter number drawn out of order", () => {
    const heading = element("h1", { text: "4" });

    assert.equal(
      shouldSkipPageNumber({
        text: "4",
        before: "",
        after: " Many animals",
        element: heading,
        isAtTopOrBottom: true,
        isDrawnOutOfTextOrder: true,
      }),
      false
    );
  });
});

/**
 * The markup below is the chapter opener of "Eerie Elementary #1: The School is
 * Alive!" (9780545623940), page_0020.xhtml, read off a device: a scanned page
 * whose every word is its own invisible overlay over the page image. The "3" of
 * the chapter heading is printed at 13% of the page height, inside the top band.
 */
function ocrOverlay(text) {
  const body = element("body", { text, className: "even book-type-fixed" });
  const image = element("div", {
    text,
    className: "image-container",
    parent: body,
  });
  const container = element("div", {
    text,
    className: "ocr-container",
    parent: image,
  });
  return element("div", { text, className: "text-overlay", parent: container });
}

describe("isOcrOverlayNumber", () => {
  it("matches a text overlay inside an OCR container", () => {
    assert.equal(isOcrOverlayNumber(ocrOverlay("3")), true);
  });

  it("ignores an overlay that is not part of an OCR layer", () => {
    const div = element("div", { text: "3", className: "text-overlay" });
    assert.equal(isOcrOverlayNumber(div), false);
  });

  it("ignores ordinary markup", () => {
    assert.equal(isOcrOverlayNumber(element("p", { text: "23" })), false);
  });
});

describe("shouldSkipPageNumber in a scanned picture book", () => {
  it("reads the chapter numeral of an OCR page (RR-7944)", () => {
    assert.equal(
      shouldSkipPageNumber({
        text: "3",
        before: "tick TOCK, tick TOCK\n",
        after: "\nSam slammed his locker shut.",
        element: ocrOverlay("3"),
        isAtTopOrBottom: true,
      }),
      false
    );
  });

  it("still skips a number the publication marks as a page break", () => {
    const overlay = ocrOverlay("3");
    overlay.getAttribute = (name) =>
      name === "epub:type" ? "pagebreak" : null;

    assert.equal(
      shouldSkipPageNumber({
        text: "3",
        before: "",
        after: "",
        element: overlay,
        isAtTopOrBottom: true,
      }),
      true
    );
  });
});
