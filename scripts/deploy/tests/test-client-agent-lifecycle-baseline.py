#!/usr/bin/env python3
"""Baseline contracts for the current Pi4 client-agent lifecycle tasks.

PR 6 will extend these contracts when build/recreate/no-build selection is
introduced. This test deliberately describes only behavior present on main.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
TASKS = ROOT / "infrastructure/ansible/roles/client/tasks"


def task_block(text: str, name: str) -> str:
    marker = f"- name: {name}\n"
    start = text.index(marker)
    end = text.find("\n- name: ", start + len(marker))
    return text[start:] if end == -1 else text[start:end]


def require(fragment: str, text: str, context: str) -> None:
    if fragment not in text:
        raise AssertionError(f"{context} is missing {fragment!r}")


def check_agent(
    filename: str,
    agent: str,
    docker_register: str,
    compose_command: str,
    include_name: str,
    include_condition: str,
) -> None:
    role_tasks = (TASKS / "main.yml").read_text(encoding="utf-8")
    include = task_block(role_tasks, include_name)
    require(f"ansible.builtin.include_tasks: {filename}", include, agent)
    require(f"when: {include_condition}", include, agent)

    text = (TASKS / filename).read_text(encoding="utf-8")

    docker_check = task_block(text, f"Ensure Docker is available for {agent}")
    require("ansible.builtin.command: docker --version", docker_check, agent)
    require(f"register: {docker_register}", docker_check, agent)

    docker_failure = task_block(
        text, f"Fail if Docker is not available ({agent} requires Docker)"
    )
    require("ansible.builtin.fail:", docker_failure, agent)
    require(f"when: {docker_register}.rc != 0", docker_failure, agent)

    container_start = task_block(text, f"Ensure {agent} container is up")
    require("set -euo pipefail", container_start, agent)
    require(compose_command, container_start, agent)

    readiness = task_block(text, f"Wait for {agent} to become ready")
    require("/api/agent/status", readiness, agent)
    require("status_code: [200]", readiness, agent)
    require("retries: 5", readiness, agent)
    require(
        f"until: {agent.replace('-', '_')}_status_check.status == 200",
        readiness,
        agent,
    )

    diagnostics = task_block(
        text, f"Capture docker compose ps for {agent} (diagnostics on failure)"
    )
    require("docker-compose.client.yml ps -a", diagnostics, agent)


def main() -> None:
    check_agent(
        "nfc-agent-lifecycle.yml",
        "nfc-agent",
        "docker_version_check",
        "docker compose -f infrastructure/docker/docker-compose.client.yml "
        "up -d --build nfc-agent",
        "Ensure nfc-agent is running (Pi4 kiosk)",
        "nfc_agent_client_id is defined",
    )
    check_agent(
        "barcode-agent-lifecycle.yml",
        "barcode-agent",
        "barcode_docker_version_check",
        "docker compose -f infrastructure/docker/docker-compose.client.yml "
        "--profile barcode up -d --build barcode-agent",
        "Ensure barcode-agent is running (Pi4 kiosk, optional)",
        "barcode_agent_enabled | default(false) | bool",
    )
    print("PASS: current client-agent lifecycle baseline")


if __name__ == "__main__":
    main()
