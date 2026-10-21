package jp.raspisystem.haizen.shell

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HaizenOriginTest {
    private val origin = "https://raspberrypi.tail7312a3.ts.net:8443"

    @Test fun acceptsOnlyTheConfiguredOrigin() {
        assertTrue(HaizenOrigin.matches("$origin/kiosk/mobile-placement?x=1#scan", origin))
        assertTrue(HaizenOrigin.matches("HTTPS://RASPBERRYPI.TAIL7312A3.TS.NET:8443/", origin))
        for (url in listOf(null, "", "not a URL", "http://raspberrypi.tail7312a3.ts.net:8443/",
            "https://raspberrypi.tail7312a3.ts.net/", "$origin.evil.test/",
            "https://raspberrypi.tail7312a3.ts.net.evil.test:8443/", "$origin@evil.test/",
            "https://evil.test@$origin/", "https://user@raspberrypi.tail7312a3.ts.net:8443/",
            "javascript:alert(1)", "file:///kiosk/mobile-placement")) {
            assertFalse(url, HaizenOrigin.matches(url, origin))
        }
    }

    @Test fun treatsTheDefaultHttpsPortAs443() {
        assertTrue(HaizenOrigin.matches("https://example.test:443/path", "https://example.test"))
        assertFalse(HaizenOrigin.matches("https://example.test:8443/path", "https://example.test"))
    }
}
