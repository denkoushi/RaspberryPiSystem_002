#!/bin/sh
set -eu

# 旧データがある状態で空のDBを初期化しない。切替手順はRunbookを参照する。
if [ ! -f "${PGDATA:?PGDATA is required}/PG_VERSION" ] &&
   [ -f "${DB_START_GUARD_LEGACY_PGDATA:-/mnt/legacy-pgdata}/PG_VERSION" ] &&
   [ "${POSTGRES_MAJOR_UPGRADE_ALLOW_INITDB:-0}" != 1 ]; then
  echo 'ERROR: 旧PostgreSQLデータがありますが新PGDATAは空です。初期化を拒否します。docs/runbooks/postgres-15-to-18-upgrade.md を確認してください。' >&2
  exit 1
fi

# Dockerなしのテストでは実行先だけを差し替える。
exec "${DB_START_GUARD_ENTRYPOINT:-docker-entrypoint.sh}" "$@"
