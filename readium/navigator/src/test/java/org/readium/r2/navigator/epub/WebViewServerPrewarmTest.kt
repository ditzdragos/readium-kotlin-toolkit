/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.navigator.epub.css.ReadiumCss
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Href
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.LocalizedString
import org.readium.r2.shared.publication.Manifest
import org.readium.r2.shared.publication.Metadata
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.data.Container
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.shared.util.resource.InMemoryResource
import org.readium.r2.shared.util.resource.Resource
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@OptIn(ExperimentalReadiumApi::class)
@RunWith(RobolectricTestRunner::class)
class WebViewServerPrewarmTest {

    private val pageHref = Url("OPS/page.xhtml")!!
    private val cssHref = Url("OPS/style.css")!!
    private val artHref = Url("OPS/art.jpg")!!
    private val imageHrefs = (0 until 10).map { Url("OPS/img$it.jpg")!! }

    private val box = PixelSize(200, 200)
    private val css = ReadiumCss(assetsBaseHref = WebViewServer.assetsBaseHref)

    /** Counts reads per resource and how many are in flight at once; fails the first CSS read. */
    private inner class Reads : Container<Resource> {
        val counts = mutableMapOf<Url, Int>()
        var inFlight = 0
        var maxInFlight = 0
        var failNextCssRead = true

        private val bytes = mapOf(pageHref to pageHtml.toByteArray(), cssHref to stylesheet.toByteArray()) +
            (imageHrefs + artHref).associateWith { ByteArray(1024) { 7 } }

        override val entries: Set<Url> get() = bytes.keys

        override fun get(url: Url): Resource? {
            val source = InMemoryResource(bytes[url] ?: return null)
            return object : Resource by source {
                override suspend fun read(range: LongRange?): Try<ByteArray, ReadError> {
                    counts[url] = (counts[url] ?: 0) + 1
                    if (url == cssHref && failNextCssRead) {
                        failNextCssRead = false
                        return Try.failure(ReadError.Decoding("transient"))
                    }
                    inFlight++
                    maxInFlight = maxOf(maxInFlight, inFlight)
                    delay(10)
                    inFlight--
                    return source.read(range)
                }
            }
        }

        override fun close() {}
    }

    private val pageHtml = """
        <html><head><link rel="stylesheet" href="style.css"/></head>
        <body id="page1">${imageHrefs.indices.joinToString("") { """<img src="img$it.jpg"/>""" }}</body></html>
    """.trimIndent()

    private val stylesheet = "#page1 { background-image: url(art.jpg); }"

    private val reads = Reads()

    private val server = WebViewServer(
        application = RuntimeEnvironment.getApplication(),
        publication = Publication(
            manifest = Manifest(
                metadata = Metadata(localizedTitle = LocalizedString("Book")),
                readingOrder = listOf(Link(href = Href(pageHref), mediaType = MediaType.XHTML)),
                resources = listOf(Link(href = Href(cssHref), mediaType = MediaType.CSS)) +
                    (imageHrefs + artHref).map { Link(href = Href(it), mediaType = MediaType.JPEG) }
            ),
            container = reads
        ),
        isFixedLayout = true,
        servedAssets = emptyList(),
        disableSelectionWhenProtected = false,
        onResourceLoadFailed = { _, _ -> }
    )

    @Test
    fun `warms every image of a page but only a few JPEGs at once`() = runTest {
        server.prewarm(pageHref, css, box)

        imageHrefs.forEach { assertTrue("$it was not warmed", (reads.counts[it] ?: 0) > 0) }
        assertTrue("${reads.maxInFlight} reads at once", reads.maxInFlight <= 5)
    }

    @Test
    fun `reads a stylesheet again after a failed read`() = runTest {
        server.prewarm(pageHref, css, box)
        assertEquals(null, reads.counts[artHref])

        server.prewarm(pageHref, css, box)
        assertTrue("art.jpg was not warmed", (reads.counts[artHref] ?: 0) > 0)
    }
}
