---
id: postgres-15-to-18-upgrade
title: PostgreSQL 15→18 移行・切戻しRunbook
status: active
last_verified: 2026-10-29
---

# PostgreSQL 15→18 移行・切戻しRunbook

## 目的

`borrow_return` を稼働中のpg15からダンプし、新しい `db-data-pg18` へ復元して比較する。
詳細計画は [更新計画 第5節](../plans/software-support-upgrade-execplan.md#5-postgresql-15--18)。
移行スクリプトは旧コンテナを停止せず、旧ボリュームを復元先にしない。
旧DBの停止と業務再開の判断はこの手順に従って運用者が行う。

## 前提条件

- **本番移行の実行直前にユーザーの明示承認を得る。** 準備PRの承認とは別に扱う。
- 試し移行・切戻しの実測時間を記録し、保守時間はその3倍以上を確保する。
  2026-10-29のMac試行はダンプ150秒、コピー復元82秒、preflight 3秒、migrate 100秒、
  停止＋activate 18は5秒、切戻しの停止＋activate 15は4秒。
  Pi5は遅くなる見込みのため、保守時間は1時間を確保する（[試行結果](../plans/software-support-upgrade-execplan.md#progress)）。
- 対象branch/不変SHAとCI成功を確認してから実機へ接続する。
- Docker、Compose v2（JSON configと `--wait` 対応）、bash、Python 3を用意する。
  実行ユーザーはDockerとバックアップ用ディレクトリへの権限を持つこと。
- `pgvector/pgvector:pg15` と `:pg18` を事前にpullする。
- 切替PR（計画の手順4）はpg18、`db-data-pg18:/var/lib/postgresql`、ガードentrypoint、
  `command: [postgres]`、旧 `db-data:/mnt/legacy-pgdata:ro`、ガードスクリプトのread-only bindを含む。
  旧 `db-data` の宣言を残す。
- **Dockerfile.apiの `postgresql-client-15`（APIバックアップのpg_dump）は切替PRまでに18へ更新する。**
  pg_dump 18はpg15サーバーも扱えるため、先行更新してよい。
- pg18のPGDATAはイメージの環境変数を使う。ガードは新PGDATAに `PG_VERSION` がなく、
  旧PGDATAにある場合に初期化を拒否する。`POSTGRES_MAJOR_UPGRADE_ALLOW_INITDB=1` は
  意図した新規初期化だけの明示的な例外であり、移行時は設定しない。
- DBサイズの2倍＋ダンプ見積り分（スクリプトでは保守的にDBサイズ1個分）を、
  作業ディレクトリとDocker rootの両方に確保する。既存データのある移行先は使用できない。
- globalsダンプはロールのパスワードハッシュを含む。作業ディレクトリは0700、ファイルは0600。
  ログやPRへダンプを貼らず、Pi外の写しもアクセスを制限する。

## 当日の手順

以下はPi5上のbashで実行する。project名とvolume名はスクリプトがComposeから解決する。
`WORK` は一度の移行専用とし、失敗した結果を上書きするために使い回さない。

```bash
cd /opt/RaspberryPiSystem_002
ENV_FILE="$PWD/infrastructure/docker/.env"
BASE=(docker compose --env-file "$ENV_FILE" -f infrastructure/docker/docker-compose.server.yml)
SLOTS=(docker compose --env-file "$ENV_FILE" -p bluegreen -f infrastructure/docker/docker-compose.phase3.yml)
WORK="/opt/backups/postgres-major-upgrade/$(date -u +%Y%m%dT%H%M%SZ)"
```

1. **Pi外へバックアップする。** `scripts/server/backup.sh` を手動実行する。
   さらにglobalsとcustom形式のDBダンプを取り、Macへコピーする。
   backup.shが失敗した場合は原因を確認し、成功を確認するまで進まない。

   ```bash
   scripts/server/backup.sh
   install -d -m 0700 "$WORK" "$WORK/off-pi"
   "${BASE[@]}" exec -T db pg_dumpall -U postgres --globals-only > "$WORK/off-pi/globals.sql"
   "${BASE[@]}" exec -T db pg_dump -U postgres -Fc --create borrow_return > "$WORK/off-pi/database.dump"
   chmod 0600 "$WORK/off-pi/"*
   ```

   Macから `scp` でこの2ファイルを保護された保存先へコピーし、双方の `shasum -a 256` を照合する。
   業務停止前のバックアップなので、停止後に生成される移行用の2ファイルも切替前にMacへコピーする。

2. **切替PRをマージし、標準デプロイする。**
   [デプロイ手順](../guides/deployment.md)に従い、CI成功後に `--print-plan` を確認し、
   明示承認済みのexact `--limit` で標準ローリング更新する。
   標準デプロイはbase projectの `db` を再作成しないため、この時点のDBはpg15のまま。
   別の操作がdbを再作成しようとした場合は、空のpg18をガードが停止する。
   **ここから手順6のactivateまで、base projectで `up` を実行しない。** `api`/`web` やサービス名なしの `up` は
   依存する `db` もpg18設定で再作成し、pg15が止まったままになる（ガードがデータは守る）。誤って実行した場合は
   切替前のcomposeを一時的に戻して `"${BASE[@]}" up -d --no-deps db` でpg15を起動し、手順3からやり直す。
   stagingも同じcomposeを使うため、stagingのbase projectも同様に移行するまで `up` しない。

3. **DBクライアントを止める。** 実行中のbluegreenサービスを記録して停止する。
   base projectに残ったAPI、バックアップ処理、監視、手動psql等、他のDBクライアントも止める。
   preflightが接続を表示して拒否する場合は、その接続元を止めてから進める。

   ```bash
   readarray -t ACTIVE_SLOT_SERVICES < <("${SLOTS[@]}" ps --services --status running)
   printf '%s\n' "${ACTIVE_SLOT_SERVICES[@]}" > "$WORK/active-slot-services.txt"
   "${SLOTS[@]}" stop "${ACTIVE_SLOT_SERVICES[@]}"
   scripts/server/postgres-major-upgrade.sh preflight --work-dir "$WORK"
   ```

4. **移行・比較する。** スクリプトはglobalsと `-Fc --create` を保存し、network noneの一時pg18へ
   所有者・ACL付きで復元し、全DBをanalyzeする。pg15の `GRANT ALL` の復元で追加される
   `MAINTAIN` は所有者には残し、他のgranteeから除いて旧権限と一致させる。
   ACL比較はNULLを既定ACLへ展開し、MAINTAINを除いたロール名・権限・grant optionで正規化する。
   新旧比較後に旧DBを再比較し、ダンプ後の更新を検知した場合も失敗する。旧ボリュームは復元先にしない。

   ```bash
   scripts/server/postgres-major-upgrade.sh migrate --work-dir "$WORK"
   cat "$WORK/migrate.done"
   diff -u "$WORK/old.report.extensions" "$WORK/new.report.extensions" || true
   ```

   `old.report` と `new.report` はDB属性、内部ロール以外のロールとパスワードのMD5、membership、
   schema/テーブルの所有者・ACL、全ユーザーテーブルの正確な件数、sequence、default ACL、拡張名を比較する。
   拡張バージョンだけは別ファイルで差を許容する。`vector` と `pg_trgm` は両方必須。
   失敗時はそこで停止する。一時コンテナはtrapで除去され、新旧ボリュームと作業ファイルは残る。
   成功markerなしでactivateしない。移行用 `globals.sql` と `database.dump` もMacへコピーして照合する。

   **migrate が失敗したら:** そこで停止し、`$WORK/migrate.diff`、`$WORK/*.log` と実行ログを確認する。
   再試行には新しい作業ディレクトリを使う。削除するのは新ボリューム `<prefix>_db-data-pg18` だけで、
   **旧 `db-data` は絶対に削除しない。** 次のコマンドでComposeから名前を解決し、旧名と異なり、
   旧名に `-pg18` を付けた新名であることを確認してから削除する（失敗時のWORKは調査用に保持する）。

   ```bash
   readarray -t DB_VOLUMES < <("${BASE[@]}" config --format json | python3 -c '
   import json,sys
   c=json.load(sys.stdin); old=c["volumes"]["db-data"]["name"]
   new=c.get("volumes",{}).get("db-data-pg18",{}).get("name",old+"-pg18")
   print(old); print(new)
   ')
   OLD_VOLUME="${DB_VOLUMES[0]}"
   NEW_VOLUME="${DB_VOLUMES[1]}"
   printf '保持する旧ボリューム: %s\n削除する新ボリューム: %s\n' "$OLD_VOLUME" "$NEW_VOLUME"
   if [[ -n "$OLD_VOLUME" && "$OLD_VOLUME" == *_db-data && "$NEW_VOLUME" != "$OLD_VOLUME" && "$NEW_VOLUME" == "$OLD_VOLUME-pg18" ]]; then
     docker volume rm "$NEW_VOLUME"
   else
     echo '名前が想定と違うため削除しない' >&2
   fi
   WORK="/opt/backups/postgres-major-upgrade/$(date -u +%Y%m%dT%H%M%SZ)"
   ```

5. **旧DBを停止する。** 直前に接続を再確認し、1件でも表示されたら停止して接続元を調査する。
   接続元を止め、ダンプ後の書込みが疑われる場合は新しいWORKで移行をやり直す。

   ```bash
   "${BASE[@]}" exec -T db psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d borrow_return -c "SELECT pid,usename,application_name,client_addr,state FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() ORDER BY pid"
   ```

   ```bash
   "${BASE[@]}" stop db
   ```

6. **pg18を起動する。** 解決済みcomposeのimage/mount、実サーバーmajor、保存済みpg18レポートとの一致を確認する。
   スクリプトはcomposeを編集しない。

   ```bash
   scripts/server/postgres-major-upgrade.sh activate --expect-major 18 --work-dir "$WORK"
   ```

7. **停止したAPI/webを再開して検証する。** 記録したサービスだけを再開する。
   API/web health、主要画面、検索（vector/pg_trgm）、バックアップを確認し、稼働APIスロットで
   `pnpm exec prisma migrate status` が最新であることを確認する。
   他のDBクライアントの再開も記録する。利用者のアクセスはまだ再開しない。

   ```bash
   "${SLOTS[@]}" start "${ACTIVE_SLOT_SERVICES[@]}"
   ```

8. **業務再開前に進行か切戻しかを決める。** 再開後の書込みは旧DBには存在しない。
   判定結果、SHA、移行・activate時間、healthとmigrate statusの結果を作業記録へ残す。

## 切戻し

業務再開前にAPI/webと他のDBクライアントを止め、pg18のdbを停止する。
手順4の切替PRをrevertするか、承認されたpg15のcomposeを復元する。
標準デプロイだけではdbは切り替わらない。旧mountが `/var/lib/postgresql/data` であることを確認し、
同じ作業ディレクトリの旧レポートを使って起動・比較する。

```bash
"${BASE[@]}" stop db
# pg15 composeへ戻した後に実行する
scripts/server/postgres-major-upgrade.sh activate --expect-major 15 --work-dir "$WORK"
```

記録したAPI/webを再開し、health、主要画面、migrate statusを確認してから業務を再開する。
業務再開後の切戻しは更新データを失うため、そのままこの手順を実行せず別途判断する。
最終手段はPi外のglobals＋customダンプからpg15の別の空ボリュームへ復元すること。
pg15でglobalsから `CREATE ROLE postgres;` だけを除外して `psql -X -v ON_ERROR_STOP=1` で適用し、
`pg_restore --exit-on-error --create -d postgres` とanalyzeを行い、データ・権限を検証する。
既存の旧ボリュームへ上書き復元しない。

## 後片付け

旧 `db-data` は**少なくとも2週間**保持する。その間にpg18のDRスナップショットとGoogle Driveからの
復元検証を行う。旧ボリュームの削除はユーザーの明示承認を得た別作業とする。
Macに置いた本番データの試し移行用コピーは、必要な保全期間を確認してから削除する。
切替PRは本番composeのpg18・新旧mount・起動ガードと、Dockerfile.apiのPGDGクライアント18への更新を含む。
マージは移行当日のみ（上記「当日の手順」2）。本番移行は別途明示承認後に行う。
