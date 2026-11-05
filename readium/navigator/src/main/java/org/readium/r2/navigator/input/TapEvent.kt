package org.readium.r2.navigator.input

import android.graphics.PointF
import org.readium.r2.shared.util.Url

/**
 * Represents a tap event emitted by a navigator at the given [point].
 *
 * All the points are relative to the navigator view. [href] is the publication resource that was
 * tapped, when the navigator knows it. [selectsText] is true when a multiple click left text
 * selected under the pointer.
 */
public data class TapEvent(
    val point: PointF,
    val clickCount: Int = 1,
    val isMouse: Boolean = false,
    val href: Url? = null,
    val selectsText: Boolean = false,
)
