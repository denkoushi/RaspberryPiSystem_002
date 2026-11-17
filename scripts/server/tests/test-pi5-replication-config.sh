#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK_DIR=$(mktemp -d)
trap 'find "$WORK_DIR" -depth -delete' EXIT
START=$SECONDS
mkdir -p "$WORK_DIR/infrastructure/docker/postgres" "$WORK_DIR/apps/api"
# Resolve the real Compose in an isolated relative layout; no repository .env,
# secret files, Docker daemon, containers or host port bindings are accessed.
cp "$ROOT/infrastructure/docker/docker-compose.server.yml" \
  "$ROOT/infrastructure/docker/docker-compose.replication-primary.yml" "$WORK_DIR/infrastructure/docker/"
cp "$ROOT/infrastructure/docker/postgres/db-start-guard.sh" \
  "$ROOT/infrastructure/docker/postgres/replication-primary-pg_hba.conf" "$WORK_DIR/infrastructure/docker/postgres/"
: >"$WORK_DIR/apps/api/.env.example"
cat >"$WORK_DIR/infrastructure/docker/.env" <<ENV
POSTGRES_SUPERUSER_PASSWORD_FILE=$WORK_DIR/dummy-password
APP_DATABASE_URL=postgresql://dummy:dummy@db/borrow_return
ADMIN_ALLOW_NETS=127.0.0.1/32
ENV
base=(docker compose --env-file "$WORK_DIR/infrastructure/docker/.env" -f "$WORK_DIR/infrastructure/docker/docker-compose.server.yml")
overlay=("${base[@]}" -f "$WORK_DIR/infrastructure/docker/docker-compose.replication-primary.yml")
unset PI5_REPLICATION_PRIMARY_IP
docker compose version >/dev/null
if "${overlay[@]}" config --format json >"$WORK_DIR/missing.out" 2>"$WORK_DIR/missing.err"; then
  echo 'FAIL: missing primary IP accepted' >&2; exit 1
fi
grep -q 'PI5_REPLICATION_PRIMARY_IP' "$WORK_DIR/missing.err"
echo 'PASS: unset primary IP fails closed'
PI5_REPLICATION_PRIMARY_IP= "${overlay[@]}" config --quiet >"$WORK_DIR/empty.out" 2>&1 && exit 1
echo 'PASS: empty primary IP fails closed'
export PI5_REPLICATION_PRIMARY_IP=100.64.0.10
"${base[@]}" config --format json >"$WORK_DIR/base.json"
"${overlay[@]}" config --format json >"$WORK_DIR/replication.json"
python3 - "$WORK_DIR/base.json" "$WORK_DIR/replication.json" <<'PY'
import json, sys
base, overlay = [json.load(open(p)) for p in sys.argv[1:]]
db = overlay['services']['db']
assert not base['services']['db'].get('ports')
assert base['services']['db']['command'] == ['postgres']
print('PASS: base remains internal only with original command')
assert db['entrypoint'] == ['/usr/local/bin/db-start-guard.sh']
assert db['command'] == ['postgres', '-c', 'wal_level=replica', '-c',
    'max_wal_senders=4', '-c', 'max_replication_slots=4', '-c',
    'max_slot_wal_keep_size=1024MB', '-c', 'synchronous_standby_names=', '-c',
    'hba_file=/var/lib/postgresql/18/docker/replication-primary-pg_hba.conf']
print('PASS: finite WAL, async and guard command preserved')
p, = db['ports']
assert p['host_ip'] == '100.64.0.10' and p['target'] == 5432
assert str(p['published']) == '5432' and p['protocol'] == 'tcp'
print('PASS: only specified primary IP publishes 5432')
assert base['volumes'] == overlay['volumes']
assert base['services']['db']['volumes'] == db['volumes']
for service in base['services'].keys() - {'db'}:
    assert base['services'][service] == overlay['services'][service]
print('PASS: data volumes and all other services unchanged')
PY
python3 - "$ROOT" "$WORK_DIR" <<'PY'
import pathlib, subprocess, sys
sys.path.insert(0, str(pathlib.Path(sys.argv[1])/'scripts/deploy'))
from pi5_server_compose import resolve_server_compose
p = pathlib.Path(sys.argv[2])
base = ['docker', 'compose', '--env-file', str(p/'infrastructure/docker/.env'),
        '-f', str(p/'infrastructure/docker/docker-compose.server.yml')]
assert resolve_server_compose(p, base) == base
print('PASS: shared resolver leaves unmarked argv exactly unchanged')
marker = p/'config/pi5-replication-primary'
marker.mkdir(parents=True)
(marker/'primary.env').write_text('PI5_REPLICATION_PRIMARY_IP=100.64.0.10\nPI5_REPLICATION_STANDBY_IP=100.64.0.11\n')
def db_hash(argv):
    return subprocess.run([*argv, 'config', '--hash', 'db'], capture_output=True,
                          text=True, check=True).stdout
assert db_hash(resolve_server_compose(p, base, mode='apply')) == db_hash(resolve_server_compose(p, base))
print('PASS: apply and ordinary deployment resolve the same db service hash')
PY
# Exercise the existing start guard with the actual resolved overlay arguments.
cat >"$WORK_DIR/entrypoint" <<'SH'
#!/bin/sh
printf '%s\n' "$@"
SH
chmod +x "$WORK_DIR/entrypoint"
python3 - "$WORK_DIR" <<'PY'
import json, os, pathlib, subprocess, sys
p = pathlib.Path(sys.argv[1])
db = json.loads((p/'replication.json').read_text())['services']['db']
env = dict(os.environ, PGDATA=str(p/'empty-data'),
    DB_START_GUARD_LEGACY_PGDATA=str(p/'empty-legacy'),
    DB_START_GUARD_ENTRYPOINT=str(p/'entrypoint'))
r = subprocess.run(['sh', str(p/'infrastructure/docker/postgres/db-start-guard.sh'),
    *db['command']], env=env, capture_output=True, text=True, check=True)
assert r.stdout.splitlines() == db['command']
print('PASS: guard forwards every overlay postgres argument')
PY
echo "RESULT: 9 passed; elapsed=$((SECONDS-START))s (no Docker runtime)"
