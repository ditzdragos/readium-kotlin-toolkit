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
import android.graphics.PointF
import android.os.Bundle
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.core.os.BundleCompat
import androidx.core.view.ViewCompat
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
import org.readium.r2.navigator.R
import org.readium.r2.navigator.R2BasicWebView
import org.readium.r2.navigator.R2WebView
import org.readium.r2.navigator.databinding.ReadiumNavigatorViewpagerFragmentEpubBinding
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.EpubNavigatorViewModel
import org.readium.r2.navigator.extensions.htmlId
import org.readium.r2.navigator.preferences.ReadingProgression
import org.readium.r2.navigator.util.isChromeBook
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.InternalReadiumApi
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.util.AbsoluteUrl
import timber.log.Timber


@OptIn(ExperimentalReadiumApi::class)
internal class R2EpubPageFragment : Fragment() {

    private val resourceUrl: AbsoluteUrl?
        get() = BundleCompat.getParcelable(requireArguments(), "url", AbsoluteUrl::class.java)

    internal val link: Link?
        get() = BundleCompat.getParcelable(requireArguments(), "link", Link::class.java)

    private var pendingLocator: Locator? = null
    private var fixedLayout: Boolean = false

    var webView: R2WebView? = null
        private set

    private lateinit var containerView: View
    private val viewModel: EpubNavigatorViewModel by viewModels(
        ownerProducer = { requireParentFragment() }
    )

    private var _binding: ReadiumNavigatorViewpagerFragmentEpubBinding? = null
    private val binding get() = _binding!!

    private var isLoading: Boolean = false
    private val _isLoaded = MutableStateFlow(false)
    private var webViewClient = object : WebViewClientCompat() {
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean =
            (webView as? R2BasicWebView)?.shouldOverrideUrlLoading(request) == true

        override fun shouldOverrideKeyEvent(view: WebView, event: KeyEvent): Boolean {
            // Do something with the event here
            return false
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            onPageFinished()

            link?.let {
                webView?.listener?.onResourceLoaded(webView!!, it)
            }

            webView?.onContentReady {
                onLoadPage()
            }

            if (fixedLayout && view != null) {
                injectCenteringJavaScript(view)
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
            (webView as? R2BasicWebView)?.shouldInterceptRequest(view, request)
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

    private val shouldApplyInsetsPadding: Boolean
        get() = navigator?.config?.shouldApplyInsetsPadding != false

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
        _binding = ReadiumNavigatorViewpagerFragmentEpubBinding.inflate(inflater, container, false)
        containerView = binding.root

        val webView = binding.webView
        this.webView = webView

        webView.visibility = View.INVISIBLE
        navigator?.webViewListener?.let { listener ->
            webView.listener = listener

            link?.let { link ->
                // Setup custom Javascript interfaces.
                for ((name, obj) in listener.javascriptInterfacesForResource(link)) {
                    if (obj != null) {
                        webView.addJavascriptInterface(obj, name)
                    }
                }
            }
        }

        webView.settings.javaScriptEnabled = true
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.settings.useWideViewPort = !isChromeBook()
        webView.settings.loadWithOverviewMode = true
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        webView.resourceUrl = resourceUrl
        webView.setPadding(0, 0, 0, 0)
        webView.webViewClient = webViewClient
        webView.addJavascriptInterface(webView, "Android")
        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT
        webView.zoomOut()
        if (fixedLayout) {
            webView.overScrollMode = View.OVER_SCROLL_NEVER
        } else {
            webView.settings.textZoom = textZoom
        }
        webView.isHapticFeedbackEnabled = false
        webView.isLongClickable = true

        resourceUrl?.let {
            isLoading = true
            _isLoaded.value = false
            webView.loadUrl(it.toString())
        }

        setupPadding()

        // Forward a tap event when the web view is not ready to propagate the taps. This allows
        // to toggle a navigation UI while a page is loading, for example.
        binding.root.setOnClickListenerWithPoint { _, point ->
            webView.listener?.onTap(point)
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
                .collectLatest { webView?.scrollModeFlow?.value = it }
        }
    }

    override fun onDestroyView() {
        webView?.listener = null
        _binding = null

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
    }

    private fun setupPadding() {
        updatePadding()

        // Update padding when the scroll mode changes
        viewLifecycleOwner.lifecycleScope.launch {
            webView?.scrollModeFlow?.collectLatest {
                updatePadding()
            }
        }

        if (shouldApplyInsetsPadding) {
            // Update padding when the window insets change, for example when the navigation and status
            // bars are toggled.
            ViewCompat.setOnApplyWindowInsetsListener(containerView) { _, insets ->
                updatePadding()
                insets
            }
        }
    }

    private fun updatePadding() {
        if (view == null) return

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
                val window = activity?.window ?: return@repeatOnLifecycle
                var top = 0
                var bottom = 0

                // Add additional padding to take into account the display cutout, if needed.
                if (
                    shouldApplyInsetsPadding &&
                    android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P &&
                    window.attributes.layoutInDisplayCutoutMode != WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
                ) {
                    // Request the display cutout insets from the decor view because the ones given by
                    // setOnApplyWindowInsetsListener are not always correct for preloaded views.
                    window.decorView.rootWindowInsets?.displayCutout?.let { displayCutoutInsets ->
                        top += displayCutoutInsets.safeInsetTop
                        bottom += displayCutoutInsets.safeInsetBottom
                    }
                }

                if (!viewModel.isScrollEnabled.value) {
                    val margin =
                        resources.getDimension(R.dimen.readium_navigator_epub_vertical_padding)
                            .toInt()
                    top += margin
                    bottom += margin
                }

                containerView.setPadding(0, top, 0, bottom)
            }
        }
    }

    internal val paddingTop: Int get() = containerView.paddingTop
    internal val paddingBottom: Int get() = containerView.paddingBottom


    private fun onLoadPage() {
        if (!isLoading) return
        isLoading = false
        _isLoaded.value = true

        if (view == null) return

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.CREATED) {
                val webView = requireNotNull(webView)
                webView.visibility = View.VISIBLE

                pendingLocator
                    ?.let { locator ->
                        loadLocator(
                            webView,
                            requireNotNull(navigator).overflow.value.readingProgression,
                            locator
                        )
                    }
                    .also { pendingLocator = null }

                link?.let {
                    webView.listener?.onPageLoaded(webView, it)
                }
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
                val webView = requireNotNull(webView)
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

    fun runJavaScript(script: String, callback: ((String) -> Unit)? = null) {
        whenPageFinished {
            requireNotNull(webView).runJavaScript(script, callback)
        }
    }

    suspend fun runJavaScriptSuspend(javascript: String): String = suspendCoroutine { cont ->
        runJavaScript(javascript) { result ->
            cont.resume(result)
        }
    }

    private fun injectCenteringJavaScript(webView: WebView) {
        val javascript = """
        javascript:(function() {
            // Disable scrolling immediately
            document.documentElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';

            // Get dimensions
            var contentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
            var contentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
            var viewportWidth = window.innerWidth;
            var viewportHeight = window.innerHeight;

            console.log('Content dimensions: ' + contentWidth + 'x' + contentHeight);
            console.log('Viewport dimensions: ' + viewportWidth + 'x' + viewportHeight);

            // Check if viewport dimensions in metadata
            var metaViewport = document.querySelector('meta[name="viewport"]');
            var metaWidth = contentWidth;
            var metaHeight = contentHeight;

            if (metaViewport) {
                var content = metaViewport.getAttribute('content');
                var widthMatch = content.match(/width=([0-9]+)/);
                var heightMatch = content.match(/height=([0-9]+)/);
                if (widthMatch && heightMatch) {
                    metaWidth = parseInt(widthMatch[1]);
                    metaHeight = parseInt(heightMatch[1]);
                    console.log('Meta viewport dimensions: ' + metaWidth + 'x' + metaHeight);
                }
            }

            // Use meta viewport dimensions if available
            if (metaWidth && metaHeight) {
                contentWidth = metaWidth;
                contentHeight = metaHeight;
            }

            // Calculate scale factors
            var scaleX = viewportWidth / contentWidth;
            var scaleY = viewportHeight / contentHeight;
            var scale = Math.min(scaleX, scaleY) * 0.97;

            console.log('Scale factors - X: ' + scaleX + ', Y: ' + scaleY + ', Using: ' + scale);

            // Reset HTML document styles
            document.documentElement.style = "";
            document.documentElement.style.margin = '0';
            document.documentElement.style.padding = '0';
            document.documentElement.style.width = '100vw';
            document.documentElement.style.height = '100vh';
            document.documentElement.style.overflow = 'hidden';

            // Create a container for centering
            var centeringContainer = document.createElement('div');
            centeringContainer.id = 'r2CenteringContainer';
            centeringContainer.style.position = 'fixed';
            centeringContainer.style.width = '100%';
            centeringContainer.style.height = '100%';
            centeringContainer.style.display = 'flex';
            centeringContainer.style.justifyContent = 'center';
            centeringContainer.style.alignItems = 'center';
            centeringContainer.style.overflow = 'hidden';

            // Create a scaling container
            var scalingContainer = document.createElement('div');
            scalingContainer.id = 'r2ScalingContainer';
            scalingContainer.style.width = contentWidth + 'px';
            scalingContainer.style.height = contentHeight + 'px';
            scalingContainer.style.position = 'relative';
            scalingContainer.style.transform = 'scale(' + scale + ')';
            scalingContainer.style.transformOrigin = 'center center';

            // Preserve the original body content and styles
            document.body.style.margin = '0';
            document.body.style.padding = '0';
            document.body.style.width = contentWidth + 'px';
            document.body.style.height = contentHeight + 'px';
            document.body.style.position = 'relative';
            document.body.style.overflow = 'visible';

            // Handle specific case of this layout - detach nodes to avoid DOM issues
            var bodyContent = [];
            while (document.body.firstChild) {
                bodyContent.push(document.body.removeChild(document.body.firstChild));
            }

            // Restructure DOM for proper centering and scaling
            document.body.appendChild(centeringContainer);
            centeringContainer.appendChild(scalingContainer);

            // Re-add the original content to the scaling container
            bodyContent.forEach(function(node) {
                scalingContainer.appendChild(node);
            });

            // Find all images in the document
            var allImages = document.querySelectorAll('img');
            for (var i = 0; i < allImages.length; i++) {
                var img = allImages[i];

                // Skip images inside our wrapper elements
                if (img.closest('#r2CenteringContainer') === centeringContainer ||
                    img.closest('#r2ScalingContainer') === scalingContainer) {
                    continue;
                }

                // Check if this looks like a background image
                var parent = img.parentElement;
                if (parent &&
                    (parent.className.indexOf('image') !== -1 ||
                     parent.className.indexOf('background') !== -1 ||
                     parent.className.indexOf('container') !== -1)) {
                    // Apply background image styling
                    img.style.width = '100%';
                    img.style.height = 'auto';
                    img.style.position = 'absolute';
                    img.style.top = '0';
                    img.style.left = '0';
                    console.log('Applied background styling to image in container');
                }

                // Or check if image seems to be a full-page background image
                var rect = img.getBoundingClientRect();
                if (rect.width > contentWidth * 0.8 && rect.height > contentHeight * 0.8) {
                    img.style.width = '100%';
                    img.style.height = 'auto';
                    img.style.position = 'absolute';
                    img.style.top = '0';
                    img.style.left = '0';
                    console.log('Applied background styling to full-page image');
                }
            }

            // Handle text elements that need to be positioned over images
            var allDivs = document.querySelectorAll('div');
            for (var i = 0; i < allDivs.length; i++) {
                var div = allDivs[i];

                // Skip our wrapper divs
                if (div.id === 'r2CenteringContainer' || div.id === 'r2ScalingContainer') {
                    continue;
                }

                // Handle any div that has text content
                if (div.textContent && div.textContent.trim()) {
                    // Check if it has styling that suggests text overlay
                    var style = window.getComputedStyle(div);
                    if (style.position === 'absolute' ||
                        div.className.indexOf('text') !== -1) {
                        div.style.position = 'absolute';
                        div.style.transformOrigin = 'top left';
                        console.log('Applied text positioning to', div.className);
                    }
                }
            }

            console.log('Content wrapped and scaled uniformly by: ' + scale);
        })();
    """.trimIndent()

        webView.evaluateJavascript(javascript, null)
    }

    companion object {
        private const val NET_ERROR = "net::ERR_FAILED"
        private const val textZoomBundleKey = "org.readium.textZoom"

        fun newInstance(
            url: AbsoluteUrl,
            link: Link? = null,
            initialLocator: Locator? = null,
            positionCount: Int = 0,
            fixedLayout: Boolean = false
        ): R2EpubPageFragment =
            R2EpubPageFragment().apply {
                arguments = Bundle().apply {
                    putParcelable("url", url)
                    putParcelable("link", link)
                    putParcelable("initialLocator", initialLocator)
                    putLong("positionCount", positionCount.toLong())
                    putBoolean("fixedLayout", fixedLayout)
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
