import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_DIR))
import test_glm53_flash_tp2_adapter as adapter_harness
from active_model_state import BUSINESS_QWEN38_PROFILE_ID as QWEN, business_qwen38_switch_enabled
from model_profiles import load_model_profiles, validate_startable_profile, UnknownModelProfileError, model_profile_to_api
from profile_launcher import launcher_env_for_profile



class BusinessQwen38IsolationTests(unittest.TestCase):
    def setUp(self):
        self.h = adapter_harness.Glm53FlashTp2AdapterTests()
        self.h.setUp()
        self.addCleanup(self.h.doCleanups)
        docker = self.h.bin / 'docker'
        docker.write_text(docker.read_text().replace(
            'print(os.environ.get("RUNNING_NAME", ""))',
            'print("" if "{{.ID}}" in args else os.environ.get("RUNNING_NAME", ""))'))
        ss = self.h.bin / 'ss'
        ss.write_text('#!/bin/sh\nexit 0\n')
        ss.chmod(0o755)
        self.env = self.h.qwen_env()
        body = json.loads((MODULE_DIR / 'model-registry.examples' / QWEN / 'manifest.json').read_text())
        body['enabled'] = True
        body['launcherHints'].update(blueModelDir=str(self.h.model), blueWorkerModelDir=str(self.h.model))
        self.manifest = self.h.root / 'registry' / QWEN / 'manifest.json'
        self.manifest.parent.mkdir(parents=True)
        self.manifest.write_text(json.dumps(body))
        self.flags = {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': 'true', 'BUSINESS_QWEN38_SWITCH_ENABLED': 'true'}
        with patch.dict(os.environ, self.flags):
            profile = validate_startable_profile(str(self.manifest.parent.parent), QWEN)
        self.profile = profile
        self.env = {**launcher_env_for_profile(profile), **self.flags,
                    'EXPECTED_WORKER_SSH': body['launcherHints']['blueWorkerSshTarget']}

    def test_dual_gate_hides_and_rejects_start(self):
        for deepseek, qwen in [('false', 'false'), ('true', 'false'), ('false', 'true'), ('0', '1')]:
            flags = {'BUSINESS_DEEPSEEK_SWITCH_ENABLED': deepseek, 'BUSINESS_QWEN38_SWITCH_ENABLED': qwen}
            with self.subTest(flags=flags), patch.dict(os.environ, flags):
                self.assertFalse(business_qwen38_switch_enabled())
                self.assertNotIn(QWEN, [p.id for p in load_model_profiles(str(self.manifest.parent.parent))])
                with self.assertRaises(UnknownModelProfileError):
                    validate_startable_profile(str(self.manifest.parent.parent), QWEN)
                result = self.h.run_script('start-trtllm-server.sh', **{**self.env, **flags})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.h.events(), [])
        for value in ('true', '1'):
            with patch.dict(os.environ, {key: value for key in self.flags}):
                profile = validate_startable_profile(str(self.manifest.parent.parent), QWEN)
                self.assertFalse(model_profile_to_api(profile)['censored'])

    def test_direct_business_launch_refuses_private_cache_before_side_effects(self):
        for key, value in [('BLUE_CACHE_DIR', '/home/user/qwen38fn-trial/cache'),
                           ('VLLM_SERVED_MODEL_NAME', 'private-qwen38-flash-next'),
                           ('BLUE_RUNTIME_RECIPE', '')]:
            with self.subTest(key=key):
                result = self.h.run_script('start-trtllm-server.sh', **{**self.env, key: value})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('business_qwen38_unprepared', result.stderr)
                self.assertEqual(self.h.events(), [])

    def test_active_qwen_selection_roundtrips_and_invalid_revision_is_rejected(self):
        from active_model_state import business_selection_state, read_active_model_state
        from model_profiles import BusinessRestoreUnavailableError
        state = self.h.root / 'active.json'
        body = {'modelProfileId': QWEN, 'selectedBusinessProfileId': QWEN, 'selectionRevision': 3,
                'businessTransition': 'ready', 'businessGeneration': 'generation-3',
                'displayNameJa': 'Qwen3.8', 'backend': 'blue', 'servedAlias': 'system-prod-primary',
                'stateUpdatedAt': '2026-11-12T00:00:00Z'}
        with patch.dict(os.environ, self.flags):
            state.write_text(json.dumps(body))
            self.assertEqual(business_selection_state(str(state))['selectedBusinessProfileId'], QWEN)
            self.assertEqual(read_active_model_state(str(state)).business_selection['businessGeneration'], 'generation-3')
            state.write_text(json.dumps({**body, 'selectionRevision': -1}))
            with self.assertRaises(BusinessRestoreUnavailableError):
                business_selection_state(str(state))

    def test_every_owner_change_recreates_both_ranks_before_launch(self):
        private = 'private_qwen38_flash_next_orcarouter_fp8_tp2'
        for previous, requested in [(private, QWEN), (QWEN, private), ('business_glm53_flash_fp4_tp2', QWEN)]:
            for running in ('system-prod-trtllm', ''):
                with self.subTest(previous=previous, requested=requested, running=running):
                    self.h.events_path.write_text('')
                    self.h.write_marker(target=self.env['BLUE_WORKER_SSH_TARGET'])
                    result = self.h.run_script('start-trtllm-server.sh', **{
                        **self.env, 'BLUE_MODEL_PROFILE_ID': requested,
                        'VLLM_SERVED_MODEL_NAME': 'system-prod-primary' if requested == QWEN else 'private-qwen38-flash-next',
                        'RUNNING_NAME': running, 'RUNNING_PROFILE': previous,
                    })
                    self.assertEqual(result.returncode, 0, result.stderr)
                    events = self.h.docker_events()
                    removals = [(i, e) for i, e in enumerate(events) if e['args'][0] == 'rm']
                    starts = [(i, e) for i, e in enumerate(events) if e['args'][0] == 'run' and '--rm' not in e['args']]
                    self.assertEqual({e['node'] for _, e in removals}, {'head', 'worker'})
                    self.assertEqual({e['node'] for _, e in starts}, {'head', 'worker'})
                    self.assertLess(max(i for i, _ in removals), min(i for i, _ in starts))
                    for _, event in starts:
                        self.assertIn('dgx.profile=' + requested, event['args'])

    def test_profile_mismatch_stops_before_recreating_business_qwen(self):
        self.h.write_marker(target=self.env['BLUE_WORKER_SSH_TARGET'], name='recorded-worker')
        result = self.h.run_script('start-trtllm-server.sh', **{
            **self.env, 'RUNNING_NAME': 'system-prod-trtllm',
            'RUNNING_PROFILE': 'private_qwen38_flash_next_orcarouter_fp8_tp2',
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.h.docker_events()
        # Only stop-trtllm-server.sh uses the worker name recorded in the marker.
        stopped_worker = next(i for i, e in enumerate(events)
                              if e['node'] == 'worker' and e['args'] == ['rm', '-f', 'recorded-worker'])
        starts = [i for i, e in enumerate(events) if e['args'][0] == 'run' and '--rm' not in e['args']]
        self.assertEqual(len(starts), 2)
        self.assertLess(stopped_worker, min(starts))

    def test_worker_with_private_owner_is_recreated_even_when_head_owner_matches(self):
        docker = self.h.bin / 'docker'
        fake = docker.read_text().replace('if "{{.State.Running}}" in args:', 'if any(".State.Running" in a and "dgx.profile" in a for a in args):\n        print("true private_qwen38_flash_next_orcarouter_fp8_tp2")\n        sys.exit(0)\n    if "{{.State.Running}}" in args:')
        docker.write_text(fake)
        self.h.write_marker(target=self.env['BLUE_WORKER_SSH_TARGET'])
        result = self.h.run_script('start-trtllm-server.sh', **{
            **self.env, 'RUNNING_NAME': 'system-prod-trtllm', 'RUNNING_PROFILE': QWEN,
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        events = self.h.docker_events()
        removed = [(i, e) for i, e in enumerate(events) if e['args'][0] == 'rm']
        starts = [(i, e) for i, e in enumerate(events) if e['args'][0] == 'run' and '--rm' not in e['args']]
        self.assertEqual({e['node'] for _, e in removed}, {'head', 'worker'})
        self.assertEqual(len(starts), 2)
        self.assertLess(max(i for i, _ in removed), min(i for i, _ in starts))

    def test_business_launch_mounts_only_business_cache_and_readonly_weights_without_request_logs(self):
        result = self.h.run_script('start-trtllm-server.sh', **self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        starts = [e for e in self.h.docker_events() if e['args'][0] == 'run' and '--rm' not in e['args']]
        self.assertEqual(len(starts), 2)
        for event in starts:
            args = event['args']
            mounts = [args[i + 1] for i, arg in enumerate(args) if arg in ('-v', '--volume')]
            self.assertIn(str(self.h.model) + ':/models/qwen38fn:ro', mounts)
            cache_mounts = [mount for mount in mounts if '/root/' in mount]
            self.assertEqual(len(cache_mounts), 4)
            self.assertTrue(all(m.startswith('/srv/dgx/system-prod/data/business-qwen38/cache/') for m in cache_mounts))
            self.assertNotIn('qwen38fn-trial', ' '.join(args))
            self.assertFalse(any(arg.startswith(('--enable-log-requests', '--log-requests', '--enable-log-outputs')) for arg in args))
            self.assertEqual(args[args.index('--served-model-name') + 1], 'system-prod-primary')
            self.assertIn('VLLM_SERVER_DEV_MODE=1', args)
            self.assertEqual(args[args.index('--log-driver') + 1], 'none')
            self.assertEqual(args[args.index('--mm-processor-cache-gb') + 1], '0')
            self.assertIn('--enable-prefix-caching', args)
            if event['node'] == 'head':
                self.assertEqual(args[args.index('--host') + 1], '127.0.0.1')

    def test_sharing_contract_matches_actual_adapter_arguments_and_environment(self):
        import business_qwen38 as qwen
        result = self.h.run_script('start-trtllm-server.sh', **self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        starts = [e for e in self.h.docker_events() if e['args'][0] == 'run' and '--rm' not in e['args']]
        self.assertEqual(len(starts), 2)
        nodes = [None, None]
        for event in starts:
            rank = 0 if event['node'] == 'head' else 1
            args = event['args']
            mounts = [args[i + 1].split(':') for i, arg in enumerate(args) if arg == '-v']
            nodes[rank] = {
                'path': 'vllm', 'args': args[args.index('serve'):],
                'image': args[args.index('--entrypoint') + 2],
                'logDriver': args[args.index('--log-driver') + 1],
                'env': [args[i + 1] for i, arg in enumerate(args) if arg == '-e'],
                'mounts': [{'Source': m[0], 'Destination': m[1], 'RW': len(m) == 2 or m[2] != 'ro'} for m in mounts],
            }
            _, expected_env = qwen.sharing_launch_contract(self.profile, rank)
            self.assertEqual(set(nodes[rank]['env']), expected_env)
        self.assertTrue(qwen._sharing_inspected(self.profile, nodes))



if __name__ == '__main__':
    unittest.main()
