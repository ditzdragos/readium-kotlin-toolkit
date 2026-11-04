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
export function cloneFaces(family, directory, needed) {
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

/* RR-9372: a measurement face is already decoded, so it is renamed rather than fetched and decoded again under the page's name. */
export function claimFaces(family, directory, needed, unclaimed) {
  const claimed = [];
  const missing = new Set(needed);
  for (const key of needed) {
    const face = unclaimed.get(key);
    if (!face) {
      continue;
    }
    unclaimed.delete(key);
    missing.delete(key);
    document.fonts.delete(face);
    face.family = family;
    document.fonts.add(face);
    claimed.push(face);
  }
  return missing.size === 0
    ? claimed
    : claimed.concat([...cloneFaces(family, directory, missing).values()]);
}

export function loadAll(faces) {
  return Promise.all(faces.map((face) => face.load().catch(() => {})));
}
