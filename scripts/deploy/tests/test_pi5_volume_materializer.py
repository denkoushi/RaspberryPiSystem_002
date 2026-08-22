from __future__ import annotations

import importlib.util
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts/deploy/pi5_volume_materializer.py"
SPEC = importlib.util.spec_from_file_location("pi5_volume_materializer", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def volume_models() -> tuple[dict[str, Any], dict[str, Any]]:
    phase3 = {
        "volumes": {
            "assembly-procedure-assets-storage": {
                "external": True,
                "name": "docker_assembly-procedure-assets-storage",
            },
            "cache": {"external": False},
        }
    }
    server = {
        "volumes": {
            "assembly-procedure-assets-storage": {
                "name": "docker_assembly-procedure-assets-storage",
                "driver": "local",
                "driver_opts": {
                    "type": "none",
                    "o": "bind",
                    "device": "/opt/RaspberryPiSystem_002/storage/assembly-procedure-assets",
                },
            }
        }
    }
    return phase3, server


def rendered_models(root: str, prefix: str) -> tuple[dict[str, Any], dict[str, Any]]:
    def render(value: Any) -> Any:
        if isinstance(value, str):
            return (
                value.replace("${PI5_PROJECT_DIR:-/opt/RaspberryPiSystem_002}", root)
                .replace("${PI5_VOLUME_PREFIX:-docker}", prefix)
            )
        if isinstance(value, list):
            return [render(item) for item in value]
        if isinstance(value, dict):
            return {key: render(item) for key, item in value.items()}
        return value

    phase3 = yaml.safe_load(
        (ROOT / "infrastructure/docker/docker-compose.phase3.yml").read_text()
    )
    server = yaml.safe_load(
        (ROOT / "infrastructure/docker/docker-compose.server.yml").read_text()
    )
    return render(phase3), render(server)


class Pi5VolumeMaterializerTest(unittest.TestCase):
    def test_phase3_external_volume_resolves_one_to_one_to_server_contract(self) -> None:
        phase3, server = volume_models()

        specs = MODULE.required_volume_specs(phase3, server)

        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0].name, "docker_assembly-procedure-assets-storage")
        self.assertEqual(specs[0].driver, "local")
        self.assertEqual(specs[0].options["o"], "bind")

    def test_rendered_production_and_staging_models_cover_all_thirteen_mounts(self) -> None:
        expected_suffixes = {
            "photos",
            "thumbnails",
            "pdfs",
            "pdf-pages",
            "signage-rendered",
            "part-measurement-drawings",
            "part-measurement-drawings-derivatives",
            "assembly-procedure-images",
            "assembly-procedure-assets",
            "measuring-instrument-genres",
            "pallet-machine-illustrations",
            "csv-dashboards",
            ".integrity",
        }
        for root, prefix in (
            ("/opt/RaspberryPiSystem_002", "docker"),
            ("/opt/RaspberryPiSystem_002-staging", "docker-staging"),
        ):
            phase3, server = rendered_models(root, prefix)
            specs = MODULE.required_volume_specs(phase3, server)
            self.assertEqual(len(specs), 13)
            self.assertEqual(
                {spec.name for spec in specs},
                {
                    value["name"]
                    for value in phase3["volumes"].values()
                    if value.get("external") is True
                },
            )
            self.assertEqual(
                {Path(spec.options["device"]).name for spec in specs},
                expected_suffixes,
            )
            api_mounts = {
                mount
                for mount in phase3["services"]["api-blue"]["volumes"]
                if isinstance(mount, str)
            }
            durable_keys = {
                key
                for key, value in phase3["volumes"].items()
                if value.get("external") is True
            }
            durable_mounts = {
                mount
                for mount in api_mounts
                if mount.split(":", 1)[0] in durable_keys
            }
            self.assertEqual(len(durable_mounts), 13)
            self.assertEqual(
                {
                    mount.split(":", 1)[1]
                    for mount in durable_mounts
                },
                {f"/app/storage/{suffix}" for suffix in expected_suffixes},
            )

    def test_missing_volume_is_created_and_verified(self) -> None:
        phase3, server = volume_models()
        spec = MODULE.required_volume_specs(phase3, server)[0]
        current: dict[str, dict[str, Any]] = {}
        created: list[str] = []

        def inspect(name: str) -> dict[str, Any] | None:
            return current.get(name)

        def create(value: Any) -> None:
            created.append(value.name)
            current[value.name] = {"Driver": value.driver, "Options": dict(value.options)}

        changed = MODULE.reconcile_volume(spec, inspect, create)

        self.assertTrue(changed)
        self.assertEqual(created, [spec.name])

    def test_existing_matching_volume_is_left_unchanged(self) -> None:
        phase3, server = volume_models()
        spec = MODULE.required_volume_specs(phase3, server)[0]
        current = {"Driver": "local", "Options": dict(spec.options)}
        created: list[str] = []

        changed = MODULE.reconcile_volume(
            spec,
            lambda _name: current,
            lambda value: created.append(value.name),
        )

        self.assertFalse(changed)
        self.assertEqual(created, [])

    def test_all_rendered_matching_volumes_are_a_noop(self) -> None:
        phase3, server = rendered_models("/opt/RaspberryPiSystem_002", "docker")
        specs = MODULE.required_volume_specs(phase3, server)
        current = {
            spec.name: {"Driver": spec.driver, "Options": dict(spec.options)}
            for spec in specs
        }
        created: list[str] = []

        changed = MODULE.reconcile_volumes(
            specs,
            lambda name: current[name],
            lambda value: created.append(value.name),
            lambda _value: True,
        )

        self.assertEqual(changed, [])
        self.assertEqual(created, [])

    def test_existing_mismatch_fails_without_create_or_delete(self) -> None:
        phase3, server = volume_models()
        spec = MODULE.required_volume_specs(phase3, server)[0]
        created: list[str] = []
        mismatch = {
            "Driver": "local",
            "Options": {"type": "none", "o": "bind", "device": "/wrong/path"},
        }

        with self.assertRaisesRegex(MODULE.VolumeContractError, "refusing to delete or overwrite"):
            MODULE.reconcile_volume(
                spec,
                lambda _name: mismatch,
                lambda value: created.append(value.name),
            )

        self.assertEqual(created, [])

    def test_full_set_validates_later_mismatch_before_creating_earlier_missing(self) -> None:
        phase3, server = volume_models()
        first = MODULE.required_volume_specs(phase3, server)[0]
        second = MODULE.VolumeSpec(
            name="docker_assembly-procedure-images-storage",
            driver="local",
            options={
                "type": "none",
                "o": "bind",
                "device": "/opt/RaspberryPiSystem_002/storage/assembly-procedure-images",
            },
        )
        created: list[str] = []
        mismatch = {
            "Driver": "local",
            "Options": {"type": "none", "o": "bind", "device": "/wrong/path"},
        }

        def inspect(name: str) -> dict[str, Any] | None:
            if name == first.name:
                return None
            return mismatch

        with self.assertRaises(MODULE.VolumeContractError):
            MODULE.reconcile_volumes(
                [first, second],
                inspect,
                lambda value: created.append(value.name),
                lambda _value: True,
            )

        self.assertEqual(created, [])

    def test_volume_inspect_lowercase_not_found_is_the_only_missing_case(self) -> None:
        missing = type(
            "Completed", (), {"returncode": 1, "stdout": "", "stderr": "Error response from daemon: get x: no such volume"}
        )()
        daemon_error = type(
            "Completed", (), {"returncode": 1, "stdout": "", "stderr": "permission denied"}
        )()

        with patch.object(MODULE.subprocess, "run", return_value=missing):
            self.assertIsNone(MODULE._run_volume_inspect("x"))
        with patch.object(MODULE.subprocess, "run", return_value=daemon_error):
            with self.assertRaisesRegex(MODULE.VolumeContractError, "inspect failed"):
                MODULE._run_volume_inspect("x")


if __name__ == "__main__":
    unittest.main()
