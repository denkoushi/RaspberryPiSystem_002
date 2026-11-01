package jp.raspisystem.haizen.shell

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class AppUpdateTest {
    private val hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    private val fields = mapOf("versionCode" to 3, "versionName" to "0.3", "sha256" to hash, "size" to 3L)

    @Test fun parsesJsonFieldsWithoutAndroidJsonStubs() {
        assertEquals(AppUpdate.Version(3, "0.3", hash, 3), AppUpdate.parse(fields))
        for (key in fields.keys) assertNull(AppUpdate.parse(fields - key))
        for ((key, bad) in listOf("versionCode" to 0, "versionCode" to 3.5, "versionCode" to "3",
            "size" to -1, "size" to 1.5, "sha256" to hash.uppercase(), "sha256" to "$hash\n", "versionName" to 3)) {
            assertNull(AppUpdate.parse(fields + (key to bad)))
        }
    }

    @Test fun onlyOffersStrictlyNewerVersions() {
        assertTrue(AppUpdate.isNewer(4, 3))
        assertFalse(AppUpdate.isNewer(3, 3))
        assertFalse(AppUpdate.isNewer(2, 3))
    }

    @Test fun verifiesSizeAndSha256() {
        val file = File.createTempFile("haizen-update", ".apk")
        try {
            file.writeText("abc")
            val version = AppUpdate.parse(fields)!!
            assertEquals(hash, file.inputStream().use { AppUpdate.sha256(it) })
            assertTrue(AppUpdate.matches(file, version))
            assertFalse(AppUpdate.matches(file, version.copy(size = 4)))
            file.writeText("abd")
            assertFalse(AppUpdate.matches(file, version))
        } finally { file.delete() }
    }
}
