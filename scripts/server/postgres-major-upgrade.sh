#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# PostgreSQL 15→18の準備・切替。旧DBの停止は運用者がRunbookに従って行う。
usage() {
  cat <<'USAGE'
Usage: postgres-major-upgrade.sh preflight|migrate|activate [options]
  --project-dir DIR  リポジトリ (default: /opt/RaspberryPiSystem_002)
  --compose-file FILE  (default: PROJECT/infrastructure/docker/docker-compose.server.yml)
  --env-file FILE      (default: PROJECT/infrastructure/docker/.env)
  --work-dir DIR     ダンプ・比較結果 (default: /opt/backups/postgres-major-upgrade/UTC timestamp)
  --new-image IMAGE  (default: pgvector/pgvector:pg18)
  --expect-major 18|15  activateで必須。--work-dirも必須
  --help
旧コンテナ/ボリュームはmigrateでは変更しない。失敗時も新ボリュームと作業ファイルを保持する。
USAGE
}
fail() { echo "ERROR: $*" >&2; exit 1; }
command_name="${1:---help}"
case "$command_name" in --help|-h) usage; exit 0;; preflight|migrate|activate) shift;; *) usage >&2; exit 1;; esac
project_dir=/opt/RaspberryPiSystem_002
compose_file= env_file= work_dir= expect_major=
new_image=pgvector/pgvector:pg18
temporary_container=
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$temporary_container" ]]; then
    docker stop "$temporary_container" >/dev/null || status=1
    docker rm "$temporary_container" >/dev/null || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0;;
    --project-dir|--compose-file|--env-file|--work-dir|--new-image|--expect-major)
      (($# >= 2)) || fail "$1 requires a value"
      case "$1" in
        --project-dir) project_dir=$2;; --compose-file) compose_file=$2;;
        --env-file) env_file=$2;; --work-dir) work_dir=$2;;
        --new-image) new_image=$2;; --expect-major) expect_major=$2;;
      esac
      shift 2;;
    *) fail "Unknown option: $1";;
  esac
done
if [[ "$command_name" == activate ]]; then
  [[ "$expect_major" == 15 || "$expect_major" == 18 ]] || fail 'activate requires --expect-major 18|15'
  [[ -n "$work_dir" && -f "$work_dir/migrate.done" ]] || fail 'activate requires --work-dir with migrate.done'
fi
compose_file=${compose_file:-$project_dir/infrastructure/docker/docker-compose.server.yml}
env_file=${env_file:-$project_dir/infrastructure/docker/.env}
work_dir=${work_dir:-/opt/backups/postgres-major-upgrade/$(date -u +%Y%m%dT%H%M%SZ)}
compose=(docker compose --project-directory "$project_dir" --env-file "$env_file" -f "$compose_file")
# JSONの内容をログに出さない。解決済み設定には秘密値が含まれる場合がある。
config=$("${compose[@]}" config --format json)
config_value() { python3 -c "$1" <<<"$config"; }
project=$(config_value 'import json,sys; print(json.load(sys.stdin)["name"])')
database=$(config_value 'import json,sys; print(json.load(sys.stdin)["services"]["db"]["environment"]["POSTGRES_DB"])')
old_volume=$(config_value 'import json,sys; print(json.load(sys.stdin)["volumes"]["db-data"]["name"])')
new_volume=$(config_value 'import json,sys; c=json.load(sys.stdin); print(c.get("volumes",{}).get("db-data-pg18",{}).get("name", c["volumes"]["db-data"]["name"]+"-pg18"))')
[[ "$old_volume" != "$new_volume" ]] || fail 'Old and new volumes must differ'
psql_db() { docker exec -i "$1" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d "$database" "${@:2}"; }
major() { docker exec "$1" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'SELECT current_setting('\''server_version_num'\'')::int / 10000'; }
running_db() {
  db_container=$("${compose[@]}" -p "$project" ps -q db)
  [[ -n "$db_container" ]] || fail 'Running db container not found'
  [[ $(docker inspect --format '{{.State.Health.Status}}' "$db_container") == healthy ]] || fail 'db is not healthy'
}
report() {
  local container=$1 output=$2
  # OIDや内部ロールの版差を除き、ACLの配列順も正規化する。
  psql_db "$container" <<'SQL' | LC_ALL=C sort > "$output"
SET timezone = 'UTC';
SET datestyle = 'ISO, YMD';
SELECT json_build_array('database', datname, pg_get_userbyid(datdba), pg_encoding_to_char(encoding), datcollate, datctype, (SELECT array_agg(x::text ORDER BY x::text COLLATE "C") FROM unnest(datacl) x)) FROM pg_database WHERE datname=current_database();
SELECT json_build_array('role', rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil, (SELECT rolconfig FROM pg_roles WHERE oid=pg_authid.oid), md5(rolpassword)) FROM pg_authid WHERE left(rolname,3)<>'pg_';
SELECT json_build_array('membership', r.rolname, m.rolname, a.admin_option) FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member;
SELECT json_build_array('schema', nspname, pg_get_userbyid(nspowner), (SELECT array_agg(x::text ORDER BY x::text COLLATE "C") FROM unnest(nspacl) x)) FROM pg_namespace WHERE left(nspname,3)<>'pg_' AND nspname<>'information_schema';
SELECT json_build_array('default_acl', pg_get_userbyid(d.defaclrole), coalesce(n.nspname,''), d.defaclobjtype, (SELECT array_agg(x::text ORDER BY x::text COLLATE "C") FROM unnest(d.defaclacl) x)) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace;
SELECT json_build_array('table', n.nspname, c.relname, pg_get_userbyid(c.relowner), (SELECT array_agg(x::text ORDER BY x::text COLLATE "C") FROM unnest(c.relacl) x), (xpath('/row/count/text()', query_to_xml(format('SELECT count(*) FROM %I.%I', n.nspname,c.relname), false,true,'')))[1]::text) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema';
SELECT json_build_array('sequence', n.nspname, c.relname, (xpath('/row/last_value/text()',x.data))[1]::text, (xpath('/row/is_called/text()',x.data))[1]::text) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL (SELECT query_to_xml(format('SELECT last_value,is_called FROM %I.%I',n.nspname,c.relname),false,true,'') AS data) x WHERE c.relkind='S' AND left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema';
SELECT json_build_array('extension', extname) FROM pg_extension;
SQL
  [[ $(psql_db "$container" -c "SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pg_trgm')") == 2 ]] || fail 'vector and pg_trgm are required'
  psql_db "$container" -c 'SELECT json_build_array(extname,extversion) FROM pg_extension ORDER BY extname COLLATE "C"' > "$output.extensions"
}
preflight() {
  running_db
  [[ $(major "$db_container") == 15 ]] || fail 'Source server must be PostgreSQL 15'
  docker inspect "$db_container" | python3 -c 'import json,sys; c=json.load(sys.stdin)[0]; assert any(m["Type"]=="volume" and m["Name"]==sys.argv[1] and m["Destination"]=="/var/lib/postgresql/data" for m in c["Mounts"]), "Source volume mismatch"' "$old_volume"
  local clients size required work_free docker_root docker_free
  clients=$(psql_db "$db_container" -c "SELECT pid,usename,application_name,client_addr,state FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() ORDER BY pid")
  [[ -z "$clients" ]] || { echo "$clients" >&2; fail 'DB clients remain; stop API/web and other clients first'; }
  mkdir -p "$work_dir"
  chmod 0700 "$work_dir"
  size=$(psql_db "$db_container" -c 'SELECT pg_database_size(current_database())')
  # 圧縮率を仮定せず、ダンプ見積りにもDBサイズ1個分を確保する。
  required=$((size * 3))
  work_free=$(python3 -c 'import shutil,sys; print(shutil.disk_usage(sys.argv[1]).free)' "$work_dir")
  docker_root=$(docker info --format '{{.DockerRootDir}}')
  docker_free=$(docker run --rm --network none --read-only --mount "type=bind,source=$docker_root,target=/docker-root,readonly" --entrypoint df "$new_image" -Pk /docker-root | awk 'NR==2 {printf "%.0f", $4*1024}')
  [[ "$work_free" =~ ^[0-9]+$ && "$docker_free" =~ ^[0-9]+$ ]] || fail 'Cannot measure free space'
  echo "DB bytes=$size dump estimate=$size required=$required work free=$work_free Docker root free=$docker_free"
  ((work_free >= required && docker_free >= required)) || fail 'Insufficient free space (2 x DB + dump estimate required on both filesystems)'
  if docker volume inspect "$new_volume" >/dev/null 2>&1; then
    docker run --rm --network none --read-only --mount "type=volume,source=$new_volume,target=/target,readonly" --entrypoint sh "$new_image" -ec '[ -z "$(ls -A /target)" ]' || fail "Target volume is not empty: $new_volume"
  fi
  echo "Preflight OK: project=$project database=$database old=$old_volume new=$new_volume work=$work_dir"
}
case "$command_name" in
  preflight) preflight;;
  migrate)
    preflight
    [[ ! -e "$work_dir/globals.sql" && ! -e "$work_dir/database.dump" && ! -e "$work_dir/migrate.done" ]] || fail 'Use a fresh work directory'
    # パスワードの内容は読まず、旧コンテナのbindだけを同じread-onlyパスへ渡す。
    password_path=$(docker inspect "$db_container" | python3 -c 'import json,sys; c=json.load(sys.stdin)[0]; env=dict(x.split("=",1) for x in c["Config"]["Env"]); p=env["POSTGRES_PASSWORD_FILE"]; m=next(m for m in c["Mounts"] if m["Destination"]==p and m["Type"]=="bind" and not m["RW"]); print(m["Source"])')
    docker exec "$db_container" pg_dumpall -U postgres --globals-only > "$work_dir/globals.sql"
    docker exec "$db_container" pg_dump -U postgres -Fc --create "$database" > "$work_dir/database.dump"
    report "$db_container" "$work_dir/old.report"
    docker volume create "$new_volume" >/dev/null
    temporary_name="pg-major-upgrade-$(date -u +%Y%m%d%H%M%S)-$$-$RANDOM"
    temporary_container=$(docker run -d --name "$temporary_name" --network none \
      --mount "type=volume,source=$new_volume,target=/var/lib/postgresql" \
      --mount "type=bind,source=$password_path,target=/run/secrets/postgres-superuser-password,readonly" \
      -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres-superuser-password \
      -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres "$new_image")
    ready=0
    for ((i=0; i<120; i++)); do
      if docker logs "$temporary_container" 2>&1 | grep -q 'PostgreSQL init process complete' &&
         docker exec "$temporary_container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
      sleep 1
    done
    ((ready)) || fail 'Temporary PostgreSQL initialization timed out (120s)'
    [[ $(major "$temporary_container") == 18 ]] || fail 'New image must run PostgreSQL 18'
    sed '/^CREATE ROLE postgres;$/d' "$work_dir/globals.sql" | docker exec -i "$temporary_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres > "$work_dir/globals-restore.log"
    docker exec -i "$temporary_container" pg_restore -U postgres --exit-on-error --create -d postgres < "$work_dir/database.dump"
    # pg15のGRANT ALLはpg18では新しいMAINTAIN権限も付ける。
    # 比較から除外せず、復元先の明示ACLをpg15と同じ権限へ戻す。
    psql_db "$temporary_container" <<'SQL' > "$work_dir/acl-restore.log"
SELECT format('REVOKE MAINTAIN ON TABLE %I.%I FROM %s;', n.nspname,c.relname,
  CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
  AND c.relkind IN ('r','p','v','m','f') AND a.privilege_type='MAINTAIN'
ORDER BY n.nspname,c.relname,a.grantee
\gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I %s REVOKE MAINTAIN ON TABLES FROM %s;',
  pg_get_userbyid(d.defaclrole),
  CASE WHEN n.nspname IS NULL THEN '' ELSE format('IN SCHEMA %I',n.nspname) END,
  CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END)
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclobjtype='r' AND a.privilege_type='MAINTAIN'
ORDER BY d.defaclrole,d.defaclnamespace,a.grantee
\gexec
SQL
    docker exec "$temporary_container" vacuumdb -U postgres --all --analyze-in-stages > "$work_dir/analyze.log"
    report "$temporary_container" "$work_dir/new.report"
    diff -u "$work_dir/old.report" "$work_dir/new.report" > "$work_dir/migrate.diff" || fail "Report mismatch: $work_dir/migrate.diff"
    # 別project/DBの作業結果をactivateで誤使用しない。
    python3 -c 'import json,sys; json.dump(sys.argv[1:],sys.stdout)' "$project" "$database" "$old_volume" "$new_volume" > "$work_dir/identity.json"
    docker stop "$temporary_container" >/dev/null
    docker rm "$temporary_container" >/dev/null
    temporary_container=
    printf 'old=%s/old.report\nnew=%s/new.report\n' "$work_dir" "$work_dir" > "$work_dir/migrate.done"
    echo "Migration OK: $work_dir/migrate.done (extension versions: *.report.extensions)";;
  activate)
    python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))==sys.argv[2:], "Migration identity mismatch"' "$work_dir/identity.json" "$project" "$database" "$old_volume" "$new_volume"
    python3 -c '
import json,re,sys
c=json.load(sys.stdin); s=c["services"]["db"]; major=sys.argv[1]
assert re.search(r":(?:pg)?"+major+r"(?:[.\-][^@]*)?(?:@sha256:[a-f0-9]+)?$", s["image"]), "Image tag does not match expected major"
key,target=("db-data-pg18","/var/lib/postgresql") if major=="18" else ("db-data","/var/lib/postgresql/data")
assert any(m["type"]=="volume" and m["source"]==key and m["target"]==target and not m.get("read_only",False) for m in s["volumes"]), "Unexpected db volume mount"
' "$expect_major" <<< "$config"
    "${compose[@]}" -p "$project" up -d --no-deps --wait db
    running_db
    [[ $(major "$db_container") == "$expect_major" ]] || fail 'Activated server major mismatch'
    side=old; [[ "$expect_major" != 18 ]] || side=new
    report "$db_container" "$work_dir/activated-$expect_major.report"
    diff -u "$work_dir/$side.report" "$work_dir/activated-$expect_major.report" > "$work_dir/activate-$expect_major.diff" || fail "Activated report mismatch: $work_dir/activate-$expect_major.diff"
    echo "Activate OK: PostgreSQL $expect_major";;
esac
