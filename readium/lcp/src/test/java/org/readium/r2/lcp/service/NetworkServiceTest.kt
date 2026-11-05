/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.lcp.service

import android.util.Log
import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import okhttp3.internal.http2.ErrorCode
import okhttp3.internal.http2.StreamResetException
import org.junit.After
import org.junit.Before
import org.junit.Test
import timber.log.Timber

class NetworkServiceTest {

    private val logged = mutableListOf<Triple<Int, String, Throwable?>>()

    private val recordingTree = object : Timber.Tree() {
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
            logged += Triple(priority, message, t)
        }
    }

    @Before
    fun setup() {
        logged.clear()
        Timber.plant(recordingTree)
    }

    @After
    fun tearDown() {
        Timber.uprootAll()
    }

    @Test
    fun `a transport failure is a network drop`() {
        listOf(
            UnknownHostException("api-prod.rallyreader.com"),
            SocketTimeoutException("timeout"),
            InterruptedIOException("timeout"),
            SocketException("Software caused connection abort"),
            EOFException("\n not found: limit=0"),
            StreamResetException(ErrorCode.CANCEL),
            SSLException(SSL_READ_ABORT),
        ).forEach { failure ->
            assertTrue(failure.isNetworkDrop(), "${failure.javaClass.name} should be a drop")
        }
    }

    @Test
    fun `a handshake cut off by the network is a drop`() {
        assertTrue(SSLHandshakeException(SSL_HANDSHAKE_CUT_OFF).isNetworkDrop())
        assertTrue(
            SSLHandshakeException("Handshake failed")
                .apply { initCause(SocketException("Connection reset")) }
                .isNetworkDrop()
        )
    }

    @Test
    fun `a certificate failure is not a drop`() {
        assertFalse(SSLHandshakeException("Trust anchor for certification path not found.").isNetworkDrop())
        assertFalse(SSLPeerUnverifiedException("Hostname lsd.example.com not verified").isNetworkDrop())
    }

    @Test
    fun `the first verdict in the cause chain decides`() {
        assertTrue(IOException("request failed", UnknownHostException("lcp.example.com")).isNetworkDrop())
        assertFalse(
            IOException(
                "request failed",
                SSLPeerUnverifiedException("Hostname lcp.example.com not verified")
                    .apply { initCause(SocketException("Connection reset")) }
            ).isNetworkDrop(),
            "A certificate failure stays an error even when a socket error sits under it."
        )
    }

    @Test
    fun `a drop buried under a deep wrapper chain is not found`() {
        val deep = (1..10).fold<Int, Throwable>(SocketException("Connection reset")) { cause, depth ->
            IOException("wrapper $depth", cause)
        }

        assertFalse(deep.isNetworkDrop())
    }

    @Test
    fun `a failure with no transport cause is not a drop`() {
        assertFalse(IllegalStateException("closed").isNetworkDrop())
    }

    @Test
    fun `a getaddrinfo message without an UnknownHostException is not a drop`() {
        assertFalse(
            IOException("android_getaddrinfo failed: EAI_NODATA (No address associated with hostname)")
                .isNetworkDrop(),
            "RR-9433 dropped message matching: Android wraps GaiException in UnknownHostException."
        )
    }

    @Test
    fun `an aborted download read is a warning carrying no throwable`() {
        SSLException(SSL_READ_ABORT).reportNetworkFailure("publication download from cdn.example.com")

        val (priority, message, throwable) = logged.single()
        assertEquals(Log.WARN, priority)
        assertEquals(
            "LCP publication download from cdn.example.com failed, the connection dropped " +
                "(javax.net.ssl.SSLException)",
            message
        )
        assertNull(
            throwable,
            "The reading app's tree forwards any throwable it is handed at warning or above, so " +
                "the throwable has to go for the report to actually stop."
        )
    }

    @Test
    fun `a certificate failure is still an error carrying the throwable`() {
        val untrusted = SSLHandshakeException("Trust anchor for certification path not found.")

        untrusted.reportNetworkFailure("GET license call to lcp.example.com")

        val (priority, _, throwable) = logged.single()
        assertEquals(Log.ERROR, priority)
        assertEquals(untrusted, throwable)
    }

    @Test
    fun `a status call is described by its kind and host`() {
        assertEquals(
            "GET status call to lsd.example.com",
            describeLcpCall(
                NetworkService.Method.GET,
                "https://lsd.example.com/licenses/3d1f-licence-id/status"
            )
        )
    }

    @Test
    fun `a register call leaves out the device id and name`() {
        val call = describeLcpCall(
            NetworkService.Method.POST,
            "https://lsd.example.com/licenses/3d1f-licence-id/register?id=device-id&name=Ana%27s+Phone"
        )

        assertEquals("POST register call to lsd.example.com", call)
    }

    @Test
    fun `a revocation list fetch is described as a crl call`() {
        assertEquals(
            "GET crl call to crl.edrlab.telesec.de",
            describeLcpCall(
                NetworkService.Method.GET,
                "http://crl.edrlab.telesec.de/rl/EDRLab_CA.crl"
            )
        )
    }

    @Test
    fun `a license document fetch is described as a license call`() {
        assertEquals(
            "GET license call to lcp.example.com",
            describeLcpCall(NetworkService.Method.GET, "https://lcp.example.com/licenses/3d1f-licence-id")
        )
    }

    @Test
    fun `an unparsable url names no host`() {
        assertEquals(
            "PUT call to an unparsable URL",
            describeLcpCall(NetworkService.Method.PUT, "not a url")
        )
    }

    private companion object {
        const val SSL_HANDSHAKE_CUT_OFF =
            "Read error: ssl=0x7b2c: I/O error during system call, Connection reset by peer"
        const val SSL_READ_ABORT =
            "Read error: ssl=0x7b2c: I/O error during system call, Software caused connection abort"
    }
}
