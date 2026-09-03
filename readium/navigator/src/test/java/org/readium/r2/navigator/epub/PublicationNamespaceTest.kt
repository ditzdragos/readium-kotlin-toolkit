package org.readium.r2.navigator.epub

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.shared.util.Url
import org.robolectric.RobolectricTestRunner

/**
 * Two books converted by the same toolchain share their internal hrefs, so serving every
 * publication under one base href mapped them onto a single web view URL. Non-HTML responses are
 * served immutable for a day, so the second book was answered out of the first book's cache entry
 * and the reader showed the previously opened book. (RR-8935)
 */
@RunWith(RobolectricTestRunner::class)
class PublicationNamespaceTest {

    private val sharedHref = Url("OPS/html/page-001.xhtml")!!

    @Test
    fun `two publications serve a shared href at different urls`() {
        val first = publicationBaseHrefFor(publicationPathPrefixFor("book-a"))
        val second = publicationBaseHrefFor(publicationPathPrefixFor("book-b"))

        assertNotEquals(first.resolve(sharedHref), second.resolve(sharedHref))
    }

    @Test
    fun `a served url carries its own namespace prefix and gives the href back`() {
        val prefix = publicationPathPrefixFor("book-a")
        val url = publicationBaseHrefFor(prefix).resolve(sharedHref)

        val path = url.path!!
        assertTrue(path.startsWith(prefix))
        assertEquals(sharedHref.toString(), path.removePrefix(prefix))
    }

    @Test
    fun `a url from another publication does not match this namespace`() {
        val prefix = publicationPathPrefixFor("book-a")
        val foreign = publicationBaseHrefFor(publicationPathPrefixFor("book-b"))
            .resolve(sharedHref)

        assertFalse(foreign.path!!.startsWith(prefix))
    }

    @Test
    fun `every publication namespace stays under the publication path`() {
        assertEquals("/publication/book-a/", publicationPathPrefixFor("book-a"))
    }
}
