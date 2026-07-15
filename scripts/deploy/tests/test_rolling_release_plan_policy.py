import ast
import copy
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock


DEPLOY_DIRECTORY = Path(__file__).parents[1]
if str(DEPLOY_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIRECTORY))


def load_module(name: str, relative_path: str):
    path = DEPLOY_DIRECTORY / relative_path
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


POLICY = load_module('rolling_release_policy_under_test', 'rolling_release/policy.py')
PLANNER = load_module('rolling_release_planner_under_test', 'rolling_release/planner.py')
CURRENT_SHA = 'a' * 40
RELEASE_SHA = 'b' * 40
VERIFIED_AT = '2026-07-15T00:00:00Z'
RUN_ID = '20260715-000000-a1b2c3'
DIGEST = 'sha256:' + ('c' * 64)


def classification(**overrides):
    value = {
        'server': False,
        'kiosk': False,
        'signage': False,
        'migration': False,
        'components': ['neutral'],
    }
    value.update(overrides)
    return value


def verified_record(role, *, current=CURRENT_SHA, desired=None, run_scoped=False):
    value = {
        'role': role,
        'desiredSha': current if desired is None else desired,
        'currentSha': current,
        'previousSha': None,
        'evidence': 'verified',
        'verifiedAt': VERIFIED_AT,
        'lastRunId': RUN_ID,
    }
    if role == 'server':
        run_suffix = ('-' + '9' * 64) if run_scoped else ''
        value.update({
            'activeSlot': 'blue',
            'apiImage': f'raspisys-api:{current}-aaaaaaaaaaaa{run_suffix}',
            'webImage': f'raspisys-web:{current}-bbbbbbbbbbbb{run_suffix}',
            'configDigest': DIGEST,
            'migrationDigest': DIGEST,
        })
    return value


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
            'server': {'hosts': ['server-a']},
            'kiosk_canary': {'hosts': ['kiosk-b']},
            'kiosk': {'hosts': ['kiosk-a', 'kiosk-b']},
            'signage': {'hosts': ['signage-a']},
            '_meta': {'hostvars': {
                'server-a': {
                    'status_agent_client_id': 'server',
                },
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
        self.hosts = POLICY.release_hosts(self.inventory)

    def test_target_order_and_explicit_empty_selection_are_deterministic(self):
        self.assertEqual(
            [target['host'] for target in self.targets],
            ['kiosk-b', 'kiosk-a', 'signage-a'],
        )
        self.assertEqual(POLICY.release_targets(self.inventory, []), [])

    def test_full_release_host_order_starts_with_exact_server(self):
        self.assertEqual(
            [(target['role'], target['host']) for target in self.hosts],
            [
                ('server', 'server-a'),
                ('kiosk', 'kiosk-b'),
                ('kiosk', 'kiosk-a'),
                ('signage', 'signage-a'),
            ],
        )
        self.assertEqual(
            [target['host'] for target in POLICY.release_hosts(
                self.inventory, ['signage-a', 'server-a']
            )],
            ['server-a', 'signage-a'],
        )

    def test_full_release_inventory_requires_one_disjoint_server(self):
        missing = copy.deepcopy(self.inventory)
        missing['server']['hosts'] = []
        duplicate = copy.deepcopy(self.inventory)
        duplicate['server']['hosts'] = ['server-a', 'server-b']
        duplicate['_meta']['hostvars']['server-b'] = {}
        overlap = copy.deepcopy(self.inventory)
        overlap['server']['hosts'] = ['kiosk-a']
        for inventory in (missing, duplicate, overlap):
            with self.subTest(inventory=inventory), self.assertRaisesRegex(
                RuntimeError, 'server'
            ):
                POLICY.release_hosts(inventory)

    def test_full_release_inventory_rejects_unknown_or_duplicate_selection(self):
        with self.assertRaisesRegex(RuntimeError, 'not release targets'):
            POLICY.release_hosts(self.inventory, ['other-host'])
        with self.assertRaisesRegex(RuntimeError, 'duplicated'):
            POLICY.release_hosts(self.inventory, ['kiosk-a', 'kiosk-a'])

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

    def test_missing_fleet_records_are_unknown_and_always_targeted(self):
        decisions = POLICY.plan_target_decisions(
            self.hosts,
            {},
            RELEASE_SHA,
            {},
            self.inventory,
        )

        self.assertEqual([decision['host'] for decision in decisions], [
            'server-a', 'kiosk-b', 'kiosk-a', 'signage-a',
        ])
        self.assertTrue(all(decision['targeted'] for decision in decisions))
        self.assertTrue(all(decision['evidence'] == 'unknown' for decision in decisions))
        self.assertTrue(all(decision['desiredSha'] == RELEASE_SHA for decision in decisions))
        self.assertTrue(all(
            decision['targetReason'] == 'fleet record missing'
            for decision in decisions
        ))

    def test_unknown_and_role_mismatched_evidence_cannot_be_excluded(self):
        fleet = {
            'kiosk-b': {
                **verified_record('kiosk'),
                'evidence': 'unknown',
            },
            'kiosk-a': verified_record('signage'),
        }
        decisions = POLICY.plan_target_decisions(
            [self.hosts[1], self.hosts[2]],
            fleet,
            RELEASE_SHA,
            {CURRENT_SHA: classification()},
            self.inventory,
        )

        self.assertEqual(
            [(decision['evidence'], decision['targetReason']) for decision in decisions],
            [('unknown', 'evidence unknown'), ('unknown', 'fleet role mismatch')],
        )
        self.assertTrue(all(decision['targeted'] for decision in decisions))

    def test_only_complete_verified_evidence_at_desired_sha_is_excluded(self):
        fleet = {
            target['host']: verified_record(target['role'], current=RELEASE_SHA)
            for target in self.hosts
        }
        decisions = POLICY.plan_target_decisions(
            self.hosts,
            fleet,
            RELEASE_SHA,
            {},
            self.inventory,
        )

        self.assertTrue(all(not decision['targeted'] for decision in decisions))
        self.assertTrue(all(decision['evidence'] == 'verified' for decision in decisions))
        self.assertTrue(all(
            decision['targetReason'] == 'verified at desired SHA'
            for decision in decisions
        ))

        incomplete = copy.deepcopy(fleet)
        del incomplete['server-a']['migrationDigest']
        server = POLICY.plan_target_decisions(
            [self.hosts[0]],
            incomplete,
            RELEASE_SHA,
            {},
            self.inventory,
        )[0]
        self.assertTrue(server['targeted'])
        self.assertEqual(server['evidence'], 'unknown')
        self.assertEqual(server['targetReason'], 'verified evidence incomplete')

    def test_run_scoped_server_images_remain_complete_verified_evidence(self):
        server_record = verified_record(
            'server', current=RELEASE_SHA, run_scoped=True
        )
        decision = POLICY.plan_target_decisions(
            [self.hosts[0]],
            {'server-a': server_record},
            RELEASE_SHA,
            {},
            self.inventory,
        )[0]
        self.assertFalse(decision['targeted'])
        self.assertEqual(decision['evidence'], 'verified')

    def test_role_specific_impact_targets_only_affected_verified_hosts(self):
        fleet = {
            'server-a': verified_record('server'),
            'kiosk-b': verified_record('kiosk', desired=RELEASE_SHA),
            'kiosk-a': verified_record('kiosk', desired=RELEASE_SHA),
            'signage-a': verified_record('signage'),
        }
        impact = classification(kiosk=True, components=['nfc-agent'])
        decisions = POLICY.plan_target_decisions(
            self.hosts,
            fleet,
            RELEASE_SHA,
            {CURRENT_SHA: impact},
            self.inventory,
        )
        by_host = {decision['host']: decision for decision in decisions}

        self.assertFalse(by_host['server-a']['targeted'])
        self.assertEqual(by_host['server-a']['desiredSha'], CURRENT_SHA)
        self.assertEqual(
            by_host['server-a']['targetReason'],
            'verified; no server-impacting changes',
        )
        self.assertTrue(by_host['kiosk-b']['targeted'])
        self.assertTrue(by_host['kiosk-a']['targeted'])
        self.assertEqual(by_host['kiosk-b']['desiredSha'], RELEASE_SHA)
        self.assertEqual(by_host['kiosk-b']['targetReason'], 'kiosk impact: nfc-agent')
        self.assertFalse(by_host['signage-a']['targeted'])
        self.assertEqual(by_host['signage-a']['desiredSha'], CURRENT_SHA)

    def test_unknown_host_is_targeted_even_when_role_is_not_impacted(self):
        fleet = {
            'signage-a': {
                **verified_record('signage'),
                'evidence': 'unknown',
            },
        }
        decision = POLICY.plan_target_decisions(
            [self.hosts[-1]],
            fleet,
            RELEASE_SHA,
            {CURRENT_SHA: classification()},
            self.inventory,
        )[0]

        self.assertTrue(decision['targeted'])
        self.assertEqual(decision['desiredSha'], RELEASE_SHA)
        self.assertEqual(decision['targetReason'], 'evidence unknown')

    def test_barcode_impact_uses_host_fact_only_after_verified_evidence(self):
        fleet = {
            'kiosk-b': verified_record('kiosk', desired=RELEASE_SHA),
            'kiosk-a': verified_record('kiosk'),
        }
        impact = classification(kiosk=True, components=['barcode-agent'])
        decisions = POLICY.plan_target_decisions(
            [self.hosts[1], self.hosts[2]],
            fleet,
            RELEASE_SHA,
            {CURRENT_SHA: impact},
            self.inventory,
        )

        self.assertTrue(decisions[0]['targeted'])
        self.assertEqual(decisions[0]['targetReason'], 'kiosk impact: barcode-agent')
        self.assertFalse(decisions[1]['targeted'])
        self.assertEqual(
            decisions[1]['targetReason'],
            'verified; no kiosk-impacting changes',
        )

        fleet['kiosk-a']['evidence'] = 'unknown'
        unknown = POLICY.plan_target_decisions(
            [self.hosts[2]],
            fleet,
            RELEASE_SHA,
            {CURRENT_SHA: impact},
            self.inventory,
        )[0]
        self.assertTrue(unknown['targeted'])
        self.assertEqual(unknown['targetReason'], 'evidence unknown')

    def test_unavailable_or_unknown_classification_fails_closed(self):
        fleet = {
            target['host']: verified_record(target['role'], desired=RELEASE_SHA)
            for target in self.hosts
        }
        unavailable = POLICY.plan_target_decisions(
            self.hosts,
            fleet,
            RELEASE_SHA,
            {CURRENT_SHA: {'server': False}},
            self.inventory,
        )
        self.assertTrue(all(decision['targeted'] for decision in unavailable))
        self.assertTrue(all(
            decision['targetReason'] == 'classification unavailable'
            for decision in unavailable
        ))

        unknown = POLICY.plan_target_decisions(
            self.hosts,
            fleet,
            RELEASE_SHA,
            {CURRENT_SHA: classification(components=['unknown'])},
            self.inventory,
        )
        self.assertTrue(all(decision['targeted'] for decision in unknown))
        self.assertTrue(all(
            decision['targetReason'] == 'unknown release impact'
            for decision in unknown
        ))

    def test_full_fleet_forces_exact_verified_hosts_and_is_deterministic(self):
        fleet = {
            target['host']: verified_record(target['role'], current=RELEASE_SHA)
            for target in self.hosts
        }
        before_targets = copy.deepcopy(self.hosts)
        before_fleet = copy.deepcopy(fleet)
        first = POLICY.plan_target_decisions(
            self.hosts,
            fleet,
            RELEASE_SHA,
            {},
            self.inventory,
            full_fleet=True,
        )
        second = POLICY.plan_target_decisions(
            self.hosts,
            fleet,
            RELEASE_SHA,
            {},
            self.inventory,
            full_fleet=True,
        )

        self.assertEqual(first, second)
        self.assertEqual(self.hosts, before_targets)
        self.assertEqual(fleet, before_fleet)
        self.assertTrue(all(decision['targeted'] for decision in first))
        self.assertTrue(all(
            decision['targetReason'] == 'full fleet requested'
            for decision in first
        ))

    def test_stale_recorded_desired_sha_is_not_an_exclusion_basis(self):
        record = verified_record('kiosk', current=RELEASE_SHA, desired=CURRENT_SHA)
        decision = POLICY.plan_target_decisions(
            [self.hosts[1]],
            {'kiosk-b': record},
            RELEASE_SHA,
            {},
            self.inventory,
        )[0]

        self.assertTrue(decision['targeted'])
        self.assertEqual(decision['targetReason'], 'desired SHA differs from role-specific plan')


class ReleasePlannerTest(unittest.TestCase):
    def test_fleet_payload_preserves_decision_order_and_explanations(self):
        decisions = [
            {
                'host': 'server-a',
                'role': 'server',
                'desiredSha': RELEASE_SHA,
                'currentSha': CURRENT_SHA,
                'evidence': 'verified',
                'targetReason': 'server impact: migration',
                'targeted': True,
            },
            {
                'host': 'kiosk-a',
                'role': 'kiosk',
                'desiredSha': RELEASE_SHA,
                'currentSha': None,
                'evidence': 'unknown',
                'targetReason': 'evidence unknown',
                'targeted': True,
            },
            {
                'host': 'signage-a',
                'role': 'signage',
                'desiredSha': CURRENT_SHA,
                'currentSha': CURRENT_SHA,
                'evidence': 'verified',
                'targetReason': 'verified; no signage-impacting changes',
                'targeted': False,
            },
        ]
        canary_hold = Mock(return_value=False)

        payload = PLANNER.build_fleet_plan_payload(
            release_sha=RELEASE_SHA,
            decisions=decisions,
            full_fleet=False,
            limit='',
            canary_hold_policy=canary_hold,
        )

        canary_hold.assert_called_once_with(
            [{'host': 'kiosk-a', 'terminalType': 'kiosk'}],
            0,
            skip=False,
        )
        self.assertEqual(payload['desiredSha'], RELEASE_SHA)
        self.assertFalse(payload['fullFleet'])
        self.assertTrue(payload['pi5Required'])
        self.assertEqual(payload['targetHosts'], ['server-a', 'kiosk-a'])
        self.assertEqual(payload['excludedHosts'], ['signage-a'])
        self.assertEqual(
            [target['reason'] for target in payload['targets']],
            ['server impact: migration', 'evidence unknown'],
        )
        self.assertEqual(
            payload['excluded'][0]['reason'],
            'verified; no signage-impacting changes',
        )
        self.assertEqual(payload['hosts'], decisions)
        self.assertTrue(payload['minimized'])
        self.assertFalse(payload['canaryHold'])

    def test_fleet_payload_does_not_call_canary_policy_for_noop(self):
        canary_hold = Mock()
        decision = {
            'host': 'server-a',
            'role': 'server',
            'desiredSha': RELEASE_SHA,
            'currentSha': RELEASE_SHA,
            'evidence': 'verified',
            'targetReason': 'verified at desired SHA',
            'targeted': False,
        }

        payload = PLANNER.build_fleet_plan_payload(
            release_sha=RELEASE_SHA,
            decisions=[decision],
            full_fleet=False,
            limit='server-a',
            canary_hold_policy=canary_hold,
        )

        canary_hold.assert_not_called()
        self.assertFalse(payload['pi5Required'])
        self.assertEqual(payload['targets'], [])
        self.assertEqual(payload['excludedHosts'], ['server-a'])
        self.assertFalse(payload['canaryHold'])

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
