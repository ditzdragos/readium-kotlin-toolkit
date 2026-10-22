import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isTransparentColor,
  isUnfilledDuplicateLayer,
  normalizedText,
} from "../src/duplicateLayer.mjs";

const TRANSPARENT = "rgba(255, 255, 255, 0)";
const INK = "rgb(23, 60, 1)";

function rect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function element({ text, fill, box, parent = null, tagName = "DIV" }) {
  const node = {
    tagName,
    textContent: text,
    fill,
    parentElement: parent,
    children: [],
    getBoundingClientRect: () => box,
  };
  if (parent) parent.children.push(node);
  return node;
}

const fillColorOf = (node) => node.fill;

function arcticPage() {
  const body = element({
    text: "",
    fill: INK,
    box: rect(0, 0, 880, 880),
    tagName: "BODY",
  });
  const page = element({
    text: "",
    fill: INK,
    box: rect(0, 0, 880, 880),
    parent: body,
  });
  const line = element({
    text: "This layer of ice is",
    fill: INK,
    box: rect(55, 687, 251, 29),
    parent: page,
  });
  const outline = element({
    text: "called permafrost",
    fill: TRANSPARENT,
    box: rect(55, 726, 247, 29),
    parent: page,
  });
  const outlineWord = element({
    text: "permafrost",
    fill: TRANSPARENT,
    box: rect(144, 726, 157, 29),
    parent: outline,
    tagName: "SPAN",
  });
  const filled = element({
    text: "called permafrost.",
    fill: INK,
    box: rect(55, 726, 253, 29),
    parent: page,
  });
  const filledWord = element({
    text: "permafrost",
    fill: INK,
    box: rect(144, 726, 157, 29),
    parent: filled,
    tagName: "SPAN",
  });
  return { line, outline, outlineWord, filled, filledWord };
}

describe("isTransparentColor", () => {
  it("accepts a zero alpha and the transparent keyword", () => {
    assert.equal(isTransparentColor(TRANSPARENT), true);
    assert.equal(isTransparentColor("rgba(0 0 0 / 0)"), true);
    assert.equal(isTransparentColor("transparent"), true);
  });

  it("rejects painted colours", () => {
    assert.equal(isTransparentColor(INK), false);
    assert.equal(isTransparentColor("rgba(0, 0, 0, 0.5)"), false);
    assert.equal(isTransparentColor(undefined), false);
  });
});

describe("normalizedText", () => {
  it("ignores punctuation, case and spacing", () => {
    assert.equal(normalizedText(" Called  permafrost. "), "called permafrost");
  });
});

describe("isUnfilledDuplicateLayer", () => {
  it("skips the words of an outline stacked over the same filled line", () => {
    const { outline, outlineWord } = arcticPage();

    assert.equal(isUnfilledDuplicateLayer(outline, fillColorOf), true);
    assert.equal(isUnfilledDuplicateLayer(outlineWord, fillColorOf), true);
  });

  it("reads the filled copy and ordinary lines", () => {
    const { line, filled, filledWord } = arcticPage();

    assert.equal(isUnfilledDuplicateLayer(line, fillColorOf), false);
    assert.equal(isUnfilledDuplicateLayer(filled, fillColorOf), false);
    assert.equal(isUnfilledDuplicateLayer(filledWord, fillColorOf), false);
  });

  it("reads an unfilled line with no filled copy under it, such as an OCR overlay", () => {
    const body = element({
      text: "",
      fill: INK,
      box: rect(0, 0, 880, 880),
      tagName: "BODY",
    });
    const page = element({
      text: "",
      fill: INK,
      box: rect(0, 0, 880, 880),
      parent: body,
    });
    const overlay = element({
      text: "Once upon a time",
      fill: TRANSPARENT,
      box: rect(10, 10, 200, 20),
      parent: page,
    });

    assert.equal(isUnfilledDuplicateLayer(overlay, fillColorOf), false);
  });

  it("reads an unfilled line whose filled twin is elsewhere on the page", () => {
    const { outline, filled } = arcticPage();
    filled.getBoundingClientRect = () => rect(55, 400, 253, 29);

    assert.equal(isUnfilledDuplicateLayer(outline, fillColorOf), false);
  });
});
