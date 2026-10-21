package jp.raspisystem.haizen.shell

import java.net.URI

/** Compare parsed origins, never URL prefixes (including host suffixes/userinfo). */
object HaizenOrigin {
    fun matches(url: String?, origin: String): Boolean = try {
        val candidate = URI(url ?: "")
        val trusted = URI(origin)
        candidate.scheme.equals(trusted.scheme, ignoreCase = true) &&
            candidate.scheme.equals("https", ignoreCase = true) &&
            candidate.host != null && candidate.host.equals(trusted.host, ignoreCase = true) &&
            candidate.rawUserInfo == null && effectivePort(candidate) == effectivePort(trusted)
    } catch (_: Exception) {
        false
    }

    private fun effectivePort(uri: URI) = if (uri.port == -1) 443 else uri.port
}
