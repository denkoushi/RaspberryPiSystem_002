import json
import os
import shlex
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
REVISION = "370daf0cc38f348516a98ebab38f6053858eab1f"

FAKE_SSH = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import sys

args = sys.argv[1:]
assert args[:5] == ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--"]
assert args[5] == "user@spark2.example"
marker = Path(os.environ["BLUE_REMOTE_WORKER_MARKER_PATH"])
event = {"kind": "ssh", "command": args[6],
         "marker": json.loads(marker.read_text()) if marker.exists() else None}
with open(os.environ["EVENTS"], "a") as log:
    log.write(json.dumps(event) + "\n")
if os.environ.get("FAIL_SSH") or (os.environ.get("FAIL_LAUNCH") and "setsid nohup" in args[6]):
    sys.exit(255)
# Execute through a shell just as SSH does, to exercise remote argument quoting.
sys.exit(subprocess.run(args[6], shell=True, env={**os.environ, "FAKE_REMOTE": "1"}).returncode)
'''

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json
import os
import sys
args = sys.argv[1:]
with open(os.environ["EVENTS"], "a") as log:
    log.write(json.dumps({"kind": "docker", "remote": os.environ.get("FAKE_REMOTE") == "1", "args": args}) + "\n")
if args[0] == "ps":
    print("system-prod-trtllm")
if args[0] == "rm" and os.environ.get("FAIL_DOCKER"):
    sys.exit(1)
'''

FAKE_GIT = r'''#!/usr/bin/env python3
import json
import os
import sys
args = sys.argv[1:]
assert args[:2] == ["-C", os.environ["BLUE_QWEN38_RECIPE_DIR"]]
assert args[2:] in (["rev-parse", "HEAD"], ["status", "--porcelain"])
with open(os.environ["EVENTS"], "a") as log:
    log.write(json.dumps({"kind": "git", "args": args}) + "\n")
if os.environ.get("FAIL_GIT") == args[2]:
    sys.exit(1)
if args[2] == "rev-parse":
    print(os.environ.get("ACTUAL_REVISION", os.environ["BLUE_QWEN38_RECIPE_REVISION"]))
else:
    print(os.environ.get("DIRTY", ""), end="")
'''

FAKE_STOP = r'''#!/usr/bin/env python3
import json
import os
import sys
with open(os.environ["EVENTS"], "a") as log:
    log.write(json.dumps({"kind": "stop", "cwd": os.getcwd(), "path": os.environ["PATH"]}) + "\n")
sys.exit(int(os.environ.get("FAIL_STOP", "0")))
'''

FAKE_SETSID = r'''#!/usr/bin/env python3
import json
import os
import sys
import time
assert sys.argv[1:] == ["nohup", "./start.sh", "restart"]
assert sys.stdin.read() == ""
with open(os.environ["EVENTS"], "a") as log:
    log.write(json.dumps({"kind": "launch", "cwd": os.getcwd(), "ablit": os.environ["ABLIT"],
                         "path": os.environ["PATH"]}) + "\n")
time.sleep(float(os.environ.get("START_DELAY", "0")))
'''


class DeepSeekAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.clone = self.root / "clone ' $(touch injected)"
        self.clone.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.venv = self.root / "venv ' $(touch injected)"
        self.venv.mkdir()
        for path, content in (
            (self.bin / "ssh", FAKE_SSH), (self.bin / "docker", FAKE_DOCKER),
            (self.bin / "git", FAKE_GIT), (self.bin / "setsid", FAKE_SETSID),
            (self.clone / "stop.sh", FAKE_STOP),
        ):
            path.write_text(content)
            path.chmod(0o755)
        self.events_path = self.root / "events.jsonl"
        self.marker = self.root / "state/worker.json"
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(("BLUE_", "TRTLLM_", "VLLM_"))}
        self.env.update({
            "HOME": str(self.root), "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "EVENTS": str(self.events_path), "BLUE_SERVER_ADAPTER": "dsv41_tensorfold_2x",
            "BLUE_MODEL_PROFILE_ID": "private_deepseek_v41_flash_tp2",
            "BLUE_WORKER_SSH_TARGET": "user@spark2.example",
            "BLUE_QWEN38_RECIPE_DIR": str(self.clone), "BLUE_QWEN38_RECIPE_REVISION": REVISION,
            "BLUE_REMOTE_VENV_BIN": str(self.venv), "BLUE_ABLITERATED": "1",
            "BLUE_REMOTE_WORKER_MARKER_PATH": str(self.marker),
            "BLUE_SERVER_LOG_PATH": str(self.root / "server.log"),
        })

    def run_script(self, name="tensorfold-2x-adapter.sh", **env):
        return subprocess.run(["bash", str(MODULE_DIR / name)], env={**self.env, **env},
                              cwd=self.root, capture_output=True, text=True, timeout=5)

    def events(self):
        if not self.events_path.exists():
            return []
        return [json.loads(line) for line in self.events_path.read_text().splitlines()]

    def expected_marker(self, with_venv=True):
        marker = {"adapter": "dsv41_tensorfold_2x", "sshTarget": "user@spark2.example",
                  "cloneDir": str(self.clone)}
        if with_venv:
            marker["venvBin"] = str(self.venv)
        return marker

    def write_marker(self, marker):
        self.marker.parent.mkdir(exist_ok=True)
        self.marker.write_text(json.dumps(marker))

    def wait_for_launch(self):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            launches = [e for e in self.events() if e["kind"] == "launch"]
            if launches:
                return launches[-1]
            time.sleep(0.01)
        self.fail("detached launch did not execute")

    def test_dispatch_stops_glm_then_verifies_and_marks_before_detached_launch(self):
        self.write_marker({"sshTarget": "user@spark2.example", "containerName": "system-prod-trtllm-rank1"})
        started = time.monotonic()
        result = self.run_script("start-trtllm-server.sh", START_DELAY="3")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(time.monotonic() - started, 2.5)
        launch = self.wait_for_launch()
        self.assertEqual(launch["ablit"], "1")
        self.assertEqual(Path(launch["cwd"]), self.clone.resolve())
        self.assertTrue(launch["path"].startswith(str(self.venv) + os.pathsep))
        operations = [e for e in self.events() if e["kind"] in ("docker", "git")]
        self.assertEqual([(e["kind"], e["args"][0]) for e in operations],
                         [("docker", "ps"), ("docker", "rm"), ("docker", "rm"), ("git", "-C"), ("git", "-C")])
        self.assertEqual(operations[1]["args"], ["rm", "-f", "system-prod-trtllm"])
        self.assertEqual(operations[2]["args"], ["rm", "-f", "system-prod-trtllm-rank1"])
        self.assertTrue(operations[2]["remote"])
        ssh_launch = [e for e in self.events() if e["kind"] == "ssh"][-1]
        self.assertEqual(ssh_launch["marker"], self.expected_marker())
        script = shlex.split(ssh_launch["command"])[3]
        for fragment in ("setsid nohup ./start.sh restart", "ABLIT=1", "< /dev/null", "&"):
            self.assertIn(fragment, script)
        self.assertEqual(json.loads(self.marker.read_text()), self.expected_marker())
        self.assertFalse(self.marker.with_suffix(".json.tmp").exists())
        self.assertTrue((self.root / ".cache/dsv41-tensorfold/start.log").exists())
        self.assertFalse((self.clone / "injected").exists())
        self.assertFalse((self.root / "injected").exists())

    def test_other_blue_start_stops_recorded_deepseek_first(self):
        self.write_marker(self.expected_marker())
        # An unsupported adapter exits right after the guard, isolating the guard's effect.
        result = self.run_script("start-trtllm-server.sh", BLUE_SERVER_ADAPTER="not_an_adapter")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported BLUE_SERVER_ADAPTER", result.stderr)
        self.assertEqual([e["kind"] for e in self.events() if e["kind"] == "stop"], ["stop"])
        self.assertFalse(self.marker.exists())

    def test_host_mode_blue_start_still_stops_recorded_deepseek(self):
        self.write_marker(self.expected_marker())
        result = self.run_script("start-trtllm-server.sh", BLUE_SERVER_ADAPTER="not_an_adapter",
                                 BLUE_SERVER_MODE="host")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([e["kind"] for e in self.events() if e["kind"] == "stop"], ["stop"])
        self.assertFalse(self.marker.exists())

    def test_other_blue_start_fails_when_deepseek_cannot_stop(self):
        self.write_marker(self.expected_marker())
        result = self.run_script("start-trtllm-server.sh", BLUE_SERVER_ADAPTER="glm53_flash_tp2", FAIL_STOP="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.marker.exists())
        self.assertFalse(any(e["kind"] == "docker" and e["args"][0] == "run" for e in self.events()))

    def test_defaults_and_previous_deepseek_stopped_before_relaunch(self):
        self.env.pop("BLUE_ABLITERATED")
        self.env.pop("BLUE_REMOTE_VENV_BIN")
        self.write_marker(self.expected_marker(with_venv=False))
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        launch = self.wait_for_launch()
        self.assertEqual(launch["ablit"], "0")
        self.assertEqual(launch["path"], self.env["PATH"])
        kinds = [e["kind"] for e in self.events()]
        self.assertLess(kinds.index("stop"), kinds.index("git"))
        self.assertLess(kinds.index("stop"), kinds.index("launch"))
        self.assertEqual(json.loads(self.marker.read_text()), self.expected_marker(with_venv=False))

    def test_invalid_inputs_fail_before_any_command(self):
        for overrides in (
            {"BLUE_WORKER_SSH_TARGET": "-oProxyCommand=bad"}, {"BLUE_WORKER_SSH_TARGET": "host"},
            {"BLUE_WORKER_SSH_TARGET": ""}, {"BLUE_QWEN38_RECIPE_DIR": "relative"},
            {"BLUE_QWEN38_RECIPE_DIR": "/path\ninjected"}, {"BLUE_QWEN38_RECIPE_REVISION": "370daf0"},
            {"BLUE_QWEN38_RECIPE_REVISION": "z" * 40}, {"BLUE_ABLITERATED": "2"},
            {"BLUE_REMOTE_VENV_BIN": "relative"}, {"BLUE_SERVER_MODE": "host"},
        ):
            with self.subTest(overrides=overrides):
                result = self.run_script(**overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.events(), [])
                self.assertFalse(self.marker.exists())

    def test_revision_dirty_and_git_failures_never_launch(self):
        for overrides in ({"ACTUAL_REVISION": "a" * 40}, {"DIRTY": "?? untracked\n"},
                          {"FAIL_GIT": "rev-parse"}, {"FAIL_GIT": "status"}):
            with self.subTest(overrides=overrides):
                result = self.run_script(**overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.marker.exists())
                self.assertFalse(any("setsid" in e.get("command", "") for e in self.events()))

    def test_stop_failures_abort_before_verification_and_retain_marker(self):
        for overrides in ({"FAIL_DOCKER": "1"}, {"FAIL_SSH": "1"}, {"FAIL_STOP": "1"}):
            with self.subTest(overrides=overrides):
                self.write_marker(self.expected_marker())
                result = self.run_script(**overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(json.loads(self.marker.read_text()), self.expected_marker())
                self.assertFalse(any(e["kind"] in ("git", "launch") for e in self.events()))

    def test_launch_ssh_failure_retains_recovery_marker(self):
        result = self.run_script(FAIL_LAUNCH="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(self.marker.read_text()), self.expected_marker())

    def test_stop_dispatch_removes_marker_and_preserves_quoted_paths(self):
        for with_venv in (True, False):
            with self.subTest(with_venv=with_venv):
                self.write_marker(self.expected_marker(with_venv))
                result = self.run_script("stop-trtllm-server.sh")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(self.marker.exists())
                stop = [e for e in self.events() if e["kind"] == "stop"][-1]
                self.assertEqual(Path(stop["cwd"]), self.clone.resolve())
                expected_path = (str(self.venv) + os.pathsep if with_venv else "") + self.env["PATH"]
                self.assertEqual(stop["path"], expected_path)
                self.assertFalse((self.root / "injected").exists())
                self.assertFalse((self.clone / "injected").exists())

    def test_stop_failure_keeps_marker(self):
        for overrides in ({"FAIL_STOP": "1"}, {"FAIL_SSH": "1"}):
            with self.subTest(overrides=overrides):
                self.write_marker(self.expected_marker())
                result = self.run_script("stop-trtllm-server.sh", **overrides)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(json.loads(self.marker.read_text()), self.expected_marker())

    def test_unknown_adapter_and_invalid_marker_fields_fail_closed(self):
        for overrides in (
            {"adapter": "unknown"}, {"adapter": ""}, {"adapter": None},
            {"sshTarget": "user@host;touch injected"}, {"cloneDir": "relative"},
            {"cloneDir": "/path\ninjected"}, {"cloneDir": None},
            {"venvBin": "relative"}, {"venvBin": ""}, {"venvBin": ["/bin"]},
        ):
            with self.subTest(overrides=overrides):
                marker = {**self.expected_marker(), **overrides}
                self.write_marker(marker)
                result = self.run_script("stop-trtllm-server.sh")
                self.assertEqual(result.returncode, 1)
                self.assertEqual(json.loads(self.marker.read_text()), marker)
                self.assertFalse(any(e["kind"] == "ssh" for e in self.events()))

    def test_legacy_marker_still_removes_named_remote_container(self):
        self.write_marker({"sshTarget": "user@spark2.example", "containerName": "system-prod-trtllm-rank1"})
        result = self.run_script("stop-trtllm-server.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.marker.exists())
        self.assertEqual(self.events()[-1], {
            "kind": "docker", "remote": True, "args": ["rm", "-f", "system-prod-trtllm-rank1"],
        })

    def test_glm_dispatch_stops_blue_then_verifies_and_marks_before_detached_launch(self):
        self.write_marker({"sshTarget": "user@spark2.example", "containerName": "system-prod-trtllm-rank1"})
        revision = "3fd60dfc836fab0f1ed0fd4f0afaf2a1d62b2aab"
        # Measure detachment from the remote launch, excluding stop/git/Python startup time.
        (self.bin / "setsid").write_text(FAKE_SETSID.replace(
            '"path": os.environ["PATH"]',
            '"path": os.environ["PATH"], "started": time.monotonic()',
        ))
        result = self.run_script(
            "start-trtllm-server.sh", BLUE_SERVER_ADAPTER="glm53_tensorfold_2x",
            BLUE_MODEL_PROFILE_ID="private_glm53_flash_ablit_tp2",
            BLUE_QWEN38_RECIPE_REVISION=revision, START_DELAY="3",
        )
        returned_at = time.monotonic()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("launched GLM 5.3 Flash", result.stdout)
        launch = self.wait_for_launch()
        self.assertLess(returned_at, launch["started"] + 3)
        self.assertEqual(launch["ablit"], "1")
        self.assertEqual(Path(launch["cwd"]), self.clone.resolve())
        self.assertTrue(launch["path"].startswith(str(self.venv) + os.pathsep))
        operations = [e for e in self.events() if e["kind"] in ("docker", "git")]
        self.assertEqual([(e["kind"], e["args"]) for e in operations], [
            ("docker", ["ps", "-a", "--filter", "name=^/system-prod-trtllm$", "--format", "{{.Names}}"]),
            ("docker", ["rm", "-f", "system-prod-trtllm"]),
            ("docker", ["rm", "-f", "system-prod-trtllm-rank1"]),
            ("git", ["-C", str(self.clone), "rev-parse", "HEAD"]),
            ("git", ["-C", str(self.clone), "status", "--porcelain"]),
        ])
        self.assertTrue(operations[2]["remote"])
        expected = {**self.expected_marker(), "adapter": "glm53_tensorfold_2x"}
        ssh_launch = [e for e in self.events() if e["kind"] == "ssh"][-1]
        self.assertEqual(ssh_launch["marker"], expected)
        script = shlex.split(ssh_launch["command"])[3]
        for fragment in ("setsid nohup ./start.sh restart", "ABLIT=1", "< /dev/null", "&",
                         "$HOME/.cache/tensorfold-glm53/start.log"):
            self.assertIn(fragment, script)
        self.assertEqual(json.loads(self.marker.read_text()), expected)
        self.assertFalse(self.marker.with_suffix(".json.tmp").exists())
        self.assertTrue((self.root / ".cache/tensorfold-glm53/start.log").exists())
        self.assertFalse((self.root / ".cache/dsv41-tensorfold").exists())
        self.assertFalse((self.clone / "injected").exists())
        self.assertFalse((self.root / "injected").exists())

    def test_switching_tensorfold_variants_stops_recorded_clone_before_launch(self):
        previous_clone = self.root / "previous clone ' $(touch injected)"
        previous_clone.mkdir()
        stop_script = previous_clone / "stop.sh"
        stop_script.write_text(FAKE_STOP)
        stop_script.chmod(0o755)
        for previous, requested in (("dsv41_tensorfold_2x", "glm53_tensorfold_2x"),
                                    ("glm53_tensorfold_2x", "dsv41_tensorfold_2x")):
            with self.subTest(previous=previous, requested=requested):
                self.events_path.write_text("")
                marker = {**self.expected_marker(), "adapter": previous, "cloneDir": str(previous_clone)}
                self.write_marker(marker)
                result = self.run_script("start-trtllm-server.sh", BLUE_SERVER_ADAPTER=requested)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.wait_for_launch()
                operations = [e for e in self.events() if e["kind"] in ("docker", "stop", "git", "launch")]
                self.assertEqual([e["kind"] for e in operations],
                                 ["docker", "docker", "stop", "git", "git", "launch"])
                self.assertEqual(Path(operations[2]["cwd"]), previous_clone.resolve())
                self.assertEqual(Path(operations[-1]["cwd"]), self.clone.resolve())
                ssh_events = [e for e in self.events() if e["kind"] == "ssh"]
                self.assertEqual(ssh_events[0]["marker"], marker)
                self.assertIn("exec ./stop.sh", ssh_events[0]["command"])
                expected = {**self.expected_marker(), "adapter": requested}
                self.assertEqual(ssh_events[-1]["marker"], expected)
                self.assertEqual(json.loads(self.marker.read_text()), expected)
                self.assertFalse((previous_clone / "injected").exists())

    def test_unknown_tensorfold_variant_fails_before_any_command(self):
        self.write_marker(self.expected_marker())
        for adapter in ("", "unknown", "glm53_flash_tp2", "glm53_tensorfold_2x;touch injected"):
            with self.subTest(adapter=adapter):
                result = self.run_script(BLUE_SERVER_ADAPTER=adapter)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("unsupported BLUE_SERVER_ADAPTER", result.stderr)
                self.assertEqual(self.events(), [])
                self.assertEqual(json.loads(self.marker.read_text()), self.expected_marker())
                self.assertFalse((self.root / "injected").exists())

    def test_glm_revision_and_dirty_checkout_fail_before_launch(self):
        for overrides in ({"ACTUAL_REVISION": "a" * 40}, {"DIRTY": "?? untracked\n"}):
            with self.subTest(overrides=overrides):
                result = self.run_script(BLUE_SERVER_ADAPTER="glm53_tensorfold_2x", **overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("GLM 5.3 Flash adapter:", result.stderr)
                self.assertFalse(self.marker.exists())
                self.assertFalse(any("setsid" in e.get("command", "") for e in self.events()))

    def test_stop_glm_marker_dispatch_preserves_quoted_paths(self):
        for with_venv in (True, False):
            with self.subTest(with_venv=with_venv):
                self.write_marker({**self.expected_marker(with_venv), "adapter": "glm53_tensorfold_2x"})
                result = self.run_script("stop-trtllm-server.sh")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(self.marker.exists())
                stop = [e for e in self.events() if e["kind"] == "stop"][-1]
                self.assertEqual(Path(stop["cwd"]), self.clone.resolve())
                expected_path = (str(self.venv) + os.pathsep if with_venv else "") + self.env["PATH"]
                self.assertEqual(stop["path"], expected_path)
                self.assertFalse((self.root / "injected").exists())
                self.assertFalse((self.clone / "injected").exists())
