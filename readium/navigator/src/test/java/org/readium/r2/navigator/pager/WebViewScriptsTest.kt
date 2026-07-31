/*
 * Copyright 2025 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.pager

import java.util.Locale
import kotlin.test.assertContains
import kotlin.test.assertFalse
import org.junit.After
import org.junit.Test

class WebViewScriptsTest {

    private val defaultLocale = Locale.getDefault()

    @After
    fun restoreLocale() {
        Locale.setDefault(defaultLocale)
    }

    private fun script(width: Double, height: Double, scale: Double) =
        WebViewScripts.getFixedLayoutScaleScript(width, height, scale)

    @Test
    fun `restates the declared box and the scale it should be drawn at`() {
        assertContains(
            script(1224.0, 1584.0, 0.43277),
            "'width=1224.00000, height=1584.00000, initial-scale=0.43277'"
        )
    }

    @Test
    fun `writes decimal points whatever the device locale is`() {
        // `0,43277` would be parsed as the end of the initial-scale value, leaving the page at 0.
        Locale.setDefault(Locale.forLanguageTag("fr-FR"))
        val script = script(1224.0, 1584.0, 0.43277)
        assertContains(script, "'width=1224.00000, height=1584.00000, initial-scale=0.43277'")
        assertFalse(Regex("""\d,\d""").containsMatchIn(script), "a comma is separating digits")
    }

    @Test
    fun `leaves a page that is already at that scale alone`() {
        // Without this every page would visibly jump once after loading.
        assertContains(script(1224.0, 1584.0, 0.43277), "Math.abs(current - 0.43277) < 0.002")
    }
}
