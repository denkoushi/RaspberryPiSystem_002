#!/usr/bin/env python3
"""Tests for Private Hermes Business DGX profile defaults and overrides."""

import unittest
from pathlib import Path

from jinja2 import Environment, StrictUndefined


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PROFILE = "business_qwen38_flash_next_nvfp4"
EXPLICIT_PROFILE = "business_qwen36_27b_nvfp4"
TEMPLATE_PATHS = (
    ROOT / "infrastructure/ansible/templates/private-pi5-hermes/env.tools.j2",
    ROOT / "infrastructure/ansible/templates/private-pi5-hermes/env.research.j2",
    ROOT / "infrastructure/ansible/templates/private-pi5-hermes-dgx-keep-warm.env.j2",
)


def _ansible_bool(value: object) -> bool:
    """Provide the small Ansible filter needed by these templates."""
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _render(path: Path, **values: object) -> str:
    environment = Environment(undefined=StrictUndefined)
    environment.filters["bool"] = _ansible_bool
    context = {
        "private_pi5_hermes_tools_effective_dgx_llm_token": "",
        "private_pi5_hermes_research_effective_dgx_llm_token": "",
        "private_pi5_hermes_dgx_base_url": "",
        "private_pi5_hermes_chat_dgx_llm_token": "",
        "private_pi5_dgx_runtime_control_token": "",
    }
    context.update(values)
    return environment.from_string(path.read_text(encoding="utf-8")).render(
        **context
    )


class ModelProfileTemplateTests(unittest.TestCase):
    def test_templates_default_to_qwen38_business_profile(self) -> None:
        for path in TEMPLATE_PATHS:
            with self.subTest(path=path.name):
                rendered = _render(path)
                self.assertIn(f"DGX_MODEL_PROFILE_ID={DEFAULT_PROFILE}", rendered)

    def test_templates_preserve_explicit_profile_override(self) -> None:
        for path in TEMPLATE_PATHS:
            with self.subTest(path=path.name):
                rendered = _render(
                    path,
                    private_pi5_hermes_dgx_default_model_profile_id=EXPLICIT_PROFILE,
                )
                self.assertIn(f"DGX_MODEL_PROFILE_ID={EXPLICIT_PROFILE}", rendered)
                self.assertNotIn(f"DGX_MODEL_PROFILE_ID={DEFAULT_PROFILE}", rendered)


if __name__ == "__main__":
    unittest.main()
