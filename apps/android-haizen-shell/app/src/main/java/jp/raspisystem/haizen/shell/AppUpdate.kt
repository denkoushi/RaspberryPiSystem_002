package jp.raspisystem.haizen.shell

import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** JSON fields are extracted at the Android boundary, like LocalDataVersions. */
object AppUpdate {
    data class Version(val versionCode: Int, val versionName: String, val sha256: String, val size: Long)

    fun parse(fields: Map<String, Any?>): Version? {
        val code = fields["versionCode"] as? Number ?: return null
        val name = fields["versionName"] as? String ?: return null
        val hash = fields["sha256"] as? String ?: return null
        val size = fields["size"] as? Number ?: return null
        if (code.toDouble() != code.toInt().toDouble() || code.toInt() <= 0 ||
            size.toDouble() != size.toLong().toDouble() || size.toLong() <= 0 ||
            !Regex("[0-9a-f]{64}").matches(hash)) return null
        return Version(code.toInt(), name, hash, size.toLong())
    }

    fun isNewer(remoteCode: Int, currentCode: Int) = remoteCode > currentCode

    fun sha256(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    fun matches(file: File, version: Version) = file.length() == version.size &&
        file.inputStream().use { sha256(it) } == version.sha256
}
