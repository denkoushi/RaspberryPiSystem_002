package jp.raspisystem.haizen.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ConsecutiveConfirmerTest {
    @Test fun confirmsAfterTwoFramesAndLatchesUntilReset() {
        val confirmer = ConsecutiveConfirmer(2)
        assertNull(confirmer.feed(listOf("BE1N9321", "BE1N9321"), 100))
        assertEquals(Confirmation("BE1N9321", 2, 40), confirmer.feed(listOf("BE1N9321"), 140))
        assertNull(confirmer.feed(listOf("BE1N9321"), 160))
        confirmer.reset()
        assertNull(confirmer.feed(listOf("XY9876"), 1000))
        assertEquals(Confirmation("XY9876", 2, 50), confirmer.feed(listOf("XY9876"), 1050))
    }

    @Test fun emptyFrameBreaksStreakButKeepsFirstTokenTime() {
        val confirmer = ConsecutiveConfirmer(2)
        assertNull(confirmer.feed(emptyList(), 0))
        assertNull(confirmer.feed(listOf("BE1N9321"), 100))
        assertNull(confirmer.feed(emptyList(), 200))
        assertNull(confirmer.feed(listOf("BE1N9321"), 300))
        assertEquals(Confirmation("BE1N9321", 2, 300), confirmer.feed(listOf("BE1N9321"), 400))
    }

    @Test fun replacementTokenDoesNotInheritStreakButUsesAnyTokenStartTime() {
        val confirmer = ConsecutiveConfirmer(3)
        assertNull(confirmer.feed(listOf("BE1N9321"), 10))
        assertNull(confirmer.feed(listOf("XY9876"), 20))
        assertNull(confirmer.feed(listOf("XY9876", "BE1N9321"), 30))
        assertEquals(Confirmation("XY9876", 3, 30), confirmer.feed(listOf("BE1N9321", "XY9876"), 40))
    }

    @Test fun resetClearsUnfinishedStreakAndInitialTimestamp() {
        val confirmer = ConsecutiveConfirmer(2)
        assertNull(confirmer.feed(listOf("BE1N9321"), 0))
        confirmer.reset()
        assertNull(confirmer.feed(listOf("BE1N9321"), 500))
        assertEquals(Confirmation("BE1N9321", 2, 25), confirmer.feed(listOf("BE1N9321"), 525))
    }

    @Test fun supportsOneFrame() {
        assertEquals(Confirmation("AB1234", 1, 0), ConsecutiveConfirmer(1).feed(listOf("AB1234"), 0))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsZeroFrames() { ConsecutiveConfirmer(0) }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNegativeFrames() { ConsecutiveConfirmer(-1) }
}
