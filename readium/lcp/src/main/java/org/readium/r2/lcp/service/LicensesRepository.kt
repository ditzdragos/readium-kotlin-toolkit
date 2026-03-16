/*
 * Module: r2-lcp-kotlin
 * Developers: Aferdita Muriqi
 *
 * Copyright (c) 2019. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

package org.readium.r2.lcp.service

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.readium.r2.lcp.license.model.LicenseDocument

internal class LicensesRepository {

    private data class LicenseState(
        var copiesLeft: Int?,
        var printsLeft: Int?,
        var registered: Boolean = false,
    )

    private val mutex = Mutex()
    private val licenses = mutableMapOf<String, LicenseState>()
    private val copiesFlows = mutableMapOf<String, MutableStateFlow<Int?>>()
    private val printsFlows = mutableMapOf<String, MutableStateFlow<Int?>>()

    suspend fun addLicense(licenseDocument: LicenseDocument) {
        mutex.withLock {
            val current = licenses[licenseDocument.id]
            if (current == null) {
                licenses[licenseDocument.id] = LicenseState(
                    copiesLeft = licenseDocument.rights.copy,
                    printsLeft = licenseDocument.rights.print
                )
                copiesFlow(licenseDocument.id).value = licenseDocument.rights.copy
                printsFlow(licenseDocument.id).value = licenseDocument.rights.print
                return
            }

            if (current.copiesLeft == null && licenseDocument.rights.copy != null) {
                current.copiesLeft = licenseDocument.rights.copy
                copiesFlow(licenseDocument.id).value = current.copiesLeft
            }
            if (current.printsLeft == null && licenseDocument.rights.print != null) {
                current.printsLeft = licenseDocument.rights.print
                printsFlow(licenseDocument.id).value = current.printsLeft
            }
        }
    }

    fun copiesLeft(licenseId: String): Flow<Int?> {
        return copiesFlow(licenseId)
    }

    suspend fun tryCopy(quantity: Int, licenseId: String): Boolean = mutex.withLock {
        require(quantity >= 0)
        val license = licenses[licenseId] ?: return@withLock true
        val copiesLeft = license.copiesLeft ?: return@withLock true
        if (copiesLeft < quantity) {
            return@withLock false
        }
        license.copiesLeft = copiesLeft - quantity
        copiesFlow(licenseId).value = license.copiesLeft
        true
    }

    fun printsLeft(licenseId: String): Flow<Int?> {
        return printsFlow(licenseId)
    }

    suspend fun tryPrint(quantity: Int, licenseId: String): Boolean = mutex.withLock {
        require(quantity >= 0)
        val license = licenses[licenseId] ?: return@withLock true
        val printsLeft = license.printsLeft ?: return@withLock true
        if (printsLeft < quantity) {
            return@withLock false
        }
        license.printsLeft = printsLeft - quantity
        printsFlow(licenseId).value = license.printsLeft
        true
    }

    suspend fun isDeviceRegistered(licenseId: String): Boolean = mutex.withLock {
        licenses[licenseId]?.registered ?: false
    }

    suspend fun registerDevice(licenseId: String) {
        mutex.withLock {
            val current = licenses[licenseId] ?: LicenseState(copiesLeft = null, printsLeft = null)
            current.registered = true
            licenses[licenseId] = current
        }
    }

    private fun copiesFlow(licenseId: String): MutableStateFlow<Int?> =
        copiesFlows.getOrPut(licenseId) {
            MutableStateFlow(licenses[licenseId]?.copiesLeft)
        }

    private fun printsFlow(licenseId: String): MutableStateFlow<Int?> =
        printsFlows.getOrPut(licenseId) {
            MutableStateFlow(licenses[licenseId]?.printsLeft)
        }
}
