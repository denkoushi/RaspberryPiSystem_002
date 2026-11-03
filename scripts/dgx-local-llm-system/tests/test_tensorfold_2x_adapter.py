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
if args == ["stop", "dgx-private-comfyui"] and os.environ.get("FAIL_PRIVATE_STOP"):
    sys.exit(1)
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
                         [("docker", "ps"), ("docker", "rm"), ("docker", "rm"), ("git", "-C"), ("git", "-C"), ("docker", "stop")])
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

    def test_private_comfy_stop_precedes_remote_launch_even_if_stop_fails(self):
        for adapter in ("dsv41_tensorfold_2x", "glm53_tensorfold_2x"):
            for failure in ("", "1"):
                with self.subTest(adapter=adapter, failure=failure):
                    self.events_path.write_text("")
                    result = self.run_script(BLUE_SERVER_ADAPTER=adapter, FAIL_PRIVATE_STOP=failure)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.wait_for_launch()
                    events = self.events()
                    stop = events.index({"kind": "docker", "remote": True,
                                         "args": ["stop", "dgx-private-comfyui"]})
                    launch = next(i for i, e in enumerate(events) if e["kind"] == "launch")
                    self.assertLess(stop, launch)

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
            ("docker", ["stop", "dgx-private-comfyui"]),
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
                                 ["docker", "docker", "stop", "git", "git", "docker", "launch"])
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


class BusinessTensorfoldContractTests(unittest.TestCase):
    def setUp(self):
        import sys
        sys.path.insert(0, str(MODULE_DIR))
        import business_tensorfold
        self.module = business_tensorfold

    def test_prepared_inspection_is_fixed_and_never_prepares_builds_or_downloads(self):
        from unittest.mock import Mock
        runner = Mock(return_value=subprocess.CompletedProcess([], 0, stdout='', stderr=''))
        self.module.check_prepared(runner=runner)
        command = runner.call_args.args[0]
        self.assertEqual(command[:6], ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--'])
        self.assertEqual(command[6], self.module.TARGET)
        for expected in ('ABLIT=1', 'PREPARE=0', 'PORT=8889', 'API_KEY=1',
                         'CONTAINER_NAME=business-dsv41-1017-exl3-tf', 'prepared_state',
                         'worker_image_ident', 'worker_files_check', '--pull never',
                         'rank0of2-', 'rank1of2-', 'ENGRAM_SHARDS', 'HEAD_NFS_VOLUME'):
            self.assertIn(expected, command[-1])
        for forbidden in ('./scripts/prepare.sh', 'docker build', 'docker pull', 'huggingface-cli', 'docker stop', 'docker rm'):
            self.assertNotIn(forbidden, command[-1])
        self.assertNotIn('.cache/huggingface', command[-1])
        self.assertNotIn('private-personal', command[-1])

    def test_unprepared_check_fails_before_any_stop_or_launch(self):
        from unittest.mock import patch
        with patch.object(self.module, 'remote', side_effect=subprocess.CalledProcessError(1, ['fake'], stderr='secret')) as remote:
            with self.assertRaisesRegex(RuntimeError, '^business_deepseek_unprepared$'):
                self.module.start('generation-1')
        self.assertEqual(remote.call_count, 1)
        self.assertNotIn('setsid', remote.call_args.args[0])

    def test_business_launch_is_detached_and_isolates_logs_memguard_cache(self):
        from unittest.mock import patch
        with patch.object(self.module, 'check_prepared'), patch.object(self.module, 'remote') as remote:
            self.module.start('generation-1')
        script = remote.call_args.args[0]
        embedded = script.split("<<'EDIT'\n", 1)[1].split('\nEDIT', 1)[0]
        compile(embedded, '<business launch edit>', 'exec')
        result = subprocess.run(['bash', '-n'], input=script, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for expected in ('setsid nohup', 'launcher.pid', '--log-driver none', 'chmod 700', 'chmod 600',
                         'mtime +7', 'start.log.10', 'MEMGUARD_REMOTE_DIR=/srv/dgx/system-prod/state/deepseek-v41',
                         'generation-1'):
            self.assertIn(expected, script)
        self.assertNotIn('./start.sh restart', script)
        self.assertLess(script.index('names=$(docker ps -a'), script.index('setsid nohup'))
        self.assertEqual(self.module.ENV['HF_HOME'], '/srv/dgx/system-prod/data/deepseek-v41/hf')
        self.assertEqual(self.module.ENV['SPILL_GIB'], '0')
        self.assertEqual(self.module.ENV['SPILL_WEIGHTS_SHA'], '0')

    def test_stop_retains_markers_when_either_rank_gpu_listener_or_watchdog_remains(self):
        from unittest.mock import patch
        base = {'generation': 'g', 'prepared': True,
                'ranks': [{'rank': r, 'generation': 'g', 'running': False, 'gpuReleased': True} for r in (0, 1)],
                'launcherStopped': True, 'watchdogStopped': True, 'apiListenerClosed': True, 'failureReason': None}
        for key in ('running', 'gpuReleased', 'launcherStopped', 'watchdogStopped', 'apiListenerClosed'):
            value = json.loads(json.dumps(base))
            if key in ('running', 'gpuReleased'):
                value['ranks'][1][key] = key == 'running'
            else:
                value[key] = False
            with self.subTest(key=key), patch.object(self.module, 'remote'), patch.object(self.module, 'runtime_status', return_value=value):
                with self.assertRaisesRegex(RuntimeError, 'business_runtime_stop_unverified'):
                    self.module.stop('g')
        with patch.object(self.module, 'remote'), patch.object(self.module, 'runtime_status', return_value=base):
            self.module.stop('g')

    def test_status_refuses_stale_generation_and_ssh_failure(self):
        from unittest.mock import patch
        lines = 'true\n' + 'false\ntrue\ntrue\ntrue\ntrue\n\ng\n\n2026-11-02T12:00:00+00:00\n' * 2
        with patch.object(self.module, 'check_prepared'), patch.object(self.module, 'remote', return_value=lines):
            value = self.module.runtime_status('g')
            self.assertEqual(len(value['ranks']), 2)
            self.assertTrue(all(r['gpuReleased'] for r in value['ranks']))
            with self.assertRaisesRegex(RuntimeError, 'generation_mismatch'):
                self.module.runtime_status('old')
        with patch.object(self.module, 'check_prepared'), patch.object(self.module, 'remote', side_effect=subprocess.CalledProcessError(255, ['fake'])):
            with self.assertRaises(subprocess.CalledProcessError):
                self.module.runtime_status('g')

    def test_status_and_stop_only_read_prepared_marker_without_full_inspection(self):
        from unittest.mock import patch
        nodes = 'false\ntrue\ntrue\ntrue\ntrue\n\ng\n\n2026-11-02T12:00:00+00:00\n' * 2
        for prepared in (True, False):
            lines = str(prepared).lower() + '\n' + nodes
            with self.subTest(prepared=prepared), patch.object(self.module, 'check_prepared') as check, \
                    patch.object(self.module, 'remote', return_value=lines) as remote:
                value = self.module.runtime_status('g')
                self.assertIs(value['prepared'], prepared)
                self.assertEqual(value['failureReason'], None if prepared else 'business_deepseek_unprepared')
                self.assertIn('PREPARED_MARKER', remote.call_args.args[0])
                self.assertNotIn('docker run', remote.call_args.args[0])
                self.assertNotIn('worker_files_check', remote.call_args.args[0])
                remote.side_effect = ['', lines]
                self.module.stop('g')
                check.assert_not_called()

    def test_kit_patch_requires_unique_anchors_and_launches_with_bash_c(self):
        from unittest.mock import patch
        source = ('set -eu\ncd "$(dirname "$(readlink -f "$0")")"\n'
                  'source ./scripts/nodes.sh\nCACHE="$HOME/.cache/dsv41-tensorfold"\n'
                  'DGX_BUSINESS_GENERATION=g\nEXPECTED_REVISION=pinned\nDGX_PRIVATE_SHARED_DEEPSEEK_ENABLED=1\n'
                  'SERVE=(tensorfold-native serve /model --port 8889 --parallel 4 --thinking)\nSERVE+=("$@")\n'
                  'RUN_ARGS="--example"\nDATA_SUB=prepared\nDATA=/hf/$DATA_SUB\n'
                  'printf "%s\\n" "$PWD" "$RUN_ARGS"\n'
                  'printf "%s\\n" "${SERVE[*]}"\n'
                  '# docker run head\n# docker run worker\n# docker run probe\n')
        anchors = ('source ./scripts/nodes.sh',
                   '$HOME/.cache/dsv41-tensorfold', 'RUN_ARGS="', 'docker run head',
                   'SERVE+=("$@")', 'DATA=/hf/$DATA_SUB')
        # Exercise the launch transformation independently of the marker helper below.
        setup = 'shared_config() { :; }; business_prepared() { :; }; prepared_state() { :; }'
        with tempfile.TemporaryDirectory() as directory, patch.object(self.module, 'SHARED_SETUP', setup):
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'scripts/nodes.sh').write_text('')
            output = root / 'launch.sh'
            for anchor in anchors:
                for changed in (source.replace(anchor, ''), source + '\n# ' + anchor):
                    with self.subTest(anchor=anchor, changed=changed):
                        (root / 'start.sh').write_text(changed)
                        result = subprocess.run(['bash', '-eu', '-c', self.module.launch_patch(shlex.quote(str(output)))],
                            cwd=root, capture_output=True, text=True)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('business_kit_layout_mismatch', result.stderr)
                        self.assertFalse(output.exists())
                        error = subprocess.CalledProcessError(result.returncode, ['fake'], stderr=result.stderr)
                        with patch.object(self.module, 'remote', side_effect=error):
                            with self.assertRaisesRegex(RuntimeError, '^business_kit_layout_mismatch$'):
                                self.module.check_prepared()
            (root / 'start.sh').write_text(source)
            result = subprocess.run(['bash', '-eu', '-c', self.module.launch_patch(shlex.quote(str(output)))],
                cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('BASH_SOURCE', output.read_text())
            self.assertEqual(output.read_text().count('docker run --pull never '), 3)
            launched = subprocess.run(['bash', '-eu', '-c', output.read_text(), str(root / 'start.sh')],
                cwd='/', capture_output=True, text=True)
            self.assertEqual(launched.returncode, 0, launched.stderr)
            self.assertEqual(Path(launched.stdout.splitlines()[0]).resolve(), root.resolve())
            self.assertIn('--log-driver none', launched.stdout.splitlines()[1])
            self.assertIn('business.generation=g', launched.stdout.splitlines()[1])
            self.assertIn('--read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m', launched.stdout.splitlines()[1])
            argv = shlex.split(launched.stdout.splitlines()[2])
            self.assertEqual(argv[-2:], ['--prompt-cache-gib', '0'])
            self.assertFalse(any(arg.startswith('--learn') for arg in argv))
            unshared = subprocess.run(['bash', '-eu', '-c', output.read_text().replace('DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED=1\n', 'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED=0\n'),
                str(root / 'start.sh')], cwd='/', capture_output=True, text=True)
            self.assertEqual(unshared.returncode, 0, unshared.stderr)
            self.assertNotIn('--read-only', unshared.stdout.splitlines()[1])
            self.assertNotIn('--prompt-cache-gib', shlex.split(unshared.stdout.splitlines()[2]))
            for option in ('--learn', '--learn-dir', '--learn-gib', '--learn=true'):
                with self.subTest(option=option):
                    refused = subprocess.run(['bash', '-eu', '-c', output.read_text(), str(root / 'start.sh'), option],
                        cwd=root, capture_output=True, text=True)
                    self.assertNotEqual(refused.returncode, 0)
                    self.assertIn('business_learning_forbidden', refused.stderr)

    def sharing_status(self, change=None, *, prepared=True, sharing=True, image=None):
        from unittest.mock import Mock
        image_id = 'sha256:' + 'a' * 64
        started = '2026-11-03T00:01:00+00:00'
        weights = '878f5689-ablit-0bdc2036'
        model = '/hf/tensorfold-dsv41/' + weights
        observations = [{
            'id': 'container-' + str(rank), 'image': image_id, 'running': True, 'startedAt': started,
            'labels': {'business.generation': 'g', 'business.recipe-revision': self.module.REVISION},
            'path': 'tensorfold-native' if rank == 0 else 'tf-dsv41-lanes',
            'args': ['serve', model + '/model', '--port', '8889', '--parallel', '4', '--thinking',
                     '--prompt-cache-gib', '0'] if rank == 0 else
                    [model + '/checkpoint', '/rank-cache', '1', '2', 'head', '29620', '/kit'],
            'logDriver': 'none', 'readOnly': True,
            'tmpfs': {'/tmp': 'rw,noexec,nosuid,size=64m'},
            'mounts': [{'Type': 'volume', 'Source': '/volumes/business-hf', 'Destination': '/hf', 'RW': False},
                       {'Type': 'bind', 'Source': '/cache/rank-cache-' + weights, 'Destination': '/rank-cache', 'RW': False}],
        } for rank in (0, 1)]
        if change:
            change(observations)
        nodes = [["true", "false", "false", "false", "false", 'container-' + str(rank), 'g', started,
                  '2026-11-03T00:00:00+00:00'] for rank in (0, 1)]
        lines = [str(prepared).lower(), *nodes[0], *nodes[1]]
        if sharing:
            lines += [*(json.dumps(v) for v in observations), image if image is not None else image_id]
        runner = Mock(return_value=subprocess.CompletedProcess([], 0, stdout='\n'.join(lines) + '\n', stderr=''))
        status = self.module.runtime_status('g', runner=runner, sharing=sharing)
        return status, runner.call_args.args[0][-1]

    def test_sharing_evidence_uses_both_live_containers_and_prepared_image(self):
        status, command = self.sharing_status()
        evidence = status['privateSharingEvidence']
        self.assertEqual(evidence, {'generation': 'g', 'weightsRevision': '878f5689-ablit-0bdc2036',
            'runtimeIdentity': 'tensorfold-native:serve:8889:parallel4:thinking', 'promptCacheGiB': 0,
            'learn': False, 'logDriver': 'none', 'requestResponseLogging': False, 'persistsConversations': False})
        self.assertNotIn('privateSharing', status)  # Only the gateway can prove its fence.
        self.assertIn('business_prepared check', command)
        self.assertNotIn('.Config.Env', command)
        # SHARED_SETUP defines worker_nfs, but status must never invoke it.
        self.assertNotIn('worker_nfs 1', command)
        self.assertNotIn('worker_files_check', command)
        for kwargs in ({'sharing': False}, {'prepared': False}, {'image': 'unknown'}):
            with self.subTest(kwargs=kwargs):
                self.assertNotIn('privateSharingEvidence', self.sharing_status(**kwargs)[0])

    def test_sharing_evidence_accepts_the_pinned_image_entrypoint_only(self):
        def entrypoint(path):
            def change(observations):
                for observed in observations:
                    observed['args'].insert(0, observed['path'])
                    observed['path'] = path
            return change
        evidence = self.sharing_status(entrypoint('/opt/nvidia/nvidia_entrypoint.sh'))[0]['privateSharingEvidence']
        self.assertEqual(evidence['runtimeIdentity'], 'tensorfold-native:serve:8889:parallel4:thinking')
        for path in ('/bin/sh', '/opt/other/entrypoint.sh'):
            with self.subTest(path=path):
                self.assertNotIn('privateSharingEvidence', self.sharing_status(entrypoint(path))[0])

    def test_sharing_evidence_is_omitted_for_unknown_unsafe_or_stale_facts_on_either_rank(self):
        mutations = [
            lambda o: o.pop('logDriver'), lambda o: o.update(logDriver=''),
            lambda o: o.update(logDriver='json-file'), lambda o: o.update(readOnly=False),
            lambda o: o.update(id='replaced'), lambda o: o.update(image='sha256:' + 'b' * 64),
            lambda o: o.update(startedAt='restarted'), lambda o: o.update(running=False),
            lambda o: o['labels'].update({'business.generation': 'stale'}),
            lambda o: o['labels'].update({'business.recipe-revision': 'unknown'}),
            lambda o: o['mounts'][0].update(RW=True), lambda o: o.update(tmpfs={}),
            lambda o: o['args'].extend(['--learn']), lambda o: o['args'].extend(['--learn-dir', '/tmp/learn']),
            lambda o: o['args'].extend(['--learn-gib', '1']),
            lambda o: o.update(path='sh'), lambda o: o['args'].__setitem__(1, '/other/weights'),
        ]
        for rank in (0, 1):
            for index, mutate in enumerate(mutations):
                with self.subTest(rank=rank, mutation=index):
                    status, _ = self.sharing_status(lambda obs: mutate(obs[rank]))
                    self.assertNotIn('privateSharingEvidence', status)
        for args in (['--prompt-cache-gib', '1'], ['--parallel', '8'], ['--port', '8888'],
                     ['--no-thinking'], ['--prompt-cache-gib=0'], ['--thinking=false']):
            with self.subTest(args=args):
                status, _ = self.sharing_status(lambda obs: obs[0]['args'].extend(args))
                self.assertNotIn('privateSharingEvidence', status)
        status, _ = self.sharing_status(lambda obs: obs[0]['args'].__setitem__(-1, '2'))
        self.assertNotIn('privateSharingEvidence', status)
        status, _ = self.sharing_status(lambda obs: obs[0]['args'].__delitem__(slice(-2, None)))
        self.assertNotIn('privateSharingEvidence', status)

    def test_business_shell_unprepared_refuses_before_stopping_existing_runtime(self):
        # Exercise the actual adapter entry and SSH command with only fake binaries.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'bin'
            binary.mkdir()
            events = root / 'events'
            for name, code in {
                'ssh': '#!/bin/sh\nprintf "ssh-check\\n" >> "$EVENTS"\nexit 255\n',
                'docker': '#!/bin/sh\nprintf "docker-mutation\\n" >> "$EVENTS"\nexit 99\n',
            }.items():
                path = binary / name
                path.write_text(code)
                path.chmod(0o755)
            marker = root / 'marker.json'
            before = json.dumps({'containerName': 'existing-rank1', 'sshTarget': 'user@worker'})
            marker.write_text(before)
            environment = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ['PATH'],
                'EVENTS': str(events), 'BLUE_MODEL_PROFILE_ID': 'business_deepseek_v41_flash_tp2',
                'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'true', 'BLUE_SERVER_ADAPTER': 'dsv41_tensorfold_2x',
                'BLUE_SERVER_MODE': 'container', 'BLUE_WORKER_SSH_TARGET': self.module.TARGET,
                'BLUE_QWEN38_RECIPE_DIR': self.module.RECIPE, 'BLUE_QWEN38_RECIPE_REVISION': self.module.REVISION,
                'BLUE_REMOTE_WORKER_MARKER_PATH': str(marker), 'BLUE_ABLITERATED': '0'}
            result = subprocess.run(['bash', str(MODULE_DIR / 'tensorfold-2x-adapter.sh')],
                env=environment, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('business_deepseek_unprepared', result.stderr)
            self.assertEqual(events.read_text(), 'ssh-check\n')
            self.assertEqual(marker.read_text(), before)

    def test_business_config_shares_only_prepared_artifacts(self):
        values = self.module.ENV
        self.assertEqual(values['API_KEY_FILE'], '/srv/dgx/system-prod/state/deepseek-v41/api-key')
        self.assertEqual(values['HEAD_ENGRAM_DIR'], '')
        self.assertEqual(values['FOREGROUND'], '0')
        self.assertEqual(values['MODEL_REVISION'], '')  # Immutable SHA comes from the private marker.
        self.assertEqual(values['ABLIT'], '1')
        self.assertEqual(values['ABLIT_ID'], 'drowzeys/keys-DeepSeek-V4.1-Flash-1017-Abliterated')
        self.assertEqual(values['ABLIT_REVISION'], '0bdc2036113c4fdda38ef6005b3cbc0bc0dfa0f0')
        self.assertEqual(values['HF_CACHE'], '/srv/ssd/hf')
        self.assertEqual(values['NFS_PATH'], '/srv/ssd/hf')
        self.assertEqual(values['WORKER'], 'ubudgxkoushi@192.168.100.10')
        self.assertEqual(values['WORKER_ENGRAM_DIR'], '/home/ubudgxkoushi/.cache/dsv41-tensorfold/engram-1bae0e10')
        self.assertEqual(values['WORKER_CACHE_DIR'], '/home/ubudgxkoushi/.cache/dsv41-tensorfold/rank-cache-878f5689-ablit-0bdc2036')
        for key in ('STATE_DIR', 'LOG_DIR', 'TMPDIR', 'XDG_CACHE_HOME', 'HOME', 'HF_HOME',
                    'SPILL_DIR', 'WORKER_SPILL_DIR', 'API_KEY_FILE'):
            self.assertTrue(values[key].startswith('/srv/dgx/system-prod/'), key)

    def test_private_marker_is_read_only_and_requires_matching_preparation(self):
        revision = '878f5689' + 'a' * 32
        values = self.module.ENV
        private = {'model': values['MODEL_ID'] + '@' + revision, 'ablit': '1',
                   'overlay': values['ABLIT_ID'] + '@' + values['ABLIT_REVISION'] + '+stock-dtypes',
                   'image': 'image-identity', 'kit': values['KIT_REF'], 'template': 'template-hash',
                   'hf': values['HF_CACHE'], 'nfs_path': values['NFS_PATH'],
                   'nfs_volume': 'dsv41-1017-exl3-hf', 'w': values['WORKER'],
                   'nfs1': '', 'nfs2': '', 'nfs3': '',
                   'wengram': values['WORKER_ENGRAM_DIR'].replace('/home/ubudgxkoushi/', '$HOME/'),
                   'wcache': values['WORKER_CACHE_DIR'].replace('/home/ubudgxkoushi/', '$HOME/')}
        business = {**private, 'nfs_volume': values['NFS_VOLUME'], 'nfs1': values['NFS_SERVER'],
                    'wengram': values['WORKER_ENGRAM_DIR'], 'wcache': values['WORKER_CACHE_DIR']}

        def serialize(fields):
            return shlex.join([f'{key}={value}' for key, value in fields.items()])

        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'prepared'
            marker.write_text(serialize(private))
            marker.chmod(0o400)
            before = marker.stat()
            environment = {**os.environ, **values, 'PYTHONOPTIMIZE': '1', 'SHARED_PREPARED_MARKER': str(marker),
                           'TEST_STATE': serialize(business)}
            script = self.module.SHARED_SETUP + '\nshared_config\nbusiness_prepared check "$TEST_STATE"\nprintf "%s\\n" "$MODEL_REVISION" "$DATA_DIR"\n'
            result = subprocess.run(['bash', '-eu', '-c', script], env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.splitlines(), [revision, '/srv/ssd/hf/tensorfold-dsv41/878f5689-ablit-0bdc2036'])
            self.assertEqual(marker.read_text(), serialize(private))
            self.assertEqual(marker.stat().st_mtime_ns, before.st_mtime_ns)
            self.assertEqual(list(Path(directory).iterdir()), [marker])
            for key, value in (('ablit', '0'), ('overlay', 'wrong'), ('image', 'other-image'),
                               ('model', values['MODEL_ID'] + '@' + 'b' * 40),
                               ('kit', 'other-kit'), ('template', 'other-template'),
                               ('nfs_volume', 'unrelated'), ('wcache', '/other/cache'),
                               ('w', 'other@192.168.100.12'), ('nfs1', '192.168.100.12'), ('nfs2', '192.168.100.12')):
                with self.subTest(key=key):
                    result = subprocess.run(['bash', '-eu', '-c', script],
                        env={**environment, 'TEST_STATE': serialize({**business, key: value})},
                        capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
            for key, value in (('ABLIT', '0'), ('PREPARE', 'auto'), ('SPILL_GIB', '1'), ('SPILL_WEIGHTS_SHA', '1')):
                with self.subTest(key=key):
                    result = subprocess.run(['bash', '-eu', '-c', script], env={**environment, key: value},
                        capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
            marker.chmod(0o600)
            marker.write_text(serialize({**private, 'model': values['MODEL_ID'] + '@' + 'b' * 40}))
            result = subprocess.run(['bash', '-eu', '-c', script], env=environment, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            marker.unlink()
            result = subprocess.run(['bash', '-eu', '-c', script], env=environment, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)

    def test_both_nfs_volumes_must_name_the_exact_read_only_export(self):
        check = self.module.CHECK
        volume_check = check[check.index('for rank in 0 1; do'):check.index('# Recompute index identities')]
        script = ('docker() { printf "%s\\n" "$HEAD_VOLUME"; }; '
                  'worker() { printf "%s\\n" "$WORKER_VOLUME"; };\n' + volume_check)
        good = ':/srv/ssd/hf addr=192.168.100.11,nfsvers=4.2,ro,hard'
        environment = {**os.environ, **self.module.ENV, 'HEAD_VOLUME': good, 'WORKER_VOLUME': good}
        result = subprocess.run(['bash', '-eu', '-c', script], env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for key in ('HEAD_VOLUME', 'WORKER_VOLUME'):
            for bad in (good.replace(',ro,', ',rw,'), good.replace(',ro,', ','), good + ',rw',
                        good.replace('/srv/ssd/hf', '/wrong'), good.replace('192.168.100.11', '192.168.100.10')):
                with self.subTest(key=key, bad=bad):
                    result = subprocess.run(['bash', '-eu', '-c', script], env={**environment, key: bad},
                        capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)

    def test_shared_and_business_directories_must_exist_without_symlinks(self):
        check = self.module.CHECK
        directory_check = check[check.index('for dir in "$HF_CACHE"'):check.index('[[ -s "$API_KEY_FILE"')]
        script = ('worker() { shift; eval "$*"; }; engram_cache_dir() { echo "$HF_CACHE/engram"; }; '
                  'engram_rev() { echo revision; };\n' + directory_check)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            keys = ('HF_CACHE', 'DATA_DIR', 'STATE_DIR', 'LOG_DIR', 'HOME', 'HF_HOME', 'TMPDIR',
                    'XDG_CACHE_HOME', 'SPILL_DIR', 'WORKER_CACHE_DIR', 'WORKER_ENGRAM_DIR', 'WORKER_SPILL_DIR')
            environment = {**os.environ, **{key: str(root / key) for key in keys}, 'KIT_SUB': 'kit-sub'}
            for path in [*(root / key for key in keys), root / 'DATA_DIR/checkpoint', root / 'DATA_DIR/model',
                         root / 'DATA_DIR/rank-cache', root / 'HF_CACHE/kit-sub/kit', root / 'HF_CACHE/engram/snapshots/revision']:
                path.mkdir(parents=True, exist_ok=True)
            result = subprocess.run(['bash', '-eu', '-c', script], env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            alias = root / 'alias'
            alias.symlink_to(root / 'WORKER_CACHE_DIR', target_is_directory=True)
            for key in keys:
                for bad in (str(alias), str(root / 'missing')):
                    with self.subTest(key=key, bad=bad):
                        result = subprocess.run(['bash', '-eu', '-c', script], env={**environment, key: bad},
                            capture_output=True, text=True)
                        self.assertNotEqual(result.returncode, 0)

    def test_private_tensorfold_stop_proof_inspects_actual_container_on_both_sparks(self):
        from unittest.mock import Mock, patch
        import resource_state
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'worker.json'
            for adapter, name in (('dsv41_tensorfold_2x', 'dsv41-1017-exl3-tf'),
                                  ('glm53_tensorfold_2x', 'configured-glm-container')):
                path.write_text(json.dumps({'adapter': adapter, 'cloneDir': '/kit/clone', 'sshTarget': 'user@worker'}))
                runner = Mock(return_value=subprocess.CompletedProcess([], 0, stdout=name, stderr=''))
                with patch.object(resource_state.subprocess, 'run', runner), patch.object(resource_state, 'verify_rank_stopped') as verify:
                    resource_state.verify_blue_stopped(str(path), 'system-prod-trtllm')
                    self.assertIn(((name,), {}), verify.call_args_list)
                    self.assertIn(((name, 'user@worker'), {}), verify.call_args_list)

    def test_business_stop_checks_owned_containers_and_ports_with_private_gpu_active(self):
        from unittest.mock import patch
        import resource_state
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'bin'
            binary.mkdir()
            # Fake a private GPU workload and private listener throughout. Any
            # global GPU query is an error; only the named business container counts.
            programs = {
                'nvidia-smi': '#!/bin/sh\necho private-gpu-workload\nexit 99\n',
                'ss': '#!/bin/sh\ncase "$*" in *8888*) echo private-listener;; '
                      '*"$BUSINESS_BUSY_PORT"*) test -z "$BUSINESS_BUSY_PORT" || echo business-listener;; esac\nexit 0\n',
                'docker': '''#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
if args[0] == 'ps':
    name = os.environ.get('BUSINESS_RUNNING_NAME', '')
    if name and 'name=^/' + name + '$' in args:
        print(name if '{{.Names}}' in args else 'business-id')
elif args[0] == 'inspect':
    field = args[2]
    print('true' if field == '{{.State.Running}}' else
          '2026-11-02T12:01:00+00:00' if field == '{{.State.StartedAt}}' else 'business-id')
elif args[0] != 'info':
    sys.exit(99)
''',
            }
            for name, code in programs.items():
                path = binary / name
                path.write_text(code)
                path.chmod(0o755)
            (root / 'generation').write_text('g\n')
            (root / 'generation-started-at').write_text('2026-11-02T12:00:00+00:00\n')
            environment = {'PATH': str(binary) + os.pathsep + os.environ['PATH'],
                'BUSINESS_RUNNING_NAME': '', 'BUSINESS_BUSY_PORT': ''}
            with patch.dict(os.environ, environment):
                resource_state.verify_rank_stopped('system-prod-trtllm')
                for running in (False, True):
                    name = self.module.ENV['CONTAINER_NAME']
                    with patch.dict(os.environ, {'BUSINESS_RUNNING_NAME': name if running else ''}):
                        value = subprocess.run(['bash', '-c', self.module.NODE_STATUS, 'bash', name,
                            str(root), str(root), '8889'], check=True, capture_output=True, text=True)
                    self.assertEqual(value.stdout.splitlines()[:2],
                        ['true', 'false'] if running else ['false', 'true'])
                for changes in ({'BUSINESS_RUNNING_NAME': 'system-prod-trtllm'},
                                {'BUSINESS_BUSY_PORT': '8889'}, {'BUSINESS_BUSY_PORT': '38083'}):
                    with self.subTest(changes=changes), patch.dict(os.environ, changes):
                        with self.assertRaises(subprocess.CalledProcessError):
                            resource_state.verify_rank_stopped('system-prod-trtllm')
                for port in ('8889', ''):
                    with patch.dict(os.environ, {'BUSINESS_BUSY_PORT': port}):
                        value = subprocess.run(['bash', '-c', self.module.NODE_STATUS, 'bash', name,
                            str(root), str(root), '8889'], check=True, capture_output=True, text=True)
                    self.assertEqual(value.stdout.splitlines()[4], 'false' if port else 'true')
