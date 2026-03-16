/*
 * Module: r2-lcp-kotlin
 * Developers: Aferdita Muriqi
 *
 * Copyright (c) 2019. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

package org.readium.r2.lcp.service

import android.content.Context

/**
 * Validation cache is intentionally disabled for builds that must not persist LCP state.
 */
internal class ValidationCacheService(context: Context) {

    fun cacheStatusDocument(licenseId: String, statusData: ByteArray) {
        // Intentionally no-op.
    }

    fun getCachedStatusDocument(licenseId: String): ByteArray? {
        return null
    }

    fun markValidationSuccess(licenseId: String, licenseEnd: org.readium.r2.shared.util.Instant?) {
        // Intentionally no-op.
    }

    fun wasValidatedSuccessfully(licenseId: String): Boolean {
        return false
    }

    fun clearCache(licenseId: String) {
        // Intentionally no-op.
    }

    fun getAllCachedLicenseIds(): List<String> {
        return emptyList()
    }

    fun getCacheInfo(licenseId: String): String {
        return "Validation cache disabled"
    }

    fun clearAllCaches() {
        // Intentionally no-op.
    }
}
