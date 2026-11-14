from dataclasses import replace
import json
import os
import stat
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import business_qwen38 as qwen
from model_profiles import load_model_profile_manifest


class BusinessQwenRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.mux_tmp = tempfile.TemporaryDirectory(dir='/tmp')
        self.addCleanup(self.mux_tmp.cleanup)
        self.control_dir = str(Path(self.mux_tmp.name) / 'mux')
        env = patch.dict(os.environ, {'DGX_BUSINESS_SSH_CONTROL_DIR': self.control_dir})
        env.start()
        self.addCleanup(env.stop)
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

    def status(self, nodes=None, sharing=False):
        with patch.object(qwen, '_observations', return_value=nodes or self.nodes), \
                patch.object(qwen, 'check_prepared', side_effect=AssertionError('runtime must not inspect prepared assets')) as prepared:
            status = qwen.runtime_status(self.profile, 'generation-1', self.state, sharing=sharing)
        prepared.assert_not_called()
        return status

    def test_remote_run_uses_secure_multiplexing_and_preserves_ssh_contract(self):
        runner = Mock(return_value=subprocess.CompletedProcess([], 0, stdout='fresh'))
        for _ in range(2):
            self.assertEqual(qwen._run('docker inspect example', 'user@node2', runner), 'fresh')
        self.assertEqual(runner.call_count, 2)
        command = runner.call_args.args[0]
        self.assertEqual(command[:5], ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'])
        self.assertEqual(command[-3:], ['--', 'user@node2', "bash -eu -c 'docker inspect example'"])
        for option in ('ControlMaster=auto', 'ControlPath=' + self.control_dir + '/%C',
                       'ControlPersist=120', 'ServerAliveInterval=5', 'ServerAliveCountMax=2'):
            self.assertIn(option, command)
        self.assertEqual(stat.S_IMODE(os.lstat(self.control_dir).st_mode), 0o700)
        self.assertEqual(os.lstat(self.control_dir).st_uid, os.geteuid())

    def test_insecure_control_directory_falls_back_to_plain_ssh(self):
        os.mkdir(self.control_dir, 0o700)
        for info in (Mock(st_mode=stat.S_IFDIR | 0o700, st_uid=os.geteuid() + 1),
                     Mock(st_mode=stat.S_IFDIR | 0o755, st_uid=os.geteuid()),
                     Mock(st_mode=stat.S_IFLNK | 0o700, st_uid=os.geteuid())):
            with self.subTest(info=info), patch.object(qwen.os, 'lstat', return_value=info):
                runner = Mock(return_value=subprocess.CompletedProcess([], 0, stdout='fresh'))
                qwen._run('inspect', 'user@node2', runner)
                self.assertEqual(runner.call_count, 1)
                self.assertEqual(runner.call_args.args[0][:6],
                                 ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--'])

    def test_actual_symlink_control_directory_falls_back(self):
        Path(self.control_dir).symlink_to(self.mux_tmp.name, target_is_directory=True)
        runner = Mock(return_value=subprocess.CompletedProcess([], 0, stdout='fresh'))
        qwen._run('inspect', 'user@node2', runner)
        self.assertNotIn('ControlMaster=auto', runner.call_args.args[0])

    def test_long_or_uncreatable_control_directory_falls_back(self):
        for directory, failure in ((self.control_dir, OSError('unavailable')),
                                   ('/tmp/' + 'x' * 61, None),
                                   ('/tmp/' + 'あ' * 20, None)):
            with self.subTest(directory=directory), patch.dict(os.environ, {'DGX_BUSINESS_SSH_CONTROL_DIR': directory}), \
                    patch.object(qwen.os, 'makedirs', side_effect=failure) as mkdir:
                runner = Mock(return_value=subprocess.CompletedProcess([], 0, stdout='fresh'))
                qwen._run('inspect', 'user@node2', runner)
                self.assertNotIn('ControlMaster=auto', runner.call_args.args[0])
                if failure is None:
                    mkdir.assert_not_called()

    def test_mux_transport_failure_exits_master_and_retries_plain_once(self):
        for error in (subprocess.CalledProcessError(255, 'ssh'), subprocess.TimeoutExpired('ssh', 30)):
            with self.subTest(error=error):
                runner = Mock(side_effect=[error, subprocess.CalledProcessError(255, 'exit'),
                                          subprocess.CompletedProcess([], 0, stdout='fresh')])
                with patch('active_model_state.request_timeout', side_effect=[20, 2, 17]) as timeout:
                    self.assertEqual(qwen._run('inspect', 'user@node2', runner), 'fresh')
                self.assertEqual([call.args for call in timeout.call_args_list], [(30,), (2,), (30,)])
                commands = [call.args[0] for call in runner.call_args_list]
                self.assertIn('ControlMaster=auto', commands[0])
                self.assertEqual(commands[1], ['ssh', '-o', 'ControlPath=' + self.control_dir + '/%C',
                                               '-O', 'exit', '--', 'user@node2'])
                self.assertEqual(commands[2][:6], ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--'])
                self.assertEqual([call.kwargs['timeout'] for call in runner.call_args_list], [20, 2, 17])

    def test_failed_plain_retry_propagates_and_runtime_status_fails_closed(self):
        for retry_error in (subprocess.CalledProcessError(255, 'plain'), subprocess.TimeoutExpired('plain', 10)):
            with self.subTest(error=retry_error):
                runner = Mock(side_effect=[subprocess.CompletedProcess([], 0, stdout=json.dumps(self.nodes[0]) + '\nfalse\n'),
                    subprocess.CalledProcessError(255, 'mux'), subprocess.CompletedProcess([], 0), retry_error])
                with self.assertRaises(type(retry_error)) as caught:
                    qwen.runtime_status(self.profile, 'generation-1', self.state, runner=runner, sharing=True)
                self.assertIs(caught.exception, retry_error)
                self.assertEqual(runner.call_count, 4)

    def test_remote_script_failure_is_not_retried(self):
        error = subprocess.CalledProcessError(1, 'script')
        runner = Mock(side_effect=error)
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            qwen._run('inspect', 'user@node2', runner)
        self.assertIs(caught.exception, error)
        self.assertEqual(runner.call_count, 1)

    def test_plain_ssh_failure_is_not_retried(self):
        runner = Mock(side_effect=subprocess.CalledProcessError(255, 'plain'))
        with patch.object(qwen.os, 'makedirs', side_effect=OSError('unavailable')):
            with self.assertRaises(subprocess.CalledProcessError):
                qwen._run('inspect', 'user@node2', runner)
        self.assertEqual(runner.call_count, 1)

    def test_local_run_and_invalid_target_do_not_prepare_mux(self):
        runner = Mock(return_value=subprocess.CompletedProcess([], 0, stdout='local'))
        with patch.object(qwen.os, 'makedirs') as mkdir:
            self.assertEqual(qwen._run('inspect', None, runner), 'local')
            self.assertEqual(runner.call_args.args[0], ['bash', '-eu', '-c', 'inspect'])
            with self.assertRaisesRegex(RuntimeError, 'business_qwen38_unprepared'):
                qwen._run('inspect', '-invalid', runner)
            mkdir.assert_not_called()
        self.assertEqual(runner.call_count, 1)

    def test_runtime_evidence_covers_both_ranks_and_never_offers_private_sharing(self):
        status = self.status()
        self.assertIsNone(status['failureReason'])
        self.assertEqual([r['rank'] for r in status['ranks']], [0, 1])
        self.assertTrue(all(r['generation'] == 'generation-1' for r in status['ranks']))
        self.assertNotIn('privateSharingEvidence', status)
        self.assertFalse(status['apiListenerClosed'])

    def inspected_nodes(self):
        result = []
        for rank, (node, (_, model, _)) in enumerate(zip(self.nodes, qwen._nodes(self.profile))):
            options, env = qwen.sharing_launch_contract(self.profile, rank)
            args = ['serve', '/models/qwen38fn']
            for name, value in options.items():
                args.append(name)
                if value is not None:
                    args.append(value)
            mounts = [{'Source': model, 'Destination': '/models/qwen38fn', 'RW': False}]
            mounts += [{'Source': qwen.CACHE + '/' + source, 'Destination': dest, 'RW': True}
                       for source, dest in [('vllm', '/root/.cache/vllm'), ('flashinfer', '/root/.cache/flashinfer'),
                                            ('triton', '/root/.triton'), ('b12x', '/root/.cache/b12x')]]
            result.append({**node, 'args': args, 'path': 'vllm', 'env': sorted(env | qwen.IMAGE_VLLM_ENV),
                           'logDriver': 'none', 'image': qwen.IMAGE, 'mounts': mounts})
        return result

    def test_sharing_requires_both_live_inspections_and_default_is_off(self):
        nodes = self.inspected_nodes()
        self.assertNotIn('privateSharingEvidence', self.status(nodes))
        self.assertEqual(self.status(nodes, sharing=True)['privateSharingEvidence'], qwen.sharing_evidence('generation-1'))
        self.assertNotIn('privateSharingEvidence', self.status(sharing=True))
        for rank in (0, 1):
            mutations = [lambda n: n.update(logDriver='json-file'), lambda n: n.update(env=[]),
                         lambda n: n.update(path='bash'), lambda n: n.update(image='other'),
                         lambda n: n['args'].append('--enable-log-requests'),
                         lambda n: n['args'].extend(['--unknown-future-option', 'value']),
                         lambda n: n['env'].append('VLLM_UNKNOWN_FUTURE_SETTING=1'),
                         lambda n: n['env'].append('VLLM_SERVER_DEV_MODE=1'),
                         lambda n: n['env'].remove('VLLM_BASE_DIR=/workspace/vllm'),
                         lambda n: n['env'].__setitem__(n['env'].index('VLLM_WSL2_ENABLE_PIN_MEMORY=1'), 'VLLM_WSL2_ENABLE_PIN_MEMORY=0'),
                         lambda n: n['env'].__setitem__(n['env'].index('VLLM_PLE_TABLE_MEMORY=shared'), 'VLLM_PLE_TABLE_MEMORY=other'),
                         lambda n: n['args'].__setitem__(n['args'].index('--max-model-len') + 1, '42'),
                         lambda n: n['args'].append('--mm-processor-cache-gb=4'),
                         lambda n: n['args'].append('--no-enable-prefix-caching'),
                         lambda n: n['args'].remove('--enable-prefix-caching'),
                         lambda n: n['args'].__setitem__(n['args'].index('--mm-processor-cache-gb') + 1, '4'),
                         lambda n: n['mounts'][0].update(RW=True),
                         lambda n: n['mounts'][1].update(Source='/private/cache')]
            if rank == 0:
                mutations.append(lambda n: n['args'].__setitem__(n['args'].index('--host') + 1, '0.0.0.0'))
            for mutate in mutations:
                changed = json.loads(json.dumps(nodes))
                mutate(changed[rank])
                with self.subTest(rank=rank, node=changed[rank]):
                    self.assertNotIn('privateSharingEvidence', self.status(changed, sharing=True))

    def test_every_launch_option_and_adapter_environment_value_is_required(self):
        original = self.inspected_nodes()
        for rank in (0, 1):
            options, env = qwen.sharing_launch_contract(self.profile, rank)
            for name, value in options.items():
                for mutation in ('missing', 'different') if value is not None else ('missing',):
                    nodes = json.loads(json.dumps(original))
                    args = nodes[rank]['args']
                    index = args.index(name)
                    if mutation == 'missing':
                        del args[index:index + (1 if value is None else 2)]
                    else:
                        args[index + 1] = 'unexpected'
                    with self.subTest(rank=rank, option=name, mutation=mutation):
                        self.assertNotIn('privateSharingEvidence', self.status(nodes, sharing=True))
            for entry in env:
                for mutation in ('missing', 'different'):
                    nodes = json.loads(json.dumps(original))
                    nodes[rank]['env'].remove(entry)
                    if mutation == 'different':
                        nodes[rank]['env'].append(entry.split('=', 1)[0] + '=unexpected')
                    with self.subTest(rank=rank, env=entry, mutation=mutation):
                        self.assertNotIn('privateSharingEvidence', self.status(nodes, sharing=True))

    def test_sharing_accepts_reordered_complete_options_and_image_environment(self):
        nodes = self.inspected_nodes()
        for rank, node in enumerate(nodes):
            options, _ = qwen.sharing_launch_contract(self.profile, rank)
            node['args'] = ['serve', '/models/qwen38fn']
            for name, value in reversed(list(options.items())):
                node['args'].append(name)
                if value is not None:
                    node['args'].append(value)
            node['env'].reverse()
            node['env'].append('PATH=/usr/local/bin:/usr/bin')
        self.assertIn('privateSharingEvidence', self.status(nodes, sharing=True))

    def test_observations_collect_actual_container_launch_metadata_on_both_nodes(self):
        commands = []
        nodes = self.inspected_nodes()
        def run(command, **kwargs):
            rank = len(commands)
            commands.append(command)
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(nodes[rank]) + '\nfalse\n')
        observed = qwen._observations(self.profile, run)
        self.assertEqual(observed[0]['args'], nodes[0]['args'])
        self.assertEqual(commands[1][0], 'ssh')
        for command in commands:
            script = ' '.join(command)
            for field in ('.Path', '.Args', '.Config.Env', '.HostConfig.LogConfig.Type', '.Mounts', '.Config.Image'):
                self.assertIn(field, script)
            self.assertNotIn('docker run', script)

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
