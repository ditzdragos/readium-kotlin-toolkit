//
//  Copyright 2021 Readium Foundation. All rights reserved.
//  Use of this source code is governed by the BSD-style license
//  available in the top-level LICENSE file of the project.
//

// Script used for fixed layouts resources.

import "./index";
import { applyFontFallback } from "./fxl-font-fallback";

window.readium.isFixedLayout = true;

/*
 * Nothing downstream waits on this — the overlay is corrected in place — so a
 * rejection here has nowhere to surface. Swallow it deliberately rather than
 * leaving an unhandled rejection: the page keeps whatever metrics it had.
 */
applyFontFallback().catch(() => {});
