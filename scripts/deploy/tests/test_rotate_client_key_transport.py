#!/usr/bin/env python3
"""Check CLI validation and credential transport without a running database."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts/security/rotate-client-key.sh"
DEVICE_ID = "00000000-0000-4000-8000-000000000001"
OLD = "client-key-dummy-signage-" + "a" * 32
NEW = "client-key-dummy-signage-" + "b" * 32
SUCCESS = "SUCCESS apiKey=1 signagePreviewTargetApiKey=2 targetClientKeys=1"


class ClientKeyTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # The stub validates real process arguments and COPY data before
        # returning controlled psql output. SQL behavior is tested separately.
        stub = Path(self.temp.name) / "psql"
        stub.write_text(
            "#!/usr/bin/env python3\n"
            "import os, sys\n"
            "old, new = os.environ['OLD_CLIENT_KEY'], os.environ['NEW_CLIENT_KEY']\n"
            "assert all(old not in arg and new not in arg for arg in sys.argv)\n"
            "sql = sys.stdin.read()\n"
            "assert old not in sql and new not in sql\n"
            "row = sql.split('COPY rotation_input FROM STDIN;\\n')[1].split('\\n')[0]\n"
            "device, old_hex, new_hex = row.split('\\t')\n"
            "assert bytes.fromhex(old_hex).decode() == old\n"
            "assert bytes.fromhex(new_hex).decode() == new\n"
            "assert ('ROLLBACK;\\n\\\\echo SUCCESS' in sql) == (os.environ.get('DRY') == '1')\n"
            "if os.environ.get('FAIL_DB') == '1':\n"
            "    print(old + new, file=sys.stderr)\n"
            "    sys.exit(1)\n"
            "print(os.environ['REPLY'])\n"
        )
        stub.chmod(0o755)
        self.env = {**os.environ, "PATH": self.temp.name + os.pathsep + os.environ["PATH"],
                    "ROTATE_CLIENT_KEY_DB_MODE": "psql", "OLD_CLIENT_KEY": OLD,
                    "NEW_CLIENT_KEY": NEW, "REPLY": SUCCESS}

    def run_script(self, *args, trace=False):
        result = subprocess.run(["bash", *(["-x"] if trace else []), str(SCRIPT), *args],
                                env=self.env, capture_output=True, text=True, check=False)
        output = result.stdout + result.stderr
        for name in ("OLD_CLIENT_KEY", "NEW_CLIENT_KEY"):
            value = self.env.get(name)
            if value:
                self.assertNotIn(value, output)
        return result, output

    def test_stdin_transport_and_trace_suppression(self):
        result, output = self.run_script(DEVICE_ID, trace=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("mode=execute", output)

    def test_arbitrary_legacy_value_is_copy_data(self):
        self.env["OLD_CLIENT_KEY"] = "dummy-legacy-'\\\n-value"
        result, _ = self.run_script(DEVICE_ID)
        self.assertEqual(result.returncode, 0)

    def test_dry_run_transport(self):
        self.env["DRY"] = "1"
        result, output = self.run_script("--dry-run", DEVICE_ID)
        self.assertEqual(result.returncode, 0)
        self.assertIn("mode=dry-run", output)

    def test_database_error_is_redacted(self):
        self.env["FAIL_DB"] = "1"
        result, output = self.run_script(DEVICE_ID)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("database operation failed", output)

    def test_unexpected_database_output_is_redacted(self):
        self.env["REPLY"] = OLD + NEW
        result, _ = self.run_script(DEVICE_ID)
        self.assertNotEqual(result.returncode, 0)

    def test_invalid_arguments_are_rejected(self):
        for args in ((), ("dummy-invalid-uuid",), (DEVICE_ID, DEVICE_ID), (DEVICE_ID, "--unknown")):
            with self.subTest(args=args):
                result, _ = self.run_script(*args)
                self.assertNotEqual(result.returncode, 0)

    def test_key_preconditions_are_rejected(self):
        for new in (OLD, "dummy-format", "client-key-dummy-" + "a" * 31,
                    "client-key-dummy-" + "g" * 32, "client-key-dummy-" + "a" * 260,
                    "client-key-dummy-" + "b" * 32, ""):
            with self.subTest(new_length=len(new)):
                self.env["NEW_CLIENT_KEY"] = new
                result, _ = self.run_script(DEVICE_ID)
                self.assertNotEqual(result.returncode, 0)

    def test_case_insensitive_signage_identity(self):
        self.env["OLD_CLIENT_KEY"] = OLD.replace("signage", "SIGNAGE")
        result, _ = self.run_script(DEVICE_ID)
        self.assertEqual(result.returncode, 0)

    def test_restore_legacy_value_is_copy_data(self):
        self.env["NEW_CLIENT_KEY"] = "dummy-legacy-signage-'\\\n-value"
        result, output = self.run_script(DEVICE_ID, "--restore", trace=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("mode=restore ", output)

    def test_legacy_destination_requires_restore(self):
        self.env["NEW_CLIENT_KEY"] = "dummy-legacy-signage-value"
        result, output = self.run_script(DEVICE_ID)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("new key format is invalid", output)

    def test_restore_dry_run_transport_in_both_option_orders(self):
        self.env["NEW_CLIENT_KEY"] = "dummy-legacy-signage-value"
        self.env["DRY"] = "1"
        for options in (("--restore", "--dry-run"), ("--dry-run", "--restore")):
            with self.subTest(options=options):
                result, output = self.run_script(*options, DEVICE_ID)
                self.assertEqual(result.returncode, 0)
                self.assertIn("mode=restore-dry-run ", output)

    def test_restore_keeps_key_preconditions(self):
        for new, reason in ((OLD, "differ from old key"), ("", "both key environment"),
                            ("dummy-signage-" + "x" * 256, "new key format is invalid"),
                            ("dummy-legacy-value", "preserve signage identity")):
            with self.subTest(reason=reason):
                self.env["NEW_CLIENT_KEY"] = new
                result, output = self.run_script(DEVICE_ID, "--restore")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(reason, output)
        self.env["NEW_CLIENT_KEY"] = "dummy-legacy-signage-value"
        self.env["OLD_CLIENT_KEY"] = ""
        result, output = self.run_script(DEVICE_ID, "--restore")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("both key environment", output)

    def test_restore_keeps_uuid_validation(self):
        result, output = self.run_script("dummy-invalid-uuid", "--restore")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be a UUID", output)

    def test_restore_preserves_database_rejections(self):
        self.env["NEW_CLIENT_KEY"] = "dummy-legacy-signage-value"
        for reason in ("old key does not match", "new key is already in use",
                       "final verification failed", "target row does not exist"):
            with self.subTest(reason=reason):
                self.env["REPLY"] = "FAIL: " + reason
                result, output = self.run_script(DEVICE_ID, "--restore")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(output.strip(), "FAIL: " + reason + " mode=restore")


if __name__ == "__main__":
    unittest.main()
