package org.readium.r2.lcp

import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.resource.InMemoryResource
import org.readium.r2.shared.util.resource.Resource

@OptIn(ExperimentalStdlibApi::class)
class CbcLcpResourcePaddingTest {

    private val iv: String = "69d18631eb38909efc0835299e70b9e2"

    private fun cbcResource(trailingByte: String): CbcLcpResource {
        val slot = slot<ByteArray>()
        val license = mockk<LcpLicense>()
        coEvery { license.decrypt(capture(slot)) } answers {
            Try.success(slot.captured.sliceArray(16 until slot.captured.size))
        }

        val content = "00".repeat(31) + trailingByte
        val encrypted = InMemoryResource(
            sourceUrl = null,
            properties = Resource.Properties(),
            bytes = { Try.success((iv + content).hexToByteArray()) }
        )

        return CbcLcpResource(resource = encrypted, originalLength = null, license = license)
    }

    @Test
    fun `a padding byte above 0x7f is rejected instead of sign-extended`() = runTest {
        // 0xd3 sign-extends to -45, which used to make the end padding negative and slice past the
        // end of the decrypted array.
        val result = cbcResource("d3").read(0 until 48L)

        assertTrue(result is Try.Failure, "expected a decoding failure, got $result")
        assertTrue(
            result.value is ReadError.Decoding,
            "expected ReadError.Decoding, got ${result.value}"
        )
    }

    @Test
    fun `a padding byte of zero is rejected`() = runTest {
        val result = cbcResource("00").read(0 until 48L)

        assertTrue(result is Try.Failure, "expected a decoding failure, got $result")
    }

    @Test
    fun `a legal padding length still decrypts`() = runTest {
        val result = cbcResource("01").read(0 until 48L)

        assertTrue(result is Try.Success, "expected success, got $result")
    }
}
