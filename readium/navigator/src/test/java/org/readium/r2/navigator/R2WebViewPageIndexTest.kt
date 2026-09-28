/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator

import io.mockk.every
import io.mockk.spyk
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class R2WebViewPageIndexTest {

    private fun webViewScrolledTo(scrollX: Int, pageWidth: Int): R2WebView {
        val webView = spyk(
            R2WebView(RuntimeEnvironment.getApplication(), Robolectric.buildAttributeSet().build())
        )
        every { webView["computeHorizontalScrollExtent"]() } returns pageWidth
        every { webView.scrollX } returns scrollX
        return webView
    }

    @Test
    fun `reading the page index at the scroll position leaves the current item unchanged`() {
        val webView = webViewScrolledTo(scrollX = 2000, pageWidth = 1000)
        webView.mCurItem = 1

        assertEquals(2, webView.pageIndexAtScroll())
        assertEquals(1, webView.mCurItem)
    }

    @Test
    fun `the page index rounds a scroll offset that is not a whole page`() {
        val webView = webViewScrolledTo(scrollX = 2600, pageWidth = 1000)

        assertEquals(3, webView.pageIndexAtScroll())
    }

    @Test
    fun `the page index falls back to the current item before the page has a width`() {
        val webView = webViewScrolledTo(scrollX = 2000, pageWidth = 0)
        webView.mCurItem = 4

        assertEquals(4, webView.pageIndexAtScroll())
    }

    @Test
    fun `updating the current item moves it to the scroll position`() {
        val webView = webViewScrolledTo(scrollX = 2000, pageWidth = 1000)
        webView.mCurItem = 1

        webView.updateCurrentItem()

        assertEquals(2, webView.mCurItem)
    }
}
