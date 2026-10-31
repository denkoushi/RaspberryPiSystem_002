"""Queue deployment contract; never load inventory, environment or secrets."""
import fnmatch
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / 'infrastructure/ansible'


def check_private_queue_directories_and_hourly_enqueue_units_in_both_roles():
    for role in ('server', 'release_pi5'):
        tasks = yaml.safe_load((ANSIBLE / f'roles/{role}/tasks/security-review.yml').read_text())
        directories = tasks[0]
        assert directories['ansible.builtin.file']['mode'] == '0700'
        assert directories['ansible.builtin.file']['owner'] == '{{ api_runtime_uid | default(1000) }}'
        assert directories['ansible.builtin.file']['group'] == '{{ api_runtime_gid | default(1000) }}'
        assert {'queue', 'queue/pending', 'queue/claimed', 'queue/done', 'queue/failed', 'queue/progress', 'queue/invalid'} <= set(directories['loop'])
        delivery = next(task for task in tasks if task['name'] == 'Deliver security review enqueue units')
        assert delivery['loop'] == ['service', 'timer']
        assert delivery['ansible.builtin.template']['src'].endswith('/templates/security-review-enqueue.{{ item }}.j2')
        assert delivery['ansible.builtin.template']['dest'] == '/etc/systemd/system/security-review-enqueue.{{ item }}'
        enable = next(task for task in tasks if task['name'] == 'Apply the enqueue enable flag')
        assert enable['ansible.builtin.systemd']['name'] == 'security-review-enqueue.timer'
        assert enable['ansible.builtin.systemd']['enabled'] == '{{ security_review_collect_enabled | bool }}'
        assert enable['when'] == 'not (ansible_check_mode and security_review_enqueue_units is changed)'

    service = (ANSIBLE / 'templates/security-review-enqueue.service.j2').read_text()
    for required in ('Type=oneshot', 'User=root', 'UMask=0077', 'TimeoutStartSec=30min',
                     '/usr/local/bin/security-review-collect.py /etc/security-review/collect.json --mode enqueue'):
        assert required in service
    timer = (ANSIBLE / 'templates/security-review-enqueue.timer.j2').read_text()
    assert 'OnCalendar={{ security_review_enqueue_on_calendar }}' in timer
    assert 'Persistent=true' in timer
    nightly = (ANSIBLE / 'templates/security-review-collect.service.j2').read_text()
    assert '/etc/security-review/collect.json --mode nightly' in nightly


def check_standard_release_updates_collector_before_enabling_enqueue():
    tasks = yaml.safe_load((ANSIBLE / 'roles/release_pi5/tasks/security-review.yml').read_text())
    install_index = next(index for index, task in enumerate(tasks) if task['name'] == 'Install the local security review collector')
    install = tasks[install_index]['ansible.builtin.copy']
    assert install['src'].endswith('/scripts/server/security-review/collect.py')
    assert install['dest'] == '/usr/local/bin/security-review-collect.py'
    assert install['owner'] == 'root' and install['mode'] == '0755'
    config_index = next(index for index, task in enumerate(tasks) if task['name'] == 'Deliver collector paths and detection rules')
    config = tasks[config_index]['ansible.builtin.template']
    assert config['dest'] == '/etc/security-review/collect.json'
    assert config['mode'] == '0600'
    assert config['src'].endswith('/templates/security-review-collect.json.j2')
    units_index = next(index for index, task in enumerate(tasks) if task['name'] == 'Deliver security review collector units')
    assert tasks[units_index]['loop'] == ['service', 'timer']
    enqueue_index = next(index for index, task in enumerate(tasks) if task['name'] == 'Apply the enqueue enable flag')
    assert max(install_index, config_index, units_index) < enqueue_index


def check_queue_settings_backfill_and_test_exclusions():
    variables = yaml.safe_load((ANSIBLE / 'group_vars/all.yml').read_text())
    assert variables['security_review_queue_enabled'] is True
    assert variables['security_review_queue_cron'] == '*/10 * * * *'
    assert variables['security_review_queue_quiet'] == '05:50-07:00'
    assert variables['security_review_enqueue_on_calendar'] == 'hourly'
    assert variables['security_review_collector_config']['changes_backfill'] == '{{ security_review_changes_backfill }}'
    assert variables['security_review_changes_backfill'] == [{
        'from': '7ffe3a87ff3a0f2ed5a2b543aa28241587e84b93',
        'to': 'ff4f8c645444d908e6ed7cbcf2625a38870451a0',
    }]
    excludes = variables['security_review_changes_exclude']
    for path in ('apps/api/src/example.test.ts', 'apps/web/src/example.test.tsx',
                 'apps/api/src/example.spec.ts', 'packages/core/src/__tests__/example.ts',
                 'scripts/server/tests/test_example.py', 'services/cache/test_example.py',
                 'services/cache/example_test.py', 'test_example.py', 'e2e/example.ts'):
        assert any(fnmatch.fnmatch(path, pattern) for pattern in excludes), path
    assert not any(fnmatch.fnmatch('apps/api/src/services/example.ts', pattern) for pattern in excludes)
    release_tasks = yaml.safe_load((ANSIBLE / 'roles/release_pi5/tasks/security-review.yml').read_text())
    settings = next(task for task in release_tasks if task['name'] == 'Deliver the lease-controlled security review settings')
    keys = {item['key'] for item in settings['loop']}
    assert {'SECURITY_REVIEW_QUEUE_ENABLED', 'SECURITY_REVIEW_QUEUE_CRON', 'SECURITY_REVIEW_QUEUE_QUIET'} <= keys


class SecurityReviewQueueContractTests(unittest.TestCase):
    def test_private_queue_directories_and_hourly_enqueue_units_in_both_roles(self):
        check_private_queue_directories_and_hourly_enqueue_units_in_both_roles()

    def test_queue_settings_backfill_and_test_exclusions(self):
        check_queue_settings_backfill_and_test_exclusions()

    def test_standard_release_updates_collector_before_enabling_enqueue(self):
        check_standard_release_updates_collector_before_enabling_enqueue()
