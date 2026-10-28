package jp.raspisystem.haizen.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalDataVersionsTest {
    private val old = LocalDataVersions.Version("old", "2026-10-27T00:00:00Z")
    private val latest = LocalDataVersions.Version("latest", "2026-10-28T00:00:00Z")

    @Test fun validatesDatasetKeysAndLengthBoundaries() {
        for (key in listOf("a", "purchase", "future-data-2", "a".repeat(32))) {
            assertTrue(key, LocalDataVersions.isValidKey(key))
        }
        for (key in listOf("", "A", "2data", "-data", "../purchase", "a/b", "a.json", "a_b", "a\n", "a".repeat(33))) {
            assertFalse(key, LocalDataVersions.isValidKey(key))
        }
    }

    @Test fun fetchesNewAndChangedDatasetsWithoutHardcodingKinds() {
        val cached = mapOf("purchase" to latest, "schedule" to old, "removed" to old)
        val remote = mapOf("purchase" to latest, "schedule" to latest, "future-data" to latest, "../bad" to latest)
        assertEquals(listOf("schedule", "future-data"), LocalDataVersions.keysToFetch(cached, remote))
        assertEquals(emptyList<String>(), LocalDataVersions.keysToFetch(cached, emptyMap()))
    }

    @Test fun comparesVersionRatherThanTimestamp() {
        assertEquals(emptyList<String>(), LocalDataVersions.keysToFetch(
            mapOf("purchase" to old), mapOf("purchase" to old.copy(dataUpdatedAt = null))))
    }

    @Test fun publishesOnlyFilesOnDiskAndKeepsUnchangedOrSkippedVersions() {
        val cached = mapOf("purchase" to old, "schedule" to old, "missing" to old, "../bad" to old)
        val downloaded = mapOf("purchase" to latest, "future-data" to latest, "not-published" to latest)
        assertEquals(mapOf("purchase" to latest, "schedule" to old, "future-data" to latest),
            LocalDataVersions.merge(cached, downloaded, setOf("purchase", "schedule", "future-data", "../bad")))
    }
}
