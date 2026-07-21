#!/usr/bin/env python3
"""Regression checks for Pi4 agent changed-only Compose selection."""
from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CLIENT_TASKS = ROOT / "infrastructure/ansible/roles/client/tasks"
TALKPLAZA_INVENTORY = ROOT / "infrastructure/ansible/inventory-talkplaza.yml"


def task_block(text: str, name: str) -> str:
    marker = f"- name: {name}\n"
    start = text.index(marker)
    end = text.find("\n- name: ", start + len(marker))
    return text[start:] if end == -1 else text[start:end]


def require(fragment: str, text: str, context: str) -> None:
    if fragment not in text:
        raise AssertionError(f"{context} is missing {fragment!r}")


def assert_change_classification_is_staged() -> None:
    path = ROOT / "infrastructure/ansible/roles/common/tasks/main.yml"
    text = path.read_text(encoding="utf-8")
    image_task = "- name: Classify client agent image changes"
    runtime_task = "- name: Classify client agent runtime changes"
    image_start = text.index(image_task)
    runtime_start = text.index(runtime_task)
    if image_start >= runtime_start:
        raise AssertionError("agent image change classification must precede runtime classification")
    image_block = text[image_start:runtime_start]
    if (
        "nfc_agent_runtime_recreate_needed:" in image_block
        or "barcode_agent_runtime_recreate_needed:" in image_block
        or "torque_agent_runtime_recreate_needed:" in image_block
    ):
        raise AssertionError("runtime facts must not reference image facts in the same set_fact task")

    expected_patterns = (
        "^clients/nfc-agent/",
        "^clients/barcode-agent/",
        "^clients/torque-agent/",
        "^infrastructure/docker/Dockerfile\\.nfc-agent$",
        "^infrastructure/docker/Dockerfile\\.barcode-agent$",
        "^infrastructure/docker/Dockerfile\\.torque-agent$",
        "^infrastructure/docker/docker-compose\\.client\\.yml$",
        "nfc_agent_image_build_needed | bool",
        "barcode_agent_image_build_needed | bool",
        "torque_agent_image_build_needed | bool",
    )
    classification = text[image_start:]
    for pattern in expected_patterns:
        if pattern not in classification:
            raise AssertionError(f"client lifecycle classification is missing {pattern!r}")


def assert_repo_revision_is_readable_before_classification() -> None:
    path = ROOT / "infrastructure/ansible/roles/common/tasks/main.yml"
    text = path.read_text(encoding="utf-8")
    ownership_task = "- name: Fix .git directory ownership before reading the current revision"
    previous_head_task = "- name: Capture current repo HEAD for provisioning"
    sync_task = "- name: Sync repository for provisioning (with retries)"
    release_previous_head_task = "- name: Verify terminal repository is clean and capture current HEAD"
    release_sync_task = "- name: Fetch and reset existing terminal repository to immutable release"
    select_result_task = "- name: Select repository synchronization result"
    diff_task = "- name: Collect repo diff file list (for docker build decision)"
    if text.count(ownership_task) != 1:
        raise AssertionError("the pre-sync .git ownership task must occur exactly once")
    if not (
        text.index(ownership_task)
        < text.index(previous_head_task)
        < text.index(sync_task)
        < text.index(diff_task)
    ):
        raise AssertionError("the previous Git revision must be captured before sync and diff classification")
    if not (
        text.index(release_previous_head_task)
        < text.index(release_sync_task)
        < text.index(select_result_task)
        < text.index(diff_task)
    ):
        raise AssertionError("release-only must preserve its previous SHA before immutable reset")
    for register in (
        "register: repo_prev_head_full_result",
        "register: repo_prev_head_release_result",
        "register: repo_new_head_result",
    ):
        if register not in text:
            raise AssertionError(f"Git revision contract is missing {register}")
    if "repo_prev_head_result: >-" not in text:
        raise AssertionError("Git command results must remain distinct from normalized SHA facts")
    local_reset = task_block(
        text,
        "Verify incremental bundle and reset existing terminal repository without network",
    )
    require(
        "printf '%s\\n' \"${expected_previous}\"",
        local_reset,
        "Local previous SHA result",
    )
    selection = task_block(text, "Select repository synchronization result")
    require(
        "git_local_result\n        if terminal_release_transport | default('ssh-ansible') == 'local-artifact'",
        selection,
        "Local previous SHA selection",
    )
    require(
        'repo_prev_head: "{{ repo_prev_head_result.stdout | default(\'\') }}"',
        text,
        "previous SHA normalization",
    )
    require(
        'repo_new_head: "{{ repo_new_head_result.stdout | default(\'\') }}"',
        text,
        "new SHA normalization",
    )
    if 'git diff --name-only "{{ repo_prev_head }}" "{{ repo_new_head }}"' not in text:
        raise AssertionError("diff classification must consume the preserved pre-sync SHA")
    normalized_start = text.index("- name: Determine if repo changed")
    if "repo_prev_head.stdout" in text[normalized_start:] or "repo_new_head.stdout" in text[normalized_start:]:
        raise AssertionError("normalized SHA strings must not be dereferenced as command results")


def fact_body(text: str, fact: str) -> str:
    marker = f"    {fact}: >-\n"
    start = text.index(marker) + len(marker)
    body = []
    for line in text[start:].splitlines():
        if line.startswith("- name: ") or (
            line.startswith("    ") and not line.startswith("      ")
        ):
            break
        body.append(line)
    return "\n".join(body)


def fact_patterns(text: str, fact: str) -> tuple[str, ...]:
    patterns = tuple(
        re.findall(r"select\('match', '([^']+)'\)", fact_body(text, fact))
    )
    if not patterns:
        raise AssertionError(f"no path patterns found for {fact}")
    return patterns


def classify_paths(paths: list[str], *, unavailable: bool = False) -> dict[str, bool]:
    text = (ROOT / "infrastructure/ansible/roles/common/tasks/main.yml").read_text(
        encoding="utf-8"
    )

    def matched(fact: str) -> bool:
        return unavailable or any(
            re.match(pattern, path)
            for pattern in fact_patterns(text, fact)
            for path in paths
        )

    for fact in (
        "nfc_agent_image_build_needed",
        "barcode_agent_image_build_needed",
        "torque_agent_image_build_needed",
    ):
        if "repo_diff_unavailable | bool" not in fact_body(text, fact):
            raise AssertionError(f"{fact} must fail closed when the Git diff is unavailable")

    nfc_image = matched("nfc_agent_image_build_needed")
    barcode_image = matched("barcode_agent_image_build_needed")
    torque_image = matched("torque_agent_image_build_needed")
    return {
        "nfc_image": nfc_image,
        "barcode_image": barcode_image,
        "torque_image": torque_image,
        "nfc_recreate": nfc_image or matched("nfc_agent_runtime_recreate_needed"),
        "barcode_recreate": barcode_image
        or matched("barcode_agent_runtime_recreate_needed"),
        "torque_recreate": torque_image
        or matched("torque_agent_runtime_recreate_needed"),
    }


def compose_converge_needed(*, image: bool, recreate: bool, health_status: int) -> bool:
    """Mirror the fail-closed truth table used by every lifecycle task."""

    return image or recreate or health_status != 200


def assert_pre_sync_diff_fixture() -> None:
    common_tasks = (
        ROOT / "infrastructure/ansible/roles/common/tasks/main.yml"
    ).read_text(encoding="utf-8")
    diff_task = task_block(
        common_tasks, "Collect repo diff file list (for docker build decision)"
    )
    require("failed_when: false", diff_task, "Git diff collection")
    unavailable_task = task_block(
        common_tasks, "Determine if docker build is needed on server"
    )
    require(
        "(repo_diff_files_raw.rc | default(0)) != 0",
        unavailable_task,
        "unavailable Git diff classification",
    )

    with tempfile.TemporaryDirectory() as directory:
        repo = Path(directory)

        def git(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                ["git", "-C", str(repo), *arguments],
                check=check,
                text=True,
                capture_output=True,
            )

        git("init", "-q")
        git("config", "user.name", "PR6 lifecycle fixture")
        git("config", "user.email", "pr6-fixture@example.invalid")
        for relative in (
            "clients/nfc-agent/agent.py",
            "infrastructure/ansible/roles/client/tasks/barcode-agent.yml",
            "infrastructure/ansible/roles/client/tasks/torque-agent.yml",
            "docs/readme.md",
        ):
            path = repo / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("base\n", encoding="utf-8")
        git("add", ".")
        git("commit", "-qm", "base")
        previous_sha = git("rev-parse", "HEAD").stdout.strip()

        (repo / "clients/nfc-agent/agent.py").write_text("candidate\n", encoding="utf-8")
        (repo / "infrastructure/ansible/roles/client/tasks/barcode-agent.yml").write_text(
            "candidate\n", encoding="utf-8"
        )
        (repo / "infrastructure/ansible/roles/client/tasks/torque-agent.yml").write_text(
            "candidate\n", encoding="utf-8"
        )
        git("add", ".")
        git("commit", "-qm", "candidate")
        new_sha = git("rev-parse", "HEAD").stdout.strip()

        changed = git("diff", "--name-only", previous_sha, new_sha).stdout.splitlines()
        decision = classify_paths(changed)
        if decision != {
            "nfc_image": True,
            "barcode_image": False,
            "torque_image": False,
            "nfc_recreate": True,
            "barcode_recreate": True,
            "torque_recreate": True,
        }:
            raise AssertionError(f"unexpected lifecycle decision for preserved Git diff: {decision}")

        docs_only = classify_paths(["docs/readme.md"])
        if any(docs_only.values()):
            raise AssertionError(f"docs-only change must not rebuild client agents: {docs_only}")
        if compose_converge_needed(
            image=docs_only["nfc_image"],
            recreate=docs_only["nfc_recreate"],
            health_status=200,
        ):
            raise AssertionError("healthy unchanged agent must skip Docker Compose")
        if not compose_converge_needed(
            image=False, recreate=False, health_status=503
        ):
            raise AssertionError("unhealthy unchanged agent must converge Docker Compose")
        if not compose_converge_needed(
            image=True, recreate=False, health_status=200
        ):
            raise AssertionError("image change must converge Docker Compose")
        if not compose_converge_needed(
            image=False, recreate=True, health_status=200
        ):
            raise AssertionError("runtime/config change must converge Docker Compose")

        unavailable = git("diff", "--name-only", "f" * 40, new_sha, check=False)
        if unavailable.returncode == 0:
            raise AssertionError("fixture must prove unavailable Git diff")
        if not all(classify_paths([], unavailable=True).values()):
            raise AssertionError("unavailable diff must fail closed to rebuild/recreate both agents")


def assert_agent_scope_and_health_contracts() -> None:
    main = (CLIENT_TASKS / "main.yml").read_text(encoding="utf-8")
    expected = (
        (
            "Ensure nfc-agent is running (Pi4 kiosk)",
            "nfc-agent-lifecycle.yml",
            "nfc_agent_client_id is defined",
        ),
        (
            "Ensure barcode-agent is running (Pi4 kiosk, optional)",
            "barcode-agent-lifecycle.yml",
            "barcode_agent_enabled | default(false) | bool",
        ),
        (
            "Ensure torque-agent is running (assembly kiosk, optional)",
            "torque-agent-lifecycle.yml",
            "torque_agent_enabled | default(false) | bool",
        ),
    )
    for name, filename, condition in expected:
        include = task_block(main, name)
        require(f"ansible.builtin.include_tasks: {filename}", include, name)
        require(f"when: {condition}", include, name)

    for filename, environment_name, lifecycle_name, result in (
        (
            "nfc-agent.yml",
            "Deploy NFC agent environment variables",
            "Include NFC environment changes in lifecycle selection",
            "nfc_agent_env_result",
        ),
        (
            "barcode-agent.yml",
            "Deploy barcode agent environment variables",
            "Include barcode environment changes in lifecycle selection",
            "barcode_agent_env_result",
        ),
        (
            "torque-agent.yml",
            "Deploy torque-agent environment",
            "Include torque-agent environment changes in lifecycle selection",
            "torque_agent_env_result",
        ),
    ):
        text = (CLIENT_TASKS / filename).read_text(encoding="utf-8")
        environment = task_block(text, environment_name)
        if "terminal_release_mode" in environment:
            raise AssertionError(f"{filename} environment must remain release-reachable")
        if "notify:" in environment:
            raise AssertionError(
                f"{filename} environment must use the single lifecycle convergence path"
            )
        lifecycle_selection = task_block(text, lifecycle_name)
        require(f"{result}.changed", lifecycle_selection, f"{filename} environment lifecycle")

    for filename, agent, agent_variable, docker_register, health_path, status_register in (
        (
            "nfc-agent-lifecycle.yml",
            "nfc-agent",
            "nfc_agent",
            "docker_version_check",
            "/api/agent/status",
            "nfc_agent_status_check",
        ),
        (
            "barcode-agent-lifecycle.yml",
            "barcode-agent",
            "barcode_agent",
            "barcode_docker_version_check",
            "/api/agent/status",
            "barcode_agent_status_check",
        ),
        (
            "torque-agent-lifecycle.yml",
            "torque-agent",
            "torque_agent",
            "torque_docker_version_check",
            "/health",
            "torque_agent_status_check",
        ),
    ):
        text = (CLIENT_TASKS / filename).read_text(encoding="utf-8")
        docker_check = task_block(text, f"Ensure Docker is available for {agent}")
        require("ansible.builtin.command: docker --version", docker_check, agent)
        require(f"register: {docker_register}", docker_check, agent)
        docker_failure = task_block(
            text, f"Fail if Docker is not available ({agent} requires Docker)"
        )
        require("ansible.builtin.fail:", docker_failure, agent)
        require(f"when: {docker_register}.rc != 0", docker_failure, agent)
        pre_lifecycle_health = task_block(
            text, f"Probe {agent} health before conditional Compose convergence"
        )
        require(health_path, pre_lifecycle_health, agent)
        require(f"register: {agent_variable}_pre_lifecycle_health", pre_lifecycle_health, agent)
        require("status_code: [200]", pre_lifecycle_health, agent)
        require("changed_when: false", pre_lifecycle_health, agent)
        require("failed_when: false", pre_lifecycle_health, agent)
        selection = task_block(
            text, f"Determine whether {agent} Compose convergence is required"
        )
        require(f"{agent_variable}_image_build_needed | default(true) | bool", selection, agent)
        require(f"{agent_variable}_runtime_recreate_needed | default(true) | bool", selection, agent)
        require(f"{agent_variable}_pre_lifecycle_health.status", selection, agent)
        require("!= 200", selection, agent)
        require("changed_when: false", selection, agent)
        converge = task_block(
            text,
            f"Converge {agent} container when build, runtime, config, or health requires it",
        )
        require(f"when: {agent_variable}_compose_converge_needed | bool", converge, agent)
        require(f"register: {agent_variable}_up_result", converge, agent)
        require(
            f"changed_when: {agent_variable}_up_result.stdout_lines | last | default('') == 'true'",
            converge,
            agent,
        )
        require("compose_container_id()", converge, agent)
        require("container_state()", converge, agent)
        require("docker inspect --format", converge, agent)
        require("printf '%s\\n' \"${changed}\"", converge, agent)
        readiness = task_block(text, f"Wait for {agent} to become ready")
        require(health_path, readiness, agent)
        require("status_code: [200]", readiness, agent)
        require("retries: 5", readiness, agent)
        require(f"until: {status_register}.status == 200", readiness, agent)
        if "failed_when: false" in readiness:
            raise AssertionError(f"{agent} readiness must fail closed after retries")
        diagnostics = task_block(
            text, f"Capture docker compose ps for {agent} (diagnostics on failure)"
        )
        require("docker-compose.client.yml", diagnostics, agent)
        require("ps -a", diagnostics, agent)

    handlers = (ROOT / "infrastructure/ansible/roles/client/handlers/main.yml").read_text(
        encoding="utf-8"
    )
    reload_handler = task_block(
        handlers, "reload client systemd daemon after release unit change"
    )
    service_handler = task_block(
        handlers, "restart status-agent service after release configuration change"
    )
    timer_handler = task_block(
        handlers, "restart status-agent timer after release configuration change"
    )
    for handler, required in (
        (reload_handler, "daemon_reload: true"),
        (service_handler, "name: status-agent.service"),
        (timer_handler, "name: status-agent.timer"),
    ):
        require(
            "terminal_release_mode | default('full') == 'release-only'",
            handler,
            "changed-only release handler",
        )
        require(required, handler, "changed-only release handler")
    require("state: restarted", service_handler, "status-agent service handler")
    require("state: restarted", timer_handler, "status-agent timer handler")
    if not (
        handlers.index("- name: reload client systemd daemon")
        < handlers.index("- name: restart status-agent service")
        < handlers.index("- name: restart status-agent timer")
    ):
        raise AssertionError("systemd reload handler must precede targeted restart handlers")

    status_config = task_block(main, "Create status-agent configuration file")
    status_service = task_block(main, "Copy status-agent systemd service file")
    status_timer = task_block(main, "Copy status-agent systemd timer file")
    require(
        "notify: restart status-agent service after release configuration change",
        status_config,
        "status-agent configuration notification",
    )
    for task, restart in (
        (status_service, "restart status-agent service after release configuration change"),
        (status_timer, "restart status-agent timer after release configuration change"),
    ):
        require(
            "reload client systemd daemon after release unit change",
            task,
            "status-agent unit notification",
        )
        require(restart, task, "status-agent unit notification")
    legacy_restart = task_block(main, "Restart required services (clients) with retry")
    require(
        "terminal_release_mode | default('full') == 'full'",
        legacy_restart,
        "release-only restart suppression",
    )
    flush_handlers = task_block(
        main, "Apply changed-only release service handlers before health verification"
    )
    require("ansible.builtin.meta: flush_handlers", flush_handlers, "handler flush")
    if not (
        main.index("- name: Apply changed-only release service handlers before health verification")
        < main.index("- name: Verify restarted client services and timers are healthy")
    ):
        raise AssertionError("changed-only handlers must flush before universal health checks")

    health = task_block(main, "Verify restarted client services and timers are healthy")
    require("status-agent.service", health, "status-agent oneshot health")
    require(
        'systemctl show --property=Result --value "${unit}"',
        health,
        "status-agent oneshot health",
    )
    require('== "success"', health, "status-agent oneshot health")
    require(
        "select('match', '\\\\.(service|timer)$')",
        health,
        "client service and timer health",
    )
    if health.index('[[ "${unit}" == "status-agent.service" ]]') >= health.index(
        'systemctl is-active --quiet "${unit}"'
    ):
        raise AssertionError("status-agent.service must bypass is-active before the generic health gate")


def assert_talkplaza_kiosk_credential_binding() -> None:
    inventory = TALKPLAZA_INVENTORY.read_text(encoding="utf-8")
    kiosk_start = inventory.index("                talkplaza-pi4:\n")
    signage_start = inventory.index("                talkplaza-signage01:\n")
    kiosk = inventory[kiosk_start:signage_start]
    require(
        'kiosk_url: "{{ kiosk_full_url }}?clientKey={{ status_agent_client_key }}"',
        kiosk,
        "Talkplaza kiosk URL",
    )


def command_template(name: str) -> str:
    path = ROOT / "infrastructure/ansible/roles/client/tasks" / name
    text = path.read_text(encoding="utf-8")
    marker = '    cd "{{ repo_path }}"\n'
    start = text.index(marker) + len(marker)
    end = text.index("\n  args:", start)
    return text[start:end]


def command_branches(template: str, agent: str) -> tuple[str, str, str]:
    image_variable = f"{agent}_image_build_needed"
    runtime_variable = f"{agent}_runtime_recreate_needed"
    markers = (
        f"{{% if {image_variable} | default(true) %}}",
        f"{{% elif {runtime_variable} | default(true) %}}",
        "{% else %}",
        "{% endif %}",
    )
    positions = tuple(template.index(marker) for marker in markers)
    if positions != tuple(sorted(positions)):
        raise AssertionError(f"lifecycle branches are out of order for {agent}")

    def branch(start: int, marker: str, end: int) -> str:
        return template[start + len(marker):end].strip()

    return (
        branch(positions[0], markers[0], positions[1]),
        branch(positions[1], markers[1], positions[2]),
        branch(positions[2], markers[2], positions[3]),
    )


def assert_selection(
    branches: tuple[str, str, str], *, image: bool, recreate: bool, expected: str
) -> None:
    selected = branches[0] if image else branches[1] if recreate else branches[2]
    if expected not in selected:
        raise AssertionError(
            f"expected {expected!r} for image={image}, recreate={recreate}: {selected!r}"
        )


def main() -> None:
    assert_change_classification_is_staged()
    assert_repo_revision_is_readable_before_classification()
    assert_pre_sync_diff_fixture()
    assert_agent_scope_and_health_contracts()
    assert_talkplaza_kiosk_credential_binding()
    for filename, agent in (
        ("nfc-agent-lifecycle.yml", "nfc_agent"),
        ("barcode-agent-lifecycle.yml", "barcode_agent"),
        ("torque-agent-lifecycle.yml", "torque_agent"),
    ):
        template = command_template(filename)
        branches = command_branches(template, agent)
        assert_selection(branches, image=True, recreate=True, expected="up -d --build")
        assert_selection(
            branches,
            image=False,
            recreate=True,
            expected="up -d --force-recreate --no-build",
        )
        assert_selection(branches, image=False, recreate=False, expected="up -d --no-build")
    print("PASS: client agent lifecycle command selection")


if __name__ == "__main__":
    main()
