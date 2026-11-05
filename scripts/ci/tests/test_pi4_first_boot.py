"""Pi4 image contracts, included in existing repo-policy unittest discovery."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / "infrastructure/image/rpi-image-gen"
KEY = "tskey-auth-FAKE-UNIT-TEST"
FAKE = '''#!{python}
import json, os, pathlib, stat, sys
root = pathlib.Path(os.environ["PI4_FIRST_BOOT_ROOT"])
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with (root / "argv.jsonl").open("a") as log:
    log.write(json.dumps([name] + args) + "\\n")
if name == "tailscale":
    if args == ["status", "--json"]:
        print(json.dumps({{"BackendState": "Running" if (root / "running").exists() else "NeedsLogin"}}))
    elif args[0] == "up":
        auth = pathlib.Path(next(a.split("file:", 1)[1] for a in args if a.startswith("--auth-key=")))
        assert stat.S_IMODE(auth.stat().st_mode) == 0o600
        assert auth.read_text() == {key!r}
        (root / "key-mode-checked").touch()
        if os.environ.get("FAKE_FAIL") == "up":
            print(auth.read_text())
            print(auth.read_text(), file=sys.stderr)
            sys.exit(1)
        if os.environ.get("FAKE_FAIL") != "verify":
            (root / "running").touch()
if name == "systemctl" and os.environ.get("FAKE_FAIL") == "disable":
    sys.exit(1)
'''


class FirstBootTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ("boot/firmware", "etc", "bin"):
            (self.root / directory).mkdir(parents=True)
        (self.root / "etc/hosts").write_text("127.0.0.1 localhost\n127.0.1.1 old alias\n::1 localhost\n")
        self.bootstrap = self.root / "boot/firmware/pi4-bootstrap.json"
        self.bootstrap.write_text(json.dumps({"hostname": "raspi4-test-01", "tailscale_auth_key": KEY}))
        self.secret_inputs = {self.bootstrap}
        self.done = self.root / "var/lib/pi4-first-boot/done"
        for name in ("tailscale", "hostnamectl", "systemctl"):
            target = self.root / "bin" / name
            target.write_text(FAKE.format(python=sys.executable, key=KEY))
            target.chmod(0o755)
        self.env = {**os.environ, "PI4_FIRST_BOOT_ROOT": str(self.root),
                    "PATH": str(self.root / "bin") + os.pathsep + os.environ["PATH"]}

    def run_script(self, success=True):
        result = subprocess.run([sys.executable, str(SOURCE / "pi4-first-boot.py")],
                                env=self.env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0 if success else 1, result.stderr)
        self.assertNotIn(KEY, result.stdout + result.stderr)
        for file in self.root.rglob("*"):
            if file.is_file() and file not in self.secret_inputs and file.parent != self.root / "bin":
                self.assertNotIn(KEY.encode(), file.read_bytes(), str(file))
        self.assertEqual(list((self.root / "run").rglob("tmp*")), [])
        if not success:
            self.assertFalse(self.done.exists())
            self.assertTrue(self.bootstrap.exists())
        return result

    def argv(self):
        return [json.loads(line) for line in (self.root / "argv.jsonl").read_text().splitlines()]

    def test_valid_flow(self):
        self.run_script()
        self.assertEqual((self.root / "etc/hostname").read_text(), "raspi4-test-01\n")
        self.assertEqual((self.root / "etc/hosts").read_text(),
                         "127.0.0.1 localhost\n::1 localhost\n127.0.1.1\traspi4-test-01\n")
        self.assertFalse(self.bootstrap.exists())
        self.assertTrue(self.done.exists())
        self.assertTrue((self.root / "key-mode-checked").exists())
        argv = self.argv()
        self.assertIn(["hostnamectl", "set-hostname", "raspi4-test-01"], argv)
        up = next(a for a in argv if a[:2] == ["tailscale", "up"])
        self.assertIn("--advertise-tags=tag:kiosk", up)
        self.assertIn("--ssh=false", up)
        self.assertIn("--hostname=raspi4-test-01", up)
        self.assertFalse(Path(up[2].split("file:", 1)[1]).exists())
        self.assertIn(["systemctl", "disable", "pi4-first-boot.service"], argv)

    def test_invalid_inputs(self):
        valid = {"hostname": "pi4", "tailscale_auth_key": KEY}
        cases = ["{", "x" * 4097, "[]", '{"hostname":"pi4","hostname":"pi4","tailscale_auth_key":"tskey-x"}']
        cases += [json.dumps({**valid, "extra": True}), json.dumps({"hostname": "pi4"})]
        cases += [json.dumps({**valid, "hostname": h}) for h in
                  ("UPPER", "-pi4", "pi4-", "pi4.local", "a" * 64, "", 12, "pi4\n")]
        cases += [json.dumps({**valid, "tailscale_auth_key": k}) for k in ("", "bad", None, 4)]
        for data in cases:
            with self.subTest(data=data):
                self.bootstrap.write_text(data)
                self.run_script(success=False)
                self.assertFalse((self.root / "argv.jsonl").exists())

    def test_symlink_rejected(self):
        target = self.root / "original.json"
        self.bootstrap.rename(target)
        self.secret_inputs.add(target)
        self.bootstrap.symlink_to(target)
        self.run_script(success=False)
        self.assertTrue(self.bootstrap.is_symlink())

    def test_tailscale_failure(self):
        self.env["FAKE_FAIL"] = "up"
        self.run_script(success=False)

    def test_join_must_be_verified(self):
        self.env["FAKE_FAIL"] = "verify"
        self.run_script(success=False)

    def test_disable_failure(self):
        self.env["FAKE_FAIL"] = "disable"
        self.run_script(success=False)

    def test_already_running(self):
        (self.root / "running").touch()
        self.run_script()
        self.assertFalse(any(a[:2] == ["tailscale", "up"] for a in self.argv()))
        self.assertFalse(self.bootstrap.exists())
        self.assertTrue(self.done.exists())

    def test_done_is_noop(self):
        self.done.parent.mkdir(parents=True)
        self.done.write_text("commissioned\n")
        before = self.bootstrap.read_bytes()
        self.run_script()
        self.assertEqual(self.bootstrap.read_bytes(), before)
        self.assertFalse((self.root / "argv.jsonl").exists())


class ImageSourceTests(unittest.TestCase):
    def test_metadata_header(self):
        header = (SOURCE / "layer/pi4-kiosk-base.yaml").read_text().split("# METAEND")[0]
        self.assertTrue(header.startswith("# METABEGIN\n"))
        for field in ("Name", "Version", "Category", "Desc", "Requires"):
            self.assertIn("# X-Env-Layer-" + field + ": ", header)
        self.assertIn("# X-Env-VarPrefix: ", header)
        self.assertIn("# METAEND\n---\n", (SOURCE / "layer/pi4-kiosk-base.yaml").read_text())

    def test_yaml_parses(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML is not installed")
        for relative in ("config/pi4-kiosk-base.yaml", "layer/pi4-kiosk-base.yaml"):
            self.assertIsInstance(yaml.safe_load((SOURCE / relative).read_text()), dict)

    def test_unit_contract(self):
        unit = (SOURCE / "pi4-first-boot.service").read_text()
        for value in ("ConditionPathExists=!/var/lib/pi4-first-boot/done", "Type=oneshot",
                      "User=root", "After=tailscaled.service network-online.target", "TimeoutStartSec=360"):
            self.assertIn(value, unit)


if __name__ == "__main__":
    unittest.main()
