#!/usr/bin/env bash
set -euo pipefail

# Opt-in local simulation. KEEP_PI5_STANDBY=1 also keeps successful runs;
# failures always retain this run's resources for diagnosis. No host ports.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="pi5-standby-$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${PROJECT}.XXXXXX")"
COMPOSE_FILE="$HERE/fixtures/pi5-standby/compose.yml"
export STANDBY_TEST_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
REPLICATION_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
START=$SECONDS
STAGE=preflight
STARTED=0
KEEP_PI5_STANDBY="${KEEP_PI5_STANDBY:-0}"
[[ "$KEEP_PI5_STANDBY" == 0 || "$KEEP_PI5_STANDBY" == 1 ]]
umask 077
# Explicit env-file prevents Compose from discovering a repository .env.
printf 'STANDBY_TEST_PASSWORD=%s\n' "$STANDBY_TEST_PASSWORD" >"$WORK_DIR/compose.env"
dc() { docker compose --env-file "$WORK_DIR/compose.env" -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }
pass() { printf 'PASS: %s (%ss)\n' "$1" "$((SECONDS - CHECK_START))"; }
stage() { STAGE="$1"; CHECK_START=$SECONDS; }
sql() { dc exec -T -u postgres "$1" psql -XAtq -v ON_ERROR_STOP=1 -U postgres -d standby_test -c "$2"; }
wait_sql() {
  local service="$1" query="$2" expected="$3" result i
  for ((i=0; i<60; i++)); do
    result="$(sql "$service" "$query" 2>/dev/null)" || result=''
    [[ "$result" == "$expected" ]] && return 0
    sleep 1
  done
  printf 'FAIL: timed out waiting for %s: %s\n' "$service" "$query" >&2
  return 1
}
expect_rejection() {
  local name="$1" pattern="$2"
  shift 2
  if "$@" >"$WORK_DIR/rejection.log" 2>&1; then
    printf 'FAIL: %s unexpectedly succeeded\n' "$name" >&2
    return 1
  fi
  if ! grep -Eq "$pattern" "$WORK_DIR/rejection.log"; then
    cat "$WORK_DIR/rejection.log" >&2
    return 1
  fi
  pass "$name: rejected"
}
on_exit() {
  local status=$?
  trap - EXIT
  set +e
  if ((status != 0)); then
    printf 'FAIL: %s; exit=%s; elapsed=%ss\n' "$STAGE" "$status" "$((SECONDS - START))" >&2
  fi
  if ((status != 0)) || [[ "$KEEP_PI5_STANDBY" == 1 ]]; then
    printf 'KEEP: project=%s work_dir=%s\n' "$PROJECT" "$WORK_DIR"
    printf 'Cleanup: docker compose --env-file %q -p %q -f %q down -v\n' "$WORK_DIR/compose.env" "$PROJECT" "$COMPOSE_FILE"
    # Logs stay in the protected temporary directory; never dump credentials.
    if ((STARTED)); then dc logs --no-color >"$WORK_DIR/compose.log" 2>&1; fi
  else
    dc down -v --timeout 10 >"$WORK_DIR/cleanup.log" 2>&1 || status=1
    if ((status == 0)); then
      for kind in container volume network; do
        if [[ "$kind" == container ]]; then
          residue="$(docker container ls -aq --filter "label=com.docker.compose.project=$PROJECT")" || status=1
        else
          residue="$(docker "$kind" ls -q --filter "label=com.docker.compose.project=$PROJECT")" || status=1
        fi
        [[ -z "$residue" ]] || status=1
      done
    fi
    if ((status == 0)); then
      find "$WORK_DIR" -depth -delete || status=1
      printf 'PASS: cleanup; project resources=0\n'
    else
      printf 'FAIL: cleanup; retained diagnostics=%s\n' "$WORK_DIR" >&2
    fi
  fi
  printf 'RESULT: exit=%s elapsed=%ss\n' "$status" "$((SECONDS - START))"
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Only ever permits pg_promote after positive inspection of this project's
# known primary container. Failed inspection / disconnected Docker fails closed.
promote_guarded() {
  local running recovery
  running="$(docker inspect --format '{{.State.Status}}' "$PRIMARY_ID")" || return 1
  [[ "$running" == exited ]] || { echo 'primary stop not confirmed' >&2; return 1; }
  recovery="$(sql standby 'SELECT pg_is_in_recovery()')" || return 1
  if [[ "$recovery" == f ]]; then echo 'already promoted'; return 0; fi
  [[ "$recovery" == t ]] || return 1
  [[ "$(sql standby 'SELECT pg_promote(true, 30)')" == t ]]
}
initialize_standby() {
  # No automatic clearing or overwriting, even for this disposable PGDATA.
  dc exec -T -u postgres -e "PGPASSWORD=$REPLICATION_PASSWORD" "$1" sh -eu -c '
    if [ -d "$PGDATA" ] && [ -n "$(ls -A "$PGDATA")" ]; then
      echo "nonempty standby data: refusing basebackup" >&2; exit 1
    fi
    pg_basebackup -h primary -U standby_repl -D "$PGDATA" -R -X stream -C -S "$1"
  ' sh "$2"
}
prepare_standby() {
  dc exec -T -u root "$1" sh -eu -c 'mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"'
  initialize_standby "$1" "$2"
  # Password kept out of primary_conninfo and command output.
  printf 'primary:5432:*:standby_repl:%s\n' "$REPLICATION_PASSWORD" |
    dc exec -T -u postgres "$1" sh -c 'cat > /var/lib/postgresql/.pgpass; chmod 600 /var/lib/postgresql/.pgpass'
  dc exec -T -u postgres "$1" pg_ctl -D /var/lib/postgresql/18/docker -l /var/lib/postgresql/server.log -w start >/dev/null
  wait_sql "$1" 'SELECT pg_is_in_recovery()' t
}

stage preflight
command -v grep >/dev/null
docker info >/dev/null
docker compose version >/dev/null
pass preflight
stage isolated-start
STARTED=1
dc up -d primary standby wal-probe >"$WORK_DIR/up.log" 2>&1
PRIMARY_ID="$(dc ps -q primary)"
STANDBY_ID="$(dc ps -q standby)"
NETWORK="${PROJECT}_replication"
# The entrypoint's temporary init server only listens on a Unix socket.
# Wait for the final TCP listener before changing HBA or taking a backup.
for ((i=0; i<60; i++)); do
  if dc exec -T primary pg_isready -h 127.0.0.1 -U postgres -d standby_test >/dev/null 2>&1; then break; fi
  sleep 1
done
dc exec -T primary pg_isready -h 127.0.0.1 -U postgres -d standby_test >/dev/null
wait_sql primary 'SELECT 1' 1
[[ "$(docker network inspect --format '{{.Internal}}' "$NETWORK")" == true ]]
for service in primary standby wal-probe; do
  [[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$(dc ps -q "$service")")" =~ ^(null|\{\})$ ]]
done
pass 'isolation: internal network, no published ports'

stage replication-role-hba
# Replace default broad host rules, retaining only local administration and
# a SCRAM replication rule restricted to this run's private network.
SUBNET="$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' "$NETWORK")"
printf "CREATE ROLE standby_repl LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '%s';\n" "$REPLICATION_PASSWORD" |
  dc exec -T -u postgres primary psql -Xq -v ON_ERROR_STOP=1 -U postgres -d standby_test
printf 'local all all trust\nhost replication standby_repl %s scram-sha-256\nhost all all all reject\nhost replication all all reject\n' "$SUBNET" |
  dc exec -T -u postgres primary sh -c 'cat > "$PGDATA/pg_hba.conf"'
[[ "$(sql primary 'SELECT pg_reload_conf()')" == t ]]
[[ "$(sql primary "SELECT rolcanlogin AND rolreplication AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls) FROM pg_roles WHERE rolname='standby_repl'")" == t ]]
# The HBA rejection must be explicit, not an arbitrary connection failure.
expect_rejection 'HBA other replication role' 'pg_hba.conf rejects replication connection' \
  dc exec -T standby psql -X -d 'host=primary user=postgres replication=true connect_timeout=5' -c 'IDENTIFY_SYSTEM'
expect_rejection 'HBA replication role ordinary SQL' 'pg_hba.conf rejects connection' \
  dc exec -T standby psql -X -d 'host=primary user=standby_repl dbname=standby_test connect_timeout=5' -c 'SELECT 1'
pass 'replication role flags and restricted HBA'

stage basebackup-streaming
prepare_standby standby standby_slot
wait_sql primary "SELECT count(*) FROM pg_stat_replication WHERE state='streaming' AND sync_state='async'" 1
[[ "$(sql primary "SELECT count(*) FROM pg_replication_slots WHERE slot_name='standby_slot' AND slot_type='physical' AND active")" == 1 ]]
dc exec -T -u postgres standby sh -eu -c 'test -f "$PGDATA/standby.signal"; grep -q "primary_slot_name.*standby_slot" "$PGDATA/postgresql.auto.conf"'
pass 'basebackup -R -X stream, physical slot, async streaming, recovery'

stage replicated-row
sql primary "CREATE TABLE loans(id integer PRIMARY KEY, item text); INSERT INTO loans VALUES (1,'fixture-tool')" >/dev/null
wait_sql standby 'SELECT item FROM loans WHERE id=1' fixture-tool
pass 'loan row replicated'
expect_rejection 'standby write' 'read-only transaction' sql standby "INSERT INTO loans VALUES (2,'denied')"
expect_rejection 'second initialization' 'nonempty standby data: refusing basebackup' initialize_standby standby standby_slot
[[ "$(sql standby 'SELECT count(*) FROM loans')" == 1 ]]

stage photo-copy
mkdir -p "$WORK_DIR/primary-photos" "$WORK_DIR/standby-photos"
printf 'small photo fixture\n' >"$WORK_DIR/primary-photos/photo.bin"
photo_matches() {
  [[ -f "$WORK_DIR/standby-photos/photo.bin" ]] || { echo 'photo missing' >&2; return 1; }
  [[ "$(shasum -a 256 "$WORK_DIR/primary-photos/photo.bin" | awk '{print $1}')" == \
     "$(shasum -a 256 "$WORK_DIR/standby-photos/photo.bin" | awk '{print $1}')" ]] || { echo 'photo mismatch' >&2; return 1; }
}
expect_rejection 'photo missing' 'photo missing' photo_matches
printf 'corrupt\n' >"$WORK_DIR/standby-photos/photo.bin"
expect_rejection 'photo mismatch' 'photo mismatch' photo_matches
cp "$WORK_DIR/primary-photos/photo.bin" "$WORK_DIR/standby-photos/photo.bin"
photo_matches
pass 'photo copy SHA256 matches'

stage network-outage
docker network disconnect "$NETWORK" "$STANDBY_ID"
sql primary "INSERT INTO loans VALUES (3,'during-outage')" >/dev/null
[[ "$(sql standby 'SELECT count(*) FROM loans WHERE id=3')" == 0 ]]
pass 'disconnected standby does not receive row'
docker network connect --alias standby "$NETWORK" "$STANDBY_ID"
wait_sql standby 'SELECT item FROM loans WHERE id=3' during-outage
wait_sql primary "SELECT count(*) FROM pg_stat_replication WHERE state='streaming' AND sync_state='async'" 1
pass 'network reconnect catches up'

# A separate disposable standby keeps the healthy pair available for promotion.
# Generate bounded WAL (at most 192 MiB of segment switches), not a timed load.
stage wal-loss
prepare_standby wal-probe wal_loss_slot
wait_sql primary "SELECT active FROM pg_replication_slots WHERE slot_name='wal_loss_slot'" t
dc exec -T -u postgres wal-probe pg_ctl -D /var/lib/postgresql/18/docker -m fast -w stop >/dev/null
wait_sql primary "SELECT active FROM pg_replication_slots WHERE slot_name='wal_loss_slot'" f
for ((i=0; i<12; i++)); do
  sql primary "INSERT INTO loans VALUES ($((100+i)), 'wal-fixture')" >/dev/null
  flush_lsn="$(sql primary 'SELECT pg_current_wal_flush_lsn()')"
  wait_sql standby "SELECT pg_last_wal_replay_lsn() >= '$flush_lsn'::pg_lsn" t
  sql primary 'SELECT pg_switch_wal(); CHECKPOINT' >/dev/null
  [[ "$(sql primary "SELECT wal_status FROM pg_replication_slots WHERE slot_name='wal_loss_slot'")" == lost ]] && break
done
[[ "$(sql primary "SELECT wal_status || ':' || invalidation_reason FROM pg_replication_slots WHERE slot_name='wal_loss_slot'")" == lost:wal_removed ]]
sql primary "INSERT INTO loans VALUES (999,'requires-rebuild')" >/dev/null
dc exec -T -u postgres wal-probe pg_ctl -D /var/lib/postgresql/18/docker -l /var/lib/postgresql/server.log -w start >/dev/null
wait_sql wal-probe 'SELECT pg_is_in_recovery()' t
for ((i=0; i<30; i++)); do
  if dc exec -T wal-probe sh -c 'grep -Eq "invalidated|removed" /var/lib/postgresql/server.log'; then break; fi
  sleep 1
done
dc exec -T wal-probe sh -c 'grep -Eq "invalidated|removed" /var/lib/postgresql/server.log'
[[ "$(sql wal-probe 'SELECT count(*) FROM loans WHERE id=999')" == 0 ]]
pass 'WAL missing: slot lost/wal_removed, replay blocked, rebuild required'

stage promotion-guard
expect_rejection 'promotion while primary running' 'primary stop not confirmed' promote_guarded
[[ "$(sql standby 'SELECT pg_is_in_recovery()')" == t ]]
# Wait for the final row before deliberately stopping the only writer.
wait_sql standby 'SELECT item FROM loans WHERE id=999' requires-rebuild
dc stop -t 30 primary >/dev/null
promote_guarded
[[ "$(sql standby 'SELECT pg_is_in_recovery()')" == f ]]
sql standby "INSERT INTO loans VALUES (1000,'after-promotion')" >/dev/null
[[ "$(sql standby 'SELECT item FROM loans WHERE id=1000')" == after-promotion ]]
pass 'primary stopped: promotion and write succeed'
[[ "$(promote_guarded)" == 'already promoted' ]]
pass 'second promotion: already promoted, no operation'
