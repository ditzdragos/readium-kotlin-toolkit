/*
 * Copyright 2025 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

/**
 * Moves rects out of a web view's coordinates and into those of the spread that hosts it.
 *
 * A web view reports rects relative to its own top-left corner. A fixed-layout web view is sized to
 * the proportions of the page it shows and centred in its half of the spread, so that corner is not
 * the spread's: a native view placed at the reported coordinates lands short of the word by the
 * letterbox, in whichever direction the page does not fill. A reflowable web view fills its half,
 * which makes this a no-op.
 */
internal object SpreadCoordinates {

    data class Box(
        val left: Float,
        val top: Float,
        val right: Float,
        val bottom: Float,
    )

    fun toSpread(rect: Box, webViewLeft: Int, webViewTop: Int): Box =
        Box(
            left = rect.left + webViewLeft,
            top = rect.top + webViewTop,
            right = rect.right + webViewLeft,
            bottom = rect.bottom + webViewTop
        )
}
