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
 * The size of the whole display in its current rotation. Taken from the display rather than the
 * window so art served into a small Chromebook window stays sharp once the window is maximised.
 */
internal fun displaySize(context: Context): PixelSize {
    val metrics = DisplayMetrics()
    val display = context.getSystemService(DisplayManager::class.java)
        ?.getDisplay(Display.DEFAULT_DISPLAY)
    if (display != null) {
        @Suppress("DEPRECATION")
        display.getRealMetrics(metrics)
    } else {
        metrics.setTo(context.resources.displayMetrics)
    }
    return PixelSize(metrics.widthPixels, metrics.heightPixels)
}

/**
 * Serves the JPEG of [source] decoded at the size that fits [box] and re-encoded, so the web view
 * decodes it at the size it draws it at instead of at full size. Kept in memory only: the source
 * may be LCP-protected. Serves the original bytes when the image already fits or anything fails.
 */
internal class DownscaledJpegResource(
    private val source: Resource,
    box: PixelSize,
) : Resource {

    private val served = InMemoryResource(source.sourceUrl, Resource.Properties()) {
        source.read().map { bytes ->
            ReadiumTrace.section(ReadiumTrace.DOWNSCALE_JPEG) { downscaleJpeg(bytes, box) } ?: bytes
        }
    }

    override val sourceUrl = source.sourceUrl

    override suspend fun properties(): Try<Resource.Properties, ReadError> = source.properties()

    override suspend fun length(): Try<Long, ReadError> = served.length()

    override suspend fun read(range: LongRange?): Try<ByteArray, ReadError> = served.read(range)

    override fun close() {
        source.close()
    }
}

private const val JPEG_QUALITY = 90

private object FitsAlready : RuntimeException() {
    private fun readResolve(): Any = FitsAlready
}

private fun downscaleJpeg(bytes: ByteArray, box: PixelSize): ByteArray? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
    val bitmap = try {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
            val target = downscaledSize(PixelSize(info.size.width, info.size.height), box)
                ?: throw FitsAlready
            decoder.setTargetSize(target.width, target.height)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } catch (_: FitsAlready) {
        return null
    } catch (e: Exception) {
        Timber.w(e, "Serving a JPEG at full size: it failed to decode")
        return null
    } catch (e: OutOfMemoryError) {
        Timber.w(e, "Serving a JPEG at full size: no memory to decode it")
        return null
    }
    return try {
        val out = ByteArrayOutputStream(bytes.size / 2)
        if (bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)) out.toByteArray() else null
    } finally {
        bitmap.recycle()
    }
}
