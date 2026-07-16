import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / 'classify-deploy-impact.py'
spec = importlib.util.spec_from_file_location('impact', SCRIPT)
impact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(impact)


class ClassifyDeployImpactTest(unittest.TestCase):
    def test_server_and_migration(self):
        result = impact.classify(['apps/api/src/index.ts', 'apps/api/prisma/migrations/x/migration.sql'])
        self.assertTrue(result['server'])
        self.assertTrue(result['migration'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['migration', 'server-app'])
        self.assertEqual(result['affectedProfiles'], [])

    def test_client_only(self):
        result = impact.classify(['clients/nfc-agent/src/index.ts'])
        self.assertFalse(result['server'])
        self.assertTrue(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['nfc-agent'])
        self.assertEqual(result['affectedProfiles'], ['kiosk'])

    def test_web_only_is_server(self):
        result = impact.classify(['apps/web/src/pages/kiosk/KioskReturnPage.tsx'])
        self.assertTrue(result['server'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertFalse(result['migration'])
        self.assertEqual(result['components'], ['server-app'])

    def test_api_signage_path_is_server_only(self):
        result = impact.classify(['apps/api/src/routes/signage.ts'])
        self.assertTrue(result['server'])
        self.assertFalse(result['signage'])
        self.assertFalse(result['kiosk'])
        self.assertEqual(result['components'], ['server-app'])

    def test_barcode_agent_is_kiosk(self):
        result = impact.classify(['clients/barcode-agent/barcode_agent/main.py'])
        self.assertTrue(result['kiosk'])
        self.assertFalse(result['server'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['barcode-agent'])

    def test_status_agent_is_kiosk_and_signage(self):
        result = impact.classify(['clients/status-agent/status-agent.py'])
        self.assertTrue(result['kiosk'])
        self.assertTrue(result['signage'])
        self.assertFalse(result['server'])
        self.assertEqual(result['components'], ['status-agent'])
        self.assertEqual(result['affectedProfiles'], ['kiosk', 'signage'])

    def test_signage_role_is_signage_only(self):
        result = impact.classify(['infrastructure/ansible/roles/signage/tasks/main.yml'])
        self.assertTrue(result['signage'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['server'])
        self.assertEqual(result['components'], ['signage-role'])
        self.assertEqual(result['affectedProfiles'], ['signage'])

    def test_deploy_control_files_do_not_manufacture_runtime_work(self):
        result = impact.classify(
            [
                'infrastructure/ansible/ansible-readonly.cfg',
                'scripts/update-all-clients.sh',
                'scripts/deploy/classify-deploy-impact.py',
                'scripts/deploy/recover-pi4.py',
                'scripts/deploy/rollback-manifest.py',
                'scripts/deploy/rolling-release.py',
                'scripts/deploy/terminal-profile-registry.json',
                'scripts/deploy/terminal_profile_registry.py',
                'scripts/deploy/rolling_release/PROTOCOL',
                'scripts/deploy/rolling_release/application.py',
                'scripts/deploy/rolling_release/backends/pi5.py',
                'scripts/deploy/rolling_release/coordinator.py',
                'scripts/deploy/rolling_release/backends/ansible.py',
                'scripts/deploy/rolling_release/bootstrap.py',
                'scripts/deploy/rolling_release/cli.py',
                'scripts/deploy/rolling_release/lock.py',
                'scripts/deploy/rolling_release/models.py',
                'scripts/deploy/rolling_release/planner.py',
                'scripts/deploy/rolling_release/policy.py',
                'scripts/deploy/rolling_release/remote_control.py',
                'scripts/deploy/rolling_release/state.py',
                'scripts/deploy/terminal-runtime-manifest.py',
            ]
        )
        self.assertFalse(result['server'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertFalse(result['migration'])
        self.assertEqual(result['components'], ['deploy-control'])
        self.assertEqual(result['affectedProfiles'], [])

    def test_signage_runtime_proof_is_signage_only(self):
        result = impact.classify(['scripts/deploy/signage-runtime-proof.py'])
        self.assertFalse(result['server'])
        self.assertFalse(result['kiosk'])
        self.assertTrue(result['signage'])
        self.assertFalse(result['migration'])
        self.assertEqual(result['components'], ['signage-role'])

    def test_deploy_test_files_are_neutral(self):
        result = impact.classify(
            [
                'scripts/deploy/tests/test_ansible_adapter.py',
                'scripts/deploy/tests/test_rollback_manifest.py',
                'scripts/deploy/tests/test_signage_runtime_proof.py',
            ]
        )
        self.assertFalse(result['server'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertFalse(result['migration'])
        self.assertEqual(result['components'], ['neutral'])

    def test_signage_recovery_fix_targets_only_signage(self):
        result = impact.classify(
            [
                'docs/plans/deployment-foundation-refactor-execplan.md',
                'scripts/deploy/rollback-manifest.py',
                'scripts/deploy/rolling_release/coordinator.py',
                'scripts/deploy/rolling_release/backends/ansible.py',
                'scripts/deploy/signage-runtime-proof.py',
                'scripts/deploy/tests/test_ansible_adapter.py',
            ]
        )
        self.assertFalse(result['server'])
        self.assertFalse(result['kiosk'])
        self.assertTrue(result['signage'])
        self.assertFalse(result['migration'])
        self.assertEqual(
            result['components'], ['deploy-control', 'neutral', 'signage-role']
        )

    def test_docs_only_is_neutral(self):
        result = impact.classify(['docs/guides/deployment.md', 'AGENTS.md', '.github/workflows/ci.yml'])
        self.assertFalse(result['server'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertFalse(result['migration'])
        self.assertEqual(result['components'], ['neutral'])

    def test_neutral_does_not_shadow_real_changes(self):
        result = impact.classify(['docs/INDEX.md', 'apps/api/src/index.ts'])
        self.assertTrue(result['server'])
        self.assertEqual(result['components'], ['neutral', 'server-app'])

    def test_unknown_path_fail_closed(self):
        result = impact.classify(['totally/unknown/path.txt'])
        self.assertTrue(result['server'])
        self.assertTrue(result['kiosk'])
        self.assertTrue(result['signage'])
        self.assertEqual(result['components'], ['unknown'])
        self.assertEqual(result['affectedProfiles'], ['kiosk', 'signage'])

    def test_global_change_targets_all_registered_profiles(self):
        result = impact.classify(['infrastructure/ansible/inventory.yml'])

        self.assertTrue(result['server'])
        self.assertTrue(result['kiosk'])
        self.assertTrue(result['signage'])
        self.assertEqual(result['components'], ['global'])
        self.assertEqual(result['affectedProfiles'], ['kiosk', 'signage'])

    def test_synthetic_profile_classifies_without_core_name_branch(self):
        payload = json.loads(
            (impact.DEPLOY_DIRECTORY / 'terminal-profile-registry.json').read_text(
                encoding='utf-8'
            )
        )
        synthetic = copy.deepcopy(payload['terminalProfiles'][0])
        synthetic.update(
            {
                'id': 'synthetic-fourth',
                'inventoryGroup': 'synthetic_fourth',
                'rolloutOrder': 15,
                'impactComponent': 'synthetic-runtime',
                'adapterId': 'unique-terminal',
                'canaryGroup': 'synthetic_fourth_canary',
                'approvalPolicy': 'health-only',
            }
        )
        payload['terminalProfiles'].append(synthetic)
        payload['pathMappings'].append(
            {
                'match': 'prefix',
                'path': 'clients/synthetic-fourth/',
                'component': 'synthetic-runtime',
            }
        )
        payload['componentProfiles']['synthetic-runtime'] = ['synthetic-fourth']
        payload['componentProfiles']['global'].append('synthetic-fourth')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            playbook = root / 'infrastructure/ansible/playbooks/deploy-staged.yml'
            playbook.parent.mkdir(parents=True)
            playbook.write_text('---\n', encoding='utf-8')
            registry_path = root / 'registry.json'
            registry_path.write_text(json.dumps(payload), encoding='utf-8')
            registry = impact.load_registry(registry_path, repository_root=root)

        result = impact.classify(
            ['clients/synthetic-fourth/main.py'], registry=registry
        )

        self.assertFalse(result['server'])
        self.assertFalse(result['kiosk'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['synthetic-runtime'])
        self.assertEqual(result['affectedProfiles'], ['synthetic-fourth'])

    def test_prisma_migrations(self):
        result = impact.classify(
            [
                'apps/api/prisma/migrations/'
                '20260106155657_add_signage_layout_config/migration.sql'
            ]
        )
        self.assertTrue(result['migration'])
        self.assertTrue(result['server'])
        self.assertFalse(result['signage'])
        self.assertEqual(result['components'], ['migration'])

    def test_runtime_file_renamed_into_docs_classifies_both_sides(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            subprocess.run(['git', 'init', '-q'], cwd=repository, check=True)
            subprocess.run(
                ['git', 'config', 'user.email', 'test@example.invalid'],
                cwd=repository,
                check=True,
            )
            subprocess.run(
                ['git', 'config', 'user.name', 'Test'], cwd=repository, check=True
            )
            source = repository / 'clients/status-agent/service.py'
            source.parent.mkdir(parents=True)
            source.write_text('runtime\n', encoding='utf-8')
            subprocess.run(['git', 'add', '.'], cwd=repository, check=True)
            subprocess.run(['git', 'commit', '-qm', 'base'], cwd=repository, check=True)
            base = subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=repository, text=True
            ).strip()
            destination = repository / 'docs/service.md'
            destination.parent.mkdir()
            source.rename(destination)
            subprocess.run(['git', 'add', '-A'], cwd=repository, check=True)
            subprocess.run(['git', 'commit', '-qm', 'rename'], cwd=repository, check=True)
            head = subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=repository, text=True
            ).strip()

            paths = subprocess.check_output(
                [
                    'python3',
                    str(SCRIPT),
                    '--base',
                    base,
                    '--head',
                    head,
                ],
                cwd=repository,
                text=True,
            )
            result = __import__('json').loads(paths)

        self.assertEqual(
            set(result['paths']),
            {'clients/status-agent/service.py', 'docs/service.md'},
        )
        self.assertTrue(result['kiosk'])
        self.assertTrue(result['signage'])
        self.assertEqual(result['components'], ['neutral', 'status-agent'])


if __name__ == '__main__':
    unittest.main()
