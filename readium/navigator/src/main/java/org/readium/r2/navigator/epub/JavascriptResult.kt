/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import kotlin.contracts.ExperimentalContracts
import kotlin.contracts.contract

private const val JAVASCRIPT_NULL_RESULT: String = "null"

/**
 * WebView.evaluateJavascript JSON-encodes its result, so a script that returns null, returns
 * undefined, or throws arrives as the four-character string "null" rather than as a Kotlin null.
 * That happens whenever the script could not run: the page is not loaded yet, the `readium` global
 * is not injected, or the renderer process was reclaimed under memory pressure.
 */
@OptIn(ExperimentalContracts::class)
internal fun String?.isJavascriptNullResult(): Boolean {
    contract { returns(false) implies (this@isJavascriptNullResult != null) }

    return this == null || isBlank() || this == JAVASCRIPT_NULL_RESULT
}
