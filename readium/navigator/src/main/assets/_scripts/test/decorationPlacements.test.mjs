import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decorationPlacements } from "../src/decorationPlacements.mjs";

const OVERLAY_BOX = { rect: { left: 1 }, rotationAngle: 7 };
const LETTERING_LINE_BOX = { rect: { left: 2 }, rotationAngle: 15 };
const CLIENT_RECT = { left: 3 };
const DISPLAY_RECT = { left: 4 };

function sources({
  overlayBoxes = [],
  displayRect = null,
  letteringLineBoxes = [],
} = {}) {
  const asked = [];
  return {
    asked,
    overlayBoxes,
    displayRect,
    letteringLineBoxes: () => {
      asked.push("letteringLineBoxes");
      return letteringLineBoxes;
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
      letteringLineBoxes: [LETTERING_LINE_BOX],
    });

    assert.deepEqual(decorationPlacements(UNDERLINE, from), [
      { rect: OVERLAY_BOX.rect, turnedBox: OVERLAY_BOX },
    ]);
    assert.deepEqual(from.asked, []);
  });

  it("places an underline on lettering on its turned line boxes", () => {
    const from = sources({ letteringLineBoxes: [LETTERING_LINE_BOX] });

    assert.deepEqual(decorationPlacements(UNDERLINE, from), [
      { rect: LETTERING_LINE_BOX.rect, turnedBox: LETTERING_LINE_BOX },
    ]);
    assert.deepEqual(from.asked, ["letteringLineBoxes"]);
  });

  it("falls back to client rects when the lettering gives no boxes", () => {
    const from = sources();

    assert.deepEqual(decorationPlacements(UNDERLINE, from), [
      { rect: CLIENT_RECT, turnedBox: undefined },
    ]);
  });

  it("places a read highlight on lettering on its turned line boxes", () => {
    const from = sources({ letteringLineBoxes: [LETTERING_LINE_BOX] });

    assert.deepEqual(
      decorationPlacements({ width: "wrap", layout: "boxes" }, from),
      [{ rect: LETTERING_LINE_BOX.rect, turnedBox: LETTERING_LINE_BOX }]
    );
    assert.deepEqual(from.asked, ["letteringLineBoxes"]);
  });

  it("keeps decorations that span the viewport on client rects, turned like their overlay", () => {
    const from = sources({
      overlayBoxes: [OVERLAY_BOX],
      letteringLineBoxes: [LETTERING_LINE_BOX],
    });

    assert.deepEqual(
      decorationPlacements({ width: "viewport", layout: "lines" }, from),
      [{ rect: CLIENT_RECT, turnedBox: OVERLAY_BOX }]
    );
    assert.deepEqual(from.asked, ["clientRects"]);
  });

  it("places a decoration on display type on its ink, not its lettering or client rects", () => {
    const from = sources({
      displayRect: DISPLAY_RECT,
      letteringLineBoxes: [LETTERING_LINE_BOX],
    });

    assert.deepEqual(decorationPlacements(UNDERLINE, from), [
      { rect: DISPLAY_RECT, turnedBox: undefined },
    ]);
    assert.deepEqual(
      decorationPlacements({ width: "bounds", layout: "boxes" }, from),
      [{ rect: DISPLAY_RECT, turnedBox: undefined }]
    );
    assert.deepEqual(from.asked, []);
  });

  it("keeps an OCR overlay's boxes over a display rect", () => {
    const from = sources({
      overlayBoxes: [OVERLAY_BOX],
      displayRect: DISPLAY_RECT,
    });

    assert.deepEqual(decorationPlacements(UNDERLINE, from), [
      { rect: OVERLAY_BOX.rect, turnedBox: OVERLAY_BOX },
    ]);
  });
});
