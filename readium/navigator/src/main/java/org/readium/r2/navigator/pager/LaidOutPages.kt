package org.readium.r2.navigator.pager

/**
 * Which pages of a spread have laid out since they last started loading.
 *
 * The two pages of a fixed-layout spread load in parallel and either can lay out first, so the
 * spread being loaded says nothing about the other page. A script sent to a page still loading is
 * lost, and that page restores its own decorations once it lays out (RR-6420).
 */
internal class LaidOutPages {

    enum class Page { LEFT, RIGHT }

    private val laidOut = mutableSetOf<Page>()

    fun loading(page: Page) {
        laidOut.remove(page)
    }

    fun laidOut(page: Page) {
        laidOut.add(page)
    }

    fun clear() {
        laidOut.clear()
    }

    /** The views of the pages that have laid out, left first. */
    fun <T : Any> select(left: T?, right: T?): List<T> = listOfNotNull(
        left?.takeIf { Page.LEFT in laidOut },
        right?.takeIf { Page.RIGHT in laidOut }
    )
}
