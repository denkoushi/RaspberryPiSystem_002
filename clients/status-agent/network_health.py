"""Bounded, best-effort network observations; never sends a probe."""
from __future__ import annotations

import json
import math
import re
import subprocess
import time
from pathlib import Path
from typing import Callable

DEFAULT_STATE_FILE = Path('/run/raspi-status-agent/network-health.json')
WINDOW_SECONDS = 300
COUNTERS = {
    'carrierChanges': 'carrier_changes',
    'rxErrors': 'statistics/rx_errors', 'txErrors': 'statistics/tx_errors',
    'rxDropped': 'statistics/rx_dropped', 'txDropped': 'statistics/tx_dropped',
}


def enabled(config: dict) -> bool:
    return str(config.get('NETWORK_HEALTH_ENABLED', '1')).lower() in {'1', 'true', 'yes', 'on'}


def parse_default_interface(text: str) -> str | None:
    routes = []
    for line in text.splitlines():
        try:
            fields = line.split()
            if fields[1] == '00000000' and fields[7] == '00000000' and int(fields[3], 16) & 1:
                routes.append((int(fields[6]), fields[0]))
        except (ValueError, IndexError):
            pass
    return min(routes)[1] if routes else None


def parse_ipv6_interface(text: str) -> str | None:
    routes = []
    for line in text.splitlines():
        try:
            fields = line.split()
            if fields[0] == '0' * 32 and fields[1] == '00' and int(fields[8], 16) & 1:
                routes.append((int(fields[5], 16), fields[9]))
        except (ValueError, IndexError):
            pass
    return min(routes)[1] if routes else None


def parse_wireless(text: str, interface: str) -> dict:
    for line in text.splitlines():
        try:
            name, values = line.split(':', 1)
            if name.strip() != interface:
                continue
            fields = values.split()
            result = {}
            quality = float(fields[1].rstrip('.'))
            signal = float(fields[2].rstrip('.'))
            if math.isfinite(quality) and quality >= 0:
                result['linkQuality'] = quality
            if signal > 127:
                signal -= 256
            if math.isfinite(signal) and -127 <= signal < 0:
                result['signalDbm'] = signal
            return result
        except (ValueError, IndexError):
            pass
    return {}


def parse_iw_link(text: str) -> dict:
    result = {}
    patterns = {
        'bssid': r'^Connected to ([0-9a-fA-F:]{17})\b',
        'ssid': r'^\s*SSID: (.*)$',
        'signalDbm': r'^\s*signal:\s*(-?\d+(?:\.\d+)?)\s*dBm',
        'txBitrateMbps': r'^\s*tx bitrate:\s*(\d+(?:\.\d+)?)\s*MBit/s',
        'frequencyMhz': r'^\s*freq:\s*(\d+)',
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text, re.MULTILINE)
        if match:
            value = match.group(1)
            result[key] = value[:128] if key in {'ssid', 'bssid'} else float(value)
    return result


def read_text(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def iw_link(interface: str) -> str:
    return subprocess.run(['iw', 'dev', interface, 'link'], capture_output=True,
                          text=True, timeout=2, check=True).stdout


def observe(*, read: Callable = read_text, is_dir: Callable = lambda p: Path(p).is_dir(),
            run_iw: Callable = iw_link) -> dict:
    def safe_read(path):
        try:
            return read(path)
        except Exception:
            return ''

    try:
        interface = (parse_default_interface(safe_read('/proc/net/route')) or
                     parse_ipv6_interface(safe_read('/proc/net/ipv6_route')))
        if not interface or not re.fullmatch(r'[\w.-]{1,15}', interface):
            return {}
        base = f'/sys/class/net/{interface}'
        wireless = parse_wireless(safe_read('/proc/net/wireless'), interface)
        try:
            wifi = bool(wireless) or is_dir(f'{base}/wireless')
        except Exception:
            wifi = bool(wireless)
        result = {'interface': interface, **wireless}
        if wifi:
            result['linkType'] = 'wifi'
            try:
                missing = parse_iw_link(run_iw(interface))
                for key, value in missing.items():
                    result.setdefault(key, value)
            except Exception:
                pass
        elif safe_read(f'{base}/type').strip() == '1':
            result['linkType'] = 'ethernet'
        for key, filename in COUNTERS.items():
            try:
                value = int(safe_read(f'{base}/{filename}').strip())
                if value >= 0:
                    result[key] = value
            except Exception:
                pass
        return result
    except Exception:
        return {}


def read_state(path: Path) -> dict:
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
        return state if isinstance(state, dict) else {}
    except Exception:
        return {}


def write_state(path: Path, state: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, allow_nan=False), encoding='utf-8')
        temporary.replace(path)
    except Exception:
        pass


def aggregate(state: dict, observation: dict, now: float, *, emit: bool = True) -> tuple[dict, dict | None]:
    """Pure state transition. WARN snapshots do not postpone the regular window."""
    state = dict(state)
    sample = dict(observation)
    previous = state.get('previous', {})
    same_interface = previous.get('interface') == sample.get('interface')
    for key in COUNTERS:
        if key in sample:
            value = sample.pop(key)
            old = previous.get(key) if same_interface else None
            sample[key + 'Delta'] = max(0, value - old) if isinstance(old, int) else 0
    state['previous'] = dict(observation)
    sample.update(state.pop('post', {}))
    window = dict(state.get('window', {}))
    if not window or now < window['start']:
        window = {'start': now, 'samples': 0, 'stats': {}, 'deltas': {}}
    # Reset interface-specific counters/aggregates when the default route changes.
    if not same_interface and window['samples']:
        window = {'start': now, 'samples': 0, 'stats': {}, 'deltas': {}}
    window['samples'] += 1
    stats = {key: dict(value) for key, value in window['stats'].items()}
    for key in ('signalDbm', 'statusPostMs'):
        value = sample.get(key)
        if isinstance(value, (int, float)) and math.isfinite(value):
            item = stats.setdefault(key, {'min': value, 'max': value, 'sum': 0, 'count': 0})
            item.update(min=min(item['min'], value), max=max(item['max'], value),
                        sum=item['sum'] + value, count=item['count'] + 1)
    window['stats'] = stats
    window['deltas'] = dict(window['deltas'])
    for key in COUNTERS:
        name = key + 'Delta'
        if name in sample:
            window['deltas'][name] = window['deltas'].get(name, 0) + sample[name]
    reasons = []
    if sample.get('signalDbm', 0) <= -75:
        reasons.append('weakSignal')
    if sample.get('carrierChangesDelta', 0) > 0:
        reasons.append('carrierChange')
    if sample.get('statusPostOk') is False:
        reasons.append('postFailed')
    if sample.get('statusPostMs', 0) >= 3000:
        reasons.append('postSlow')
    last_warn = dict(state.get('lastWarn', {}))
    due_reasons = [reason for reason in reasons if now - last_warn.get(reason, -WINDOW_SECONDS) >= WINDOW_SECONDS]
    due = now - window['start'] >= WINDOW_SECONDS
    entry = None
    if emit and (due or due_reasons):
        context = {'category': 'network_health', **sample, **window['deltas'],
                   'samples': window['samples'], 'windowStart': window['start'],
                   'windowSeconds': round(now - window['start'])}
        for key, item in stats.items():
            context.update({key + 'Min': item['min'], key + 'Avg': round(item['sum'] / item['count'], 1),
                            key + 'Max': item['max']})
        if due_reasons:
            context['warningReasons'] = due_reasons
            for reason in due_reasons:
                last_warn[reason] = now
        entry = {'level': 'WARN' if due_reasons else 'INFO',
                 'message': '端末の通信状態に注意' if due_reasons else '端末の通信状態の集計',
                 'context': context}
        if due:
            window = {'start': now, 'samples': 0, 'stats': {}, 'deltas': {}}
    state.update(window=window, lastWarn=last_warn)
    return state, entry


def append_log(config: dict, logs: list, *, now: float | None = None,
               state_path: Path = DEFAULT_STATE_FILE, collect: Callable = observe) -> None:
    try:
        if not enabled(config):
            return
        original = read_state(state_path)
        state, entry = aggregate(original, collect(), time.time() if now is None else now, emit=len(logs) < 20)
        if entry and len(logs) < 20:
            logs.append(entry)
        write_state(state_path, state)
    except Exception:
        pass


def record_post(config: dict, duration_ms: float, ok: bool, *, state_path: Path = DEFAULT_STATE_FILE) -> None:
    try:
        if not enabled(config):
            return
        state = read_state(state_path)
        state['post'] = {'statusPostMs': round(max(0, duration_ms), 1), 'statusPostOk': ok}
        write_state(state_path, state)
    except Exception:
        pass
