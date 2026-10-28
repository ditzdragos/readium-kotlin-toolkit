import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decorationPlacements } from "../src/decorationPlacements.mjs";

const OVERLAY_BOX = { rect: { left: 1 }, rotationAngle: 7 };
const SVG_LINE_BOX = { rect: { left: 2 }, rotationAngle: 15 };
const CLIENT_RECT = { left: 3 };

function sources({ overlayBoxes = [], svgLineBoxes = [] } = {}) {
  const asked = [];
  return {
    asked,
    overlayBoxes,
    svgLineBoxes: () => {
      asked.push("svgLineBoxes");
      return svgLineBoxes;
    },
    clientRects: () => {
      asked.push("clientRects");
      return [CLIENT_RECT];
    },
  };
}

const UNDERLINE = { width: "wrap", layout: "lines" };

describe("decorationPlacements", () => {
  it("places a wrap decoration on an OCR overlay's boxes before anything else", () => {
    const from = sources({
      overlayBoxes: [OVERLAY_BOX],
      svgLineBoxes: [SVG_LINE_BOX],
    });

    assert.deepEqual(decorationPlacements(UNDERLINE, from), [
      { rect: OVERLAY_BOX.rect, turnedBox: OVERLAY_BOX },
    ]);
    assert.deepEqual(from.asked, []);
  });

  it("places an underline on SVG lettering on its turned line boxes", () => {
    const from = sources({ svgLineBoxes: [SVG_LINE_BOX] });

    assert.deepEqual(decorationPlacements(UNDERLINE, from), [
      { rect: SVG_LINE_BOX.rect, turnedBox: SVG_LINE_BOX },
    ]);
    assert.deepEqual(from.asked, ["svgLineBoxes"]);
  });

  it("falls back to client rects when the lettering gives no boxes", () => {
    const from = sources();

    assert.deepEqual(decorationPlacements(UNDERLINE, from), [
      { rect: CLIENT_RECT, turnedBox: undefined },
    ]);
  });

  it("keeps box decorations on client rects, even on SVG lettering", () => {
    const from = sources({ svgLineBoxes: [SVG_LINE_BOX] });

    decorationPlacements({ width: "wrap", layout: "boxes" }, from);

    assert.deepEqual(from.asked, ["clientRects"]);
  });

  it("keeps decorations that span the viewport on client rects, turned like their overlay", () => {
    const from = sources({
      overlayBoxes: [OVERLAY_BOX],
      svgLineBoxes: [SVG_LINE_BOX],
    });

    assert.deepEqual(
      decorationPlacements({ width: "viewport", layout: "lines" }, from),
      [{ rect: CLIENT_RECT, turnedBox: OVERLAY_BOX }]
    );
    assert.deepEqual(from.asked, ["clientRects"]);
  });
});
