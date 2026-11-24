from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

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
    sys.exit(0 if os.environ.get("BACKUP_ACTIVE") else 3)
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


@pytest.fixture
def oracle_copy(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "fake-tool"
    fake.write_text(f"#!{sys.executable}\n{FAKE_TOOL}", encoding="utf-8")
    fake.chmod(0o755)
    for command in ("rclone", "restic", "timeout", "test-systemctl"):
        (bin_dir / command).symlink_to(fake)

    calls = tmp_path / "calls.jsonl"
    env = {
        "PATH": os.pathsep.join((str(bin_dir), str(Path(sys.executable).parent), os.defpath)),
        "CALLS": str(calls),
        "ORACLE_DR_SYSTEMCTL": str(bin_dir / "test-systemctl"),
        "ORACLE_DR_RCLONE": str(bin_dir / "rclone"),
        "ORACLE_DR_RCLONE_CONFIG": str(tmp_path / "rclone.conf"),
        "ORACLE_DR_RESTIC_PASSWORD_FILE": str(tmp_path / "restic-password"),
        "ORACLE_DR_ENV_FILE": str(tmp_path / "oracle.env"),
        "ORACLE_DR_OCI_CONFIG": str(tmp_path / "oci-config"),
    }
    for key in ("ORACLE_DR_RCLONE_CONFIG", "ORACLE_DR_RESTIC_PASSWORD_FILE", "ORACLE_DR_OCI_CONFIG"):
        Path(env[key]).touch()
    Path(env["ORACLE_DR_ENV_FILE"]).write_text(
        "".join(f"{key}={value}\n" for key, value in ORACLE_ENV.items()), encoding="utf-8"
    )

    def run(**overrides):
        result = subprocess.run(
            ["/bin/bash", str(SCRIPT)], env={**env, **overrides}, text=True, capture_output=True,
        )
        records = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
        return result, records

    return env, run


def test_copies_and_verifies_the_repository(oracle_copy):
    env, run = oracle_copy
    result, records = run(ORACLE_DR_MAX_BYTES="100")
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.splitlines()[-1] == "RESULT=OK"
    assert [record[0] for record in records] == [
        "test-systemctl", "lsf", "timeout", "restic", "copy", "check", "size",
    ]

    conf = env["ORACLE_DR_RCLONE_CONFIG"]
    restic_args = [
        "-r", f"rclone:{SRC}", "--password-file", env["ORACLE_DR_RESTIC_PASSWORD_FILE"],
        "--no-cache", "--no-lock", "cat", "config",
    ]
    assert records[0][1] == ["is-active", "--quiet", "raspi-google-drive-dr.service"]
    assert records[1][1] == ["--config", conf, "lsf", SRC]
    assert records[2][1] == ["300", "restic", *restic_args]
    assert records[3][1:] == [restic_args, {"RCLONE_CONFIG": conf}]
    assert records[4][1] == [
        "--config", conf, "copy", SRC, DEST, "--exclude", "locks/**", "--immutable", "--size-only",
        "--fast-list", "--oos-no-check-bucket", "--transfers", "4", "--checkers", "4",
        "--retries", "3", "--stats-one-line", "-v",
    ]
    assert records[5][1] == [
        "--config", conf, "check", SRC, DEST, "--one-way", "--size-only", "--exclude", "locks/**",
        "--fast-list", "--oos-no-check-bucket",
    ]
    assert records[6][1] == [
        "--config", conf, "size", "--json", "--fast-list", "--oos-no-check-bucket", DEST,
    ]
    for _, _, environment in records[4:]:
        assert environment == {
            "RCLONE_CONFIG_ORACLE_TYPE": "oracleobjectstorage",
            "RCLONE_CONFIG_ORACLE_PROVIDER": "user_principal_auth",
            "RCLONE_CONFIG_ORACLE_NAMESPACE": ORACLE_ENV["ORACLE_DR_NAMESPACE"],
            "RCLONE_CONFIG_ORACLE_COMPARTMENT": ORACLE_ENV["ORACLE_DR_COMPARTMENT"],
            "RCLONE_CONFIG_ORACLE_REGION": ORACLE_ENV["ORACLE_DR_REGION"],
            "RCLONE_CONFIG_ORACLE_CONFIG_FILE": env["ORACLE_DR_OCI_CONFIG"],
            "RCLONE_CONFIG_ORACLE_CONFIG_PROFILE": "DEFAULT",
        }


@pytest.mark.parametrize(("overrides", "message", "commands"), [
    ({"FAIL_RESTIC": "1"}, "password does not open the source", ["lsf", "timeout", "restic"]),
    ({"NO_SOURCE_CONFIG": "1"}, "source has no restic config file", ["lsf"]),
    ({"FAIL_COPY": "1"}, "Oracle copy failed", ["lsf", "timeout", "restic", "copy"]),
    ({"FAIL_CHECK": "1"}, "Oracle copy verification failed", ["lsf", "timeout", "restic", "copy", "check"]),
    ({"BACKUP_ACTIVE": "1"}, "Google Drive DR backup is running", []),
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
])
def test_stops_at_the_failed_step(oracle_copy, overrides, message, commands):
    _, run = oracle_copy
    result, records = run(**overrides)
    assert result.returncode != 0
    assert message in result.stdout
    assert "RESULT=OK" not in result.stdout
    assert [record[0] for record in records] == ["test-systemctl", *commands]


@pytest.mark.parametrize("key", [
    "ORACLE_DR_ENV_FILE", "ORACLE_DR_OCI_CONFIG", "ORACLE_DR_RCLONE_CONFIG",
    "ORACLE_DR_RESTIC_PASSWORD_FILE", "ORACLE_DR_RCLONE",
])
def test_fails_before_running_commands_when_a_required_file_is_missing(oracle_copy, key):
    env, run = oracle_copy
    Path(env[key]).unlink()
    result, records = run()
    assert result.returncode != 0
    assert "RESULT=FAILED" in result.stdout
    assert env[key] in result.stdout
    assert records == []


@pytest.mark.parametrize("empty_key", ORACLE_ENV)
def test_fails_when_an_oracle_setting_is_empty(oracle_copy, empty_key):
    env, run = oracle_copy
    config = {**ORACLE_ENV, empty_key: ""}
    Path(env["ORACLE_DR_ENV_FILE"]).write_text(
        "".join(f"{key}={value}\n" for key, value in config.items()), encoding="utf-8"
    )
    result, records = run()
    assert result.returncode != 0
    assert f"{empty_key} is empty or missing in oracle.env" in result.stdout
    assert [record[0] for record in records] == ["test-systemctl"]
