import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scrollPageLeft, scrollPageRight } from "../src/pageScroll.mjs";

const PAGE = 384;

function scrollingElement({ scrollWidth, scrollLeft = 0, rtl = false }) {
  const maxScroll = scrollWidth - PAGE;
  let offset = scrollLeft;
  return {
    scrollWidth,
    get scrollLeft() {
      return offset;
    },
    set scrollLeft(value) {
      offset = rtl
        ? Math.min(0, Math.max(-maxScroll, value))
        : Math.max(0, Math.min(maxScroll, value));
    },
  };
}

describe("scrollPageRight", () => {
  it("turns onto the last page and reports it", () => {
    const element = scrollingElement({
      scrollWidth: 3 * PAGE,
      scrollLeft: PAGE,
    });

    assert.equal(scrollPageRight(element, PAGE, false), true);
    assert.equal(element.scrollLeft, 2 * PAGE);
  });

  it("reports the end of the resource on the last page", () => {
    const element = scrollingElement({
      scrollWidth: 3 * PAGE,
      scrollLeft: 2 * PAGE,
    });

    assert.equal(scrollPageRight(element, PAGE, false), false);
    assert.equal(element.scrollLeft, 2 * PAGE);
  });

  it("reports the end when the width leaves a sliver past the last page", () => {
    const element = scrollingElement({
      scrollWidth: 3 * PAGE + 8,
      scrollLeft: 2 * PAGE,
    });

    assert.equal(scrollPageRight(element, PAGE, false), false);
    assert.equal(element.scrollLeft, 2 * PAGE);
  });

  it("reports the end when parked past the last snapped page", () => {
    const element = scrollingElement({
      scrollWidth: 3 * PAGE + 8,
      scrollLeft: 2 * PAGE + 8,
    });

    assert.equal(scrollPageRight(element, PAGE, false), false);
  });

  it("turns toward zero in right-to-left books", () => {
    const element = scrollingElement({
      scrollWidth: 3 * PAGE,
      scrollLeft: -PAGE,
      rtl: true,
    });

    assert.equal(scrollPageRight(element, PAGE, true), true);
    assert.equal(element.scrollLeft, 0);
    assert.equal(scrollPageRight(element, PAGE, true), false);
  });
});

describe("scrollPageLeft", () => {
  it("turns back onto the first page and reports it", () => {
    const element = scrollingElement({
      scrollWidth: 3 * PAGE,
      scrollLeft: PAGE,
    });

    assert.equal(scrollPageLeft(element, PAGE, false), true);
    assert.equal(element.scrollLeft, 0);
  });

  it("reports the start of the resource on the first page", () => {
    const element = scrollingElement({ scrollWidth: 3 * PAGE, scrollLeft: 0 });

    assert.equal(scrollPageLeft(element, PAGE, false), false);
  });

  it("reports the end of a right-to-left resource", () => {
    const element = scrollingElement({
      scrollWidth: 3 * PAGE,
      scrollLeft: -2 * PAGE,
      rtl: true,
    });

    assert.equal(scrollPageLeft(element, PAGE, true), false);
    assert.equal(element.scrollLeft, -2 * PAGE);
  });
});
