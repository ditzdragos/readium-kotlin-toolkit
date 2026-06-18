/*
 * Copyright 2024 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.shared.util.data

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.shared.util.Try
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CachingReadableTest {

    private class CountingReadable(private val bytes: ByteArray) : Readable {
        var lengthCalls = 0
        var closeCalls = 0
        override suspend fun length(): Try<Long, ReadError> {
            lengthCalls++
            return Try.success(bytes.size.toLong())
        }
        override suspend fun read(range: LongRange?): Try<ByteArray, ReadError> =
            Try.success(range?.let { bytes.sliceArray(it.first.toInt()..it.last.toInt()) } ?: bytes)
        override fun close() {
            closeCalls++
        }
    }

    @Test
    fun `length is cached after first call`() = runTest {
        val source = CountingReadable(ByteArray(100))
        val caching = CachingReadable(source)

        caching.length()
        caching.length()
        caching.length()

        assertEquals(1, source.lengthCalls)
    }

    @Test
    fun `close does not propagate to the shared source`() = runTest {
        val source = CountingReadable(ByteArray(100))
        val caching = CachingReadable(source)

        caching.close()

        // CachingContainer shares one CachingReadable per URL across all callers, so a
        // single consumer closing it must NOT close the underlying source for the others.
        assertEquals(0, source.closeCalls)
    }
}
