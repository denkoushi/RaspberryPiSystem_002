#!/usr/bin/env python3
"""Materialize the external durable volumes used by the Pi5 phase3 release.

The server Compose file is the canonical declaration for the local bind
driver and host-side device.  phase3 is only allowed to consume the same
named volumes.  This module deliberately has no delete or update path:
missing volumes are created, matching volumes are left alone, and a
different existing volume is a hard, non-destructive failure.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


class VolumeContractError(RuntimeError):
    """The phase3/server volume contract cannot be satisfied safely."""


@dataclass(frozen=True)
class VolumeSpec:
    name: str
    driver: str
    options: Mapping[str, str]


def _compose_config(argv: Sequence[str], env: Mapping[str, str]) -> dict[str, Any]:
    result = subprocess.run(
        [*argv, "config", "--format", "json"],
        env=dict(env),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        # Compose output may contain environment-derived secrets.  Keep the
        # operator-facing error bounded to the command and exit status.
        raise VolumeContractError(
            f"docker compose config failed for volume contract (exit {result.returncode})"
        )
    try:
        model = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise VolumeContractError("docker compose config returned invalid JSON") from exc
    if not isinstance(model, dict):
        raise VolumeContractError("docker compose config returned a non-object model")
    return model


def _volume_entries(model: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    volumes = model.get("volumes")
    if not isinstance(volumes, dict):
        raise VolumeContractError("Compose model has no volumes map")
    entries: list[Mapping[str, Any]] = []
    for key, value in volumes.items():
        if not isinstance(value, dict):
            raise VolumeContractError(f"Compose volume {key!r} is not an object")
        entries.append(value)
    return entries


def required_volume_specs(
    phase3_model: Mapping[str, Any], server_model: Mapping[str, Any]
) -> list[VolumeSpec]:
    """Resolve every phase3 external volume against one server definition."""

    phase3_volumes = phase3_model.get("volumes")
    if not isinstance(phase3_volumes, dict):
        raise VolumeContractError("phase3 Compose model has no volumes map")
    server_entries = _volume_entries(server_model)
    specs: list[VolumeSpec] = []
    seen_names: set[str] = set()
    for key, phase3_value in phase3_volumes.items():
        if not isinstance(phase3_value, dict) or phase3_value.get("external") is not True:
            continue
        name = phase3_value.get("name")
        if not isinstance(name, str) or not name:
            raise VolumeContractError(f"phase3 external volume {key!r} has no resolved name")
        if name in seen_names:
            raise VolumeContractError(f"phase3 declares external volume {name!r} more than once")
        seen_names.add(name)
        matches = [entry for entry in server_entries if entry.get("name") == name]
        if len(matches) != 1:
            raise VolumeContractError(
                f"phase3 external volume {name!r} must have exactly one server Compose definition"
            )
        canonical = matches[0]
        driver = canonical.get("driver", "local")
        options = canonical.get("driver_opts")
        if driver != "local" or not isinstance(options, dict):
            raise VolumeContractError(
                f"server Compose volume {name!r} must use the local driver with bind options"
            )
        normalized_options = {
            option: options.get(option, "")
            for option in ("type", "o", "device")
        }
        if normalized_options != {
            "type": "none",
            "o": "bind",
            "device": normalized_options["device"],
        }:
            raise VolumeContractError(
                f"server Compose volume {name!r} must use type=none,o=bind,device"
            )
        device = normalized_options["device"]
        if not isinstance(device, str) or not device.startswith("/"):
            raise VolumeContractError(
                f"server Compose volume {name!r} has an unresolved bind device"
            )
        specs.append(VolumeSpec(name=name, driver=driver, options=normalized_options))
    if not specs:
        raise VolumeContractError("phase3 declares no external durable volumes")
    return specs


def _normalize_inspection(value: Mapping[str, Any]) -> tuple[str, dict[str, str]]:
    driver = value.get("Driver")
    options = value.get("Options")
    if not isinstance(driver, str) or not isinstance(options, dict):
        raise VolumeContractError("docker volume inspect returned an invalid volume")
    return driver, {
        option: options.get(option, "")
        for option in ("type", "o", "device")
    }


def assert_matching_volume(spec: VolumeSpec, inspection: Mapping[str, Any]) -> None:
    actual_driver, actual_options = _normalize_inspection(inspection)
    expected_options = dict(spec.options)
    if actual_driver != spec.driver or actual_options != expected_options:
        raise VolumeContractError(
            f"existing volume {spec.name!r} does not match the server Compose contract; "
            "refusing to delete or overwrite it"
        )


def reconcile_volume(
    spec: VolumeSpec,
    inspect: Callable[[str], Mapping[str, Any] | None],
    create: Callable[[VolumeSpec], None],
) -> bool:
    """Create a missing volume or verify an existing one; return changed."""

    current = inspect(spec.name)
    if current is None:
        create(spec)
        current = inspect(spec.name)
        if current is None:
            raise VolumeContractError(f"created volume {spec.name!r} cannot be inspected")
        assert_matching_volume(spec, current)
        return True
    assert_matching_volume(spec, current)
    return False


def reconcile_volumes(
    specs: Sequence[VolumeSpec],
    inspect: Callable[[str], Mapping[str, Any] | None],
    create: Callable[[VolumeSpec], None],
    backing_directory_exists: Callable[[VolumeSpec], bool],
) -> list[str]:
    """Validate the full set before creating any missing volume."""

    inspections: list[tuple[VolumeSpec, Mapping[str, Any] | None]] = [
        (spec, inspect(spec.name)) for spec in specs
    ]
    for spec, inspection in inspections:
        if inspection is not None:
            assert_matching_volume(spec, inspection)
        elif not backing_directory_exists(spec):
            raise VolumeContractError(
                f"backing directory {spec.options['device']!r} for volume {spec.name!r} is missing; "
                "run the server role directory preparation before the release"
            )
    created: list[str] = []
    for spec, inspection in inspections:
        if inspection is None:
            create(spec)
            created_inspection = inspect(spec.name)
            if created_inspection is None:
                raise VolumeContractError(f"created volume {spec.name!r} cannot be inspected")
            assert_matching_volume(spec, created_inspection)
            created.append(spec.name)
    return created


def _run_volume_inspect(name: str) -> Mapping[str, Any] | None:
    result = subprocess.run(
        ["docker", "volume", "inspect", "--format", "{{json .}}", name],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        if re.search(r":\s*no such volume(?:\s|$)", result.stderr.strip().lower()):
            return None
        raise VolumeContractError(f"docker volume inspect failed for {name!r}")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise VolumeContractError(f"docker volume inspect returned invalid JSON for {name!r}") from exc
    if not isinstance(value, dict):
        raise VolumeContractError(f"docker volume inspect returned an invalid object for {name!r}")
    return value


def _create_volume(spec: VolumeSpec) -> None:
    device = spec.options["device"]
    if not Path(device).is_dir():
        raise VolumeContractError(
            f"backing directory {device!r} for volume {spec.name!r} is missing; "
            "run the server role directory preparation before the release"
        )
    result = subprocess.run(
        [
            "docker",
            "volume",
            "create",
            "--driver",
            spec.driver,
            "--opt",
            f"type={spec.options['type']}",
            "--opt",
            f"o={spec.options['o']}",
            "--opt",
            f"device={device}",
            spec.name,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise VolumeContractError(f"docker volume create failed for {spec.name!r}")


def materialize(
    *,
    server_compose: Sequence[str],
    phase3_compose: Sequence[str],
    env: Mapping[str, str] | None = None,
) -> list[str]:
    environment = dict(os.environ if env is None else env)
    phase3_model = _compose_config(phase3_compose, environment)
    server_model = _compose_config(server_compose, environment)
    specs = required_volume_specs(phase3_model, server_model)
    return reconcile_volumes(
        specs,
        _run_volume_inspect,
        _create_volume,
        lambda spec: Path(spec.options["device"]).is_dir(),
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-compose", required=True)
    parser.add_argument("--phase3-compose", required=True)
    parser.add_argument("--env-file", required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    env = dict(os.environ)
    env["PI5_ENV_FILE"] = args.env_file
    server_compose = ["docker", "compose", "--env-file", args.env_file, "-f", args.server_compose]
    phase3_compose = ["docker", "compose", "--env-file", args.env_file, "-f", args.phase3_compose]
    created = materialize(server_compose=server_compose, phase3_compose=phase3_compose, env=env)
    for name in created:
        print(f"created volume {name}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except VolumeContractError as exc:
        print(f"Pi5 external volume contract failed: {exc}", file=os.sys.stderr)
        raise SystemExit(78)
