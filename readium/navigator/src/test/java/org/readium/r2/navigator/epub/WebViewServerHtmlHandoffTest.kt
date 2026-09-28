/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import android.net.Uri
import android.webkit.WebResourceRequest
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
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.RelativeUrl
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.data.Container
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.shared.util.resource.InMemoryResource
import org.readium.r2.shared.util.resource.Resource
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@OptIn(ExperimentalReadiumApi::class)
@RunWith(RobolectricTestRunner::class)
class WebViewServerHtmlHandoffTest {

    private val pageHref = Url.fromDecodedPath("OPS/page 1.xhtml")!!

    private val pageHtml =
        """<html><head><meta name="viewport" content="width=600, height=800"/></head><body>page one</body></html>"""

    private class CountingContainer(private val resources: Map<Url, ByteArray>) : Container<Resource> {
        val gets = mutableMapOf<Url, Int>()

        override val entries: Set<Url> get() = resources.keys

        override fun get(url: Url): Resource? =
            resources[url]?.let { bytes ->
                gets[url] = (gets[url] ?: 0) + 1
                InMemoryResource(bytes)
            }

        override fun close() {}
    }

    private val container = CountingContainer(mapOf(pageHref to pageHtml.toByteArray()))

    private val server = WebViewServer(
        application = RuntimeEnvironment.getApplication(),
        publication = Publication(
            manifest = Manifest(
                metadata = Metadata(localizedTitle = LocalizedString("Book")),
                readingOrder = listOf(Link(href = Href(pageHref), mediaType = MediaType.XHTML))
            ),
            container = container
        ),
        isFixedLayout = true,
        servedAssets = emptyList(),
        disableSelectionWhenProtected = false,
        onResourceLoadFailed = { _, _ -> }
    )

    private val css = ReadiumCss(assetsBaseHref = WebViewServer.assetsBaseHref)

    private val pageUrl: AbsoluteUrl = server.publicationBaseHref.resolve(pageHref)

    private fun viewportHref(): Url = server.publicationBaseHref.relativize(pageUrl) as RelativeUrl

    private fun serve(): String {
        val request = object : WebResourceRequest {
            override fun getUrl(): Uri = Uri.parse(pageUrl.toString())
            override fun isForMainFrame(): Boolean = true
            override fun isRedirect(): Boolean = false
            override fun hasGesture(): Boolean = false
            override fun getMethod(): String = "GET"
            override fun getRequestHeaders(): Map<String, String> = emptyMap()
        }
        val response = server.shouldInterceptRequest(request, css)!!
        return response.data.use { it.readBytes().decodeToString() }
    }

    private fun pageReads(): Int = container.gets[pageHref] ?: 0

    @Test
    fun `a page whose viewport was read is served without reading it again`() = runTest {
        server.fixedLayoutViewport(viewportHref())

        val served = serve()

        assertTrue(served.contains("page one"))
        assertEquals(1, pageReads())
    }

    @Test
    fun `a prewarmed page is served without reading it again`() = runTest {
        server.prewarm(pageHref, css)

        val served = serve()

        assertTrue(served.contains("page one"))
        assertEquals(1, pageReads())
    }

    @Test
    fun `a reloaded page is read again`() = runTest {
        server.fixedLayoutViewport(viewportHref())
        serve()

        val reloaded = serve()

        assertTrue(reloaded.contains("page one"))
        assertEquals(2, pageReads())
    }
}
