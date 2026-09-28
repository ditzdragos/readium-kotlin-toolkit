/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RawHtmlHandoffTest {

    private fun bytes(size: Int) = ByteArray(size) { it.toByte() }

    @Test
    fun `take returns what was put`() {
        val handoff = RawHtmlHandoff<String>(maxBytes = 10)
        val page = bytes(4)

        handoff.put("page1", page)

        assertArrayEquals(page, handoff.take("page1"))
    }

    @Test
    fun `take removes the entry`() {
        val handoff = RawHtmlHandoff<String>(maxBytes = 10)
        handoff.put("page1", bytes(4))

        handoff.take("page1")

        assertNull(handoff.take("page1"))
    }

    @Test
    fun `evicts least recently put beyond the byte budget`() {
        val handoff = RawHtmlHandoff<String>(maxBytes = 10)

        handoff.put("page1", bytes(4))
        handoff.put("page2", bytes(4))
        handoff.put("page3", bytes(4))

        assertNull(handoff.take("page1"))
        assertNotNull(handoff.take("page2"))
        assertNotNull(handoff.take("page3"))
    }

    @Test
    fun `ignores an entry larger than the budget`() {
        val handoff = RawHtmlHandoff<String>(maxBytes = 10)
        handoff.put("page1", bytes(4))

        handoff.put("huge", bytes(11))

        assertNull(handoff.take("huge"))
        assertNotNull(handoff.take("page1"))
    }

    @Test
    fun `putting a key again replaces it without double counting`() {
        val handoff = RawHtmlHandoff<String>(maxBytes = 10)

        handoff.put("page1", bytes(4))
        handoff.put("page1", bytes(4))
        handoff.put("page2", bytes(4))

        assertNotNull(handoff.take("page1"))
        assertNotNull(handoff.take("page2"))
    }

    @Test
    fun `clear drops everything`() {
        val handoff = RawHtmlHandoff<String>(maxBytes = 10)
        handoff.put("page1", bytes(4))

        handoff.clear()

        assertNull(handoff.take("page1"))
    }
}
