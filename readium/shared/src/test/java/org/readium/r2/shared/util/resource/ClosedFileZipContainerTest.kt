/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.shared.util.resource

import android.util.Log
import java.io.File
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.shared.util.FileExtension
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.format.Format
import org.readium.r2.shared.util.format.FormatSpecification
import org.readium.r2.shared.util.format.Specification
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.shared.util.zip.FileZipArchiveProvider
import org.robolectric.RobolectricTestRunner
import timber.log.Timber

@RunWith(RobolectricTestRunner::class)
class ClosedFileZipContainerTest {

    private val priorities = mutableListOf<Int>()

    private val recordingTree = object : Timber.Tree() {
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
            priorities += priority
        }
    }

    @Before
    fun setUp() {
        Timber.plant(recordingTree)
    }

    @After
    fun tearDown() {
        Timber.uprootAll()
    }

    @Test
    fun `looking up an entry after the archive is closed returns null without an ERROR log`(): Unit =
        runBlocking {
            val epubZip = ClosedFileZipContainerTest::class.java.getResource("epub.epub")
            assertNotNull(epubZip)
            val format = Format(
                specification = FormatSpecification(Specification.Zip, Specification.Epub),
                mediaType = MediaType.EPUB,
                fileExtension = FileExtension("epub")
            )
            val container = assertNotNull(
                FileZipArchiveProvider().open(format, File(epubZip.path)).getOrNull()
            )

            container.close()
            priorities.clear()

            assertNull(container[Url("mimetype")!!])
            assertTrue(
                "an entry lookup on a closed archive is a benign teardown race and must not be logged at ERROR",
                priorities.none { it == Log.ERROR }
            )
        }
}
