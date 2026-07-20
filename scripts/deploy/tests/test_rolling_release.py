import argparse
from contextlib import ExitStack, contextmanager
import fcntl
import io
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).parents[1] / 'rolling-release.py'
SPEC = importlib.util.spec_from_file_location('rolling_release', SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


TARGET_SHA = 'a' * 40
BASE_SHA = 'b' * 40
FORWARD_VERIFICATION_ID = '1' * 32
ROLLBACK_VERIFICATION_ID = '2' * 32


def _verified_fleet_record(role, sha=BASE_SHA):
    record = {
        'role': role,
        'desiredSha': sha,
        'currentSha': sha,
        'previousSha': None,
        'evidence': 'verified',
        'verifiedAt': '2026-07-12T00:00:00Z',
        'lastRunId': 'prior-run',
    }
    if role == 'server':
        record.update({
            'activeSlot': 'blue',
            'apiImage': f'api:{sha}-0123456789ab',
            'webImage': f'web:{sha}-0123456789ab',
            'configDigest': 'sha256:' + 'c' * 64,
            'migrationDigest': 'sha256:' + 'd' * 64,
        })
    return record


@contextmanager
def fleet_execution_contract(targets, classification, inventory):
    """Adapt legacy facade-flow tests to the authoritative fleet contract."""

    terminal_targets = [
        {**target, 'role': target['terminalType']}
        for target in targets
    ]
    all_hosts = [{'host': 'raspberrypi5', 'role': 'server'}, *terminal_targets]
    fleet = {
        host['host']: _verified_fleet_record(host['role'])
        for host in all_hosts
    }
    initial_fleet = {
        'generation': 1,
        'activeRun': {
            'runId': 'run-1',
            'status': 'running',
            'desiredSha': TARGET_SHA,
            'inventory': 'inventory.yml',
            'startedAt': '2026-07-12T00:00:00Z',
            'kind': 'release',
        },
        'lastRun': None,
        'fleet': fleet,
    }
    generation = {'value': 1}

    def transition(*_args, **_kwargs):
        generation['value'] += 1
        return {'generation': generation['value']}

    def build_scope(**kwargs):
        decisions = MODULE.plan_target_decisions(
            all_hosts,
            fleet,
            kwargs['sha'],
            {BASE_SHA: classification},
            inventory,
            full_fleet=kwargs['full_fleet'],
        )
        plan = MODULE.release_planner.build_fleet_plan_payload(
            release_sha=kwargs['sha'],
            decisions=decisions,
            full_fleet=kwargs['full_fleet'],
            limit=kwargs['limit'],
            canary_hold_policy=MODULE.should_hold_after_canary,
        )
        target_hosts = {
            decision['host']
            for decision in decisions
            if decision['targeted'] and decision['role'] in {'kiosk', 'signage'}
        }
        selected = [target for target in terminal_targets if target['host'] in target_hosts]
        plan['terminalTargets'] = selected
        plan['classificationComponents'] = (
            None if classification is None else sorted(classification.get('components') or [])
        )
        return plan, selected, {BASE_SHA: classification}, []

    pi5_observation = {
        'currentSha': TARGET_SHA,
        'activeSlot': 'green',
        'apiImage': f'api:{TARGET_SHA}-0123456789ab',
        'webImage': f'web:{TARGET_SHA}-0123456789ab',
        'configDigest': 'sha256:' + 'e' * 64,
        'migrationDigest': 'sha256:' + 'f' * 64,
    }
    terminal_type_by_client = {
        target['clientId']: target['terminalType'] for target in terminal_targets
    }
    kiosk_ready_sha = (
        TARGET_SHA
        if classification is None or classification.get('server') is True
        else BASE_SHA
    )

    def acknowledgement_record(_run_id, client_id):
        release_sha = (
            TARGET_SHA
            if terminal_type_by_client[client_id] == 'signage'
            else kiosk_ready_sha
        )
        return {
            'ready': {
                'acknowledgedAt': '2026-07-12T00:00:00Z',
                'releaseSha': release_sha,
                'verificationId': FORWARD_VERIFICATION_ID,
            }
        }

    ensure = Mock()
    with ExitStack() as stack:
        stack.enter_context(
            patch.object(MODULE, 'fleet_begin_run', return_value=(initial_fleet, None))
        )
        stack.enter_context(patch.object(MODULE, 'reconcile_pi5_candidate_workload'))
        stack.enter_context(patch.object(MODULE, 'fleet_mark_unknown', side_effect=transition))
        stack.enter_context(patch.object(MODULE, 'fleet_mark_verified', side_effect=transition))
        stack.enter_context(patch.object(MODULE, 'fleet_finish_run', side_effect=transition))
        stack.enter_context(patch.object(MODULE, 'release_hosts', return_value=all_hosts))
        stack.enter_context(
            patch.object(
                MODULE,
                'inventory_server_identity',
                return_value={
                    'host': 'raspberrypi5',
                    'clientId': 'raspberrypi5-server',
                },
            )
        )
        stack.enter_context(patch.object(MODULE, 'build_fleet_scope', side_effect=build_scope))
        stack.enter_context(
            patch.object(
                MODULE,
                'capture_server_config_manifest',
                return_value={
                    'path': (
                        '/var/lib/raspi-release/rollback-manifests/'
                        'run-1/raspberrypi5/manifest.json'
                    ),
                    'manifestSha256': 'e' * 64,
                    'count': 3,
                },
            )
        )
        stack.enter_context(
            patch.object(
                MODULE,
                'restore_server_config_manifest',
                return_value={
                    'restored': True,
                    'manifest': (
                        '/var/lib/raspi-release/rollback-manifests/'
                        'run-1/raspberrypi5/manifest.json'
                    ),
                    'manifestSha256': 'e' * 64,
                    'count': 3,
                },
            )
        )
        stack.enter_context(patch.object(MODULE, 'converge_server_config'))
        stack.enter_context(patch.object(MODULE, 'ensure_pi5_release', ensure))
        stack.enter_context(
            patch.object(MODULE, 'observe_pi5_evidence', return_value=pi5_observation)
        )
        stack.enter_context(
            patch.object(
                MODULE,
                'observe_terminal_evidence',
                side_effect=lambda _inventory, _host, _role, client_id: {
                    'currentSha': TARGET_SHA,
                    'services': ['required.service'],
                    'authenticatedEndpoint': True,
                    'statusClientId': client_id,
                },
            )
        )
        stack.enter_context(
            patch.object(
                MODULE,
                'acknowledgement_record',
                side_effect=acknowledgement_record,
            )
        )
        stack.enter_context(
            patch.object(
                MODULE,
                'active_verification_id',
                return_value=FORWARD_VERIFICATION_ID,
            )
        )
        stack.enter_context(
            patch.object(
                MODULE,
                'capture_terminal_manifest',
                return_value={
                    'path': '/var/lib/raspi-release/rollback-manifests/run-1/host/manifest.json',
                    'manifestSha256': 'c' * 64,
                    'count': 1,
                    'runtime': {
                        'path': '/var/lib/raspi-release/rollback-runtime/run-1/host/manifest.json',
                        'manifestSha256': 'd' * 64,
                        'unitCount': 5,
                        'dockerCount': 2,
                    },
                },
            )
        )
        stack.enter_context(
            patch.object(
                MODULE,
                'cleanup_terminal_rollback',
                return_value={
                    'cleaned': True,
                    'alreadyClean': False,
                    'manifestSha256': 'd' * 64,
                    'tagCount': 2,
                    'outcome': 'committed',
                },
            )
        )
        stack.enter_context(
            patch.object(
                MODULE,
                'prepare_terminal_repository',
                return_value={
                    'head': BASE_SHA,
                    'repairedLegacyDocs': False,
                    'count': 0,
                },
            )
        )
        stack.enter_context(patch.object(MODULE, 'prove_signage_ready'))
        stack.enter_context(
            patch.object(
                MODULE,
                'refresh_signage_after_maintenance',
                return_value={
                    'signageEndpointAuthenticated': True,
                    'signageImageSha256': 'e' * 64,
                    'maintenanceArtifactReplaced': True,
                },
            )
        )
        yield ensure


class ReleaseStateReferenceTest(unittest.TestCase):
    def test_target_reference_remains_live_across_multiple_saves(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(
            MODULE, 'utc_now', return_value='2026-07-15T00:00:00Z'
        ):
            path = Path(temporary) / 'run-1.json'
            state = MODULE.ReleaseState(path, {
                'version': 1,
                'runId': 'run-1',
                'state': 'running',
                'targets': [{'host': 'kiosk-a', 'state': 'pending'}],
            })
            state.save()
            target = state.target('kiosk-a')
            target['state'] = 'deploying'
            state.save()
            self.assertIs(target, state.payload['targets'][0])
            target.update({'state': 'success', 'newSha': 'a' * 40})
            state.payload['state'] = 'success'
            state.save()

            persisted = json.loads(path.read_text(encoding='utf-8'))

        self.assertEqual(persisted['targets'][0]['state'], 'success')
        self.assertEqual(persisted['targets'][0]['newSha'], 'a' * 40)


class RollingReleaseTargetOrderTest(unittest.TestCase):
    _DEFAULT = object()

    def inventory(
        self,
        *,
        kiosks=('kiosk-a', 'kiosk-b'),
        signage=('signage-a',),
        kiosk_canary=_DEFAULT,
        signage_canary=_DEFAULT,
        children=None,
        hostvars=None,
    ):
        kiosks = list(kiosks)
        signage = list(signage)
        if kiosk_canary is self._DEFAULT:
            kiosk_canary = {'hosts': [kiosks[-1]]} if kiosks else {'hosts': []}
        if signage_canary is self._DEFAULT:
            signage_canary = {'hosts': [signage[0]]} if signage else {'hosts': []}
        if children is None:
            children = [
                group
                for group, hosts in (('kiosk', kiosks), ('signage', signage))
                if hosts
            ]
        values = {
            'server': {'status_agent_client_id': 'server-client'},
            **{
                host: {'status_agent_client_id': f'client-{host}'}
                for host in dict.fromkeys([*kiosks, *signage])
            },
        }
        if hostvars:
            for host, overrides in hostvars.items():
                values.setdefault(host, {}).update(overrides)
        return {
            'server': {'hosts': ['server']},
            'clients': {'children': list(children)},
            'kiosk_canary': kiosk_canary,
            'signage_canary': signage_canary,
            'kiosk': {'hosts': kiosks},
            'signage': {'hosts': signage},
            '_meta': {'hostvars': values},
        }

    def test_canary_then_remaining_kiosks_then_signage(self):
        inventory = self.inventory()
        self.assertEqual(
            [target['host'] for target in MODULE.release_targets(inventory)],
            ['kiosk-b', 'kiosk-a', 'signage-a'],
        )

    def test_limit_never_reintroduces_non_selected_terminal(self):
        inventory = self.inventory()
        self.assertEqual([item['host'] for item in MODULE.release_targets(inventory, ['signage-a'])], ['signage-a'])

    def test_empty_explicit_selection_never_expands_to_all_terminals(self):
        inventory = self.inventory()
        self.assertEqual(MODULE.release_targets(inventory, []), [])

    def test_remote_runner_accepts_named_branch_and_inventory(self):
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            '--remote-run', '--branch', 'main', '--inventory', 'inventory.yml',
            '--sha', 'a' * 40, '--run-id', 'run-1',
            '--expected-server-client-id', 'raspberrypi5-server',
        ]))
        self.assertEqual(args.branch, 'main')
        self.assertEqual(args.inventory, 'inventory.yml')

    def test_registry_group_not_legacy_manage_flag_defines_terminal_profile(self):
        inventory = self.inventory(
            kiosks=('terminal-a',),
            signage=(),
            hostvars={'terminal-a': {'manage_signage_lite': True}},
        )
        self.assertEqual(
            MODULE.release_targets(inventory)[0]['terminalType'], 'kiosk'
        )

    def test_duplicate_play_group_membership_fails_closed(self):
        inventory = self.inventory(
            kiosks=('terminal-a',), signage=('terminal-a',)
        )
        with self.assertRaisesRegex(RuntimeError, 'exactly one'):
            MODULE.release_targets(inventory)

    def test_duplicate_client_id_on_unselected_host_fails_closed(self):
        inventory = self.inventory(hostvars={
            'kiosk-a': {'status_agent_client_id': 'shared'},
            'signage-a': {'status_agent_client_id': 'shared'},
        })
        with self.assertRaisesRegex(RuntimeError, 'duplicate status_agent_client_id'):
            MODULE.release_targets(inventory, ['kiosk-a'])

    def test_kiosk_canary_outside_kiosk_group_fails_closed(self):
        inventory = self.inventory(
            kiosks=('kiosk-a',), signage=(),
            kiosk_canary={'hosts': ['server']},
        )
        with self.assertRaisesRegex(RuntimeError, 'must belong to kiosk'):
            MODULE.release_targets(inventory)

    def test_malformed_or_duplicate_kiosk_canary_fails_closed(self):
        for canary, expected in (
            ([], 'malformed'),
            ({'hosts': 'kiosk-a'}, 'malformed'),
            ({'hosts': 0}, 'malformed'),
            ({'hosts': ['kiosk-a', 'kiosk-a']}, 'malformed'),
        ):
            with self.subTest(canary=canary):
                inventory = self.inventory(
                    kiosks=('kiosk-a',), signage=(), kiosk_canary=canary
                )
                with self.assertRaisesRegex(RuntimeError, expected):
                    MODULE.release_targets(inventory)

    def test_unregistered_clients_group_fails_closed(self):
        inventory = self.inventory(children=['kiosk', 'signage', 'future_type'])
        with self.assertRaisesRegex(RuntimeError, 'unregistered future_type'):
            MODULE.release_targets(inventory)


class Pi5StabilityMonitorTest(unittest.TestCase):
    def test_waits_for_monitor_then_runs_cleanup_before_terminal_rollout(self):
        state = MODULE.ReleaseState(Path('/tmp/unused-release-state.json'), {'pi5': {'state': 'stability-monitoring'}})
        state.save = Mock()
        future = 1_800_000_005
        with patch.object(MODULE, 'run', side_effect=[
            '',
            json.dumps({'runtimeStatus': 'consistent', 'stableUntil': future}),
            '',
        ]) as command, patch.object(MODULE.time, 'time', return_value=future), patch.object(MODULE.time, 'sleep') as sleep:
            MODULE.wait_for_pi5_stability(state)
        sleep.assert_not_called()
        self.assertEqual(
            [call.args[0][1] for call in command.call_args_list],
            ['monitor', 'status', 'cleanup'],
        )
        self.assertEqual(state.payload['pi5']['state'], 'stable')
        self.assertEqual(state.save.call_count, 2)

    def test_cleanup_failure_is_forward_only_and_never_reclassified_as_rollback(self):
        state = MODULE.ReleaseState(
            Path('/tmp/unused-release-state.json'),
            {'pi5': {'state': 'stability-monitoring'}},
        )
        state.save = Mock()
        failure = subprocess.CalledProcessError(
            1,
            [str(MODULE.PHASE3), 'cleanup'],
            stderr='resumable cleanup fault',
        )
        with patch.object(MODULE, 'run', side_effect=[
            '',
            json.dumps({'runtimeStatus': 'consistent', 'stableUntil': 1_800_000_000}),
            failure,
        ]), patch.object(MODULE.time, 'time', return_value=1_800_000_001), \
                patch('builtins.print'):
            with self.assertRaises(subprocess.CalledProcessError):
                MODULE.wait_for_pi5_stability(state)
        self.assertEqual(state.payload['pi5']['state'], 'cleanup')
        state.save.assert_called_once()

    def test_cleanup_lock_conflict_exhausts_the_bounded_retry_window(self):
        conflict = subprocess.CalledProcessError(
            1,
            [str(MODULE.PHASE3), 'cleanup'],
            stderr=f'[ERROR] {MODULE.CLEANUP_LOCK_CONFLICT}\n',
        )
        status = json.dumps({'runtimeStatus': 'consistent', 'stableUntil': 1_800_000_000})
        with patch.object(MODULE, 'run', side_effect=[conflict, status, conflict]) as command, \
                patch.object(MODULE.time, 'monotonic', side_effect=[100, 100, 100, 130]), \
                patch.object(MODULE.time, 'time', return_value=1_800_000_001), \
                patch.object(MODULE.time, 'sleep') as sleep, \
                patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError, 'cleanup remained locked for 30s'):
                MODULE.cleanup_after_pi5_stability()
        self.assertEqual(
            [call.args[0][1] for call in command.call_args_list],
            ['cleanup', 'status', 'cleanup'],
        )
        sleep.assert_called_once_with(MODULE.CLEANUP_LOCK_RETRY_INTERVAL)

    def test_cleanup_retries_only_the_monitor_lock_conflict_after_consistent_status(self):
        conflict = subprocess.CalledProcessError(
            1,
            [str(MODULE.PHASE3), 'cleanup'],
            output='cleanup waiting for monitor\n',
            stderr=f'[ERROR] {MODULE.CLEANUP_LOCK_CONFLICT}\n',
        )
        status = json.dumps({'runtimeStatus': 'consistent', 'stableUntil': 1_800_000_000})
        with patch.object(MODULE, 'run', side_effect=[conflict, status, 'cleanup completed\n']) as command, \
                patch.object(MODULE.time, 'monotonic', return_value=100), \
                patch.object(MODULE.time, 'time', return_value=1_800_000_001), \
                patch.object(MODULE.time, 'sleep') as sleep, \
                patch('builtins.print') as printed:
            MODULE.cleanup_after_pi5_stability()
        self.assertEqual(command.call_args_list[0].args[0], [str(MODULE.PHASE3), 'cleanup'])
        self.assertEqual(command.call_args_list[1].args[0], [str(MODULE.PHASE3), 'status'])
        self.assertEqual(command.call_args_list[2].args[0], [str(MODULE.PHASE3), 'cleanup'])
        self.assertTrue(all(call.kwargs.get('capture') is True for call in command.call_args_list))
        sleep.assert_called_once_with(MODULE.CLEANUP_LOCK_RETRY_INTERVAL)
        self.assertEqual(printed.call_count, 3)
        printed.assert_any_call('cleanup completed\n', end='')

    def test_cleanup_does_not_retry_non_lock_failure(self):
        failure = subprocess.CalledProcessError(
            1,
            [str(MODULE.PHASE3), 'cleanup'],
            stderr='cleanup health check failed\n',
        )
        with patch.object(MODULE, 'run', side_effect=failure) as command, \
                patch('builtins.print'):
            with self.assertRaises(subprocess.CalledProcessError):
                MODULE.cleanup_after_pi5_stability()
        command.assert_called_once_with([str(MODULE.PHASE3), 'cleanup'], capture=True)

    def test_cleanup_lock_conflict_stops_when_phase3_is_no_longer_consistent(self):
        conflict = subprocess.CalledProcessError(
            1,
            [str(MODULE.PHASE3), 'cleanup'],
            stderr=f'[ERROR] {MODULE.CLEANUP_LOCK_CONFLICT}\n',
        )
        with patch.object(MODULE, 'run', side_effect=[conflict, json.dumps({'runtimeStatus': 'stale'})]) as command, \
                patch('builtins.print'), patch.object(MODULE.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'became inconsistent'):
                MODULE.cleanup_after_pi5_stability()
        self.assertEqual(command.call_count, 2)
        sleep.assert_not_called()


class RollbackStateTest(unittest.TestCase):
    def test_rollback_facade_delegates_to_the_manifest_adapter_only(self):
        target = {
            'state': 'rolling-back',
            'previousSha': BASE_SHA,
            'rollbackManifest': {
                'path': '/var/lib/raspi-release/rollback-manifests/run-1/kiosk-a/manifest.json',
                'manifestSha256': 'c' * 64,
                'count': 1,
                'runtime': {
                    'path': '/var/lib/raspi-release/rollback-runtime/run-1/kiosk-a/manifest.json',
                    'manifestSha256': 'd' * 64,
                    'unitCount': 5,
                    'dockerCount': 2,
                },
            },
        }
        target_spec = {'host': 'kiosk-a', 'clientId': 'client-a', 'terminalType': 'kiosk'}
        with patch.object(
            MODULE.ansible_backend, 'rollback_terminal', return_value=True
        ) as restore, patch.object(MODULE, 'state_command') as command:
            self.assertTrue(MODULE.rollback_terminal('inventory.yml', target_spec, target, 'run-1'))
        restore.assert_called_once_with(
            'inventory.yml', target_spec, target, 'run-1', runtime=MODULE
        )
        command.assert_not_called()
        self.assertNotIn('maintenanceClearedAt', target)

    def test_cleanup_facade_delegates_to_the_runtime_manifest_adapter(self):
        target = {
            'rollbackManifest': {
                'runtime': {
                    'path': '/var/lib/raspi-release/rollback-runtime/run-1/kiosk-a/manifest.json',
                    'manifestSha256': 'd' * 64,
                    'unitCount': 5,
                    'dockerCount': 2,
                },
            },
        }
        target_spec = {
            'host': 'kiosk-a',
            'clientId': 'client-a',
            'terminalType': 'kiosk',
        }
        expected = {
            'cleaned': True,
            'alreadyClean': False,
            'manifestSha256': 'd' * 64,
            'tagCount': 2,
            'outcome': 'restored',
        }
        with patch.object(
            MODULE.ansible_backend,
            'cleanup_terminal_rollback',
            return_value=expected,
        ) as cleanup:
            self.assertEqual(
                MODULE.cleanup_terminal_rollback(
                    'inventory.yml', target_spec, target, 'run-1', 'restored'
                ),
                expected,
            )
        cleanup.assert_called_once_with(
            'inventory.yml',
            target_spec,
            target,
            'run-1',
            'restored',
            runtime=MODULE,
        )

    def test_failed_manifest_adapter_result_is_not_hidden_by_the_facade(self):
        target = {'state': 'rolling-back', 'previousSha': BASE_SHA}
        target_spec = {'host': 'kiosk-a', 'clientId': 'client-a', 'terminalType': 'kiosk'}
        with patch.object(
            MODULE.ansible_backend, 'rollback_terminal', return_value=False
        ) as restore, patch.object(MODULE, 'state_command') as command:
            self.assertFalse(MODULE.rollback_terminal('inventory.yml', target_spec, target, 'run-1'))
        restore.assert_called_once_with(
            'inventory.yml', target_spec, target, 'run-1', runtime=MODULE
        )
        command.assert_not_called()
        self.assertNotIn('maintenanceClearedAt', target)


class ReadyAcknowledgementWaitTest(unittest.TestCase):
    def test_rollback_wait_ignores_cancellation_but_keeps_exact_sha_binding(self):
        release_sha = 'a' * 40
        with patch.object(MODULE.time, 'monotonic', side_effect=[0, 1]), \
                patch.object(MODULE, '_cancellation_checkpoint', side_effect=AssertionError('rollback wait was cancelled')) as checkpoint, \
                patch.object(MODULE, 'acknowledgement_received', return_value=True) as received:
            self.assertTrue(
                MODULE.wait_for_ack(
                    'run-1',
                    'client-a',
                    phase='ready',
                    release_sha=release_sha,
                    verification_id=ROLLBACK_VERIFICATION_ID,
                    cancellable=False,
                )
            )
        checkpoint.assert_not_called()
        received.assert_called_once_with(
            'run-1', 'client-a', phase='ready', release_sha=release_sha,
            verification_id=ROLLBACK_VERIFICATION_ID,
        )

    def test_ready_wait_rejects_a_missing_or_malformed_binding_before_polling(self):
        invalid_bindings = (
            (None, FORWARD_VERIFICATION_ID),
            ('short', FORWARD_VERIFICATION_ID),
            ('A' * 40, FORWARD_VERIFICATION_ID),
            ('a' * 40, None),
            ('a' * 40, 'short'),
            ('a' * 40, 'F' * 32),
        )
        for release_sha, verification_id in invalid_bindings:
            with self.subTest(
                release_sha=release_sha, verification_id=verification_id
            ), patch.object(
                MODULE.time, 'monotonic'
            ) as monotonic:
                with self.assertRaisesRegex(ValueError, 'verification ID'):
                    MODULE.wait_for_ack(
                        'run-1',
                        'client-a',
                        phase='ready',
                        release_sha=release_sha,
                        verification_id=verification_id,
                    )
                monotonic.assert_not_called()

    def test_ready_ack_rejects_a_stale_cycle_for_the_same_release_sha(self):
        release_sha = 'a' * 40
        stale = {
            'ready': {
                'acknowledgedAt': '2026-07-15T00:00:00Z',
                'releaseSha': release_sha,
                'verificationId': FORWARD_VERIFICATION_ID,
            }
        }
        with patch.object(MODULE, 'acknowledgement_record', return_value=stale):
            self.assertFalse(
                MODULE.acknowledgement_received(
                    'run-1',
                    'client-a',
                    phase='ready',
                    release_sha=release_sha,
                    verification_id=ROLLBACK_VERIFICATION_ID,
                )
            )

    def test_active_verification_id_requires_the_exact_lowercase_challenge(self):
        release_sha = 'a' * 40
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            config = project / 'config'
            config.mkdir()
            status = config / 'deploy-status.json'
            entry = {
                'maintenance': True,
                'runId': 'run-1',
                'phase': 'verifying',
                'desiredReleaseSha': release_sha,
                'verificationMode': 'rollback',
                'verificationId': ROLLBACK_VERIFICATION_ID,
            }
            status.write_text(
                json.dumps({'kioskByClient': {'client-a': entry}}),
                encoding='utf-8',
            )
            with patch.object(MODULE, 'PROJECT', project):
                self.assertEqual(
                    MODULE.active_verification_id(
                        'run-1',
                        'client-a',
                        release_sha=release_sha,
                        rollback=True,
                    ),
                    ROLLBACK_VERIFICATION_ID,
                )
                entry['verificationId'] = 'F' * 32
                status.write_text(
                    json.dumps({'kioskByClient': {'client-a': entry}}),
                    encoding='utf-8',
                )
                with self.assertRaisesRegex(RuntimeError, 'does not match'):
                    MODULE.active_verification_id(
                        'run-1',
                        'client-a',
                        release_sha=release_sha,
                        rollback=True,
                    )


class TerminalNoticeTest(unittest.TestCase):
    def _state(self):
        state = MODULE.ReleaseState(Path('/tmp/unused-release-state.json'), {'targets': []})
        state.save = Mock()
        return state

    def test_deliver_notice_waits_for_ack_then_deadline(self):
        state = self._state()
        target = {}
        target_spec = {'host': 'kiosk-a', 'clientId': 'client-a', 'terminalType': 'kiosk'}
        scheduled_at = '2026-07-13T00:01:00Z'
        with patch.object(MODULE, 'state_command') as command, \
                patch.object(MODULE, 'wait_for_ack', return_value=True) as wait_ack, \
                patch.object(MODULE, 'notice_scheduled_at', return_value=scheduled_at), \
                patch.object(MODULE, 'wait_for_notice_deadline') as wait_deadline, \
                patch.object(MODULE, 'utc_now', side_effect=['requested', 'acknowledged', 'completed']):
            MODULE.deliver_terminal_notice(state, target_spec, target, 'run-1')

        command.assert_called_once_with(
            'put-notice', '--run-id', 'run-1', '--clients', 'client-a',
            '--terminal-type', 'kiosk', '--duration-seconds', str(MODULE.NOTICE_DURATION_SECONDS),
        )
        wait_ack.assert_called_once_with(
            'run-1', 'client-a', MODULE.NOTICE_ACK_TIMEOUT_SECONDS, phase='notice',
        )
        wait_deadline.assert_called_once_with(scheduled_at)
        self.assertEqual(target['notice']['state'], 'completed')
        self.assertEqual(target['notice']['scheduledAt'], scheduled_at)

    def test_notice_ack_timeout_clears_only_the_notice_entry_and_never_deploys(self):
        state = self._state()
        target = {}
        target_spec = {'host': 'kiosk-a', 'clientId': 'client-a', 'terminalType': 'kiosk'}
        with patch.object(MODULE, 'state_command') as command, \
                patch.object(MODULE, 'wait_for_ack', return_value=False), \
                patch.object(MODULE, 'playbook') as playbook, \
                patch.object(MODULE, 'utc_now', return_value='now'):
            with self.assertRaisesRegex(RuntimeError, 'pre-deploy notice acknowledgement timed out'):
                MODULE.deliver_terminal_notice(state, target_spec, target, 'run-1')

        self.assertEqual(command.call_args_list[0].args[0], 'put-notice')
        self.assertEqual(
            command.call_args_list[1].args[0],
            'remove-client',
        )
        self.assertEqual(target['notice']['state'], 'failed')
        playbook.assert_not_called()

    def test_activation_policy_requires_notices_except_for_emergency_or_signage(self):
        self.assertTrue(MODULE.should_issue_terminal_notice(terminal_type='kiosk', emergency_override=False))
        self.assertEqual(
            MODULE.terminal_notice_skip_reason(terminal_type='kiosk', emergency_override=True),
            'emergency-override',
        )
        self.assertEqual(
            MODULE.terminal_notice_skip_reason(terminal_type='signage', emergency_override=False),
            'not-applicable',
        )


class Pi5IdempotentSkipTest(unittest.TestCase):
    def setUp(self):
        self.sha = 'a' * 40
        self.state = MODULE.ReleaseState(Path('/tmp/unused-release-state.json'), {})
        self.state.save = Mock()

    def release(self, **overrides):
        images = {
            'api': f'registry/api:{self.sha}-0123456789ab',
            'web': f'registry/web:{self.sha}-0123456789ab',
        }
        release = {'sha': self.sha, 'images': images}
        release.update(overrides)
        return release

    def phase3_status(self, **overrides):
        candidate = self.release()['images']
        status = {
            'runtimeStatus': 'consistent',
            'liveHealthStatus': 'verified',
            'runtimeConfigStatus': 'verified',
            'runtimeConfigDigest': 'sha256:' + 'f' * 64,
            'activeSlot': 'blue',
            'gateway': {'mode': 'application', 'slot': 'blue'},
            'migration': {
                'status': 'applied',
                'candidateCommit': self.sha,
                'appliedAt': '2026-07-15T00:00:00Z',
            },
            'slots': {
                'blue': {
                    'images': candidate,
                    'imageIds': {'api': 'sha256:' + '1' * 64, 'web': 'sha256:' + '2' * 64},
                },
                'green': {
                    'images': {'api': 'registry/api:previous', 'web': 'registry/web:previous'},
                    'imageIds': {'api': 'sha256:' + '3' * 64, 'web': 'sha256:' + '4' * 64},
                },
            },
        }
        status.update(overrides)
        return status

    def test_verified_release_and_consistent_runtime_skip(self):
        with patch.object(MODULE, 'recover_expired_pi5_handoff', return_value=False) as recover, \
                patch.object(MODULE, 'pi5_already_current', return_value=True) as already, \
                patch.object(MODULE, 'phase3_release') as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait:
            MODULE.ensure_pi5_release(self.sha, self.state)
        recover.assert_called_once_with(self.state)
        already.assert_called_once_with(self.sha)
        release.assert_not_called()
        wait.assert_not_called()
        self.assertEqual(self.state.payload['pi5'], {'state': 'already-current', 'sha': self.sha})
        self.state.save.assert_called_once()

    def test_release_mismatch_runs_blue_green(self):
        with patch.object(MODULE, 'read_verified_pi5_release', return_value={'sha': 'b' * 40}), \
                patch.object(MODULE, 'run') as command, \
                patch.object(MODULE, 'recover_expired_pi5_handoff', return_value=False), \
                patch.object(MODULE, 'phase3_release') as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait:
            self.state.payload['pi5'] = {'candidate': {'api': 'api:tag', 'web': 'web:tag'}, 'state': 'stable'}
            MODULE.ensure_pi5_release(self.sha, self.state)
        command.assert_not_called()
        release.assert_called_once_with(self.sha, self.state)
        wait.assert_called_once_with(self.state)

    def test_missing_verified_release_runs_blue_green(self):
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=None), \
                patch.object(MODULE, 'recover_expired_pi5_handoff', return_value=False), \
                patch.object(MODULE, 'phase3_release') as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait:
            self.state.payload['pi5'] = {'candidate': {'api': 'api:tag'}, 'state': 'stable'}
            MODULE.ensure_pi5_release(self.sha, self.state)
        release.assert_called_once_with(self.sha, self.state)
        wait.assert_called_once_with(self.state)

    def test_inconsistent_status_runs_blue_green(self):
        with patch.object(MODULE, 'read_verified_pi5_release', return_value={'sha': self.sha}), \
                patch.object(MODULE, 'run', return_value=json.dumps({'runtimeStatus': 'stale'})), \
                patch.object(MODULE, 'recover_expired_pi5_handoff', return_value=False), \
                patch.object(MODULE, 'phase3_release') as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait:
            self.state.payload['pi5'] = {'candidate': {'api': 'api:tag'}, 'state': 'stable'}
            MODULE.ensure_pi5_release(self.sha, self.state)
        release.assert_called_once_with(self.sha, self.state)
        wait.assert_called_once_with(self.state)

    def test_pi5_already_current_requires_exact_fleet_images_and_live_slot_match(self):
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release()), \
                patch.object(MODULE, 'run', return_value=json.dumps(self.phase3_status())) as command, \
                patch.object(
                    MODULE,
                    'verify_pi5_live_migrations',
                    return_value='sha256:' + 'e' * 64,
                ) as migrations:
            self.assertTrue(MODULE.pi5_already_current(self.sha))
        self.assertEqual(command.call_args.args[0], [str(MODULE.PHASE3), 'status'])
        migrations.assert_called_once_with(self.sha)

    def test_pi5_already_current_accepts_run_scoped_images_and_live_slot_match(self):
        run_digest = '9' * 64
        candidate = {
            'api': f'registry/api:{self.sha}-0123456789ab-{run_digest}',
            'web': f'registry/web:{self.sha}-0123456789ab-{run_digest}',
        }
        status = self.phase3_status()
        status['slots']['blue']['images'] = candidate
        with patch.object(
                MODULE, 'read_verified_pi5_release', return_value=self.release(images=candidate)
            ), patch.object(MODULE, 'run', return_value=json.dumps(status)), patch.object(
                MODULE,
                'verify_pi5_live_migrations',
                return_value='sha256:' + 'e' * 64,
            ):
            self.assertTrue(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_requires_applied_live_migration_ledger(self):
        for migration, verification_error in (
            ({'status': 'checked', 'candidateCommit': self.sha, 'appliedAt': None}, None),
            (
                {
                    'status': 'applied',
                    'candidateCommit': 'b' * 40,
                    'appliedAt': '2026-07-15T00:00:00Z',
                },
                None,
            ),
            (self.phase3_status()['migration'], RuntimeError('missing applied migration')),
            (self.phase3_status()['migration'], RuntimeError('checksum mismatch')),
        ):
            with self.subTest(migration=migration, error=verification_error):
                status = self.phase3_status(migration=migration)
                verifier = Mock(
                    side_effect=verification_error,
                    return_value='sha256:' + 'e' * 64,
                )
                with patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release()), \
                        patch.object(MODULE, 'run', return_value=json.dumps(status)), \
                        patch.object(MODULE, 'verify_pi5_live_migrations', verifier):
                    self.assertFalse(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_accepts_zero_new_migration_after_full_live_verification(self):
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release()), \
                patch.object(MODULE, 'run', return_value=json.dumps(self.phase3_status())), \
                patch.object(
                    MODULE,
                    'verify_pi5_live_migrations',
                    return_value='sha256:' + 'd' * 64,
                ):
            self.assertTrue(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_rejects_incomplete_fleet_images_without_status_call(self):
        malformed = {'sha': self.sha, 'images': {'api': f'registry/api:{self.sha}-0123456789ab'}}
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=malformed), \
                patch.object(MODULE, 'run') as command:
            self.assertFalse(MODULE.pi5_already_current(self.sha))
        command.assert_not_called()

    def test_pi5_already_current_rejects_candidate_tag_for_another_sha(self):
        candidate = self.release()['images'].copy()
        candidate['web'] = f"registry/web:{'b' * 40}-0123456789ab"
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release(images=candidate)), \
                patch.object(MODULE, 'run') as command:
            self.assertFalse(MODULE.pi5_already_current(self.sha))
        command.assert_not_called()

    def test_pi5_already_current_rejects_active_slot_image_mismatch(self):
        status = self.phase3_status()
        status['slots']['blue']['images']['web'] = 'registry/web:other'
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release()), \
                patch.object(MODULE, 'run', return_value=json.dumps(status)):
            self.assertFalse(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_rejects_gateway_slot_mismatch(self):
        status = self.phase3_status()
        status['gateway']['slot'] = 'green'
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release()), \
                patch.object(MODULE, 'run', return_value=json.dumps(status)):
            self.assertFalse(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_requires_verified_runtime_configuration(self):
        for overrides in (
            {'runtimeConfigStatus': 'mismatch'},
            {'runtimeConfigStatus': 'not-checked'},
            {'runtimeConfigDigest': None},
            {'runtimeConfigDigest': 'sha256:not-a-digest'},
        ):
            with self.subTest(overrides=overrides):
                status = self.phase3_status(**overrides)
                with patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release()), \
                        patch.object(MODULE, 'run', return_value=json.dumps(status)):
                    self.assertFalse(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_requires_verified_live_health(self):
        for value in (None, 'failed', 'not-checked'):
            with self.subTest(value=value), \
                    patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release()), \
                    patch.object(
                        MODULE,
                        'run',
                        return_value=json.dumps(self.phase3_status(liveHealthStatus=value)),
                    ):
                self.assertFalse(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_fail_closed_on_status_error(self):
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=self.release()), \
                patch.object(MODULE, 'run', side_effect=RuntimeError('status unavailable')):
            self.assertFalse(MODULE.pi5_already_current(self.sha))


class Pi5ExpiredHandoffPreflightTest(unittest.TestCase):
    def setUp(self):
        self.sha = 'a' * 40
        self.state = MODULE.ReleaseState(
            Path('/tmp/unused-release-state.json'), {'runId': 'run-1'}
        )
        self.state.save = Mock()
        reconcile = patch.object(
            MODULE, 'reconcile_pi5_candidate_workload', return_value=None
        )
        reconcile.start()
        self.addCleanup(reconcile.stop)

    def assert_structural_call(self, call, operation, *, capture):
        self.assertEqual(call.args[0], [str(MODULE.PHASE3), operation])
        self.assertEqual(call.kwargs.get('capture', False), capture)
        self.assertEqual(
            call.kwargs['env']['PI5_PRIOR_HANDOFF_RECOVERY_RUN_ID'], 'run-1'
        )

    def assert_seal_call(self, call):
        self.assert_structural_call(call, 'seal-image-ids', capture=False)

    @staticmethod
    def normal_status():
        return {
            'event': 'cleaned',
            'runtimeStatus': 'consistent',
            'liveHealthStatus': 'verified',
            'activeSlot': 'green',
            'previousSlot': None,
            'candidateSlot': None,
            'stableUntil': None,
            'gateway': {'mode': 'application', 'slot': 'green'},
            'monitor': {'activeSlot': None, 'rollbackSlot': None},
            'slots': {
                'green': {
                    'images': {'api': 'registry/api:current', 'web': 'registry/web:current'},
                    'imageIds': {'api': 'sha256:' + '1' * 64, 'web': 'sha256:' + '2' * 64},
                },
                'blue': {
                    'images': {'api': 'registry/api:previous', 'web': 'registry/web:previous'},
                    'imageIds': {'api': 'sha256:' + '3' * 64, 'web': 'sha256:' + '4' * 64},
                },
            },
        }

    @staticmethod
    def expired_status(stable_until=1_800_000_000):
        return {
            'event': 'active',
            'runtimeStatus': 'consistent',
            'liveHealthStatus': 'verified',
            'activeSlot': 'green',
            'previousSlot': 'blue',
            'candidateSlot': 'blue',
            'stableUntil': stable_until,
            'gateway': {'mode': 'application', 'slot': 'green'},
            'monitor': {'activeSlot': 'green', 'rollbackSlot': 'blue'},
            'slots': {
                'green': {
                    'images': {'api': 'registry/api:current', 'web': 'registry/web:current'},
                    'imageIds': {'api': 'sha256:' + '1' * 64, 'web': 'sha256:' + '2' * 64},
                },
                'blue': {
                    'images': {'api': 'registry/api:previous', 'web': 'registry/web:previous'},
                    'imageIds': {'api': 'sha256:' + '3' * 64, 'web': 'sha256:' + '4' * 64},
                },
            },
        }

    @classmethod
    def cleanup_handoff_status(cls):
        status = cls.expired_status(stable_until=None)
        status['event'] = 'cleanup-handoff'
        status['monitor'] = {'activeSlot': None, 'rollbackSlot': None}
        return status

    @classmethod
    def monitor_passed_status(cls):
        status = cls.expired_status()
        status['event'] = 'monitor-passed'
        return status

    @classmethod
    def prepared_status(cls):
        status = cls.normal_status()
        status.update({
            'event': 'prepared',
            'activeSlot': 'blue',
            'candidateSlot': 'green',
            'gateway': {'mode': 'application', 'slot': 'blue'},
        })
        return status

    @classmethod
    def switching_status(cls, event='switching'):
        status = cls.prepared_status()
        status.update({'event': event, 'previousSlot': 'blue'})
        return status

    @classmethod
    def rolled_back_status(cls):
        status = cls.switching_status('rolled-back')
        status.update({
            'candidateSlot': 'green',
            'previousSlot': 'green',
            'gateway': {'mode': 'application', 'slot': 'blue'},
        })
        return status

    def test_normal_single_slot_state_is_a_noop(self):
        with patch.object(MODULE, 'run', return_value=json.dumps(self.normal_status())) as command:
            self.assertFalse(MODULE.recover_expired_pi5_handoff(self.state))
        self.assert_seal_call(command.call_args_list[0])
        self.assert_structural_call(command.call_args, 'status', capture=True)

    def test_not_initialized_state_is_a_noop(self):
        with patch.object(MODULE, 'run', return_value=json.dumps({'state': 'not-initialized'})) as command:
            self.assertFalse(MODULE.recover_expired_pi5_handoff(self.state))
        self.assert_seal_call(command.call_args_list[0])
        self.assert_structural_call(command.call_args, 'status', capture=True)

    def test_interrupted_window_restarts_full_monitor_before_cleanup_and_build(self):
        events = []
        completed = self.monitor_passed_status()
        responses = iter([
            '',
            json.dumps(self.expired_status()),
            '',
            '',
            json.dumps(completed),
            '',
            json.dumps(self.normal_status()),
        ])

        def run(command_line, **_kwargs):
            if command_line[1] in {'restart-monitor', 'monitor', 'cleanup'}:
                events.append(command_line[1])
            if command_line[1] == 'cleanup':
                pass
            return next(responses)

        def released(_sha, _state):
            self.assertEqual(events, ['restart-monitor', 'monitor', 'cleanup'])
            events.append('release')

        with patch.object(MODULE, 'pi5_already_current', return_value=False), \
                patch.object(MODULE, 'run', side_effect=run) as command, \
                patch.object(MODULE.time, 'time', return_value=1_800_000_001), \
                patch.object(MODULE, 'phase3_release', side_effect=released) as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait:
            MODULE.ensure_pi5_release(self.sha, self.state)
        self.assertEqual(
            [call.args[0][1] for call in command.call_args_list[:7]],
            ['seal-image-ids', 'status', 'restart-monitor', 'monitor', 'status', 'cleanup', 'status'],
        )
        self.assert_seal_call(command.call_args_list[0])
        self.assert_structural_call(command.call_args_list[1], 'status', capture=True)
        self.assert_structural_call(command.call_args_list[2], 'restart-monitor', capture=False)
        self.assert_structural_call(command.call_args_list[3], 'monitor', capture=False)
        release.assert_called_once_with(self.sha, self.state)
        wait.assert_called_once_with(self.state)
        self.assertEqual(events, ['restart-monitor', 'monitor', 'cleanup', 'release'])
        self.assertEqual(self.state.payload['pi5HandoffRecovery'], {
            'state': 'interrupted-window-reverified',
            'activeSlot': 'green',
            'previousSlot': 'blue',
            'completedAt': unittest.mock.ANY,
        })
        self.state.save.assert_called_once()

    def test_partial_cleanup_handoff_is_resumed_before_new_candidate_build(self):
        responses = iter([
            '',
            json.dumps(self.cleanup_handoff_status()),
            '',
            json.dumps(self.normal_status()),
        ])
        with patch.object(MODULE, 'run', side_effect=lambda *_args, **_kwargs: next(responses)) as command:
            self.assertTrue(MODULE.recover_expired_pi5_handoff(self.state))
        self.assertEqual(
            [call.args[0][1] for call in command.call_args_list],
            ['seal-image-ids', 'status', 'cleanup', 'status'],
        )
        self.assertEqual(self.state.payload['pi5HandoffRecovery'], {
            'state': 'cleanup-handoff-resumed',
            'activeSlot': 'green',
            'previousSlot': 'blue',
            'completedAt': unittest.mock.ANY,
        })
        self.state.save.assert_called_once()

    def test_forward_cleanup_requires_exact_live_gateway_and_slot_health(self):
        for status in (self.cleanup_handoff_status(), self.monitor_passed_status()):
            for drift in ('stale-gateway', 'stale-slot'):
                with self.subTest(event=status['event'], drift=drift):
                    observed = json.loads(json.dumps(status))
                    observed['runtimeStatus'] = 'stale'
                    observed['liveHealthStatus'] = 'failed'
                    if drift == 'stale-gateway':
                        observed['gateway']['slot'] = observed['previousSlot']
                    else:
                        observed['slots'][observed['activeSlot']]['imageIds']['api'] = (
                            'sha256:' + '9' * 64
                        )
                    with patch.object(
                        MODULE,
                        'run',
                        side_effect=['', json.dumps(observed)],
                    ) as command:
                        with self.assertRaisesRegex(
                            RuntimeError,
                            'malformed|incomplete or unsafe|cleanup authority',
                        ):
                            MODULE.recover_expired_pi5_handoff(self.state)
                    self.assertEqual(
                        [call.args[0][1] for call in command.call_args_list],
                        ['seal-image-ids', 'status'],
                    )

    def test_prepared_candidate_is_discarded_idempotently_before_planning(self):
        normal = self.normal_status()
        normal.update({'activeSlot': 'blue', 'gateway': {'mode': 'application', 'slot': 'blue'}})
        responses = iter(['', json.dumps(self.prepared_status()), '', json.dumps(normal)])
        with patch.object(MODULE, 'run', side_effect=lambda *_args, **_kwargs: next(responses)) as command:
            self.assertTrue(MODULE.recover_expired_pi5_handoff(self.state))
        self.assertEqual(
            [call.args[0][1] for call in command.call_args_list],
            ['seal-image-ids', 'status', 'cleanup', 'status'],
        )
        self.assertEqual(
            self.state.payload['pi5HandoffRecovery']['state'],
            'prepared-candidate-discarded',
        )

    def test_interrupted_candidate_preparation_boundaries_are_discarded(self):
        normal = self.normal_status()
        normal.update({'activeSlot': 'blue', 'gateway': {'mode': 'application', 'slot': 'blue'}})
        for event in ('preparing', 'prepare-failed', 'candidate-prepared'):
            with self.subTest(event=event):
                interrupted = self.prepared_status()
                interrupted['event'] = event
                responses = iter(['', json.dumps(interrupted), '', json.dumps(normal)])
                self.state.payload.pop('pi5HandoffRecovery', None)
                self.state.save.reset_mock()
                with patch.object(
                    MODULE, 'run', side_effect=lambda *_args, **_kwargs: next(responses)
                ) as command:
                    self.assertTrue(MODULE.recover_expired_pi5_handoff(self.state))
                self.assertEqual(
                    [call.args[0][1] for call in command.call_args_list],
                    ['seal-image-ids', 'status', 'cleanup', 'status'],
                )
                self.assertEqual(
                    self.state.payload['pi5HandoffRecovery']['state'],
                    'prepared-candidate-discarded',
                )

    def test_switching_and_switch_failed_are_durably_switched_back(self):
        normal = self.normal_status()
        normal.update({'activeSlot': 'blue', 'gateway': {'mode': 'application', 'slot': 'blue'}})
        for event in ('switching', 'switch-failed'):
            with self.subTest(event=event):
                responses = iter([
                    '',
                    json.dumps(self.switching_status(event)),
                    '',
                    json.dumps(self.rolled_back_status()),
                    '',
                    json.dumps(normal),
                ])
                with patch.object(
                    MODULE, 'run', side_effect=lambda *_args, **_kwargs: next(responses)
                ) as command:
                    self.assertTrue(MODULE.recover_expired_pi5_handoff(self.state))
                self.assertEqual(
                    [call.args[0][1] for call in command.call_args_list],
                    ['seal-image-ids', 'status', 'rollback', 'status', 'cleanup', 'status'],
                )
                self.assertEqual(
                    self.state.payload['pi5HandoffRecovery']['state'],
                    'interrupted-handoff-rolled-back',
                )

    def test_stale_status_fails_closed_without_cleanup(self):
        stale = self.expired_status()
        stale['runtimeStatus'] = 'stale'
        with patch.object(MODULE, 'run', return_value=json.dumps(stale)) as command:
            with self.assertRaisesRegex(RuntimeError, 'switchback lacks exact'):
                MODULE.recover_expired_pi5_handoff(self.state)
        self.assert_seal_call(command.call_args_list[0])
        self.assert_structural_call(command.call_args, 'status', capture=True)

    def test_status_error_fails_closed_without_cleanup(self):
        with patch.object(MODULE, 'run', side_effect=RuntimeError('status unavailable')) as command:
            with self.assertRaisesRegex(RuntimeError, 'status unavailable'):
                MODULE.recover_expired_pi5_handoff(self.state)
        self.assert_seal_call(command.call_args)

    def test_cleanup_error_does_not_retry_or_start_candidate_build(self):
        failure = subprocess.CalledProcessError(1, [str(MODULE.PHASE3), 'cleanup'])
        with patch.object(MODULE, 'pi5_already_current') as already, \
                patch.object(MODULE, 'run', side_effect=['', json.dumps(self.monitor_passed_status()), failure]) as command, \
                patch.object(MODULE.time, 'time', return_value=1_800_000_001), \
                patch.object(MODULE, 'phase3_release') as release:
            with self.assertRaises(subprocess.CalledProcessError):
                MODULE.ensure_pi5_release(self.sha, self.state)
        self.assertEqual([call.args[0][1] for call in command.call_args_list], ['seal-image-ids', 'status', 'cleanup'])
        already.assert_not_called()
        release.assert_not_called()

    def test_postcleanup_state_must_be_normalized_before_candidate_build(self):
        postcleanup = self.monitor_passed_status()
        with patch.object(MODULE, 'pi5_already_current') as already, \
                patch.object(MODULE, 'run', side_effect=[
                    '',
                    json.dumps(self.monitor_passed_status()),
                    '',
                    json.dumps(postcleanup),
                ]) as command, \
                patch.object(MODULE.time, 'time', return_value=1_800_000_001), \
                patch.object(MODULE, 'phase3_release') as release:
            with self.assertRaisesRegex(RuntimeError, 'did not produce a normalized'):
                MODULE.ensure_pi5_release(self.sha, self.state)
        self.assertEqual([call.args[0][1] for call in command.call_args_list], ['seal-image-ids', 'status', 'cleanup', 'status'])
        already.assert_not_called()
        release.assert_not_called()

    def test_expired_recovery_runs_before_same_sha_skip(self):
        events = []

        def recover(state):
            self.assertIs(state, self.state)
            events.append('recovery')
            return True

        def already(_sha):
            self.assertEqual(events, ['recovery'])
            events.append('already-current')
            return True

        with patch.object(MODULE, 'recover_expired_pi5_handoff', side_effect=recover), \
                patch.object(MODULE, 'pi5_already_current', side_effect=already), \
                patch.object(MODULE, 'phase3_release') as release:
            MODULE.ensure_pi5_release(self.sha, self.state)
        self.assertEqual(events, ['recovery', 'already-current'])
        release.assert_not_called()


class DeployClassificationBaselineTest(unittest.TestCase):
    BASE = 'b' * 40
    TARGET = 'a' * 40

    def test_post_merge_target_uses_persisted_pi5_marker_as_diff_base(self):
        classification = {
            'server': True, 'kiosk': False, 'signage': False, 'migration': False,
            'components': ['server-app'],
        }
        with patch.object(MODULE, 'run', side_effect=['', json.dumps(classification)]) as command:
            result, warnings = MODULE.classify_release_impact(self.TARGET, {'sha': self.BASE})
        self.assertEqual(result, classification)
        self.assertEqual(warnings, [])
        self.assertEqual(
            command.call_args_list[0].args[0],
            ['git', '-C', str(MODULE.PROJECT), 'merge-base', '--is-ancestor', self.BASE, self.TARGET],
        )
        self.assertEqual(command.call_args_list[1].args[0][-4:], ['--base', self.BASE, '--head', self.TARGET])

    def test_missing_or_invalid_baseline_fails_closed_before_running_classifier(self):
        for baseline in (None, {}, {'sha': 'not-a-sha'}):
            with self.subTest(baseline=baseline), patch.object(MODULE, 'run') as command:
                classification, warnings = MODULE.classify_release_impact(self.TARGET, baseline)
            self.assertIsNone(classification)
            self.assertIn('classification unavailable', warnings[0])
            command.assert_not_called()

    def test_matching_verified_baseline_is_a_neutral_classification(self):
        with patch.object(MODULE, 'run') as command:
            classification, warnings = MODULE.classify_release_impact(self.TARGET, {'sha': self.TARGET})
        self.assertEqual(classification['components'], ['neutral'])
        self.assertFalse(any(classification[key] for key in ('server', 'kiosk', 'signage', 'migration')))
        self.assertEqual(warnings, [])
        command.assert_not_called()

    def test_non_ancestor_baseline_fails_closed(self):
        with patch.object(MODULE, 'run', side_effect=RuntimeError('not an ancestor')) as command:
            classification, warnings = MODULE.classify_release_impact(self.TARGET, {'sha': self.BASE})
        self.assertIsNone(classification)
        self.assertIn('not an ancestor of target', warnings[0])
        command.assert_called_once_with(
            ['git', '-C', str(MODULE.PROJECT), 'merge-base', '--is-ancestor', self.BASE, self.TARGET],
            capture=True,
        )

    def test_pi5_requirement_is_true_when_verified_release_is_missing(self):
        with patch.object(MODULE, 'read_verified_pi5_release', return_value=None):
            self.assertTrue(MODULE.pi5_release_required(self.TARGET))

    def test_unknown_fleet_server_has_no_verified_release(self):
        unknown = _verified_fleet_record('server', self.BASE)
        unknown.update({
            'evidence': 'unknown',
            'verifiedAt': None,
            'activeSlot': None,
            'apiImage': None,
            'webImage': None,
            'configDigest': None,
            'migrationDigest': None,
        })
        fleet_state = {
            'generation': 2,
            'activeRun': None,
            'lastRun': None,
            'fleet': {'raspberrypi5': unknown},
        }
        with patch.object(MODULE, 'read_fleet_release_state', return_value=fleet_state):
            self.assertIsNone(MODULE.read_verified_pi5_release())

    def test_multiple_server_records_disable_skip_without_blocking_repair(self):
        fleet_state = {
            'generation': 3,
            'activeRun': None,
            'lastRun': None,
            'fleet': {
                'old-pi5': _verified_fleet_record('server', self.BASE),
                'raspberrypi5': _verified_fleet_record('server', self.TARGET),
            },
        }
        with patch.object(MODULE, 'read_fleet_release_state', return_value=fleet_state):
            self.assertIsNone(MODULE.read_verified_pi5_release())


class CanaryHoldTest(unittest.TestCase):
    TERMINAL_CLASSIFICATION = {
        'server': False,
        'kiosk': True,
        'signage': True,
        'migration': False,
        'components': ['terminal-test'],
    }

    def _args(self, **overrides):
        values = {
            'inventory': 'inventory.yml',
            'limit': '',
            'run_id': 'run-1',
            'branch': 'main',
            'sha': 'a' * 40,
            'emergency_override': False,
            'reason': None,
            'skip_canary_hold': False,
            'canary_hold_timeout': 60,
            'full_fleet': False,
            'expected_server_client_id': 'raspberrypi5-server',
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def _run_remote(self, targets, *, wait_for_canary_approval, args=None, played=None):
        played = played if played is not None else []

        def playbook(_inventory, host, _sha, _run_id, rollback=False):
            played.append(host)

        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    fleet_execution_contract(targets, self.TERMINAL_CLASSIFICATION, {}), \
                    patch.object(MODULE, 'remote_previous_sha', return_value=BASE_SHA), \
                    patch.object(MODULE, 'should_issue_terminal_notice', return_value=False), \
                    patch.object(MODULE, 'wait_for_ack', return_value=True), \
                    patch.object(MODULE, 'wait_for_canary_approval', side_effect=wait_for_canary_approval), \
                    patch.object(MODULE, 'state_command'), \
                    patch.object(MODULE, 'prestage_signage_maintenance'), \
                    patch.object(MODULE, 'playbook', side_effect=playbook), \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(args or self._args())
            state_path = run_directory / 'run-1.json'
            payload = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else None
        return result, played, payload

    def test_canary_hold_continues_after_operator_ack(self):
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]
        hold_calls = []

        def wait_for_canary_approval(run_id, timeout):
            hold_calls.append((run_id, timeout))
            return {
                'state': 'approved', 'canary': 'kiosk-canary',
                'approvedAt': '2026-07-12T00:01:00Z',
                'approvedBy': MODULE.OPERATOR_CANARY_APPROVAL_CLIENT,
            }

        result, played, payload = self._run_remote(
            targets,
            wait_for_canary_approval=wait_for_canary_approval,
            args=self._args(limit='kiosk'),
        )
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary', 'kiosk-b'])
        self.assertIn(('run-1', 60), hold_calls)
        self.assertEqual(payload['canaryHold']['state'], 'approved')
        self.assertEqual(payload['canaryHold']['canary'], 'kiosk-canary')
        self.assertEqual(payload['canaryHold']['approvedBy'], MODULE.OPERATOR_CANARY_APPROVAL_CLIENT)
        self.assertEqual(payload['state'], 'success')
        self.assertEqual(payload['limitHosts'], 'kiosk')
        self.assertEqual(payload['exitCode'], 0)
        self.assertEqual(payload['endedAt'], payload['completedAt'])

    def test_canary_hold_timeout_fails_closed_without_remaining_targets(self):
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]

        def wait_for_canary_approval(_run_id, timeout):
            raise RuntimeError(
                f'canary hold timed out after {timeout}s waiting for operator approval '
                f'(client={MODULE.OPERATOR_CANARY_APPROVAL_CLIENT})'
            )

        played = []

        def playbook(_inventory, host, _sha, _run_id, rollback=False):
            played.append(host)

        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    fleet_execution_contract(targets, self.TERMINAL_CLASSIFICATION, {}), \
                    patch.object(MODULE, 'remote_previous_sha', return_value=BASE_SHA), \
                    patch.object(MODULE, 'should_issue_terminal_notice', return_value=False), \
                    patch.object(MODULE, 'wait_for_ack', return_value=True), \
                    patch.object(MODULE, 'wait_for_canary_approval', side_effect=wait_for_canary_approval), \
                    patch.object(MODULE, 'state_command'), \
                    patch.object(MODULE, 'playbook', side_effect=playbook), \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                with self.assertRaises(RuntimeError) as raised:
                    MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        self.assertIn('canary hold timed out', str(raised.exception))
        self.assertEqual(played, ['kiosk-canary'])
        self.assertEqual(payload['canaryHold']['state'], 'waiting-verification')
        self.assertEqual(payload['state'], 'failed')

    def test_skip_canary_hold_rolls_out_all_targets(self):
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]
        hold_calls = []

        def wait_for_canary_approval(run_id, timeout):
            hold_calls.append((run_id, timeout))
            return {'state': 'approved'}

        result, played, payload = self._run_remote(
            targets,
            wait_for_canary_approval=wait_for_canary_approval,
            args=self._args(skip_canary_hold=True),
        )
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary', 'kiosk-b'])
        self.assertEqual(hold_calls, [])

    def test_cancel_after_first_terminal_never_starts_the_second(self):
        targets = [
            {'host': 'signage-a', 'clientId': 'a', 'terminalType': 'signage'},
            {'host': 'signage-b', 'clientId': 'b', 'terminalType': 'signage'},
        ]
        played = []
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)

            def playbook(_inventory, host, _sha, _run_id, rollback=False):
                played.append(host)
                control = run_directory / 'run-1.control.json'
                control.write_text(
                    json.dumps({
                        'version': 1,
                        'runId': 'run-1',
                        'unitName': 'raspi-release-run-1.service',
                        'requestedAt': '2026-07-12T00:00:00Z',
                        'requestedBy': 'operator-cli',
                        'reason': 'stop between terminals',
                    }),
                    encoding='utf-8',
                )

            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    fleet_execution_contract(targets, self.TERMINAL_CLASSIFICATION, {}), \
                    patch.object(MODULE, 'remote_previous_sha', return_value=BASE_SHA), \
                    patch.object(MODULE, 'should_issue_terminal_notice', return_value=False), \
                    patch.object(MODULE, 'wait_for_ack', return_value=True), \
                    patch.object(MODULE, 'state_command') as state_command, \
                    patch.object(MODULE, 'prestage_signage_maintenance'), \
                    patch.object(MODULE, 'playbook', side_effect=playbook), \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))

        self.assertEqual(result, 130)
        self.assertEqual(played, ['signage-a'])
        self.assertEqual(payload['state'], 'cancelled')
        self.assertEqual(payload['exitCode'], 130)
        self.assertEqual(payload['targets'][1]['state'], 'pending')
        self.assertEqual(payload['cancellationCleanup']['state'], 'success')
        self.assertIn(
            unittest.mock.call('remove-run', '--run-id', 'run-1'),
            state_command.call_args_list,
        )
        self.assertNotIn('canaryHold', payload)

    def test_cancel_cleanup_failure_is_a_failed_run_not_a_clean_cancel(self):
        targets = [
            {'host': 'signage-a', 'clientId': 'a', 'terminalType': 'signage'},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)

            def playbook(_inventory, _host, _sha, _run_id, rollback=False):
                (run_directory / 'run-1.control.json').write_text(
                    json.dumps({
                        'version': 1,
                        'runId': 'run-1',
                        'unitName': 'raspi-release-run-1.service',
                        'requestedAt': '2026-07-12T00:00:00Z',
                        'requestedBy': 'operator-cli',
                        'reason': 'stop safely',
                    }),
                    encoding='utf-8',
                )

            def state_command(*arguments):
                if arguments[0] == 'remove-run':
                    raise RuntimeError('deploy-status cleanup unavailable')

            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    fleet_execution_contract(targets, self.TERMINAL_CLASSIFICATION, {}), \
                    patch.object(MODULE, 'remote_previous_sha', return_value=BASE_SHA), \
                    patch.object(MODULE, 'should_issue_terminal_notice', return_value=False), \
                    patch.object(MODULE, 'wait_for_ack', return_value=True), \
                    patch.object(MODULE, 'state_command', side_effect=state_command), \
                    patch.object(MODULE, 'prestage_signage_maintenance'), \
                    patch.object(MODULE, 'playbook', side_effect=playbook), \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))

        self.assertEqual(result, 1)
        self.assertEqual(payload['state'], 'failed')
        self.assertEqual(payload['exitCode'], 1)
        self.assertEqual(payload['cancellationCleanup']['state'], 'failed')
        self.assertIn('cleanup unavailable', payload['failure'])

    def test_single_canary_target_skips_hold(self):
        targets = [{'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'}]
        hold_calls = []

        def wait_for_canary_approval(run_id, timeout):
            hold_calls.append((run_id, timeout))
            return {'state': 'approved'}

        result, played, payload = self._run_remote(targets, wait_for_canary_approval=wait_for_canary_approval)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary'])
        self.assertEqual(hold_calls, [])
        self.assertNotIn('canaryHold', payload)

    def test_signage_only_skips_hold(self):
        targets = [
            {'host': 'signage-a', 'clientId': 's1', 'terminalType': 'signage'},
            {'host': 'signage-b', 'clientId': 's2', 'terminalType': 'signage'},
        ]
        hold_calls = []

        def wait_for_canary_approval(run_id, timeout):
            hold_calls.append((run_id, timeout))
            return {'state': 'approved'}

        result, played, payload = self._run_remote(targets, wait_for_canary_approval=wait_for_canary_approval)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['signage-a', 'signage-b'])
        self.assertEqual(hold_calls, [])
        self.assertNotIn('canaryHold', payload)

    def test_expiry_transition_stops_when_expire_wins(self):
        waiting = {'state': 'waiting-verification'}
        expired = {'state': 'expired'}
        with patch.object(MODULE, 'canary_hold_record', side_effect=[waiting, expired]), \
                patch.object(MODULE, 'state_command') as state_command, \
                patch.object(MODULE.time, 'monotonic', side_effect=[0, 60]):
            with self.assertRaisesRegex(RuntimeError, 'canary hold timed out'):
                MODULE.wait_for_canary_approval('run-1', 60)
        state_command.assert_called_once_with('expire-canary-hold', '--run-id', 'run-1')

    def test_expiry_transition_continues_only_when_approval_wins(self):
        waiting = {'state': 'waiting-verification'}
        approved = {'state': 'approved', 'approvedBy': MODULE.OPERATOR_CANARY_APPROVAL_CLIENT}
        with patch.object(MODULE, 'canary_hold_record', side_effect=[waiting, approved]), \
                patch.object(MODULE, 'state_command') as state_command, \
                patch.object(MODULE.time, 'monotonic', side_effect=[0, 60]):
            result = MODULE.wait_for_canary_approval('run-1', 60)
        self.assertEqual(result, approved)
        state_command.assert_called_once_with('expire-canary-hold', '--run-id', 'run-1')

    def test_hold_state_is_saved_before_the_pending_gate_is_opened(self):
        state = MODULE.ReleaseState(Path('/tmp/unused-release-state.json'), {})
        events = []
        state.save = Mock(side_effect=lambda: events.append('release-state-save'))

        def state_command(*arguments):
            events.append(('status-command', arguments))

        with patch.object(MODULE, 'state_command', side_effect=state_command), \
                patch.object(MODULE, 'wait_for_canary_approval', return_value={'state': 'approved'}), \
                patch.object(MODULE.time, 'time', return_value=1_800_000_000):
            MODULE.wait_for_canary_hold(state, 'run-1', 'kiosk-canary', 60)

        self.assertEqual(events[0], 'release-state-save')
        self.assertEqual(
            events[1],
            ('status-command', ('open-canary-hold', '--run-id', 'run-1', '--canary', 'kiosk-canary', '--expires-at', '1800000060')),
        )

    def test_profile_gate_history_preserves_two_sequential_approvals(self):
        state = MODULE.ReleaseState(Path('/tmp/unused-release-state.json'), {})
        state.save = Mock()
        approvals = [
            {
                'state': 'approved',
                'canary': 'kiosk-canary',
                'approvedAt': '2026-07-12T00:01:00Z',
                'approvedBy': MODULE.OPERATOR_CANARY_APPROVAL_CLIENT,
            },
            {
                'state': 'approved',
                'canary': 'assembly-canary',
                'approvedAt': '2026-07-12T00:02:00Z',
                'approvedBy': MODULE.OPERATOR_CANARY_APPROVAL_CLIENT,
            },
        ]
        with patch.object(MODULE, 'state_command'), \
                patch.object(MODULE, 'wait_for_canary_approval', side_effect=approvals), \
                patch.object(MODULE.time, 'time', return_value=1_800_000_000):
            MODULE.wait_for_canary_hold(
                state, 'run-1', 'kiosk-canary', 60, profile_id='kiosk'
            )
            MODULE.wait_for_canary_hold(
                state, 'run-1', 'assembly-canary', 60,
                profile_id='assembly-console',
            )

        self.assertEqual(
            [gate['profile'] for gate in state.payload['approvalGates']],
            ['kiosk', 'assembly-console'],
        )
        self.assertTrue(
            all(gate['state'] == 'approved' for gate in state.payload['approvalGates'])
        )
        self.assertEqual(state.payload['canaryHold']['profile'], 'assembly-console')

    def test_canary_wait_does_not_consume_legacy_generic_acknowledgements(self):
        approved = {'state': 'approved', 'approvedBy': MODULE.OPERATOR_CANARY_APPROVAL_CLIENT}
        with patch.object(MODULE, 'acknowledgement_received', side_effect=AssertionError('legacy ACK must not be read')), \
                patch.object(MODULE, 'canary_hold_record', return_value=approved):
            self.assertEqual(MODULE.wait_for_canary_approval('run-1', 60), approved)

    def test_local_forwards_canary_hold_flags(self):
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml',
            '--skip-canary-hold', '--canary-hold-timeout', '90',
            '--emergency-override', '--reason', 'approved incident response',
        ]))
        with patch.object(MODULE.release_application, 'launch', return_value=0) as launch:
            self.assertEqual(MODULE.local_run(args), 0)
        launch.assert_called_once_with(args, runtime=MODULE)
        self.assertEqual(args.canary_hold_timeout, 90)
        self.assertTrue(args.skip_canary_hold)

    def test_local_approve_sshes_like_status(self):
        with patch.object(MODULE.release_application, 'approve', return_value=0) as approve:
            self.assertEqual(MODULE.local_approve('run-42'), 0)
        approve.assert_called_once_with('run-42', runtime=MODULE)


class Pi5OnlyRemoteRunTest(unittest.TestCase):
    def _args(self, **overrides):
        values = {
            'inventory': 'inventory.yml',
            'limit': 'raspberrypi5',
            'run_id': 'run-1',
            'branch': 'main',
            'sha': 'a' * 40,
            'emergency_override': False,
            'reason': None,
            'skip_canary_hold': False,
            'canary_hold_timeout': 60,
            'expected_server_client_id': 'raspberrypi5-server',
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_empty_targets_with_limit_runs_pi5_only_when_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=['raspberrypi5']), \
                    fleet_execution_contract(
                        [],
                        {
                            'server': True,
                            'kiosk': False,
                            'signage': False,
                            'migration': False,
                            'components': ['server-app'],
                        },
                        {},
                    ) as ensure, \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        self.assertEqual(result, 0)
        ensure.assert_called_once()
        self.assertEqual(payload['targets'], [])
        self.assertEqual(payload['state'], 'success')
        self.assertTrue(payload['plan']['pi5Required'])
        self.assertEqual(payload['plan']['targetHosts'], ['raspberrypi5'])
        self.assertEqual(payload['plan']['limit'], 'raspberrypi5')

    def test_zero_match_limit_fails_instead_of_becoming_a_pi5_only_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=[]), \
                    fleet_execution_contract([], None, {}) as ensure:
                with self.assertRaises(RuntimeError) as raised:
                    MODULE._remote_run(self._args(limit='typo-host'))
            run_state_exists = (run_directory / 'run-1.json').exists()
        self.assertIn('--limit selected no hosts', str(raised.exception))
        self.assertFalse(run_state_exists)
        ensure.assert_not_called()

    def test_empty_targets_with_limit_is_a_noop_when_pi5_is_verified_unaffected(self):
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=['raspberrypi5']), \
                    fleet_execution_contract(
                        [],
                        {
                            'server': False,
                            'kiosk': False,
                            'signage': False,
                            'migration': False,
                            'components': ['neutral'],
                        },
                        {},
                    ) as ensure:
                result = MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        self.assertEqual(result, 0)
        self.assertEqual(payload['state'], 'success')
        self.assertEqual(payload['plan']['targetHosts'], [])
        ensure.assert_not_called()

    def test_empty_inventory_scope_without_limit_can_be_a_verified_noop(self):
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    fleet_execution_contract(
                        [],
                        {
                            'server': False,
                            'kiosk': False,
                            'signage': False,
                            'migration': False,
                            'components': ['neutral'],
                        },
                        {},
                    ) as ensure:
                result = MODULE._remote_run(self._args(limit=''))
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        self.assertEqual(result, 0)
        self.assertEqual(payload['state'], 'success')
        ensure.assert_not_called()


class PrintPlanShadowTest(unittest.TestCase):
    def test_print_plan_fails_closed_when_target_sha_is_unavailable(self):
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml', '--print-plan',
        ]))
        with patch.object(
            MODULE,
            'resolve_release_sha',
            return_value=(None, ['could not resolve SHA for branch main']),
        ), patch.object(MODULE, 'read_only_inventory_json') as inventory:
            with self.assertRaisesRegex(RuntimeError, 'could not resolve SHA'):
                MODULE.local_run(args)
        inventory.assert_not_called()

    def test_print_plan_inventory_failure_precedes_remote_fleet_read(self):
        fleet_read = Mock()
        with patch.object(MODULE, 'resolve_release_sha', return_value=(TARGET_SHA, [])), \
                patch.object(MODULE, 'validate_print_plan_checkout'), \
                patch.object(MODULE, 'canonical_print_plan_inventory', return_value='inventory.yml'), \
                patch.object(MODULE, 'read_only_inventory_json', side_effect=RuntimeError('vault unavailable')), \
                patch.object(MODULE, 'read_plan_fleet_release_state', fleet_read):
            with self.assertRaisesRegex(RuntimeError, 'vault unavailable'):
                MODULE.build_print_plan('main', 'inventory.yml', '')
        fleet_read.assert_not_called()

    def test_print_plan_wrong_site_precedes_remote_fleet_read(self):
        inventory_data = {
            'server': {'hosts': ['raspberrypi5']},
            'clients': {'children': []},
            'kiosk': {'hosts': []},
            'signage': {'hosts': []},
            'kiosk_canary': {'hosts': []},
            'signage_canary': {'hosts': []},
            '_meta': {'hostvars': {'raspberrypi5': {
                'status_agent_client_id': 'raspberrypi5-server',
            }}},
        }
        fleet_read = Mock()
        with patch.object(MODULE, 'resolve_release_sha', return_value=(TARGET_SHA, [])), \
                patch.object(MODULE, 'validate_print_plan_checkout'), \
                patch.object(MODULE, 'canonical_print_plan_inventory', return_value='inventory.yml'), \
                patch.object(MODULE, 'read_only_inventory_json', return_value=inventory_data), \
                patch.object(MODULE, 'read_only_selected_hosts', return_value=None), \
                patch.object(
                    MODULE,
                    'validate_print_plan_server_identity',
                    side_effect=RuntimeError('wrong Pi5 site'),
                ), \
                patch.object(MODULE, 'read_plan_fleet_release_state', fleet_read):
            with self.assertRaisesRegex(RuntimeError, 'wrong Pi5 site'):
                MODULE.build_print_plan('main', 'inventory.yml', '')
        fleet_read.assert_not_called()

    def test_active_run_widens_print_plan_to_all_unknown_hosts(self):
        inventory_data = {
            'server': {'hosts': ['raspberrypi5']},
            'clients': {'children': ['kiosk']},
            'kiosk': {'hosts': ['kiosk-a']},
            'signage': {'hosts': []},
            'kiosk_canary': {'hosts': ['kiosk-a']},
            'signage_canary': {'hosts': []},
            '_meta': {'hostvars': {
                'raspberrypi5': {
                    'status_agent_client_id': 'raspberrypi5-server',
                },
                'kiosk-a': {
                    'manage_kiosk_browser': True,
                    'status_agent_client_id': 'kiosk-a',
                },
            }},
        }
        active = {
            'generation': 4,
            'activeRun': {'runId': 'crashed-run'},
            'lastRun': None,
            'fleet': {
                'raspberrypi5': _verified_fleet_record('server', TARGET_SHA),
                'kiosk-a': _verified_fleet_record('kiosk', TARGET_SHA),
            },
        }
        with patch.object(MODULE, 'resolve_release_sha', return_value=(TARGET_SHA, [])), \
                patch.object(MODULE, 'validate_print_plan_checkout'), \
                patch.object(MODULE, 'canonical_print_plan_inventory', return_value='inventory.yml'), \
                patch.object(MODULE, 'read_only_inventory_json', return_value=inventory_data), \
                patch.object(MODULE, 'read_only_selected_hosts', return_value=None), \
                patch.object(
                    MODULE,
                    'validate_print_plan_server_identity',
                    return_value={'host': 'raspberrypi5', 'clientId': 'raspberrypi5-server'},
                ), \
                patch.object(MODULE, 'read_plan_fleet_release_state', return_value=(active, [])):
            plan = MODULE.build_print_plan('main', 'inventory.yml', '')

        self.assertEqual(plan['targetHosts'], ['raspberrypi5', 'kiosk-a'])
        self.assertTrue(all(host['evidence'] == 'unknown' for host in plan['hosts']))
        self.assertTrue(any('crashed-run' in warning for warning in plan['warnings']))

    def test_standard_inventory_paths_are_canonicalized_from_repo_root(self):
        for relative in (
            'infrastructure/ansible/inventory.yml',
            'infrastructure/ansible/inventory-talkplaza.yml',
        ):
            with self.subTest(inventory=relative):
                self.assertEqual(
                    Path(MODULE.canonical_print_plan_inventory(relative)),
                    MODULE.PROJECT / relative,
                )

    def test_print_plan_includes_resolved_targets_and_classification(self):
        sha = 'a' * 40
        classification = {
            'server': True,
            'kiosk': False,
            'signage': False,
            'migration': False,
            'paths': ['apps/api/src/index.ts'],
            'components': ['server-app'],
        }
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]
        inventory_data = {
            'server': {'hosts': ['raspberrypi5']},
            'clients': {'children': ['kiosk']},
            'kiosk': {'hosts': ['kiosk-canary', 'kiosk-b']},
            'signage': {'hosts': []},
            'kiosk_canary': {'hosts': ['kiosk-canary']},
            'signage_canary': {'hosts': []},
            '_meta': {'hostvars': {
                'raspberrypi5': {
                    'status_agent_client_id': 'raspberrypi5-server',
                },
                'kiosk-canary': {
                    'manage_kiosk_browser': True,
                    'status_agent_client_id': 'canary',
                },
                'kiosk-b': {
                    'manage_kiosk_browser': True,
                    'status_agent_client_id': 'b',
                },
            }},
        }
        fleet_state = {
            'generation': 1,
            'activeRun': None,
            'lastRun': None,
            'fleet': {
                'raspberrypi5': _verified_fleet_record('server'),
                'kiosk-canary': _verified_fleet_record('kiosk'),
                'kiosk-b': _verified_fleet_record('kiosk'),
            },
        }
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml', '--print-plan',
        ]))
        with patch.object(MODULE, 'resolve_release_sha', return_value=(sha, [])), \
                patch.object(MODULE, 'validate_print_plan_checkout'), \
                patch.object(MODULE, 'canonical_print_plan_inventory', return_value='inventory.yml'), \
                patch.object(
                    MODULE,
                    'validate_print_plan_server_identity',
                    return_value={'host': 'raspberrypi5', 'clientId': 'raspberrypi5-server'},
                ), \
                patch.object(MODULE, 'classify_release_impact', return_value=(classification, [])), \
                patch.object(MODULE, 'read_only_inventory_json', return_value=inventory_data), \
                patch.object(MODULE, 'read_only_selected_hosts', return_value=None), \
                patch.object(MODULE, 'read_plan_fleet_release_state', return_value=(fleet_state, [])), \
                patch('builtins.print') as printed:
            self.assertEqual(MODULE.local_run(args), 0)
        plan = json.loads(printed.call_args.args[0])
        self.assertEqual(plan['sha'], sha)
        self.assertEqual(plan['classification'], classification)
        self.assertTrue(plan['pi5Required'])
        self.assertEqual(plan['terminalTargets'], [])
        self.assertFalse(plan['canaryHold'])
        self.assertIsNone(plan['limit'])
        self.assertTrue(plan['minimized'])
        self.assertEqual(plan['excludedHosts'], ['kiosk-canary', 'kiosk-b'])
        self.assertEqual(plan['classificationComponents'], ['server-app'])
        self.assertEqual(plan['affectedProfiles'], [])
        self.assertEqual(plan['serverIdentity']['clientId'], 'raspberrypi5-server')
        self.assertEqual(plan['warnings'], [])

    def test_print_plan_remote_state_uses_the_shared_server_transport(self):
        transport = Mock()
        transport.run.return_value = Mock(
            returncode=0,
            stdout=json.dumps({
                'generation': 0,
                'activeRun': None,
                'lastRun': None,
                'fleet': {},
            }),
            stderr='',
        )
        with patch.object(
            MODULE.release_application,
            'build_server_transport',
            return_value=('denkon5sd02', transport),
        ) as build:
            state, warnings = MODULE.read_plan_fleet_release_state()

        build.assert_called_once_with(MODULE)
        transport.run.assert_called_once_with([
            'cat', '/opt/RaspberryPiSystem_002/logs/deploy/fleet-release-state.json'
        ])
        self.assertEqual(state['generation'], 0)
        self.assertEqual(warnings, [])


class FleetScopeLimitTest(unittest.TestCase):
    INVENTORY = {
        'server': {'hosts': ['raspberrypi5']},
        'clients': {'children': ['kiosk']},
        'kiosk': {'hosts': ['kiosk-a', 'kiosk-b']},
        'signage': {'hosts': []},
        'kiosk_canary': {'hosts': ['kiosk-a']},
        'signage_canary': {'hosts': []},
        '_meta': {'hostvars': {
            'raspberrypi5': {
                'status_agent_client_id': 'raspberrypi5-server',
            },
            'kiosk-a': {
                'manage_kiosk_browser': True,
                'status_agent_client_id': 'a',
            },
            'kiosk-b': {
                'manage_kiosk_browser': True,
                'status_agent_client_id': 'b',
            },
        }},
    }
    FLEET = {
        'generation': 1,
        'activeRun': None,
        'lastRun': None,
        'fleet': {
            'raspberrypi5': _verified_fleet_record('server'),
            'kiosk-a': _verified_fleet_record('kiosk'),
            'kiosk-b': _verified_fleet_record('kiosk'),
        },
    }

    def test_limit_cannot_exclude_a_required_pi5_change(self):
        classification = {
            'server': True,
            'kiosk': True,
            'signage': False,
            'migration': False,
            'components': ['server-app', 'kiosk-role'],
        }
        with patch.object(
            MODULE, 'classify_release_impact', return_value=(classification, [])
        ):
            with self.assertRaisesRegex(RuntimeError, 'excludes required Pi5'):
                MODULE.build_fleet_scope(
                    sha=TARGET_SHA,
                    inventory_data=self.INVENTORY,
                    fleet_state=self.FLEET,
                    selected=['kiosk-b'],
                    limit='kiosk-b',
                    full_fleet=False,
                )

    def test_limit_can_narrow_terminals_when_pi5_is_verified_unaffected(self):
        classification = {
            'server': False,
            'kiosk': True,
            'signage': False,
            'migration': False,
            'components': ['kiosk-role'],
        }
        with patch.object(
            MODULE, 'classify_release_impact', return_value=(classification, [])
        ):
            plan, targets, _classifications, warnings = MODULE.build_fleet_scope(
                sha=TARGET_SHA,
                inventory_data=self.INVENTORY,
                fleet_state=self.FLEET,
                selected=['kiosk-b'],
                limit='kiosk-b',
                full_fleet=False,
            )

        self.assertEqual([target['host'] for target in targets], ['kiosk-b'])
        self.assertEqual(plan['targetHosts'], ['kiosk-b'])
        self.assertIn('raspberrypi5', plan['excludedHosts'])
        self.assertEqual(plan['affectedProfiles'], ['kiosk'])
        self.assertEqual(warnings, [])

    def test_limit_cannot_exclude_an_unknown_terminal(self):
        fleet = {**self.FLEET, 'fleet': dict(self.FLEET['fleet'])}
        fleet['fleet']['kiosk-a'] = {
            **fleet['fleet']['kiosk-a'],
            'evidence': 'unknown',
            'verifiedAt': None,
        }
        classification = {
            'server': False,
            'kiosk': True,
            'signage': False,
            'migration': False,
            'components': ['kiosk-role'],
        }
        with patch.object(
            MODULE, 'classify_release_impact', return_value=(classification, [])
        ):
            with self.assertRaisesRegex(RuntimeError, 'unknown-evidence hosts: kiosk-a'):
                MODULE.build_fleet_scope(
                    sha=TARGET_SHA,
                    inventory_data=self.INVENTORY,
                    fleet_state=fleet,
                    selected=['kiosk-b'],
                    limit='kiosk-b',
                    full_fleet=False,
                )

    def test_print_plan_propagates_zero_match_limit_failure(self):
        with patch.object(MODULE, 'resolve_release_sha', return_value=(TARGET_SHA, [])), \
                patch.object(MODULE, 'validate_print_plan_checkout'), \
                patch.object(MODULE, 'canonical_print_plan_inventory', return_value='inventory.yml'), \
                patch.object(MODULE, 'validate_print_plan_server_identity', return_value={'host': 'raspberrypi5', 'clientId': 'raspberrypi5-server'}), \
                patch.object(MODULE, 'read_only_inventory_json', return_value=self.INVENTORY), \
                patch.object(MODULE, 'read_only_selected_hosts', return_value=[]), \
                patch.object(MODULE, 'read_plan_fleet_release_state', return_value=(self.FLEET, [])):
            with self.assertRaisesRegex(RuntimeError, 'selected no hosts'):
                MODULE.build_print_plan(
                    'main', 'inventory.yml', 'missing-host'
                )

    def test_print_plan_propagates_required_pi5_exclusion(self):
        classification = {
            'server': True,
            'kiosk': True,
            'signage': False,
            'migration': False,
            'components': ['server-app', 'kiosk-role'],
        }
        with patch.object(MODULE, 'resolve_release_sha', return_value=(TARGET_SHA, [])), \
                patch.object(MODULE, 'validate_print_plan_checkout'), \
                patch.object(MODULE, 'canonical_print_plan_inventory', return_value='inventory.yml'), \
                patch.object(MODULE, 'validate_print_plan_server_identity', return_value={'host': 'raspberrypi5', 'clientId': 'raspberrypi5-server'}), \
                patch.object(MODULE, 'read_only_inventory_json', return_value=self.INVENTORY), \
                patch.object(MODULE, 'read_only_selected_hosts', return_value=['kiosk-b']), \
                patch.object(MODULE, 'read_plan_fleet_release_state', return_value=(self.FLEET, [])), \
                patch.object(MODULE, 'classify_release_impact', return_value=(classification, [])):
            with self.assertRaisesRegex(RuntimeError, 'excludes required Pi5'):
                MODULE.build_print_plan('main', 'inventory.yml', 'kiosk-b')


class AutoMinimizeTest(unittest.TestCase):
    INVENTORY = {
        'server': {'hosts': ['raspberrypi5']},
        'clients': {'children': ['kiosk', 'signage']},
        'kiosk': {'hosts': ['kiosk-a', 'kiosk-b']},
        'signage': {'hosts': ['raspberrypi3']},
        'kiosk_canary': {'hosts': ['kiosk-b']},
        'signage_canary': {'hosts': ['raspberrypi3']},
        '_meta': {'hostvars': {
            'raspberrypi5': {
                'status_agent_client_id': 'raspberrypi5-server',
            },
            'kiosk-a': {
                'manage_kiosk_browser': True,
                'status_agent_client_id': 'a',
                'nfc_agent_client_id': 'nfc-a',
            },
            'kiosk-b': {
                'manage_kiosk_browser': True,
                'status_agent_client_id': 'b',
                'nfc_agent_client_id': 'nfc-b',
                'barcode_agent_enabled': True,
            },
            'raspberrypi3': {'manage_signage_lite': True, 'status_agent_client_id': 's'},
        }},
    }

    ALL_TARGETS = [
        {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        {'host': 'kiosk-a', 'clientId': 'a', 'terminalType': 'kiosk'},
        {'host': 'raspberrypi3', 'clientId': 's', 'terminalType': 'signage'},
    ]

    def _args(self, **overrides):
        values = {
            'inventory': 'inventory.yml',
            'limit': '',
            'run_id': 'run-1',
            'branch': 'main',
            'sha': 'a' * 40,
            'emergency_override': False,
            'reason': None,
            'skip_canary_hold': True,
            'canary_hold_timeout': 60,
            'full_fleet': False,
            'expected_server_client_id': 'raspberrypi5-server',
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def _run_remote(self, *, classification, targets=None, inventory=None, args=None):
        targets = targets if targets is not None else list(self.ALL_TARGETS)
        inventory = inventory if inventory is not None else self.INVENTORY
        played = []

        def playbook(_inventory, host, _sha, _run_id, rollback=False):
            played.append(host)

        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value=inventory), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    fleet_execution_contract(targets, classification, inventory) as ensure, \
                    patch.object(MODULE, 'remote_previous_sha', return_value=BASE_SHA), \
                    patch.object(MODULE, 'should_issue_terminal_notice', return_value=False), \
                    patch.object(MODULE, 'wait_for_ack', return_value=True), \
                    patch.object(MODULE, 'state_command'), \
                    patch.object(MODULE, 'prestage_signage_maintenance'), \
                    patch.object(MODULE, 'playbook', side_effect=playbook), \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(args or self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        return result, played, payload, ensure

    def test_nfc_agent_excludes_signage_keeps_all_kiosks(self):
        classification = {
            'server': False, 'kiosk': True, 'signage': False, 'migration': False,
            'components': ['nfc-agent'],
        }
        result, played, payload, ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        ensure.assert_not_called()
        self.assertEqual(played, ['kiosk-b', 'kiosk-a'])
        self.assertEqual(
            payload['plan']['excludedHosts'],
            ['raspberrypi5', 'raspberrypi3'],
        )
        self.assertTrue(payload['plan']['minimized'])
        self.assertEqual(payload['plan']['classificationComponents'], ['nfc-agent'])

    def test_barcode_agent_only_keeps_barcode_enabled_hosts(self):
        classification = {
            'server': False, 'kiosk': True, 'signage': False, 'migration': False,
            'components': ['barcode-agent'],
        }
        result, played, payload, _ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-b'])
        self.assertEqual(
            sorted(payload['plan']['excludedHosts']),
            ['kiosk-a', 'raspberrypi3', 'raspberrypi5'],
        )
        self.assertTrue(payload['plan']['minimized'])

    def test_signage_role_only_excludes_all_kiosks(self):
        classification = {
            'server': False, 'kiosk': False, 'signage': True, 'migration': False,
            'components': ['signage-role'],
        }
        result, played, payload, _ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['raspberrypi3'])
        self.assertEqual(
            sorted(payload['plan']['excludedHosts']),
            ['kiosk-a', 'kiosk-b', 'raspberrypi5'],
        )
        self.assertTrue(payload['plan']['minimized'])

    def test_unknown_component_fail_closed_keeps_all_terminals(self):
        classification = {
            'server': True, 'kiosk': True, 'signage': True, 'migration': False,
            'components': ['unknown'],
        }
        result, played, payload, ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        ensure.assert_called_once()
        self.assertEqual(played, ['kiosk-b', 'kiosk-a', 'raspberrypi3'])
        self.assertEqual(payload['plan']['excludedHosts'], [])
        self.assertFalse(payload['plan']['minimized'])
        self.assertTrue(
            all('unknown' in host['targetReason'] for host in payload['plan']['hosts'])
        )

    def test_classification_unavailable_fail_closed_keeps_all_terminals(self):
        result, played, payload, _ensure = self._run_remote(classification=None)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-b', 'kiosk-a', 'raspberrypi3'])
        self.assertEqual(payload['plan']['excludedHosts'], [])
        self.assertFalse(payload['plan']['minimized'])
        self.assertTrue(
            all(
                host['targetReason'] == 'classification unavailable'
                for host in payload['plan']['hosts']
            )
        )
        self.assertIsNone(payload['plan']['classificationComponents'])

    def test_server_app_only_runs_pi5_with_zero_terminals(self):
        classification = {
            'server': True, 'kiosk': False, 'signage': False, 'migration': False,
            'components': ['server-app'],
        }
        result, played, payload, ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        ensure.assert_called_once()
        self.assertEqual(played, [])
        self.assertEqual(payload['targets'], [])
        self.assertEqual(payload['state'], 'success')
        self.assertTrue(payload['plan']['pi5Required'])
        self.assertTrue(payload['plan']['minimized'])
        self.assertEqual(sorted(payload['plan']['excludedHosts']), ['kiosk-a', 'kiosk-b', 'raspberrypi3'])

    def test_default_minimization_is_applied(self):
        classification = {
            'server': False, 'kiosk': True, 'signage': False, 'migration': False,
            'components': ['nfc-agent'],
        }
        result, played, payload, ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        ensure.assert_not_called()
        self.assertEqual(played, ['kiosk-b', 'kiosk-a'])
        self.assertTrue(payload['plan']['minimized'])
        self.assertEqual(
            payload['plan']['excludedHosts'],
            ['raspberrypi5', 'raspberrypi3'],
        )
        self.assertEqual(payload['plan']['classificationComponents'], ['nfc-agent'])

    def test_default_minimization_noop_when_no_pi5_and_no_terminals(self):
        classification = {
            'server': False, 'kiosk': False, 'signage': False, 'migration': False,
            'components': ['neutral'],
        }
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value=self.INVENTORY), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    fleet_execution_contract(
                        list(self.ALL_TARGETS), classification, self.INVENTORY
                    ) as ensure, \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        self.assertEqual(result, 0)
        ensure.assert_not_called()
        self.assertEqual(payload['state'], 'success')
        self.assertEqual(payload['pi5'], {'state': 'not-required'})
        self.assertEqual(payload['targets'], [])
        self.assertFalse(payload['plan']['pi5Required'])

    def test_print_plan_reports_default_minimization(self):
        sha = 'a' * 40
        classification = {
            'server': False, 'kiosk': True, 'signage': False, 'migration': False,
            'components': ['nfc-agent'],
        }
        targets = list(self.ALL_TARGETS)
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml', '--print-plan',
        ]))
        with patch.object(MODULE, 'resolve_release_sha', return_value=(sha, [])), \
                patch.object(MODULE, 'validate_print_plan_checkout'), \
                patch.object(MODULE, 'canonical_print_plan_inventory', return_value='inventory.yml'), \
                patch.object(
                    MODULE,
                    'validate_print_plan_server_identity',
                    return_value={'host': 'raspberrypi5', 'clientId': 'raspberrypi5-server'},
                ), \
                patch.object(MODULE, 'classify_release_impact', return_value=(classification, [])), \
                patch.object(MODULE, 'read_only_inventory_json', return_value=self.INVENTORY), \
                patch.object(MODULE, 'read_only_selected_hosts', return_value=None), \
                patch.object(
                    MODULE,
                    'read_plan_fleet_release_state',
                    return_value=(
                        {
                            'generation': 1,
                            'activeRun': None,
                            'lastRun': None,
                            'fleet': {
                                'raspberrypi5': _verified_fleet_record('server'),
                                'kiosk-b': _verified_fleet_record('kiosk'),
                                'kiosk-a': _verified_fleet_record('kiosk'),
                                'raspberrypi3': _verified_fleet_record('signage'),
                            },
                        },
                        [],
                    ),
                ), \
                patch('builtins.print') as printed:
            self.assertEqual(MODULE.local_run(args), 0)
        plan = json.loads(printed.call_args.args[0])
        self.assertTrue(plan['minimized'])
        self.assertEqual([t['host'] for t in plan['terminalTargets']], ['kiosk-b', 'kiosk-a'])
        self.assertEqual(plan['excludedHosts'], ['raspberrypi5', 'raspberrypi3'])
        self.assertEqual(plan['classificationComponents'], ['nfc-agent'])
        self.assertTrue(plan['canaryHold'])


class RollingReleaseKernelLockTest(unittest.TestCase):
    def test_remote_runner_rejects_missing_inherited_lock_before_coordinator(self):
        args = argparse.Namespace(run_id='run-unlocked')
        with patch.dict(MODULE.os.environ, {}, clear=True), \
                patch.object(MODULE, '_remote_run') as remote_run:
            with self.assertRaisesRegex(RuntimeError, 'descriptor is missing'):
                MODULE.remote_run(args)
        remote_run.assert_not_called()

    def test_legacy_remote_shell_command_builder_is_absent(self):
        self.assertFalse(hasattr(MODULE, 'locked_remote_release_command'))

    def test_remote_runner_requires_protocol_and_exact_systemd_identity(self):
        run_id = 'run-locked'
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            fleet_lock_path = project / 'logs/deploy/fleet-release-state.lock'
            fleet_lock_path.parent.mkdir(parents=True)
            fleet_descriptor = os.open(
                fleet_lock_path, os.O_RDWR | os.O_CREAT, 0o600
            )
            fcntl.flock(fleet_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            environment = {
                'ROLLING_RELEASE_FLEET_LOCK_FD': str(fleet_descriptor),
                'ROLLING_RELEASE_FLEET_LOCK_PATH': str(fleet_lock_path),
                'ROLLING_RELEASE_CONTROL_FILE': str(
                    project / f'logs/deploy/release-runs/{run_id}.control.json'
                ),
                'ROLLING_RELEASE_UNIT': f'raspi-release-{run_id}.service',
                'ROLLING_RELEASE_PROTOCOL': '2',
                'INVOCATION_ID': 'a' * 32,
            }
            args = argparse.Namespace(run_id=run_id)
            with patch.object(MODULE, 'PROJECT', project), \
                    patch.dict(MODULE.os.environ, environment, clear=True), \
                    patch.object(
                        MODULE.systemd_backend,
                        'validate_current_execution_identity',
                    ) as identity, \
                    patch.object(MODULE, '_remote_run', return_value=0) as execute:
                self.assertEqual(MODULE.remote_run(args), 0)
            identity.assert_called_once_with(run_id, 'a' * 32)
            execute.assert_called_once_with(args)
            with self.assertRaises(OSError):
                os.fstat(fleet_descriptor)


class RollingReleaseCancellationTest(unittest.TestCase):
    def test_cancel_is_a_cooperative_public_operation(self):
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            '--cancel', 'run-42', '--reason', 'operator requested safe stop',
        ]))
        with patch.object(
            MODULE.release_application, 'cancel', return_value=0,
        ) as cancel:
            self.assertEqual(MODULE.local_run(args), 0)
        cancel.assert_called_once_with(
            'run-42', 'operator requested safe stop', runtime=MODULE,
        )

    def test_conflicting_control_operations_fail_before_execution(self):
        for option in ('--status', '--approve'):
            with self.subTest(option=option):
                with self.assertRaisesRegex(RuntimeError, 'mutually exclusive'):
                    MODULE.normalize_arguments(MODULE.parser().parse_args([
                        '--cancel', 'run-42', '--reason', 'safe stop',
                        option, 'other-run',
                    ]))

    def test_detach_is_retained_and_job_is_retired(self):
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml', '--detach',
        ]))
        with patch.object(
            MODULE.release_application, 'launch', return_value=0,
        ) as launch:
            self.assertEqual(MODULE.local_run(args), 0)
        launch.assert_called_once_with(args, runtime=MODULE)

        with self.assertRaisesRegex(RuntimeError, '--job is retired; use --detach'):
            MODULE.normalize_arguments(MODULE.parser().parse_args([
                'main', 'infrastructure/ansible/inventory.yml', '--job',
            ]))


if __name__ == '__main__':
    unittest.main()
