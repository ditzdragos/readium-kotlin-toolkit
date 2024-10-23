/*
 * Copyright 2022 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.navigator.web.preferences

import org.readium.r2.navigator.preferences.EnumPreference
import org.readium.r2.navigator.preferences.EnumPreferenceDelegate
import org.readium.r2.navigator.preferences.Fit
import org.readium.r2.navigator.preferences.Preference
import org.readium.r2.navigator.preferences.PreferenceDelegate
import org.readium.r2.navigator.preferences.PreferencesEditor
import org.readium.r2.navigator.preferences.ReadingProgression
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.InternalReadiumApi
import org.readium.r2.shared.publication.Metadata

/**
 * Interactive editor of [FixedWebPreferences].
 *
 * This can be used as a view model for a user preferences screen.
 *
 * @see FixedWebPreferences
 */
@ExperimentalReadiumApi
@OptIn(InternalReadiumApi::class)
public class FixedWebPreferencesEditor internal constructor(
    initialPreferences: FixedWebPreferences,
    publicationMetadata: Metadata,
    defaults: FixedWebDefaults
) : PreferencesEditor<FixedWebPreferences> {

    private data class State(
        val preferences: FixedWebPreferences,
        val settings: FixedWebSettings
    )

    private val settingsResolver: FixedWebSettingsResolver =
        FixedWebSettingsResolver(publicationMetadata, defaults)

    private var state: State =
        initialPreferences.toState()

    override val preferences: FixedWebPreferences
        get() = state.preferences

    override fun clear() {
        updateValues { FixedWebPreferences() }
    }

    public val fit: EnumPreference<Fit> =
        EnumPreferenceDelegate(
            getValue = { preferences.fit },
            getEffectiveValue = { state.settings.fit },
            getIsEffective = { true },
            updateValue = { value -> updateValues { it.copy(fit = value) } },
            supportedValues = listOf(Fit.CONTAIN, Fit.WIDTH, Fit.HEIGHT)
        )

    public val readingProgression: EnumPreference<ReadingProgression> =
        EnumPreferenceDelegate(
            getValue = { preferences.readingProgression },
            getEffectiveValue = { state.settings.readingProgression },
            getIsEffective = { true },
            updateValue = { value -> updateValues { it.copy(readingProgression = value) } },
            supportedValues = listOf(ReadingProgression.LTR, ReadingProgression.RTL)
        )

    public val spreads: Preference<Boolean> =
        PreferenceDelegate(
            getValue = { preferences.spreads },
            getEffectiveValue = { state.settings.spreads },
            getIsEffective = { true },
            updateValue = { value -> updateValues { it.copy(spreads = value) } }
        )

    private fun updateValues(
        updater: (FixedWebPreferences) -> FixedWebPreferences
    ) {
        val newPreferences = updater(preferences)
        state = newPreferences.toState()
    }

    private fun FixedWebPreferences.toState() =
        State(preferences = this, settings = settingsResolver.settings(this))
}