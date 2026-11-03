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

    @Test
    fun `a downscaled JPEG declares the original size as its natural size`() {
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte())

        val exif = readExif(withNaturalSize(jpeg, PixelSize(1200, 750), brownBearPage))!!

        assertEquals(brownBearPage, exif.naturalSize)
        assertEquals(brownBearPage, exif.densityCorrected(PixelSize(1200, 750)))
    }

    @Test
    fun `the EXIF block goes after a JFIF block`() {
        val jfif = byteArrayOf(0xFF.toByte(), 0xE0.toByte(), 0, 4, 1, 2)
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte()) + jfif + byteArrayOf(0xFF.toByte(), 0xD9.toByte())

        val served = withNaturalSize(jpeg, PixelSize(10, 10), PixelSize(20, 20))

        assertEquals(jfif.toList(), served.copyOfRange(2, 8).toList())
        assertEquals(0xE1, served[9].toInt() and 0xFF)
    }

    @Test
    fun `bytes that are not a JPEG are left alone`() {
        val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte())

        assertEquals(png.toList(), withNaturalSize(png, PixelSize(1, 1), PixelSize(2, 2)).toList())
    }

    @Test
    fun `a decoder that turned the image turns its natural size too`() {
        assertEquals(
            PixelSize(1410, 2256),
            naturalSize(brownBearPage, target = PixelSize(1200, 750), pixelSize = PixelSize(750, 1200))
        )
        assertEquals(
            brownBearPage,
            naturalSize(brownBearPage, target = PixelSize(1200, 750), pixelSize = PixelSize(1200, 750))
        )
    }
}
