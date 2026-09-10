package org.readium.r2.lcp

import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.resource.Resource

@OptIn(ExperimentalStdlibApi::class)
class CbcLcpResourceTruncatedTest {

    private val iv: String = "69d18631eb38909efc0835299e70b9e2"

    /**
     * A resource that claims [declaredLength] bytes but only ever hands back [actualBytes],
     * the shape of a truncated or partially written encrypted resource.
     */
    private fun truncatedResource(declaredLength: Long, actualBytes: ByteArray): Resource {
        val resource = mockk<Resource>(relaxed = true)
        coEvery { resource.length() } returns Try.success(declaredLength)
        coEvery { resource.sourceUrl } returns null
        coEvery { resource.read(any()) } answers {
            val range = firstArg<LongRange?>()
            if (range == null) {
                Try.success(actualBytes)
            } else {
                val from = range.first.coerceIn(0, actualBytes.size.toLong()).toInt()
                val to = (range.last + 1).coerceIn(from.toLong(), actualBytes.size.toLong()).toInt()
                Try.success(actualBytes.sliceArray(from until to))
            }
        }
        return resource
    }

    private fun cbcResource(declaredLength: Long, content: String): CbcLcpResource {
        val slot = slot<ByteArray>()
        val license = mockk<LcpLicense>()
        coEvery { license.decrypt(capture(slot)) } answers {
            Try.success(slot.captured.sliceArray(16 until slot.captured.size))
        }

        return CbcLcpResource(
            resource = truncatedResource(declaredLength, (iv + content).hexToByteArray()),
            originalLength = null,
            license = license
        )
    }

    @Test
    fun `a truncated resource whose last byte is not padding fails instead of crashing`() = runTest {
        // 64 bytes of content are declared, only 32 are present, and the last present byte is 0xd3
        // -- content, not a padding length.
        val resource = cbcResource(
            declaredLength = 16 + 64L,
            content = "00".repeat(31) + "d3"
        )

        val result = resource.read(0 until 64L)

        assertTrue(result is Try.Failure, "expected a decoding failure, got $result")
        assertTrue(
            result.value is ReadError.Decoding,
            "expected ReadError.Decoding, got ${result.value}"
        )
    }

    @Test
    fun `a truncated resource whose last byte is a legal length still decrypts`() = runTest {
        val resource = cbcResource(
            declaredLength = 16 + 64L,
            content = "00".repeat(31) + "04"
        )

        val result = resource.read(0 until 64L)

        assertTrue(result is Try.Success, "expected success, got $result")
    }
}
