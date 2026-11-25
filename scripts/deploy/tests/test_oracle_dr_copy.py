from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "scripts/google_drive_dr/oracle-dr-copy.sh"
SRC = "google-drive:RaspberryPiSystem_002/business-pi5"
DEST = "oracle:raspi-dr-business-pi5"
ORACLE_ENV = {
    "ORACLE_DR_NAMESPACE": "test-namespace",
    "ORACLE_DR_COMPARTMENT": "test-compartment",
    "ORACLE_DR_REGION": "ap-tokyo-1",
}

FAKE_TOOL = r'''
import json
import os
import sys
from pathlib import Path

tool = Path(sys.argv[0]).name
args = sys.argv[1:]
command = args[2] if tool == "rclone" else tool
environment = {
    key: value for key, value in os.environ.items()
    if key == "RCLONE_CONFIG" or key.startswith("RCLONE_CONFIG_ORACLE_")
}
with open(os.environ["CALLS"], "a") as log:
    print(json.dumps([command, args, environment]), file=log)

if tool == "timeout":
    os.execvp(args[1], args[1:])
if tool == "test-systemctl":
    print(os.environ.get("BACKUP_STATE", "inactive"))
    sys.exit(1 if os.environ.get("FAIL_SYSTEMCTL") else 0)
if tool == "restic":
    sys.exit(1 if os.environ.get("FAIL_RESTIC") else 0)
if command == "lsf":
    if not os.environ.get("NO_SOURCE_CONFIG"):
        print("config")
    print("snapshots/")
elif command == "check":
    sys.exit(1 if os.environ.get("FAIL_CHECK") else 0)
elif command == "copy":
    sys.exit(1 if os.environ.get("FAIL_COPY") else 0)
elif command == "size":
    print(json.dumps({"bytes": int(os.environ.get("BUCKET_BYTES", "100"))}))
else:
    sys.exit("unexpected fake rclone command")
'''


class OracleDrCopyTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        tmp_path = Path(directory.name)
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        fake = bin_dir / "fake-tool"
        fake.write_text(f"#!{sys.executable}\n{FAKE_TOOL}", encoding="utf-8")
        fake.chmod(0o755)
        for command in ("rclone", "restic", "timeout", "test-systemctl"):
            (bin_dir / command).symlink_to(fake)

        self.calls = tmp_path / "calls.jsonl"
        self.env = {
            "PATH": os.pathsep.join((str(bin_dir), str(Path(sys.executable).parent), os.defpath)),
            "CALLS": str(self.calls),
            "ORACLE_DR_SYSTEMCTL": str(bin_dir / "test-systemctl"),
            "ORACLE_DR_RCLONE": str(bin_dir / "rclone"),
            "ORACLE_DR_RCLONE_CONFIG": str(tmp_path / "rclone.conf"),
            "ORACLE_DR_RESTIC_PASSWORD_FILE": str(tmp_path / "restic-password"),
            "ORACLE_DR_ENV_FILE": str(tmp_path / "oracle.env"),
            "ORACLE_DR_OCI_CONFIG": str(tmp_path / "oci-config"),
        }
        for key in ("ORACLE_DR_RCLONE_CONFIG", "ORACLE_DR_RESTIC_PASSWORD_FILE", "ORACLE_DR_OCI_CONFIG"):
            Path(self.env[key]).touch()
        self.write_oracle_env(ORACLE_ENV)

    def write_oracle_env(self, config: dict[str, str]) -> None:
        Path(self.env["ORACLE_DR_ENV_FILE"]).write_text(
            "".join(f"{key}={value}\n" for key, value in config.items()), encoding="utf-8"
        )

    def run_copy(self, **overrides: str):
        self.calls.unlink(missing_ok=True)
        result = subprocess.run(
            ["/bin/bash", str(SCRIPT)], env={**self.env, **overrides}, text=True, capture_output=True,
        )
        records = (
            [json.loads(line) for line in self.calls.read_text().splitlines()]
            if self.calls.exists() else []
        )
        return result, records

    def test_copies_and_verifies_the_repository(self) -> None:
        env = self.env
        result, records = self.run_copy(ORACLE_DR_MAX_BYTES="100")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.splitlines()[-1], "RESULT=OK")
        self.assertEqual([record[0] for record in records], [
            "test-systemctl", "lsf", "timeout", "restic", "copy", "check", "size",
        ])

        conf = env["ORACLE_DR_RCLONE_CONFIG"]
        restic_args = [
            "-r", f"rclone:{SRC}", "--password-file", env["ORACLE_DR_RESTIC_PASSWORD_FILE"],
            "--no-cache", "--no-lock", "cat", "config",
        ]
        self.assertEqual(records[0][1], ["show", "-p", "ActiveState", "--value", "raspi-google-drive-dr.service"])
        self.assertEqual(records[1][1], ["--config", conf, "lsf", SRC])
        self.assertEqual(records[2][1], ["300", "restic", *restic_args])
        self.assertEqual(records[3][1:], [restic_args, {"RCLONE_CONFIG": conf}])
        self.assertEqual(records[4][1], [
            "--config", conf, "copy", SRC, DEST, "--exclude", "locks/**", "--immutable", "--size-only",
            "--fast-list", "--oos-no-check-bucket", "--transfers", "4", "--checkers", "4",
            "--retries", "3", "--stats-one-line", "-v",
        ])
        self.assertEqual(records[5][1], [
            "--config", conf, "check", SRC, DEST, "--one-way", "--size-only", "--exclude", "locks/**",
            "--fast-list", "--oos-no-check-bucket",
        ])
        self.assertEqual(records[6][1], [
            "--config", conf, "size", "--json", "--fast-list", "--oos-no-check-bucket", DEST,
        ])
        for _, _, environment in records[4:]:
            self.assertEqual(environment, {
                "RCLONE_CONFIG_ORACLE_TYPE": "oracleobjectstorage",
                "RCLONE_CONFIG_ORACLE_PROVIDER": "user_principal_auth",
                "RCLONE_CONFIG_ORACLE_NAMESPACE": ORACLE_ENV["ORACLE_DR_NAMESPACE"],
                "RCLONE_CONFIG_ORACLE_COMPARTMENT": ORACLE_ENV["ORACLE_DR_COMPARTMENT"],
                "RCLONE_CONFIG_ORACLE_REGION": ORACLE_ENV["ORACLE_DR_REGION"],
                "RCLONE_CONFIG_ORACLE_CONFIG_FILE": env["ORACLE_DR_OCI_CONFIG"],
                "RCLONE_CONFIG_ORACLE_CONFIG_PROFILE": "DEFAULT",
            })

    def test_runs_after_a_failed_backup(self) -> None:
        result, _ = self.run_copy(BACKUP_STATE="failed")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_stops_at_the_failed_step(self) -> None:
        cases = [
            ({"FAIL_RESTIC": "1"}, "password does not open the source", ["lsf", "timeout", "restic"]),
            ({"NO_SOURCE_CONFIG": "1"}, "source has no restic config file", ["lsf"]),
            ({"FAIL_COPY": "1"}, "Oracle copy failed", ["lsf", "timeout", "restic", "copy"]),
            ({"FAIL_CHECK": "1"}, "Oracle copy verification failed",
             ["lsf", "timeout", "restic", "copy", "check"]),
            ({"BACKUP_STATE": "active"}, "Google Drive DR backup is running", []),
            ({"BACKUP_STATE": "activating"}, "Google Drive DR backup is running", []),
            ({"BACKUP_STATE": "deactivating"}, "Google Drive DR backup is running", []),
            ({"FAIL_SYSTEMCTL": "1"}, "could not read Google Drive DR backup state", []),
            (
                {"BUCKET_BYTES": "101", "ORACLE_DR_MAX_BYTES": "100"},
                "check whether the monthly bucket cleanup was missed",
                ["lsf", "timeout", "restic", "copy", "check", "size"],
            ),
            (
                {"BUCKET_BYTES": str(17 * 1024**3 + 1)},
                "check whether the monthly bucket cleanup was missed",
                ["lsf", "timeout", "restic", "copy", "check", "size"],
            ),
        ]
        for overrides, message, commands in cases:
            with self.subTest(overrides=overrides):
                result, records = self.run_copy(**overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stdout)
                self.assertNotIn("RESULT=OK", result.stdout)
                self.assertEqual([record[0] for record in records], ["test-systemctl", *commands])

    def test_fails_before_running_commands_when_a_required_file_is_missing(self) -> None:
        for key in (
            "ORACLE_DR_ENV_FILE", "ORACLE_DR_OCI_CONFIG", "ORACLE_DR_RCLONE_CONFIG",
            "ORACLE_DR_RESTIC_PASSWORD_FILE", "ORACLE_DR_RCLONE",
        ):
            with self.subTest(key=key):
                path = Path(self.env[key])
                saved = path.with_name(path.name + ".saved")
                path.rename(saved)
                try:
                    result, records = self.run_copy()
                finally:
                    saved.rename(path)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("RESULT=FAILED", result.stdout)
                self.assertIn(self.env[key], result.stdout)
                self.assertEqual(records, [])

    def test_fails_when_an_oracle_setting_is_empty(self) -> None:
        for empty_key in ORACLE_ENV:
            with self.subTest(key=empty_key):
                self.write_oracle_env({**ORACLE_ENV, empty_key: ""})
                result, records = self.run_copy()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"{empty_key} is empty or missing in oracle.env", result.stdout)
                self.assertEqual([record[0] for record in records], ["test-systemctl"])


if __name__ == "__main__":
    unittest.main()
