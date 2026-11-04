//
//  Copyright 2025 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

import { faceKey } from "./fxlFontFit.mjs";

const CLONE_FACES = [
  { file: "NimbusRoman.woff2", weight: "400", style: "normal" },
  { file: "NimbusRoman-Italic.woff2", weight: "400", style: "italic" },
  { file: "NimbusRoman-Bold.woff2", weight: "700", style: "normal" },
  { file: "NimbusRoman-BoldItalic.woff2", weight: "700", style: "italic" },
];

/*
 * `needed` holds the weight/slope combinations the page actually draws in this
 * family, so the faces it never uses are neither fetched nor decoded. It is
 * gathered from every line wearing the family rather than from the sampled
 * ones: registering a family without the bold face a line elsewhere on the page
 * asks for would hand that line a synthetically emboldened regular, whose
 * metrics are not the clone's and not the artwork's.
 */
function cloneFaces(family, directory, needed) {
  const faces = new Map();
  for (const face of CLONE_FACES) {
    const key = faceKey(face);
    if (!needed.has(key)) {
      continue;
    }
    let fontFace;
    try {
      fontFace = new FontFace(family, 'url("' + directory + face.file + '")', {
        weight: face.weight,
        style: face.style,
        display: "swap",
      });
    } catch (error) {
      continue;
    }
    document.fonts.add(fontFace);
    faces.set(key, fontFace);
  }
  return faces;
}

/*
 * RR-9372: faces decoded for measuring are renamed to a family that wins rather
 * than fetched and decoded again, and re-added so the set indexes them under it.
 */
export function measurementFaces(family, directory, needed) {
  const unclaimed = cloneFaces(family, directory, needed);
  return {
    loaded: loadAll(unclaimed.values()),
    claim(owner, keys) {
      const claimed = [];
      const missing = new Set();
      for (const key of keys) {
        const face = unclaimed.get(key);
        if (face && rename(face, owner)) {
          unclaimed.delete(key);
          claimed.push(face);
        } else {
          missing.add(key);
        }
      }
      return claimed.concat(
        Array.from(cloneFaces(owner, directory, missing).values())
      );
    },
    release() {
      for (const face of unclaimed.values()) {
        document.fonts.delete(face);
      }
      unclaimed.clear();
    },
  };
}

function rename(face, family) {
  try {
    face.family = family;
  } catch (error) {
    return false;
  }
  document.fonts.delete(face);
  document.fonts.add(face);
  return true;
}

export function loadAll(faces) {
  return Promise.all(Array.from(faces, (face) => face.load().catch(() => {})));
}
