/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class HtmlInjectorTest {

    private val injectable = "\n<script src=\"test.js\"></script>\n"

    @Test
    fun `Injectable is inserted before closing head when present`() {
        val html = "<html><head><title>t</title></head><body>body</body></html>"

        val result = html.injectReadiumContent(injectable, sourceUrl = null)

        assertTrue(result.contains("<script src=\"test.js\"></script>"))
        assertTrue(result.indexOf("<script src=\"test.js\"></script>") < result.indexOf("</head>"))
    }

    @Test
    fun `Missing closing head injects synthetic head after html tag`() {
        val html = "<html><head/><body>body</body></html>"

        val result = html.injectReadiumContent(injectable, sourceUrl = null)

        assertTrue(result.contains("<head>"))
        assertTrue(result.contains("<script src=\"test.js\"></script>"))
        assertTrue(result.indexOf("<head>") < result.indexOf("<body>"))
    }

    @Test
    fun `Missing html tag injects synthetic head before body`() {
        val html = "<body>body</body>"

        val result = html.injectReadiumContent(injectable, sourceUrl = null)

        assertTrue(result.contains("<head>"))
        assertTrue(result.contains("<script src=\"test.js\"></script>"))
        assertTrue(result.indexOf("<head>") < result.indexOf("<body>"))
    }
}
