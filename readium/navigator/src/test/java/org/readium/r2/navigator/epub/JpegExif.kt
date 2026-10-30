/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlin.math.roundToInt

/** The EXIF fields Chromium reads to size an image, parsed independently of the writer. */
internal data class JpegExif(
    val resolutionUnit: Int,
    val xResolution: Double,
    val yResolution: Double,
    val naturalSize: PixelSize,
) {
    /** Chromium's density-corrected natural size of an image of [pixelSize] pixels. */
    fun densityCorrected(pixelSize: PixelSize): PixelSize {
        val corrected = PixelSize(
            (pixelSize.width * 72 / xResolution).roundToInt(),
            (pixelSize.height * 72 / yResolution).roundToInt()
        )
        return if (resolutionUnit == 2 && corrected == naturalSize) naturalSize else pixelSize
    }
}

internal fun readExif(jpeg: ByteArray): JpegExif? {
    var at = 2
    while (at + 4 <= jpeg.size && jpeg[at] == 0xFF.toByte()) {
        val marker = jpeg[at + 1].toInt() and 0xFF
        val length = jpeg.u16(at + 2)
        if (marker == 0xE1 && String(jpeg, at + 4, 4, Charsets.US_ASCII) == "Exif") {
            return parseTiff(jpeg.copyOfRange(at + 10, at + 2 + length))
        }
        at += 2 + length
    }
    return null
}

private fun parseTiff(tiff: ByteArray): JpegExif {
    require(tiff[0] == 'M'.code.toByte() && tiff[1] == 'M'.code.toByte())
    val ifd0 = tiff.entries(tiff.u32(4))
    val exif = tiff.entries(ifd0.getValue(0x8769))
    fun rational(tag: Int): Double = ifd0.getValue(tag).let { tiff.u32(it).toDouble() / tiff.u32(it + 4) }
    return JpegExif(
        resolutionUnit = ifd0.getValue(0x0128) ushr 16,
        xResolution = rational(0x011A),
        yResolution = rational(0x011B),
        naturalSize = PixelSize(exif.getValue(0xA002), exif.getValue(0xA003))
    )
}

private fun ByteArray.entries(at: Int): Map<Int, Int> =
    (0 until u16(at)).associate { i ->
        val entry = at + 2 + i * 12
        u16(entry) to u32(entry + 8)
    }

private fun ByteArray.u16(at: Int): Int = ((this[at].toInt() and 0xFF) shl 8) or (this[at + 1].toInt() and 0xFF)

private fun ByteArray.u32(at: Int): Int = (u16(at) shl 16) or u16(at + 2)
