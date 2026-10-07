import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from jinja2 import Environment, StrictUndefined


ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / "infrastructure/ansible/templates/security-monitor.sh.j2"


def socket_line(port=45173, proc="systemd-timesyn", addr="0.0.0.0", proto="udp", state="UNCONN"):
    users = f' users:(("{proc}",pid=123,fd=4))' if proc else ""
    return f"{proto} {state} 0 0 {addr}:{port} *:*{users}\n"


class SecurityMonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="security-monitor-test-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        self.ss_output = self.directory / "ss-output"
        self.range = self.directory / "ip-local-port-range"
        self.watched = self.directory / "watched"
        self.watched.write_text("initial\n")
        self.script = self.directory / "security-monitor.sh"
        self.ephemeral_state = self.directory / "listen-ports.ephemeral-udp"
        self.alert_state = self.directory / "listen-ports.unexpected"
        self.write_mock("ss", 'cat "${MOCK_SS_OUTPUT}"\n')
        self.write_mock("logger", 'printf "%s\\n" "$*" >> "${MOCK_LOG}"\n')
        self.write_mock("pgrep", 'test "$2" != "missing-process"\n')
        if not shutil.which("sha256sum"):
            self.write_mock("sha256sum", 'exec shasum -a 256 "$@"\n')
        self.render()

    def write_mock(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body)
        path.chmod(0o755)

    def render(self, port_range=None):
        # Substitute only the procfs path in the rendered fixture; production
        # always reads the kernel's real range. A missing fixture tests fallback.
        if port_range is not None:
            self.range.write_text(port_range + "\n")
        rendered = Environment(undefined=StrictUndefined).from_string(
            TEMPLATE.read_text()
        ).render(
            alert_script_path="/bin/echo",
            alert_webhook_url="",
            alert_webhook_timeout_seconds=5,
            security_monitor_state_dir=str(self.directory),
            security_monitor_fail2ban_log=str(self.directory / "fail2ban.log"),
        )
        self.script.write_text(rendered.replace(
            "/proc/sys/net/ipv4/ip_local_port_range", str(self.range)
        ))

    def run_monitor(self, lines="", **environment):
        self.ss_output.write_text(lines)
        result = subprocess.run(
            ["bash", str(self.script)],
            env={
                **os.environ,
                "PATH": f"{self.bin}:{os.environ['PATH']}",
                "MOCK_SS_OUTPUT": str(self.ss_output),
                "MOCK_LOG": str(self.directory / "log"),
                "FILE_HASH_TARGETS": str(self.watched),
                "FILE_HASH_EXCLUDES": "",
                "REQUIRED_PROCESSES": "present-process",
                "ALLOWED_LISTEN_PORTS": "22 80 443 5900",
                "SECURITY_MONITOR_IGNORE_PROCESSES": "tailscaled",
                "SECURITY_MONITOR_IGNORE_ADDR_PREFIXES": "127.0.0.1 ::1 100. fd7a: fe80:",
                **environment,
            },
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_transient_ephemeral_udp_never_alerts_and_clears_candidate(self):
        self.assertNotIn("ports-unexpected", self.run_monitor(socket_line()))
        self.assertTrue(self.ephemeral_state.exists())
        self.assertNotIn("ports-unexpected", self.run_monitor())
        self.assertFalse(self.ephemeral_state.exists())
        self.assertNotIn("ports-unexpected", self.run_monitor(socket_line()))

    def test_persistent_ephemeral_udp_alerts_on_second_run_and_deduplicates(self):
        self.assertNotIn("ports-unexpected", self.run_monitor(socket_line()))
        self.assertIn("0.0.0.0:45173(systemd-timesyn,udp)", self.run_monitor(socket_line()))
        self.assertNotIn("ports-unexpected", self.run_monitor(socket_line()))
        self.assertIn("ports-unexpected unchanged; skip alert", (self.directory / "log").read_text())
        self.run_monitor()
        self.assertFalse(self.alert_state.exists())
        self.assertNotIn("ports-unexpected", self.run_monitor(socket_line()))
        self.assertIn("ports-unexpected", self.run_monitor(socket_line()))

    def test_unknown_process_udp_also_requires_two_runs(self):
        lines = socket_line(port=40224, proc="")
        self.assertNotIn("ports-unexpected", self.run_monitor(lines))
        self.assertIn("0.0.0.0:40224(unknown,udp)", self.run_monitor(lines))

    def test_changed_address_port_or_process_requires_new_confirmation(self):
        for change in ({"addr": "[::]"}, {"port": 45174}, {"proc": "other"}):
            with self.subTest(change=change):
                self.run_monitor()
                self.assertNotIn("ports-unexpected", self.run_monitor(socket_line()))
                lines = socket_line(**change)
                self.assertNotIn("ports-unexpected", self.run_monitor(lines))
                self.assertIn("ports-unexpected", self.run_monitor(lines))

    def test_duplicate_rows_in_one_run_do_not_confirm_udp(self):
        self.assertNotIn("ports-unexpected", self.run_monitor(socket_line() * 2))

    def test_tcp_listen_alerts_immediately_even_in_ephemeral_range(self):
        self.assertIn("ports-unexpected", self.run_monitor(socket_line(proto="tcp", state="LISTEN")))

    def test_udp_outside_fallback_range_alerts_immediately(self):
        for port in (32767, 61000):
            with self.subTest(port=port):
                self.assertIn("ports-unexpected", self.run_monitor(socket_line(port=port)))

    def test_fallback_range_boundaries_require_two_runs(self):
        for port in (32768, 60999):
            with self.subTest(port=port):
                lines = socket_line(port=port)
                self.assertNotIn("ports-unexpected", self.run_monitor(lines))
                self.assertIn("ports-unexpected", self.run_monitor(lines))

    def test_kernel_range_overrides_fallback_including_boundaries(self):
        self.render("40000\t45000")
        for port in (40000, 45000):
            with self.subTest(port=port):
                lines = socket_line(port=port)
                self.assertNotIn("ports-unexpected", self.run_monitor(lines))
                self.assertIn("ports-unexpected", self.run_monitor(lines))
        for port in (39999, 45001):
            with self.subTest(port=port):
                self.assertIn("ports-unexpected", self.run_monitor(socket_line(port=port)))

    def test_multiple_candidates_are_confirmed_individually(self):
        self.run_monitor(socket_line() + socket_line(port=40224, proc=""))
        output = self.run_monitor(socket_line(port=40224, proc="") + socket_line(port=45174))
        self.assertIn("0.0.0.0:40224(unknown,udp)", output)
        self.assertNotIn("45174", output)
        self.assertNotIn("45173", output)

    def test_tcp_alert_deduplication_still_updates_udp_candidates(self):
        tcp = socket_line(port=8000, proto="tcp", state="LISTEN")
        self.assertIn("ports-unexpected", self.run_monitor(tcp))
        self.assertNotIn("ports-unexpected", self.run_monitor(tcp + socket_line()))
        output = self.run_monitor(tcp + socket_line())
        self.assertIn("0.0.0.0:8000", output)
        self.assertIn("0.0.0.0:45173", output)
        self.run_monitor(tcp)
        self.assertFalse(self.ephemeral_state.exists())

    def test_allowed_ports_and_existing_ignore_rules_still_apply(self):
        lines = (
            socket_line(proc="tailscaled") + socket_line(port=22)
            + socket_line(addr="127.0.0.1") + socket_line(addr="[::1]")
            + socket_line(addr="[fe80::1]", port=546)
            + socket_line(addr="100.64.0.1") + socket_line(addr="[fd7a::1]")
        )
        for _ in range(2):
            self.assertNotIn("ports-unexpected", self.run_monitor(lines))
        self.assertFalse(self.ephemeral_state.exists())

    def test_file_integrity_and_process_detection_regressions(self):
        self.assertNotIn("file-integrity", self.run_monitor())
        self.watched.write_text("modified\n")
        self.assertIn("file-integrity", self.run_monitor())
        self.assertNotIn("file-integrity", self.run_monitor())
        self.assertIn("process-missing", self.run_monitor(REQUIRED_PROCESSES="missing-process"))

    def test_rendered_bash_syntax(self):
        # shellcheck is not run here: the existing script has style findings
        # that are outside this change, and its presence differs per runner.
        result = subprocess.run(["bash", "-n", str(self.script)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
