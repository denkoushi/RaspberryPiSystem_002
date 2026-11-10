"""Repository-only delivery/evidence checks; never load inventory or secrets."""
import importlib.util
import json
from pathlib import Path
import re

import yaml

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / 'infrastructure/ansible'


def test_rules_schema_and_repository_evidence():
    rules = json.loads((ROOT / 'scripts/server/jpcert-advisories/rules.json').read_text())
    assert isinstance(rules, list) and rules
    products = set()
    for rule in rules:
        assert set(rule) <= {'product', 'aliases', 'exclude', 'evidence', 'probes'}
        assert {'product', 'aliases', 'evidence'} <= set(rule)
        assert isinstance(rule['product'], str) and rule['product'] and rule['product'] not in products
        products.add(rule['product'])
        for key in ('aliases', 'exclude'):
            values = rule.get(key, [])
            assert isinstance(values, list)
            assert key != 'aliases' or values
            assert all(isinstance(value, str) and value.strip() for value in values)
        for probe in rule.get('probes', []):
            kind = probe['kind']
            fields = {'dpkg': {'packages'}, 'command': {'argv'}, 'container': {'containers', 'argv'},
                      'os_release': set(), 'uname': set(), 'package_json': {'path', 'name'}}
            assert kind in fields and set(probe) == {'kind'} | fields[kind]
            for key in ('argv', 'packages', 'containers'):
                if key in probe:
                    assert isinstance(probe[key], list) and probe[key]
                    assert all(isinstance(v, str) and v and not re.search(r'[;|&`$<>\n\r]', v) for v in probe[key])
            if kind == 'package_json':
                assert re.fullmatch(r'apps/[^/]+/package\.json', probe['path'])
                assert (ROOT / probe['path']).is_file()
                assert isinstance(probe['name'], str) and probe['name']
        assert isinstance(rule['evidence'], list) and rule['evidence']
        for evidence in rule['evidence']:
            assert set(evidence) == {'path', 'pattern'}
            path = Path(evidence['path'])
            assert not path.is_absolute() and '..' not in path.parts
            assert not any(part in ('secrets', 'certs') or part.startswith('.env') or 'vault' in part for part in path.parts)
            assert (ROOT / path).is_file()
            assert re.search(evidence['pattern'], (ROOT / path).read_text()), evidence
    assert {'Chromium', 'Node.js', 'PostgreSQL', 'OpenSSH', 'Docker Engine'} <= products
    assert not {'rkhunter', 'nginx', 'Redis', 'Brotli', 'glibc'} & products


def test_ansible_delivery_units_configuration_and_collector_markers():
    variables = yaml.safe_load((ANSIBLE / 'group_vars/all.yml').read_text())
    assert variables['jpcert_advisories_enabled'] is True
    config = variables['jpcert_advisories_config']
    assert set(config) == {'feed_url', 'rules_path', 'state_path', 'alerts_dir', 'log_path',
                          'timeout_seconds', 'initial_lookback_days', 'failure_alert_threshold',
                          'summary_window_hours', 'seen_retention_days', 'max_details_chars', 'jobs_dir', 'project_dir'}
    assert config['feed_url'] == 'https://www.jpcert.or.jp/rss/jpcert.rdf'
    assert config['alerts_dir'] == '{{ security_review_kiosk_output_alerts_dir }}'
    assert variables['jpcert_advisories_state_dir'] == '/var/lib/jpcert-advisories'
    assert variables['jpcert_advisories_log_dir'] == '/var/log/jpcert-advisories'
    assert config['summary_window_hours'] == 24
    assert yaml.safe_load((ANSIBLE / 'group_vars/staging.yml').read_text())['jpcert_advisories_enabled'] is False
    templates = ANSIBLE / 'templates'
    service = (templates / 'jpcert-advisories-fetch.service.j2').read_text()
    for value in ['Type=oneshot', 'User={{ ansible_user }}', 'UMask=0027', 'TimeoutStartSec=5min',
                  'NoNewPrivileges=true', 'ProtectSystem=strict', 'PrivateTmp=true',
                  'ReadWritePaths={{ jpcert_advisories_state_dir }} {{ jpcert_advisories_log_dir }} {{ security_review_kiosk_output_alerts_dir }} {{ security_review_data_dir }}/advisories/pending',
                  '/usr/bin/python3 /usr/local/bin/jpcert-advisories-fetch.py /etc/jpcert-advisories/fetch.json']:
        assert value in service
    timer = (templates / 'jpcert-advisories-fetch.timer.j2').read_text()
    for value in ['OnCalendar=hourly', 'Persistent=true', 'RandomizedDelaySec=10min']:
        assert value in timer
    assert (templates / 'jpcert-advisories-fetch.json.j2').read_text().strip() == '{{ jpcert_advisories_config | to_nice_json }}'
    text = (ANSIBLE / 'roles/server/tasks/jpcert-advisories.yml').read_text()
    tasks = yaml.safe_load(text)
    files = [t['ansible.builtin.file'] for t in tasks if 'ansible.builtin.file' in t]
    assert files[0] == dict(path='/etc/jpcert-advisories', state='directory', owner='root', group='{{ ansible_user }}', mode='0750')
    assert files[1]['owner'] == '{{ ansible_user }}' and files[1]['mode'] == '{{ item.mode }}'
    assert tasks[1]['loop'] == [dict(path='{{ jpcert_advisories_state_dir }}', mode='0700'),
                                dict(path='{{ jpcert_advisories_log_dir }}', mode='0750')]
    deliveries = {t[module]['dest']: t[module] for t in tasks for module in ('ansible.builtin.copy', 'ansible.builtin.template') if module in t}
    for dest, mode, group in [('/usr/local/bin/jpcert-advisories-fetch.py', '0755', 'root'),
                              ('/etc/jpcert-advisories/rules.json', '0640', '{{ ansible_user }}'),
                              ('/etc/jpcert-advisories/fetch.json', '0640', '{{ ansible_user }}'),
                              ('/etc/systemd/system/jpcert-advisories-fetch.{{ item }}', '0644', 'root')]:
        assert deliveries[dest]['owner'] == 'root'
        assert deliveries[dest]['group'] == group and deliveries[dest]['mode'] == mode
    assert deliveries['/usr/local/bin/jpcert-advisories-fetch.py']['src'].endswith('/scripts/server/jpcert-advisories/fetch.py')
    assert deliveries['/etc/jpcert-advisories/rules.json']['src'].endswith('/scripts/server/jpcert-advisories/rules.json')
    enable = tasks[-1]
    assert enable['when'] == 'not (ansible_check_mode and jpcert_advisories_units is changed)'
    assert enable['ansible.builtin.systemd'] == dict(name='jpcert-advisories-fetch.timer', enabled='{{ jpcert_advisories_enabled | bool }}', state="{{ jpcert_advisories_enabled | bool | ternary('started', 'stopped') }}")
    assert tasks[-2]['when'] == 'jpcert_advisories_units is changed'
    spec = importlib.util.spec_from_file_location('jpcert', ROOT / 'scripts/server/jpcert-advisories/fetch.py')
    fetcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fetcher)
    scan = next(s for s in variables['security_review_collector_config']['scans'] if s['name'] == 'jpcert-advisories')
    assert scan == dict(name='jpcert-advisories', paths=['/var/log/jpcert-advisories/jpcert-advisories.log*'], start=fetcher.START, end=fetcher.END)
    playbook_text = (ANSIBLE / 'playbooks/prepare-pi5-jpcert-advisories.yml').read_text()
    assert '--check --diff first' in playbook_text and 'Standard release does not apply' in playbook_text
    play = yaml.safe_load(playbook_text)[0]
    assert play['hosts'] == 'raspberrypi5' and play['become'] is True and play['serial'] == 1
    assert play['tasks'][0]['ansible.builtin.import_role'] == dict(name='server', tasks_from='jpcert-advisories.yml')


def test_advisory_storage_env_and_shared_uid_contract():
    variables = yaml.safe_load((ANSIBLE / 'group_vars/all.yml').read_text())
    assert variables['advisory_check_enabled'] is True
    assert variables['advisory_check_cron'] == '*/5 * * * *'
    assert yaml.safe_load((ANSIBLE / 'group_vars/staging.yml').read_text())['advisory_check_enabled'] is False
    assert variables['jpcert_advisories_config']['jobs_dir'] == '{{ security_review_data_dir }}/advisories'
    assert 'pi5_project_dir' in variables['jpcert_advisories_config']['project_dir']
    tasks = yaml.safe_load((ANSIBLE / 'roles/release_pi5/tasks/security-review.yml').read_text())
    assert {'advisories', 'advisories/pending', 'advisories/claimed', 'advisories/done', 'advisories/invalid'} <= set(tasks[0]['loop'])
    settings = next(t for t in tasks if 'ansible.builtin.lineinfile' in t)
    values = {item['key']: item['value'] for item in settings['loop']}
    assert values['ADVISORY_CHECK_DIR'] == '/app/storage/security-review/advisories'
    assert 'advisory_check_enabled' in values['ADVISORY_CHECK_ENABLED']
    assert values['ADVISORY_CHECK_CRON'] == '{{ advisory_check_cron }}'
    text = (ANSIBLE / 'roles/server/tasks/jpcert-advisories.yml').read_text()
    assert 'getent_passwd[ansible_user][1]' in text
    tasks = yaml.safe_load(text)
    directory = next(t for t in tasks if t['name'] == 'Prepare private advisory job directories')
    assert directory['ansible.builtin.file']['mode'] == '0700'
    assert directory['ansible.builtin.file']['owner'] == '{{ api_runtime_uid | default(1000) }}'
    assert {'', 'advisories', 'advisories/pending', 'advisories/claimed', 'advisories/done', 'advisories/invalid'} <= set(directory['loop'])
    assert '/storage/security-review:/app/storage/security-review' in (ROOT / 'infrastructure/docker/docker-compose.phase3.yml').read_text()
