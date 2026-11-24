//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Script used for fixed layouts resources.

import "./index";
import { applyFontFallback } from "./fxl-font-fallback";
import { clipPageOverflow } from "./pageClip.mjs";

window.readium.isFixedLayout = true;

function clipPage() {
  clipPageOverflow(document, (element) => window.getComputedStyle(element));
}
document.addEventListener("DOMContentLoaded", clipPage);
window.addEventListener("load", clipPage);

/*
 * Nothing downstream waits on this — the overlay is corrected in place — so a
 * rejection here has nowhere to surface. Swallow it deliberately rather than
 * leaving an unhandled rejection: the page keeps whatever metrics it had.
 */
applyFontFallback()
  .catch(() => {})
  .then(clipPage);
