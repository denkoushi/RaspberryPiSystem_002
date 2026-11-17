#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Disposable local project only. Failure retains diagnostics/resources, as S0 does.
python3 - "$ROOT" <<'PY'
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'scripts/deploy'))
from pi5_server_compose import ReplicationContractError, check_runtime, resolve_server_compose
from pi5_volume_materializer import required_volume_specs, materialize

os.umask(0o077)
project = 'pi5-overlay-' + uuid.uuid4().hex[:12]
work = Path(tempfile.mkdtemp(prefix=project + '-'))
compose = work / 'infrastructure/docker'
(compose / 'postgres').mkdir(parents=True)
(work / 'apps/api').mkdir(parents=True)
(work / 'apps/api/.env.example').touch()
for name in ('docker-compose.server.yml', 'docker-compose.phase3.yml',
             'docker-compose.replication-primary.yml', 'postgres/db-start-guard.sh',
             'postgres/replication-primary-pg_hba.conf'):
    shutil.copyfile(root / 'infrastructure/docker' / name, compose / name)
(compose / 'postgres/db-start-guard.sh').chmod(0o755)
secret = work / 'fixture-password'
secret.write_text('local-disposable-fixture-password\n')
env_file = compose / '.env'
env_file.write_text(f'''POSTGRES_SUPERUSER_PASSWORD_FILE={secret}
APP_DATABASE_URL=postgresql://fixture:fixture@db/borrow_return
ADMIN_ALLOW_NETS=127.0.0.1/32
PI5_PROJECT_DIR={work}
PI5_VOLUME_PREFIX={project}
PI5_BASE_COMPOSE_PROJECT={project}
PI5_ENV_FILE={env_file}
PI5_BLUE_API_IMAGE=fixture:api
PI5_GREEN_API_IMAGE=fixture:api
PI5_BLUE_WEB_IMAGE=fixture:web
PI5_GREEN_WEB_IMAGE=fixture:web
PI5_GATEWAY_IMAGE=fixture:gateway
''')
# Test-only: no host port publication, and a lightweight API-shaped consumer
# exercises depends_on -> db without building/running the production API.
test_overlay = compose / 'local-test.yml'
test_overlay.write_text('''services:
  db:
    ports: !reset []
  deploy-consumer:
    image: pgvector/pgvector:pg18
    entrypoint: [sleep, infinity]
    depends_on:
      db:
        condition: service_healthy
''')
base = ['docker', 'compose', '--env-file', str(env_file), '-f', str(compose / 'docker-compose.server.yml')]
phase3 = ['docker', 'compose', '--env-file', str(env_file), '-f', str(compose / 'docker-compose.phase3.yml')]
marker = work / 'config/pi5-replication-primary'
environment = {key: value for key, value in os.environ.items() if not key.startswith(('PI5_', 'COMPOSE_'))}
environment.update(PI5_ENV_FILE=str(env_file), PI5_PROJECT_DIR=str(work))
os.environ.clear()
os.environ.update(environment)
passed = 0
started = False
start = time.monotonic()

def run(argv, input=None):
    result = subprocess.run(argv, input=input, capture_output=True, text=True, check=False)
    if result.returncode:
        (work / 'failure.log').write_text(result.stdout + result.stderr)
        raise RuntimeError('command failed; see retained failure.log')
    return result.stdout.strip()

def passed_check(name):
    global passed
    passed += 1
    print('PASS: ' + name, flush=True)

def rejected(call):
    try:
        call()
    except ReplicationContractError:
        return
    raise AssertionError('expected rejection')

def runtime_argv():
    return resolve_server_compose(work, base) + ['-f', str(test_overlay)]

try:
    assert resolve_server_compose(work, base) == base
    passed_check('unmarked argv exactly matches the original command')
    marker.mkdir(parents=True)
    (marker / 'primary.env').write_text('PI5_REPLICATION_PRIMARY_IP=100.64.0.10\nPI5_REPLICATION_STANDBY_IP=100.64.0.11\n')
    overlay = compose / 'docker-compose.replication-primary.yml'
    hidden = overlay.with_suffix('.hidden')
    overlay.rename(hidden)
    rejected(lambda: resolve_server_compose(work, base))
    hidden.rename(overlay)
    passed_check('marked + missing overlay stops before any Docker operation')
    server_base = json.loads(run(base + ['config', '--format', 'json']))
    server_overlay = json.loads(run(resolve_server_compose(work, base) + ['config', '--format', 'json']))
    phase3_model = json.loads(run(phase3 + ['config', '--format', 'json']))
    specs = required_volume_specs(phase3_model, server_base)
    assert specs == required_volume_specs(phase3_model, server_overlay)
    passed_check('real server/phase3 volume contracts are identical with the overlay')
    run(['docker', 'info'])
    # Verify actual materialization/inspection results as well as model equality.
    for spec in specs:
        Path(spec.options['device']).mkdir(parents=True, exist_ok=True)
    started = True
    assert sorted(materialize(server_compose=base, phase3_compose=phase3)) == sorted(s.name for s in specs)
    assert materialize(server_compose=resolve_server_compose(work, base), phase3_compose=phase3) == []
    passed_check('volume reconciliation agrees with and without the overlay')
    # Start a base primary, install its managed HBA, then simulate S1 apply.
    (marker / 'primary.env').unlink()
    marker.rmdir()
    initial = runtime_argv()
    run(initial + ['up', '-d', '--wait', '--wait-timeout', '120', 'db'])
    cid = run(initial + ['ps', '-q', 'db'])
    run(['docker', 'exec', '-i', '-u', 'postgres', cid, 'sh', '-eu', '-c',
         'cat > "$PGDATA/replication-primary-pg_hba.conf"; chmod 600 "$PGDATA/replication-primary-pg_hba.conf"'],
        input='include pg_hba.conf\n')
    marker.mkdir()
    (marker / 'primary.env').write_text('PI5_REPLICATION_PRIMARY_IP=100.64.0.10\nPI5_REPLICATION_STANDBY_IP=100.64.0.11\n')
    active = runtime_argv()
    run(active + ['up', '-d', '--no-deps', '--wait', '--wait-timeout', '120', '--force-recreate', 'db'])
    cid = run(active + ['ps', '-q', 'db'])
    check_runtime(work, active)
    passed_check('complete marked primary passes deployment admission')
    # Ordinary update includes db through depends_on; no --no-deps or force.
    run(runtime_argv() + ['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'deploy-consumer'])
    assert run(active + ['ps', '-q', 'db']) == cid
    check_runtime(work, runtime_argv())  # wal_level, senders, slots, finite WAL, async/HBA.
    passed_check('dependency-inclusive update preserves db ID and all replication settings')
    # Also exercise an explicit db-containing up and repeat after a fresh resolution.
    run(runtime_argv() + ['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'db'])
    assert run(active + ['ps', '-q', 'db']) == cid
    check_runtime(work, runtime_argv())
    passed_check('explicit db update preserves ID and replication settings')
    saved = (marker / 'primary.env').read_text()
    (marker / 'primary.env').unlink()
    marker.rmdir()
    check_runtime(work, runtime_argv())  # Unmarked: admission is a no-op, as before.
    marker.mkdir()
    (marker / 'primary.env').write_text(saved)
    passed_check('unmarked admission performs no runtime check')
    run(active + ['down', '-v', '--timeout', '10'])
    for spec in specs:  # Materializer volumes are external to this test project.
        if subprocess.run(['docker', 'volume', 'inspect', spec.name], capture_output=True).returncode == 0:
            run(['docker', 'volume', 'rm', spec.name])
    assert not run(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project])
    assert not run(['docker', 'volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project])
    assert not run(['docker', 'network', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project])
    passed_check('cleanup leaves no test project resources')
except Exception as exc:
    print(f'FAIL: {exc}; project={project}; diagnostics={work}; resources_started={started}', file=sys.stderr)
    print(f'RESULT: {passed} passed; runtime incomplete; elapsed={time.monotonic()-start:.1f}s')
    raise SystemExit(1)
else:
    shutil.rmtree(work)
    print(f'RESULT: {passed} passed; elapsed={time.monotonic()-start:.1f}s')
PY
