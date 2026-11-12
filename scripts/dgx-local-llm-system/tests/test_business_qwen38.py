from dataclasses import replace
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import business_qwen38 as qwen
from model_profiles import load_model_profile_manifest


class BusinessQwenRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = str(Path(self.tmp.name) / 'active.json')
        value = json.loads((Path(__file__).resolve().parent / 'fixtures/private_qwen38_flash_next_orcarouter_fp8_tp2/manifest.json').read_text())
        value['modelProfileId'] = qwen.PROFILE
        value['servedAlias'] = 'system-prod-primary'
        value['businessOrchestrationEligible'] = True
        value['runtimeProfile']['openaiModelId'] = 'system-prod-primary'
        value['runtimeProfile'].pop('guaranteeLevel')
        value['launcherHints']['blueCacheDir'] = qwen.CACHE
        path = Path(self.tmp.name) / 'manifest.json'
        path.write_text(json.dumps(value))
        self.profile = load_model_profile_manifest(path)
        self.nodes = [{'id': 'head-id', 'profile': qwen.PROFILE, 'running': True, 'closed': False, 'startedAt': 'start-1'},
                      {'id': 'worker-id', 'profile': qwen.PROFILE, 'running': True, 'closed': True, 'startedAt': 'start-1'}]
        with patch.object(qwen, '_observations', return_value=self.nodes):
            qwen.record_generation(self.profile, 'generation-1', self.state)

    def status(self, nodes=None):
        with patch.object(qwen, '_observations', return_value=nodes or self.nodes), \
                patch.object(qwen, 'check_prepared', side_effect=AssertionError('runtime must not inspect prepared assets')) as prepared:
            status = qwen.runtime_status(self.profile, 'generation-1', self.state)
        prepared.assert_not_called()
        return status

    def test_runtime_evidence_covers_both_ranks_and_never_offers_private_sharing(self):
        status = self.status()
        self.assertIsNone(status['failureReason'])
        self.assertEqual([r['rank'] for r in status['ranks']], [0, 1])
        self.assertTrue(all(r['generation'] == 'generation-1' for r in status['ranks']))
        self.assertNotIn('privateSharingEvidence', status)
        self.assertFalse(status['apiListenerClosed'])

    def test_old_generation_and_replaced_containers_are_rejected(self):
        with patch.object(qwen, '_observations', return_value=self.nodes):
            with self.assertRaisesRegex(RuntimeError, 'business_runtime_generation_mismatch'):
                qwen.runtime_status(self.profile, 'old-generation', self.state)
        for field, value in (('id', 'replacement'), ('startedAt', 'restart'), ('profile', 'private_qwen38_flash_next_orcarouter_fp8_tp2')):
            nodes = [dict(n) for n in self.nodes]
            nodes[1][field] = value
            self.assertEqual(self.status(nodes)['failureReason'], 'business_rank_state_inconsistent')

    def test_one_rank_remaining_fails_and_both_removed_prove_stop(self):
        removed = {'id': None, 'profile': None, 'running': False, 'closed': True, 'startedAt': 'start-1'}
        self.assertEqual(self.status([removed, self.nodes[1]])['failureReason'], 'business_rank_state_inconsistent')
        stopped = self.status([removed, removed])
        self.assertIsNone(stopped['failureReason'])
        self.assertTrue(all(not r['running'] and r['gpuReleased'] for r in stopped['ranks']))
        self.assertTrue(all(stopped[k] for k in ('launcherStopped', 'watchdogStopped', 'apiListenerClosed')))

    def test_record_generation_refuses_private_or_stopped_rank(self):
        for field, value in (('profile', 'private_qwen38_flash_next_orcarouter_fp8_tp2'), ('running', False)):
            nodes = [dict(n) for n in self.nodes]
            nodes[0][field] = value
            with patch.object(qwen, '_observations', return_value=nodes):
                with self.assertRaisesRegex(RuntimeError, 'business_rank_state_inconsistent'):
                    qwen.record_generation(self.profile, 'generation-2', self.state)

    def test_prepare_only_inspects_local_and_remote_prepared_assets(self):
        commands = []
        def run(command, **kwargs):
            commands.append(command)
            return subprocess.CompletedProcess(command, 0, stdout='')
        qwen.check_prepared(self.profile, runner=run)
        self.assertEqual(len(commands), 2)
        self.assertEqual(commands[1][0], 'ssh')
        for command in commands:
            text = ' '.join(command)
            self.assertIn('docker image inspect', text)
            self.assertIn(qwen.CACHE, text)
            self.assertIn('model.safetensors.index.json', text)
            for forbidden in ('docker pull', 'mkdir', 'qwen38fn-trial/cache', '--enable-log-requests'):
                self.assertNotIn(forbidden, text)

    def test_missing_assets_report_qwen_unprepared(self):
        def fail(*args, **kwargs):
            raise subprocess.CalledProcessError(1, 'inspect')
        with self.assertRaisesRegex(RuntimeError, 'business_qwen38_unprepared'):
            qwen.check_prepared(self.profile, runner=fail)

    def test_pending_generation_only_accepts_complete_stop_proof(self):
        Path(self.state + '.qwen38-runtime.json').unlink()
        removed = {'id': None, 'profile': None, 'running': False, 'closed': True, 'startedAt': None}
        with patch.object(qwen, '_observations', return_value=[removed, removed]), patch.object(qwen, 'check_prepared'):
            status = qwen.runtime_status(self.profile, 'pending-generation', self.state)
        self.assertEqual(status['generation'], 'pending-generation')
        self.assertTrue(status['apiListenerClosed'])
        with patch.object(qwen, '_observations', return_value=[removed, self.nodes[1]]):
            with self.assertRaisesRegex(RuntimeError, 'business_runtime_generation_mismatch'):
                qwen.runtime_status(self.profile, 'pending-generation', self.state)

    def test_malformed_business_launch_contract_refuses_before_inspection(self):
        malformed = [
            replace(self.profile, launcher_hints={**self.profile.launcher_hints, 'blueServerAdapter': 'vllm'}),
            replace(self.profile, launcher_hints={**self.profile.launcher_hints, 'blueRuntimeRecipe': ''}),
            replace(self.profile, served_alias='private-qwen38-flash-next'),
            replace(self.profile, runtime_profile={**self.profile.runtime_profile, 'openaiModelId': 'private-qwen38-flash-next'}),
            replace(self.profile, runtime_profile={**self.profile.runtime_profile, 'openaiBaseUrl': 'http://192.168.100.11:38083/v1'}),
        ]
        for profile in malformed:
            with self.subTest(profile=profile), patch.object(qwen, '_run') as inspect:
                with self.assertRaisesRegex(RuntimeError, 'business_qwen38_unprepared'):
                    qwen.check_prepared(profile)
                inspect.assert_not_called()
