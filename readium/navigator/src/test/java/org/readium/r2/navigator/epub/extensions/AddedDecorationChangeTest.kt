/*
 * Copyright 2021 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

package org.readium.r2.navigator.epub.extensions

import android.graphics.Color
import kotlin.test.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.readium.r2.navigator.Decoration
import org.readium.r2.navigator.DecorationChange
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.epub.EpubLayout
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.mediatype.MediaType
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AddedDecorationChangeTest {

    private val decoration = Decoration(
        id = "1",
        locator = Locator(Url("chapter.html")!!, mediaType = MediaType.HTML),
        style = Decoration.Style.Highlight(tint = Color.RED)
    )

    @Test
    fun `a reflowable publication takes the plain path`() {
        assertEquals(
            DecorationChange.Added(decoration),
            decoration.addedChangeFor(EpubLayout.REFLOWABLE)
        )
    }

    @Test
    fun `a fixed layout publication takes the enhanced path`() {
        assertEquals(
            DecorationChange.AddedEnhanced(decoration),
            decoration.addedChangeFor(EpubLayout.FIXED)
        )
    }
}
