from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

AGENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT_DIR))
import network_health as health

ROUTE = 'Iface Destination Gateway Flags RefCnt Use Metric Mask\nwlan0 00000000 01010101 0003 0 0 100 00000000'
WIRELESS = 'Inter-| sta\n wlan0: 0000  60.  -50.  -256 0 0 0'
IW = '''Connected to aa:bb:cc:dd:ee:ff (on wlan0)
\tSSID: Factory WiFi
\tfreq: 2412
\tsignal: -55 dBm
\ttx bitrate: 72.2 MBit/s MCS 7
'''


class NetworkHealthTest(unittest.TestCase):
    def test_route_prefers_lowest_metric_and_rejects_non_default(self):
        self.assertEqual(health.parse_default_interface(ROUTE + '\neth0 00000000 0 0001 0 0 50 00000000'), 'eth0')
        self.assertIsNone(health.parse_default_interface('bad\neth0 00110000 0 0001 0 0 1 FFFFFF00'))
        self.assertEqual(health.parse_ipv6_interface('0' * 32 + ' 00 ' + '0' * 32 + ' 00 ' + '0' * 32 + ' 00000064 0 0 00000001 eth0'), 'eth0')

    def test_wireless_parser(self):
        self.assertEqual(health.parse_wireless(WIRELESS, 'wlan0'), {'linkQuality': 60, 'signalDbm': -50})
        self.assertEqual(health.parse_wireless(WIRELESS, 'eth0'), {})
        self.assertEqual(health.parse_wireless('wlan0: nope', 'wlan0'), {})
        self.assertEqual(health.parse_wireless('wlan0: 0000 40. 200.', 'wlan0')['signalDbm'], -56)

    def test_iw_parser_allowlist(self):
        self.assertEqual(health.parse_iw_link(IW + '\npassword: secret'), {
            'bssid': 'aa:bb:cc:dd:ee:ff', 'ssid': 'Factory WiFi', 'frequencyMhz': 2412,
            'signalDbm': -55, 'txBitrateMbps': 72.2})
        self.assertEqual(health.parse_iw_link('Not connected.'), {})

    def test_proc_sysfs_prioritized_and_one_iw(self):
        reads = []
        calls = []
        def read(path):
            reads.append(path)
            if path == '/proc/net/route': return ROUTE
            if path == '/proc/net/wireless': return WIRELESS
            if path.endswith('carrier_changes'): return '3'
            if path.endswith('rx_errors'): return '2'
            raise OSError()
        result = health.observe(read=read, is_dir=lambda _: True, run_iw=lambda interface: calls.append(interface) or IW)
        self.assertEqual(result['signalDbm'], -50)
        self.assertEqual(result['carrierChanges'], 3)
        self.assertEqual(result['rxErrors'], 2)
        self.assertNotIn('txErrors', result)
        self.assertEqual(result['txBitrateMbps'], 72.2)
        self.assertEqual(calls, ['wlan0'])
        self.assertFalse(any('password' in path or 'address' in path for path in reads))

    def test_ethernet_does_not_run_iw(self):
        result = health.observe(read=lambda path: ROUTE.replace('wlan0', 'eth0') if path == '/proc/net/route' else '1' if path.endswith('/type') else '',
                                is_dir=lambda _: False, run_iw=lambda _: self.fail('iw on ethernet'))
        self.assertEqual(result, {'interface': 'eth0', 'linkType': 'ethernet'})

    def test_missing_iw_and_failed_reads_are_omitted(self):
        def fail(_): raise RuntimeError('unavailable')
        self.assertEqual(health.observe(read=fail, is_dir=fail, run_iw=fail), {})
        result = health.observe(read=lambda path: ROUTE if path == '/proc/net/route' else WIRELESS if path == '/proc/net/wireless' else '',
                                is_dir=fail, run_iw=fail)
        self.assertEqual(result, {'interface': 'wlan0', 'linkType': 'wifi', 'signalDbm': -50, 'linkQuality': 60})

    def test_iw_timeout_is_two_seconds(self):
        with patch.object(health.subprocess, 'run') as run:
            run.return_value.stdout = IW
            health.iw_link('wlan0')
            self.assertEqual(run.call_args.args[0], ['iw', 'dev', 'wlan0', 'link'])
            self.assertEqual(run.call_args.kwargs['timeout'], 2)

    def test_regular_window_and_extrema(self):
        state = {}
        for minute in range(6):
            state['post'] = {'statusPostMs': 100 + minute * 100, 'statusPostOk': True}
            state, log = health.aggregate(state, {'interface': 'wlan0', 'signalDbm': -50 - minute}, minute * 60)
            if minute < 5: self.assertIsNone(log)
        self.assertEqual(log['level'], 'INFO')
        self.assertEqual(log['context']['samples'], 6)
        self.assertEqual(log['context']['signalDbmMin'], -55)
        self.assertEqual(log['context']['signalDbmAvg'], -52.5)
        self.assertEqual(log['context']['signalDbmMax'], -50)
        self.assertEqual(log['context']['statusPostMsMax'], 600)
        for minute in range(6, 10):
            state, log = health.aggregate(state, {'interface': 'wlan0'}, minute * 60)
            self.assertIsNone(log)
        _, log = health.aggregate(state, {'interface': 'wlan0'}, 600)
        self.assertEqual(log['context']['samples'], 5)

    def test_weak_signal_warn_boundary_and_suppression(self):
        state, log = health.aggregate({}, {'signalDbm': -74}, 0)
        self.assertIsNone(log)
        state, log = health.aggregate(state, {'signalDbm': -75}, 60)
        self.assertEqual(log['context']['warningReasons'], ['weakSignal'])
        state, log = health.aggregate(state, {'signalDbm': -80}, 120)
        self.assertIsNone(log)
        _, log = health.aggregate(state, {'signalDbm': -80}, 360)
        self.assertEqual(log['level'], 'WARN')

    def test_post_warn_reasons_independently_suppressed(self):
        state = {'post': {'statusPostMs': 2999, 'statusPostOk': True}}
        state, log = health.aggregate(state, {}, 0)
        self.assertIsNone(log)
        state['post'] = {'statusPostMs': 3000, 'statusPostOk': False}
        state, log = health.aggregate(state, {}, 60)
        self.assertEqual(log['context']['warningReasons'], ['postFailed', 'postSlow'])
        state['post'] = {'statusPostMs': 4000, 'statusPostOk': False}
        state, log = health.aggregate(state, {}, 120)
        self.assertIsNone(log)
        state, log = health.aggregate(state, {'signalDbm': -75}, 180)
        self.assertEqual(log['context']['warningReasons'], ['weakSignal'])
        self.assertNotIn('statusPostMs', log['context'])  # prior POST consumed only once

    def test_deltas_rollback_and_interface_change(self):
        sample = {'interface': 'wlan0', **{key: 10 for key in health.COUNTERS}}
        state, _ = health.aggregate({}, sample, 0)
        state, log = health.aggregate(state, {**sample, **{key: 12 for key in health.COUNTERS}}, 60)
        self.assertEqual(log['context']['carrierChangesDelta'], 2)
        self.assertEqual(log['context']['rxErrorsDelta'], 2)
        self.assertEqual(log['context']['warningReasons'], ['carrierChange'])
        state, _ = health.aggregate(state, {**sample, **{key: 1 for key in health.COUNTERS}}, 120)
        self.assertEqual(state['window']['deltas']['carrierChangesDelta'], 2)
        state, _ = health.aggregate(state, {**sample, 'interface': 'eth0'}, 180)
        self.assertEqual(state['window']['deltas']['carrierChangesDelta'], 0)

    def test_state_post_persistence_and_logs_cap(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            health.record_post({}, 3100, False, state_path=path)
            logs = [{}] * 20
            health.append_log({}, logs, now=0, state_path=path, collect=lambda: {'interface': 'eth0'})
            self.assertEqual(len(logs), 20)
            self.assertEqual(health.read_state(path)['lastWarn'], {})
            health.record_post({}, 3100, False, state_path=path)
            logs = [{}] * 19
            health.append_log({}, logs, now=60, state_path=path, collect=lambda: {'interface': 'eth0'})
            self.assertEqual(len(logs), 20)
            self.assertFalse(logs[-1]['context']['statusPostOk'])
            self.assertEqual(logs[-1]['context']['statusPostMs'], 3100)

    def test_disabled_does_no_work_and_default_is_enabled(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state'
            def fail(): self.fail('disabled collection')
            health.append_log({'NETWORK_HEALTH_ENABLED': '0'}, [], state_path=path, collect=fail)
            health.record_post({'NETWORK_HEALTH_ENABLED': 'false'}, 1, True, state_path=path)
            self.assertFalse(path.exists())
            self.assertTrue(health.enabled({}))

    def test_failure_in_collection_or_state_does_not_escape(self):
        def fail(): raise RuntimeError()
        health.append_log({}, [], collect=fail)
        with patch.object(health, 'read_state', side_effect=RuntimeError()):
            health.append_log({}, [])
            health.record_post({}, 1, True)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state'
            path.write_text('invalid')
            self.assertEqual(health.read_state(path), {})
            health.write_state(path / 'impossible', {})

    def test_status_post_records_success_and_failure_without_extra_request(self):
        spec = importlib.util.spec_from_file_location('network_status_agent', AGENT_DIR / 'status-agent.py')
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        with patch.object(agent, '_post_payload') as post, patch.object(health, 'record_post') as record, patch.object(agent.time, 'monotonic', side_effect=[1, 1.25, 2, 5.5]):
            agent.post_payload({}, {})
            record.assert_called_with({}, 250, True)
            post.side_effect = OSError('offline')
            with self.assertRaises(OSError): agent.post_payload({}, {})
            record.assert_called_with({}, 3500, False)
            self.assertEqual(post.call_count, 2)


if __name__ == '__main__':
    unittest.main()
