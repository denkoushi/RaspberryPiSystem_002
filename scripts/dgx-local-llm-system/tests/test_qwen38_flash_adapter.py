import os
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
ADAPTER = MODULE_DIR / "qwen38-flash-next-adapter.sh"
UPSTREAM_HOST_LINE = "    --host 0.0.0.0 " + ("\\" * 2) + "\n"
LOCAL_HOST_LINE = "    --host 127.0.0.1 " + ("\\" * 2) + "\n"
READINESS_MARKER = 'info "Loading weights (~3-4 min). Following logs until ready..."\n'


def create_adapter_fixture(
    root: Path,
    start_contents: str,
    *,
    recipe_env: str = "IMAGE=unused\n",
    snapshot_complete: bool = True,
    extra_snapshots: tuple[str, ...] = (),
) -> tuple[Path, dict[str, str]]:
    recipe = root / "recipe"
    recipe.mkdir()
    (recipe / ".env").write_text(recipe_env, encoding="utf-8")
    (recipe / "start.sh").write_text(start_contents, encoding="utf-8")
    (recipe / "start.sh").chmod(0o755)
    subprocess.run(["git", "-C", str(recipe), "init", "-q"], check=True)
    subprocess.run(["git", "-C", str(recipe), "config", "user.email", "test@example.invalid"], check=True)
    subprocess.run(["git", "-C", str(recipe), "config", "user.name", "adapter-test"], check=True)
    subprocess.run(["git", "-C", str(recipe), "add", "."], check=True)
    subprocess.run(["git", "-C", str(recipe), "commit", "-qm", "fixture"], check=True)
    revision = subprocess.check_output(["git", "-C", str(recipe), "rev-parse", "HEAD"], text=True).strip()

    model_dir = root / "hf-cache" / "hub" / "models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
    (model_dir / "refs").mkdir(parents=True)
    for snapshot_name in ("snapshot-test", *extra_snapshots):
        snapshot = model_dir / "snapshots" / snapshot_name
        snapshot.mkdir(parents=True)
        (snapshot / "model.safetensors.index.json").write_text(
            '{"weight_map":{"layer.safetensors":"layer.safetensors"}}\n',
            encoding="utf-8",
        )
        if snapshot_name != "snapshot-test" or snapshot_complete:
            (snapshot / "layer.safetensors").write_bytes(b"fixture")
    (model_dir / "refs" / "main").write_text("snapshot-test\n", encoding="utf-8")
    return recipe, {
        "BLUE_SERVER_MODE": "container",
        "BLUE_CONTAINER_NAME": "system-prod-trtllm",
        "BLUE_SERVER_PORT": "38083",
        "BLUE_HF_CACHE_DIR": str(root / "hf-cache"),
        "BLUE_MODEL_DIR": str(model_dir),
        "BLUE_SERVER_IMAGE": "vllm/vllm-openai:qwen38-flash-next",
        "BLUE_QWEN38_MODEL_REVISION": "snapshot-test",
        "BLUE_QWEN38_RECIPE_DIR": str(recipe),
        "BLUE_QWEN38_RECIPE_REVISION": revision,
        "VLLM_SERVED_MODEL_NAME": "system-prod-primary",
        "VLLM_MAX_MODEL_LEN": "262144",
        "VLLM_MAX_NUM_BATCHED_TOKENS": "2048",
        "VLLM_KV_CACHE_DTYPE": "fp8",
        "BLUE_EXTRA_DOCKER_ARGS": "--ipc host",
    }


class Qwen38FlashAdapterTests(unittest.TestCase):
    def test_profile_adapter_keeps_existing_container_noop(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_bin = Path(tmp) / "bin"
            fake_bin.mkdir()
            (fake_bin / "docker").write_text(
                "#!/usr/bin/env bash\n"
                "if [[ \"$1\" == ps ]]; then printf '%s\\n' system-prod-trtllm; fi\n",
                encoding="utf-8",
            )
            (fake_bin / "docker").chmod(0o755)
            env = {
                **os.environ,
                "PATH": f"{fake_bin}:{os.environ['PATH']}",
                "BLUE_SERVER_ADAPTER": "qwen38_flash_next",
                "BLUE_SERVER_MODE": "container",
                "BLUE_CONTAINER_NAME": "system-prod-trtllm",
                "BLUE_SERVER_LOG_PATH": str(Path(tmp) / "server.log"),
            }
            result = subprocess.run(
                ["bash", str(MODULE_DIR / "start-trtllm-server.sh")],
                env=env,
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 0)
            self.assertIn("already running container=system-prod-trtllm", result.stdout)

    def test_adapter_forwards_local_cache_profile_to_pinned_recipe(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            capture = root / "capture"
            args_capture = root / "args-capture"
            args_count_capture = root / "args-count-capture"
            boundary_path_capture = root / "boundary-path-capture"
            boundary_source_capture = root / "boundary-source-capture"
            start_contents = (
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                "printf '%s\\n' \"$TP1_MODEL_ID|$TP1_CONTAINER_NAME|$IMAGE|$SERVED_MODEL_NAME|$HF_HOME|$PORT|$MAX_MODEL_LEN|$MAX_NUM_SEQS|$MAX_NUM_BATCHED_TOKENS|$KV_CACHE_DTYPE|$PLE_OFFLOAD|$COMPILATION_MODE|$GPU_MEMORY_UTILIZATION|$EXTRA_VLLM_ARGS|$EXTRA_DOCKER_ARGS\" > \"$CAPTURE\"\n"
                "VLLM_ARGS=()\n"
                "VLLM_ARGS+=(\"$EXTRA_VLLM_ARGS\")\n"
                "VLLM_ARGS_STR=\"${VLLM_ARGS[*]}\"\n"
                "set -- $VLLM_ARGS_STR\n"
                "printf '%s\\n' \"$#\" > \"$ARGS_COUNT_CAPTURE\"\n"
                "printf '%s\\n' \"$@\" > \"$ARGS_CAPTURE\"\n"
                "printf '%s' \"$BASH_SOURCE\" > \"$BOUNDARY_PATH_CAPTURE\"\n"
                "cat \"$BASH_SOURCE\" > \"$BOUNDARY_SOURCE_CAPTURE\"\n"
                "cat <<'UPSTREAM_LAUNCH'\n"
                "docker run \\\n"
                + UPSTREAM_HOST_LINE
                + "    --port \"$PORT\"\n"
                + "UPSTREAM_LAUNCH\n"
                + "cat <<'UPSTREAM_READINESS'\n"
                + READINESS_MARKER
                + "UPSTREAM_READINESS\n"
            )
            recipe, env = create_adapter_fixture(root, start_contents)
            original_start = (recipe / "start.sh").read_text(encoding="utf-8")
            env.update({
                "CAPTURE": str(capture),
                "ARGS_CAPTURE": str(args_capture),
                "ARGS_COUNT_CAPTURE": str(args_count_capture),
                "BOUNDARY_PATH_CAPTURE": str(boundary_path_capture),
                "BOUNDARY_SOURCE_CAPTURE": str(boundary_source_capture),
            })
            subprocess.run([str(ADAPTER)], check=True, env={**os.environ, **env})
            self.assertEqual(
                capture.read_text(encoding="utf-8").strip(),
                "Mia-AiLab/Qwen3.8-Flash-Next-NVFP4|system-prod-trtllm|"
                "vllm/vllm-openai:qwen38-flash-next|system-prod-primary|"
                f"{root / 'hf-cache'}|38083|262144|1|2048|fp8|true|0|0.71|--scheduling-policy priority|--ipc host",
            )
            self.assertEqual(args_count_capture.read_text(encoding="utf-8").strip(), "2")
            self.assertEqual(
                args_capture.read_text(encoding="utf-8").splitlines(),
                ["--scheduling-policy", "priority"],
            )
            generated_start = Path(boundary_path_capture.read_text(encoding="utf-8"))
            generated_source = boundary_source_capture.read_text(encoding="utf-8")
            self.assertEqual(generated_source.count(LOCAL_HOST_LINE), 1)
            self.assertEqual(generated_source.count(UPSTREAM_HOST_LINE), 0)
            self.assertEqual(generated_source.count(f"exit 0\n{READINESS_MARKER}"), 1)
            self.assertFalse(generated_start.exists())
            self.assertEqual((recipe / "start.sh").read_text(encoding="utf-8"), original_start)
            self.assertEqual(list(recipe.glob(".business-qwen38-boundary-start.*")), [])

    def test_adapter_rejects_missing_pinned_host_bind_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recipe, env = create_adapter_fixture(root, "#!/usr/bin/env bash\nexit 0\n")
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("expected exactly one pinned host bind line, found 0", result.stderr)
            self.assertEqual(list(recipe.glob(".business-qwen38-boundary-start.*")), [])

    def test_adapter_rejects_non_serial_max_num_seqs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recipe, env = create_adapter_fixture(root, "#!/usr/bin/env bash\nexit 0\n")
            env["VLLM_MAX_NUM_SEQS"] = "4"
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("requires max_num_seqs=1", result.stderr)

    def test_adapter_rejects_non_priority_scheduling_policy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recipe, env = create_adapter_fixture(root, "#!/usr/bin/env bash\nexit 0\n")
            env["VLLM_SCHEDULING_POLICY"] = "fcfs"
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("requires priority scheduling", result.stderr)

    def test_adapter_rejects_ambiguous_pinned_host_bind_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            start_contents = (
                "#!/usr/bin/env bash\n"
                "cat <<'UPSTREAM_LAUNCH'\n"
                + UPSTREAM_HOST_LINE
                + UPSTREAM_HOST_LINE
                + "UPSTREAM_LAUNCH\n"
            )
            recipe, env = create_adapter_fixture(root, start_contents)
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("expected exactly one pinned host bind line, found 2", result.stderr)
            self.assertEqual(list(recipe.glob(".business-qwen38-boundary-start.*")), [])

    def test_adapter_rejects_missing_pinned_readiness_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            start_contents = (
                "#!/usr/bin/env bash\n"
                "cat <<'UPSTREAM_LAUNCH'\n"
                + UPSTREAM_HOST_LINE
                + "UPSTREAM_LAUNCH\n"
            )
            recipe, env = create_adapter_fixture(root, start_contents)
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("expected exactly one pinned readiness marker, found 0", result.stderr)
            self.assertEqual(list(recipe.glob(".business-qwen38-boundary-start.*")), [])

    def test_adapter_rejects_ambiguous_pinned_readiness_markers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            start_contents = (
                "#!/usr/bin/env bash\n"
                "cat <<'UPSTREAM_LAUNCH'\n"
                + UPSTREAM_HOST_LINE
                + "UPSTREAM_LAUNCH\n"
                + "cat <<'UPSTREAM_READINESS'\n"
                + READINESS_MARKER
                + READINESS_MARKER
                + "UPSTREAM_READINESS\n"
            )
            recipe, env = create_adapter_fixture(root, start_contents)
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("expected exactly one pinned readiness marker, found 2", result.stderr)
            self.assertEqual(list(recipe.glob(".business-qwen38-boundary-start.*")), [])

    def test_adapter_requires_clean_pinned_recipe_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            recipe = Path(tmp) / "recipe"
            recipe.mkdir()
            model_dir = Path(tmp) / "models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4"
            (model_dir / "refs").mkdir(parents=True)
            snapshot = model_dir / "snapshots" / "snapshot-test"
            snapshot.mkdir(parents=True)
            (snapshot / "model.safetensors.index.json").write_text(
                '{"weight_map":{"layer.safetensors":"layer.safetensors"}}\n',
                encoding="utf-8",
            )
            (snapshot / "layer.safetensors").write_bytes(b"fixture")
            (model_dir / "refs" / "main").write_text("snapshot-test\n", encoding="utf-8")
            env = {
                **os.environ,
                "BLUE_MODEL_DIR": str(model_dir),
                "BLUE_SERVER_IMAGE": "vllm/vllm-openai:qwen38-flash-next",
                "BLUE_QWEN38_MODEL_REVISION": "snapshot-test",
                "BLUE_QWEN38_RECIPE_DIR": str(recipe),
            }
            result = subprocess.run([str(ADAPTER)], env=env, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("checkout is unavailable", result.stderr)

    def test_adapter_rejects_incomplete_pinned_snapshot_before_upstream(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            capture = root / "upstream-called"
            start_contents = (
                "#!/usr/bin/env bash\n"
                "printf '%s' called > \"$CAPTURE\"\n"
                "cat <<'UPSTREAM_LAUNCH'\n"
                "docker run \\\n"
                + UPSTREAM_HOST_LINE
                + "UPSTREAM_LAUNCH\n"
                + "cat <<'UPSTREAM_READINESS'\n"
                + READINESS_MARKER
                + "UPSTREAM_READINESS\n"
            )
            _, env = create_adapter_fixture(
                root,
                start_contents,
                snapshot_complete=False,
                extra_snapshots=("0000000000000000000000000000000000000000",),
            )
            env["CAPTURE"] = str(capture)
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("pinned snapshot is incomplete", result.stderr)
            self.assertFalse(capture.exists())

    def test_adapter_allows_pinned_snapshot_with_other_complete_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            selected = root / "selected"
            start_contents = (
                "#!/usr/bin/env bash\n"
                "tr -d '[:space:]' < \"$HF_HOME/hub/models--Mia-AiLab--Qwen3.8-Flash-Next-NVFP4/refs/main\" > \"$SELECTED\"\n"
                "cat <<'UPSTREAM_LAUNCH'\n"
                "docker run \\\n"
                + UPSTREAM_HOST_LINE
                + "UPSTREAM_LAUNCH\n"
                + "cat <<'UPSTREAM_READINESS'\n"
                + READINESS_MARKER
                + "UPSTREAM_READINESS\n"
            )
            _, env = create_adapter_fixture(
                root,
                start_contents,
                extra_snapshots=("0000000000000000000000000000000000000000",),
            )
            env["SELECTED"] = str(selected)
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(selected.read_text(encoding="utf-8"), "snapshot-test")

    def test_adapter_exports_unvalidated_upstream_defaults_off_at_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            capture = root / "capture"
            start_contents = (
                "#!/usr/bin/env bash\n"
                "printf '%s|%s|%s|%s' \"$ABLIT\" \"$MAMBA_SSM_CACHE_DTYPE\" \"$MTP_DRAFT_VOCAB\" \"$EXTRA_DOCKER_ARGS\" > \"$CAPTURE\"\n"
                "cat <<'UPSTREAM_LAUNCH'\n"
                "docker run \\\n"
                + UPSTREAM_HOST_LINE
                + "UPSTREAM_LAUNCH\n"
                + "cat <<'UPSTREAM_READINESS'\n"
                + READINESS_MARKER
                + "UPSTREAM_READINESS\n"
            )
            _, env = create_adapter_fixture(
                root,
                start_contents,
                recipe_env=(
                    "IMAGE=unused\n"
                    "ABLIT=1\n"
                    "MAMBA_SSM_CACHE_DTYPE=bfloat16\n"
                    "MTP_DRAFT_VOCAB=files/draft_vocab_en_code_47k.txt\n"
                    "EXTRA_DOCKER_ARGS='-e VLLM_USE_V2_MODEL_RUNNER=1'\n"
                ),
            )
            env.pop("BLUE_EXTRA_DOCKER_ARGS")
            env["CAPTURE"] = str(capture)
            result = subprocess.run([str(ADAPTER)], env={**os.environ, **env}, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(capture.read_text(encoding="utf-8"), "0|||")


if __name__ == "__main__":
    unittest.main()
