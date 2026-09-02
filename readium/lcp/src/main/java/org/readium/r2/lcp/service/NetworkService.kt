/*
 * Module: r2-lcp-kotlin
 * Developers: Aferdita Muriqi
 *
 * Copyright (c) 2019. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

package org.readium.r2.lcp.service

import android.net.Uri
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.math.round
import kotlin.time.Duration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.buffer
import okio.sink
import org.readium.r2.lcp.LcpError
import org.readium.r2.lcp.LcpException
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.mediatype.MediaType
import timber.log.Timber

internal typealias URLParameters = Map<String, String>

internal class NetworkException(val status: Int?, cause: Throwable? = null) : Exception(
    "Network failure with status $status",
    cause
)

internal class NetworkService {
    enum class Method(val value: String) {
        GET("GET"),
        POST("POST"),
        PUT("PUT"),
        ;

        companion object {
            operator fun invoke(value: String) = values().firstOrNull { it.value == value }
        }
    }

    private val downloadHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            // RallyReader fork patch: resolve the CDN host through a system-first, DNS-over-HTTPS
            // fallback resolver so the publication download survives a broken device DNS.
            .dns(systemThenDohDns())
            .build()
    }

    // RallyReader fork patch: was a bare HttpURLConnection, unpooled and with no read timeout.
    private val apiHttpClient: OkHttpClient by lazy {
        downloadHttpClient.newBuilder()
            .connectTimeout(API_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(API_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(API_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(API_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .build()
    }

    suspend fun fetch(
        url: String,
        method: Method = Method.GET,
        parameters: URLParameters = emptyMap(),
        timeout: Duration? = null,
        headers: Map<String, String> = emptyMap(),
    ): Try<ByteArray, NetworkException> =
        withContext(Dispatchers.IO) {
            try {
                val requestUrl = Uri.parse(url)
                    .buildUpon()
                    .appendQueryParameters(parameters)
                    .build()
                    .toString()

                val request = Request.Builder()
                    .url(requestUrl)
                    .method(method.value, method.emptyRequestBodyOrNull())
                    .appendRequestHeaders(headers)
                    .build()

                val call = apiHttpClient.newCall(request)
                if (timeout != null) {
                    call.timeout().timeout(timeout.inWholeMilliseconds, TimeUnit.MILLISECONDS)
                }

                call.execute().use { response ->
                    if (response.code >= 400) {
                        Try.failure(NetworkException(response.code))
                    } else {
                        Try.success(response.body?.bytes() ?: ByteArray(0))
                    }
                }
            } catch (e: Exception) {
                Timber.e(e)
                Try.failure(NetworkException(status = null, cause = e))
            }
        }

    private fun Method.emptyRequestBodyOrNull(): RequestBody? =
        when (this) {
            Method.GET -> null
            Method.POST, Method.PUT -> ByteArray(0).toRequestBody(null)
        }

    private fun Request.Builder.appendRequestHeaders(headers: Map<String, String>): Request.Builder =
        apply {
            for ((key, value) in headers) {
                header(key, value)
            }
        }

    private fun Uri.Builder.appendQueryParameters(parameters: URLParameters): Uri.Builder =
        apply {
            for ((key, value) in parameters) {
                appendQueryParameter(key, value)
            }
        }

    suspend fun download(
        url: Url,
        destination: File,
        mediaType: MediaType? = null,
        onProgress: (Double) -> Unit,
    ): MediaType? = withContext(Dispatchers.IO) {
        coroutineContext.ensureActive()

        val request = Request.Builder()
            .url(url.toString())
            .header("Accept-Encoding", "identity")
            .build()

        try {
            downloadHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw LcpException(LcpError.Network(NetworkException(response.code)))
                }

                val body = response.body
                    ?: throw LcpException(LcpError.Network(NetworkException(null)))

                val expectedLength = body.contentLength().toDouble()
                destination.requireFreeSpaceFor(body.contentLength())
                var readLength = 0L
                var lastProgress = 0.0

                val source = body.source()
                destination.sink().buffer().use { sink ->
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = source.read(sink.buffer, DOWNLOAD_READ_BUFFER_BYTES)
                        if (n == -1L) break
                        sink.emit()
                        readLength += n

                        if (expectedLength > 0) {
                            val progress = (readLength / expectedLength)
                                .coerceIn(0.0, 1.0)
                                .roundToDecimals(2)
                            if (lastProgress < progress) {
                                onProgress(progress)
                                lastProgress = progress
                            }
                        }
                    }
                }

                body.contentType()?.toString()
                    ?.let { MediaType(it) }
                    ?: mediaType
            }
        } catch (e: LcpException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e)
            throw LcpException(LcpError.Network(e))
        }
    }
}

/**
 * Fails the download before a single byte is written when the volume cannot hold the publication.
 *
 * Letting the copy run until the filesystem returns ENOSPC leaves a truncated file behind and
 * wastes the whole transfer, so the announced Content-Length is checked against the free space
 * up front. Servers that omit Content-Length report -1 and the download proceeds as before,
 * surfacing ENOSPC from the write instead.
 */
private fun File.requireFreeSpaceFor(contentLength: Long) {
    if (contentLength <= 0) return

    val volume = parentFile ?: return
    val availableBytes = volume.usableSpace
    if (availableBytes <= 0) return

    val requiredBytes = contentLength + DOWNLOAD_FREE_SPACE_MARGIN_BYTES
    if (availableBytes < requiredBytes) {
        throw LcpException(
            LcpError.Network(
                IOException(
                    "ENOSPC (No space left on device): downloading $contentLength bytes to " +
                        "$path needs $requiredBytes bytes but only $availableBytes are available"
                )
            )
        )
    }
}

private fun Double.roundToDecimals(decimals: Int): Double {
    var multiplier = 1.0
    repeat(decimals) { multiplier *= 10 }
    return round(this * multiplier) / multiplier
}

private const val API_CONNECT_TIMEOUT_SECONDS: Long = 15
private const val API_READ_TIMEOUT_SECONDS: Long = 20
private const val API_CALL_TIMEOUT_SECONDS: Long = 30

private const val DOWNLOAD_READ_BUFFER_BYTES: Long = 64 * 1024

// Headroom the app still needs after the download lands: the license injection rewrites the
// archive and the caller moves it into place.
private const val DOWNLOAD_FREE_SPACE_MARGIN_BYTES: Long = 100L * 1024 * 1024
