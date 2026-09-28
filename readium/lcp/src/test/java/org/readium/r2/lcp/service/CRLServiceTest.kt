/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

@file:OptIn(ExperimentalCoroutinesApi::class, ExperimentalTime::class)

package org.readium.r2.lcp.service

import android.content.Context
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.time.Clock
import kotlin.time.Duration
import kotlin.time.Duration.Companion.days
import kotlin.time.ExperimentalTime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.lcp.LcpException
import org.readium.r2.shared.util.Try
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class CRLServiceTest {

    private val crlBytes: ByteArray =
        CRLServiceTest::class.java.getResourceAsStream("edrlab-ca.crl")!!.use { it.readBytes() }

    private val crlPem: String =
        pem(android.util.Base64.encodeToString(crlBytes, android.util.Base64.NO_WRAP))

    private val lineWrappedCrlPem: String =
        pem(android.util.Base64.encodeToString(crlBytes, android.util.Base64.DEFAULT))

    private val captivePortalBytes: ByteArray =
        "<html><body>Please buy some Wi-Fi</body></html>".toByteArray()

    private val context: Context get() = RuntimeEnvironment.getApplication()

    private val preferences
        get() = context.getSharedPreferences("org.readium.r2.lcp", Context.MODE_PRIVATE)

    private val serviceJob = SupervisorJob()

    @Before
    fun clearPreferences() {
        preferences.edit().clear().commit()
    }

    private fun pem(base64: String): String =
        "-----BEGIN X509 CRL-----$base64-----END X509 CRL-----"

    private fun saveLocalCrl(crl: String, age: Duration) {
        preferences.edit()
            .putString(CRLService.CRL_KEY, crl)
            .putString(CRLService.DATE_KEY, (Clock.System.now() - age).toString())
            .commit()
    }

    private fun networkReturning(body: ByteArray): NetworkService =
        mockk<NetworkService>().also {
            coEvery { it.fetch(any(), any(), any(), any(), any()) } returns Try.success(body)
        }

    private fun NetworkService.assertFetched(times: Int) {
        coVerify(exactly = times) { fetch(any(), any(), any(), any(), any()) }
    }

    private fun TestScope.createService(network: NetworkService): CRLService =
        CRLService(
            network = network,
            context = context,
            coroutineScope = CoroutineScope(serviceJob + StandardTestDispatcher(testScheduler))
        )

    private suspend fun awaitBackgroundWork() {
        serviceJob.children.toList().joinAll()
    }

    @Test
    fun `retrieve returns a fresh local CRL without fetching`() = runTest {
        saveLocalCrl(crlPem, age = 2.days)
        val network = networkReturning(crlBytes)

        assertEquals(crlPem, createService(network).retrieve())
        awaitBackgroundWork()
        network.assertFetched(0)
    }

    @Test
    fun `retrieve returns the expired local CRL and refreshes it in the background`() = runTest {
        saveLocalCrl(lineWrappedCrlPem, age = 8.days)
        val network = networkReturning(crlBytes)
        val service = createService(network)

        assertEquals(lineWrappedCrlPem, service.retrieve())
        network.assertFetched(0)

        awaitBackgroundWork()

        network.assertFetched(1)
        assertEquals(crlPem, preferences.getString(CRLService.CRL_KEY, null))
        assertEquals(crlPem, service.retrieve())
    }

    @Test
    fun `retrieve keeps the expired local CRL when the refresh returns a captive portal`() = runTest {
        saveLocalCrl(lineWrappedCrlPem, age = 8.days)
        val network = networkReturning(captivePortalBytes)
        val service = createService(network)

        assertEquals(lineWrappedCrlPem, service.retrieve())
        awaitBackgroundWork()

        network.assertFetched(1)
        assertEquals(lineWrappedCrlPem, preferences.getString(CRLService.CRL_KEY, null))
        assertEquals(lineWrappedCrlPem, service.retrieve())
    }

    @Test
    fun `retrieve fetches and caches when there is no local CRL`() = runTest {
        val network = networkReturning(crlBytes)

        assertEquals(crlPem, createService(network).retrieve())

        network.assertFetched(1)
        assertEquals(crlPem, preferences.getString(CRLService.CRL_KEY, null))
    }

    @Test
    fun `retrieve fails without a cached CRL when the response is not a CRL`() = runTest {
        val network = networkReturning(captivePortalBytes)

        assertFailsWith<LcpException> { createService(network).retrieve() }

        assertNull(preferences.getString(CRLService.CRL_KEY, null))
    }

    @Test
    fun `retrieve ignores a cached entry that is not a CRL`() = runTest {
        saveLocalCrl(pem("PGh0bWw+"), age = 1.days)
        val network = networkReturning(crlBytes)

        assertEquals(crlPem, createService(network).retrieve())

        network.assertFetched(1)
    }

    @Test
    fun `concurrent retrieves without a cache share one fetch`() = runTest {
        val network = networkReturning(crlBytes)
        val service = createService(network)

        val results = List(3) { async { service.retrieve() } }.awaitAll()

        assertEquals(List(3) { crlPem }, results)
        network.assertFetched(1)
    }

    @Test
    fun `preload caches the CRL when none is cached`() = runTest {
        val network = networkReturning(crlBytes)

        createService(network).preload()
        awaitBackgroundWork()

        network.assertFetched(1)
        assertEquals(crlPem, preferences.getString(CRLService.CRL_KEY, null))
    }

    @Test
    fun `preload does not fetch when the cached CRL is fresh`() = runTest {
        saveLocalCrl(crlPem, age = 1.days)
        val network = networkReturning(crlBytes)

        createService(network).preload()
        awaitBackgroundWork()

        network.assertFetched(0)
    }
}
