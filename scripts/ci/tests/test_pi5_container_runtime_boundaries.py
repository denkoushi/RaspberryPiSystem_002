from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]
SERVER = (ROOT / "infrastructure/docker/docker-compose.server.yml").read_text()
PHASE3 = (ROOT / "infrastructure/docker/docker-compose.phase3.yml").read_text()
API_DOCKERFILE = (ROOT / "infrastructure/docker/Dockerfile.api").read_text()
WEB_DOCKERFILE = (ROOT / "infrastructure/docker/Dockerfile.web").read_text()
SERVER_ROLE = (
    ROOT / "infrastructure/ansible/roles/server/tasks/main.yml"
).read_text()
PERMISSION_MIGRATION = (
    ROOT / "infrastructure/ansible/playbooks/prepare-pi5-runtime-permissions.yml"
).read_text()
ADMIN_POLICY_MIGRATION = (
    ROOT / "infrastructure/ansible/playbooks/prepare-pi5-admin-network-policy.yml"
).read_text()
LOCAL_CADDY = (ROOT / "infrastructure/docker/Caddyfile.local.template").read_text()
PRODUCTION_CADDY = (ROOT / "infrastructure/docker/Caddyfile.production").read_text()


def service(compose: str, name: str) -> str:
    match = re.search(
        rf"^  {re.escape(name)}:\n(.*?)(?=^  [a-z][a-z0-9-]*:\n|^networks:|^volumes:|\Z)",
        compose,
        re.MULTILINE | re.DOTALL,
    )
    if match is None:
        raise AssertionError(f"missing Compose service {name}")
    return match.group(1)


class Pi5ContainerRuntimeBoundaryTest(unittest.TestCase):
    def assert_hardened(self, body: str, runtime: str) -> None:
        self.assertIn(f'user: "${{{runtime}_RUNTIME_UID:-1000}}:${{{runtime}_RUNTIME_GID:-1000}}"', body)
        self.assertIn("read_only: true", body)
        self.assertIn("cap_drop: [ALL]", body)
        self.assertIn("no-new-privileges:true", body)
        self.assertIn("init: true", body)

    def test_server_api_and_web_are_non_root_and_read_only(self):
        self.assert_hardened(service(SERVER, "api"), "API")
        self.assert_hardened(service(SERVER, "web"), "WEB")

    def test_all_blue_green_application_services_keep_the_boundary(self):
        for name in ("api-blue", "api-green"):
            self.assert_hardened(service(PHASE3, name), "API")
        for name in ("web-blue", "web-green", "gateway"):
            self.assert_hardened(service(PHASE3, name), "WEB")

    def test_only_enumerated_runtime_paths_are_writable(self):
        api = service(SERVER, "api")
        self.assertIn("/tmp:rw,nosuid,nodev", api)
        for path in ("/app/storage", "/app/alerts", "/app/power-actions", "/app/config", "/opt/backups"):
            self.assertIn(path, api)

        web = service(SERVER, "web")
        for path in ("/tmp:rw,nosuid,nodev", "/config:rw,nosuid,nodev", "/data:rw,nosuid,nodev", "/var/log/caddy"):
            self.assertIn(path, web)

    def test_images_have_non_root_defaults_and_no_file_capability(self):
        self.assertRegex(API_DOCKERFILE, r"(?m)^USER node$")
        self.assertRegex(WEB_DOCKERFILE, r"(?m)^USER caddy$")
        self.assertNotIn("setcap", WEB_DOCKERFILE)
        self.assertNotIn("libcap", WEB_DOCKERFILE)
        self.assertIn("> /tmp/Caddyfile.slot", WEB_DOCKERFILE)
        self.assertIn("> /tmp/Caddyfile.local", WEB_DOCKERFILE)

    def test_permission_migration_is_explicit_and_normal_release_fails_closed(self):
        self.assertIn("Verify existing Pi5 writable trees are ready", SERVER_ROLE)
        self.assertIn("become_user: \"{{ ansible_user }}\"", SERVER_ROLE)
        self.assertIn("pi5_runtime_permission_migration_approved | bool", PERMISSION_MIGRATION)
        self.assertIn("recurse: true", PERMISSION_MIGRATION)
        for path in ("storage", "alerts", "power-actions", "config", "/opt/backups", "/var/log/caddy"):
            self.assertIn(path, SERVER_ROLE)
            self.assertIn(path, PERMISSION_MIGRATION)

    def test_admin_routes_require_an_explicit_allowlist_in_every_runtime(self):
        for compose in (SERVER, PHASE3):
            self.assertIn(
                "ADMIN_ALLOW_NETS: ${ADMIN_ALLOW_NETS:?ADMIN_ALLOW_NETS is required}",
                compose,
            )
            self.assertNotIn("ADMIN_ALLOW_NETS:-", compose)
        for caddy in (LOCAL_CADDY, PRODUCTION_CADDY):
            self.assertIn("not remote_ip {$ADMIN_ALLOW_NETS}", caddy)
            self.assertIn('respond @admin_protect "Forbidden" 403', caddy)
            self.assertNotIn("{$ADMIN_ALLOW_NETS:", caddy)

    def test_admin_policy_bootstrap_is_separately_approved_and_rollback_safe(self):
        self.assertIn(
            "pi5_admin_network_policy_migration_approved | default(false) | bool",
            ADMIN_POLICY_MIGRATION,
        )
        self.assertIn("SSH_CONNECTION", ADMIN_POLICY_MIGRATION)
        self.assertIn("management source is outside", ADMIN_POLICY_MIGRATION)
        self.assertIn("Capture the Docker environment for rollback", ADMIN_POLICY_MIGRATION)
        self.assertIn("Restore the Docker environment", ADMIN_POLICY_MIGRATION)


if __name__ == "__main__":
    unittest.main()
