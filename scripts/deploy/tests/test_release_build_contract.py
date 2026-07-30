from __future__ import annotations

import json
import unittest

from scripts.deploy.release_build_contract import (
    API_BUILD_ARGUMENT_KEYS,
    WEB_BUILD_ARGUMENT_KEYS,
    BuildContractError,
    build_config_hash,
    canonical_contract_json,
    contract_from_compose_json,
    normalize_build_arguments,
    parse_contract_json,
)
from scripts.deploy.production_config_contract import (
    ConfigKind,
    PRODUCTION_WEB_SETTINGS,
)


SHA = "a" * 40


def valid_api() -> dict[str, str]:
    return {"INSTALL_PLAYWRIGHT_CHROMIUM": "true"}


def valid_web() -> dict[str, str]:
    values = {
        setting.key: setting.production_default
        for setting in PRODUCTION_WEB_SETTINGS
        if setting.kind is ConfigKind.IMAGE
    }
    values["VITE_RELEASE_SHA"] = SHA
    return {key: str(value) for key, value in values.items()}


class ReleaseBuildContractTests(unittest.TestCase):
    def test_canonical_hash_is_stable_across_input_order(self) -> None:
        contract = normalize_build_arguments(
            dict(reversed(list(valid_api().items()))),
            dict(reversed(list(valid_web().items()))),
            SHA,
        )
        canonical = canonical_contract_json(contract)
        self.assertEqual(list(json.loads(canonical)), ["api", "web"])
        self.assertEqual(
            list(json.loads(canonical)["api"]), sorted(API_BUILD_ARGUMENT_KEYS)
        )
        self.assertEqual(
            list(json.loads(canonical)["web"]), sorted(WEB_BUILD_ARGUMENT_KEYS)
        )
        self.assertEqual(build_config_hash(contract), build_config_hash(contract))

    def test_compose_extraction_matches_strict_contract(self) -> None:
        compose = {
            "name": "raspi-system",
            "services": {
                "api": {"build": {"args": valid_api()}},
                "web": {"build": {"args": valid_web()}},
            },
        }
        contract = contract_from_compose_json(json.dumps(compose), SHA)
        reparsed = parse_contract_json(canonical_contract_json(contract), SHA)
        self.assertEqual(contract, reparsed)
        self.assertEqual(
            contract.service_arguments("web")["VITE_AGENT_WS_MODE"],
            "local",
        )

    def test_rejects_unknown_missing_and_non_string_arguments(self) -> None:
        cases = []
        unknown = valid_web()
        unknown["VITE_SECRET"] = "forbidden"
        cases.append(unknown)
        missing = valid_web()
        missing.pop("VITE_API_BASE_URL")
        cases.append(missing)
        malformed = valid_web()
        malformed["VITE_API_BASE_URL"] = True  # type: ignore[assignment]
        cases.append(malformed)
        newline = valid_web()
        newline["VITE_API_BASE_URL"] = "/api\nTOKEN=value"
        cases.append(newline)
        for web in cases:
            with self.subTest(web=web):
                with self.assertRaises(BuildContractError):
                    normalize_build_arguments(valid_api(), web, SHA)

    def test_rejects_release_sha_drift_and_duplicate_json_keys(self) -> None:
        drifted = valid_web()
        drifted["VITE_RELEASE_SHA"] = "b" * 40
        with self.assertRaisesRegex(BuildContractError, "does not match"):
            normalize_build_arguments(valid_api(), drifted, SHA)
        duplicate = (
            '{"api":{"INSTALL_PLAYWRIGHT_CHROMIUM":"true",'
            '"INSTALL_PLAYWRIGHT_CHROMIUM":"false"},"web":'
            + json.dumps(valid_web())
            + "}"
        )
        with self.assertRaisesRegex(BuildContractError, "duplicate"):
            parse_contract_json(duplicate, SHA)


if __name__ == "__main__":
    unittest.main()
