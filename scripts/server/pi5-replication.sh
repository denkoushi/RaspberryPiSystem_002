#!/usr/bin/env bash
set +x
set -Eeuo pipefail
umask 077

usage() {
  cat <<'USAGE'
Usage: pi5-replication.sh plan|apply|remove|status [options]
  --project-dir DIR     default: /opt/RaspberryPiSystem_002
  --env-file FILE       default: PROJECT/infrastructure/docker/.env
  --primary-ip IP       primary Tailscale IPv4 (plan/apply)
  --standby-ip IP       standby Tailscale IPv4 (plan/apply)
  --password-file FILE  protected, nonempty single-line password (apply only)
  --yes                required for apply/remove; db is recreated and interrupted
  --help
Apply only after the S1 backup/restore, SHA/CI and outage approval checks.
1 GiB slot WAL cap is provisional: lost slots require rebuilding the standby.
Standard fleet deployment stops while the replication marker exists.
Existing role credentials are preserved. remove refuses existing physical slots;
retire those slots separately first. No data volume is removed or moved.
USAGE
}
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
action=${1:---help}
case "$action" in
  --help|-h) usage; exit 0;;
  plan|apply|remove|status) shift;;
  *) fail 'Unknown subcommand';;
esac
project_dir=/opt/RaspberryPiSystem_002
env_file= primary_ip= standby_ip= password_file= yes=0
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0;;
    --yes) yes=1; shift;;
    --project-dir|--env-file|--primary-ip|--standby-ip|--password-file)
      (($# >= 2)) && [[ -n "$2" && "$2" != --* ]] || fail 'Option requires a value'
      case "$1" in
        --project-dir) project_dir=$2;; --env-file) env_file=$2;;
        --primary-ip) primary_ip=$2;; --standby-ip) standby_ip=$2;;
        --password-file) password_file=$2;;
      esac
      shift 2;;
    *) fail 'Unknown option';;
  esac
done
if [[ "$action" == apply || "$action" == remove ]]; then
  [[ "$yes" == 1 ]] || fail 'apply/remove require --yes (database interruption)'
else
  [[ "$yes" == 0 ]] || fail '--yes is only valid for apply/remove'
fi
if [[ "$action" == plan || "$action" == apply ]]; then
  python3 - "$primary_ip" "$standby_ip" <<'PY' || fail 'Require distinct primary/standby Tailscale IPv4 addresses'
import ipaddress, sys
try:
    ips = [ipaddress.IPv4Address(s) for s in sys.argv[1:]]
    assert ips[0] != ips[1]
    assert all(ip in ipaddress.IPv4Network('100.64.0.0/10') for ip in ips)
except (ValueError, AssertionError):
    sys.exit(1)
PY
else
  [[ -z "$primary_ip$standby_ip" ]] || fail 'IP options are only valid for plan/apply'
fi
if [[ "$action" == apply ]]; then
  [[ -n "$password_file" ]] || fail 'apply requires --password-file'
  python3 - "$password_file" <<'PY' || fail 'Password file must be protected and contain one nonempty line'
import pathlib, stat, sys
try:
    p = pathlib.Path(sys.argv[1])
    assert p.is_file() and stat.S_IMODE(p.stat().st_mode) & 0o077 == 0
    value = p.read_bytes().decode().removesuffix('\n')
    assert value and not any(c in value for c in ('\n', '\r', '\0'))
except (OSError, UnicodeError, AssertionError):
    sys.exit(1)
PY
else
  [[ -z "$password_file" ]] || fail '--password-file is only valid for apply'
fi
[[ -d "$project_dir" ]] || fail 'Project directory does not exist'
project_dir=$(cd "$project_dir" && pwd)
env_file=${env_file:-$project_dir/infrastructure/docker/.env}
compose_dir=$project_dir/infrastructure/docker
overlay=$compose_dir/docker-compose.replication-primary.yml
state_dir=$project_dir/config/pi5-replication-primary
pgdata=/var/lib/postgresql/18/docker
managed_hba=$pgdata/replication-primary-pg_hba.conf
base=(docker compose --env-file "$env_file" -f "$compose_dir/docker-compose.server.yml")
# Never print resolved Compose models: they can contain unrelated secrets.
config=$("${base[@]}" config --format json)
project=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])' <<<"$config")
unset config
base+=(-p "$project")
db_id=$("${base[@]}" ps -q db)
[[ -n "$db_id" && "$db_id" != *$'\n'* ]] || fail 'Require one running primary db'
sql() { docker exec -i -u postgres "$db_id" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
[[ $(sql -c 'SELECT pg_is_in_recovery()') == f ]] || fail 'db is not a primary'

settings_report() {
  sql <<'SQL'
SELECT 'name|current|unit|desired|context|pending_restart';
WITH desired(name, value) AS (VALUES
  ('wal_level', 'replica'), ('max_wal_senders', '4'),
  ('max_replication_slots', '4'), ('max_slot_wal_keep_size', '1024 MB'),
  ('synchronous_standby_names', ''),
  ('hba_file', '/var/lib/postgresql/18/docker/replication-primary-pg_hba.conf'))
SELECT s.name, s.setting, coalesce(s.unit, ''), d.value, s.context, s.pending_restart
FROM pg_settings s JOIN desired d USING (name) ORDER BY s.name;
SQL
}
check_slots() {
  [[ $(sql -c "SELECT count(*) FROM pg_replication_slots WHERE wal_status='lost' OR invalidation_reason IS NOT NULL") == 0 ]] ||
    fail 'WAL is unavailable: stop replication setup and rebuild the standby; no automatic slot reset'
}
if [[ "$action" == plan ]]; then
  printf 'Plan: bind %s:5432; replication role raspi_replicator; standby %s/32 (SCRAM).\n' "$primary_ip" "$standby_ip"
  settings_report
  printf '%s\n' 'apply recreates db even if values match; plan performs no writes.' \
    'postmaster settings require restart; role/HBA rules alone require no restart (HBA reload).' \
    'Original PGDATA/pg_hba.conf is retained and included; remove restores the base Compose command and closes the host port.' \
    'Confirm outage duration, backups + isolated restore, SHA/CI and Tailscale ACL before apply.'
  exit 0
fi
if [[ "$action" == status ]]; then
  if [[ -e "$state_dir" ]]; then echo 'Replication marker: present (may be incomplete)'; else echo 'Replication marker: absent'; fi
  settings_report
  sql -c 'SELECT usename, client_addr, state, sync_state FROM pg_stat_replication'
  sql -c 'SELECT slot_name, slot_type, active, wal_status, invalidation_reason, safe_wal_size FROM pg_replication_slots'
  check_slots
  exit 0
fi

mkdir -p "$project_dir/config"
exec 9>"$project_dir/config/.pi5-replication.lock"
flock -n 9 || fail 'Another replication apply/remove is running'
# The script manages only the image default PG18 layout, not custom HBA setups.
[[ $(sql -c 'SHOW data_directory') == "$pgdata" ]] || fail 'Unsupported PGDATA; refusing to change it'
hba=$(sql -c 'SHOW hba_file')
[[ "$hba" == "$pgdata/pg_hba.conf" || "$hba" == "$managed_hba" ]] || fail 'Custom HBA configuration; refusing to replace it'
if [[ "$action" == remove ]]; then
  [[ -d "$state_dir" ]] || fail 'Replication marker is absent; nothing to remove'
  # Base PostgreSQL may default to unlimited slot WAL retention. Never leave an
  # abandoned physical slot behind, and never silently drop one for the operator.
  [[ $(sql -c "SELECT count(*) FROM pg_replication_slots WHERE slot_type='physical'") == 0 ]] ||
    fail 'Retire physical replication slots separately before remove (unbounded WAL retention risk)'
  "${base[@]}" up -d --no-deps --pull never --wait --wait-timeout 120 --force-recreate db >/dev/null
  db_id=$("${base[@]}" ps -q db)
  [[ $(sql -c 'SHOW hba_file') == "$pgdata/pg_hba.conf" ]] || fail 'Base HBA was not restored; marker retained'
  [[ $(docker inspect --format '{{json .HostConfig.PortBindings}}' "$db_id") =~ ^(null|\{\})$ ]] || fail 'Host port still published; marker retained'
  # Keep the role, generated HBA and all data. Only retire the non-secret marker.
  [[ ! -f "$state_dir/primary.env" ]] || unlink "$state_dir/primary.env"
  rmdir "$state_dir"
  echo 'Removed replication overlay; db is internal only. Data and role retained.'
  exit 0
fi

[[ -f "$overlay" && -f "$compose_dir/postgres/replication-primary-pg_hba.conf" ]] || fail 'Replication configuration is missing'
tailscale ip -4 | grep -Fxq "$primary_ip" || fail 'Primary IP is not assigned by local Tailscale; refusing port publication'
check_slots
export PI5_REPLICATION_PRIMARY_IP=$primary_ip
replicated=("${base[@]}" -f "$overlay")
"${replicated[@]}" config --quiet
if [[ -e "$state_dir" ]]; then
  [[ -f "$state_dir/primary.env" ]] &&
    [[ $(cat "$state_dir/primary.env") == "$(printf 'PI5_REPLICATION_PRIMARY_IP=%s\nPI5_REPLICATION_STANDBY_IP=%s' "$primary_ip" "$standby_ip")" ]] ||
    fail 'Replication marker differs or is incomplete; inspect and remove before changing addresses'
else
  mkdir "$state_dir"
  printf 'PI5_REPLICATION_PRIMARY_IP=%s\nPI5_REPLICATION_STANDBY_IP=%s\n' "$primary_ip" "$standby_ip" >"$state_dir/primary.env"
fi
# Marker precedes every database mutation and survives failures, blocking fleet
# deployment until apply succeeds or explicit remove restores the base service.
PI5_REPLICATION_PASSWORD=$(cat "$password_file")
export PI5_REPLICATION_PASSWORD
if ! docker exec -i -u postgres -e PI5_REPLICATION_PASSWORD "$db_id" \
  psql -Xq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  <"$project_dir/scripts/deploy/postgres-replication-bootstrap.sql" >/dev/null 2>&1; then
  unset PI5_REPLICATION_PASSWORD
  fail 'Replication role bootstrap failed; credentials suppressed, marker retained'
fi
unset PI5_REPLICATION_PASSWORD
sed "s/@STANDBY_IP@/$standby_ip/g" "$compose_dir/postgres/replication-primary-pg_hba.conf" |
  docker exec -i -u postgres "$db_id" sh -eu -c '
    test -f "$PGDATA/PG_VERSION" && test -f "$PGDATA/pg_hba.conf"
    cat > "$PGDATA/replication-primary-pg_hba.conf.tmp"
    chmod 600 "$PGDATA/replication-primary-pg_hba.conf.tmp"
    mv "$PGDATA/replication-primary-pg_hba.conf.tmp" "$PGDATA/replication-primary-pg_hba.conf"
  '
"${replicated[@]}" up -d --no-deps --pull never --wait --wait-timeout 120 --force-recreate db >/dev/null
db_id=$("${replicated[@]}" ps -q db)
[[ $(sql -c 'SHOW hba_file') == "$managed_hba" ]] || fail 'Managed HBA not active; marker retained'
[[ $(sql -c 'SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL') == 0 ]] || fail 'HBA parse errors; marker retained'
[[ $(sql -c "SELECT current_setting('synchronous_standby_names') = '' AND current_setting('wal_level') = 'replica' AND current_setting('max_wal_senders') = '4' AND current_setting('max_replication_slots') = '4' AND pg_size_bytes(current_setting('max_slot_wal_keep_size')) = 1073741824") == t ]] || fail 'Replication settings not active; marker retained'
echo 'Applied asynchronous primary replication. Verify API health and allowed/denied remote connections before acceptance.'
