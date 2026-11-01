"""Static Pi5 kiosk fetch installation contract; no inventory/secret loading."""
from pathlib import Path


def test_ansible_units_config_scans_and_timer_gating():
    root = Path(__file__).resolve().parents[3]
    templates = root / 'infrastructure/ansible/templates'
    service = (templates / 'security-review-kiosk-fetch.service.j2').read_text()
    for required in ['Type=oneshot', 'User={{ ansible_user }}', 'UMask=0027', 'TimeoutStartSec=10min',
                     '/usr/local/bin/security-review-kiosk-fetch.py /etc/security-review-kiosk/fetch.json']:
        assert required in service
    timer = (templates / 'security-review-kiosk-fetch.timer.j2').read_text()
    assert 'OnCalendar=hourly' in timer and 'Persistent=true' in timer
    tasks = (root / 'infrastructure/ansible/roles/server/tasks/security-review.yml').read_text()
    enable = tasks.split('- name: Apply the kiosk fetch collector enable flag\n')[1]
    assert 'name: security-review-kiosk-fetch.timer' in enable
    assert 'enabled: "{{ security_review_collect_enabled | bool }}"' in enable
    assert "state: \"{{ security_review_collect_enabled | bool | ternary('started', 'stopped') }}\"" in enable
    assert 'when: not (ansible_check_mode and security_review_kiosk_units is changed)' in enable
    assert 'register: security_review_kiosk_units' in tasks
    assert 'when: security_review_kiosk_units is changed' in tasks
    assert "{path: /etc/security-review-kiosk, mode: '0750'}" in tasks
    assert 'owner: "{{ ansible_user }}"' in tasks
    assert "src: \"{{ playbook_dir }}/../templates/security-review-kiosk-fetch.{{ item }}.j2\"" in tasks
    config = (templates / 'security-review-kiosk-fetch.json.j2').read_text()
    for required in ["groups['kiosk']", 'hostvars[h].ansible_host', 'hostvars[h].ansible_user']:
        assert required in config
    variables = (root / 'infrastructure/ansible/group_vars/all.yml').read_text()
    scan = variables.split('    - name: kiosk-package-integrity\n')[1].split('\n\n')[0]
    assert 'paths: ["{{ security_review_kiosk_log_dir }}/kiosk-package-integrity.log"]' in scan
    assert "start: 'Starting kiosk package integrity summary'" in scan and "end: 'Kiosk package integrity summary completed.'" in scan
