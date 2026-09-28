/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.util

import android.os.Build
import android.os.Trace

internal object ReadiumTrace {
    const val PAGE_FRAGMENT_CREATE_VIEW = "readium:pageFragment.createView"
    const val PAGE_LOAD = "readium:pageLoad"
    const val HTML_READ = "readium:htmlRead"
    const val INJECT_HTML = "readium:injectHtml"
    const val NOTIFY_LOCATION = "readium:notifyLocation"

    inline fun <T> section(name: String, block: () -> T): T {
        Trace.beginSection(name)
        try {
            return block()
        } finally {
            Trace.endSection()
        }
    }

    fun beginAsync(name: String, cookie: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Trace.beginAsyncSection(name, cookie)
    }

    fun endAsync(name: String, cookie: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Trace.endAsyncSection(name, cookie)
    }
}
