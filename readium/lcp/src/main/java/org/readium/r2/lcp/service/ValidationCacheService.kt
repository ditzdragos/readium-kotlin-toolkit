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
import android.content.SharedPreferences
import org.joda.time.DateTime
import org.readium.r2.lcp.BuildConfig.DEBUG
import org.readium.r2.shared.util.Instant
import timber.log.Timber

/**
 * Service to cache validation state and status documents for offline access.
 *
 * Cache expiration is based on the license's actual expiration date to ensure
 * DRM compliance - users cannot read expired books offline.
 *
 * Expiration Strategy:
 * - Primary: License expiration date (rights.end) if present
 * - Fallback: 30-day maximum cache age for perpetual licenses
 * - Whichever comes first is enforced
 *
 * Example scenarios:
 * - License expires in 7 days → Cache valid for 7 days
 * - License expires in 60 days → Cache valid for 30 days (max limit)
 * - Perpetual license → Cache valid for 30 days
 * - License already expired → Cache immediately invalid
 */
internal class ValidationCacheService(context: Context) {

    private val preferences: SharedPreferences = context.getSharedPreferences(
        "org.readium.r2.lcp.validation",
        Context.MODE_PRIVATE
    )

    companion object {
        // Maximum cache duration as a safety fallback (30 days)
        private const val MAX_CACHE_DAYS = 30
        private const val STATUS_KEY_PREFIX = "status_"
        private const val STATUS_DATE_KEY_PREFIX = "status_date_"
        private const val VALIDATION_KEY_PREFIX = "validation_"
        private const val VALIDATION_DATE_KEY_PREFIX = "validation_date_"
        private const val LICENSE_EXPIRY_KEY_PREFIX = "license_expiry_"
    }

    /**
     * Cache a status document for a given license ID.
     */
    fun cacheStatusDocument(licenseId: String, statusData: ByteArray) {
        try {
            val statusKey = "$STATUS_KEY_PREFIX$licenseId"
            val dateKey = "$STATUS_DATE_KEY_PREFIX$licenseId"

            preferences.edit()
                .putString(statusKey, android.util.Base64.encodeToString(statusData, android.util.Base64.DEFAULT))
                .putString(dateKey, DateTime.now().toString())
                .apply()

            if (DEBUG) Timber.d("Cached status document for license $licenseId")
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "Failed to cache status document for license $licenseId")
        }
    }

    /**
     * Retrieve cached status document for a given license ID.
     * Returns null if not cached or expired (based on license expiry or max cache duration).
     */
    fun getCachedStatusDocument(licenseId: String): ByteArray? {
        try {
            val statusKey = "$STATUS_KEY_PREFIX$licenseId"
            val dateKey = "$STATUS_DATE_KEY_PREFIX$licenseId"

            val cachedStatus = preferences.getString(statusKey, null) ?: return null
            val dateString = preferences.getString(dateKey, null) ?: return null

            val cacheDate = DateTime(dateString)

            // Check if cache has exceeded maximum age (safety fallback)
            val daysSinceCache = org.joda.time.Days.daysBetween(cacheDate, DateTime.now()).days
            if (daysSinceCache >= MAX_CACHE_DAYS) {
                if (DEBUG) Timber.d("Cached status document for license $licenseId exceeded max cache age")
                clearStatusCache(licenseId)
                return null
            }

            // Check if license has expired
            val licenseExpiry = getLicenseExpiry(licenseId)
            if (licenseExpiry != null && licenseExpiry < Instant.now()) {
                if (DEBUG) Timber.d("Cached status document for license $licenseId is expired (license expired)")
                clearStatusCache(licenseId)
                clearValidationCache(licenseId)
                return null
            }

            if (DEBUG) Timber.d("Retrieved cached status document for license $licenseId")
            return android.util.Base64.decode(cachedStatus, android.util.Base64.DEFAULT)
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "Failed to retrieve cached status document for license $licenseId")
            return null
        }
    }

    /**
     * Mark a license as successfully validated and store its expiration date.
     * @param licenseEnd The license end date (rights.end), or null if perpetual
     */
    fun markValidationSuccess(licenseId: String, licenseEnd: Instant?) {
        try {
            val validationKey = "$VALIDATION_KEY_PREFIX$licenseId"
            val dateKey = "$VALIDATION_DATE_KEY_PREFIX$licenseId"
            val expiryKey = "$LICENSE_EXPIRY_KEY_PREFIX$licenseId"

            val editor = preferences.edit()
                .putBoolean(validationKey, true)
                .putString(dateKey, DateTime.now().toString())

            // Store license expiry if available
            if (licenseEnd != null) {
                editor.putString(expiryKey, licenseEnd.toString())
            } else {
                editor.remove(expiryKey) // No expiry means perpetual license
            }

            editor.apply()

            if (DEBUG) {
                val expiryMsg = licenseEnd?.let { " (expires: $it)" } ?: " (perpetual)"
                Timber.d("Marked validation success for license $licenseId$expiryMsg")
            }
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "Failed to mark validation success for license $licenseId")
        }
    }

    /**
     * Check if a license was previously validated successfully.
     * Returns true if validated and not expired (based on license expiry or max cache duration).
     */
    fun wasValidatedSuccessfully(licenseId: String): Boolean {
        try {
            val validationKey = "$VALIDATION_KEY_PREFIX$licenseId"
            val dateKey = "$VALIDATION_DATE_KEY_PREFIX$licenseId"

            val wasValidated = preferences.getBoolean(validationKey, false)
            if (!wasValidated) return false

            val dateString = preferences.getString(dateKey, null) ?: return false
            val validationDate = DateTime(dateString)

            // Check if cache has exceeded maximum age (safety fallback)
            val daysSinceValidation = org.joda.time.Days.daysBetween(validationDate, DateTime.now()).days
            if (daysSinceValidation >= MAX_CACHE_DAYS) {
                if (DEBUG) Timber.d("Validation cache for license $licenseId exceeded max cache age")
                clearValidationCache(licenseId)
                return false
            }

            // Check if license has expired
            val licenseExpiry = getLicenseExpiry(licenseId)
            if (licenseExpiry != null && licenseExpiry < Instant.now()) {
                if (DEBUG) Timber.d("Validation cache for license $licenseId is expired (license expired)")
                clearValidationCache(licenseId)
                return false
            }

            if (DEBUG) Timber.d("License $licenseId was previously validated successfully")
            return true
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "Failed to check validation status for license $licenseId")
            return false
        }
    }

    /**
     * Get the stored license expiry date.
     * Returns null if no expiry is stored (perpetual license or not cached).
     */
    private fun getLicenseExpiry(licenseId: String): Instant? {
        return try {
            val expiryKey = "$LICENSE_EXPIRY_KEY_PREFIX$licenseId"
            val expiryString = preferences.getString(expiryKey, null) ?: return null
            Instant.parse(expiryString)
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "Failed to parse license expiry for $licenseId")
            null
        }
    }

    /**
     * Clear all cached data for a license.
     */
    fun clearCache(licenseId: String) {
        clearStatusCache(licenseId)
        clearValidationCache(licenseId)
    }

    /**
     * Get all cached license IDs.
     * Returns a list of license IDs that have cached validation data.
     */
    fun getAllCachedLicenseIds(): List<String> {
        return try {
            val allKeys = preferences.all.keys
            val licenseIds = allKeys
                .filter { it.startsWith(VALIDATION_KEY_PREFIX) }
                .map { it.removePrefix(VALIDATION_KEY_PREFIX) }
                .toList()

            if (DEBUG) Timber.d("Found ${licenseIds.size} cached licenses: $licenseIds")
            licenseIds
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "Failed to get cached license IDs")
            emptyList()
        }
    }

    /**
     * Get cache information for a specific license.
     * Returns a string with cache status details for debugging.
     */
    fun getCacheInfo(licenseId: String): String {
        return try {
            val validationKey = "$VALIDATION_KEY_PREFIX$licenseId"
            val dateKey = "$VALIDATION_DATE_KEY_PREFIX$licenseId"
            val expiryKey = "$LICENSE_EXPIRY_KEY_PREFIX$licenseId"
            val statusKey = "$STATUS_KEY_PREFIX$licenseId"
            val statusDateKey = "$STATUS_DATE_KEY_PREFIX$licenseId"

            val isValidated = preferences.getBoolean(validationKey, false)
            val validationDate = preferences.getString(dateKey, null)
            val expiryDate = preferences.getString(expiryKey, null)
            val hasStatus = preferences.contains(statusKey)
            val statusDate = preferences.getString(statusDateKey, null)

            buildString {
                append("License: $licenseId\n")
                append("  Validated: $isValidated\n")
                append("  Validation Date: $validationDate\n")
                append("  License Expiry: ${expiryDate ?: "perpetual"}\n")
                append("  Has Status Doc: $hasStatus\n")
                append("  Status Cached: $statusDate\n")
            }
        } catch (e: Exception) {
            "Error getting cache info: ${e.message}"
        }
    }

    /**
     * Clear all cached data for all licenses.
     */
    fun clearAllCaches() {
        try {
            preferences.edit().clear().apply()
            if (DEBUG) Timber.d("Cleared all validation caches")
        } catch (e: Exception) {
            if (DEBUG) Timber.e(e, "Failed to clear all caches")
        }
    }

    private fun clearStatusCache(licenseId: String) {
        preferences.edit()
            .remove("$STATUS_KEY_PREFIX$licenseId")
            .remove("$STATUS_DATE_KEY_PREFIX$licenseId")
            .apply()
    }

    private fun clearValidationCache(licenseId: String) {
        preferences.edit()
            .remove("$VALIDATION_KEY_PREFIX$licenseId")
            .remove("$VALIDATION_DATE_KEY_PREFIX$licenseId")
            .remove("$LICENSE_EXPIRY_KEY_PREFIX$licenseId")
            .apply()
    }
}
