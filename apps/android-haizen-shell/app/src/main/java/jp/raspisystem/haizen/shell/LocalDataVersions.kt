package jp.raspisystem.haizen.shell

/** Dataset-independent decisions; no Android or JSON dependency. */
object LocalDataVersions {
    data class Version(val version: String, val dataUpdatedAt: String?)

    private val keyPattern = Regex("^[a-z][A-Za-z0-9-]{0,31}$")
    fun isValidKey(key: String) = keyPattern.matches(key)

    fun keysToFetch(cached: Map<String, Version>, latest: Map<String, Version>): List<String> =
        latest.keys.filter { isValidKey(it) && cached[it]?.version != latest[it]?.version }

    fun merge(
        cached: Map<String, Version>, downloaded: Map<String, Version>, filesOnDisk: Set<String>
    ): Map<String, Version> = (cached + downloaded).filterKeys { isValidKey(it) && it in filesOnDisk }
}
