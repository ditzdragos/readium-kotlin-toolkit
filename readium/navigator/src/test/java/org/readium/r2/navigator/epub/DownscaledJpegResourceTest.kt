/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import java.io.ByteArrayOutputStream
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.resource.InMemoryResource
import org.readium.r2.shared.util.resource.Resource
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DownscaledJpegResourceTest {

    private val box = PixelSize(200, 200)

    @Test
    fun `a JPEG larger than the box is served at the box size and keeps its layout size`() = runTest {
        val served = DownscaledJpegResource(InMemoryResource(image(800, 400)), box).read().bytes()

        val bounds = bounds(served)
        assertEquals(PixelSize(200, 100), bounds)
        assertEquals(PixelSize(800, 400), readExif(served)!!.densityCorrected(bounds))
    }

    @Test
    fun `a JPEG inside the box is served byte for byte`() = runTest {
        val jpeg = image(150, 100)

        assertContentEquals(jpeg, DownscaledJpegResource(InMemoryResource(jpeg), box).read().bytes())
    }

    @Test
    fun `a PNG labelled as a JPEG is served byte for byte`() = runTest {
        val png = image(800, 400, Bitmap.CompressFormat.PNG)

        assertContentEquals(png, DownscaledJpegResource(InMemoryResource(png), box).read().bytes())
    }

    @Test
    fun `a failed read is not kept for the next request`() = runTest {
        val source = FailingOnce(InMemoryResource(image(800, 400)))
        val resource = DownscaledJpegResource(source, box)

        assertTrue(resource.read().isFailure)
        assertEquals(PixelSize(200, 100), bounds(resource.read().bytes()))
    }

    private fun image(width: Int, height: Int, format: Bitmap.CompressFormat = Bitmap.CompressFormat.JPEG): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.rgb(200, 120, 40))
        return ByteArrayOutputStream().also { bitmap.compress(format, 90, it) }.toByteArray()
    }

    private fun bounds(bytes: ByteArray): PixelSize {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        return PixelSize(options.outWidth, options.outHeight)
    }

    private fun Try<ByteArray, ReadError>.bytes(): ByteArray = getOrElse { error("Read failed: $it") }

    private class FailingOnce(private val source: Resource) : Resource by source {
        private var failed = false

        override suspend fun read(range: LongRange?): Try<ByteArray, ReadError> {
            if (!failed) {
                failed = true
                return Try.failure(ReadError.Decoding("transient"))
            }
            return source.read(range)
        }
    }
}
