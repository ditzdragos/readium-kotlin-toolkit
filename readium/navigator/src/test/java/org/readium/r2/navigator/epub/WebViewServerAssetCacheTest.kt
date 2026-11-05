/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import android.net.Uri
import android.webkit.WebResourceRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.navigator.epub.css.ReadiumCss
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.LocalizedString
import org.readium.r2.shared.publication.Manifest
import org.readium.r2.shared.publication.Metadata
import org.readium.r2.shared.publication.Publication
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@OptIn(ExperimentalReadiumApi::class)
@RunWith(RobolectricTestRunner::class)
class WebViewServerAssetCacheTest {

    private val server = WebViewServer(
        application = RuntimeEnvironment.getApplication(),
        publication = Publication(
            manifest = Manifest(metadata = Metadata(localizedTitle = LocalizedString("Book")))
        ),
        isFixedLayout = true,
        servedAssets = listOf("readium/.*"),
        disableSelectionWhenProtected = false,
        onResourceLoadFailed = { _, _ -> }
    )

    private val css = ReadiumCss(assetsBaseHref = WebViewServer.assetsBaseHref)

    private fun cacheControlOf(asset: String): String? {
        val request = object : WebResourceRequest {
            override fun getUrl(): Uri = Uri.parse(WebViewServer.assetsBaseHref.toString() + asset)
            override fun isForMainFrame(): Boolean = false
            override fun isRedirect(): Boolean = false
            override fun hasGesture(): Boolean = false
            override fun getMethod(): String = "GET"
            override fun getRequestHeaders(): Map<String, String> = emptyMap()
        }
        val response = checkNotNull(server.shouldInterceptRequest(request, css, PixelSize(1080, 1920)))
        return response.responseHeaders["Cache-Control"]
    }

    @Test
    fun `a bundled font is cached so every page reuses one decoded face`() {
        assertEquals(
            "max-age=86400, immutable",
            cacheControlOf("readium/fonts/fxl-default-serif/NimbusRoman-Italic.woff2")
        )
    }

    @Test
    fun `a bundled script is not cached`() {
        assertNull(cacheControlOf("readium/scripts/readium-fixed.js"))
    }
}
