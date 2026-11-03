package org.readium.r2.navigator.pager

import kotlin.test.assertEquals
import org.junit.Test
import org.readium.r2.navigator.pager.LaidOutPages.Page

class LaidOutPagesTest {

    private val pages = LaidOutPages()

    private fun targets(): List<String> = pages.select("left", "right")

    @Test
    fun `a spread whose right page lays out first reaches only the right page`() {
        pages.loading(Page.LEFT)
        pages.loading(Page.RIGHT)

        pages.laidOut(Page.RIGHT)

        assertEquals(listOf("right"), targets())
    }

    @Test
    fun `both pages are reached once both have laid out`() {
        pages.laidOut(Page.RIGHT)
        pages.laidOut(Page.LEFT)

        assertEquals(listOf("left", "right"), targets())
    }

    @Test
    fun `a page that starts loading again is skipped until it lays out`() {
        pages.laidOut(Page.LEFT)
        pages.laidOut(Page.RIGHT)

        pages.loading(Page.LEFT)

        assertEquals(listOf("right"), targets())
    }

    @Test
    fun `a single-page spread has no right page to reach`() {
        pages.laidOut(Page.LEFT)

        assertEquals(listOf("left"), pages.select("left", null))
    }

    @Test
    fun `an unloaded spread reaches no page`() {
        pages.laidOut(Page.LEFT)
        pages.laidOut(Page.RIGHT)

        pages.clear()

        assertEquals(emptyList(), targets())
    }
}
