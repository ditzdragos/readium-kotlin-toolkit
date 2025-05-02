/*
 * Module: r2-navigator-kotlin
 * Developers: Aferdita Muriqi, Clément Baumann, Mostapha Idoubihi, Paul Stoica
 *
 * Copyright (c) 2018. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

@file:OptIn(InternalReadiumApi::class)

package org.readium.r2.navigator.pager

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.PointF
import android.graphics.RectF
import android.os.Bundle
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.core.os.BundleCompat
import androidx.core.view.postDelayed
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.flowWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.readium.r2.navigator.R
import org.readium.r2.navigator.R2BasicWebView
import org.readium.r2.navigator.R2WebView
import org.readium.r2.navigator.Selection
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.EpubNavigatorViewModel
import org.readium.r2.navigator.extensions.htmlId
import org.readium.r2.navigator.extensions.optRectF
import org.readium.r2.navigator.preferences.ReadingProgression
import org.readium.r2.shared.DelicateReadiumApi
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.InternalReadiumApi
import org.readium.r2.shared.extensions.tryOrLog
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.Url
import timber.log.Timber

@OptIn(ExperimentalReadiumApi::class, DelicateReadiumApi::class)
internal class R2EpubPageFragment : Fragment() {

    private val resourceUrl: AbsoluteUrl?
        get() = BundleCompat.getParcelable(requireArguments(), "url", AbsoluteUrl::class.java)

    private val rightResourceUrl: AbsoluteUrl?
        get() = BundleCompat.getParcelable(requireArguments(), "rightUrl", AbsoluteUrl::class.java)

    internal val link: Link?
        get() = BundleCompat.getParcelable(requireArguments(), "link", Link::class.java)

    internal val rightLink: Link?
        get() = BundleCompat.getParcelable(requireArguments(), "rightLink", Link::class.java)

    private var pendingLocator: Locator? = null
    private var fixedLayout: Boolean = false

    var webView: R2WebView? = null
        private set

    var webViewRight: R2WebView? = null
        private set

    private lateinit var containerView: View
    private val viewModel: EpubNavigatorViewModel by viewModels(
        ownerProducer = { requireParentFragment() }
    )

    private var isLoading: Boolean = false
    private var isLoadingRight: Boolean = false
    private val _isLoaded = MutableStateFlow(false)

    private var webViewClient = object : WebViewClientCompat() {
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean =
            (view as? R2BasicWebView)?.shouldOverrideUrlLoading(request) == true

        override fun shouldOverrideKeyEvent(view: WebView, event: KeyEvent): Boolean {
            // Do something with the event here
            return false
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            if (view == null) return
            // Handle loading state based on which web view finished loading
            when (view) {
                webView -> {
                    isLoading = false
                    onPageFinished()
                    link?.let {
                        webView?.listener?.onResourceLoaded(webView!!, it)
                    }
                    webView?.onContentReady {
                        // Make left web view visible when loaded
                        view.visibility = View.VISIBLE
                        Timber.d("Left page finished loading and made visible")

                        // Call onPageLoaded for left page
                        link?.let {
                            webView?.listener?.onPageLoaded(webView!!, it)
                        }

                        onLoadPage()
                    }
                }

                webViewRight -> {
                    isLoadingRight = false
                    rightLink?.let {
                        webViewRight?.listener?.onResourceLoaded(webViewRight!!, it)
                    }
                    webViewRight?.onContentReady {
                        // Make right web view visible when loaded
                        view.visibility = View.VISIBLE
                        Timber.d("Right page finished loading and made visible")

                        // Call onPageLoaded for right page
                        rightLink?.let {
                            webViewRight?.listener?.onPageLoaded(webViewRight!!, it)
                        }
                        onLoadPage()
                    }
                }
            }
        }

        @SuppressLint("RequiresFeature")
        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceErrorCompat
        ) {
            super.onReceivedError(view, request, error)
            val errorDescription = error.description.toString()
            val webpageError = errorDescription == NET_ERROR
            Timber.d("Webpage error: $errorDescription")
            // Show error overlay for network errors
            if (webpageError) {
                Timber.d("Will override with blank page")
                val htmlData = "<html><head></head><body></body></html>"
                view.loadUrl("about:blank")
                view.loadDataWithBaseURL(null, htmlData, "text/html", "UTF-8", null)
                view.invalidate()
            }
        }

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? =
            (view as? R2BasicWebView)?.shouldInterceptRequest(view, request)
    }

    internal fun setFontSize(fontSize: Double) {
        Timber.d("setFontSize: $fontSize")
        textZoom = (fontSize * 100).roundToInt()
    }

    private var textZoom: Int = 100
        set(value) {
            field = value
            Timber.d("Text zoom: $value")
            webView?.settings?.textZoom = value
            webViewRight?.settings?.textZoom = value
        }

    /**
     * Indicates whether the resource is fully loaded in the web view.
     */
    @InternalReadiumApi
    val isLoaded: StateFlow<Boolean>
        get() = _isLoaded.asStateFlow()

    /**
     * Waits for the page to be loaded.
     */
    @InternalReadiumApi
    suspend fun awaitLoaded() {
        isLoaded.first { it }
    }

    private val navigator: EpubNavigatorFragment?
        get() = parentFragment as? EpubNavigatorFragment

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(textZoomBundleKey, textZoom)

        super.onSaveInstanceState(outState)
    }

    override fun onViewStateRestored(savedInstanceState: Bundle?) {
        super.onViewStateRestored(savedInstanceState)
        Timber.d("onViewStateRestored: $resourceUrl")
        savedInstanceState
            ?.getInt(textZoomBundleKey)
            ?.takeIf { it > 0 }
            ?.let { textZoom = it }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingLocator = BundleCompat.getParcelable(
            requireArguments(),
            "initialLocator",
            Locator::class.java
        )
        fixedLayout = requireArguments().getBoolean("fixedLayout")
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        Timber.d("onCreateView: $resourceUrl")

        // Choose layout based on whether we have a right resource
        val layoutRes = if (fixedLayout && rightResourceUrl != null) {
            R.layout.readium_navigator_viewpager_fragment_epub_double
        } else {
            R.layout.readium_navigator_viewpager_fragment_epub
        }

        containerView = inflater.inflate(layoutRes, container, false)

        this.webView = containerView.findViewById(R.id.webView)

        // Only initialize right web view if we're using the double layout
        webViewRight = if (fixedLayout && rightResourceUrl != null) {
            containerView.findViewById(R.id.webViewRight)
        } else {
            null
        }

        // Note: Visibility is now handled in onPageFinished
        Timber.d("Web views initialized: left=${webView != null}, right=${webViewRight != null}")

        navigator?.webViewListener?.let { listener ->
            webView?.listener = listener
            webViewRight?.listener = listener

            link?.let { link ->
                // Setup custom Javascript interfaces.
                for ((name, obj) in listener.javascriptInterfacesForResource(link)) {
                    if (obj != null) {
                        webView?.addJavascriptInterface(obj, name)
                    }
                }
            }

            rightLink?.let { link ->
                // Setup custom Javascript interfaces for right page
                for ((name, obj) in listener.javascriptInterfacesForResource(link)) {
                    if (obj != null) {
                        webViewRight?.addJavascriptInterface(obj, name)
                    }
                }
            }
        }

        fun setupWebView(webView: R2WebView, resourceUrl: AbsoluteUrl?) {
            webView.settings.javaScriptEnabled = true
            webView.isVerticalScrollBarEnabled = false
            webView.isHorizontalScrollBarEnabled = false
            webView.settings.useWideViewPort = true
            webView.settings.loadWithOverviewMode = true
            webView.settings.setSupportZoom(false)
            webView.settings.builtInZoomControls = false
            webView.settings.displayZoomControls = false
            webView.resourceUrl = resourceUrl
            webView.setPadding(0, 0, 0, 0)
            webView.webViewClient = webViewClient
            webView.addJavascriptInterface(webView, "Android")
            webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE
            if (fixedLayout) {
                webView.setBackgroundColor(Color.WHITE)
                webView.settings.textZoom = 100
                webView.setInitialScale(1)
                webView.overScrollMode = View.OVER_SCROLL_NEVER
                webView.zoomOut()
            } else {
                webView.settings.textZoom = textZoom
            }
            webView.isHapticFeedbackEnabled = false
            webView.isLongClickable = true
        }

        // Load left page first
        webView?.let {
            setupWebView(it, resourceUrl)
            resourceUrl?.let { url ->
                isLoading = true
                _isLoaded.value = false
                Timber.d("Loading left page: $url")
                it.loadUrl(url.toString())
            }
        }

        // Load right page after a short delay to ensure left page starts loading first
        webViewRight?.let {
            setupWebView(it, rightResourceUrl)
            rightResourceUrl?.let { url ->
                isLoadingRight = true
                Timber.d("Loading right page: $url")
                it.postDelayed({
                                   it.loadUrl(url.toString())
                               }, 100)
            }
        }

        // Forward a tap event when the web view is not ready to propagate the taps. This allows
        // to toggle a navigation UI while a page is loading, for example.
        containerView.setOnClickListenerWithPoint { _, point ->
            webView?.listener?.onTap(point)
        }

        return containerView
    }

    private var isPageFinished = false
    private val pendingPageFinished = mutableListOf<() -> Unit>()

    /**
     * Will run the given [action] when the content of the [WebView] is loaded.
     */
    fun whenPageFinished(action: () -> Unit) {
        if (isPageFinished) {
            action()
        } else {
            pendingPageFinished.add(action)
        }
    }

    private fun onPageFinished() {
        isPageFinished = true
        pendingPageFinished.forEach { it() }
        pendingPageFinished.clear()
    }

    /**
     * Will run the given [action] when the content of the [WebView] is fully laid out.
     */
    private fun WebView.onContentReady(action: () -> Unit) {
        Timber.d("onContentReady $resourceUrl")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.VISUAL_STATE_CALLBACK)) {
            WebViewCompat.postVisualStateCallback(this, 0) {
                action()
            }
        } else {
            // On older devices, there's no reliable way to guarantee the page is fully laid out.
            // As a workaround, we run a dummy JavaScript, then wait for a short delay before
            // assuming it's ready.
            evaluateJavascript("true") {
                postDelayed(500, action)
            }
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val lifecycleOwner = viewLifecycleOwner
        lifecycleOwner.lifecycleScope.launch {
            viewModel.isScrollEnabled
                .flowWithLifecycle(lifecycleOwner.lifecycle)
                .collectLatest { enabled ->
                    webView?.scrollModeFlow?.value = enabled
                    webViewRight?.scrollModeFlow?.value = enabled
                }
        }
    }

    override fun onDestroyView() {
        webView?.listener = null
        webViewRight?.listener = null

        super.onDestroyView()
    }

    override fun onDetach() {
        super.onDetach()

        // Prevent the web view from leaking when its parent is detached.
        // See https://stackoverflow.com/a/19391512/1474476
        webView?.let { wv ->
            (wv.parent as? ViewGroup)?.removeView(wv)
            wv.removeAllViews()
            wv.destroy()
        }
        webViewRight?.let { wv ->
            (wv.parent as? ViewGroup)?.removeView(wv)
            wv.removeAllViews()
            wv.destroy()
        }
    }

    internal val paddingTop: Int get() = containerView.paddingTop
    internal val paddingBottom: Int get() = containerView.paddingBottom

    private fun onLoadPage() {
        Timber.d("onLoadPage: $resourceUrl $isLoading")
//        if (!isLoading) return
        _isLoaded.value = true
        if (view == null) return

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.CREATED) {
                val webView = requireNotNull(webView)

                // Only set _isLoaded to true when both pages are loaded (if right page exists)
                if (webViewRight == null || !isLoadingRight) {
                    _isLoaded.value = true
                }

                pendingLocator
                    ?.let { locator ->
                        loadLocator(
                            webView,
                            requireNotNull(navigator).overflow.value.readingProgression,
                            locator
                        )
                    }
                    .also { pendingLocator = null }
            }
        }
    }

    internal fun loadLocator(locator: Locator) {
        if (!isLoaded.value) {
            pendingLocator = locator
            return
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.CREATED) {
                val webView = getWebView(locator.href)
                    ?: requireNotNull(this@R2EpubPageFragment.webView)
                val epubNavigator = requireNotNull(navigator)
                loadLocator(webView, epubNavigator.overflow.value.readingProgression, locator)
                webView.listener?.onProgressionChanged()
            }
        }
    }

    private suspend fun loadLocator(
        webView: R2WebView,
        readingProgression: ReadingProgression,
        locator: Locator
    ) {
        if (locator.text.highlight != null) {
            if (webView.scrollToLocator(locator)) {
                return
            }
        }

        val htmlId = locator.locations.htmlId
        if (htmlId != null && webView.scrollToId(htmlId)) {
            return
        }

        var progression = locator.locations.progression ?: 0.0

        Timber.d("Loading locator: $progression")
        Timber.d("Loading locator mode: $webView.scrollMode")

        // We need to reverse the progression with RTL because the Web View
        // always scrolls from left to right, no matter the reading direction.
        progression =
            if (webView.scrollMode || readingProgression == ReadingProgression.LTR) {
                progression
            } else {
                1 - progression
            }

        if (webView.scrollMode) {
            webView.scrollToPosition(progression)
        } else {
            // Figure out the target web view "page" from the requested
            // progression.
            var item = (progression * webView.numPages).roundToInt()
            if (readingProgression == ReadingProgression.RTL && item > 0) {
                item -= 1
            }
            webView.setCurrentItem(item, false)
        }
    }

    internal fun getWebView(href: Url?): R2WebView? {
        Timber.d("getWebView: $href vs ${rightLink?.url()}")
        return if (href == rightLink?.url()) {
            webViewRight
        } else {
            webView
        }
    }

    /**
     * Gets the current text selection.
     */
    internal suspend fun currentSelection(currentLocator: Pair<Locator?, Locator?>): Selection? {
        // First try main webView
        val mainSelection = webView?.let { webView ->
            suspendCoroutine { continuation ->
                webView.runJavaScript("readium.getCurrentSelection();") { result ->
                    val json = result.takeIf { it != "null" }
                        ?.let { tryOrLog { JSONObject(it) } }

                    if (json == null) {
                        continuation.resume(null)
                        return@runJavaScript
                    }

                    val rect = json.optRectF("rect")
                        ?.run {
                            RectF(left, top + paddingTop, right, bottom + paddingTop)
                        }

                    Timber.d("currentSelection in main webView: $json")

                    val selection = currentLocator.first?.copy(
                        text = Locator.Text.fromJSON(json.optJSONObject("text"))
                    )?.let {
                        Selection(
                            locator = it,
                            rect = rect
                        )
                    }
                    continuation.resume(selection)
                }
            }
        }

        if (mainSelection != null) {
            return mainSelection
        }

        // Then try right webView if it exists
        return webViewRight?.let { webView ->
            suspendCoroutine { continuation ->
                webView.runJavaScript("readium.getCurrentSelection();") { result ->
                    val json = result.takeIf { it != "null" }
                        ?.let { tryOrLog { JSONObject(it) } }

                    if (json == null) {
                        continuation.resume(null)
                        return@runJavaScript
                    }

                    val rect = json.optRectF("rect")
                        ?.run {
                            RectF(left, top + paddingTop, right, bottom + paddingTop)
                        }

                    Timber.d("currentSelection in right webView: $json")

                    val selection = currentLocator.second?.copy(
                        text = Locator.Text.fromJSON(json.optJSONObject("text"))
                    )?.let {
                        Selection(
                            locator = it,
                            rect = rect
                        )
                    }
                    continuation.resume(selection)
                }
            }
        }
    }

    fun runJavaScript(script: String, callback: ((String) -> Unit)? = null) {
        whenPageFinished {
            requireNotNull(webView).runJavaScript(script, callback)
            webViewRight?.runJavaScript(script, callback)
        }
    }

    suspend fun runJavaScriptSuspend(javascript: String): String = suspendCoroutine { cont ->
        runJavaScript(javascript) { result ->
            if(result != "null") {
                cont.resume(result)
            }
        }
    }

    internal fun setCurrentItem(item: Int, smoothScroll: Boolean = false) {
        webView?.setCurrentItem(item, smoothScroll)
        webViewRight?.setCurrentItem(item, smoothScroll)
    }

    internal fun setInitialItem(readingProgression: ReadingProgression) {
        webView?.let { webView ->
            if (readingProgression == ReadingProgression.RTL) {
                webView.setCurrentItem(0, false)
            } else {
                webView.setCurrentItem(webView.numPages - 1, false)
            }
        }
        webViewRight?.let { webView ->
            if (readingProgression == ReadingProgression.RTL) {
                webView.setCurrentItem(0, false)
            } else {
                webView.setCurrentItem(webView.numPages - 1, false)
            }
        }
    }

    companion object {
        private const val NET_ERROR = "net::ERR_FAILED"
        private const val textZoomBundleKey = "textZoom"

        fun newInstance(
            url: AbsoluteUrl,
            link: Link? = null,
            initialLocator: Locator? = null,
            fixedLayout: Boolean = false,
            rightUrl: AbsoluteUrl? = null,
            rightLink: Link? = null,
            positionCount: Int = 0,
        ): R2EpubPageFragment =
            R2EpubPageFragment().apply {
                arguments = Bundle().apply {
                    putParcelable("url", url)
                    putParcelable("link", link)
                    putParcelable("initialLocator", initialLocator)
                    putLong("positionCount", positionCount.toLong())
                    putBoolean("fixedLayout", fixedLayout)
                    putParcelable("rightUrl", rightUrl)
                    putParcelable("rightLink", rightLink)
                }
            }
    }
}

/**
 * Same as setOnClickListener, but will also report the tap point in the view.
 */
private fun View.setOnClickListenerWithPoint(action: (View, PointF) -> Unit) {
    var point = PointF()

    setOnTouchListener { _, event ->
        if (event.action == MotionEvent.ACTION_DOWN) {
            point = PointF(event.x, event.y)
        }
        false
    }

    setOnClickListener {
        action(it, point)
    }
}
