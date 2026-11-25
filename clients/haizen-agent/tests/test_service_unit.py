"""haizen-agent の systemd ユニットと配布タスクの実行ユーザー設定を検証する。"""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
UNIT = ROOT / "clients/haizen-agent/haizen-agent.service"
TASKS = ROOT / "infrastructure/ansible/roles/client/tasks/haizen-agent.yml"


def service_section() -> dict[str, str]:
    values: dict[str, str] = {}
    in_service = False
    for line in UNIT.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("["):
            in_service = line == "[Service]"
        elif in_service and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key, value)
    return values


def test_unit_runs_as_dedicated_user_with_restrictions() -> None:
    service = service_section()
    assert service["User"] == "raspi-haizen"
    assert service["Group"] == "raspi-haizen"
    assert service["SupplementaryGroups"] == "input"
    assert service["ExecStart"] == "/usr/bin/python3 -m haizen_agent"
    assert service["NoNewPrivileges"] == "yes"
    assert service["PrivateTmp"] == "yes"
    assert service["ProtectSystem"] == "strict"
    assert service["ProtectHome"] == "yes"


def test_tasks_create_user_before_config_owned_by_its_group() -> None:
    tasks = yaml.safe_load(TASKS.read_text(encoding="utf-8"))
    names = [task["name"] for task in tasks]
    group = tasks[names.index("Ensure haizen-agent group exists")]["ansible.builtin.group"]
    user = tasks[names.index("Ensure haizen-agent user exists")]["ansible.builtin.user"]
    config = tasks[names.index("Create haizen-agent configuration file")]["ansible.builtin.template"]
    assert names.index("Ensure haizen-agent user exists") < names.index("Create haizen-agent configuration file")
    assert group["name"] == user["name"] == user["group"] == "raspi-haizen"
    assert user["groups"] == "input" and user["append"] is True and user["system"] is True
    assert config["owner"] == "root" and config["group"] == "raspi-haizen" and config["mode"] == "0640"
