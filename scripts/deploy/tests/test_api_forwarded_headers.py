from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]
CADDY_DIR = ROOT / "infrastructure/docker"
TEMPLATES = {
    "Caddyfile.gateway.template": 1,
    "Caddyfile.gateway.http.template": 1,
    "Caddyfile.slot.template": 2,
    "Caddyfile.production": 2,
    "Caddyfile": 2,
    "Caddyfile.local": 2,
    "Caddyfile.local.template": 2,
}


def reverse_proxies(text):
    lines = text.splitlines()
    for index, line in enumerate(lines):
        match = re.match(r"^([ \t]*)reverse_proxy\s+(.+)$", line)
        if not match:
            continue
        indent, route = match.groups()
        if not route.endswith(" {"):
            raise AssertionError(f"reverse_proxy must have a header block: {line}")
        end = next(i for i in range(index + 1, len(lines)) if lines[i] == indent + "}")
        yield route, lines[index + 1:end]


class ApiForwardedHeaderTests(unittest.TestCase):
    def test_every_api_proxy_overwrites_forwarded_for(self):
        for name, expected in TEMPLATES.items():
            with self.subTest(name=name):
                proxies = list(reverse_proxies((CADDY_DIR / name).read_text()))
                api_proxies = [p for p in proxies if "__BLUE_GREEN_WEB_UPSTREAM__" not in p[0]]
                self.assertEqual(len(api_proxies), expected)
                for route, body in api_proxies:
                    headers = [line.strip() for line in body if re.match(r"\s*header_up\s+[+\-]?X-Forwarded-For\b", line, re.I)]
                    self.assertEqual(headers, ["header_up X-Forwarded-For {remote_host}"], route)

    def test_gateway_slot_upstreams_still_match_deployment_contract(self):
        for name in ("Caddyfile.gateway.template", "Caddyfile.gateway.http.template"):
            with self.subTest(name=name):
                text = (CADDY_DIR / name).read_text()
                self.assertEqual(text.count("reverse_proxy @api __BLUE_GREEN_API_UPSTREAM__ {"), 1)
                self.assertEqual(text.count("reverse_proxy __BLUE_GREEN_WEB_UPSTREAM__ {"), 1)
                for slot in ("blue", "green"):
                    rendered = text.replace("__BLUE_GREEN_API_UPSTREAM__", f"api-{slot}:8080").replace(
                        "__BLUE_GREEN_WEB_UPSTREAM__", f"web-{slot}:80"
                    )
                    self.assertEqual(
                        set(re.findall(r"\b(?:api|web)-(?:blue|green):(?:8080|80)\b", rendered)),
                        {f"api-{slot}:8080", f"web-{slot}:80"},
                    )

    def test_admin_allowlist_remains_a_socket_remote_ip_matcher(self):
        for name in ("Caddyfile", "Caddyfile.production", "Caddyfile.local", "Caddyfile.local.template"):
            self.assertIn("not remote_ip {$ADMIN_ALLOW_NETS}", (CADDY_DIR / name).read_text())
        for name in ("Caddyfile.gateway.template", "Caddyfile.gateway.http.template"):
            self.assertIn("import /srv/bluegreen/admin-allow-nets.caddy", (CADDY_DIR / name).read_text())
        policy = (ROOT / "infrastructure/ansible/roles/release_pi5/tasks/prepare.yml").read_text()
        self.assertIn("not remote_ip", policy)


if __name__ == "__main__":
    unittest.main()
