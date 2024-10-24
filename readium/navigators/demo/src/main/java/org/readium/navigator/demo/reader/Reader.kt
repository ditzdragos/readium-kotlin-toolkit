/*
 * Copyright 2024 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

@file:OptIn(ExperimentalReadiumApi::class)

package org.readium.navigator.demo.reader

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.zIndex
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import org.readium.navigator.common.InputListener
import org.readium.navigator.common.Location
import org.readium.navigator.common.LocatorAdapter
import org.readium.navigator.common.Navigator
import org.readium.navigator.common.NullHyperlinkListener
import org.readium.navigator.common.Overflowable
import org.readium.navigator.common.RenditionState
import org.readium.navigator.common.TapContext
import org.readium.navigator.common.TapEvent
import org.readium.navigator.common.defaultHyperlinkListener
import org.readium.navigator.common.defaultInputListener
import org.readium.navigator.demo.persistence.LocatorRepository
import org.readium.navigator.demo.preferences.UserPreferences
import org.readium.navigator.demo.preferences.UserPreferencesViewModel
import org.readium.navigator.demo.util.launchWebBrowser
import org.readium.navigator.web.FixedWebRendition
import org.readium.navigator.web.FixedWebRenditionState
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.toUri

data class ReaderState<L : Location, N : Navigator<*, L, *>>(
    val url: AbsoluteUrl,
    val coroutineScope: CoroutineScope,
    val publication: Publication,
    val renditionState: RenditionState<N>,
    val preferencesViewModel: UserPreferencesViewModel<*, *>,
    val locatorAdapter: LocatorAdapter<L, *>
) {

    fun close() {
        coroutineScope.cancel()
        publication.close()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <L : Location, N : Navigator<*, L, *>> Reader(
    readerState: ReaderState<L, N>,
    fullScreenState: MutableState<Boolean>
) {
    val showPreferences = remember { mutableStateOf(false) }
    val preferencesSheetState = rememberModalBottomSheetState()

    if (showPreferences.value) {
        ModalBottomSheet(
            sheetState = preferencesSheetState,
            onDismissRequest = { showPreferences.value = false }
        ) {
            UserPreferences(
                model = readerState.preferencesViewModel,
                title = "Preferences"
            )
        }
    }

    Box {
        TopBar(
            modifier = Modifier.zIndex(1f),
            visible = !fullScreenState.value,
            onPreferencesActivated = { showPreferences.value = !showPreferences.value }
        )

        val navigatorNow = readerState.renditionState.controllerState.value.navigator

        val fallbackInputListener = remember {
            object : InputListener {
                override fun onTap(event: TapEvent, context: TapContext) {
                    fullScreenState.value = !fullScreenState.value
                }
            }
        }

        val inputListener =
            if (navigatorNow == null) {
                fallbackInputListener
            } else {
                (navigatorNow as? Overflowable)?.let {
                    defaultInputListener(
                        navigator = it,
                        fallbackListener = fallbackInputListener
                    )
                } ?: fallbackInputListener
            }

        val hyperlinkListener =
            if (navigatorNow == null) {
                NullHyperlinkListener
            } else {
                val context = LocalContext.current
                defaultHyperlinkListener(
                    navigator = navigatorNow,
                    onExternalLinkActivated = { url, _ -> launchWebBrowser(context, url.toUri()) }
                )
            }

        if (navigatorNow != null) {
            LaunchedEffect(navigatorNow) {
                snapshotFlow {
                    navigatorNow.location.value
                }.onEach {
                    val locator = with(readerState.locatorAdapter) { it.toLocator() }
                    LocatorRepository.saveLocator(readerState.url, locator)
                }.launchIn(readerState.coroutineScope)
            }
        }

        when (readerState.renditionState) {
            is FixedWebRenditionState -> {
                FixedWebRendition(
                    modifier = Modifier.fillMaxSize(),
                    state = readerState.renditionState,
                    inputListener = inputListener,
                    hyperlinkListener = hyperlinkListener
                )
            }
            /*is PdfNavigatorState<*, *> -> {
                PdfNavigator(
                    modifier = Modifier.fillMaxSize(),
                    state = state.navigatorState,
                    inputListener = inputListener
                )
            }*/
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TopBar(
    modifier: Modifier,
    visible: Boolean,
    onPreferencesActivated: () -> Unit
) {
    AnimatedVisibility(
        modifier = modifier,
        visible = visible,
        enter = fadeIn(),
        exit = fadeOut()
    ) {
        TopAppBar(
            title = {},
            actions = {
                IconButton(
                    onClick = onPreferencesActivated
                ) {
                    Icon(
                        imageVector = Icons.Filled.Settings,
                        contentDescription = "Preferences"
                    )
                }
            }
        )
    }
}
