#!/bin/sh
# 03_delete.sql を1回ずつ呼び、done か止まる条件が出るまで繰り返す。Pi5 上で nohup して使う。
# 1回ごとに接続し直すので、statement_timeout が1回分（削除＋休み）にだけかかる。
cd "$(dirname "$0")" || exit 1
while :; do
  out=$(docker exec -i docker-db-1 psql -U postgres -d borrow_return -X -v ON_ERROR_STOP=1 -v max_batches=1 "$@" < 03_delete.sql 2>&1)
  rc=$?
  printf '%s\n' "$out"
  case "$out" in
    *'NOTICE:  done:'*) echo "03_run: done"; exit 0 ;;
    *'stop: batch took'*) echo "03_run: slow batch, stopped"; exit 2 ;;
  esac
  [ "$rc" -ne 0 ] && { echo "03_run: psql exit $rc, stopped"; exit "$rc"; }
  [ -e STOP ] && { echo "03_run: STOP file found"; exit 0; }
done
