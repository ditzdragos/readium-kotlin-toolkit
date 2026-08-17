import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isOutsideViewport,
  isTooFarToLayOut,
} from "../src/offscreenLayout.mjs";

const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 1500;

function rect({ left = 0, top = 0, width = 100, height = 20 }) {
  return { left, top, width, height };
}

describe("isOutsideViewport", () => {
  it("keeps a decoration that is on screen", () => {
    assert.equal(isOutsideViewport(rect({ left: 120, top: 300 })), false);
  });

  it("reports a decoration that ended before the left edge", () => {
    assert.equal(isOutsideViewport(rect({ left: -260, width: 100 })), true);
  });

  it("reports a decoration that ended above the top edge", () => {
    assert.equal(isOutsideViewport(rect({ top: -80, height: 20 })), true);
  });

  it("keeps a decoration straddling the left edge", () => {
    assert.equal(isOutsideViewport(rect({ left: -40, width: 100 })), false);
  });
});

describe("isTooFarToLayOut", () => {
  it("lays out a decoration that is on screen", () => {
    assert.equal(
      isTooFarToLayOut(rect({ left: 120 }), VIEWPORT_WIDTH, VIEWPORT_HEIGHT),
      false
    );
  });

  it("still lays out the page the reader can swipe back to", () => {
    const previousPage = rect({ left: -900, width: 100 });

    assert.equal(isOutsideViewport(previousPage), true);
    assert.equal(
      isTooFarToLayOut(previousPage, VIEWPORT_WIDTH, VIEWPORT_HEIGHT),
      false
    );
  });

  it("skips a decoration two pages back", () => {
    assert.equal(
      isTooFarToLayOut(
        rect({ left: -1900, width: 100 }),
        VIEWPORT_WIDTH,
        VIEWPORT_HEIGHT
      ),
      true
    );
  });

  it("still lays out the screen the reader can scroll back to", () => {
    assert.equal(
      isTooFarToLayOut(
        rect({ top: -1400, height: 20 }),
        VIEWPORT_WIDTH,
        VIEWPORT_HEIGHT
      ),
      false
    );
  });

  it("skips a decoration two screens up", () => {
    assert.equal(
      isTooFarToLayOut(
        rect({ top: -2900, height: 20 }),
        VIEWPORT_WIDTH,
        VIEWPORT_HEIGHT
      ),
      true
    );
  });

  it("lays out pages ahead of the reader however far they are", () => {
    assert.equal(
      isTooFarToLayOut(
        rect({ left: 9000, top: 9000 }),
        VIEWPORT_WIDTH,
        VIEWPORT_HEIGHT
      ),
      false
    );
  });
});
