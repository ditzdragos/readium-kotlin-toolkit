package org.readium.r2.lcp

import io.mockk.coEvery
import io.mockk.mockk
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.resource.InMemoryResource

class CbcLcpResourceWholeReadTest {

    private val key = SecretKeySpec(Random(1).nextBytes(32), "AES")
    private val decryptCalls = AtomicInteger()

    /** IV followed by the AES-256-CBC, PKCS#7-padded ciphertext of [plain], as LCP stores it. */
    private fun encrypt(plain: ByteArray): ByteArray {
        val iv = Random(2).nextBytes(16)
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, key, IvParameterSpec(iv))
        return iv + cipher.doFinal(plain)
    }

    /** Decrypts like liblcp: the first block is the IV, nothing is unpadded. */
    private val license = mockk<LcpLicense>().also {
        coEvery { it.decrypt(any()) } answers {
            decryptCalls.incrementAndGet()
            val data = firstArg<ByteArray>()
            val cipher = Cipher.getInstance("AES/CBC/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, IvParameterSpec(data.copyOfRange(0, 16)))
            Try.success(cipher.doFinal(data, 16, data.size - 16))
        }
    }

    private fun resource(plain: ByteArray) =
        CbcLcpResource(InMemoryResource(encrypt(plain)), license, plain.size.toLong())

    private fun bytes(size: Int) = Random(size).nextBytes(size)

    @Test
    fun `a large resource decrypts in parallel chunks to the same bytes`() = runTest {
        for (size in listOf(1024 * 1024, 3 * 1024 * 1024 + 7, 2 * 1024 * 1024 - 1)) {
            decryptCalls.set(0)
            val plain = bytes(size)

            val read = resource(plain).read()

            assertContentEquals(plain, read.getOrNull(), "size $size")
            assertEquals(4, decryptCalls.get(), "size $size")
        }
    }

    @Test
    fun `a resource under two chunks decrypts in one call`() = runTest {
        val plain = bytes(300 * 1024)

        val read = resource(plain).read()

        assertContentEquals(plain, read.getOrNull())
        assertEquals(1, decryptCalls.get())
    }

    @Test
    fun `a chunk failing to decrypt fails the read`() = runTest {
        val failing = mockk<LcpLicense>()
        coEvery { failing.decrypt(any()) } returns Try.failure(LcpError.CrlFetching)
        val plain = bytes(1024 * 1024)

        val read = CbcLcpResource(InMemoryResource(encrypt(plain)), failing).read()

        assertTrue(read.failureOrNull() is ReadError.Decoding, "got $read")
    }
}
