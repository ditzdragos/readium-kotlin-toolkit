/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

@file:OptIn(InternalReadiumApi::class)

package org.readium.r2.navigator.epub

import org.json.JSONObject
import org.readium.r2.shared.InternalReadiumApi
import org.readium.r2.shared.extensions.toMap

/**
 * Parses the page ranges returned by `readium.calculateHorizontalPageRanges()`, ordered by page
 * index. Yields an empty list when the script produced no result. Throws [org.json.JSONException]
 * when [raw] is non-empty but malformed.
 */
internal fun parseHorizontalPageRanges(raw: String?): List<String> {
    if (raw.isJavascriptNullResult()) {
        return emptyList()
    }

    return JSONObject(raw).toMap().entries
        .sortedBy { it.key.toIntOrNull() ?: Int.MAX_VALUE }
        .map { it.value.toString() }
}
