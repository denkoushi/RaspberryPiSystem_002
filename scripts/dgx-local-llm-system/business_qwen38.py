"""Prepared-only business Qwen runtime evidence, separate from private state."""
from __future__ import annotations

import json
from pathlib import Path
import re
import shlex
import subprocess

from model_profiles import ModelProfile

PROFILE = 'business_qwen38_flash_next_orcarouter_fp8_tp2'
CACHE = '/srv/dgx/system-prod/data/business-qwen38/cache'
IMAGE = 'eugr/spark-vllm-b12x@sha256:03a956544e9f9b4b7ba91690469fbe7848bdbef29a7d2e0f5788368467bb3595'


def _run(script: str, target: str | None, runner) -> str:
    from active_model_state import request_timeout
    command = ['bash', '-eu', '-c', script]
    if target:
        if not re.fullmatch(r'[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9_][a-zA-Z0-9_.-]*', target):
            raise RuntimeError('business_qwen38_unprepared')
        command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', target, shlex.join(command)]
    return runner(command, check=True, capture_output=True, text=True, timeout=request_timeout(30)).stdout


def _nodes(profile: ModelProfile):
    hints = profile.launcher_hints or {}
    target = hints.get('blueWorkerSshTarget')
    runtime = profile.runtime_profile or {}
    if (profile.id != PROFILE or hints.get('blueCacheDir') != CACHE
            or hints.get('blueServerImage') != IMAGE or not target
            or hints.get('blueServerAdapter') != 'glm53_flash_tp2'
            or hints.get('blueRuntimeRecipe') != 'qwen38_fp8_tp2'
            or profile.served_alias != 'system-prod-primary'
            or runtime.get('openaiModelId') != 'system-prod-primary'
            or runtime.get('openaiBaseUrl') != 'http://127.0.0.1:38083/v1'):
        raise RuntimeError('business_qwen38_unprepared')
    return ((None, hints.get('blueModelDir'), 'system-prod-trtllm'),
            (target, hints.get('blueWorkerModelDir'), 'system-prod-trtllm-rank1'))


def check_prepared(profile: ModelProfile, *, runner=subprocess.run) -> None:
    try:
        for target, model, _ in _nodes(profile):
            if not isinstance(model, str) or not model.startswith('/') or '\n' in model:
                raise RuntimeError('business_qwen38_unprepared')
            # Inspect prepared resources only; never download, build, or create caches.
            script = ('docker image inspect ' + shlex.quote(IMAGE) + ' >/dev/null\n'
                      + 'model=' + shlex.quote(model) + '\ncache=' + shlex.quote(CACHE) + '\n'
                      + 'test -d "$model"; test -s "$model/config.json"; '
                      + 'test -s "$model/model.safetensors.index.json"\n'
                      + 'python3 - "$model" <<\'WEIGHTS\'\n'
                      + 'import json, sys\nfrom pathlib import Path\nroot = Path(sys.argv[1])\n'
                      + 'weights = json.loads((root / "model.safetensors.index.json").read_text())["weight_map"]\n'
                      + 'assert isinstance(weights, dict) and weights\n'
                      + 'for shard in set(weights.values()):\n'
                      + '    assert isinstance(shard, str) and Path(shard).name == shard\n'
                      + '    assert (root / shard).is_file() and (root / shard).stat().st_size > 0\nWEIGHTS\n'
                      + 'for dir in "$cache" "$cache/vllm" "$cache/flashinfer" "$cache/triton" "$cache/b12x"; do '
                      + 'test -d "$dir"; test "$(readlink -f "$dir")" = "$dir"; done')
            _run(script, target, runner)
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise RuntimeError('business_qwen38_unprepared') from error


def _observations(profile: ModelProfile, runner) -> list[dict]:
    result = []
    for target, _, name in _nodes(profile):
        script = ('docker info >/dev/null\nname=' + shlex.quote(name) + '\n'
                  + 'names=$(docker ps -a --filter "name=^/$name$" --format "{{.Names}}")\n'
                  + "if test -n \"$names\"; then docker inspect -f "
                  + shlex.quote('{"id":{{json .Id}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"profile":{{json (index .Config.Labels "dgx.profile")}}}')
                  + ' "$name"; else printf \'{"id":null,"running":false,"startedAt":null,"profile":null}\\n\'; fi\n'
                  + 'listeners=$(ss -H -ltn "sport = :38083"); test -n "$listeners" && echo false || echo true')
        lines = _run(script, target, runner).splitlines()
        if len(lines) != 2 or lines[1] not in {'true', 'false'}:
            raise RuntimeError('business_runtime_status_unavailable')
        value = json.loads(lines[0])
        if type(value.get('running')) is not bool:
            raise RuntimeError('business_runtime_status_unavailable')
        value['closed'] = lines[1] == 'true'
        result.append(value)
    return result


def record_generation(profile: ModelProfile, generation: str, state_path: str, *, runner=subprocess.run) -> None:
    nodes = _observations(profile, runner)
    if any(not n['running'] or n['profile'] != PROFILE or not n['id'] for n in nodes):
        raise RuntimeError('business_rank_state_inconsistent')
    path = Path(state_path + '.qwen38-runtime.json')
    payload = {'generation': generation, 'containerIds': [n['id'] for n in nodes],
               'startedAt': [n['startedAt'] for n in nodes]}
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload) + '\n')
    temporary.replace(path)


def runtime_status(profile: ModelProfile, generation: str, state_path: str, *, runner=subprocess.run) -> dict:
    try:
        binding = json.loads(Path(state_path + '.qwen38-runtime.json').read_text())
    except FileNotFoundError:
        binding = {}
    valid_binding = (binding.get('generation') == generation and len(binding.get('containerIds', [])) == 2
                     and len(binding.get('startedAt', [])) == 2)
    nodes = _observations(profile, runner)
    # A failed launch may precede generation recording. Only complete removal
    # and closed listeners on both nodes prove stop for that pending generation.
    if not valid_binding and not all(n['id'] is None and not n['running'] and n['closed'] for n in nodes):
        raise RuntimeError('business_runtime_generation_mismatch')
    failure = None
    if (nodes[0]['running'] != nodes[1]['running'] or any(
            n['id'] is not None and (n['profile'] != PROFILE or n['id'] != binding['containerIds'][rank]
                                    or n['startedAt'] != binding['startedAt'][rank])
            for rank, n in enumerate(nodes))):
        failure = 'business_rank_state_inconsistent'
    # Prepared assets are checked before start; runtime evidence only inspects ranks.
    return {'generation': generation, 'prepared': True,
            'ranks': [{'rank': r, 'generation': generation, 'running': n['running'],
                       'gpuReleased': not n['running']} for r, n in enumerate(nodes)],
            'launcherStopped': True, 'watchdogStopped': True,
            'apiListenerClosed': all(n['closed'] for n in nodes), 'failureReason': failure}
