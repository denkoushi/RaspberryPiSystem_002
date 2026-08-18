#!/usr/bin/env python3
"""Classify a git name-status stream for staged CI execution.

The classifier is intentionally independent from git and GitHub Actions. It
accepts the NUL-delimited output of ``git diff --name-status -z`` on stdin and
prints JSON, a Markdown summary, or GitHub Actions outputs. Unknown inputs and
changes that can hide removed build dependencies select the full suite.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Iterable, Sequence


CATEGORIES = (
    "repo_policy",
    "workspace_quality",
    "api",
    "web",
    "db_infra",
    "deploy_contract",
    "client",
    "e2e",
    "kiosk_sop",
    "docker_security",
    "signage_artifact",
)
FULL_SUITE = frozenset(CATEGORIES)
DOCKER_MATRIX_ITEMS = {
    "api": {
        "image": "api",
        "dockerfile": "./infrastructure/docker/Dockerfile.api",
        "tag": "raspisys-api:ci",
    },
    "web": {
        "image": "web",
        "dockerfile": "./infrastructure/docker/Dockerfile.web",
        "tag": "raspisys-web:ci",
    },
}

GLOBAL_PATHS = frozenset(
    {
        ".dockerignore",
        ".gitleaks.toml",
        ".trivyignore",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.base.json",
        "turbo.json",
    }
)


@dataclass(frozen=True)
class Change:
    status: str
    path: str
    previous_path: str | None = None


@dataclass(frozen=True)
class ClassifiedChange:
    change: Change
    categories: frozenset[str]
    codeql: bool
    docker_images: frozenset[str]
    pi4_agent_services: frozenset[str]
    release_pair: bool
    runtime_rehearsal: bool
    torque_composition: bool
    fail_closed_reason: str | None = None


@dataclass(frozen=True)
class Pi4AgentArtifact:
    service: str
    dockerfile: str
    owned_prefixes: tuple[str, ...]


PI4_AGENT_ARTIFACTS = (
    Pi4AgentArtifact(
        service="nfc-agent",
        dockerfile="infrastructure/docker/Dockerfile.nfc-agent",
        owned_prefixes=("clients/nfc-agent",),
    ),
    Pi4AgentArtifact(
        service="barcode-agent",
        dockerfile="infrastructure/docker/Dockerfile.barcode-agent",
        owned_prefixes=("clients/barcode-agent",),
    ),
    Pi4AgentArtifact(
        service="torque-agent",
        dockerfile="infrastructure/docker/Dockerfile.torque-agent",
        owned_prefixes=("clients/torque-agent",),
    ),
)
PI4_AGENT_PLATFORMS = (
    ("linux/arm64", "linux-arm64"),
    ("linux/arm/v7", "linux-arm-v7"),
)
PI4_AGENT_SERVICE_NAMES = frozenset(
    artifact.service for artifact in PI4_AGENT_ARTIFACTS
)
PI4_AGENT_DOCKERFILES = frozenset(
    artifact.dockerfile for artifact in PI4_AGENT_ARTIFACTS
)
PI4_AGENT_SHARED_INPUTS = frozenset({".dockerignore", ".trivyignore"})
POLICY_PATHS = frozenset({".gitleaksignore"})
PI4_AGENT_NON_BUILD_GLOBAL_PATHS = frozenset(
    {
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "scripts/ci/pnpm-exact.sh",
        "scripts/ci/run-deploy-contracts-local.sh",
        "scripts/ci/run-pnpm-bulk-audit.mjs",
        "scripts/ci/wait_for_release_checks.py",
        "scripts/ci/tests/test_release_image_workflow.py",
        "scripts/ci/tests/test_staged_ci_workflow.py",
    }
)
CI_CLASSIFIER_CONTRACT_PATHS = frozenset(
    {
        "scripts/ci/classify_changes.py",
        "scripts/ci/classify_event_changes.py",
        "scripts/ci/tests/test_classify_changes.py",
        "scripts/ci/tests/test_classify_event_changes.py",
    }
)
COMPLETE_FLEET_ARTIFACT_PATHS = CI_CLASSIFIER_CONTRACT_PATHS | frozenset(
    {
        "scripts/deploy/standard-ansible-release.py",
        "scripts/update-all-clients.sh",
    }
)
SIGNAGE_RELEASE_CONTROL_PREFIX = "infrastructure/ansible/roles/release_signage"
SIGNAGE_ARTIFACT_TEMPLATE_PREFIX = "infrastructure/ansible/roles/signage/templates"
SIGNAGE_RELEASE_ONLY_PATHS = frozenset(
    {
        "scripts/deploy/signage-runtime-proof.py",
        "scripts/deploy/tests/test_signage_runtime_proof.py",
        "scripts/deploy/tests/test-signage-deploy-maintenance.sh",
    }
)
DEPLOY_CONTRACT_ONLY_PATHS = frozenset(
    {"scripts/deploy/tests/test_ansible_standard_release.py"}
)
TORQUE_COMPOSITION_PATHS = frozenset(
    {
        ".github/workflows/torque-release.yml",
        "scripts/deploy/release_artifact_contract.py",
        "scripts/deploy/torque_component_adoption.py",
        "scripts/deploy/standard-ansible-release.py",
        "scripts/update-all-clients.sh",
        "infrastructure/ansible/playbooks/deploy-release-standard.yml",
        "infrastructure/ansible/inventory.yml",
        "infrastructure/docker/Dockerfile.torque-agent",
    }
)
TORQUE_COMPOSITION_PREFIXES = (
    "packages/shared-types/src/torque-wrenches",
    "apps/api/src/routes/torque-wrenches",
    "apps/api/src/routes/torque-training",
    "apps/api/src/services/torque-wrenches",
    "apps/api/src/services/torque-training",
    "apps/web/src/features/torque-wrench-connection",
    "clients/torque-agent",
    "infrastructure/ansible/roles/release_pi5",
    "infrastructure/ansible/roles/release_kiosk",
    "infrastructure/ansible/roles/release_torque_cutover",
)


def _has_prefix(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(f"{prefix}/")


def _normalize_path(path: str) -> str:
    return PurePosixPath(path).as_posix().removeprefix("./")


def requires_complete_fleet_artifacts(path: str) -> bool:
    """Return whether main must publish one exact-SHA artifact set for every profile."""
    return _normalize_path(path) in COMPLETE_FLEET_ARTIFACT_PATHS


def pi4_agent_services_for_path(path: str) -> frozenset[str]:
    """Return Pi4 image contracts owning a repository path."""
    normalized = _normalize_path(path)
    if normalized == ".github/workflows/torque-release.yml":
        return frozenset({"torque-agent"})
    if normalized in PI4_AGENT_SHARED_INPUTS:
        return PI4_AGENT_SERVICE_NAMES

    return frozenset(
        artifact.service
        for artifact in PI4_AGENT_ARTIFACTS
        if normalized == artifact.dockerfile
        or any(_has_prefix(normalized, prefix) for prefix in artifact.owned_prefixes)
    )


def pi4_agent_matrix_for_services(
    services: Iterable[str],
) -> list[dict[str, str]]:
    selected = set(services)
    matrix: list[dict[str, str]] = []
    for artifact in PI4_AGENT_ARTIFACTS:
        if artifact.service not in selected:
            continue
        for platform, platform_tag in PI4_AGENT_PLATFORMS:
            matrix.append(
                {
                    "service": artifact.service,
                    "image": f"raspisys-{artifact.service}-contract",
                    "dockerfile": artifact.dockerfile,
                    "platform": platform,
                    "platform_tag": platform_tag,
                }
            )
    return matrix


def _base_categories_for_path(path: str) -> frozenset[str] | None:
    """Return categories for a known path, or ``None`` for an unknown path."""
    normalized = _normalize_path(path)

    if normalized == ".github/workflows/torque-release.yml":
        return frozenset({"repo_policy", "deploy_contract"})
    if normalized == ".husky/pre-commit":
        return frozenset({"repo_policy", "workspace_quality"})
    if normalized.startswith(".github/workflows/") or normalized.startswith(
        ".github/actions/"
    ):
        return FULL_SUITE
    if normalized in CI_CLASSIFIER_CONTRACT_PATHS:
        return frozenset({"repo_policy"})
    if normalized == "scripts/deploy/production_config_contract.py":
        return frozenset(
            {"repo_policy", "web", "deploy_contract", "docker_security"}
        )
    if _has_prefix(normalized, "scripts/ci"):
        return FULL_SUITE
    if normalized in GLOBAL_PATHS:
        return FULL_SUITE

    if normalized in POLICY_PATHS:
        return frozenset({"repo_policy"})

    if _has_prefix(normalized, ".cursor/rules"):
        return frozenset({"repo_policy"})

    if normalized.startswith("scripts/test/verify-signage"):
        return frozenset({"repo_policy"})

    if normalized == "docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html":
        return frozenset({"repo_policy", "kiosk_sop"})
    if normalized == ".github/BRANCH_PROTECTION_SETUP.md" or _has_prefix(
        normalized, "docs"
    ) or (
        "/" not in normalized and normalized.lower().endswith(".md")
    ):
        return frozenset({"repo_policy"})

    if _has_prefix(normalized, "apps/api/prisma"):
        return frozenset({"repo_policy", "workspace_quality", "api", "db_infra"})
    if _has_prefix(normalized, "apps/api"):
        return frozenset({"repo_policy", "workspace_quality", "api"})
    if _has_prefix(normalized, "apps/web"):
        return frozenset({"repo_policy", "workspace_quality", "web", "kiosk_sop"})
    if _has_prefix(normalized, "packages"):
        return frozenset({"repo_policy", "workspace_quality", "api", "web", "kiosk_sop"})

    if _has_prefix(normalized, "scripts/kiosk-sop"):
        return frozenset({"repo_policy", "kiosk_sop"})

    if _has_prefix(normalized, "clients") or _has_prefix(normalized, "scripts/client"):
        return frozenset({"repo_policy", "client"})
    if _has_prefix(normalized, "scripts/kiosk"):
        return frozenset({"repo_policy", "client"})

    if normalized in {
        "scripts/deploy/production_config_contract.py",
        "infrastructure/ansible/group_vars/server/web-build.yml",
        "infrastructure/ansible/templates/docker.env.j2",
        "infrastructure/ansible/templates/web.env.j2",
    }:
        return frozenset(
            {"repo_policy", "web", "deploy_contract", "docker_security"}
        )
    if (
        normalized in SIGNAGE_RELEASE_ONLY_PATHS
        or _has_prefix(normalized, SIGNAGE_ARTIFACT_TEMPLATE_PREFIX)
        or _has_prefix(normalized, SIGNAGE_RELEASE_CONTROL_PREFIX)
    ):
        return frozenset({"repo_policy", "deploy_contract"})
    if _has_prefix(normalized, "infrastructure/ansible"):
        return frozenset({"repo_policy", "db_infra", "deploy_contract"})
    if _has_prefix(normalized, "scripts/deploy") or normalized == "scripts/update-all-clients.sh":
        return frozenset({"repo_policy", "deploy_contract"})
    if _has_prefix(normalized, "scripts/server"):
        return frozenset({"repo_policy", "db_infra", "deploy_contract"})

    if normalized == "infrastructure/docker/Dockerfile.kiosk-sop-generator":
        return frozenset({"repo_policy", "kiosk_sop", "docker_security"})
    if normalized in PI4_AGENT_DOCKERFILES:
        return frozenset({"repo_policy", "client", "docker_security"})
    if normalized == "infrastructure/docker/Dockerfile.web" or (
        _has_prefix(normalized, "infrastructure/docker")
        and PurePosixPath(normalized).name.startswith("Caddyfile")
    ):
        return frozenset(
            {"repo_policy", "web", "deploy_contract", "docker_security"}
        )
    if normalized == "infrastructure/docker/maintenance.html":
        return frozenset(
            {"repo_policy", "web", "deploy_contract", "docker_security"}
        )
    if _has_prefix(normalized, "infrastructure/docker"):
        return frozenset({"repo_policy", "db_infra", "docker_security"})
    if normalized in {
        "e2e/inspection-drawing-sop-popup.spec.ts",
        "playwright.kiosk-sop.config.ts",
    }:
        return frozenset({"repo_policy", "e2e", "kiosk_sop"})
    if _has_prefix(normalized, "e2e") or normalized == "playwright.config.ts":
        return frozenset({"repo_policy", "e2e"})

    return None


def signage_artifact_for_path(path: str) -> bool:
    """Return whether a path changes the complete Pi3 Signage artifact."""
    normalized = _normalize_path(path)
    return (
        normalized.startswith("scripts/test/verify-signage")
        or normalized
        in {
            "clients/status-agent/status-agent.py",
            "clients/status-agent/storage_health.py",
            "clients/status-agent/terminal_agent_health.py",
            "clients/status-agent/status-agent.service",
            "clients/status-agent/status-agent.timer",
            "scripts/deploy/rolling_release/terminal_device_maintenance.py",
            "scripts/deploy/terminal-profile-registry.json",
            "scripts/deploy/signage-release-artifact.py",
            "scripts/deploy/signage-distribution-artifact.py",
            "scripts/deploy/tests/test_signage_distribution_artifact.py",
            "scripts/deploy/rolling_release/signage_artifact_stage.py",
            "scripts/deploy/tests/test_signage_artifact_stage.py",
            "infrastructure/docker/Dockerfile.signage-release",
        }
        or normalized in SIGNAGE_RELEASE_ONLY_PATHS
        or _has_prefix(normalized, SIGNAGE_ARTIFACT_TEMPLATE_PREFIX)
        or _has_prefix(normalized, SIGNAGE_RELEASE_CONTROL_PREFIX)
    )


def _signage_artifact_exclusive_path(path: str) -> bool:
    normalized = _normalize_path(path)
    return signage_artifact_for_path(normalized) and normalized not in {
        "scripts/deploy/rolling_release/terminal_device_maintenance.py",
        "scripts/deploy/terminal-profile-registry.json",
    }


def categories_for_path(path: str) -> frozenset[str] | None:
    categories = _base_categories_for_path(path)
    if categories is None or categories == FULL_SUITE:
        return categories
    if signage_artifact_for_path(path):
        return categories | {"signage_artifact"}
    return categories


def codeql_for_path(path: str) -> bool:
    """Return whether a known path can change JavaScript/TypeScript analysis."""
    normalized = _normalize_path(path)
    if normalized == ".github/workflows/torque-release.yml":
        return False
    return (
        _has_prefix(normalized, "apps/api")
        or _has_prefix(normalized, "apps/web")
        or _has_prefix(normalized, "packages")
        or _has_prefix(normalized, "e2e")
        or normalized in {"playwright.config.ts", "playwright.kiosk-sop.config.ts"}
        or normalized in {
            "package.json",
            "pnpm-lock.yaml",
            "pnpm-workspace.yaml",
            "tsconfig.base.json",
            "turbo.json",
        }
        or normalized.startswith(".github/workflows/")
        or normalized.startswith(".github/actions/")
        or _has_prefix(normalized, "scripts/ci")
    )


def docker_images_for_path(path: str) -> frozenset[str]:
    """Return Docker images whose filesystem may change for a known path."""
    normalized = _normalize_path(path)
    if normalized == ".github/workflows/torque-release.yml":
        return frozenset()
    if normalized in PI4_AGENT_DOCKERFILES:
        return frozenset()
    if _signage_artifact_exclusive_path(normalized):
        return frozenset()
    if normalized in {
        "scripts/deploy/production_config_contract.py",
        "infrastructure/ansible/group_vars/server/web-build.yml",
        "infrastructure/ansible/templates/docker.env.j2",
        "infrastructure/ansible/templates/web.env.j2",
        "infrastructure/docker/Dockerfile.web",
        "infrastructure/docker/maintenance.html",
    } or (
        _has_prefix(normalized, "infrastructure/docker")
        and PurePosixPath(normalized).name.startswith("Caddyfile")
    ):
        return frozenset({"web"})
    if normalized == "infrastructure/docker/Dockerfile.api":
        return frozenset({"api"})
    if _has_prefix(normalized, "infrastructure/docker") or normalized in GLOBAL_PATHS:
        return frozenset({"api", "web"})
    if normalized.startswith(".github/workflows/") or normalized.startswith(
        ".github/actions/"
    ):
        return frozenset({"api", "web"})
    if _has_prefix(normalized, "scripts/ci"):
        return frozenset({"api", "web"})
    return frozenset()


def release_pair_for_path(path: str) -> bool:
    """Return whether the exact main SHA needs a production ARM64 image pair.

    This follows Docker build-context ownership, not test-job ownership. The
    API image copies the repository ``scripts`` tree, while the Web image
    embeds generated SOP artifacts under ``apps/web``.
    """

    normalized = _normalize_path(path)
    if normalized == ".github/workflows/torque-release.yml":
        return False
    if normalized in DEPLOY_CONTRACT_ONLY_PATHS:
        return False
    if normalized == "infrastructure/docker/Dockerfile.torque-agent" or _has_prefix(
        normalized, "clients/torque-agent"
    ):
        # A new torque composition still needs an API/Web pair for its exact,
        # rehearsal-bound three-component tuple. Unrelated Pi4 agents remain
        # independent of the normal v1 release pair.
        return True
    if normalized in PI4_AGENT_DOCKERFILES:
        return False
    if _signage_artifact_exclusive_path(normalized):
        return False
    if normalized in GLOBAL_PATHS:
        return True
    if any(
        _has_prefix(normalized, prefix)
        for prefix in (
            "apps/api",
            "apps/web",
            "packages",
            "scripts",
            "infrastructure/ansible",
            "infrastructure/docker",
        )
    ):
        return True
    if normalized.startswith(".github/workflows/") or normalized.startswith(
        ".github/actions/"
    ):
        return True
    return False


def torque_composition_for_path(path: str) -> bool:
    """Return whether a change requires a newly verified torque v2 composition."""
    normalized = _normalize_path(path)
    return normalized in TORQUE_COMPOSITION_PATHS or any(
        _has_prefix(normalized, prefix) for prefix in TORQUE_COMPOSITION_PREFIXES
    )


def classify_change(change: Change) -> ClassifiedChange:
    status_kind = change.status[:1]
    if status_kind in {"D", "R", "C"}:
        return ClassifiedChange(
            change=change,
            categories=FULL_SUITE,
            codeql=True,
            docker_images=frozenset({"api", "web"}),
            pi4_agent_services=PI4_AGENT_SERVICE_NAMES,
            release_pair=True,
            runtime_rehearsal=True,
            torque_composition=True,
            fail_closed_reason=f"{status_kind.lower()} change requires the full suite",
        )
    if status_kind not in {"A", "M"}:
        return ClassifiedChange(
            change=change,
            categories=FULL_SUITE,
            codeql=True,
            docker_images=frozenset({"api", "web"}),
            pi4_agent_services=PI4_AGENT_SERVICE_NAMES,
            release_pair=True,
            runtime_rehearsal=True,
            torque_composition=True,
            fail_closed_reason=f"unsupported git status {change.status!r}",
        )

    categories = categories_for_path(change.path)
    if categories is None:
        return ClassifiedChange(
            change=change,
            categories=FULL_SUITE,
            codeql=True,
            docker_images=frozenset({"api", "web"}),
            pi4_agent_services=PI4_AGENT_SERVICE_NAMES,
            release_pair=True,
            runtime_rehearsal=True,
            torque_composition=True,
            fail_closed_reason=f"unknown path {change.path!r}",
        )
    if categories == FULL_SUITE:
        pi4_services = (
            pi4_agent_services_for_path(change.path)
            if _normalize_path(change.path) in PI4_AGENT_NON_BUILD_GLOBAL_PATHS
            else PI4_AGENT_SERVICE_NAMES
        )
        return ClassifiedChange(
            change=change,
            categories=categories,
            codeql=True,
            docker_images=frozenset({"api", "web"}),
            pi4_agent_services=pi4_services,
            release_pair=True,
            runtime_rehearsal=True,
            torque_composition=torque_composition_for_path(change.path),
            fail_closed_reason=f"global CI configuration path {change.path!r}",
        )
    release_pair = release_pair_for_path(change.path)
    return ClassifiedChange(
        change=change,
        categories=categories,
        codeql=codeql_for_path(change.path),
        docker_images=docker_images_for_path(change.path),
        pi4_agent_services=pi4_agent_services_for_path(change.path),
        release_pair=release_pair,
        runtime_rehearsal=(
            release_pair
            and _normalize_path(change.path) not in CI_CLASSIFIER_CONTRACT_PATHS
        ),
        torque_composition=torque_composition_for_path(change.path),
    )


def classify_changes(
    changes: Iterable[Change], *, force_full_reason: str | None = None
) -> dict[str, object]:
    classified = [classify_change(change) for change in changes]
    selected: set[str] = set()
    codeql = False
    docker_images: set[str] = set()
    pi4_agent_services: set[str] = set()
    release_pair = False
    runtime_rehearsal = False
    torque_composition = False
    reasons: list[str] = []
    for item in classified:
        selected.update(item.categories)
        codeql = codeql or item.codeql
        docker_images.update(item.docker_images)
        pi4_agent_services.update(item.pi4_agent_services)
        release_pair = release_pair or item.release_pair
        runtime_rehearsal = runtime_rehearsal or item.runtime_rehearsal
        torque_composition = torque_composition or item.torque_composition
        if item.fail_closed_reason:
            reasons.append(item.fail_closed_reason)

    if force_full_reason:
        selected.update(FULL_SUITE)
        codeql = True
        docker_images.update({"api", "web"})
        pi4_agent_services.update(PI4_AGENT_SERVICE_NAMES)
        release_pair = True
        runtime_rehearsal = True
        torque_composition = True
        reasons.append(force_full_reason)

    matrix_images = sorted(docker_images) or ["api", "web"]
    return {
        "schemaVersion": 6,
        "mode": "enforced",
        "fileCount": len(classified),
        "fullSuite": selected == set(FULL_SUITE),
        "codeql": codeql,
        "dockerApi": "api" in docker_images,
        "dockerWeb": "web" in docker_images,
        "releasePair": release_pair,
        "runtimeRehearsal": runtime_rehearsal,
        "torqueComposition": torque_composition,
        "pi4AgentMatrix": pi4_agent_matrix_for_services(pi4_agent_services),
        "dockerMatrix": [DOCKER_MATRIX_ITEMS[image] for image in matrix_images],
        "categories": {category: category in selected for category in CATEGORIES},
        "failClosedReasons": reasons,
        "changes": [
            {
                "status": item.change.status,
                "path": item.change.path,
                **(
                    {"previousPath": item.change.previous_path}
                    if item.change.previous_path
                    else {}
                ),
                "categories": sorted(item.categories),
                "codeql": item.codeql,
                "dockerImages": sorted(item.docker_images),
                "pi4AgentServices": sorted(item.pi4_agent_services),
                "releasePair": item.release_pair,
                "runtimeRehearsal": item.runtime_rehearsal,
                "torqueComposition": item.torque_composition,
                **(
                    {"failClosedReason": item.fail_closed_reason}
                    if item.fail_closed_reason
                    else {}
                ),
            }
            for item in classified
        ],
    }


def parse_name_status_z(data: bytes) -> list[Change]:
    fields = data.decode("utf-8", "surrogateescape").split("\0")
    if fields and fields[-1] == "":
        fields.pop()

    changes: list[Change] = []
    index = 0
    while index < len(fields):
        status = fields[index]
        index += 1
        if not status:
            raise ValueError("empty git status")
        if status[:1] in {"R", "C"}:
            if index + 1 >= len(fields):
                raise ValueError(f"missing paths for git status {status!r}")
            previous_path, path = fields[index], fields[index + 1]
            index += 2
            changes.append(Change(status=status, path=path, previous_path=previous_path))
        else:
            if index >= len(fields):
                raise ValueError(f"missing path for git status {status!r}")
            changes.append(Change(status=status, path=fields[index]))
            index += 1
    return changes


def render_markdown(result: dict[str, object]) -> str:
    categories = result["categories"]
    assert isinstance(categories, dict)
    reasons = result["failClosedReasons"]
    assert isinstance(reasons, list)

    lines = [
        "## Change classification (enforced)",
        "",
        "Selected categories control which pull-request jobs run. Full-suite events ignore path minimization.",
        "",
        f"Changed files: **{result['fileCount']}**  ",
        f"Full suite classification: **{'yes' if result['fullSuite'] else 'no'}**",
        f"CodeQL analysis: **{'yes' if result['codeql'] else 'no'}**  ",
        f"Docker API image: **{'yes' if result['dockerApi'] else 'no'}**  ",
        f"Docker Web image: **{'yes' if result['dockerWeb'] else 'no'}**",
        f"Pi4 agent image contracts: **{len(result['pi4AgentMatrix'])}**",
        f"ARM64 release pair: **{'yes' if result['releasePair'] else 'no'}**",
        f"Isolated runtime rehearsal: **{'yes' if result['runtimeRehearsal'] else 'no'}**",
        f"Torque v2 composition: **{'yes' if result['torqueComposition'] else 'no'}**",
        "",
        "| Category | Selected |",
        "| --- | --- |",
    ]
    lines.extend(
        f"| `{category}` | {'yes' if categories[category] else 'no'} |"
        for category in CATEGORIES
    )
    if reasons:
        lines.extend(["", "Fail-closed reasons:"])
        lines.extend(f"- {reason}" for reason in reasons)
    return "\n".join(lines) + "\n"


def render_github_output(result: dict[str, object]) -> str:
    """Render stable lowercase booleans for ``GITHUB_OUTPUT``."""
    categories = result["categories"]
    assert isinstance(categories, dict)
    lines = [
        f"{category}={'true' if categories[category] else 'false'}"
        for category in CATEGORIES
    ]
    lines.append(f"full_suite={'true' if result['fullSuite'] else 'false'}")
    lines.append(f"codeql={'true' if result['codeql'] else 'false'}")
    lines.append(f"docker_api={'true' if result['dockerApi'] else 'false'}")
    lines.append(f"docker_web={'true' if result['dockerWeb'] else 'false'}")
    lines.append(f"release_pair={'true' if result['releasePair'] else 'false'}")
    lines.append(
        f"runtime_rehearsal={'true' if result['runtimeRehearsal'] else 'false'}"
    )
    lines.append(
        f"torque_composition={'true' if result['torqueComposition'] else 'false'}"
    )
    lines.append(
        "docker_matrix="
        + json.dumps(result["dockerMatrix"], separators=(",", ":"), sort_keys=True)
    )
    lines.append(
        "pi4_agent_matrix="
        + json.dumps(
            result["pi4AgentMatrix"], separators=(",", ":"), sort_keys=True
        )
    )
    return "\n".join(lines) + "\n"


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--format",
        choices=("json", "markdown", "github-output"),
        default="json",
    )
    parser.add_argument(
        "--force-full-reason",
        help="Select every category when no stable diff base is available.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        changes = parse_name_status_z(sys.stdin.buffer.read())
    except ValueError as error:
        print(f"invalid git name-status input: {error}", file=sys.stderr)
        return 2
    result = classify_changes(changes, force_full_reason=args.force_full_reason)
    if args.format == "markdown":
        sys.stdout.write(render_markdown(result))
    elif args.format == "github-output":
        sys.stdout.write(render_github_output(result))
    else:
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
