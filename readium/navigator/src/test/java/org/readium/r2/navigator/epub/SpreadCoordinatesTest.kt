/*
 * Copyright 2025 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlin.test.assertEquals
import org.junit.Test

class SpreadCoordinatesTest {

    private fun box(left: Float, top: Float, right: Float, bottom: Float) =
        SpreadCoordinates.Box(left, top, right, bottom)

    @Test
    fun `a web view filling the spread leaves the rect where it is`() {
        val rect = box(100f, 200f, 180f, 240f)

        assertEquals(rect, SpreadCoordinates.toSpread(rect, webViewLeft = 0, webViewTop = 0))
    }

    @Test
    fun `a fixed-layout page letterboxed vertically moves the rect down`() {
        val rect = box(100f, 200f, 180f, 240f)

        val spread = SpreadCoordinates.toSpread(rect, webViewLeft = 0, webViewTop = 420)

        assertEquals(box(100f, 620f, 180f, 660f), spread)
    }

    @Test
    fun `a fixed-layout page letterboxed horizontally moves the rect right`() {
        val rect = box(100f, 200f, 180f, 240f)

        val spread = SpreadCoordinates.toSpread(rect, webViewLeft = 588, webViewTop = 0)

        assertEquals(box(688f, 200f, 768f, 240f), spread)
    }

    @Test
    fun `the right page of a spread moves by its own left, not by half the spread`() {
        val rect = box(10f, 30f, 90f, 70f)
        val halfSpread = 540

        val spread = SpreadCoordinates.toSpread(rect, webViewLeft = 640, webViewTop = 120)

        assertEquals(box(650f, 150f, 730f, 190f), spread)
        assertEquals(650f, spread.left)
        assertEquals(true, spread.left > rect.left + halfSpread)
    }

    @Test
    fun `an empty rect stays empty so the caller can still reject it`() {
        val spread = SpreadCoordinates.toSpread(box(0f, 0f, 0f, 0f), webViewLeft = 588, webViewTop = 420)

        assertEquals(0f, spread.right - spread.left)
        assertEquals(0f, spread.bottom - spread.top)
    }

    @Test
    fun `the failed-lookup placeholder stays empty so the caller can still reject it`() {
        val spread = SpreadCoordinates.toSpread(box(-1f, -1f, -1f, -1f), webViewLeft = 588, webViewTop = 420)

        assertEquals(0f, spread.right - spread.left)
        assertEquals(0f, spread.bottom - spread.top)
    }
}
