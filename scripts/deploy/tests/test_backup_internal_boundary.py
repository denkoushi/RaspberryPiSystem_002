import pathlib
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]
RESOLVER = ROOT / "scripts/server/resolve-active-backup-api.py"
BACKUP_SCRIPT = ROOT / "scripts/server/backup.sh"
PHASE3_COMPOSE = ROOT / "infrastructure/docker/docker-compose.phase3.yml"
API_DOCKERFILE = ROOT / "infrastructure/docker/Dockerfile.api"
HOST_MOUNTED_CLI = ROOT / "apps/api/scripts/backup-internal-cli.mjs"
CLI_TEST = ROOT / "scripts/deploy/tests/backup-internal-cli.test.mjs"
GATEWAY_TEMPLATES = (
    ROOT / "infrastructure/docker/Caddyfile.gateway.template",
    ROOT / "infrastructure/docker/Caddyfile.gateway.http.template",
    ROOT / "infrastructure/docker/Caddyfile.gateway.maintenance.template",
    ROOT / "infrastructure/docker/Caddyfile.gateway.maintenance.http.template",
)
class ActiveBackupApiResolverTests(unittest.TestCase):
    def run_resolver(self, content: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            config = pathlib.Path(directory) / "Caddyfile"
            config.write_text(content, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(RESOLVER), str(config)],
                check=False,
                capture_output=True,
                text=True,
            )

    def render_gateway(self, slot: str) -> str:
        template = (ROOT / "infrastructure/docker/Caddyfile.gateway.template").read_text(
            encoding="utf-8"
        )
        return template.replace("__BLUE_GREEN_API_UPSTREAM__", f"api-{slot}:8080").replace(
            "__BLUE_GREEN_WEB_UPSTREAM__", f"web-{slot}:80"
        )

    def assert_failure_without_output(self, content: str) -> None:
        result = self.run_resolver(content)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_resolves_role_rendered_blue_and_green_routes(self) -> None:
        for slot in ("blue", "green"):
            with self.subTest(slot=slot):
                result = self.run_resolver(self.render_gateway(slot))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, f"api-{slot}\n")

    def test_rejects_none(self) -> None:
        self.assert_failure_without_output("reverse_proxy web-blue:80 {\n}\n")

    def test_rejects_ambiguous_routes(self) -> None:
        for content in (
            "reverse_proxy @api api-blue:8080 {\n}\n" * 2,
            "reverse_proxy @api api-blue:8080 {\n}\nreverse_proxy @api api-green:8080 {\n}\n",
        ):
            with self.subTest(content=content):
                self.assert_failure_without_output(content)

    def test_rejects_unknown_or_unrendered_routes(self) -> None:
        for upstream in ("api-canary:8080", "__BLUE_GREEN_API_UPSTREAM__"):
            with self.subTest(upstream=upstream):
                self.assert_failure_without_output(
                    f"reverse_proxy @api {upstream} {{\n}}\nreverse_proxy web-blue:80 {{\n}}\n"
                )

    def test_rejects_route_syntax_mismatch(self) -> None:
        for content in (
            "reverse_proxy @api api-blue:8080\n",
            "reverse_proxy @api http://api-blue:8080 {\n}\n",
            "reverse_proxy @api api-blue:8080 api-green:8080 {\n}\n",
        ):
            with self.subTest(content=content):
                self.assert_failure_without_output(content)

    def test_rejects_api_and_web_slot_mismatch(self) -> None:
        self.assert_failure_without_output(
            "reverse_proxy @api api-blue:8080 {\n}\nreverse_proxy web-green:80 {\n}\n"
        )

    def test_ignores_comments_web_routes_and_similar_matcher_names(self) -> None:
        content = """
# reverse_proxy @api api-green:8080 {
reverse_proxy @apiary api-green:8080 {
}
reverse_proxy web-blue:80 {
}
reverse_proxy @api api-blue:8080 {
}
"""
        result = self.run_resolver(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "api-blue\n")

    def test_rejects_missing_config(self) -> None:
        result = subprocess.run(
            [sys.executable, str(RESOLVER), "/path/that/does/not/exist"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")


class BackupInternalGatewayContractTests(unittest.TestCase):
    def test_all_canonical_gateway_listeners_block_only_the_internal_backup_path(self) -> None:
        matcher = "@internal_backup_api path /api/backup/internal /api/backup/internal/*"
        route = "route {\n    respond @internal_backup_api 404"
        expected_listeners = {
            "Caddyfile.gateway.template": 2,
            "Caddyfile.gateway.http.template": 1,
            "Caddyfile.gateway.maintenance.template": 2,
            "Caddyfile.gateway.maintenance.http.template": 1,
        }

        for template in GATEWAY_TEMPLATES:
            with self.subTest(template=template.name):
                text = template.read_text(encoding="utf-8")
                self.assertEqual(text.count(matcher), expected_listeners[template.name])
                self.assertEqual(text.count(route), expected_listeners[template.name])
                self.assertNotIn("path /api/backup/internal*", text)
                first_route = text.index(route)
                for downstream in ("reverse_proxy @api", "redir https://", "rewrite * /index.html"):
                    if downstream in text:
                        self.assertLess(first_route, text.index(downstream))

    def test_backup_script_uses_only_the_resolved_compose_service_and_container_cli(self) -> None:
        text = BACKUP_SCRIPT.read_text(encoding="utf-8")
        resolver = RESOLVER.read_text(encoding="utf-8")

        self.assertIn('API_COMPOSE_PROJECT="bluegreen"', text)
        self.assertIn('docker-compose.phase3.yml', text)
        self.assertIn('exec -T "${ACTIVE_API_SERVICE}"', text)
        self.assertIn('/app/host/apps/api/scripts/backup-internal-cli.mjs', text)
        self.assertIn("http://127.0.0.1:8080/api/system/health", text)
        self.assertNotIn('API_URL="https://localhost/api"', text)
        self.assertNotIn('curl -k -s -X POST', text)
        for forbidden in ("docker ps", "docker inspect", "--filter", "container_name"):
            self.assertNotIn(forbidden, resolver)

        resolve_index = text.index("ACTIVE_API_SERVICE=$(resolve_active_api_service)")
        backup_dir_index = text.index('mkdir -p "${BACKUP_DIR}"')
        self.assertLess(resolve_index, backup_dir_index)

        subprocess.run(["bash", "-n", str(BACKUP_SCRIPT)], check=True)

    def test_host_mounted_cli_is_shared_by_both_node_api_slots(self) -> None:
        compose = PHASE3_COMPOSE.read_text(encoding="utf-8")
        dockerfile = API_DOCKERFILE.read_text(encoding="utf-8")

        self.assertTrue(HOST_MOUNTED_CLI.is_file())
        self.assertIn("volumes: &api-volumes", compose)
        self.assertIn(
            "${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}/apps/api:/app/host/apps/api:ro",
            compose,
        )
        self.assertIn("api-green:", compose)
        self.assertIn("volumes: *api-volumes", compose)
        self.assertIn("FROM node:20-bookworm-slim AS api-runtime", dockerfile)
        self.assertIn("FROM api-runtime AS api", dockerfile)

    def test_plain_mjs_cli_contract(self) -> None:
        subprocess.run(["node", "--test", str(CLI_TEST)], check=True)


if __name__ == "__main__":
    unittest.main()
