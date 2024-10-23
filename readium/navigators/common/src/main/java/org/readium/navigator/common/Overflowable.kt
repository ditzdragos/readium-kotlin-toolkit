package org.readium.navigator.common

import androidx.compose.runtime.State
import org.readium.r2.navigator.preferences.ReadingProgression
import org.readium.r2.shared.ExperimentalReadiumApi

/**
 * A view with content that can extend beyond the viewport.
 *
 * The user typically navigates through the viewport by scrolling or tapping its edges.
 */
@ExperimentalReadiumApi
public interface Overflowable {

    /**
     * Current presentation rendered by the navigator.
     */
    public val overflow: State<Overflow>

    public val canMoveForward: Boolean

    public val canMoveBackward: Boolean

    /**
     * Moves to the next content portion (eg. page) in the reading progression direction.
     */
    public suspend fun moveForward()

    /**
     * Moves to the previous content portion (eg. page) in the reading progression direction.
     */
    public suspend fun moveBackward()
}

@ExperimentalReadiumApi
public typealias Overflow = org.readium.r2.navigator.OverflowableNavigator.Overflow

/**
 * Moves to the left content portion (eg. page) relative to the reading progression direction.
 */
@ExperimentalReadiumApi
public suspend fun Overflowable.moveLeft() {
    return when (overflow.value.readingProgression) {
        ReadingProgression.LTR ->
            moveBackward()

        ReadingProgression.RTL ->
            moveForward()
    }
}

/**
 * Moves to the right content portion (eg. page) relative to the reading progression direction.
 */
@ExperimentalReadiumApi
public suspend fun Overflowable.moveRight() {
    return when (overflow.value.readingProgression) {
        ReadingProgression.LTR ->
            moveForward()

        ReadingProgression.RTL ->
            moveBackward()
    }
}
