/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.navigator.epub.css.ReadiumCss
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.LocalizedString
import org.readium.r2.shared.publication.Manifest
import org.readium.r2.shared.publication.Metadata
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.shared.util.resource.InMemoryResource
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalReadiumApi::class)
@RunWith(RobolectricTestRunner::class)
class FixedLayoutPageClipTest {

    private val pageClip = "html{contain:paint !important;min-height:100% !important}"

    private val overflowingPage =
        """<html><head><meta name="viewport" content="width=1224, height=1584"/></head>""" +
            """<body><div style="position:absolute; left:798px; width:1224px;">It's a gator</div></body></html>"""

    private suspend fun served(layout: String): String {
        val publication = Publication(
            manifest = Manifest(
                metadata = Metadata(
                    localizedTitle = LocalizedString("Book"),
                    otherMetadata = mapOf("presentation" to mapOf("layout" to layout))
                )
            )
        )
        val bytes = InMemoryResource(overflowingPage.toByteArray())
            .injectHtml(
                publication = publication,
                mediaType = MediaType.XHTML,
                css = ReadiumCss(assetsBaseHref = WebViewServer.assetsBaseHref),
                baseHref = WebViewServer.assetsBaseHref,
                disableSelectionWhenProtected = false
            )
            .read()
            .getOrNull()
        return checkNotNull(bytes).decodeToString()
    }

    @Test
    fun `a fixed-layout page is clipped to its page box so overflow is never a second page`() = runTest {
        assertTrue(served("fixed").contains(pageClip))
    }

    @Test
    fun `a reflowable page is not clipped`() = runTest {
        assertFalse(served("reflowable").contains(pageClip))
    }
}
