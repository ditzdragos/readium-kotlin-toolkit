/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

internal class RawHtmlHandoff<K : Any>(private val maxBytes: Int = 2 * 1024 * 1024) {

    private val entries = LinkedHashMap<K, ByteArray>()
    private var totalBytes = 0

    @Synchronized
    fun put(key: K, bytes: ByteArray) {
        if (bytes.size > maxBytes) return
        entries.remove(key)?.let { totalBytes -= it.size }
        entries[key] = bytes
        totalBytes += bytes.size
        val eldest = entries.values.iterator()
        while (totalBytes > maxBytes && eldest.hasNext()) {
            totalBytes -= eldest.next().size
            eldest.remove()
        }
    }

    @Synchronized
    fun take(key: K): ByteArray? =
        entries.remove(key)?.also { totalBytes -= it.size }

    @Synchronized
    fun clear() {
        entries.clear()
        totalBytes = 0
    }
}
