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
WEIGHTS_REVISION = '5638ef95592d5c0b6a83791f55b09051565cfd9b'
RUNTIME_IDENTITY = 'vllm:qwen38_fp8_tp2:38083'


def sharing_evidence(generation: str) -> dict:
    return {'generation': generation, 'weightsRevision': WEIGHTS_REVISION,
            'runtimeIdentity': RUNTIME_IDENTITY, 'prefixCaching': True,
            'prefixCacheIsolation': 'salt+owner-exclusive-reset', 'mmProcessorCacheGiB': 0,
            'logDriver': 'none', 'requestResponseLogging': False,
            'persistsConversations': False, 'ownerExclusive': True}


def sharing_launch_contract(profile, rank):
    """Complete adapter launch contract; image-provided non-vLLM env is separate."""
    hints = profile.launcher_hints or {}
    master = str(hints.get('blueMasterAddr', '192.168.100.10'))
    port = str(hints.get('blueMasterPort', '29501'))
    interface = hints.get('blueEthInterface', 'enp1s0f0np0')
    options = {
        '--served-model-name': 'system-prod-primary', '--tensor-parallel-size': '2',
        '--mamba-cache-mode': 'align', '--enable-prefix-caching': None,
        '--enable-chunked-prefill': None, '--kv-cache-dtype': 'auto',
        '--max-model-len': '131072', '--max-num-seqs': '4', '--max-num-batched-tokens': '4096',
        '--speculative-config': '{"method":"mtp","num_speculative_tokens":3,"draft_tensor_parallel_size":2}',
        '--mm-encoder-tp-mode': 'data', '--safetensors-load-strategy': 'eager',
        '--default-chat-template-kwargs': '{"enable_thinking":false}',
        '--reasoning-parser': 'qwen3', '--tool-call-parser': 'qwen3_xml',
        '--enable-auto-tool-choice': None, '--gpu-memory-utilization': '0.87',
        '--nnodes': '2', '--master-addr': master, '--master-port': port,
        '--mm-processor-cache-gb': '0', '--node-rank': str(rank),
    }
    options.update({'--host': '127.0.0.1', '--port': '38083', '--scheduling-policy': 'priority'}
                   if rank == 0 else {'--headless': None})
    env = {
        'HF_HUB_OFFLINE': '1', 'MN_IF_NAME': interface, 'UCX_NET_DEVICES': interface,
        'NCCL_SOCKET_IFNAME': interface,
        'NCCL_IB_HCA': hints.get('blueIbInterfaces', 'rocep1s0f0,roceP2p1s0f0'),
        'NCCL_IB_DISABLE': '0', 'OMPI_MCA_btl_tcp_if_include': interface,
        'GLOO_SOCKET_IFNAME': interface, 'TP_SOCKET_IFNAME': interface,
        'NCCL_IGNORE_CPU_AFFINITY': '1', 'HEAD_IP': master, 'MASTER_PORT': port,
        'CUTE_DSL_ARCH': 'sm_121a', 'SAFETENSORS_FAST_GPU': '1',
        'NCCL_BUFFSIZE': '1048576', 'NCCL_MAX_CTAS': '8',
        'VLLM_SERVER_DEV_MODE': '1', 'VLLM_ENABLE_ROCE_ALLREDUCE': '1',
        'VLLM_ROCE_ALLREDUCE_MAX_SIZE': '2MB', 'VLLM_WORKER_MULTIPROC_METHOD': 'spawn',
        'VLLM_SSM_CONV_STATE_LAYOUT': 'DS', 'VLLM_USE_V2_MODEL_RUNNER': '1',
        'VLLM_ENABLE_PCIE_ALLREDUCE': '0', 'VLLM_PLE_TABLE_MEMORY': 'shared',
        'VLLM_HOST_IP': master if rank == 0 else hints['blueWorkerSshTarget'].split('@', 1)[1],
    }
    return options, {key + '=' + value for key, value in env.items()}


def _sharing_inspected(profile, nodes):
    """Only observed launch metadata can enable sharing; never infer defaults."""
    if profile.source_model_ref != 'orcarouter/Qwen3.8-Flash-Next-Uncensored-FP8@' + WEIGHTS_REVISION:
        return False
    try:
        for rank, (node, (_, model, _)) in enumerate(zip(nodes, _nodes(profile))):
            args = node['args']
            expected_options, expected_env = sharing_launch_contract(profile, rank)
            remaining = dict(expected_options)
            if args[:2] != ['serve', '/models/qwen38fn']:
                return False
            index = 2
            while index < len(args):
                name = args[index]
                if name not in remaining:
                    return False
                value = remaining.pop(name)
                index += 1
                if value is not None:
                    if args[index] != value:
                        return False
                    index += 1
            # Docker adds image env (PATH, etc). Every adapter setting and every
            # VLLM_* entry must match exactly, including multiplicity.
            observed_env = [entry for entry in node['env']
                            if entry.startswith('VLLM_')
                            or entry.split('=', 1)[0] in {e.split('=', 1)[0] for e in expected_env}]
            if (remaining or node['path'] != 'vllm' or node['image'] != IMAGE
                    or node['logDriver'] != 'none' or len(observed_env) != len(expected_env)
                    or set(observed_env) != expected_env):
                return False
            mounts = node['mounts']
            expected = {'/models/qwen38fn': (model, False),
                        '/root/.cache/vllm': (CACHE + '/vllm', True),
                        '/root/.cache/flashinfer': (CACHE + '/flashinfer', True),
                        '/root/.triton': (CACHE + '/triton', True),
                        '/root/.cache/b12x': (CACHE + '/b12x', True)}
            if (len(mounts) != len(expected) or {m['Destination'] for m in mounts} != set(expected)
                    or any((m['Source'], m['RW']) != expected[m['Destination']] for m in mounts)):
                return False
        return len(nodes) == 2
    except (KeyError, TypeError, ValueError, IndexError):
        return False


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
                  + shlex.quote('{"id":{{json .Id}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"profile":{{json (index .Config.Labels "dgx.profile")}},"path":{{json .Path}},"args":{{json .Args}},"env":{{json .Config.Env}},"image":{{json .Config.Image}},"logDriver":{{json .HostConfig.LogConfig.Type}},"mounts":{{json .Mounts}}}')
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


def runtime_status(profile: ModelProfile, generation: str, state_path: str, *, runner=subprocess.run, sharing=False) -> dict:
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
    result = {'generation': generation, 'prepared': True,
            'ranks': [{'rank': r, 'generation': generation, 'running': n['running'],
                       'gpuReleased': not n['running']} for r, n in enumerate(nodes)],
            'launcherStopped': True, 'watchdogStopped': True,
            'apiListenerClosed': all(n['closed'] for n in nodes), 'failureReason': failure}
    if sharing and not failure and all(n['running'] for n in nodes) and _sharing_inspected(profile, nodes):
        result['privateSharingEvidence'] = sharing_evidence(generation)
    return result
