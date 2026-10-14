package org.readium.r2.streamer.extensions

import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class StringExtTest {

    @Test
    fun `convert an hexadecimal string to a byte array`() {
        assertNull("".toHexByteArray())
        // Forbids odd-length strings.
        assertNull("8".toHexByteArray())
        assertNull("8ad".toHexByteArray())
        // Forbids character outside 0-f range.
        assertNull("8y".toHexByteArray())

        assertContentEquals(byteArrayOf(0x8a), "8a".toHexByteArray())
        assertContentEquals(byteArrayOf(0x8a), "8A".toHexByteArray())
        assertContentEquals(byteArrayOf(0x8a, 0xd5, 0x07, 0x8e), "8ad5078e".toHexByteArray())
    }

    @Test
    fun `sha1 is the lowercase hex digest of the UTF-8 bytes`() {
        assertEquals("da39a3ee5e6b4b0d3255bfef95601890afd80709", "".sha1())
        assertEquals("a9993e364706816aba3e25717850c26c9cd0d89d", "abc".sha1())
    }

    private fun byteArrayOf(vararg bytes: Int): ByteArray {
        return bytes.map { it.toByte() }.toByteArray()
    }
}
