/*
 * Module: r2-lcp-kotlin
 * Developers: Aferdita Muriqi
 *
 * Copyright (c) 2019. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

@file:OptIn(InternalReadiumApi::class)

package org.readium.r2.lcp.service

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.datetime.TimeZone
import kotlinx.datetime.daysUntil
import org.readium.r2.lcp.BuildConfig.DEBUG
import org.readium.r2.lcp.LcpError
import org.readium.r2.lcp.LcpException
import org.readium.r2.shared.InternalReadiumApi
import org.readium.r2.shared.extensions.tryOrNull
import org.readium.r2.shared.util.getOrElse
import timber.log.Timber

@OptIn(ExperimentalTime::class)
internal class CRLService(
    private val network: NetworkService,
    private val context: Context,
    private val coroutineScope: CoroutineScope,
) {

    companion object {
        const val EXPIRATION = 7
        const val CRL_KEY = "org.readium.r2-lcp-swift.CRL"
        const val DATE_KEY = "org.readium.r2-lcp-swift.CRLDate"

        private const val CRL_URL = "http://crl.edrlab.telesec.de/rl/EDRLab_CA.crl"
    }

    private val preferences: SharedPreferences = context.getSharedPreferences(
        "org.readium.r2.lcp",
        Context.MODE_PRIVATE
    )

    private val fetchMutex = Mutex()
    private var fetchJob: Deferred<Crl>? = null

    fun preload() {
        refreshInBackground()
    }

    suspend fun retrieve(): String {
        val (localCrl, isExpired) = readLocal()
        if (localCrl != null) {
            if (isExpired) {
                refreshInBackground()
            }
            return localCrl.pem
        }
        return fetchAndSave().pem
    }

    private fun refreshInBackground() {
        coroutineScope.launch {
            try {
                val (localCrl, isExpired) = readLocal()
                if (localCrl == null || isExpired) {
                    fetchAndSave()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (DEBUG) Timber.e(e)
            }
        }
    }

    private suspend fun fetchAndSave(): Crl {
        val job = fetchMutex.withLock {
            fetchJob?.takeIf { it.isActive }
                ?: coroutineScope
                    .async { fetch().also { saveLocal(it) } }
                    .also { fetchJob = it }
        }
        return job.await()
    }

    private suspend fun fetch(): Crl {
        val data = network.fetch(CRL_URL, NetworkService.Method.GET)
            .getOrElse { throw LcpException(LcpError.CrlFetching) }

        // A captive portal answers 200 with its login page; caching that would block LCP for a week.
        return Crl.fromDer(data)
            ?: run {
                if (DEBUG) Timber.e("The fetched CRL is not a valid X.509 CRL")
                throw LcpException(LcpError.CrlFetching)
            }
    }

    private fun readLocal(): Pair<Crl?, Boolean> {
        val crl = preferences.getString(CRL_KEY, null)?.let { Crl.parsePem(it) }
        val date = preferences.getString(DATE_KEY, null)
            ?.let { tryOrNull { Instant.parse(input = it) } }
        val expired = date?.let { daysSince(it) >= EXPIRATION } ?: true
        return Pair(crl, expired)
    }

    private fun saveLocal(crl: Crl) {
        preferences.edit(commit = true) {
            putString(CRL_KEY, crl.pem)
            putString(DATE_KEY, Clock.System.now().toString())
        }
    }

    private fun daysSince(date: Instant): Int =
        date.daysUntil(other = Clock.System.now(), timeZone = TimeZone.currentSystemDefault())
}
