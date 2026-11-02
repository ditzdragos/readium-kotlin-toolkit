import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ocrReferenceRect } from "../src/ocrOverlay.mjs";

globalThis.window = {
  getComputedStyle: (element) => element.computedStyle,
};

function element({ rect, background = null, children = [], img = null }) {
  const el = {
    children,
    parentElement: null,
    clientLeft: 0,
    clientTop: 0,
    computedStyle: {
      backgroundImage: background ? 'url("page.jpg")' : "none",
      backgroundSize: background?.size ?? "auto",
      backgroundPosition: background?.position ?? "0% 0%",
    },
    getBoundingClientRect: () => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }),
    querySelector: (selector) => (selector === "img" ? img : null),
  };
  children.forEach((child) => (child.parentElement = el));
  return el;
}

function collapsedContainer(page) {
  return element({
    rect: { left: page.left, top: page.top, width: 0, height: 717 },
    children: [page],
  });
}

function boxOf(rect) {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

describe("ocrReferenceRect", () => {
  // "Lucy Fell Down the Mountain" (9781466898790) lays its back cover out as a
  // full 1108x717 spread whose artwork is a 554x717 background centred in it.
  // The OCR percentages are relative to that artwork, not to the spread
  // (RR-8804).
  it("uses the artwork a cover page centres in its spread", () => {
    const page = element({
      rect: { left: 10, top: 20, width: 1108, height: 717 },
      background: { size: "554px 717px", position: "50% 50%" },
    });

    assert.deepEqual(boxOf(ocrReferenceRect(collapsedContainer(page))), {
      left: 10 + 277,
      top: 20,
      width: 554,
      height: 717,
    });
  });

  it("places artwork at a pixel offset inside the page", () => {
    const page = element({
      rect: { left: 0, top: 0, width: 1108, height: 717 },
      background: { size: "554px 717px", position: "40px 0px" },
    });

    assert.deepEqual(boxOf(ocrReferenceRect(collapsedContainer(page))), {
      left: 40,
      top: 0,
      width: 554,
      height: 717,
    });
  });

  it("keeps the page box when the artwork fills the spread", () => {
    const page = element({
      rect: { left: 0, top: 0, width: 1108, height: 717 },
      background: { size: "1108px 717px", position: "0% 0%" },
    });

    assert.deepEqual(boxOf(ocrReferenceRect(collapsedContainer(page))), {
      left: 0,
      top: 0,
      width: 1108,
      height: 717,
    });
  });

  it("keeps the page box when the artwork size depends on the image", () => {
    const page = element({
      rect: { left: 0, top: 0, width: 1108, height: 717 },
      background: { size: "contain", position: "50% 50%" },
    });

    assert.deepEqual(boxOf(ocrReferenceRect(collapsedContainer(page))), {
      left: 0,
      top: 0,
      width: 1108,
      height: 717,
    });
  });

  it("keeps the page box when the page draws no artwork", () => {
    const page = element({
      rect: { left: 0, top: 0, width: 792, height: 1152 },
    });

    assert.deepEqual(boxOf(ocrReferenceRect(collapsedContainer(page))), {
      left: 0,
      top: 0,
      width: 792,
      height: 1152,
    });
  });

  it("prefers the page image when there is one", () => {
    const img = element({ rect: { left: 5, top: 6, width: 600, height: 800 } });
    const container = element({
      rect: { left: 0, top: 0, width: 600, height: 800 },
      img,
    });

    assert.deepEqual(boxOf(ocrReferenceRect(container)), {
      left: 5,
      top: 6,
      width: 600,
      height: 800,
    });
  });
});
