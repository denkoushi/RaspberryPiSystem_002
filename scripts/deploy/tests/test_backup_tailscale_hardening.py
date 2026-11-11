from pathlib import Path
import shlex
import subprocess

from jinja2 import Environment
import pytest
import yaml


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"


def test_backup_archive_is_private_and_cleanup_is_always(tmp_path):
    play = yaml.safe_load((ANSIBLE / "playbooks/backup-client-directory.yml").read_text())[0]
    block = play["tasks"][1]
    archive, archive_failure, fetch, fetch_failure = block["block"]
    cleanup, = block["always"]
    assert archive_failure["when"] == "archive_result.failed | default(true)"
    assert fetch_failure["when"] == "fetch_result.failed | default(true)"
    assert cleanup["ansible.builtin.file"] == {
        "path": fetch["ansible.builtin.fetch"]["src"], "state": "absent"
    }
    assert fetch["ansible.builtin.fetch"]["dest"] == (
        "{{ backup_destination }}/{{ inventory_hostname }}_{{ client_dir_path | basename }}.tar.gz"
    )
    command = archive["ansible.builtin.shell"]
    assert command.startswith("umask 077 && tar ")
    environment = Environment()
    environment.filters.update(basename=lambda p: Path(p).name,
                               dirname=lambda p: str(Path(p).parent), quote=shlex.quote)
    source = tmp_path / "directory with spaces"
    source.mkdir()
    (source / "data").write_text("fixture")
    rendered = environment.from_string(command).render(
        inventory_hostname="fixture", client_dir_path=str(source)
    )
    archive_path = tmp_path / "archive.tar.gz"
    args = shlex.split(rendered)
    args[args.index("--file") + 1] = str(archive_path)
    # Run the rendered command with a test-local destination.
    command = "umask 077 && " + shlex.join(args[3:])
    subprocess.run(["/bin/sh", "-c", command], check=True)
    assert archive_path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("connected,key,expected", [
    (False, None, False), (False, "", False), (True, "fixture", False),
    (False, "fixture", True),
])
def test_tailscale_auth_file_tasks_keep_existing_conditions(connected, key, expected):
    tasks = yaml.safe_load((ANSIBLE / "roles/common/tasks/tailscale.yml").read_text())
    block = next(task for task in tasks if "always" in task)
    assert block["when"] == [
        "(tailscale_connected | default(false)) | bool == false",
        "tailscale_effective_auth_key | default('') | length > 0",
    ]
    environment = Environment()
    environment.filters["bool"] = bool
    variables = {"tailscale_connected": connected}
    if key is not None:
        variables["tailscale_effective_auth_key"] = key
    assert all(environment.compile_expression(condition)(**variables)
               for condition in block["when"]) == expected
    assert block["become"] is True
    assert block["no_log"] is True
    create, write, authenticate = block["block"]
    assert create["ansible.builtin.tempfile"]["state"] == "file"
    assert write["ansible.builtin.copy"] == {
        "content": "{{ tailscale_effective_auth_key }}",
        "dest": "{{ tailscale_auth_key_file.path }}",
        "owner": "root", "group": "root", "mode": "0600",
    }
    assert authenticate["ansible.builtin.command"] == (
        "tailscale up {{ tailscale_extra_args }} "
        "--auth-key=file:{{ tailscale_auth_key_file.path }}"
    )
    cleanup, = block["always"]
    assert cleanup["ansible.builtin.file"] == {
        "path": "{{ tailscale_auth_key_file.path }}", "state": "absent"
    }
    assert cleanup["when"] == "tailscale_auth_key_file.path is defined"
