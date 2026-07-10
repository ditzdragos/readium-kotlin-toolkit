/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlin.test.assertEquals
import org.json.JSONException
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class HorizontalPageRangesTest {

    @Test
    fun `parses ranges ordered by numeric key`() {
        val raw = """{"10":"k","2":"b","1":"a"}"""
        assertEquals(listOf("a", "b", "k"), parseHorizontalPageRanges(raw))
    }

    @Test
    fun `empty object yields empty list`() {
        assertEquals(emptyList(), parseHorizontalPageRanges("{}"))
    }

    @Test
    fun `evaluateJavascript null sentinel yields empty list`() {
        assertEquals(emptyList(), parseHorizontalPageRanges("null"))
    }

    @Test
    fun `kotlin null yields empty list`() {
        assertEquals(emptyList(), parseHorizontalPageRanges(null))
    }

    @Test
    fun `blank result yields empty list`() {
        assertEquals(emptyList(), parseHorizontalPageRanges(""))
        assertEquals(emptyList(), parseHorizontalPageRanges("   "))
    }

    @Test
    fun `non-numeric keys sort last but are retained`() {
        val raw = """{"x":"last","1":"first"}"""
        assertEquals(listOf("first", "last"), parseHorizontalPageRanges(raw))
    }

    @Test(expected = JSONException::class)
    fun `malformed json still throws`() {
        parseHorizontalPageRanges("{not json")
    }
}
