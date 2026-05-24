import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.boundary_policy import BoundaryPolicy, validate_fs_path, validate_policy_document, validate_url  # noqa: E402
from lib.profiles import CHAT_PROFILE, TOOLS_PROFILE  # noqa: E402


class BoundaryPolicyTests(unittest.TestCase):
    def test_dgx_healthz_allowed(self) -> None:
        policy = BoundaryPolicy(
            allowed_url_prefixes=("http://100.118.82.72:38081",),
            denied_url_prefixes=("http://127.0.0.1",),
        )
        result = validate_url("http://100.118.82.72:38081/healthz", policy)
        self.assertTrue(result.ok)

    def test_localhost_denied(self) -> None:
        policy = BoundaryPolicy(
            allowed_url_prefixes=("http://100.118.82.72:38081",),
            denied_url_prefixes=("http://127.0.0.1",),
        )
        result = validate_url("http://127.0.0.1:8080/admin", policy)
        self.assertFalse(result.ok)

    def test_https_denied_by_default(self) -> None:
        policy = BoundaryPolicy(
            allowed_url_prefixes=("http://100.118.82.72:38081",),
            denied_url_prefixes=("https://",),
        )
        result = validate_url("https://example.com/", policy)
        self.assertFalse(result.ok)

    def test_workspace_path_allowed(self) -> None:
        policy = BoundaryPolicy(
            allowed_fs_prefixes=("/home/hermes/.hermes-tools/workspace",),
            denied_fs_prefixes=("/etc",),
        )
        with mock.patch(
            "lib.boundary_policy._normalize_path",
            side_effect=lambda p: p,
        ):
            ok = validate_fs_path("/home/hermes/.hermes-tools/workspace/a.txt", policy)
            denied = validate_fs_path("/etc/passwd", policy)
        self.assertTrue(ok.ok)
        self.assertFalse(denied.ok)

    def test_policy_document_smoke(self) -> None:
        policy_path = ROOT / "config" / "boundary-policy.tools.yaml"
        if not policy_path.exists():
            self.skipTest("boundary-policy.tools.yaml missing")
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML not installed")
        data = yaml.safe_load(policy_path.read_text(encoding="utf-8"))
        errors = validate_policy_document(data)
        self.assertEqual(errors, [])

    def test_prefix_match_does_not_allow_sibling_directory(self) -> None:
        policy = BoundaryPolicy(
            allowed_fs_prefixes=("/home/hermes/.hermes-tools/workspace",),
            denied_fs_prefixes=(),
        )
        with mock.patch(
            "lib.boundary_policy._normalize_path",
            side_effect=lambda p: p,
        ):
            sibling = validate_fs_path("/home/hermes/.hermes-tools/workspace-evil/loot.txt", policy)
        self.assertFalse(sibling.ok)


class ProfileSpecTests(unittest.TestCase):
    def test_builtin_profiles(self) -> None:
        self.assertEqual(CHAT_PROFILE.systemd_unit, "hermes-gateway")
        self.assertTrue(CHAT_PROFILE.discord_enabled)
        self.assertFalse(TOOLS_PROFILE.discord_enabled)
        self.assertEqual(TOOLS_PROFILE.data_dir_name, "hermes-tools")


if __name__ == "__main__":
    unittest.main()
