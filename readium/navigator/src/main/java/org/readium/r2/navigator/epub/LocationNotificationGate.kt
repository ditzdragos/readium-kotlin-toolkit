/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal class LocationNotificationGate(
    private val scope: CoroutineScope,
    private val trailingDelayMillis: Long = 100,
    private val emit: () -> Unit,
) {
    private var lastKey: Any? = null
    private var hasUnreportedChange = false
    private var trailing: Job? = null

    fun onChange(key: Any?) {
        trailing?.cancel()
        if (key != lastKey) {
            lastKey = key
            hasUnreportedChange = false
            emit()
            return
        }
        hasUnreportedChange = true
        trailing = scope.launch {
            delay(trailingDelayMillis)
            if (hasUnreportedChange) {
                hasUnreportedChange = false
                emit()
            }
        }
    }

    fun cancel() {
        trailing?.cancel()
        trailing = null
        hasUnreportedChange = false
    }
}
