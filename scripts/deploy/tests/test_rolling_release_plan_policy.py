import ast
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock


DEPLOY_DIRECTORY = Path(__file__).parents[1]


def load_module(name: str, relative_path: str):
    path = DEPLOY_DIRECTORY / relative_path
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


POLICY = load_module('rolling_release_policy_under_test', 'rolling_release/policy.py')
PLANNER = load_module('rolling_release_planner_under_test', 'rolling_release/planner.py')


class PureModuleBoundaryTest(unittest.TestCase):
    def test_policy_and_planner_do_not_import_io_boundaries(self):
        forbidden = {'os', 'pathlib', 'subprocess', 'time', 'urllib'}
        for relative_path in ('rolling_release/policy.py', 'rolling_release/planner.py'):
            with self.subTest(module=relative_path):
                tree = ast.parse((DEPLOY_DIRECTORY / relative_path).read_text(encoding='utf-8'))
                imports = {
                    alias.name.split('.')[0]
                    for node in ast.walk(tree)
                    if isinstance(node, ast.Import)
                    for alias in node.names
                }
                imports.update(
                    node.module.split('.')[0]
                    for node in ast.walk(tree)
                    if isinstance(node, ast.ImportFrom) and node.module
                )
                self.assertEqual(imports & forbidden, set())


class ReleasePolicyTest(unittest.TestCase):
    def setUp(self):
        self.inventory = {
            'kiosk_canary': {'hosts': ['kiosk-b']},
            'kiosk': {'hosts': ['kiosk-a', 'kiosk-b']},
            'signage': {'hosts': ['signage-a']},
            '_meta': {'hostvars': {
                'kiosk-a': {
                    'manage_kiosk_browser': True,
                    'status_agent_client_id': 'a',
                },
                'kiosk-b': {
                    'manage_kiosk_browser': True,
                    'status_agent_client_id': 'b',
                    'barcode_agent_enabled': True,
                },
                'signage-a': {
                    'manage_signage_lite': True,
                    'status_agent_client_id': 's',
                },
            }},
        }
        self.targets = POLICY.release_targets(self.inventory)

    def test_target_order_and_explicit_empty_selection_are_deterministic(self):
        self.assertEqual(
            [target['host'] for target in self.targets],
            ['kiosk-b', 'kiosk-a', 'signage-a'],
        )
        self.assertEqual(POLICY.release_targets(self.inventory, []), [])

    def test_unknown_classification_keeps_scope_and_requires_pi5(self):
        selected, metadata = POLICY.apply_auto_minimize(
            self.targets,
            self.inventory,
            None,
        )
        self.assertEqual(selected, self.targets)
        self.assertFalse(metadata['minimized'])
        self.assertEqual(metadata['reason'], 'classification unavailable')
        self.assertTrue(POLICY.requires_pi5_release(None))

    def test_barcode_only_scope_keeps_only_enabled_kiosks(self):
        selected, metadata = POLICY.apply_auto_minimize(
            self.targets,
            self.inventory,
            {
                'server': False,
                'migration': False,
                'kiosk': True,
                'signage': False,
                'components': ['barcode-agent'],
            },
        )
        self.assertEqual([target['host'] for target in selected], ['kiosk-b'])
        self.assertEqual(metadata['excludedHosts'], ['kiosk-a', 'signage-a'])
        self.assertFalse(POLICY.requires_pi5_release({
            'server': False,
            'migration': False,
        }))


class ReleasePlannerTest(unittest.TestCase):
    def test_scope_uses_injected_facade_policies(self):
        targets = [
            {'host': 'kiosk-a', 'clientId': 'a', 'terminalType': 'kiosk'},
            {'host': 'signage-a', 'clientId': 's', 'terminalType': 'signage'},
        ]
        minimized_targets = [targets[0]]
        minimize = Mock(return_value=(minimized_targets, {
            'minimized': True,
            'excludedHosts': ['signage-a'],
            'classificationComponents': ['nfc-agent'],
        }))
        canary_hold = Mock(return_value=False)
        classification = {'components': ['nfc-agent']}
        inventory = {'_meta': {'hostvars': {}}}

        result = PLANNER.plan_terminal_scope(
            targets,
            inventory,
            classification,
            auto_minimize=True,
            minimize_policy=minimize,
            canary_hold_policy=canary_hold,
        )

        minimize.assert_called_once_with(targets, inventory, classification)
        canary_hold.assert_called_once_with(minimized_targets, 0, skip=False)
        self.assertEqual(result, {
            'terminalTargets': minimized_targets,
            'canaryHold': False,
            'autoMinimize': True,
            'minimized': True,
            'excludedHosts': ['signage-a'],
            'classificationComponents': ['nfc-agent'],
        })

    def test_payload_keeps_the_existing_print_plan_contract(self):
        scope = {
            'terminalTargets': None,
            'canaryHold': None,
            'autoMinimize': False,
            'minimized': False,
            'excludedHosts': [],
            'classificationComponents': None,
        }
        warnings = ['ansible-inventory unavailable']
        payload = PLANNER.build_print_plan_payload(
            branch='main',
            inventory='inventory.yml',
            limit='',
            sha=None,
            classification=None,
            pi5_required=None,
            terminal_scope=scope,
            warnings=warnings,
        )

        self.assertEqual(payload, {
            'mode': 'rolling-release',
            'branch': 'main',
            'inventory': 'inventory.yml',
            'limit': None,
            'sha': None,
            'classification': None,
            'pi5Required': None,
            **scope,
            'warnings': warnings,
        })
        self.assertIsNot(payload['warnings'], warnings)

    def test_execution_payload_keeps_rollout_order_and_metadata(self):
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'a', 'terminalType': 'kiosk'},
            {'host': 'signage-a', 'clientId': 's', 'terminalType': 'signage'},
        ]
        metadata = {
            'autoMinimize': True,
            'minimized': True,
            'excludedHosts': ['kiosk-b'],
            'classificationComponents': ['nfc-agent'],
        }
        self.assertEqual(
            PLANNER.build_execution_plan_payload(
                pi5_required=False,
                targets=targets,
                limit='clients',
                minimize_metadata=metadata,
            ),
            {
                'pi5Required': False,
                'targets': ['kiosk-canary', 'signage-a'],
                'limit': 'clients',
                **metadata,
            },
        )


if __name__ == '__main__':
    unittest.main()
