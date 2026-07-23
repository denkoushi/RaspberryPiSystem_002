from __future__ import annotations

import os
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / "infrastructure/ansible/roles/client/templates/torque-bluetooth-adapter.sh.j2"


class TorqueBluetoothAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.sys_root = self.root / "sys"
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self.state_path = self.root / "controller-state"
        self.calls_path = self.root / "btmgmt-calls"
        self.state_path.write_text("powered\n", encoding="utf-8")
        self.calls_path.write_text("", encoding="utf-8")
        self._create_controller("hci1")
        self._write_fake_timeout()
        self._write_fake_btmgmt()
        self.rendered = (
            HELPER.read_text(encoding="utf-8")
            .replace("{{ torque_agent_bluetooth_adapter.usb_vendor_id }}", "2357")
            .replace("{{ torque_agent_bluetooth_adapter.usb_product_id }}", "0604")
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _create_controller(self, name: str, *, vendor: str = "2357", hard: str = "0") -> Path:
        usb = self.sys_root / "devices" / "usb1" / "1-1" / "1-1.3"
        usb.mkdir(parents=True, exist_ok=True)
        (usb / "idVendor").write_text(f"{vendor}\n", encoding="utf-8")
        (usb / "idProduct").write_text("0604\n", encoding="utf-8")
        interface = usb / "1-1.3:1.0"
        hci = interface / "bluetooth" / name
        hci.mkdir(parents=True, exist_ok=True)
        (hci / "device").symlink_to(interface)

        bluetooth_class = self.sys_root / "class" / "bluetooth"
        bluetooth_class.mkdir(parents=True, exist_ok=True)
        (bluetooth_class / name).symlink_to(hci)

        rfkill_device = self.sys_root / "devices" / "rfkill" / f"rfkill-{name}"
        rfkill_device.mkdir(parents=True, exist_ok=True)
        (rfkill_device / "type").write_text("bluetooth\n", encoding="utf-8")
        (rfkill_device / "hard").write_text(f"{hard}\n", encoding="utf-8")
        (rfkill_device / "soft").write_text("0\n", encoding="utf-8")
        (rfkill_device / "device").symlink_to(hci)
        rfkill_class = self.sys_root / "class" / "rfkill"
        rfkill_class.mkdir(parents=True, exist_ok=True)
        (rfkill_class / f"rfkill-{name}").symlink_to(rfkill_device)
        return hci

    def _write_fake_timeout(self) -> None:
        timeout = self.bin_dir / "timeout"
        timeout.write_text(
            "#!/bin/sh\n"
            "while [ $# -gt 0 ]; do\n"
            "  case \"$1\" in\n"
            "    --signal=*|--kill-after=*) shift ;;\n"
            "    *) break ;;\n"
            "  esac\n"
            "done\n"
            "shift\n"
            "exec \"$@\"\n",
            encoding="utf-8",
        )
        timeout.chmod(0o755)

    def _write_fake_btmgmt(self) -> None:
        btmgmt = self.bin_dir / "btmgmt"
        btmgmt.write_text(
            "#!/bin/sh\n"
            "set -eu\n"
            "last=\"\"\n"
            "for argument in \"$@\"; do last=\"$argument\"; done\n"
            "printf '%s\\n' \"$last\" >> \"$TORQUE_BLUETOOTH_TEST_CALLS\"\n"
            "mode=\"${TORQUE_BLUETOOTH_TEST_MODE:?}\"\n"
            "if [ \"$mode\" = stdin-eof ]; then\n"
            "  if python3 -c 'import select, sys; raise SystemExit(0 if select.select([sys.stdin], [], [], 0)[0] else 1)'; then\n"
            "    exit 124\n"
            "  fi\n"
            "fi\n"
            "if [ \"$last\" = info ]; then\n"
            "  case \"$mode\" in\n"
            "    info-timeout) exit 124 ;;\n"
            "    info-fail) printf '%s\\n' 'management rejected info' >&2; exit 42 ;;\n"
            "    info-fail-long) printf '%0256d\\n' 0 | tr 0 x >&2; exit 42 ;;\n"
            "  esac\n"
            "  if [ \"$(cat \"$TORQUE_BLUETOOTH_TEST_STATE\")\" = powered ]; then\n"
            "    printf '%s\\n' 'current settings: powered bondable le'\n"
            "  else\n"
            "    printf '%s\\n' 'current settings: bondable le'\n"
            "  fi\n"
            "  exit 0\n"
            "fi\n"
            "if [ \"$last\" = on ]; then\n"
            "  case \"$mode\" in\n"
            "    power-timeout) exit 124 ;;\n"
            "    power-fail) printf '%s\\n' 'management rejected power on' >&2; exit 43 ;;\n"
            "    transition) printf '%s\\n' powered > \"$TORQUE_BLUETOOTH_TEST_STATE\" ;;\n"
            "  esac\n"
            "  exit 0\n"
            "fi\n"
            "if [ \"$last\" = off ]; then\n"
            "  case \"$mode\" in\n"
            "    power-off-timeout) exit 124 ;;\n"
            "    power-off-fail) printf '%s\\n' 'management rejected power off' >&2; exit 44 ;;\n"
            "    transition-off) printf '%s\\n' unpowered > \"$TORQUE_BLUETOOTH_TEST_STATE\" ;;\n"
            "  esac\n"
            "  exit 0\n"
            "fi\n"
            "exit 64\n",
            encoding="utf-8",
        )
        btmgmt.chmod(0o755)

    def _run(
        self,
        argument: str,
        mode: str,
        *,
        extra_arguments: tuple[str, ...] = (),
        extra_environment: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        environment = {
            **os.environ,
            "TORQUE_BLUETOOTH_SYS_ROOT": str(self.sys_root),
            "TORQUE_BLUETOOTH_BTMGMT_BIN": str(self.bin_dir / "btmgmt"),
            "TORQUE_BLUETOOTH_TIMEOUT_BIN": str(self.bin_dir / "timeout"),
            "TORQUE_BLUETOOTH_COMMAND_TIMEOUT_SECONDS": "0",
            "TORQUE_BLUETOOTH_RETRY_SLEEP_SECONDS": "0",
            "TORQUE_BLUETOOTH_TEST_MODE": mode,
            "TORQUE_BLUETOOTH_TEST_STATE": str(self.state_path),
            "TORQUE_BLUETOOTH_TEST_CALLS": str(self.calls_path),
            **(extra_environment or {}),
        }
        return subprocess.run(
            ["bash", "-s", "--", argument, *extra_arguments],
            input=self.rendered,
            text=True,
            capture_output=True,
            check=False,
            env=environment,
        )

    def test_probe_requires_three_management_reads_without_powering(self) -> None:
        completed = self._run("--probe", "powered")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(self.calls_path.read_text(encoding="utf-8").splitlines(), ["info"] * 3)

    def test_probe_accepts_unpowered_or_soft_blocked_safe_state(self) -> None:
        self.state_path.write_text("unpowered\n", encoding="utf-8")
        unpowered = self._run("--probe", "unpowered")
        self.assertEqual(unpowered.returncode, 0, unpowered.stderr)
        self.assertEqual(
            self.calls_path.read_text(encoding="utf-8").splitlines(), ["info"] * 3
        )

        self.calls_path.write_text("", encoding="utf-8")
        soft = self.sys_root / "devices" / "rfkill" / "rfkill-hci1" / "soft"
        soft.write_text("1\n", encoding="utf-8")
        blocked = self._run("--probe", "info-timeout")
        self.assertEqual(blocked.returncode, 0, blocked.stderr)
        self.assertEqual(self.calls_path.read_text(encoding="utf-8"), "")

    def test_btmgmt_keeps_a_non_readable_stdin_when_service_stdin_is_closed(self) -> None:
        stdin_temp = self.root / "stdin-temp"
        stdin_temp.mkdir()
        completed = self._run(
            "--probe",
            "stdin-eof",
            extra_environment={"TMPDIR": str(stdin_temp)},
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(self.calls_path.read_text(encoding="utf-8").splitlines(), ["info"] * 3)
        self.assertEqual(list(stdin_temp.iterdir()), [])

    def test_main_powers_only_the_exact_unpowered_controller(self) -> None:
        self.state_path.write_text("unpowered\n", encoding="utf-8")

        completed = self._run("hci1", "transition")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(self.state_path.read_text(encoding="utf-8").strip(), "powered")
        self.assertEqual(
            self.calls_path.read_text(encoding="utf-8").splitlines()[:3],
            ["info", "on", "info"],
        )

    def test_main_reports_unpowered_after_successful_management_responses(self) -> None:
        self.state_path.write_text("unpowered\n", encoding="utf-8")

        completed = self._run("hci1", "unpowered")

        self.assertEqual(completed.returncode, 7, completed.stderr)
        self.assertIn("did not become powered", completed.stderr)
        self.assertEqual(
            self.calls_path.read_text(encoding="utf-8").splitlines(),
            ["info", "on"] * 6,
        )

    def test_new_power_commands_discover_exact_controller_and_are_idempotent(self) -> None:
        powered_status = self._run("--status", "powered")
        self.assertEqual(powered_status.returncode, 0, powered_status.stderr)
        self.assertEqual(json.loads(powered_status.stdout), {"controller": "hci1", "powered": True})

        self.calls_path.write_text("", encoding="utf-8")
        powered_off = self._run("--power-off", "transition-off")
        self.assertEqual(powered_off.returncode, 0, powered_off.stderr)
        soft = self.sys_root / "devices" / "rfkill" / "rfkill-hci1" / "soft"
        self.assertEqual(soft.read_text(encoding="utf-8").strip(), "1")
        self.assertEqual(self.calls_path.read_text(encoding="utf-8").splitlines(), [])
        blocked_status = self._run("--status", "powered")
        self.assertEqual(json.loads(blocked_status.stdout), {"controller": "hci1", "powered": False})

        self.calls_path.write_text("", encoding="utf-8")
        powered_off_again = self._run("--power-off", "unpowered")
        self.assertEqual(powered_off_again.returncode, 0, powered_off_again.stderr)
        self.assertEqual(self.calls_path.read_text(encoding="utf-8").splitlines(), [])

    def test_power_off_leaves_unrelated_internal_bluetooth_unblocked(self) -> None:
        internal = self.sys_root / "devices" / "platform" / "internal-bluetooth" / "bluetooth" / "hci0"
        internal.mkdir(parents=True)
        (internal / "device").symlink_to(internal.parent.parent)
        (self.sys_root / "class" / "bluetooth" / "hci0").symlink_to(internal)
        internal_rfkill = self.sys_root / "devices" / "rfkill" / "rfkill-hci0"
        internal_rfkill.mkdir(parents=True)
        (internal_rfkill / "type").write_text("bluetooth\n", encoding="utf-8")
        (internal_rfkill / "hard").write_text("0\n", encoding="utf-8")
        (internal_rfkill / "soft").write_text("0\n", encoding="utf-8")
        (internal_rfkill / "device").symlink_to(internal)
        (self.sys_root / "class" / "rfkill" / "rfkill-hci0").symlink_to(internal_rfkill)

        completed = self._run("--power-off", "powered")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        exact_soft = self.sys_root / "devices" / "rfkill" / "rfkill-hci1" / "soft"
        self.assertEqual(exact_soft.read_text(encoding="utf-8").strip(), "1")
        self.assertEqual((internal_rfkill / "soft").read_text(encoding="utf-8").strip(), "0")

    def test_power_off_instance_must_match_the_exact_usb_controller(self) -> None:
        exact = self._run(
            "--power-off", "powered", extra_arguments=("hci1",)
        )
        self.assertEqual(exact.returncode, 0, exact.stderr)

        mismatch = self._run(
            "--power-off", "powered", extra_arguments=("hci0",)
        )
        self.assertEqual(mismatch.returncode, 3, mismatch.stderr)
        self.assertIn("does not match configured USB identity", mismatch.stderr)

    def test_management_failures_have_distinct_exit_statuses_and_diagnostics(self) -> None:
        cases = (
            ("info-timeout", 10, "operation=info result=timeout status=124"),
            ("power-timeout", 11, "operation=power-on result=timeout status=124"),
            ("info-fail", 12, "operation=info result=exit status=42"),
            ("power-fail", 13, "operation=power-on result=exit status=43"),
        )
        self.state_path.write_text("unpowered\n", encoding="utf-8")

        for mode, status, diagnostic in cases:
            with self.subTest(mode=mode):
                self.calls_path.write_text("", encoding="utf-8")
                completed = self._run("hci1", mode)
                self.assertEqual(completed.returncode, status, completed.stderr)
                self.assertIn(diagnostic, completed.stderr)

    def test_management_diagnostic_is_bounded_and_printable(self) -> None:
        self.state_path.write_text("unpowered\n", encoding="utf-8")

        completed = self._run("hci1", "info-fail-long")

        self.assertEqual(completed.returncode, 12, completed.stderr)
        diagnostics = [
            line
            for line in completed.stderr.splitlines()
            if line.startswith("torque-bluetooth operation=info")
        ]
        self.assertEqual(len(diagnostics), 6)
        self.assertTrue(all(len(line) <= 320 for line in diagnostics))
        self.assertTrue(all("\x1b" not in line for line in diagnostics))

    def test_hard_block_identity_mismatch_and_ambiguous_identity_fail_closed(self) -> None:
        hard = self.sys_root / "devices" / "rfkill" / "rfkill-hci1" / "hard"
        hard.write_text("1\n", encoding="utf-8")
        self.assertEqual(self._run("hci1", "powered").returncode, 4)

        hard.write_text("0\n", encoding="utf-8")
        vendor = self.sys_root / "devices" / "usb1" / "1-1" / "1-1.3" / "idVendor"
        vendor.write_text("ffff\n", encoding="utf-8")
        self.assertEqual(self._run("hci1", "powered").returncode, 3)

        vendor.write_text("2357\n", encoding="utf-8")
        self._create_controller("hci2")
        completed = self._run("--discover", "powered")
        self.assertEqual(completed.returncode, 8, completed.stderr)


if __name__ == "__main__":
    unittest.main()
