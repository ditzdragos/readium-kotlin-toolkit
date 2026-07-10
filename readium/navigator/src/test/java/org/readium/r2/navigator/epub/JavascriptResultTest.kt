/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class JavascriptResultTest {

    @Test
    fun `kotlin null is a null result`() {
        assertTrue((null as String?).isJavascriptNullResult())
    }

    @Test
    fun `the encoded null literal is a null result`() {
        assertTrue("null".isJavascriptNullResult())
    }

    @Test
    fun `blank strings are null results`() {
        assertTrue("".isJavascriptNullResult())
        assertTrue("   ".isJavascriptNullResult())
    }

    @Test
    fun `json payloads are not null results`() {
        assertFalse("{}".isJavascriptNullResult())
        assertFalse("""{"1":"a"}""".isJavascriptNullResult())
        assertFalse("""{"left":0}""".isJavascriptNullResult())
    }

    @Test
    fun `strings merely containing null are not null results`() {
        assertFalse("nullable".isJavascriptNullResult())
        assertFalse(""""null"""".isJavascriptNullResult())
    }
}
