/*
 * Copyright 2025 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class FixedLayoutViewportParserTest {

    private fun parse(html: String) = FixedLayoutViewportParser.parse(html)

    @Test
    fun `reads width and height from the viewport meta tag`() {
        assertEquals(
            FixedLayoutViewport(1200.0, 1600.0),
            parse("""<html><head><meta name="viewport" content="width=1200, height=1600"/></head></html>""")
        )
    }

    @Test
    fun `accepts the attributes in either order and single quotes`() {
        assertEquals(
            FixedLayoutViewport(768.0, 1024.0),
            parse("""<meta content='width=768,height=1024' name='viewport'>""")
        )
    }

    @Test
    fun `accepts fractional lengths`() {
        assertEquals(
            FixedLayoutViewport(1200.5, 1600.25),
            parse("""<meta name="viewport" content="width=1200.5, height=1600.25">""")
        )
    }

    @Test
    fun `ignores a viewport meta tag that declares no page box`() {
        // What index-reflowable.js injects into every reflowable document.
        assertNull(
            parse(
                """<meta name="viewport" content="width=device-width, initial-scale=1.0,
                   maximum-scale=1.0, user-scalable=no, shrink-to-fit=no">"""
            )
        )
    }

    @Test
    fun `does not read the width inside min-width`() {
        assertNull(parse("""<meta name="viewport" content="min-width=320, min-height=480">"""))
    }

    @Test
    fun `ignores meta tags that are not the viewport`() {
        assertNull(
            parse("""<meta name="generator" content="width=1200, height=1600">""")
        )
    }

    @Test
    fun `skips a viewport meta tag without a box and keeps looking`() {
        assertEquals(
            FixedLayoutViewport(1200.0, 1600.0),
            parse(
                """
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta name="viewport" content="width=1200, height=1600">
                """.trimIndent()
            )
        )
    }

    @Test
    fun `falls back to the svg viewBox`() {
        assertEquals(
            FixedLayoutViewport(1600.0, 2400.0),
            parse(
                """
                <html><head><meta name="viewport" content="width=device-width"/></head>
                <body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 2400">
                <image width="1600" height="2400" xlink:href="page.jpg"/></svg></body></html>
                """.trimIndent()
            )
        )
    }

    @Test
    fun `reads a comma-separated viewBox`() {
        assertEquals(
            FixedLayoutViewport(900.0, 1200.0),
            parse("""<svg viewBox="0,0,900,1200"></svg>""")
        )
    }

    @Test
    fun `falls back to svg width and height with units`() {
        assertEquals(
            FixedLayoutViewport(1200.0, 1600.0),
            parse("""<svg width="1200px" height="1600px"></svg>""")
        )
    }

    @Test
    fun `ignores percentage svg sizes`() {
        assertNull(parse("""<svg width="100%" height="100%"></svg>"""))
    }

    @Test
    fun `does not read stroke-width as the svg width`() {
        assertNull(parse("""<svg stroke-width="2" height="1600"></svg>"""))
    }

    @Test
    fun `prefers the viewport meta tag over the svg`() {
        assertEquals(
            FixedLayoutViewport(1200.0, 1600.0),
            parse(
                """
                <meta name="viewport" content="width=1200, height=1600">
                <svg viewBox="0 0 400 400"></svg>
                """.trimIndent()
            )
        )
    }

    @Test
    fun `rejects zero and negative lengths`() {
        assertNull(parse("""<meta name="viewport" content="width=0, height=1600">"""))
        assertNull(parse("""<svg viewBox="0 0 0 0"></svg>"""))
    }

    @Test
    fun `returns null for a document that declares nothing`() {
        assertNull(parse("""<html><head><title>Chapter 1</title></head><body><p>Hi</p></body></html>"""))
    }
}
