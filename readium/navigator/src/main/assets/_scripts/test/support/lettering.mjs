// The transforms page003 of "With All My Heart, I Love You" (9781338747836) places "tumble,"
// with, in its SVG's user units; the SVG draws them at twice that size.
export const TUMBLE = [
  [0.9894, 0.1452, -0.1452, 0.9894, 96.5546, 27.5771],
  [0.9775, 0.2108, -0.2108, 0.9775, 104.8498, 28.7334],
  [0.9496, 0.3135, -0.3135, 0.9496, 118.5258, 31.5928],
  [0.9269, 0.3753, -0.3753, 0.9269, 138.0346, 38.2382],
  [0.9154, 0.4025, -0.4025, 0.9154, 149.7128, 43.0489],
  [0.9082, 0.4186, -0.4186, 0.9082, 156.1958, 45.8936],
  [0.9058, 0.4237, -0.4237, 0.9058, 168.0928, 51.4002],
];
export const ASCENT = 27;
export const DESCENT = 7;
export const SVG_SCALE = 2;

/** Each glyph's box spans its advance to the next glyph. */
export function advances(matrices) {
  return matrices.map((matrix, index) => {
    const next = matrices[index + 1];
    return next ? Math.hypot(next[4] - matrix[4], next[5] - matrix[5]) : 7.5;
  });
}

export function degrees([a, b]) {
  return (Math.atan2(b, a) * 180) / Math.PI;
}

/** The corners of a glyph's box on screen, as a test oracle independent of the code under test. */
export function placedGlyph([a, b, c, d, e, f], advance, ascent = ASCENT) {
  const onScreen = (x, y) => ({
    x: SVG_SCALE * (a * x + c * y + e),
    y: SVG_SCALE * (b * x + d * y + f),
  });
  return {
    corners: [
      onScreen(0, -ascent),
      onScreen(advance, -ascent),
      onScreen(advance, DESCENT),
      onScreen(0, DESCENT),
    ],
  };
}

export function curvedWord(matrices) {
  const widths = advances(matrices);
  return matrices.map((matrix, index) => placedGlyph(matrix, widths[index]));
}

export function uprightBox(glyph) {
  const xs = glyph.corners.map((corner) => corner.x);
  const ys = glyph.corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/** Where [point] sits relative to the centre of a turned box, along and across its turn. */
export function inTurnedFrame(box, point) {
  const angle = (box.rotationAngle * Math.PI) / 180;
  const centreX = box.rect.left + box.rect.width / 2;
  const centreY = box.rect.top + box.rect.height / 2;
  const dx = point.x - centreX;
  const dy = point.y - centreY;
  return {
    along: dx * Math.cos(angle) + dy * Math.sin(angle),
    across: -dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

export function assertReachesEveryCorner(assert, box, glyphs) {
  for (const glyph of glyphs) {
    for (const corner of glyph.corners) {
      const { along, across } = inTurnedFrame(box, corner);
      assert.ok(Math.abs(along) <= box.rect.width / 2 + 0.01);
      assert.ok(Math.abs(across) <= box.rect.height / 2 + 0.01);
    }
  }
}
