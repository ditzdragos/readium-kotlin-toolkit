/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.lcp.service

import android.util.Log
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import timber.log.Timber

class NetworkServiceTest {

    private val logged = mutableListOf<Pair<Int, Throwable?>>()

    private val recordingTree = object : Timber.Tree() {
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
            logged += priority to t
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
    fun `a name lookup failure is classified as offline-like`() {
        assertTrue(UnknownHostException("api-prod.rallyreader.com").isOfflineLike())
    }

    @Test
    fun `a getaddrinfo failure is classified from its message alone`() {
        val gaiExceptionShape = IOException(
            "android_getaddrinfo failed: EAI_NODATA (No address associated with hostname)"
        )

        assertTrue(
            gaiExceptionShape.isOfflineLike(),
            "The real failure arrives as an android.system.GaiException this module cannot " +
                "reference, so the message has to be enough."
        )
    }

    @Test
    fun `a wrapped name lookup failure is classified as offline-like`() {
        val wrapped = IOException("request failed", UnknownHostException("api-prod.rallyreader.com"))

        assertTrue(wrapped.isOfflineLike())
    }

    @Test
    fun `a timeout is not classified as offline-like`() {
        assertFalse(
            SocketTimeoutException("timeout").isOfflineLike(),
            "A timeout can equally mean the license server is in trouble, which is worth an error."
        )
    }

    @Test
    fun `an offline call is a warning carrying no throwable`() {
        UnknownHostException(
            "Unable to resolve host \"api-prod.rallyreader.com\": No address associated with " +
                "hostname"
        ).reportNetworkFailure()

        val (priority, throwable) = logged.single()
        assertEquals(Log.WARN, priority)
        assertNull(
            throwable,
            "The reading app's tree forwards any throwable it is handed at warning or above, so " +
                "the throwable has to go for the report to actually stop."
        )
    }

    @Test
    fun `any other failure is still an error carrying the throwable`() {
        val refused = SocketTimeoutException("timeout")

        refused.reportNetworkFailure()

        val (priority, throwable) = logged.single()
        assertEquals(Log.ERROR, priority)
        assertEquals(refused, throwable)
    }
}
