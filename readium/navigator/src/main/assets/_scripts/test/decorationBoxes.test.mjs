import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decorationBox } from "../src/decorationBoxes.mjs";

function fakeDocument() {
  return {
    createElement(tagName) {
      return { tagName: tagName.toUpperCase(), style: {}, dataset: {} };
    },
  };
}

describe("decorationBox (RR-6457)", () => {
  it("is a div whose inline margin outranks a book's `div { margin }` rule", () => {
    const box = decorationBox(fakeDocument());

    assert.equal(box.tagName, "DIV");
    assert.equal(box.style.margin, "0px");
  });
});
