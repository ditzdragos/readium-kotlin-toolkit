/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub

import android.content.ComponentCallbacks2

/** Whether an onTrimMemory [level] warrants shedding offscreen fixed-layout spreads. */
@Suppress("DEPRECATION")
internal fun shouldShedOffscreenSpreads(level: Int, isFixedLayout: Boolean): Boolean =
    isFixedLayout && level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW
