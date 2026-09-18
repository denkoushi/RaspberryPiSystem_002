from __future__ import annotations

import json
import unittest
from pathlib import Path

import yaml
from jinja2 import Environment, StrictUndefined


ROOT = Path(__file__).resolve().parents[3]
TEMPLATE = ROOT / "infrastructure/ansible/templates/business-hermes-chat-config.yaml.j2"


class BusinessHermesChatConfigTests(unittest.TestCase):
    def test_business_profile_selects_business_mcp_server_for_api_tools(self) -> None:
        environment = Environment(undefined=StrictUndefined)
        environment.filters["to_json"] = json.dumps
        rendered = environment.from_string(TEMPLATE.read_text(encoding="utf-8")).render(
            business_hermes_chat_model="business-test-model",
        )
        config = yaml.safe_load(rendered)

        self.assertIn("business_api", config["mcp_servers"])
        self.assertEqual(config["platform_toolsets"]["api_server"], ["business_api"])
        self.assertNotIn("business_api", config["agent"]["disabled_toolsets"])
        self.assertEqual(
            config["mcp_servers"]["business_api"]["headers"]["Authorization"],
            "Bearer ${env:BUSINESS_HERMES_MCP_API_KEY}",
        )


if __name__ == "__main__":
    unittest.main()
