/*
 * Module: r2-lcp-kotlin
 * Developers: Aferdita Muriqi
 *
 * Copyright (c) 2019. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

package org.readium.r2.lcp.service

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class PassphrasesRepository {

    private val mutex = Mutex()
    private val passphrasesByLicense = mutableMapOf<String, String>()
    private val passphrasesByUser = mutableMapOf<String, MutableSet<String>>()
    private val allPassphrases = linkedSetOf<String>()

    suspend fun passphrase(licenseId: String): String? =
        mutex.withLock { passphrasesByLicense[licenseId] }

    suspend fun passphrases(userId: String): List<String> =
        mutex.withLock { passphrasesByUser[userId]?.toList().orEmpty() }

    suspend fun allPassphrases(): List<String> =
        mutex.withLock { allPassphrases.toList() }

    suspend fun addPassphrase(
        passphraseHash: String,
        licenseId: String,
        provider: String,
        userId: String?,
    ) {
        mutex.withLock {
            passphrasesByLicense[licenseId] = passphraseHash
            if (userId != null) {
                passphrasesByUser.getOrPut(userId) { linkedSetOf() }.add(passphraseHash)
            }
            allPassphrases.add(passphraseHash)
        }
    }
}
