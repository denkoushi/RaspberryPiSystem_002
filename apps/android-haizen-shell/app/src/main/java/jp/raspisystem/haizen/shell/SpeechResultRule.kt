package jp.raspisystem.haizen.shell

object SpeechResultRule {
    fun clean(texts: List<String>?): List<String> = texts.orEmpty()
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .distinct()
        .take(5)
}
