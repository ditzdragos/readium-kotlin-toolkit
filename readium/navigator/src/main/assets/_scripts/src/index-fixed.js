//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Script used for fixed layouts resources.

import "./index";
import { applyFontFallback } from "./fxl-font-fallback";
import { rejoinSplitOcrWords } from "./ocrWordMerge.mjs";

window.readium.isFixedLayout = true;

/*
 * Rejoining runs first: it moves overlay boxes, and the font probe decides from
 * the box each word has to fit in.
 *
 * Nothing downstream waits on either — the overlay is corrected in place — so a
 * rejection here has nowhere to surface. Swallow it deliberately rather than
 * leaving an unhandled rejection: the page keeps whatever overlays it had.
 */
rejoinSplitOcrWords()
  .then(applyFontFallback)
  .catch(() => {});
