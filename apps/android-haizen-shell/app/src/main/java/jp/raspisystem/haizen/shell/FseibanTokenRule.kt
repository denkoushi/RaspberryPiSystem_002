package jp.raspisystem.haizen.shell

import java.text.Normalizer
import java.util.Locale

object FseibanTokenRule {
    private val token = Regex("^[A-Z][A-Z0-9]{5,11}$")

    fun extract(text: String): List<String> =
        Normalizer.normalize(text, Normalizer.Form.NFKC)
            .uppercase(Locale.ROOT)
            // Preserve whitespace boundaries; only join hyphens/underscores inside a word.
            .split(Regex("[\\s\\p{Z}]+"))
            .flatMap { it.replace("-", "").replace("_", "").split(Regex("[^A-Z0-9]+")) }
            .filter { token.matches(it) && it.any { ch -> ch in '0'..'9' } }
            .distinct()
}
