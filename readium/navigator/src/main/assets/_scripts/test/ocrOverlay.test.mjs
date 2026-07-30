import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getClosestRotationDegrees,
  ocrOverlayGeometry,
  rotationDegreesFromTransform,
} from "../src/ocrOverlay.mjs";

globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

globalThis.DOMMatrixReadOnly = class {
  constructor(transform) {
    const values = transform.match(/matrix\(([^)]+)\)/);
    if (!values) {
      throw new Error(`unsupported transform: ${transform}`);
    }
    const [a, b] = values[1].split(",").map((v) => parseFloat(v));
    this.a = a;
    this.b = b;
  }
};

globalThis.window = {
  getComputedStyle: (element) => element.computedStyle ?? { transform: "none" },
};

function element({ className = "", transform = "", parent = null } = {}) {
  const el = {
    nodeType: 1,
    className,
    parentElement: parent,
    style: { transform },
    computedStyle: { transform: transform || "none" },
  };
  el.closest = (selector) => {
    const wanted = selector.replace(".", "");
    let current = el;
    while (current) {
      if (current.className.split(" ").includes(wanted)) return current;
      current = current.parentElement;
    }
    return null;
  };
  return el;
}

function rangeInside(parent) {
  return { startContainer: { nodeType: 3, parentElement: parent } };
}

// "See You Later, Alligator" (9781510704855), page 004_Chapter001_0003.html,
// the word "I'll": a hand-lettered line sloping down to the right.
const OCR_BOX = { left: 256.8, top: 392, width: 42.9, height: 51.4 };

describe("rotationDegreesFromTransform", () => {
  it("reads the inline degrees form authored by OCR overlays", () => {
    assert.equal(rotationDegreesFromTransform("rotate(7.64402deg)"), 7.64402);
    assert.equal(rotationDegreesFromTransform("rotate(-3.5deg)"), -3.5);
  });

  it("recovers the angle from the computed matrix form", () => {
    const angle = rotationDegreesFromTransform(
      "matrix(0.991114, 0.133018, -0.133018, 0.991114, 0, 0)"
    );
    assert.ok(Math.abs(angle - 7.64402) < 0.001);
  });

  it("returns undefined when there is no rotation", () => {
    assert.equal(rotationDegreesFromTransform("none"), undefined);
    assert.equal(rotationDegreesFromTransform(""), undefined);
    assert.equal(
      rotationDegreesFromTransform("matrix(1, 0, 0, 1, 12, 30)"),
      undefined
    );
  });
});

describe("getClosestRotationDegrees", () => {
  it("stops at the boundary element", () => {
    const rotated = element({
      className: "ocr-container",
      transform: "rotate(4deg)",
    });
    const overlay = element({ className: "text-overlay", parent: rotated });

    assert.equal(getClosestRotationDegrees(overlay, overlay), undefined);
    assert.equal(getClosestRotationDegrees(overlay, rotated), 4);
  });
});

describe("ocrOverlayGeometry", () => {
  it("offers the overlay box and its rotation for an unwrapped word", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({
      className: "text-overlay",
      transform: "rotate(7.64402deg)",
      parent: container,
    });

    const geometry = ocrOverlayGeometry(rangeInside(overlay), OCR_BOX, 1);

    assert.deepEqual(geometry.box, OCR_BOX);
    assert.equal(geometry.rotationAngle, 7.64402);
  });

  it("withholds the box once the invisible text has wrapped", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({
      className: "text-overlay",
      transform: "rotate(7.64402deg)",
      parent: container,
    });

    const geometry = ocrOverlayGeometry(rangeInside(overlay), OCR_BOX, 3);

    assert.equal(geometry.box, null);
    assert.equal(geometry.rotationAngle, 7.64402);
  });

  it("reports no rotation for an upright overlay", () => {
    const container = element({ className: "ocr-container" });
    const overlay = element({ className: "text-overlay", parent: container });

    const geometry = ocrOverlayGeometry(rangeInside(overlay), OCR_BOX, 1);

    assert.deepEqual(geometry.box, OCR_BOX);
    assert.equal(geometry.rotationAngle, undefined);
  });

  it("stays out of the way of ordinary reflowable text", () => {
    const paragraph = element({ className: "chapter" });

    const geometry = ocrOverlayGeometry(rangeInside(paragraph), null, 1);

    assert.equal(geometry.box, null);
    assert.equal(geometry.rotationAngle, undefined);
  });
});
