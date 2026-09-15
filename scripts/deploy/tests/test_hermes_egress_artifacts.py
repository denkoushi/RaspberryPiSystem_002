"""Exercise actual Ansible artifact publication and rollback path selection."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[3]
TASKS = ROOT / 'infrastructure/ansible/roles/release_pi5/tasks'


class EgressArtifactsTests(unittest.TestCase):
    def test_checkout_replacement_preserves_candidate_and_previous_programs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            checkout = root / 'checkout/infrastructure/docker/business-hermes-egress'
            checkout.mkdir(parents=True)
            source = checkout / 'proxy.mjs'
            source.write_text('candidate program')
            old = root / 'old.mjs'
            old.write_text('previous mounted program')
            (root / 'run').mkdir()
            docker = root / 'docker'
            docker.write_text('#!/usr/bin/env python3\nimport sys,shutil\n'
                              'if sys.argv[1] == "ps": print("old-container")\n'
                              f'elif sys.argv[1] == "cp": shutil.copyfile({str(old)!r},sys.argv[-1])\n'
                              'else: sys.exit(1)\n')
            docker.chmod(0o755)
            for name in ('prepare', 'capture', 'artifact'):
                tasks = yaml.safe_load((TASKS / f'business-hermes-egress-{name}.yml').read_text())
                # Exercise the same tasks as an unprivileged developer in a private
                # fixture directory; production retains explicit root ownership.
                def fixture(value):
                    if isinstance(value, list): return [fixture(v) for v in value]
                    if isinstance(value, dict):
                        return {k: fixture(v) for k,v in value.items() if k not in ('owner', 'group')}
                    if value == '/etc/raspi-business-hermes/egress': return str(root / 'published')
                    return value
                (root / f'business-hermes-egress-{name}.yml').write_text(yaml.safe_dump(fixture(tasks)))
            play = [{'hosts':'localhost','connection':'local','gather_facts':False,
                     'environment':{'PATH':str(root)+':'+os.environ['PATH']},
                     'vars':{'release_pi5_project_dir':str(root/'checkout'),
                             'release_pi5_run_dir':str(root/'run'), 'release_pi5_compose_project':'fixture',
                             'release_pi5_compose_environment':{'KEEP':'candidate'},
                             'release_pi5_rollback_compose_environment':{'KEEP':'previous'}},
                     'tasks':[{'ansible.builtin.include_tasks':'business-hermes-egress-prepare.yml'},
                              {'ansible.builtin.copy':{'content':'{{ {"candidate": release_pi5_compose_environment, "rollback": release_pi5_rollback_compose_environment} | to_json }}','dest':str(root/'result.json')}}]}]
            (root/'play.yml').write_text(yaml.safe_dump(play))
            result=subprocess.run(['ansible-playbook',str(root/'play.yml')],capture_output=True,text=True,
                                  env={k:v for k,v in os.environ.items() if k!='ANSIBLE_CONFIG'})
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            result=json.loads((root/'result.json').read_text())
            source.unlink()
            source.write_text('unrelated old checkout')
            source.chmod(0o600)
            for key in ('BUSINESS_HERMES_EGRESS_PROXY_FILE','BUSINESS_HERMES_CHAT_EGRESS_PROXY_FILE'):
                candidate=Path(result['candidate'][key]); previous=Path(result['rollback'][key])
                self.assertEqual(candidate.read_text(),'candidate program')
                self.assertEqual(previous.read_text(),'previous mounted program')
                self.assertEqual(candidate.stat().st_mode & 0o777,0o644)
                self.assertEqual(previous.stat().st_mode & 0o777,0o644)
                self.assertNotEqual(candidate,previous)
            self.assertEqual(result['candidate']['KEEP'],'candidate')
            self.assertEqual(result['rollback']['KEEP'],'previous')

    def test_both_compose_services_accept_managed_paths(self):
        services=yaml.safe_load((ROOT/'infrastructure/docker/docker-compose.phase3.yml').read_text())['services']
        for service,key in [('business-hermes-egress','BUSINESS_HERMES_EGRESS_PROXY_FILE'),('business-hermes-chat-egress','BUSINESS_HERMES_CHAT_EGRESS_PROXY_FILE')]:
            mount=next(v for v in services[service]['volumes'] if v.get('target')=='/opt/business-hermes-egress/proxy.mjs')
            self.assertTrue(mount['source'].startswith('${'+key+':-'))
            self.assertTrue(mount['read_only'])
            self.assertFalse(mount['bind']['create_host_path'])
