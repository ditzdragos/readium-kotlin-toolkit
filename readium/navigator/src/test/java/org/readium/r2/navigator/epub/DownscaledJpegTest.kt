/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class DownscaledJpegTest {

    private val pixelbookLandscape = PixelSize(2400, 1600)
    private val phonePortrait = PixelSize(1080, 2280)
    private val brownBearPage = PixelSize(2256, 1410)

    @Test
    fun `a single page may fill the whole display`() {
        assertEquals(pixelbookLandscape, pageBox(pixelbookLandscape, isSpread = false))
    }

    @Test
    fun `each page of a spread gets half the display width`() {
        assertEquals(PixelSize(1200, 1600), pageBox(pixelbookLandscape, isSpread = true))
    }

    @Test
    fun `a spread page on a Pixelbook is decoded at the size it is drawn at`() {
        val box = pageBox(pixelbookLandscape, isSpread = true)

        assertEquals(PixelSize(1200, 750), downscaledSize(brownBearPage, box))
    }

    @Test
    fun `a portrait phone fits the page to its width, never above it`() {
        val size = downscaledSize(brownBearPage, pageBox(phonePortrait, isSpread = false))!!

        assertEquals(PixelSize(1080, 675), size)
    }

    @Test
    fun `a tall page is limited by the box height`() {
        val illustration = PixelSize(1474, 2170)

        assertEquals(PixelSize(1087, 1600), downscaledSize(illustration, pixelbookLandscape))
    }

    @Test
    fun `an image already inside the box is served as it is`() {
        assertNull(downscaledSize(PixelSize(1200, 750), PixelSize(1200, 1600)))
    }

    @Test
    fun `an image exactly the box size is served as it is`() {
        assertNull(downscaledSize(PixelSize(1200, 1600), PixelSize(1200, 1600)))
    }

    @Test
    fun `a sliver keeps at least one pixel on its short side`() {
        assertEquals(PixelSize(1080, 1), downscaledSize(PixelSize(10000, 2), phonePortrait))
    }

    @Test
    fun `an image or box without area is served as it is`() {
        assertNull(downscaledSize(PixelSize(0, 1410), pixelbookLandscape))
        assertNull(downscaledSize(brownBearPage, PixelSize(0, 0)))
    }
}
