/*
 * Copyright 2022 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

@file:OptIn(InternalReadiumApi::class)

package org.readium.r2.navigator.epub

import android.app.Application
import android.os.PatternMatcher
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.BufferedInputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.readium.r2.navigator.epub.css.ReadiumCss
import timber.log.Timber
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.InternalReadiumApi
import org.readium.r2.shared.publication.Href
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.data.asInputStream
import org.readium.r2.shared.util.http.HttpHeaders
import org.readium.r2.shared.util.http.HttpRange
import org.readium.r2.shared.publication.encryption.encryption
import org.readium.r2.shared.util.resource.Resource
import org.readium.r2.shared.util.resource.StringResource
import org.readium.r2.shared.util.resource.buffered
import org.readium.r2.shared.util.resource.fallback

/**
 * Serves the publication resources and application assets in the EPUB navigator web views.
 */
@OptIn(ExperimentalReadiumApi::class)
internal class WebViewServer(
    private val application: Application,
    private val publication: Publication,
    servedAssets: List<String>,
    private val disableSelectionWhenProtected: Boolean,
    private val onResourceLoadFailed: (Url, ReadError) -> Unit,
) {
    companion object {
        val publicationBaseHref = AbsoluteUrl("https://readium/publication/")!!
        val assetsBaseHref = AbsoluteUrl("https://readium/assets/")!!

        fun assetUrl(path: String): Url? =
            Url.fromDecodedPath(path)?.let { assetsBaseHref.resolve(it) }
    }

    // Resources are cheap to *describe* but expensive to *build* — each construction
    // re-wraps in LcpDecryptor + BufferingResource and allocates a fresh
    // CachingRangeTailResource (empty cache). One page swipe fans out to 6–12 WebView
    // requests; this LRU keeps the same Resource alive across that fan-out so the
    // 256 KB buffer (Task 3) and decryption state are reused, not rebuilt per chunk.
    //
    // Bounded to 32 entries (~2–3 pages of assets). Evictions call close() on the
    // displaced Resource so file handles and decryption state are released.
    //
    // Thread-safety: cached Resources include a BufferingResource, which holds a
    // single mutable buffer slot. Concurrent reads of the same href from two
    // ReadableInputStreamAdapter instances (e.g. left+right FXL pages showing
    // the same image, or rapid back-navigation) would race on that buffer.
    // WebView's normal request pattern is one InputStream consumer per request,
    // so this is not currently exercised — but if you observe garbled image
    // reads after this cache lands, wrap cached Resources in a Mutex-protected
    // facade or cache the pre-buffered chain instead.
    private val resourceCache: LinkedHashMap<Url, Resource> =
        object : LinkedHashMap<Url, Resource>(32, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Url, Resource>?): Boolean {
                if (size > 32) {
                    runCatching { eldest?.value?.close() }
                        .onFailure { Timber.w(it, "WebViewServer: failed to close evicted Resource") }
                    return true
                }
                return false
            }
        }

    @Synchronized
    private fun cachedResource(url: Url, build: () -> Resource): Resource =
        resourceCache.getOrPut(url, build)

    internal fun clearResourceCache() {
        synchronized(this) {
            resourceCache.values.forEach { resource ->
                runCatching { resource.close() }
                    .onFailure { Timber.w(it, "WebViewServer: failed to close Resource during cache drain") }
            }
            resourceCache.clear()
        }
    }

    /**
     * Serves the requests of the navigator web views.
     *
     * https://readium/publication/ serves the publication resources through its fetcher.
     * https://readium/assets/ serves the application assets.
     */
    fun shouldInterceptRequest(request: WebResourceRequest, css: ReadiumCss): WebResourceResponse? {
        if (request.url.host != "readium") return null
        val path = request.url.path ?: return null

        return when {
            path.startsWith("/publication/") -> {
                val href = Url.fromDecodedPath(path.removePrefix("/publication/"))
                    ?: return null

                servePublicationResource(
                    href = href,
                    range = HttpHeaders(request.requestHeaders).range,
                    css = css
                )
            }
            path.startsWith("/assets/") && isServedAsset(path.removePrefix("/assets/")) -> {
                assetsLoader.shouldInterceptRequest(request.url)
            }
            else -> null
        }
    }

    /**
     * Returns a new [Resource] to serve the given [href] in the publication.
     *
     * If the [Resource] is an HTML document, injects the required JavaScript and CSS files.
     */
    private fun servePublicationResource(href: Url, range: HttpRange?, css: ReadiumCss): WebResourceResponse {
        val link = publication.linkWithHref(href)
            // Query parameters must be kept as they might be relevant for the fetcher.
            ?.copy(href = Href(href))
            ?: Link(href = href)

        // Drop anchor because it is meant to be interpreted by the client.
        val urlWithoutAnchor = href.removeFragment()
        val isHtml = link.mediaType?.isHtml == true

        val resource = if (isHtml) {
            // HTML injects request-scoped ReadiumCss; can't cache across requests.
            buildResource(link, urlWithoutAnchor, css)
        } else {
            cachedResource(urlWithoutAnchor) { buildResource(link, urlWithoutAnchor, css) }
        }

        val headers = mutableMapOf("Accept-Ranges" to "bytes")
        if (!isHtml) headers["Cache-Control"] = "max-age=86400, immutable"

        val knownLength: Long? = link.properties.encryption?.originalLength

        return if (range == null) {
            val body = if (isHtml) BufferedInputStream(resource.asInputStream(), 65536)
                else resource.asInputStream()
            WebResourceResponse(
                link.mediaType?.toString(), null, 200, "OK", headers,
                body
            )
        } else {
            val stream = resource.asInputStream()
            val length: Long = knownLength ?: stream.available().toLong()
            val longRange = range.toLongRange(length)
            headers["Content-Range"] = "bytes ${longRange.first}-${longRange.last}/$length"
            WebResourceResponse(
                link.mediaType?.toString(), null, 206, "Partial Content", headers,
                stream
            )
        }
    }

    private fun buildResource(link: Link, url: Url, css: ReadiumCss): Resource {
        var resource = publication
            .get(url)
            ?.fallback {
                onResourceLoadFailed(url, it)
                errorResource()
            } ?: run {
            val error = ReadError.Decoding(
                "Resource not found at $url in publication."
            )
            onResourceLoadFailed(url, error)
            errorResource()
        }

        link.mediaType
            ?.takeIf { it.isHtml }
            ?.let {
                resource = resource.injectHtml(
                    publication,
                    mediaType = it,
                    css,
                    baseHref = assetsBaseHref,
                    disableSelectionWhenProtected = disableSelectionWhenProtected
                )
            }

        // For non-HTML resources, wrap in BufferingResource so WebView's 8 KB chunked
        // reads get satisfied from an in-memory 256 KB buffer instead of issuing one
        // underlying resource.read() (and one LCP decrypt) per WebView chunk. 256 KB is
        // the trade-off: small enough that peak per-resource memory is bounded
        // (critical on Chromebook ARC++), large enough that the LCP decrypt cost
        // amortises across ~32 WebView chunks. Do NOT switch to a full-buffer
        // ByteArrayInputStream — that path OOMs on Chromebook.
        return if (link.mediaType?.isHtml == true) {
            resource
        } else {
            resource.buffered(bufferSize = 256 * 1024)
        }
    }
    private fun errorResource(): Resource =
        StringResource {
            withContext(Dispatchers.IO) {
                Try.success(
                    application.assets
                        .open("readium/error.xhtml")
                        .bufferedReader()
                        .use { it.readText() }
                )
            }
        }

    private fun isServedAsset(path: String): Boolean =
        servedAssetPatterns.any { it.match(path) }

    private val servedAssetPatterns: List<PatternMatcher> =
        servedAssets.map { PatternMatcher(it, PatternMatcher.PATTERN_SIMPLE_GLOB) }

    private val assetsLoader =
        WebViewAssetLoader.Builder()
            .setDomain("readium")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(application))
            .build()
}
