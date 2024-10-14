package org.readium.navigator.web

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.spring
import androidx.compose.foundation.pager.PagerState
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableStateOf
import org.readium.navigator.common.Configurable
import org.readium.navigator.common.NavigatorState
import org.readium.navigator.web.layout.Layout
import org.readium.navigator.web.layout.LayoutResolver
import org.readium.navigator.web.layout.ReadingOrder
import org.readium.navigator.web.preferences.FixedWebDefaults
import org.readium.navigator.web.preferences.FixedWebPreferences
import org.readium.navigator.web.preferences.FixedWebSettings
import org.readium.navigator.web.preferences.FixedWebSettingsResolver
import org.readium.navigator.web.util.WebViewClient
import org.readium.navigator.web.util.WebViewServer
import org.readium.r2.navigator.preferences.Fit
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Metadata

@ExperimentalReadiumApi
@Stable
public class FixedWebNavigatorState internal constructor(
    publicationMetadata: Metadata,
    readingOrder: ReadingOrder,
    initialPreferences: FixedWebPreferences,
    defaults: FixedWebDefaults,
    initialItem: Int,
    internal val webViewServer: WebViewServer,
    internal val preloadedData: PreloadedData
) : NavigatorState, Configurable<FixedWebSettings, FixedWebPreferences> {

    init {
        require(initialItem < readingOrder.items.size)
    }

    internal data class PreloadedData(
        val prepaginatedSingleContent: String,
        val prepaginatedDoubleContent: String
    )

    private val settingsResolver =
        FixedWebSettingsResolver(publicationMetadata, defaults)

    private val layoutResolver =
        LayoutResolver(readingOrder)

    public override val preferences: MutableState<FixedWebPreferences> =
        mutableStateOf(initialPreferences)

    public override val settings: State<FixedWebSettings> =
        derivedStateOf { settingsResolver.settings(preferences.value) }

    internal val webViewClient =
        WebViewClient(webViewServer)

    internal val layout: State<Layout> =
        derivedStateOf {
            val spreads = layoutResolver.layout(settings.value)
            Layout(settings.value.readingProgression, spreads)
        }

    internal val fit: State<Fit> =
        derivedStateOf { settings.value.fit }

    internal val pagerState: PagerState =
        PagerState(currentPage = layout.value.spreadIndexForPage(initialItem)) { layout.value.spreads.size }

    public val currentItem: State<Int> =
        derivedStateOf { layout.value.pageIndexForSpread(pagerState.currentPage) }

    public suspend fun goTo(item: Int): Unit =
        pagerState.scrollToPage(layout.value.spreadIndexForPage(item))

    public suspend fun animateGoTo(
        item: Int,
        animationSpec: AnimationSpec<Float> = spring()
    ): Unit =
        pagerState.animateScrollToPage(
            layout.value.spreadIndexForPage(item),
            animationSpec = animationSpec
        )
}
