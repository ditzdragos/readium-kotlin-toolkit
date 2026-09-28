/*
 * Copyright 2026 Readium Foundation. All rights reserved.
 * Use of this source code is governed by the BSD-style license
 * available in the top-level LICENSE file of the project.
 */

@file:OptIn(ExperimentalCoroutinesApi::class)

package org.readium.r2.navigator.epub

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class LocationNotificationGateTest {

    private var emits = 0

    private fun TestScope.gate() = LocationNotificationGate(scope = this) { emits++ }

    private fun TestScope.advance(millis: Long) {
        advanceTimeBy(millis)
        runCurrent()
    }

    @Test
    fun `a new key emits immediately`() = runTest {
        val gate = gate()

        gate.onChange(1 to 0)

        assertEquals(1, emits)
    }

    @Test
    fun `repeated key emits once after the trailing delay`() = runTest {
        val gate = gate()
        gate.onChange(1 to 0)
        repeat(5) { gate.onChange(1 to 0) }

        advance(99)
        assertEquals(1, emits)

        advance(2)
        assertEquals(2, emits)
    }

    @Test
    fun `trailing emit follows the last change`() = runTest {
        val gate = gate()
        gate.onChange(1 to 0)
        gate.onChange(1 to 0)
        advance(50)
        gate.onChange(1 to 0)

        advance(60)
        assertEquals(1, emits)

        advance(50)
        assertEquals(2, emits)
    }

    @Test
    fun `no trailing emit when nothing followed the leading one`() = runTest {
        val gate = gate()

        gate.onChange(1 to 0)
        advance(500)

        assertEquals(1, emits)
    }

    @Test
    fun `a new key cancels the pending trailing emit`() = runTest {
        val gate = gate()
        gate.onChange(1 to 0)
        gate.onChange(1 to 0)

        gate.onChange(1 to 1)
        assertEquals(2, emits)

        advance(500)
        assertEquals(2, emits)
    }

    @Test
    fun `cancel drops a pending trailing emit`() = runTest {
        val gate = gate()
        gate.onChange(1 to 0)
        gate.onChange(1 to 0)

        gate.cancel()
        advance(500)

        assertEquals(1, emits)
    }
}
