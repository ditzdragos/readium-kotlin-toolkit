//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { rectAt } from "./rangeRects.mjs";

/**
 * @typedef {Object} TurnedBox
 * @property {DOMRect} rect The box as it stands before the turn.
 * @property {number} [rotationAngle] The turn in degrees, clockwise about the box's centre.
 */

function sideways(corners) {
  const dx = corners[1].x - corners[0].x;
  const dy = corners[1].y - corners[0].y;
  const length = Math.hypot(dx, dy);
  return length > 0 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
}

/**
 * The way glyphs read: the mean of their own top edges. Upright glyphs of any size read level,
 * however their centres step; glyphs set along a curve read along its mean tangent.
 */
function readingDirection(glyphs) {
  let x = 0;
  let y = 0;
  for (const glyph of glyphs) {
    const edge = sideways(glyph.corners);
    x += edge.x;
    y += edge.y;
  }
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

/**
 * The box around glyphs set along one line, turned the way they read and reaching every corner
 * of every glyph. Each glyph is `{ corners }`, the four corners of its box on screen, clockwise
 * from its top left.
 *
 * @returns {TurnedBox}
 */
export function turnedBoxAround(glyphs) {
  const along = readingDirection(glyphs);
  const across = { x: -along.y, y: along.x };

  let alongMin = Infinity;
  let alongMax = -Infinity;
  let acrossMin = Infinity;
  let acrossMax = -Infinity;
  for (const glyph of glyphs) {
    for (const corner of glyph.corners) {
      const distanceAlong = corner.x * along.x + corner.y * along.y;
      const distanceAcross = corner.x * across.x + corner.y * across.y;
      alongMin = Math.min(alongMin, distanceAlong);
      alongMax = Math.max(alongMax, distanceAlong);
      acrossMin = Math.min(acrossMin, distanceAcross);
      acrossMax = Math.max(acrossMax, distanceAcross);
    }
  }

  const width = alongMax - alongMin;
  const height = acrossMax - acrossMin;
  const middleAlong = (alongMin + alongMax) / 2;
  const middleAcross = (acrossMin + acrossMax) / 2;
  const centreX = along.x * middleAlong + across.x * middleAcross;
  const centreY = along.y * middleAlong + across.y * middleAcross;
  return {
    rect: rectAt(centreX - width / 2, centreY - height / 2, width, height),
    rotationAngle: (Math.atan2(along.y, along.x) * 180) / Math.PI,
  };
}
