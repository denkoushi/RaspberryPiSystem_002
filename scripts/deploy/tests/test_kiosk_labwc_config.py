from __future__ import annotations

from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "infrastructure/ansible/roles/release_kiosk/files/kiosk-labwc-config.py"
HELPER = runpy.run_path(str(SCRIPT))
UPDATE = HELPER["update_config"]
FIXTURES = Path(__file__).parent / "fixtures"
NS = {"rc": "http://openbox.org/3.4/rc"}


class KioskLabwcConfigTests(unittest.TestCase):
    def test_long_config_preserves_existing_text_and_inserts_inside_window_rules(self):
        original = (FIXTURES / "kiosk-labwc-long.xml").read_text()
        result = UPDATE(original)
        expected = original.replace("<windowRules>", "<windowRules>\n    " + HELPER["TITLEBAR_RULE"])
        self.assertEqual(result, expected)
        root = ET.fromstring(result)
        rules = root.findall("rc:windowRules/rc:windowRule", NS)
        self.assertEqual([rule.get("identifier") for rule in rules], ["Chromium", "Kodi"])
        self.assertEqual(rules[0].get("serverDecoration"), "no")
        self.assertEqual(UPDATE(result), result)

    def test_single_line_root_with_trailing_shortcut_is_repaired(self):
        original = (FIXTURES / "kiosk-labwc-fjv60-80.xml").read_text()
        result = UPDATE(original)
        root = ET.fromstring(result)
        self.assertEqual(root.find("rc:keyboard/rc:keybind", NS).get("key"), "W-S-p")
        self.assertIsNotNone(root.find("rc:windowRules/rc:windowRule", NS))
        self.assertIn("<theme><name>PiXflat</name></theme>", result)
        self.assertEqual(result.count("BEGIN ANSIBLE MANAGED: show-kiosk-panel"), 1)
        self.assertEqual(UPDATE(result), result)

    def test_trailing_shortcut_uses_existing_keyboard(self):
        original = (FIXTURES / "kiosk-labwc-fjv60-80.xml").read_text().replace(
            "</theme>", '</theme><keyboard><keybind key="A-F4" /></keyboard>'
        )
        root = ET.fromstring(UPDATE(original))
        self.assertEqual(len(root.findall("rc:keyboard", NS)), 1)
        self.assertEqual(len(root.findall("rc:keyboard/rc:keybind", NS)), 2)

    def test_labwc_root_and_comment_tags(self):
        original = (
            '<labwc_config><!-- <windowRules></windowRules></labwc_config> -->'
            '<theme><name>PiXflat</name></theme></labwc_config>'
        )
        result = UPDATE(original)
        root = ET.fromstring(result)
        self.assertIsNotNone(root.find("windowRules/windowRule"))
        self.assertIn("<!-- <windowRules></windowRules></labwc_config> -->", result)

    def test_nested_window_rules_are_not_used(self):
        result = UPDATE("<labwc_config><other><windowRules /></other></labwc_config>")
        root = ET.fromstring(result)
        self.assertIsNotNone(root.find("windowRules/windowRule"))
        self.assertIsNone(root.find("other/windowRules/windowRule"))

    def test_self_closing_sections(self):
        original = (FIXTURES / "kiosk-labwc-fjv60-80.xml").read_text().replace(
            "</theme>", "</theme><keyboard/><windowRules/>"
        )
        root = ET.fromstring(UPDATE(original))
        self.assertIsNotNone(root.find("rc:keyboard/rc:keybind", NS))
        self.assertIsNotNone(root.find("rc:windowRules/rc:windowRule", NS))

    def test_invalid_result_leaves_file_unchanged(self):
        for original in (
            "<openbox_config><theme></openbox_config>",
            (FIXTURES / "kiosk-labwc-fjv60-80.xml").read_text() + "unexpected trailing text",
            '<openbox_config><theme name="unterminated></theme></openbox_config>',
        ):
            with self.subTest(original=original), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "rc.xml"
                path.write_text(original)
                result = subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(path.read_text(), original)

    def test_cli_reports_changes_and_preserves_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rc.xml"
            path.write_text((FIXTURES / "kiosk-labwc-long.xml").read_text())
            path.chmod(0o640)
            for expected in ("changed\n", "unchanged\n"):
                result = subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, expected)
                self.assertEqual(path.stat().st_mode & 0o777, 0o640)


if __name__ == "__main__":
    unittest.main()
