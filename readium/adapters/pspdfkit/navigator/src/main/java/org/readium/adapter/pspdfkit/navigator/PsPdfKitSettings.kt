/*
 * Copyright 2022 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.adapter.pspdfkit.navigator

import org.readium.r2.navigator.preferences.Axis
import org.readium.r2.navigator.preferences.Configurable
import org.readium.r2.navigator.preferences.Fit
import org.readium.r2.navigator.preferences.ReadingProgression
import org.readium.r2.navigator.preferences.Spread

/**
 * Settings values of the PDF navigator with the PSPDFKit adapter.
 *
 * @see PsPdfKitPreferences
 */
public data class PsPdfKitSettings(
    val fit: Fit,
    val offsetFirstPage: Boolean,
    val pageSpacing: Double,
    val readingProgression: ReadingProgression,
    val scroll: Boolean,
    val scrollAxis: Axis,
    val spread: Spread,
) : Configurable.Settings
