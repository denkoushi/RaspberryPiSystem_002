import contextlib
import io
import json
import os
import shlex
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_DIR))

import nemotron35_dspark_cache as cache_helper
from model_profiles import DisabledModelProfileError, load_model_profile_manifest, validate_startable_profile
from profile_launcher import launcher_env_for_profile
from vllm_command_builder import build_command


PROFILE_ID = "business_nemotron35_lightning_dspark_nvfp4"
REGISTRY = MODULE_DIR / "model-registry.examples"


def make_snapshot(path, *, draft=False):
    path.mkdir(parents=True)
    metadata = ["config.json", "hf_quant_config.json"]
    if not draft:
        metadata += ["tokenizer.json", "tokenizer_config.json"]
        (path / "chat_template.jinja").write_text("{{ messages }}")
    for name in metadata:
        (path / name).write_text("{}")
    name = "model.safetensors" if draft else "model-00001-of-00001.safetensors"
    header = json.dumps({"weight": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
    (path / name).write_bytes(struct.pack("<Q", len(header)) + header + b"\0" * 4)
    if not draft:
        (path / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {"weight": name}}))
    return path


def fixture(root):
    model = make_snapshot(cache_helper.snapshot_path(root, cache_helper.MODEL_ID, cache_helper.MODEL_REVISION))
    draft = make_snapshot(cache_helper.snapshot_path(root, cache_helper.DRAFT_ID, cache_helper.DRAFT_REVISION), draft=True)
    env = launcher_env_for_profile(load_model_profile_manifest(REGISTRY / PROFILE_ID / "manifest.json"))
    env.update(BLUE_MODEL_DIR=str(model), VLLM_MODEL_PATH=str(model), VLLM_SPECULATIVE_MODEL=str(draft))
    return model, draft, env


class Nemotron35DsparkTests(unittest.TestCase):
    def test_candidate_is_disabled_text_only_and_pins_match_downloader(self):
        profile = load_model_profile_manifest(REGISTRY / PROFILE_ID / "manifest.json")
        env = launcher_env_for_profile(profile)
        self.assertFalse(profile.enabled)
        self.assertFalse(profile.recommended)
        self.assertEqual(profile.declared_capabilities, ("text",))
        self.assertEqual(profile.served_alias, "system-prod-primary")
        self.assertEqual(env["BLUE_SERVER_IMAGE"], cache_helper.IMAGE)
        for repo, rev, key in (
            (cache_helper.MODEL_ID, cache_helper.MODEL_REVISION, "VLLM_MODEL_PATH"),
            (cache_helper.DRAFT_ID, cache_helper.DRAFT_REVISION, "VLLM_SPECULATIVE_MODEL"),
        ):
            self.assertEqual(env[key], str(cache_helper.snapshot_path(Path(cache_helper.DEFAULT_CACHE), repo, rev)))
        self.assertEqual(env["BLUE_MODEL_DIR"], env["VLLM_MODEL_PATH"])
        with self.assertRaises(DisabledModelProfileError):
            validate_startable_profile(str(REGISTRY), PROFILE_ID)

    def test_offline_command_keeps_alias_and_uses_both_snapshots(self):
        with tempfile.TemporaryDirectory() as tmp:
            model, draft, env = fixture(Path(tmp))
            inherited = {"VLLM_HF_OVERRIDES": '{"architectures":["QwenForCausalLM"]}', "BLUE_SERVER_ADAPTER": "qwen38_flash_next"}
            with patch.dict(os.environ, {**inherited, **env}, clear=True):
                command = build_command()
            argv = shlex.split(command)
            self.assertIn(str(model), argv)
            for key, value in {
                "--speculative_config.model": str(draft),
                "--speculative_config.num_speculative_tokens": "3",
                "--mamba-backend": "flashinfer", "--mamba-cache-mode": "align",
                "--reasoning-parser": "nemotron_v3", "--tool-call-parser": "qwen3_coder",
                "--served-model-name": "system-prod-primary", "--quantization": "modelopt",
                "--max-num-seqs": "1", "--max-model-len": "65536",
            }.items():
                self.assertEqual(argv[argv.index(key) + 1], value)
            self.assertNotIn("--hf-overrides", argv)
            self.assertIn("HF_HUB_OFFLINE=1", command)
            self.assertIn("TRANSFORMERS_OFFLINE=1", command)
            self.assertEqual(env["BLUE_SERVER_ADAPTER"], "vllm")

    def test_draft_has_no_tokenizer_and_verify_does_not_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, draft, _ = fixture(root)
            self.assertFalse((draft / "tokenizer.json").exists())
            with patch.object(cache_helper.subprocess, "run") as runner, contextlib.redirect_stdout(io.StringIO()):
                cache_helper.prepare("verify", root)
            runner.assert_not_called()

    def test_missing_or_truncated_weights_reject_start(self):
        for damage in ("missing_main", "missing_draft", "truncated_draft", "missing_template", "missing_quant_config"):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as tmp:
                model, draft, env = fixture(Path(tmp))
                if damage == "missing_main":
                    (model / "model-00001-of-00001.safetensors").unlink()
                elif damage == "missing_draft":
                    (draft / "model.safetensors").unlink()
                elif damage == "truncated_draft":
                    path = draft / "model.safetensors"
                    path.write_bytes(path.read_bytes()[:-1])
                elif damage == "missing_template":
                    (model / "chat_template.jinja").unlink()
                else:
                    (model / "hf_quant_config.json").unlink()
                with patch.dict(os.environ, env, clear=True), self.assertRaisesRegex(SystemExit, "snapshot incomplete"):
                    build_command()

    def test_missing_snapshots_fail_before_docker_is_called(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, draft, env = fixture(root)
            (draft / "model.safetensors").unlink()
            result, calls = self.run_launcher(root, env)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("snapshot incomplete", result.stderr)
            self.assertEqual(calls, [])

    def test_launcher_uses_local_image_and_existing_loopback_port(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _, _, env = fixture(root)
            result, calls = self.run_launcher(root, env)
            self.assertEqual(result.returncode, 0, result.stderr)
            run = next(call for call in calls if call[0] == "run")
            for flag, value in {"--pull": "never", "--ipc": "host", "--publish": "127.0.0.1:38083:8000", "--entrypoint": "bash", "--name": "system-prod-trtllm"}.items():
                self.assertEqual(run[run.index(flag) + 1], value)
            self.assertIn(cache_helper.IMAGE, run)
            self.assertEqual(run[run.index(cache_helper.IMAGE) + 1], "-lc")
            self.assertFalse(any(call[0] == "pull" for call in calls))

    def run_launcher(self, root, env):
        fake_bin = root / "bin"
        fake_bin.mkdir()
        log = root / "docker.jsonl"
        docker = fake_bin / "docker"
        docker.write_text(
            f"#!{sys.executable}\nimport json, sys\n"
            f"with open({str(log)!r}, 'a') as f: f.write(json.dumps(sys.argv[1:]) + '\\n')\n"
        )
        docker.chmod(0o755)
        result = subprocess.run(["bash", str(MODULE_DIR / "start-trtllm-server.sh")], capture_output=True, text=True, env={
            "PATH": f"{fake_bin}:{os.environ['PATH']}", **env,
            "BLUE_HF_CACHE_DIR": str(root), "BLUE_SERVER_LOG_PATH": str(root / "server.log"),
        })
        return result, [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def test_plan_is_read_only_even_without_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "not-created"
            with patch.object(cache_helper.subprocess, "run") as runner, contextlib.redirect_stdout(io.StringIO()):
                cache_helper.prepare("plan", root)
            runner.assert_not_called()
            self.assertFalse(root.exists())

    def test_fetch_requires_disk_space_before_pull(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(cache_helper.shutil, "disk_usage") as disk, patch.object(cache_helper.subprocess, "run") as runner:
                disk.return_value.free = 0
                with self.assertRaisesRegex(SystemExit, "GiB free"):
                    cache_helper.prepare("fetch", Path(tmp))
                runner.assert_not_called()

    def test_fetch_uses_pinned_revisions_without_gpu_or_port(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture(root)
            with patch.object(cache_helper.shutil, "disk_usage") as disk, patch.object(cache_helper.subprocess, "run") as runner, contextlib.redirect_stdout(io.StringIO()):
                disk.return_value.free = 100 * 1024**3
                cache_helper.prepare("fetch", root)
            commands = [call.args[0] for call in runner.call_args_list]
            self.assertEqual(commands[0], ["docker", "pull", cache_helper.IMAGE])
            self.assertEqual(commands[1][-2:], [cache_helper.MODEL_ID, cache_helper.MODEL_REVISION])
            self.assertEqual(commands[2][-2:], [cache_helper.DRAFT_ID, cache_helper.DRAFT_REVISION])
            for command in commands[1:]:
                self.assertNotIn("--gpus", command)
                self.assertNotIn("--publish", command)
                self.assertIn(cache_helper.IMAGE, command)
            self.assertFalse((root / "hub" / ("models--" + cache_helper.MODEL_ID.replace("/", "--")) / "refs").exists())


if __name__ == "__main__":
    unittest.main()
