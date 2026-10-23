package jp.raspisystem.haizen.shell

import org.junit.Assert.assertEquals
import org.junit.Test

class FseibanTokenRuleTest {
    @Test fun normalizesSlipTextAndSeparators() {
        assertEquals(listOf("BE1N9321"), FseibanTokenRule.extract("製番: be1n-9321"))
        assertEquals(listOf("BE1N9321"), FseibanTokenRule.extract("製番： ｂｅ１ｎ＿９３２１"))
        assertEquals(listOf("AB1234", "Z9ABCDE"), FseibanTokenRule.extract("(ab1234),z9abcde/AB1234"))
    }

    @Test fun whitespaceDoesNotJoinSeparateWords() {
        assertEquals(listOf("BE1N9321", "XY9876"), FseibanTokenRule.extract("be1n9321\txy9876\n"))
        assertEquals(emptyList<String>(), FseibanTokenRule.extract("BE1N 9321 AB\u30001234"))
    }

    @Test fun rejectsWordsShortNumbersAndOverlongTokens() {
        assertEquals(emptyList<String>(), FseibanTokenRule.extract(
            "ASSEMBLY AB12 123456 1ABCDE ABCDEFGHIJKL1 ABCDEF"
        ))
    }

    @Test fun acceptsSixAndTwelveCharacterBoundaries() {
        assertEquals(listOf("A12345", "ABCDEFGHIJK1"), FseibanTokenRule.extract("A12345 ABCDEFGHIJK1"))
        assertEquals(emptyList<String>(), FseibanTokenRule.extract("A1234 ABCDEFGHIJKL1"))
    }

    @Test fun emptyAndPunctuationOnlyTextProducesNoTokens() {
        assertEquals(emptyList<String>(), FseibanTokenRule.extract(""))
        assertEquals(emptyList<String>(), FseibanTokenRule.extract("製番: _- /!?"))
    }
}
