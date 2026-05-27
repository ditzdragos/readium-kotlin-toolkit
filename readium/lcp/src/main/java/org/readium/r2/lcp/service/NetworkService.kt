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
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.math.round
import kotlin.time.Duration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
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
                @Suppress("NAME_SHADOWING")
                val url = URL(
                    Uri.parse(url).buildUpon().appendQueryParameters(parameters).build().toString()
                )

                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = method.value
                if (timeout != null) {
                    connection.connectTimeout = timeout.inWholeMilliseconds.toInt()
                }
                connection.appendRequestHeaders(headers)

                val status = connection.responseCode
                if (status >= 400) {
                    Try.failure(NetworkException(status))
                } else {
                    Try.success(connection.inputStream.readBytes())
                }
            } catch (e: Exception) {
                Timber.e(e)
                Try.failure(NetworkException(status = null, cause = e))
            }
        }

    private fun HttpURLConnection.appendRequestHeaders(headers: Map<String, String>): HttpURLConnection =
        apply {
            for ((key, value) in headers) {
                setRequestProperty(key, value)
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

        val started = System.currentTimeMillis()

        try {
            downloadHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw LcpException(LcpError.Network(NetworkException(response.code)))
                }

                val body = response.body
                    ?: throw LcpException(LcpError.Network(NetworkException(null)))

                val expectedLength = body.contentLength().toDouble()
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

                val elapsedMs = System.currentTimeMillis() - started
                if (elapsedMs > 0 && readLength > 0) {
                    val mbps = (readLength.toDouble() / (1024.0 * 1024.0)) /
                        (elapsedMs.toDouble() / 1000.0)
                    Timber.i(
                        "LCP download finished: %.2f MB in %d ms (%.2f MB/s, HTTP %s)",
                        readLength / (1024.0 * 1024.0),
                        elapsedMs,
                        mbps,
                        response.protocol.toString()
                    )
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

private fun Double.roundToDecimals(decimals: Int): Double {
    var multiplier = 1.0
    repeat(decimals) { multiplier *= 10 }
    return round(this * multiplier) / multiplier
}

private const val DOWNLOAD_READ_BUFFER_BYTES: Long = 64 * 1024
