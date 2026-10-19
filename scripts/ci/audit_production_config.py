#!/usr/bin/env python3
"""Audit production configuration consumers against their real runtime path."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.deploy.production_config_contract import (  # noqa: E402
    ALL_VITE_KEYS,
    ConfigKind,
    PRODUCTION_WEB_SETTINGS,
    ProductionConfigError,
    WEB_IMAGE_DEFAULTS,
    WEB_IMAGE_ARGUMENT_KEYS,
    render_typescript_image_defaults,
    validate_exact_keys,
)


KEY_ASSIGNMENT = re.compile(r"^([A-Z][A-Z0-9_]*)=", re.MULTILINE)
VITE_ASSIGNMENT = re.compile(r"^(VITE_[A-Z0-9_]*)=", re.MULTILINE)
COMPOSE_VITE_ARGUMENT = re.compile(r"^\s{8}(VITE_[A-Z0-9_]+):", re.MULTILINE)
COMPOSE_VITE_DEFAULT = re.compile(
    r"^\s{8}(VITE_[A-Z0-9_]+):\s+\$\{(VITE_[A-Z0-9_]+):-([^}]*)\}$",
    re.MULTILINE,
)
COMPOSE_API_ENVIRONMENT = re.compile(r"^\s{6}([A-Z][A-Z0-9_]*):", re.MULTILINE)
DOCKERFILE_ARGUMENT = re.compile(r"^ARG (VITE_[A-Z0-9_]+)(?:=|$)", re.MULTILINE)
DOCKERFILE_ARGUMENT_DEFAULT = re.compile(
    r"^ARG (VITE_[A-Z0-9_]+)=(.*)$", re.MULTILINE
)
DOCKERFILE_ENVIRONMENT = re.compile(r"^ENV (VITE_[A-Z0-9_]+)=", re.MULTILINE)
JSON_VITE_KEY = re.compile(r'"(VITE_[A-Z0-9_]+)"\s*:')
JINJA_VITE_DEFAULT = re.compile(
    r'^\s*"?(VITE_[A-Z0-9_]+)"?\s*(?:=|:)\s*\{\{\s*'
    r"([a-z][a-z0-9_]*)\s*\|\s*default\('([^']*)'\)",
    re.MULTILINE,
)
ANSIBLE_WEB_VARIABLE = re.compile(r"^(web_[a-z0-9_]+):", re.MULTILINE)
TYPED_WEB_REFERENCE = re.compile(r"\benv\.(VITE_[A-Z0-9_]+)\b")
DIRECT_WEB_ENV_ACCESS = re.compile(r"\bimport\.meta\.env\b")


API_ENV_COMPATIBILITY_EXCEPTIONS = {
    "KIOSK_DOCUMENT_NDLOCR_CLI": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_NDLOCR_PYTHON": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_NDLOCR_SCRIPT": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_OCR_BATCH_SIZE": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_OCR_COMMAND": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_OCR_CRON": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_OCR_ENGINE_TIMEOUT_MS": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_OCR_LEGACY_STDOUT": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_OCR_RASTER_DPI": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_OCR_RASTER_TIMEOUT_MS": "legacy host-side OCR compatibility",
    "KIOSK_DOCUMENT_PROCESS_TIMEOUT_MS": "legacy host-side OCR compatibility",
    "NODE_ENV": "Dockerfile fixes production mode independently",
    "SIGNAGE_RENDER_HEIGHT": "legacy host-side signage renderer compatibility",
    "SIGNAGE_RENDER_INTERVAL_SECONDS": "legacy host-side signage renderer compatibility",
    "SIGNAGE_RENDER_WIDTH": "legacy host-side signage renderer compatibility",
    "SIGNAGE_TIMEZONE": "legacy host-side signage renderer compatibility",
}


def _read(root: Path, relative: str) -> str:
    return (root / relative).read_text(encoding="utf-8")


def _unique_mapping(
    surface: str, pairs: Iterable[tuple[str, str]]
) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in pairs:
        if key in result:
            raise ProductionConfigError(f"{surface} contains duplicate Vite settings")
        result[key] = value
    return result


def validate_surface_defaults(
    surface: str, actual: dict[str, str], expected: dict[str, str]
) -> None:
    validate_exact_keys(surface, actual, expected)
    mismatched = {
        key: {"actual": actual[key], "expected": expected[key]}
        for key in expected
        if actual[key] != expected[key]
    }
    if mismatched:
        raise ProductionConfigError(
            f"{surface} has production default drift: {mismatched}"
        )


def _jinja_defaults(surface: str, text: str) -> tuple[dict[str, str], dict[str, str]]:
    values: list[tuple[str, str]] = []
    sources: list[tuple[str, str]] = []
    for key, variable, default in JINJA_VITE_DEFAULT.findall(text):
        values.append((key, default))
        sources.append((key, variable))
    return (
        _unique_mapping(f"{surface} defaults", values),
        _unique_mapping(f"{surface} sources", sources),
    )


def _application_source_files(root: Path) -> Iterable[Path]:
    source = root / "apps/web/src"
    for path in source.rglob("*"):
        if not path.is_file() or path.suffix not in {".ts", ".tsx"}:
            continue
        if path.name.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
            continue
        if "__tests__" in path.parts:
            continue
        yield path


def audit_web_contract(root: Path = ROOT) -> None:
    adapter = root / "apps/web/src/config/productionBuildConfig.ts"
    adapter_text = adapter.read_text(encoding="utf-8")
    generated_defaults = (
        root / "apps/web/src/config/productionBuildDefaults.generated.ts"
    )
    if (
        generated_defaults.read_text(encoding="utf-8")
        != render_typescript_image_defaults()
    ):
        raise ProductionConfigError(
            "generated browser production defaults drifted from the typed registry"
        )
    validate_exact_keys(
        "typed Web environment adapter",
        TYPED_WEB_REFERENCE.findall(adapter_text),
        ALL_VITE_KEYS,
    )

    direct: list[str] = []
    for path in _application_source_files(root):
        if path == adapter:
            continue
        if DIRECT_WEB_ENV_ACCESS.search(path.read_text(encoding="utf-8")):
            direct.append(str(path.relative_to(root)))
    if direct:
        raise ProductionConfigError(
            f"direct import.meta.env reads are forbidden outside the typed adapter: {sorted(set(direct))}"
        )

    image_only = tuple(
        setting.key
        for setting in PRODUCTION_WEB_SETTINGS
        if setting.kind is ConfigKind.IMAGE
    )
    generated = tuple(
        setting.key
        for setting in PRODUCTION_WEB_SETTINGS
        if setting.kind is ConfigKind.GENERATED
    )
    docker_env = _read(root, "infrastructure/ansible/templates/docker.env.j2")
    web_env = _read(root, "infrastructure/ansible/templates/web.env.j2")
    compose = _read(root, "infrastructure/docker/docker-compose.server.yml")
    dockerfile = _read(root, "infrastructure/docker/Dockerfile.web")
    release_template = _read(
        root, "infrastructure/ansible/templates/release-build-contract.json.j2"
    )
    expected_image_defaults = {
        key: str(value) for key, value in WEB_IMAGE_DEFAULTS.items()
    }
    expected_signed_defaults = {
        **expected_image_defaults,
        "VITE_RELEASE_SHA": "",
    }

    validate_exact_keys(
        "Ansible docker.env Web values",
        VITE_ASSIGNMENT.findall(docker_env),
        image_only,
    )
    validate_exact_keys(
        "compatibility web.env Web values",
        VITE_ASSIGNMENT.findall(web_env),
        image_only,
    )
    validate_exact_keys(
        "Compose Web build arguments",
        COMPOSE_VITE_ARGUMENT.findall(compose),
        WEB_IMAGE_ARGUMENT_KEYS,
    )
    validate_exact_keys(
        "Dockerfile Web ARG values",
        DOCKERFILE_ARGUMENT.findall(dockerfile),
        WEB_IMAGE_ARGUMENT_KEYS,
    )
    validate_exact_keys(
        "Dockerfile Web ENV values",
        DOCKERFILE_ENVIRONMENT.findall(dockerfile),
        image_only,
    )
    validate_exact_keys(
        "signed release Web values",
        JSON_VITE_KEY.findall(release_template),
        WEB_IMAGE_ARGUMENT_KEYS,
    )
    docker_env_defaults, docker_env_sources = _jinja_defaults(
        "Ansible docker.env Web values", docker_env
    )
    web_env_defaults, web_env_sources = _jinja_defaults(
        "compatibility web.env Web values", web_env
    )
    release_defaults, release_sources = _jinja_defaults(
        "signed release Web values", release_template
    )
    for surface, defaults in (
        ("Ansible docker.env Web defaults", docker_env_defaults),
        ("compatibility web.env Web defaults", web_env_defaults),
        ("signed release Web defaults", release_defaults),
    ):
        validate_surface_defaults(surface, defaults, expected_image_defaults)
    expected_sources = {
        setting.key: str(setting.ansible_variable)
        for setting in PRODUCTION_WEB_SETTINGS
        if setting.kind is ConfigKind.IMAGE
    }
    for surface, sources in (
        ("Ansible docker.env Web sources", docker_env_sources),
        ("compatibility web.env Web sources", web_env_sources),
        ("signed release Web sources", release_sources),
    ):
        validate_surface_defaults(surface, sources, expected_sources)

    compose_defaults: list[tuple[str, str]] = []
    for key, referenced_key, default in COMPOSE_VITE_DEFAULT.findall(compose):
        if key != referenced_key:
            raise ProductionConfigError(
                f"Compose Web build argument {key} reads {referenced_key}"
            )
        compose_defaults.append((key, default))
    validate_surface_defaults(
        "Compose Web build defaults",
        _unique_mapping("Compose Web build defaults", compose_defaults),
        expected_signed_defaults,
    )
    validate_surface_defaults(
        "Dockerfile Web ARG defaults",
        _unique_mapping(
            "Dockerfile Web ARG defaults",
            DOCKERFILE_ARGUMENT_DEFAULT.findall(dockerfile),
        ),
        expected_signed_defaults,
    )
    if len(generated) != 1 or generated[0] != "VITE_RELEASE_SHA":
        raise ProductionConfigError("release SHA must be the sole generated Web value")

    group_vars = _read(root, "infrastructure/ansible/group_vars/server/web-build.yml")
    validate_exact_keys(
        "Ansible Web source variables",
        ANSIBLE_WEB_VARIABLE.findall(group_vars),
        expected_sources.values(),
    )
    for setting in PRODUCTION_WEB_SETTINGS:
        if setting.kind is not ConfigKind.IMAGE or setting.ansible_variable is None:
            continue
        declaration = re.compile(
            rf"^{re.escape(setting.ansible_variable)}:\s+\"([^\r\n]*)\"$",
            re.MULTILINE,
        )
        matches = declaration.findall(group_vars)
        if len(matches) != 1:
            raise ProductionConfigError(
                f"Ansible Web source must define {setting.ansible_variable} exactly once"
            )
        if matches[0] != setting.production_default:
            raise ProductionConfigError(
                f"Ansible Web source default drifted for {setting.key}"
            )


def audit_api_environment(root: Path = ROOT) -> None:
    api_env = set(
        KEY_ASSIGNMENT.findall(
            _read(root, "infrastructure/ansible/templates/api.env.j2")
        )
    )
    effective = set(
        KEY_ASSIGNMENT.findall(_read(root, "apps/api/.env.example"))
    )
    effective.update(
        KEY_ASSIGNMENT.findall(
            _read(root, "infrastructure/ansible/templates/docker.env.j2")
        )
    )
    compose_api = _read(root, "infrastructure/docker/docker-compose.server.yml").split(
        "\n  web:", 1
    )[0]
    effective.update(COMPOSE_API_ENVIRONMENT.findall(compose_api))
    compatibility_only = api_env - effective
    expected = set(API_ENV_COMPATIBILITY_EXCEPTIONS)
    if compatibility_only != expected:
        raise ProductionConfigError(
            "api.env compatibility exceptions drifted; "
            f"missing reasons={sorted(compatibility_only - expected)}, "
            f"obsolete reasons={sorted(expected - compatibility_only)}"
        )

    configured_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for base in (
            root / "infrastructure/ansible/group_vars",
            root / "infrastructure/ansible/host_vars",
        )
        for path in base.rglob("*.yml")
    ) + _read(root, "infrastructure/ansible/inventory.yml")
    template = _read(root, "infrastructure/ansible/templates/api.env.j2")
    for key in sorted(compatibility_only):
        match = re.search(
            rf"^{re.escape(key)}=\{{{{\s*([a-z0-9_]+)", template, re.MULTILINE
        )
        if not match:
            raise ProductionConfigError(
                f"cannot identify the Ansible variable for API compatibility key {key}"
            )
        variable = match.group(1)
        if re.search(rf"^\s*{re.escape(variable)}\s*:", configured_sources, re.MULTILINE):
            raise ProductionConfigError(
                f"{variable} configures non-effective api.env key {key}; route it through docker.env/Compose first"
            )


def audit_repository(root: Path = ROOT) -> None:
    audit_web_contract(root)
    audit_api_environment(root)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    audit_repository(args.root.resolve())
    print("production configuration contract: OK")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ProductionConfigError as error:
        print(f"production configuration contract failed: {error}", file=sys.stderr)
        raise SystemExit(78) from error
