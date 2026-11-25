package org.readium.r2.navigator

import android.view.textclassifier.TextClassifier
import android.webkit.WebSettings
import android.webkit.WebView
import kotlin.test.assertFalse
import kotlin.test.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.fakes.RoboWebSettings
import org.robolectric.shadows.ShadowWebView

@RunWith(RobolectricTestRunner::class)
@Config(shadows = [R2BasicWebViewTest.PlatformDefaultsWebView::class])
class R2BasicWebViewTest {

    @Implements(WebView::class)
    class PlatformDefaultsWebView : ShadowWebView() {
        private var classifier: TextClassifier? = null

        @Implementation
        protected fun setTextClassifier(textClassifier: TextClassifier?) {
            classifier = textClassifier
        }

        @Implementation
        protected fun getTextClassifier(): TextClassifier? = classifier

        private val settings = RoboWebSettings().apply { setNeedInitialFocus(true) }

        @Implementation
        override fun getSettings(): WebSettings = settings
    }

    private val attrs = Robolectric.buildAttributeSet().build()

    @Test
    fun `a page web view never widens a long-pressed word through smart selection`() {
        val webView = R2BasicWebView(RuntimeEnvironment.getApplication(), attrs)

        assertSame(TextClassifier.NO_OP, webView.textClassifier)
    }

    @Test
    fun `a paginated web view never widens a long-pressed word through smart selection`() {
        val webView = R2WebView(RuntimeEnvironment.getApplication(), attrs)

        assertSame(TextClassifier.NO_OP, webView.textClassifier)
    }

    @Test
    fun `a page web view taking focus never scrolls to its first link`() {
        val webView = R2BasicWebView(RuntimeEnvironment.getApplication(), attrs)

        assertFalse((webView.settings as RoboWebSettings).needInitialFocus)
    }

    @Test
    fun `a paginated web view taking focus never scrolls to its first link`() {
        val webView = R2WebView(RuntimeEnvironment.getApplication(), attrs)

        assertFalse((webView.settings as RoboWebSettings).needInitialFocus)
    }
}
