package jp.raspisystem.haizen.shell

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechResultRuleTest {
    @Test fun trimsDropsBlanksAndDeduplicatesInRecognizerOrder() {
        assertEquals(listOf("テーブル", "DAD3350", "BE01"), SpeechResultRule.clean(
            listOf(" テーブル ", "", "\t\n", "DAD3350", "テーブル", " BE01 ")
        ))
    }

    @Test fun capsAtFiveAfterCleaning() {
        assertEquals(listOf("A", "B", "C", "D", "E"), SpeechResultRule.clean(
            listOf("", "A", " A ", "B", "C", "D", "E", "F")
        ))
    }

    @Test fun missingOrBlankResultsAreEmpty() {
        assertEquals(emptyList<String>(), SpeechResultRule.clean(null))
        assertEquals(emptyList<String>(), SpeechResultRule.clean(listOf(" ", "\u3000")))
    }
}
