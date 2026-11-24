import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clipPageOverflow } from "../src/pageClip.mjs";

const TRANSPARENT = "rgba(0, 0, 0, 0)";

function element(computed = {}) {
  const attributes = new Set();
  const inline = {};
  return {
    computed: {
      overflowX: "visible",
      overflowY: "visible",
      backgroundColor: TRANSPARENT,
      backgroundImage: "none",
      ...computed,
      getPropertyValue(property) {
        return computed[property] ?? "";
      },
    },
    inline,
    style: {
      setProperty(property, value, priority) {
        inline[property] = `${value} !${priority}`;
      },
    },
    hasAttribute: (name) => attributes.has(name),
    setAttribute: (name) => attributes.add(name),
  };
}

function page({
  scrollWidth,
  viewport = "width=1224, height=1584",
  root = {},
  body = {},
}) {
  const html = element(root);
  const bodyElement = element(body);
  const meta = viewport === null ? null : { getAttribute: () => viewport };
  return {
    html,
    body: bodyElement,
    document: {
      documentElement: html,
      body: bodyElement,
      scrollingElement: { scrollWidth, clientWidth: 1224 },
      querySelector: () => meta,
    },
  };
}

const computedStyle = (element) => element.computed;

describe("clipPageOverflow", () => {
  it("leaves a page that fits its page box untouched", () => {
    const fitting = page({ scrollWidth: 1224, body: { overflowX: "hidden" } });

    assert.equal(clipPageOverflow(fitting.document, computedStyle), false);
    assert.deepEqual(fitting.html.inline, {});
    assert.deepEqual(fitting.body.inline, {});
  });

  it("contains the root of a page whose content runs past its page box", () => {
    const overflowing = page({ scrollWidth: 2022 });

    assert.equal(clipPageOverflow(overflowing.document, computedStyle), true);
    assert.equal(overflowing.html.inline.contain, "layout !important");
    assert.equal(overflowing.html.inline.height, "100% !important");
  });

  it("leaves a page with no declared page width to the viewport fit", () => {
    const undeclared = page({ scrollWidth: 2022, viewport: null });

    assert.equal(clipPageOverflow(undeclared.document, computedStyle), false);
    assert.deepEqual(undeclared.html.inline, {});
  });

  it("measures overflow against the declared page width", () => {
    const fitsItsBox = page({ scrollWidth: 1224, viewport: "width=1300" });
    const pastItsBox = page({ scrollWidth: 1224, viewport: "height=1584,width=1000" });

    assert.equal(clipPageOverflow(fitsItsBox.document, computedStyle), false);
    assert.equal(clipPageOverflow(pastItsBox.document, computedStyle), true);
  });

  it("keeps a body that hides its overflow visible once the root no longer takes its overflow", () => {
    const overflowing = page({
      scrollWidth: 2022,
      body: { overflowX: "hidden", overflowY: "hidden" },
    });

    clipPageOverflow(overflowing.document, computedStyle);

    assert.equal(overflowing.body.inline.overflow, "visible !important");
  });

  it("leaves the body overflow alone when the root sets its own", () => {
    const overflowing = page({
      scrollWidth: 2022,
      root: { overflowX: "hidden", overflowY: "hidden" },
      body: { overflowX: "hidden", overflowY: "hidden" },
    });

    clipPageOverflow(overflowing.document, computedStyle);

    assert.equal(overflowing.body.inline.overflow, undefined);
  });

  it("moves the body background to the root so it still fills the page", () => {
    const overflowing = page({
      scrollWidth: 2022,
      body: { "background-color": "rgb(255, 0, 0)" },
    });

    clipPageOverflow(overflowing.document, computedStyle);

    assert.equal(
      overflowing.html.inline["background-color"],
      "rgb(255, 0, 0) !important"
    );
    assert.equal(overflowing.body.inline.background, "none !important");
  });

  it("keeps the body background when the root paints its own", () => {
    const overflowing = page({
      scrollWidth: 2022,
      root: { backgroundColor: "rgb(0, 0, 255)" },
      body: { "background-color": "rgb(255, 0, 0)" },
    });

    clipPageOverflow(overflowing.document, computedStyle);

    assert.equal(overflowing.html.inline["background-color"], undefined);
    assert.equal(overflowing.body.inline.background, undefined);
  });

  it("clips a page once", () => {
    const overflowing = page({ scrollWidth: 2022 });

    clipPageOverflow(overflowing.document, computedStyle);

    assert.equal(clipPageOverflow(overflowing.document, computedStyle), false);
  });
});
