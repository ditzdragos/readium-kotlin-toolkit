/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.hardware.display.DisplayManager
import android.os.Build
import android.util.DisplayMetrics
import android.view.Display
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import kotlin.math.roundToInt
import org.readium.r2.navigator.util.ReadiumTrace
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.resource.InMemoryResource
import org.readium.r2.shared.util.resource.Resource
import timber.log.Timber

internal data class PixelSize(val width: Int, val height: Int)

/** The largest box one page can be drawn in: the display, or half its width for a spread. */
internal fun pageBox(display: PixelSize, isSpread: Boolean): PixelSize =
    if (isSpread) PixelSize(display.width / 2, display.height) else display

/** The size that fits [image] inside [box], or null when it already fits. */
internal fun downscaledSize(image: PixelSize, box: PixelSize): PixelSize? {
    if (image.width <= 0 || image.height <= 0 || box.width <= 0 || box.height <= 0) return null
    val scale = minOf(
        box.width.toDouble() / image.width,
        box.height.toDouble() / image.height
    )
    if (scale >= 1.0) return null
    return PixelSize(
        (image.width * scale).roundToInt().coerceAtLeast(1),
        (image.height * scale).roundToInt().coerceAtLeast(1)
    )
}

/**
 * The size of the whole [display] in its current rotation. Taken from the display rather than the
 * window so art served into a small Chromebook window stays sharp once the window is maximised.
 */
internal fun displaySize(display: Display): PixelSize {
    val metrics = DisplayMetrics()
    @Suppress("DEPRECATION")
    display.getRealMetrics(metrics)
    return PixelSize(metrics.widthPixels, metrics.heightPixels)
}

internal fun defaultDisplaySize(context: Context): PixelSize =
    context.getSystemService(DisplayManager::class.java)
        ?.getDisplay(Display.DEFAULT_DISPLAY)
        ?.let(::displaySize)
        ?: context.resources.displayMetrics.let { PixelSize(it.widthPixels, it.heightPixels) }

/**
 * Adds an EXIF block to [jpeg] declaring a resolution under which the browser lays the image out at
 * [naturalSize] although it holds [pixelSize] pixels, so pages that leave the image unsized keep
 * their layout. Chromium uses ResolutionUnit, X/YResolution and PixelX/YDimension for this when
 * pixel size × 72 / resolution rounds to the declared dimensions.
 */
internal fun withNaturalSize(jpeg: ByteArray, pixelSize: PixelSize, naturalSize: PixelSize): ByteArray {
    if (jpeg.size < 2 || jpeg[0] != 0xFF.toByte() || jpeg[1] != 0xD8.toByte()) return jpeg
    val app1 = exifSegment(pixelSize, naturalSize)
    val insertAt = 2 + jfifSegmentLength(jpeg)
    return jpeg.copyOfRange(0, insertAt) + app1 + jpeg.copyOfRange(insertAt, jpeg.size)
}

private fun jfifSegmentLength(jpeg: ByteArray): Int {
    if (jpeg.size < 6 || jpeg[2] != 0xFF.toByte() || jpeg[3] != 0xE0.toByte()) return 0
    val length = ((jpeg[4].toInt() and 0xFF) shl 8) or (jpeg[5].toInt() and 0xFF)
    return (2 + length).takeIf { 2 + it <= jpeg.size } ?: 0
}

private const val TIFF_HEADER_BYTES = 8
private const val IFD_ENTRY_BYTES = 12
private const val TYPE_SHORT = 3
private const val TYPE_LONG = 4
private const val TYPE_RATIONAL = 5
private const val RESOLUTION_UNIT_INCH = 2
private const val CSS_DPI = 72

private fun exifSegment(pixelSize: PixelSize, naturalSize: PixelSize): ByteArray {
    val ifd0Entries = 4
    val ifd0Bytes = 2 + ifd0Entries * IFD_ENTRY_BYTES + 4
    val xResolutionAt = TIFF_HEADER_BYTES + ifd0Bytes
    val yResolutionAt = xResolutionAt + 8
    val exifIfdAt = yResolutionAt + 8

    val tiff = BigEndianWriter().apply {
        bytes('M', 'M')
        short(0x2A)
        int(TIFF_HEADER_BYTES)

        short(ifd0Entries)
        entry(tag = 0x011A, type = TYPE_RATIONAL, value = xResolutionAt)
        entry(tag = 0x011B, type = TYPE_RATIONAL, value = yResolutionAt)
        entry(tag = 0x0128, type = TYPE_SHORT, value = RESOLUTION_UNIT_INCH shl 16)
        entry(tag = 0x8769, type = TYPE_LONG, value = exifIfdAt)
        int(0)

        int(CSS_DPI * pixelSize.width)
        int(naturalSize.width)
        int(CSS_DPI * pixelSize.height)
        int(naturalSize.height)

        short(2)
        entry(tag = 0xA002, type = TYPE_LONG, value = naturalSize.width)
        entry(tag = 0xA003, type = TYPE_LONG, value = naturalSize.height)
        int(0)
    }.toByteArray()

    val payload = "Exif".toByteArray(Charsets.US_ASCII) + byteArrayOf(0, 0) + tiff
    return BigEndianWriter().apply {
        short(0xFFE1)
        short(payload.size + 2)
    }.toByteArray() + payload
}

private class BigEndianWriter {
    private val out = ByteArrayOutputStream()

    fun bytes(vararg chars: Char) = chars.forEach { out.write(it.code) }

    fun short(value: Int) {
        out.write(value ushr 8 and 0xFF)
        out.write(value and 0xFF)
    }

    fun int(value: Int) {
        short(value ushr 16)
        short(value and 0xFFFF)
    }

    fun entry(tag: Int, type: Int, value: Int) {
        short(tag)
        short(type)
        int(1)
        int(value)
    }

    fun toByteArray(): ByteArray = out.toByteArray()
}

/**
 * Serves the JPEG of [source] decoded at the size that fits [box] and re-encoded, so the web view
 * decodes it at the size it draws it at instead of at full size. The re-encoded image declares the
 * original size as its natural size, so the page lays it out as before. Kept in memory only: the
 * source may be LCP-protected. Images that already fit, are not JPEGs, or fail to decode are
 * streamed from [source] unchanged. A read failure is returned, not kept, so the next request
 * reads again.
 */
internal class DownscaledJpegResource(
    private val source: Resource,
    private val box: PixelSize,
) : Resource {

    private var served: Resource? = null

    override val sourceUrl = source.sourceUrl

    override suspend fun properties(): Try<Resource.Properties, ReadError> = source.properties()

    override suspend fun length(): Try<Long, ReadError> =
        served().getOrElse { return Try.failure(it) }.length()

    override suspend fun read(range: LongRange?): Try<ByteArray, ReadError> =
        served().getOrElse { return Try.failure(it) }.read(range)

    override fun close() {
        source.close()
    }

    private suspend fun served(): Try<Resource, ReadError> {
        served?.let { return Try.success(it) }
        return resolve().onSuccess { served = it }
    }

    private suspend fun resolve(): Try<Resource, ReadError> {
        val head = source.read(0 until HEADER_READ_BYTES).getOrElse { return Try.failure(it) }
        val original = jpegSize(head) ?: return Try.success(source)
        val target = downscaledSize(original, box) ?: return Try.success(source)
        val bytes = source.read().getOrElse { return Try.failure(it) }
        val downscaled = ReadiumTrace.section(ReadiumTrace.DOWNSCALE_JPEG) {
            downscaleJpeg(bytes, original, target)
        } ?: return Try.success(source)
        return Try.success(InMemoryResource(downscaled, source.sourceUrl))
    }
}

private const val HEADER_READ_BYTES = 256L * 1024
private const val JPEG_QUALITY = 90
private const val JPEG_MIME_TYPE = "image/jpeg"

private class HeaderRead(val size: PixelSize?) : RuntimeException() {
    override fun fillInStackTrace(): Throwable = this
}

/** The size of the JPEG whose header is in [head], or null when [head] is not one. */
private fun jpegSize(head: ByteArray): PixelSize? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
    return try {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(head))) { _, info, _ ->
            throw HeaderRead(
                PixelSize(info.size.width, info.size.height).takeIf { info.mimeType == JPEG_MIME_TYPE }
            )
        }
        null
    } catch (header: HeaderRead) {
        header.size
    } catch (e: Exception) {
        Timber.i("Serving an image at full size: its header did not decode (%s)", e)
        null
    }
}

private fun downscaleJpeg(bytes: ByteArray, original: PixelSize, target: PixelSize): ByteArray? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
    val bitmap = try {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, _, _ ->
            decoder.setTargetSize(target.width, target.height)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } catch (e: Exception) {
        Timber.w("Serving a JPEG at full size: it failed to decode (%s)", e)
        return null
    } catch (e: OutOfMemoryError) {
        Timber.w("Serving a JPEG at full size: no memory to decode it (%s)", e)
        return null
    }
    return try {
        val out = ByteArrayOutputStream(bytes.size / 2)
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)) return null
        val pixelSize = PixelSize(bitmap.width, bitmap.height)
        withNaturalSize(out.toByteArray(), pixelSize, naturalSize(original, target, pixelSize))
    } finally {
        bitmap.recycle()
    }
}

/** [original] turned like the decoder turned [target] into [pixelSize]. */
internal fun naturalSize(original: PixelSize, target: PixelSize, pixelSize: PixelSize): PixelSize =
    if (pixelSize != target && pixelSize == PixelSize(target.height, target.width)) {
        PixelSize(original.height, original.width)
    } else {
        original
    }
