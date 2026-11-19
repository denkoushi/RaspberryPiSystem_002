from pathlib import Path
import re

import yaml


ROLES = Path(__file__).resolve().parents[3] / "infrastructure/ansible/roles"


def test_pi4_kiosk_usb_audio_profile_policy():
    kiosk = ROLES / "kiosk"
    config_name = "50-kiosk-usb-audio-input.conf"
    config = (kiosk / "files" / config_name).read_text()
    assert config.startswith("#")
    assert re.search(r"^device\.profile\.priority\.rules\s*=\s*\[", config, re.MULTILINE)
    usb_pattern = re.search(r'device\.name\s*=\s*"~([^"]+)"', config).group(1)
    assert re.fullmatch(usb_pattern, "alsa_card.usb-JMTek_USB_PnP_Audio_Device-00")
    assert not re.fullmatch(usb_pattern, "alsa_card.platform-hdmi")
    assert not re.fullmatch(usb_pattern, "alsa_cardXusb-Device")

    priorities = re.search(r"priorities\s*=\s*\[([^\]]+)\]", config).group(1)
    assert re.findall(r'"([^"]+)"', priorities) == [
        "output:analog-stereo+input:analog-stereo",
        "output:analog-stereo+input:mono-fallback",
        "output:analog-stereo+input:analog-mono",
        "output:mono-fallback+input:mono-fallback",
        "output:analog-mono+input:analog-mono",
        "input:analog-stereo",
        "input:analog-mono",
        "input:mono-fallback",
    ]

    release = yaml.safe_load((ROLES / "release_kiosk/tasks/main.yml").read_text())
    release_steps = release[0]["block"][1]["block"]
    policy = next(step for step in release_steps if step["name"] == "Converge the Pi4 kiosk USB audio input policy")
    assert policy["when"] == "manage_kiosk_browser | default(false) | bool"
    assert policy["block"][0]["ansible.builtin.include_role"] == {
        "name": "kiosk",
        "tasks_from": "usb-audio-input",
    }

    provision = yaml.safe_load((kiosk / "tasks/main.yml").read_text())
    shared = next(task for task in provision if task.get("ansible.builtin.import_tasks") == "usb-audio-input.yml")
    assert "'kiosk' in group_names" in shared["when"]
    assert "terminal_release_mode | default('full') == 'full'" in shared["when"]

    _, install, deploy_user, restart = yaml.safe_load((kiosk / "tasks/usb-audio-input.yml").read_text())
    assert install["ansible.builtin.copy"] == {
        "src": config_name,
        "dest": f"/etc/wireplumber/wireplumber.conf.d/{config_name}",
        "owner": "root",
        "group": "root",
        "mode": "0644",
    }
    assert restart["when"] == (
        f"{install['register']}.changed or ({deploy_user['block'][2]['register']}.changed | default(false))"
    )
    assert restart["become"] is True
    assert restart["become_user"] == "{{ kiosk_gui_user | default(ansible_user) }}"
    assert restart["ignore_errors"] is True
    shell = restart["ansible.builtin.shell"]
    assert 'export XDG_RUNTIME_DIR="/run/user/${uid}"' in shell
    assert (
        'if test -S "${XDG_RUNTIME_DIR}/bus" && pgrep -u "${uid}" -x labwc >/dev/null; then\n'
        "  systemctl --user restart wireplumber\n"
    ) in shell


def test_pi4_deploy_account_does_not_own_alsa_devices():
    kiosk = ROLES / "kiosk"
    config_name = "90-kiosk-deploy-user-no-alsa.conf"
    config = (kiosk / "files" / config_name).read_text()
    assert config.startswith("#")
    assert re.search(r"main\s*=\s*\{\s*monitor\.alsa\s*=\s*disabled\s*\}", config)

    _, _, deploy_user, _ = yaml.safe_load((kiosk / "tasks/usb-audio-input.yml").read_text())
    assert deploy_user["when"] == "(kiosk_gui_user | default(ansible_user)) != ansible_user"
    lookup, directories, install, restart = deploy_user["block"]
    assert lookup["ansible.builtin.getent"] == {"database": "passwd", "key": "{{ ansible_user }}"}
    home = "{{ ansible_facts.getent_passwd[ansible_user][4] }}"
    assert directories["loop"][-1] == ".config/wireplumber/wireplumber.conf.d"
    assert directories["ansible.builtin.file"]["owner"] == "{{ ansible_user }}"
    assert install["ansible.builtin.copy"] == {
        "src": config_name,
        "dest": f"{home}/.config/wireplumber/wireplumber.conf.d/{config_name}",
        "owner": "{{ ansible_user }}",
        "group": "{{ ansible_user }}",
        "mode": "0644",
    }
    assert restart["when"] == f"{install['register']}.changed"
    assert restart["become_user"] == "{{ ansible_user }}"
    assert restart["ignore_errors"] is True
    assert 'pgrep -u "${uid}" -x wireplumber' in restart["ansible.builtin.shell"]
