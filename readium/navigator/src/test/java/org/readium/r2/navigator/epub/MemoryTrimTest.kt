package org.readium.r2.navigator.epub

import android.content.ComponentCallbacks2
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@Suppress("DEPRECATION")
class MemoryTrimTest {

    @Test
    fun `sheds fixed-layout spreads at running-low and above`() {
        assertTrue(shouldShedOffscreenSpreads(ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW, isFixedLayout = true))
        assertTrue(shouldShedOffscreenSpreads(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL, isFixedLayout = true))
        assertTrue(shouldShedOffscreenSpreads(ComponentCallbacks2.TRIM_MEMORY_COMPLETE, isFixedLayout = true))
    }

    @Test
    fun `does not shed below running-low`() {
        assertFalse(shouldShedOffscreenSpreads(ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE, isFixedLayout = true))
    }

    @Test
    fun `does not shed reflowable layouts`() {
        assertFalse(shouldShedOffscreenSpreads(ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL, isFixedLayout = false))
    }
}
