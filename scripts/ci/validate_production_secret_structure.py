#!/usr/bin/env python3
"""Reject new credential-shaped plaintext without ever printing its value."""

from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


SECRET_NAME = re.compile(
    r"(?:password|passwd|secret|token|api_?key|client_?key|private_?key|refresh_?key|pin)",
    re.IGNORECASE,
)
YAML_SCALAR = re.compile(r"^\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*):\s*(?P<value>.*?)\s*$")
SHELL_ASSIGNMENT = re.compile(
    r"^\s*(?:export\s+)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)=(?P<value>.*?)\s*$"
)
QUOTED_ASSIGNMENT = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?::|=)\s*(['\"])(?P<value>.*?)\2"
)
QUOTED_FALLBACK = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=.*?(?:\?\?|\|\|)\s*(['\"])(?P<value>.*?)\2"
)

NORMAL_FACTORY_VAULT_PATHS = (
    "infrastructure/ansible/host_vars/raspberrypi3/vault.yml",
    "infrastructure/ansible/host_vars/raspberrypi4/vault.yml",
    "infrastructure/ansible/host_vars/raspberrypi5/vault.yml",
    "infrastructure/ansible/host_vars/raspi4-robodrill01/vault.yml",
    "infrastructure/ansible/host_vars/raspi4-fjv60-80/vault.yml",
    "infrastructure/ansible/host_vars/raspi4-kensaku-stonebase01/vault.yml",
    "infrastructure/ansible/host_vars/raspi4-sessaku-01/vault.yml",
    "infrastructure/ansible/host_vars/raspi4-assembly-01/vault.yml",
)
REQUIRED_INVENTORY_REFERENCES = {
    "raspberrypi5": {
        "api_jwt_access_secret": "vault_api_jwt_access_secret",
        "api_jwt_refresh_secret": "vault_api_jwt_refresh_secret",
        "status_agent_client_key": "vault_status_agent_client_key",
    },
    "raspberrypi4": {
        "status_agent_client_key": "vault_status_agent_client_key",
        "nfc_agent_client_secret": "vault_nfc_agent_client_secret",
    },
    "raspi4-robodrill01": {
        "status_agent_client_key": "vault_raspi4_robodrill01_status_agent_client_key",
        "nfc_agent_client_secret": "vault_raspi4_robodrill01_nfc_agent_client_secret",
    },
    "raspi4-fjv60-80": {
        "status_agent_client_key": "vault_raspi4_fjv60_80_status_agent_client_key",
        "nfc_agent_client_secret": "vault_raspi4_fjv60_80_nfc_agent_client_secret",
    },
    "raspi4-kensaku-stonebase01": {
        "status_agent_client_key": "vault_raspi4_kensaku_stonebase01_status_agent_client_key",
        "nfc_agent_client_secret": "vault_raspi4_kensaku_stonebase01_nfc_agent_client_secret",
        "torque_agent_client_key": "vault_raspi4_kensaku_stonebase01_torque_agent_client_key",
    },
    "raspi4-sessaku-01": {
        "status_agent_client_key": "vault_raspi4_sessaku_01_status_agent_client_key",
        "nfc_agent_client_secret": "vault_raspi4_sessaku_01_nfc_agent_client_secret",
    },
    "raspi4-assembly-01": {
        "status_agent_client_key": "vault_raspi4_assembly_01_status_agent_client_key",
        "nfc_agent_client_secret": "vault_raspi4_assembly_01_nfc_agent_client_secret",
        "torque_agent_client_key": "vault_raspi4_assembly_01_torque_agent_client_key",
    },
    "raspberrypi3": {
        "status_agent_client_key": "vault_status_agent_client_key",
        "signage_client_key": "vault_signage_client_key",
    },
}
ANSIBLE_VAULT_HEADER = b"$ANSIBLE_VAULT;"


@dataclass(frozen=True, order=True)
class Finding:
    path: str
    identifier: str
    syntax: str


def is_external_or_empty(value: str) -> bool:
    normalized = value.strip().rstrip(",")
    if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in {"'", '"'}:
        normalized = normalized[1:-1].strip()
    return (
        not normalized
        or normalized in {"null", "None", "~", "''", '\"\"'}
        or normalized.lower() in {"true", "false", "yes", "no"}
        or normalized.isdigit()
        or normalized in {">", ">-", "|", "|-"}
        or "{{" in normalized
        or "lookup(" in normalized
        or "process.env" in normalized
        or "import.meta.env" in normalized
        or normalized.startswith("env.")
        or normalized.startswith("!vault")
        or normalized.startswith("$(")
        or normalized.startswith("`")
        or normalized.startswith("${") and normalized.endswith("}") and ":-" not in normalized
        or normalized.startswith("${") and normalized.endswith(":-}")
    )


def is_secret_identifier(identifier: str) -> bool:
    normalized = identifier.lower()
    if normalized.endswith(("_file", "_path", "_authentication", "_max_tokens", "_max_tokens_cap")):
        return False
    return SECRET_NAME.search(identifier) is not None


def candidate_paths(root: Path) -> list[Path]:
    paths: set[Path] = set()
    ansible = root / "infrastructure/ansible"
    if ansible.exists():
        paths.update(path for path in ansible.rglob("*") if path.is_file() and path.suffix in {".yml", ".yaml", ".j2"})
    docker = root / "infrastructure/docker"
    if docker.exists():
        paths.update(
            path
            for path in docker.rglob("*")
            if path.is_file()
            and (path.suffix in {".yml", ".yaml", ".j2", ".env"} or path.name.startswith("Dockerfile"))
        )
    for relative in (
        "apps/api/prisma/seed.ts",
        "apps/api/src/config/seed-credentials.ts",
        "apps/web/src/config/productionBuildConfig.ts",
        "apps/web/src/lib/client-key/config.ts",
        "scripts/register-clients.sh",
    ):
        path = root / relative
        if path.exists():
            paths.add(path)
    if (root / ".git").exists():
        tracked = {
            root / item.decode("utf-8")
            for item in subprocess.run(
                ["git", "ls-files", "-z"],
                cwd=root,
                check=True,
                stdout=subprocess.PIPE,
            ).stdout.split(b"\0")
            if item
        }
        paths.intersection_update(tracked)
    return sorted(paths)


def scan_file(root: Path, path: Path) -> list[Finding]:
    relative = path.relative_to(root).as_posix()
    findings: list[Finding] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.lstrip()
        if not stripped or stripped.startswith(("#", "//")):
            continue
        for syntax, pattern in (
            ("yaml-scalar", YAML_SCALAR),
            ("shell-assignment", SHELL_ASSIGNMENT),
            ("quoted-assignment", QUOTED_ASSIGNMENT),
            ("quoted-fallback", QUOTED_FALLBACK),
        ):
            match = pattern.search(line)
            if not match:
                continue
            identifier = match.group("name")
            value = match.group("value")
            if is_secret_identifier(identifier) and not is_external_or_empty(value):
                findings.append(Finding(relative, identifier, syntax))
            break
    return findings


def scan(root: Path) -> collections.Counter[Finding]:
    findings: collections.Counter[Finding] = collections.Counter()
    for path in candidate_paths(root):
        findings.update(scan_file(root, path))
    return findings


def load_allowance(path: Path) -> dict[Finding, int]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schemaVersion") != 1 or not isinstance(document.get("allowedPlaintext"), list):
        raise ValueError(f"{path}: unsupported production secret baseline schema")
    allowance: dict[Finding, int] = {}
    for item in document["allowedPlaintext"]:
        if not isinstance(item, dict):
            raise ValueError(f"{path}: allowance entries must be objects")
        finding = Finding(str(item.get("path", "")), str(item.get("identifier", "")), str(item.get("syntax", "")))
        count = item.get("count")
        reason = item.get("reason")
        if not all((finding.path, finding.identifier, finding.syntax)) or not isinstance(count, int) or count < 1:
            raise ValueError(f"{path}: allowance entry is incomplete")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(f"{path}: allowance reason is required")
        if finding in allowance:
            raise ValueError(f"{path}: duplicate allowance for {finding.path}:{finding.identifier}:{finding.syntax}")
        allowance[finding] = count
    return allowance


def validate(root: Path, baseline: Path) -> list[str]:
    allowance = load_allowance(baseline)
    errors: list[str] = []
    for finding, count in sorted(scan(root).items()):
        allowed = allowance.get(finding, 0)
        if count > allowed:
            errors.append(
                f"{finding.path}: {finding.identifier} ({finding.syntax}) has {count - allowed} new plaintext occurrence(s)"
            )
    return errors


def git_tracked_paths(root: Path) -> set[str]:
    if not (root / ".git").exists():
        return set()
    output = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=root,
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    return {item.decode("utf-8") for item in output.split(b"\0") if item}


def inventory_assignments(
    text: str,
    relevant_hosts: set[str] | None = None,
) -> dict[tuple[str, str], str]:
    assignments: dict[tuple[str, str], str] = {}
    current_host: str | None = None
    current_indent = -1
    host_pattern = re.compile(r"^(?P<indent>\s+)(?P<host>[A-Za-z0-9_.-]+):\s*(?:#.*)?$")
    property_pattern = re.compile(
        r"^(?P<indent>\s+)(?P<name>[A-Za-z_][A-Za-z0-9_]*):\s*(?P<value>.*?)\s*$"
    )
    selected_hosts = relevant_hosts or set(REQUIRED_INVENTORY_REFERENCES)
    for line in text.splitlines():
        host_match = host_pattern.match(line)
        if host_match:
            candidate = host_match.group("host")
            indent = len(host_match.group("indent"))
            if candidate in selected_hosts:
                current_host = candidate
                current_indent = indent
            elif current_host is not None and indent <= current_indent:
                current_host = None
                current_indent = -1
        property_match = property_pattern.match(line)
        if (
            current_host is not None
            and property_match
            and len(property_match.group("indent")) == current_indent + 2
        ):
            assignments[(current_host, property_match.group("name"))] = property_match.group("value")
    return assignments


def is_exact_vault_reference(value: str, identifier: str) -> bool:
    normalized = value.strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in {"'", '"'}:
        normalized = normalized[1:-1].strip()
    return normalized == f"{{{{ {identifier} }}}}"


def validate_normal_factory_vault_contract(
    root: Path,
    *,
    vault_paths: tuple[str, ...] = NORMAL_FACTORY_VAULT_PATHS,
    required_references: dict[str, dict[str, str]] = REQUIRED_INVENTORY_REFERENCES,
    tracked_paths: set[str] | None = None,
) -> list[str]:
    errors: list[str] = []
    tracked = git_tracked_paths(root) if tracked_paths is None else tracked_paths
    for relative in vault_paths:
        path = root / relative
        if relative not in tracked:
            errors.append(f"{relative}: normal-factory Vault ciphertext must be tracked")
            continue
        if not path.is_file() or path.is_symlink():
            errors.append(f"{relative}: normal-factory Vault must be a regular file")
            continue
        if not path.read_bytes().startswith(ANSIBLE_VAULT_HEADER):
            errors.append(f"{relative}: normal-factory Vault must be Ansible Vault ciphertext")

    vault_password_path = "infrastructure/ansible/.vault-pass"
    if vault_password_path in tracked:
        errors.append(f"{vault_password_path}: Vault password must never be tracked")

    inventory = root / "infrastructure/ansible/inventory.yml"
    if not inventory.is_file():
        errors.append("infrastructure/ansible/inventory.yml: required inventory is missing")
        return errors
    assignments = inventory_assignments(
        inventory.read_text(encoding="utf-8"),
        set(required_references),
    )
    for host, expected in required_references.items():
        for name, reference in expected.items():
            value = assignments.get((host, name))
            if value is None:
                errors.append(f"infrastructure/ansible/inventory.yml: {host}.{name} is missing")
            elif not is_exact_vault_reference(value, reference):
                errors.append(
                    f"infrastructure/ansible/inventory.yml: {host}.{name} must use required Vault reference {reference}"
                )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--list-findings", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.list_findings:
        for finding, count in sorted(scan(root).items()):
            print(f"{finding.path}|{finding.identifier}|{finding.syntax}|{count}")
        return 0
    baseline = args.baseline or root / "security/production-secret-baseline.json"
    try:
        errors = validate(root, baseline)
        errors.extend(validate_normal_factory_vault_contract(root))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        errors = [str(error)]
    if errors:
        for error in errors:
            print(f"production-secret structure error: {error}")
        return 1
    print("Production secret structure matches the redacted baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
