"""Prepared-only business TensorFold operations; never used by private launches."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

PROFILE = 'business_deepseek_v41_flash_tp2'
TARGET = 'ubudgxkoushi@192.168.100.11'
RECIPE = '/srv/dgx/system-prod/kits/deepseek-v41-flash-tp2'
REVISION = 'f424dfe3b14ac9f02fe12f5777c852dba967a79a'
ROOT = '/srv/dgx/system-prod'
ENV = {
    'ABLIT': '1', 'PREPARE': '0', 'HOST': '192.168.100.11', 'PORT': '8889',
    'ABLIT_ID': 'drowzeys/keys-DeepSeek-V4.1-Flash-1017-Abliterated',
    'ABLIT_REVISION': '0bdc2036113c4fdda38ef6005b3cbc0bc0dfa0f0',
    'ABLIT_SIDECAR': 'exl3_wo_b_l10_35_mia29.safetensors',
    'SERVED_NAME': 'system-prod-primary', 'API_KEY': '1',
    'API_KEY_FILE': ROOT + '/state/deepseek-v41/api-key', 'HEAD_ENGRAM_DIR': '', 'FOREGROUND': '0',
    'EAQ_V1_1': '0', 'MODEL_ID': 'Mia-AiLab/DeepSeek-V4.1-Flash-1017-EXL3-EAQ-v1-2.9-bpw',
    # Resolve the full immutable revision from the private prepared marker, never refs/main.
    'MODEL_REVISION': '',
    'SHARED_PREPARED_MARKER': '/home/ubudgxkoushi/.local/state/dsv41-tensorfold/prepared',
    'ENGRAM_ID': 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
    'ENGRAM_REVISION': '1bae0e1088993b9b82de08f59de5be5a34e42170',
    'ENGRAM_SHARDS': 'model-00047-of-00048.safetensors model-00048-of-00048.safetensors',
    'KIT_REF': 'abe07c7d509a0199cc7fec15263be2aa52ac652f',
    'TF_REF': 'fbbc97132cd004237d9887b8d3185896efaedc5c', 'INPUTS_REF': '59402086381a42c74d53053443224eec2790b4c5',
    'CONTAINER_NAME': 'business-dsv41-1017-exl3-tf',
    'HOME': ROOT + '/data/deepseek-v41/home',
    'HF_HOME': ROOT + '/data/deepseek-v41/hf', 'HF_CACHE': '/srv/ssd/hf',
    'NFS_PATH': '/srv/ssd/hf', 'NFS_SERVER': '192.168.100.11',
    'NFS_VOLUME': 'business-dsv41-hf', 'HEAD_NFS_VOLUME': 'business-dsv41-hf-head',
    'HEAD_NFS_SERVER': '192.168.100.11',
    'WORKER2': '', 'WORKER3': '',
    'WORKER_ENGRAM_DIR': '/home/ubudgxkoushi/.cache/dsv41-tensorfold/engram-1bae0e10',
    'WORKER_CACHE_DIR': '/home/ubudgxkoushi/.cache/dsv41-tensorfold/rank-cache-878f5689-ablit-0bdc2036',
    'STATE_DIR': ROOT + '/state/deepseek-v41', 'LOG_DIR': ROOT + '/logs/deepseek-v41',
    'TMPDIR': ROOT + '/data/deepseek-v41/tmp', 'XDG_CACHE_HOME': ROOT + '/data/deepseek-v41/cache',
    'SPILL_GIB': '0', 'SPILL_WEIGHTS_SHA': '0', 'SPILL_DIR': ROOT + '/data/deepseek-v41/spill',
    'WORKER_SPILL_DIR': ROOT + '/data/deepseek-v41/spill', 'KV_SHARD': '0', 'HF_HUB_OFFLINE': '1', 'LOG_KEEP': '10',
    # The native engine logs response bodies. Business containers must discard logs.
    'LOG_MAX_SIZE': '', 'LOG_MAX_FILE': '1', 'WAIT_TIMEOUT': '1200',
}

# config.sh:176-179 derives DATA_SUB from MODEL_REVISION. The private marker pins
# its full SHA; only the observed prepared tree is accepted. Never source a marker.
SHARED_SETUP = r'''
business_prepared() {
python3 -I - "$SHARED_PREPARED_MARKER" "$@" <<'SHARED'
from pathlib import Path
import re
import shlex
import sys

def fields(value):
    pairs = [item.split('=', 1) for item in shlex.split(value)]
    result = dict(pairs)
    assert len(result) == len(pairs)
    for key in ('wengram', 'wcache'):
        result[key] = result[key].replace('$HOME/', '/home/ubudgxkoushi/', 1)
    # Volume names are local Docker handles for the same checked read-only export.
    assert result['nfs_volume'] in ('dsv41-1017-exl3-hf', 'business-dsv41-hf')
    result['nfs_volume'] = 'dsv41-1017-exl3-hf'
    return result

private = fields(Path(sys.argv[1]).read_text())
revision = private['model'].rsplit('@', 1)[1]
assert re.fullmatch(r'878f5689[0-9a-f]{32}', revision)
if sys.argv[2] == 'revision':
    print(revision)
else:
    assert sys.argv[2] == 'check' and private == fields(sys.argv[3])
SHARED
}
shared_config() {
  [[ "$ABLIT" == 1 && "$PREPARE" == 0 && "$SPILL_GIB" == 0 && "$SPILL_WEIGHTS_SHA" == 0 ]] || return 1
  MODEL_REVISION=$(business_prepared revision) || return 1
  export MODEL_REVISION
  [[ "$MODEL_REVISION" =~ ^878f5689[a-f0-9]{32}$ ]] || return 1
  DATA_SUB="tensorfold-dsv41/${MODEL_REVISION:0:8}-ablit-${ABLIT_REVISION:0:8}"
  DATA_DIR="$HF_CACHE/$DATA_SUB"
}
# nodes.sh's probe must also refuse an implicit image pull.
worker_nfs() { local i=$1; shift; worker "$i" "docker run --pull never --rm --entrypoint '$1' -v '$NFS_VOLUME:/hf:ro' '$IMAGE' $(printf '%q ' "${@:2}")"; }
'''

# Fixed revision functions perform only inspection here. No prepare/build/pull.
CHECK = r'''
[[ "$(git rev-parse HEAD)" == "$EXPECTED_REVISION" && -z "$(git status --porcelain)" ]] || exit 1
[[ "$(worker_host 1)" =~ ^[a-zA-Z0-9_.-]+@192\.168\.100\.10$ ]]
shared_config
state=$(prepared_state)
[[ -n "$state" && "$ABLIT" == 1 ]] || exit 1
business_prepared check "$state"
image=$(image_ident "$IMAGE")
[[ "$image" != missing && "$image" == "$(worker_image_ident 1 "$IMAGE")" ]] || exit 1
for dir in "$HF_CACHE" "$DATA_DIR" "$DATA_DIR/checkpoint" "$DATA_DIR/model" "$DATA_DIR/rank-cache" "$HF_CACHE/$KIT_SUB" "$HF_CACHE/$KIT_SUB/kit" "$(engram_cache_dir)/snapshots/$(engram_rev)" \
           "$STATE_DIR" "$LOG_DIR" "$HOME" "$HF_HOME" "$TMPDIR" "$XDG_CACHE_HOME" "$SPILL_DIR"; do
  [[ -d "$dir" && "$(readlink -f "$dir")" == "$dir" ]] || exit 1
done
worker 1 "for dir in '$WORKER_CACHE_DIR' '$WORKER_ENGRAM_DIR' '$STATE_DIR' '$LOG_DIR' '$HOME' '$HF_HOME' '$TMPDIR' '$XDG_CACHE_HOME' '$WORKER_SPILL_DIR'; do test -d \"\$dir\" && test \"\$(readlink -f \"\$dir\")\" = \"\$dir\" || exit 1; done"
[[ -s "$API_KEY_FILE" && "$(stat -c %a "$API_KEY_FILE")" == 600 ]] || exit 1
for rank in 0 1; do
  if [[ "$rank" == 0 ]]; then
    volume=$(docker volume inspect -f '{{index .Options "device"}} {{index .Options "o"}}' "$HEAD_NFS_VOLUME")
  else
    volume=$(worker 1 "docker volume inspect -f '{{index .Options \"device\"}} {{index .Options \"o\"}}' '$NFS_VOLUME'")
  fi
  [[ "$volume" == ":$NFS_PATH addr=$NFS_SERVER,"* && ",${volume#* }," == *,ro,* && ",${volume#* }," != *,rw,* ]] || exit 1
done
# Recompute index identities without creating weight files; mounts are read-only.
snap=$(model_in_container)
for rank in 0 1; do
  cmd="docker run --pull never --rm --network none --entrypoint bash -v '$NFS_VOLUME:/hf:ro' '$IMAGE' -ec 'tf-dsv41-rank-cache $snap /tmp/unused $rank 2 --index-only | sha256sum | cut -c1-20'"
  if [[ "$rank" == 0 ]]; then
    want=$(docker run --pull never --rm --network none --entrypoint bash -v "$HEAD_NFS_VOLUME:/hf:ro" "$IMAGE" -ec "tf-dsv41-rank-cache $snap /tmp/unused 0 2 --index-only | sha256sum | cut -c1-20")
    [[ "$want" =~ ^[a-f0-9]{20}$ && -s "$DATA_DIR/rank-cache/rank0of2-$want.bin" ]] || exit 1
    [[ ! -e "$DATA_DIR/rank-cache/.rank0of2.partial" ]]
    [[ -s "$HF_CACHE/$KIT_SUB/kit/MANIFEST" && -s "$DATA_DIR/dsv41_token_map.json" && -f "$DATA_DIR/checkpoint/.ablit-ready" ]] || exit 1
  else
    want=$(worker 1 "$cmd")
    [[ "$want" =~ ^[a-f0-9]{20}$ ]]
    worker 1 "test -s '$WORKER_CACHE_DIR/rank1of2-$want.bin' && test ! -e '$WORKER_CACHE_DIR/.rank1of2.partial'"
  fi
done
for f in $ENGRAM_SHARDS; do
  [[ "$(stat -L -c %s "$(engram_cache_dir)/snapshots/$(engram_rev)/$f")" == "${ENGRAM_SHARD_SIZE[$f]}" ]]
  [[ "$(worker 1 "stat -L -c %s '$WORKER_ENGRAM_DIR/$f'")" == "${ENGRAM_SHARD_SIZE[$f]}" ]]
done
worker_files_check 1
'''

# No missing-container/daemon or SSH error is interpreted as proof of release.
NODE_STATUS = r'''
set -euo pipefail
name=$1; state=$2; log=$3; port=$4
names=$(docker ps -a --filter "name=^/$name$" --format '{{.Names}}')
running=false; id=''
if [[ "$names" == "$name" ]]; then
  running=$(docker inspect -f '{{.State.Running}}' "$name")
  id=$(docker inspect -f '{{.Id}}' "$name")
fi
# A stopped/absent Docker container has released its processes and GPU contexts.
# Private ComfyUI/DeepSeek processes are outside this container's ownership.
released=false; [[ "$running" == false ]] && released=true
launcher=true; watchdog=true
for entry in "$state/launcher.pid:launcher" "$state/memguard.pid:watchdog"; do
  file=${entry%:*}; kind=${entry##*:}
  if [[ -e "$file" ]]; then
    pid=$(cat "$file"); [[ "$pid" =~ ^[0-9]+$ ]]
    if kill -0 "$pid" 2>/dev/null; then
      if [[ "$kind" == launcher ]]; then launcher=false; else watchdog=false; fi
    fi
  fi
done
listeners=$(ss -H -ltn "sport = :$port")
closed=true; [[ -z "$listeners" ]] || closed=false
started=''
if [[ "$running" == true ]]; then started=$(docker inspect -f '{{.State.StartedAt}}' "$name"); fi
printf '%s\n' "$running" "$released" "$launcher" "$watchdog" "$closed" "$id" "$(cat "$state/generation")" "$started" "$(cat "$state/generation-started-at")"
'''

STOP_NODE = r'''
set -euo pipefail
name=$1; state=$2
for file in "$state/launcher.pid" "$state/memguard.pid"; do
  [[ -e "$file" ]] || continue
  pid=$(cat "$file"); [[ "$pid" =~ ^[0-9]+$ ]]
  if kill -0 "$pid" 2>/dev/null; then
    # Refuse ambiguous/reused PIDs rather than killing an unrelated process.
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline")
    [[ "$cmd" == *deepseek-v41* || "$cmd" == *business-dsv41* ]]
    kill "$pid"
  fi
done
names=$(docker ps -a --filter "name=^/$name$" --format '{{.Names}}')
[[ -z "$names" ]] || docker rm -f "$name" >/dev/null
'''


def remote(script: str, *, runner=subprocess.run) -> str:
    command = shlex.join(['env', *[f'{k}={v}' for k, v in ENV.items()],
                          f'EXPECTED_REVISION={REVISION}', 'bash', '-eu', '-c',
                          'cd ' + shlex.quote(RECIPE) + '\n' + script])
    result = runner(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', TARGET, command],
                    capture_output=True, text=True, timeout=100, check=True)
    return result.stdout


def kit_prefix() -> str:
    return ('source ./scripts/config.sh\nsource ./scripts/nodes.sh\n'
            'MEMGUARD_REMOTE_DIR=/srv/dgx/system-prod/state/deepseek-v41\n')


def launch_patch(output: str = "") -> str:
    return r'''
python3 - ''' + output + r''' <<'EDIT'
from pathlib import Path
import sys
def replace_once(text, anchor, replacement):
    if text.count(anchor) != 1:
        sys.exit('business_kit_layout_mismatch')
    return text.replace(anchor, replacement)

text = Path('start.sh').read_text()
# Every launch/probe uses an existing image, even if it disappears after check.
if text.count('docker run ') != 3:
    sys.exit('business_kit_layout_mismatch')
text = text.replace('docker run ', 'docker run --pull never ')
text = replace_once(text, 'source ./scripts/nodes.sh', """source ./scripts/nodes.sh
MEMGUARD_REMOTE_DIR=/srv/dgx/system-prod/state/deepseek-v41
worker() {
  local i=$1; shift
  [[ -z "${WORKER_DOWN[$i]:-}" ]] || return 255
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 "$(worker_host "$i")" "umask 077; export HOME='$HOME' TMPDIR='$TMPDIR' XDG_CACHE_HOME='$XDG_CACHE_HOME' HF_HOME='$HF_HOME'; $*"
}
""" + BUSINESS_SHARED_SETUP)
text = replace_once(text, '$HOME/.cache/dsv41-tensorfold', '/srv/dgx/system-prod/data/deepseek-v41/cache')
text = replace_once(text, 'RUN_ARGS="', 'RUN_ARGS="--log-driver none ')
# start mode, after our verified stop, cannot reach an internal restart/prepare.
if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(text)
EDIT
'''.replace('BUSINESS_SHARED_SETUP', repr(SHARED_SETUP + '\nshared_config\nbusiness_prepared check "$(prepared_state)"\n'))


def check_prepared(*, runner=subprocess.run) -> None:
    try:
        remote(kit_prefix() + SHARED_SETUP + CHECK + launch_patch(), runner=runner)
    except (subprocess.SubprocessError, OSError) as error:
        if 'business_kit_layout_mismatch' in (getattr(error, 'stderr', '') or ''):
            raise RuntimeError('business_kit_layout_mismatch') from error
        raise RuntimeError('business_deepseek_unprepared') from error


def runtime_status(generation: str, *, runner=subprocess.run) -> dict:
    script = kit_prefix() + '\n'
    # The kit marker records the last preparation. Full cache/image inspection
    # belongs to start/check, never status polling or stop verification.
    script += 'prepared=false; [[ ! -s "$SHARED_PREPARED_MARKER" ]] || prepared=true; printf "%s\\n" "$prepared"\n'
    script += shlex.join(['bash', '-c', NODE_STATUS, 'bash', ENV['CONTAINER_NAME'],
                         ENV['STATE_DIR'], ENV['LOG_DIR'], '8889']) + '\n'
    # rank 1 is Spark 1, controlled by this repo from the rank 0 kit.
    script += 'worker 1 ' + shlex.quote(shlex.join(['bash', '-c', NODE_STATUS, 'bash',
        ENV['CONTAINER_NAME'], ENV['STATE_DIR'], ENV['LOG_DIR'], '8889'])) + '\n'
    lines = remote(script, runner=runner).splitlines()
    if not lines or lines[0] not in {'true', 'false'}:
        raise RuntimeError('business_runtime_status_unavailable')
    prepared = lines.pop(0) == 'true'
    if len(lines) != 18 or any(lines[i] != generation for i in (6, 15)):
        raise RuntimeError('business_runtime_generation_mismatch')
    nodes = [lines[:9], lines[9:18]]
    from datetime import datetime
    for node in nodes:
        boundary = datetime.fromisoformat(node[8].replace('Z', '+00:00'))
        if node[0] == 'true' and datetime.fromisoformat(node[7].replace('Z', '+00:00')) < boundary:
            raise RuntimeError('business_runtime_generation_mismatch')
    if any(v not in {'true', 'false'} for node in nodes for v in node[:5]):
        raise RuntimeError('business_runtime_status_unavailable')
    return {
        'generation': generation, 'prepared': prepared,
        'ranks': [{'rank': rank, 'generation': generation, 'running': node[0] == 'true',
                   'gpuReleased': node[1] == 'true'} for rank, node in enumerate(nodes)],
        'launcherStopped': all(n[2] == 'true' for n in nodes),
        'watchdogStopped': all(n[3] == 'true' for n in nodes),
        'apiListenerClosed': all(n[4] == 'true' for n in nodes),
        'failureReason': None if prepared else 'business_deepseek_unprepared',
    }


def start(generation: str) -> None:
    check_prepared()
    if not generation or not generation.replace('-', '').isalnum():
        raise RuntimeError('business_runtime_generation_missing')
    # Keep the pinned checkout clean. Execute its launch script with fixed business
    # paths and a log driver that discards prompts/responses, without altering kit files.
    script = kit_prefix() + r'''
# Refuse unrecorded containers, including exited ones, so the pinned kit cannot
# enter its original stop.sh path with private worker log/watchdog defaults.
names=$(docker ps -a --filter "name=^/$CONTAINER_NAME$" --format '{{.Names}}')
[[ -z "$names" ]]
worker 1 "names=\$(docker ps -a --filter 'name=^/$CONTAINER_NAME$' --format '{{.Names}}'); test -z \"\$names\""
umask 077
mkdir -p "$STATE_DIR" "$LOG_DIR" "$TMPDIR" "$HOME"
chmod 700 "$STATE_DIR" "$LOG_DIR" "$TMPDIR" "$HOME"
worker 1 "umask 077; mkdir -p '$STATE_DIR/logs' '$LOG_DIR' '$TMPDIR'; chmod 700 '$STATE_DIR' '$STATE_DIR/logs' '$LOG_DIR' '$TMPDIR'"
find "$LOG_DIR" -type f -mtime +7 -delete
for n in 9 8 7 6 5 4 3 2 1; do
  [[ ! -e "$LOG_DIR/start.log.$n" ]] || mv "$LOG_DIR/start.log.$n" "$LOG_DIR/start.log.$((n+1))"
done
[[ ! -e "$LOG_DIR/start.log" ]] || mv "$LOG_DIR/start.log" "$LOG_DIR/start.log.1"
rm -f "$LOG_DIR/start.log.10"
: > "$LOG_DIR/start.log"; chmod 600 "$LOG_DIR/start.log"

'''
    script += launch_patch('"$STATE_DIR/launch.sh"')
    script += 'printf "%s\\n" ' + shlex.quote(generation) + ' > "$STATE_DIR/generation"\ndate --iso-8601=ns > "$STATE_DIR/generation-started-at"\n'
    script += 'worker 1 ' + shlex.quote('umask 077; printf "%s\\n" ' + shlex.quote(generation) +
        ' > ' + ENV['STATE_DIR'] + '/generation; date --iso-8601=ns > ' + ENV['STATE_DIR'] + '/generation-started-at') + '\n'
    # The validated patch uses $0, which is defined for bash -c (BASH_SOURCE is not).
    script += 'setsid nohup bash -c "$(cat "$STATE_DIR/launch.sh")" "' + RECIPE + '/start.sh" > "$LOG_DIR/start.log" 2>&1 < /dev/null &\necho $! > "$STATE_DIR/launcher.pid"\n'
    remote(script)


def stop(generation: str) -> None:
    script = kit_prefix() + shlex.join(['bash', '-c', STOP_NODE, 'bash', ENV['CONTAINER_NAME'], ENV['STATE_DIR']]) + '\n'
    script += 'worker 1 ' + shlex.quote(shlex.join(['bash', '-c', STOP_NODE, 'bash', ENV['CONTAINER_NAME'], ENV['STATE_DIR']])) + '\n'
    remote(script)
    status = runtime_status(generation)
    if not (all(not r['running'] and r['gpuReleased'] for r in status['ranks'])
            and all(status[k] for k in ('launcherStopped', 'watchdogStopped', 'apiListenerClosed'))):
        raise RuntimeError('business_runtime_stop_unverified')


def main():
    if os.environ.get('BUSINESS_DEEPSEEK_SWITCH_ENABLED', '') not in {'true', '1'}:
        raise RuntimeError('business_switch_disabled')
    action = sys.argv[1]
    generation = os.environ.get('DGX_BUSINESS_GENERATION', '')
    if action == 'check':
        check_prepared()
    elif action == 'start':
        start(generation)
    elif action == 'stop':
        stop(generation)
    else:
        raise RuntimeError('unsupported_business_runtime_action')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError, OSError) as error:
        print(str(error) if isinstance(error, RuntimeError) else 'business_runtime_control_failed', file=sys.stderr)
        sys.exit(1)
