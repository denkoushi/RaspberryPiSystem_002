package jp.raspisystem.haizen.shell

data class Confirmation(val value: String, val frames: Int, val msSinceFirstSeen: Long)

class ConsecutiveConfirmer(private val required: Int) {
    init { require(required > 0) }

    private var streaks = emptyMap<String, Int>()
    private var firstSeenMs: Long? = null
    private var confirmed = false

    fun feed(tokensInFrame: List<String>, nowMs: Long): Confirmation? {
        if (confirmed) return null
        val tokens = tokensInFrame.distinct()
        if (tokens.isNotEmpty() && firstSeenMs == null) firstSeenMs = nowMs
        streaks = tokens.associateWith { (streaks[it] ?: 0) + 1 }
        val value = tokens.firstOrNull { streaks.getValue(it) >= required } ?: return null
        confirmed = true
        return Confirmation(value, required, nowMs - checkNotNull(firstSeenMs))
    }

    fun reset() {
        streaks = emptyMap()
        firstSeenMs = null
        confirmed = false
    }
}
