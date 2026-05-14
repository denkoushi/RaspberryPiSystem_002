import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = MODULE_DIR / "home_assistant_client.py"


def load_module():
    if str(MODULE_DIR) not in sys.path:
        sys.path.insert(0, str(MODULE_DIR))
    spec = importlib.util.spec_from_file_location("home_assistant_client", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class HomeAssistantClientTests(unittest.TestCase):
    def test_format_home_assistant_state_uses_friendly_name_and_unit(self):
        module = load_module()

        line = module.format_home_assistant_state(
            {
                "entity_id": "sensor.living_temperature",
                "state": "22.3",
                "attributes": {"friendly_name": "Living temperature", "unit_of_measurement": "°C"},
            }
        )

        self.assertEqual(line, "Living temperature (sensor.living_temperature): 22.3°C")

    def test_client_disabled_without_entity_allowlist(self):
        module = load_module()

        client = module.HomeAssistantClient(
            module.HomeAssistantConfig(enabled=True, base_url="http://ha.local:8123", token="token", entity_ids=())
        )

        self.assertFalse(client.enabled)
        self.assertEqual(client.snapshot_lines(), [])


if __name__ == "__main__":
    unittest.main()
