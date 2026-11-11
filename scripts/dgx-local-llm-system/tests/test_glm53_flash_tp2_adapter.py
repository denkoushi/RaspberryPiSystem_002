import json
import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from model_profiles import validate_startable_profile  # noqa: E402
from profile_launcher import launcher_env_for_profile  # noqa: E402

PROFILE = "business_glm53_flash_fp4_tp2"
QWEN = "business_qwen38_flash_next_nvfp4"

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
node = os.environ.get("FAKE_NODE", "head")
with open(os.environ["EVENTS"], "a") as log:
    log.write(json.dumps({"node": node, "args": args}) + "\n")
if args == ["stop", "dgx-private-comfyui"] and os.environ.get("FAIL_PRIVATE_STOP"):
    sys.exit(1)
if args[0] == "ps":
    print(os.environ.get("RUNNING_NAME", ""))
elif args[0] == "inspect":
    if "{{.State.Running}}" in args:
        if args[-1] == "recorded-worker":
            state = os.environ.get("EXISTING_WORKER_RUNNING", "true")
            if state == "missing":
                sys.exit(1)
            print(state)
            sys.exit(0)
        print(os.environ.get("WORKER_RUNNING", "true"))
    else:
        print(os.environ.get("RUNNING_PROFILE", ""))
elif args[0] == "run":
    if "--rm" in args:
        if os.environ.get("FAIL_CACHE"):
            print("cache permission denied", file=sys.stderr)
            sys.exit(1)
    elif node == os.environ.get("FAIL_RUN"):
        sys.exit(1)
    else:
        print("fake-container-id")
'''

FAKE_SSH = r'''#!/usr/bin/env python3
import json
import os
import shlex
import subprocess
import sys

args = sys.argv[1:]
assert args[:5] == ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--"]
assert args[5] == os.environ.get("EXPECTED_WORKER_SSH", "ubudgxkoushi@192.168.100.11")
with open(os.environ["EVENTS"], "a") as log:
    log.write(json.dumps({"node": "ssh", "args": args}) + "\n")
if os.environ.get("FAIL_SSH"):
    sys.exit(255)
if os.environ.get("FAIL_WORKER_CHECK") and shlex.split(args[6])[-1] == "recorded-worker":
    sys.exit(255)
sys.exit(subprocess.run(shlex.split(args[6]), env={**os.environ, "FAKE_NODE": "worker"}).returncode)
'''


class Glm53FlashTp2AdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        # Exercise POSIX SSH quoting with spaces, quotes and shell metacharacters.
        self.model = self.root / "model ' $(touch injected)"
        self.model.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name, content in (("docker", FAKE_DOCKER), ("ssh", FAKE_SSH)):
            script = self.bin / name
            script.write_text(content, encoding="utf-8")
            script.chmod(0o755)
        self.events_path = self.root / "events.jsonl"
        self.marker = self.root / "state/worker.json"
        self.env = {
            key: value for key, value in os.environ.items()
            if not key.startswith(("BLUE_", "TRTLLM_", "VLLM_"))
        }
        self.env.update({
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "EVENTS": str(self.events_path),
            "BLUE_MODEL_DIR": str(self.model),
            "BLUE_WORKER_MODEL_DIR": str(self.model),
            "BLUE_CACHE_DIR": str(self.root / "cache ' dir"),
            "BLUE_REMOTE_WORKER_MARKER_PATH": str(self.marker),
            "BLUE_SERVER_LOG_PATH": str(self.root / "server.log"),
            "BLUE_MODEL_PROFILE_ID": PROFILE,
            "BLUE_SERVER_ADAPTER": "glm53_flash_tp2",
        })

    def run_script(self, name, **env):
        return subprocess.run(
            ["bash", str(MODULE_DIR / name)], env={**self.env, **env},
            capture_output=True, text=True, timeout=10, cwd=self.root,
        )

    def events(self):
        if not self.events_path.exists():
            return []
        return [json.loads(line) for line in self.events_path.read_text().splitlines()]

    def docker_events(self):
        return [e for e in self.events() if e["node"] != "ssh"]

    def write_marker(self, target="ubudgxkoushi@192.168.100.11", name="system-prod-trtllm-rank1"):
        self.marker.parent.mkdir(exist_ok=True)
        self.marker.write_text(json.dumps({
            "sshTarget": target,
            "containerName": name,
        }))

    def qwen_env(self):
        fixture = MODULE_DIR / "tests/fixtures/private_qwen38_flash_next_orcarouter_fp8_tp2/manifest.json"
        body = json.loads(fixture.read_text())
        # Simulate the operator merge with local fake model directories and enablement.
        body["enabled"] = True
        body["storageLocation"] = body["currentStorageLocation"] = str(self.model)
        body["launcherHints"].update({
            "blueModelDir": str(self.model), "blueWorkerModelDir": str(self.model),
            "blueCacheDir": str(self.root / "cache ' dir"),
        })
        manifest = self.root / "registry" / body["modelProfileId"] / "manifest.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(body))
        profile = validate_startable_profile(str(manifest.parent.parent), body["modelProfileId"])
        self.assertFalse(profile.business_orchestration_eligible)
        env = launcher_env_for_profile(profile)
        env["EXPECTED_WORKER_SSH"] = body["launcherHints"]["blueWorkerSshTarget"]
        return env

    def test_private_qwen_manifest_launches_both_ranks_with_contracted_arguments(self):
        env = self.qwen_env()
        result = self.run_script("start-trtllm-server.sh", **env)
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.docker_events()
        runs = [e for e in events if e["args"][0] == "run" and "--rm" not in e["args"]]
        drops = [i for i, e in enumerate(events) if "drop_caches" in " ".join(e["args"])]
        self.assertEqual([events[i]["node"] for i in drops], ["worker", "head"])
        self.assertEqual([e["node"] for e in runs], ["worker", "head"])
        self.assertLess(max(drops), min(events.index(e) for e in runs))
        for event in runs:
            args = event["args"]
            node = event["node"]
            self.assertEqual(args[args.index("serve"):], [
                "serve", "/models/qwen38fn", "--served-model-name", "private-qwen38-flash-next",
                "--tensor-parallel-size", "2", "--mamba-cache-mode", "align",
                "--enable-prefix-caching", "--enable-chunked-prefill", "--kv-cache-dtype", "auto",
                "--max-model-len", "131072", "--max-num-seqs", "4", "--max-num-batched-tokens", "4096",
                "--speculative-config", env["VLLM_SPECULATIVE_CONFIG"], "--mm-encoder-tp-mode", "data",
                "--safetensors-load-strategy", "eager", "--default-chat-template-kwargs", '{"enable_thinking":false}',
                "--reasoning-parser", "qwen3", "--tool-call-parser", "qwen3_xml", "--enable-auto-tool-choice",
                "--gpu-memory-utilization", "0.85", "--nnodes", "2", "--master-addr", env["BLUE_MASTER_ADDR"],
                "--master-port", "29501", "--node-rank",
            ] + (["1", "--headless"] if node == "worker" else ["0", "--host", "127.0.0.1", "--port", "38083", "--scheduling-policy", "priority"]))
            self.assertIn(f"{self.model}:/models/qwen38fn:ro", args)
            self.assertIn("dgx.profile=" + env["BLUE_MODEL_PROFILE_ID"], args)
            self.assertEqual(args[args.index("--entrypoint") + 2], env["BLUE_SERVER_IMAGE"])
            expected_env = {
                "HF_HUB_OFFLINE=1", "MN_IF_NAME=enp1s0f0np0", "UCX_NET_DEVICES=enp1s0f0np0",
                "NCCL_SOCKET_IFNAME=enp1s0f0np0", "NCCL_IB_HCA=rocep1s0f0,roceP2p1s0f0",
                "NCCL_IB_DISABLE=0", "OMPI_MCA_btl_tcp_if_include=enp1s0f0np0",
                "GLOO_SOCKET_IFNAME=enp1s0f0np0", "TP_SOCKET_IFNAME=enp1s0f0np0",
                "NCCL_IGNORE_CPU_AFFINITY=1", "HEAD_IP=" + env["BLUE_MASTER_ADDR"], "MASTER_PORT=29501",
                "CUTE_DSL_ARCH=sm_121a", "SAFETENSORS_FAST_GPU=1", "VLLM_ENABLE_ROCE_ALLREDUCE=1",
                "VLLM_ROCE_ALLREDUCE_MAX_SIZE=2MB", "NCCL_BUFFSIZE=1048576", "NCCL_MAX_CTAS=8",
                "VLLM_WORKER_MULTIPROC_METHOD=spawn", "VLLM_SSM_CONV_STATE_LAYOUT=DS",
                "VLLM_USE_V2_MODEL_RUNNER=1", "VLLM_ENABLE_PCIE_ALLREDUCE=0", "VLLM_PLE_TABLE_MEMORY=shared",
                "VLLM_HOST_IP=" + ("spark2.example" if node == "worker" else env["BLUE_MASTER_ADDR"]),
            }
            self.assertEqual({args[i + 1] for i, a in enumerate(args) if a == "-e"}, expected_env)
            for forbidden in ("--load-format", "--quantization", "--attention-backend", "--moe-backend",
                              "--linear-backend", "--block-size", "--dtype", "--limit-mm-per-prompt"):
                self.assertNotIn(forbidden, args)
        self.assertEqual(json.loads(self.marker.read_text()), {
            "sshTarget": env["BLUE_WORKER_SSH_TARGET"], "containerName": "system-prod-trtllm-rank1",
        })
        result = self.run_script("stop-trtllm-server.sh", **env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.marker.exists())
        self.assertFalse((self.root / "injected").exists())

    def test_qwen_conflicting_runtime_values_fail_before_removal(self):
        env = self.qwen_env()
        for key, value in {
            "VLLM_SAFETENSORS_LOAD_STRATEGY": "lazy", "VLLM_DEFAULT_CHAT_TEMPLATE_KWARGS": '{"enable_thinking":true}',
            "VLLM_MM_ENCODER_TP_MODE": "weights", "VLLM_REASONING_PARSER": "glm45",
            "VLLM_TOOL_CALL_PARSER": "glm47", "VLLM_KV_CACHE_DTYPE": "fp8",
            "VLLM_SPECULATIVE_CONFIG": '{}', "VLLM_MAX_NUM_SEQS": "8",
            "VLLM_MAX_NUM_BATCHED_TOKENS": "8192", "VLLM_ENABLE_PREFIX_CACHING": "false",
            "VLLM_ENABLE_CHUNKED_PREFILL": "false", "VLLM_MAX_MODEL_LEN": "262144",
            "VLLM_GPU_MEMORY_UTILIZATION": "0.9",
        }.items():
            with self.subTest(key=key):
                result = self.run_script("glm53-flash-tp2-adapter.sh", **{**env, key: value})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.events(), [])

    def test_qwen_chat_kwargs_require_a_json_boolean(self):
        env = self.qwen_env()
        for raw in ('{"enable_thinking":0}', '[]', 'not json'):
            with self.subTest(raw=raw):
                result = self.run_script("glm53-flash-tp2-adapter.sh", **{
                    **env, "VLLM_DEFAULT_CHAT_TEMPLATE_KWARGS": raw,
                })
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.events(), [])

    def test_qwen_cache_drop_failures_warn_and_continue_before_both_ranks(self):
        result = self.run_script("start-trtllm-server.sh", **self.qwen_env(), FAIL_CACHE="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("worker drop_caches failed", result.stderr)
        self.assertIn("head drop_caches failed", result.stderr)
        events = self.docker_events()
        drops = [i for i, e in enumerate(events) if "drop_caches" in " ".join(e["args"])]
        runs = [i for i, e in enumerate(events) if e["args"][0] == "run" and "--rm" not in e["args"]]
        self.assertEqual(len(runs), 2)
        self.assertLess(max(drops), min(runs))

    def test_unknown_recipe_fails_before_side_effects(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh", BLUE_RUNTIME_RECIPE="unknown")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsupported BLUE_RUNTIME_RECIPE", result.stderr)
        self.assertEqual(self.events(), [])

    def test_empty_recipe_preserves_default_glm_arguments_and_order(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = self.events()
        self.events_path.write_text("")
        result = self.run_script("glm53-flash-tp2-adapter.sh", BLUE_RUNTIME_RECIPE="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events(), expected)

    def test_start_orders_both_ranks_cache_drops_and_head_and_writes_marker(self):
        result = self.run_script("start-trtllm-server.sh", VLLM_SERVED_MODEL_NAME="test-alias")
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.docker_events()
        self.assertEqual(events[0]["args"][0], "ps")
        self.assertEqual([(e["node"], e["args"][0]) for e in events[1:]], [
            ("head", "rm"), ("worker", "stop"), ("worker", "rm"), ("worker", "run"),
            ("worker", "inspect"), ("worker", "run"), ("head", "run"), ("head", "run"),
        ])
        worker_check = next(i for i, e in enumerate(self.events()) if e["node"] == "ssh" and shlex.split(e["args"][-1])[:2] == ["test", "-d"])
        worker_run = next(i for i, e in enumerate(self.events()) if e["node"] == "worker" and e["args"][0] == "run")
        self.assertLess(worker_check, worker_run)
        for node in ("head", "worker"):
            args = next(e["args"] for e in events if e["node"] == node and e["args"][0] == "run" and "--rm" not in e["args"])
            for key, value in {
                "--label": f"dgx.profile={PROFILE}", "--served-model-name": "test-alias",
                "--tensor-parallel-size": "2", "--max-model-len": "262144",
                "--gpu-memory-utilization": "0.85",
                "--nnodes": "2", "--master-addr": "192.168.100.10", "--master-port": "29501",
                "--attention-backend": "B12X", "--quantization": "modelopt_mixed",
                "--node-rank": "0" if node == "head" else "1",
            }.items():
                self.assertEqual(args[args.index(key) + 1], value)
            self.assertIn(f"{self.model}:/models/GLM-5.3-Flash-FP4-Local:ro", args)
            host_ip = "192.168.100.10" if node == "head" else "192.168.100.11"
            self.assertIn(f"VLLM_HOST_IP={host_ip}", args)
            for setting in ("NCCL_IB_DISABLE=0", "CUTE_DSL_ARCH=sm_121a", "VLLM_USE_V2_MODEL_RUNNER=1", "B12X_W4A16_A4_PREFILL=1"):
                self.assertIn(setting, args)
            self.assertEqual(json.loads(args[args.index("--speculative-config") + 1]), {
                "method": "mtp", "num_speculative_tokens": 5, "moe_backend": "humming", "attention_backend": "B12X",
            })
        head = events[-1]["args"]
        for flag, value in (("--host", "127.0.0.1"), ("--port", "38083"), ("--scheduling-policy", "priority")):
            self.assertEqual(head[head.index(flag) + 1], value)
        self.assertEqual(json.loads(head[head.index("--limit-mm-per-prompt") + 1]), {"image": 61})
        self.assertEqual(json.loads(self.marker.read_text()), {
            "sshTarget": "ubudgxkoushi@192.168.100.11", "containerName": "system-prod-trtllm-rank1",
        })
        self.assertFalse((self.root / "injected").exists())

    def test_private_comfy_stop_precedes_worker_launch_even_if_stop_fails(self):
        for failure in ("", "1"):
            with self.subTest(failure=failure):
                self.events_path.write_text("")
                result = self.run_script("glm53-flash-tp2-adapter.sh", FAIL_PRIVATE_STOP=failure)
                self.assertEqual(result.returncode, 0, result.stderr)
                events = self.docker_events()
                stop = events.index({"node": "worker", "args": ["stop", "dgx-private-comfyui"]})
                launch = next(i for i, e in enumerate(events) if e["node"] == "worker" and e["args"][0] == "run")
                self.assertLess(stop, launch)
                self.assertTrue(any(e["node"] == "head" and e["args"][0] == "run" for e in events))

    def test_gpu_memory_utilization_follows_profile_env(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh", VLLM_GPU_MEMORY_UTILIZATION="0.82")
        self.assertEqual(result.returncode, 0, result.stderr)
        for node in ("head", "worker"):
            args = next(e["args"] for e in self.docker_events() if e["node"] == node and e["args"][0] == "run" and "--rm" not in e["args"])
            self.assertEqual(args[args.index("--gpu-memory-utilization") + 1], "0.82")

    def test_validation_precedes_removal(self):
        for overrides in (
            {"BLUE_MODEL_DIR": str(self.root / "missing")},
            {"BLUE_WORKER_SSH_TARGET": "-oProxyCommand=bad"},
            {"BLUE_MASTER_PORT": "65536"},
            {"VLLM_LIMIT_MM_PER_PROMPT": "[]"},
            {"VLLM_TENSOR_PARALLEL_SIZE": "1"},
            {"VLLM_GPU_MEMORY_UTILIZATION": "1.2"},
            {"VLLM_GPU_MEMORY_UTILIZATION": "0.8 --x"},
            {"BLUE_WORKER_MODEL_DIR": "relative"},
        ):
            with self.subTest(overrides=overrides):
                result = self.run_script("glm53-flash-tp2-adapter.sh", **overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.events(), [])

    def test_worker_model_missing_stops_before_launch(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh", BLUE_WORKER_MODEL_DIR=str(self.root / "missing"))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(e["args"][0] == "run" for e in self.docker_events()))
        self.assertFalse(self.marker.exists())

    def test_worker_ssh_failure_stops_before_launch(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh", FAIL_SSH="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(e["args"][0] == "run" for e in self.docker_events()))
        self.assertFalse(self.marker.exists())

    def test_worker_launch_failure_retains_marker_for_stop(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh", FAIL_RUN="worker")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(self.marker.read_text()), {
            "sshTarget": "ubudgxkoushi@192.168.100.11", "containerName": "system-prod-trtllm-rank1",
        })
        self.assertFalse(any(e["node"] == "head" and e["args"][0] == "run" for e in self.docker_events()))
        result = self.run_script("stop-trtllm-server.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.docker_events()[-1], {
            "node": "worker", "args": ["rm", "-f", "system-prod-trtllm-rank1"],
        })
        self.assertFalse(self.marker.exists())

    def test_worker_not_running_retains_marker_without_head_launch(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh", WORKER_RUNNING="false")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.marker.exists())
        self.assertFalse(any(e["node"] == "head" and e["args"][0] == "run" for e in self.docker_events()))

    def test_head_launch_failure_retains_marker(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh", FAIL_RUN="head")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.marker.exists())

    def test_cache_drop_failures_are_logged_and_launch_continues(self):
        result = self.run_script("glm53-flash-tp2-adapter.sh", FAIL_CACHE="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("worker drop_caches failed", result.stderr)
        self.assertIn("head drop_caches failed", result.stderr)
        self.assertIn("cache permission denied", result.stderr)
        self.assertIn("--host", self.docker_events()[-1]["args"])

    def test_running_profile_mismatch_rejected_for_each_adapter(self):
        for adapter in ("glm53_flash_tp2", "qwen38_flash_next", "vllm"):
            with self.subTest(adapter=adapter):
                result = self.run_script("start-trtllm-server.sh", BLUE_SERVER_ADAPTER=adapter,
                                         BLUE_SERVER_IMAGE="test-image", RUNNING_NAME="system-prod-trtllm",
                                         RUNNING_PROFILE="different-profile")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("profile mismatch", result.stderr)
                self.assertIn(PROFILE, result.stderr)

    def test_unlabelled_container_and_no_profile_keep_legacy_behavior_except_glm(self):
        for adapter, requested, label, succeeds in (
            ("glm53_flash_tp2", PROFILE, "", False),
            ("glm53_flash_tp2", PROFILE, "<no value>", False),
            ("qwen38_flash_next", QWEN, "", True),
            ("vllm", QWEN, "<no value>", True),
            ("vllm", "business_qwen36_27b_nvfp4", "", True),
            ("vllm", "business_qwen36_27b_nvfp4", "<no value>", True),
            ("", "business_qwen36_27b_nvfp4", "", True),
            ("", "business_qwen36_27b_nvfp4", "<no value>", True),
            ("glm53_flash_tp2", "", "", True),
            ("qwen38_flash_next", "", PROFILE, True),
            ("vllm", "", "", True),
            ("", "", "", True),
        ):
            with self.subTest(adapter=adapter, requested=requested, label=label):
                result = self.run_script("start-trtllm-server.sh", BLUE_SERVER_ADAPTER=adapter,
                                         BLUE_MODEL_PROFILE_ID=requested, BLUE_SERVER_IMAGE="test-image",
                                         RUNNING_NAME="system-prod-trtllm", RUNNING_PROFILE=label)
                self.assertEqual(result.returncode == 0, succeeds, result.stderr)
        self.assertFalse(any(e["args"][0] == "rm" for e in self.docker_events()))
        self.assertFalse(any(e["node"] == "ssh" for e in self.events()))

    def test_matching_glm_checks_marker_worker_before_already_running(self):
        target = "worker@192.168.100.12"
        self.write_marker(target=target, name="recorded-worker")
        result = self.run_script("start-trtllm-server.sh", RUNNING_NAME="system-prod-trtllm",
                                 RUNNING_PROFILE=PROFILE, EXPECTED_WORKER_SSH=target)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("already running", result.stdout)
        self.assertEqual(self.docker_events()[-1], {
            "node": "worker", "args": ["inspect", "--format", "{{.State.Running}}", "recorded-worker"],
        })
        self.assertFalse(any(e["args"][0] in ("rm", "run") for e in self.docker_events()))

    def test_matching_glm_rebuilds_both_ranks_if_worker_unavailable(self):
        for overrides in ({"EXISTING_WORKER_RUNNING": "false"},
                          {"EXISTING_WORKER_RUNNING": "missing"}, {"FAIL_WORKER_CHECK": "1"}):
            with self.subTest(overrides=overrides):
                self.events_path.write_text("")
                self.write_marker(name="recorded-worker")
                result = self.run_script("start-trtllm-server.sh", RUNNING_NAME="system-prod-trtllm",
                                         RUNNING_PROFILE=PROFILE, **overrides)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("already running", result.stdout)
                self.assertIn("worker", result.stderr)
                self.assertIn("restarting", result.stderr)
                events = self.docker_events()
                self.assertEqual([e["node"] for e in events if e["args"][0] == "rm"], ["head", "worker"])
                self.assertEqual([e["node"] for e in events if e["args"][0] == "run" and "--rm" not in e["args"]],
                                 ["worker", "head"])

    def test_matching_glm_rebuilds_if_marker_missing_or_invalid(self):
        for contents in (None, "{}", "not json"):
            with self.subTest(contents=contents):
                self.marker.unlink(missing_ok=True)
                if contents is not None:
                    self.marker.parent.mkdir(exist_ok=True)
                    self.marker.write_text(contents)
                result = self.run_script("start-trtllm-server.sh", RUNNING_NAME="system-prod-trtllm",
                                         RUNNING_PROFILE=PROFILE)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn("already running", result.stdout)
                self.assertIn("marker", result.stderr)
                self.assertIn("restarting", result.stderr)

    def test_stop_removes_head_then_worker_and_marker(self):
        self.write_marker()
        result = self.run_script("stop-trtllm-server.sh", RUNNING_NAME="system-prod-trtllm")
        self.assertEqual(result.returncode, 0, result.stderr)
        removals = [e for e in self.docker_events() if e["args"][0] == "rm"]
        self.assertEqual(removals, [
            {"node": "head", "args": ["rm", "-f", "system-prod-trtllm"]},
            {"node": "worker", "args": ["rm", "-f", "system-prod-trtllm-rank1"]},
        ])
        self.assertFalse(self.marker.exists())

    def test_stop_recovers_worker_even_without_head(self):
        self.write_marker()
        result = self.run_script("stop-trtllm-server.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.docker_events()[-1]["node"], "worker")
        self.assertFalse(self.marker.exists())

    def test_stop_ssh_failure_returns_nonzero_and_retains_marker(self):
        self.write_marker()
        result = self.run_script("stop-trtllm-server.sh", RUNNING_NAME="system-prod-trtllm", FAIL_SSH="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(self.marker.exists())
        self.assertIn("retaining marker", result.stderr)

    def test_stop_without_marker_keeps_legacy_behavior(self):
        for running in ("", "system-prod-trtllm"):
            with self.subTest(running=running):
                result = self.run_script("stop-trtllm-server.sh", RUNNING_NAME=running)
                self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(e["node"] == "ssh" for e in self.events()))


if __name__ == "__main__":
    unittest.main()
