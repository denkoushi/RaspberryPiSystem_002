from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

from jinja2 import Environment, StrictUndefined


ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / "infrastructure/ansible/templates/logrotate-security.conf.j2"


def render_config(**variables) -> str:
    return Environment(undefined=StrictUndefined).from_string(
        TEMPLATE.read_text(encoding="utf-8")
    ).render(**variables)


class SecurityLogrotateContractTests(unittest.TestCase):
    def test_package_owned_fail2ban_and_clamav_logs_are_not_redefined(self) -> None:
        config = render_config()
        self.assertNotIn("/var/log/fail2ban", config)
        self.assertNotIn("/var/log/clamav", config)
        # Debian trixie's rkhunter package rotates /var/log/rkhunter.log,
        # while our scan wrapper writes /var/log/rkhunter/rkhunter-scan.log.
        self.assertNotIn("/var/log/rkhunter.log", config)

    def test_only_custom_logs_remain_with_existing_retention(self) -> None:
        for repo_path in (None, "/opt/test-repository"):
            with self.subTest(repo_path=repo_path):
                config = render_config(**({"repo_path": repo_path} if repo_path else {}))
                blocks = dict(re.findall(r"([^\s#]+)\s*\{([^}]+)\}", config))
                root = repo_path or "/opt/RaspberryPiSystem_002"
                expected = {"/var/log/trivy/*.log": 52, "/var/log/rkhunter/*.log": 52,
                            f"{root}/alerts/*.json": 26}
                self.assertEqual(set(blocks), set(expected))
                for path, retention in expected.items():
                    self.assertRegex(blocks[path], rf"\brotate\s+{retention}\b")
                    self.assertIn("weekly", blocks[path])
                    self.assertIn("missingok", blocks[path])

    @unittest.skipUnless(shutil.which("logrotate"), "logrotate is not installed locally")
    def test_rendered_config_passes_logrotate_debug(self) -> None:
        with tempfile.TemporaryDirectory(prefix="security-logrotate-") as directory:
            config_path = Path(directory) / "raspisys-security"
            config_path.write_text(render_config(), encoding="utf-8")
            result = subprocess.run(["logrotate", "-d", "-s", "/dev/null", str(config_path)],
                                    capture_output=True, text=True, check=False, timeout=10)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
