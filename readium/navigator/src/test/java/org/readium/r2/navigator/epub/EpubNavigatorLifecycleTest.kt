package org.readium.r2.navigator.epub

import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class EpubNavigatorLifecycleTest {

    @Test
    fun `async navigator callbacks are usable only while fragment view is attached`() {
        assertTrue(
            isNavigatorViewUsableForAsyncCallback(
                hasView = true,
                isAdded = true,
                isRemoving = false,
                isDetached = false
            )
        )

        assertFalse(
            isNavigatorViewUsableForAsyncCallback(
                hasView = false,
                isAdded = true,
                isRemoving = false,
                isDetached = false
            )
        )
        assertFalse(
            isNavigatorViewUsableForAsyncCallback(
                hasView = true,
                isAdded = false,
                isRemoving = false,
                isDetached = false
            )
        )
        assertFalse(
            isNavigatorViewUsableForAsyncCallback(
                hasView = true,
                isAdded = true,
                isRemoving = true,
                isDetached = false
            )
        )
        assertFalse(
            isNavigatorViewUsableForAsyncCallback(
                hasView = true,
                isAdded = true,
                isRemoving = false,
                isDetached = true
            )
        )
    }
}
