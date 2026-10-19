import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1]
GUARD = MODULE_DIR / "qwen38_ple_loader_guard.py"
spec = importlib.util.spec_from_file_location("qwen38_ple_loader_guard", GUARD)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

WORKER = (
    "def load(load_config):\n"
    "    if True:\n"
    "        loader = get_model_loader(load_config)\n"
    "        return loader\n"
)


class Qwen38PleLoaderGuardTests(unittest.TestCase):
    def test_guard_switches_gpu_direct_loaders_back_to_safetensors(self):
        guarded = guard.guard_source(WORKER)
        namespace = {"get_model_loader": lambda config: config.load_format}
        exec(guarded, namespace)

        class Config:
            def __init__(self, load_format):
                self.load_format = load_format

        original = Config("instanttensor")
        self.assertEqual(namespace["load"](original), "safetensors")
        self.assertEqual(original.load_format, "instanttensor")
        self.assertEqual(namespace["load"](Config("fastsafetensors")), "safetensors")
        self.assertEqual(namespace["load"](Config("safetensors")), "safetensors")
        self.assertEqual(namespace["load"](Config("auto")), "auto")

    def test_guard_is_idempotent(self):
        once = guard.guard_source(WORKER)
        self.assertEqual(guard.guard_source(once), once)

    def test_guard_rejects_unexpected_worker_source(self):
        with self.assertRaisesRegex(ValueError, "found 0"):
            guard.guard_source("def load():\n    pass\n")
        with self.assertRaisesRegex(ValueError, "found 2"):
            guard.guard_source(WORKER + WORKER.replace("def load", "def load2"))

    def test_cli_rewrites_file_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            worker = Path(tmp) / "worker.py"
            worker.write_text(WORKER, encoding="utf-8")
            subprocess.run([sys.executable, str(GUARD), str(worker)], check=True)
            self.assertIn(guard.MARKER, worker.read_text(encoding="utf-8"))
            broken = Path(tmp) / "broken.py"
            broken.write_text("pass\n", encoding="utf-8")
            result = subprocess.run([sys.executable, str(GUARD), str(broken)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("PLE loader guard failed", result.stderr)
            self.assertEqual(broken.read_text(encoding="utf-8"), "pass\n")


if __name__ == "__main__":
    unittest.main()
