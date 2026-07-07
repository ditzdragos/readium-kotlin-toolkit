package org.readium.r2.shared.util.data

import org.junit.Assert.assertTrue
import org.junit.Test
import org.readium.r2.shared.util.Url

class CachingContainerTest {

    private class FakeContainer(val onClose: () -> Unit) : Container<Readable> {
        override val entries: Set<Url> = emptySet()
        override fun get(url: Url): Readable? = null
        override fun close() { onClose() }
    }

    @Test
    fun `close closes the underlying container`() {
        var closed = false
        val container = CachingContainer(FakeContainer { closed = true })

        container.close()

        assertTrue("underlying container should be closed", closed)
    }
}
