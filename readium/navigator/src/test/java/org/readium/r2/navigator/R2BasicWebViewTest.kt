package org.readium.r2.navigator

import android.view.textclassifier.TextClassifier
import android.webkit.WebView
import kotlin.test.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowWebView

@RunWith(RobolectricTestRunner::class)
@Config(shadows = [R2BasicWebViewTest.ClassifierRecordingWebView::class])
class R2BasicWebViewTest {

    @Implements(WebView::class)
    class ClassifierRecordingWebView : ShadowWebView() {
        private var classifier: TextClassifier? = null

        @Implementation
        protected fun setTextClassifier(textClassifier: TextClassifier?) {
            classifier = textClassifier
        }

        @Implementation
        protected fun getTextClassifier(): TextClassifier? = classifier
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
}
