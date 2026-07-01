# セキュリティ強化履歴（2026-06-30 第1-2段階 + Pi5反映 / 2026-07-01 第3段階）

最終更新: 2026-07-01 JST

## 前提

- 対象はローカルリポジトリ `/Users/tsudatakashi/RaspberryPiSystem_002`。
- Pi5実機へ反映済み。Pi4/Pi3は今回の反映対象外。
- 既存DBデータの変更を目的とする操作は行っていない。DB migration追加もなし。
- 一時Postgresコンテナはローカル検証後に削除済み。
- 2段階認証/MFAは、iPhone/旧スマホの確認が終わるまで保留。今回も未変更。
- Ansible vault の中身確認、鍵ローテーション、実機SSH設定変更は未実施。
- 2026-07-01 第3段階はブランチ `security-system-api-hardening-20260701` で実装し、Pi5実機へ反映済み。Pi4/Pi3は今回の反映対象外。

## 背景

外部侵入、ランサムウェア、踏み台化、データ持出、乗っ取りを防ぐ構造になっているかを確認した結果、Tailscale/Caddy/UFW/fail2ban は有効な外側の防御だが、アプリ内に「1つ突破された後の制限」が弱い箇所があった。

特に優先したのは、通常運用を止めにくく、実機反映時の切り戻しもしやすいアプリ層の対策。

## 実装済み

### 1. 貸出APIの未認証利用を遮断

対象:

- `apps/api/src/routes/tools/loans/active.ts`
- `apps/api/src/routes/tools/loans/borrow.ts`
- `apps/api/src/routes/tools/loans/photo-borrow.ts`
- `apps/api/src/routes/tools/loans/return.ts`
- `apps/api/src/routes/tools/loans/cancel.ts`
- `apps/api/src/routes/tools/loans/delete.ts`
- `apps/api/src/routes/tools/loans/auth.ts`

内容:

- 貸出/返却/取消/削除/持出中一覧は、有効な `x-client-key` または管理者系JWTが必要。
- `x-client-key` で認証した端末と、リクエスト本文/クエリの `clientId` が食い違う場合は拒否。
- 通常のキオスク端末が、自分の正しい `x-client-key` で操作する経路は維持。

期待する効果:

- URLやAPI仕様を知っているだけでは貸出APIを操作できない。
- 端末Aのキーで端末Bの `clientId` を指定する横取りを防ぐ。

### 2. 写真・ローカルバックアップのパス検証を強化

対象:

- `apps/api/src/lib/photo-storage.ts`
- `apps/api/src/services/backup/storage/local-storage.provider.ts`
- `apps/api/src/lib/__tests__/photo-storage.test.ts`
- `apps/api/src/services/backup/__tests__/backup.service.test.ts`

内容:

- `..`、絶対パス、NUL文字、保存ディレクトリ外へ出るパスを拒否。
- 写真URLの不正なパーセントエンコードも `Invalid photo path` として拒否。
- 正常な `/api/storage/photos/YYYY/MM/file.jpg` 形式は維持。

期待する効果:

- 写真URLやバックアップパスを細工して、想定外のローカルファイルへ触る攻撃を防ぐ。

### 3. Dropbox/Gmail OAuth callback の state 検証を追加

対象:

- `apps/api/src/lib/oauth-state.ts`
- `apps/api/src/routes/backup/oauth.ts`
- `apps/api/src/routes/gmail/oauth.ts`
- `apps/api/src/lib/__tests__/oauth-state.test.ts`
- `apps/api/src/routes/__tests__/backup.integration.test.ts`

内容:

- OAuth authorize 時に署名付き `state` を発行。
- callback 時に `state` の署名、provider、発行時刻を検証。
- `state` がない、壊れている、期限切れの場合は token exchange 前に拒否。
- 有効期限は10分。

期待する効果:

- 攻撃者が任意の `code` を callback に投げる CSRF 型のOAuth混入を防ぐ。

運用影響:

- 実機反映後、反映前に発行済みの古いOAuth認可URLは使えない。必要なら管理画面からOAuth認証を最初からやり直す。

## 実装済み（第3段階: system系API公開範囲の縮小）

対象ブランチ:

- `security-system-api-hardening-20260701`

対象:

- `GET /api/system/health`
- `GET /api/system/health/detail`
- `GET /api/system/metrics`
- `GET /api/system/system-info`
- `GET /api/system/network-mode`
- `GET /api/system/deploy-status`
- `infrastructure/docker/Caddyfile.local`
- `infrastructure/docker/Caddyfile.local.template`
- `infrastructure/docker/Dockerfile.web`
- `infrastructure/docker/docker-compose.server.yml`

内容:

- 公開 `health` は `status` と `timestamp` のみ返す薄いレスポンスへ変更。
- 詳細な `checks`、`memory`、`eventLoop`、`uptime` は新設 `GET /api/system/health/detail` に移し、ADMIN/MANAGER JWT必須にした。
- `metrics`、`system-info`、`network-mode` を ADMIN/MANAGER JWT必須にした。
- `deploy-status` は有効な `x-client-key` 必須にした。キーなしは `CLIENT_KEY_REQUIRED`、不正キーは `INVALID_CLIENT_KEY`。
- `AdminLayout` は未ログイン時に `NetworkModeBadge` を表示しないようにし、`/preview/import` 等で不要な401を発生させない。
- Pi5実機が使う `Caddyfile.local` とテンプレートに、production/dev と同じ `/admin*` CIDR制限を追加した。

期待する効果:

- 外部から内部状態、業務件数、DB接続数、CPU/Node.js/サイネージworker状態を読まれにくくする。
- 管理画面SPAへの到達をCaddyでもCIDR制限し、Tailscale/管理LAN以外からの足がかりを減らす。
- `deploy-status` のキーなし公開口を閉じる。

運用影響:

- Docker healthcheck、Ansible health-check、Phase12検証は公開 `health` の `status` を引き続き使える。
- Prometheus等の無人 `/api/system/metrics` scrape は現仕様では使えない。必要時は専用トークンまたは内部限定経路を別途設計する。
- 正常なキオスクWebは `x-client-key` を自動付与するため、`deploy-status` は従来どおり利用できる見込み。
- MFA/2段階認証、30日記憶仕様、Microsoft Authenticator関連は変更していない。

反映状態:

- 実装 commit: `fb522e10` (`fix(api): harden system diagnostics endpoints`)
- Caddy local template hotfix commit: `54657ba7` (`fix(web): render local Caddy admin CIDRs correctly`)
- Pi5最終反映済み。Pi5 HEAD: `54657ba7`

## 検証履歴

### 第3段階 DBなしテスト

```bash
pnpm --filter @raspi-system/api test -- \
  src/routes/__tests__/health.test.ts \
  src/routes/__tests__/network-mode.test.ts
```

結果:

- 2ファイル成功。
- 9テスト成功。
- 公開 `health` が薄いレスポンスであること、詳細 `health/detail` が ADMIN/MANAGER 必須であること、`network-mode` が ADMIN/MANAGER 必須であることを確認。

### 第3段階 一時Postgres migration + 関連テスト

方針:

- 既存DB/既存コンテナは変更しない。
- 一時Postgresコンテナを作成し、検証後に削除。
- image: `pgvector/pgvector:pg15`
- コンテナ名: `rps-system-api-hardening-pg-20260701`
- 公開: `127.0.0.1:55434`
- DB: `borrow_return`
- 名前付きvolume/networkは作成していない。

実行内容:

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55434/borrow_return' \
  pnpm --filter @raspi-system/api prisma:deploy

DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55434/borrow_return' \
  pnpm --filter @raspi-system/api test -- \
    src/routes/system/__tests__/diagnostics-auth.test.ts \
    src/routes/system/__tests__/deploy-status.test.ts \
    src/routes/__tests__/performance.test.ts
```

結果:

- migration 122件適用成功。
- 関連テスト 3ファイル成功。
- 19テスト成功。
- `deploy-status` のキーなし `401`、不正キー `401`、正規キー `200` を確認。
- `metrics` / `system-info` の未認証 `401`、VIEWER `403`、ADMIN/MANAGER `200` を確認。
- performance test の `/api/system/metrics` はADMIN JWT付きで成功。
- 一時コンテナ `rps-system-api-hardening-pg-20260701` は削除済み。
- 今回作成した名前付きvolume/networkはなし。

### 第3段階 EXPLAIN

一時Postgresで確認:

```sql
EXPLAIN SELECT "id", "statusClientId" FROM "ClientDevice" WHERE "apiKey" = 'dummy-key' LIMIT 1;
EXPLAIN SELECT count(*) FROM "Loan" WHERE "returnedAt" IS NULL;
EXPLAIN SELECT count(*) FROM "Employee" WHERE "status" = 'ACTIVE';
EXPLAIN SELECT count(*) FROM "Item" WHERE "status" IN ('AVAILABLE', 'IN_USE');
EXPLAIN SELECT count(*) as count FROM pg_stat_activity WHERE datname = 'borrow_return';
```

結果:

- `ClientDevice.apiKey` は unique index `ClientDevice_apiKey_key` を使用。
- `Loan.returnedAt IS NULL` は `Loan_returnedAt_idx` の Index Only Scan を使用。
- `Employee.status` / `Item.status` の件数は既存どおり Seq Scan。今回新規のDB構造変更は入れていない。metrics集計は既存TTLキャッシュ対象。
- `pg_stat_activity` 件数はPostgreSQL内部ビューの参照。

### 第3段階 build / Caddy / 監視スクリプト

```bash
pnpm --filter @raspi-system/api build
pnpm --filter @raspi-system/web build
bash scripts/test/monitor.test.sh
```

結果:

- API build 成功。
- Web build 成功。
- `scripts/test/monitor.test.sh` 成功。API未起動のためhealth/metrics疎通はスキップ、関数テストとAnsibleテンプレート由来の監視ロジックは成功。
- `Caddyfile.local` と `Caddyfile.local.template` は、ダミー自己署名証明書を一時作成して `caddy:2 caddy validate` 成功。
- 最初の `caddy validate` は証明書ファイル未配置により失敗したが、Caddyfile構文変換自体は通っていた。ダミー証明書付きの再実行で `Valid configuration` を確認。

### 第3段階 CI / Pi5反映 / 実機検証

CI:

- CI run `28481684146`: 初回は `security-docker` が GitHub Actions cache export の `error writing layer blob: not_found` で失敗。Docker build本体は完了しており、失敗ジョブのみ再実行後に全ジョブ成功。
- Caddy hotfix後のCI run `28484641504`: 全ジョブ成功。

Pi5反映:

- 初回 deploy run `20260701-083429-24005`: API/Web image rebuild と Prisma migrate は完了したが、Web/Caddyが起動失敗。原因は `Caddyfile.local.template` が `envsubst` 対象なのに Caddy の `{$ADMIN_ALLOW_NETS:...}` 記法を使っていたため、render後に `{"192.168...` 形式となり `remote_ip` のCIDR parseに失敗したこと。
- 暫定復旧: 再起動中の `docker-web-1` を一度停止し、コンテナ内 `Caddyfile.local.template` のadmin CIDR行を固定CIDRへ差し替えて起動。`https://127.0.0.1/api/system/health` は HTTP `200` に復旧。
- 恒久修正: `Caddyfile.local.template` は `envsubst` 用の `${ADMIN_ALLOW_NETS}` に変更。`Dockerfile.web` でデフォルトCIDRをexportし、`docker-compose.server.yml` の `ADMIN_ALLOW_NETS` は引用符が値に混ざらない形へ修正。
- 最終 deploy run `20260701-093510-6042`: `failed=0`, remote status `success`, Pi5 HEAD `54657ba7`。

実機検証:

- `./scripts/deploy/verify-phase12-real.sh`: `PASS 45 / WARN 0 / FAIL 0`
- 個別system API確認:
  - `GET /api/system/health`: HTTP `200`, 返却keyは `status,timestamp` のみ。
  - `GET /api/system/health/detail`: 未認証 HTTP `401`。
  - `GET /api/system/metrics`: 未認証 HTTP `401`。
  - `GET /api/system/system-info`: 未認証 HTTP `401`。
  - `GET /api/system/network-mode`: 未認証 HTTP `401`。
  - `GET /api/system/deploy-status`: キーなし HTTP `401`。
  - `GET /api/system/deploy-status`: 不正 `x-client-key` HTTP `401`。
  - `GET /api/system/deploy-status`: 正規 `x-client-key` HTTP `200`, `isMaintenance=false`。
  - `GET /api/tools/loans/active`: 正規 `x-client-key` HTTP `200`。
  - `GET /admin`: Tailscale許可経路から HTTP `200`。
- Docker compose: api/db/web 起動中。api/db は healthy。
- Caddy render後の `/admin*` matcher は `192.168.10.0/24 192.168.128.0/24 100.64.0.0/10 127.0.0.1/32`。
- Webログ: 最終反映後に `loading initial config` / `unexpected character` はなし。
- APIログ: 個別検証で意図的に発生させた `AUTH_TOKEN_REQUIRED` / `CLIENT_KEY_REQUIRED` / `INVALID_CLIENT_KEY` の401を確認。新しいlevel 50例外はなし。

### ビルド

```bash
pnpm --filter @raspi-system/api build
```

結果:

- 成功。

### DBなしテスト

```bash
pnpm --filter @raspi-system/api test -- \
  src/lib/__tests__/oauth-state.test.ts \
  src/lib/__tests__/photo-storage.test.ts \
  src/services/backup/__tests__/backup.service.test.ts
```

結果:

- 3ファイル成功。
- 11テスト成功。

### 一時Postgresでの migration + 統合テスト

方針:

- 既存DB/既存コンテナは変更しない。
- 一時Postgresコンテナを作成し、検証後に削除。
- image: `pgvector/pgvector:pg15`
- 公開: `127.0.0.1:55432`
- DB: `borrow_return`

実行内容:

```bash
pnpm --filter @raspi-system/api prisma:deploy
pnpm --filter @raspi-system/api test -- \
  src/routes/__tests__/loans.integration.test.ts \
  src/routes/__tests__/photo-borrow.integration.test.ts \
  src/routes/__tests__/backup.integration.test.ts
```

結果:

- migration 122件適用成功。
- 統合テスト 3ファイル成功。
- 35テスト成功、1テストskip。
- 一時コンテナ `raspi-sec-test-postgres-*` は削除済み。
- 検証前の `docker ps` は空で、既存コンテナ変更なし。

## 実機反映履歴

### Pi5反映（2026-06-30 21:03-21:10 JST）

対象:

- host: `raspberrypi5`
- remote: `denkon5sd02@100.106.158.2`
- branch: `security-hardening-20260630-pi5`
- deployed commit: `4e058cb2` (`fix(api): harden loan and oauth security`)
- detach run ID: `20260630-210326-19753`
- remote log: `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-20260630-210326-19753.log`
- summary: `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-20260630-210326-19753.summary.json`

実行:

```bash
RASPI_SERVER_HOST='denkon5sd02@100.106.158.2' \
  ./scripts/update-all-clients.sh security-hardening-20260630-pi5 \
  infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

結果:

- wrapper exit code: `0`
- PLAY RECAP: `raspberrypi5 ok=134 changed=4 unreachable=0 failed=0 skipped=43 rescued=0 ignored=0`
- Pi4/Pi3 play: `no hosts matched` でスキップ。
- Docker restart summary: `ok`
- Prisma migrate deploy/status: 成功。`Database schema is up to date!`
- API health wait: 成功。
- remote HEAD: `4e058cb2`

反映後確認:

- `GET /api/system/health`: HTTP `200`
- `GET /api/tools/loans/active` 未認証: HTTP `401`
- `POST /api/tools/loans/borrow` 未認証・形式正しいダミーJSON: HTTP `401`
- `POST /api/tools/loans/photo-borrow` 未認証・形式正しいダミーJSON: HTTP `401`
- `POST /api/tools/loans/return` 未認証・ダミーUUID: HTTP `401`
- `POST /api/tools/loans/cancel` 未認証・ダミーUUID: HTTP `401`
- `DELETE /api/tools/loans/{dummyUuid}` 未認証: HTTP `401`
- `GET /api/tools/loans/active` 正規 `x-client-key`: HTTP `200`
- `docker compose ps`: api/db/web 起動中。api/db は healthy。

補足:

- 実機の Dropbox OAuth callback は実機設定に Dropbox App Key/Secret が無いため、state検証の実機到達前に設定不足で `400` になる。state検証自体はローカル統合テストで確認済み。
- 未認証拒否確認のため、APIログに意図した `AUTH_OR_CLIENT_KEY_REQUIRED` が記録されている。
- 最初のcurl確認でJSON形式ミスを2件発生させたが、これは検証コマンド側のミスによる `400` で、DB変更はない。

## 追加調査: system系API公開範囲（2026-06-30 21:28 JST）

詳細: [system-api-exposure-review-20260630.md](./system-api-exposure-review-20260630.md)

以下は2026-06-30時点の反映前調査記録。この時点では実装変更は行っておらず、Pi5へ読み取り確認のみ実施した。2026-07-01 第3段階で実装し、Pi5へ反映済み。

確認結果:

- `/api/system/health`, `/api/system/metrics`, `/api/system/system-info`, `/api/system/network-mode`, `/api/system/deploy-status` は未認証でHTTP `200`。
- `/api/system/debug/*`, `/api/system/local-llm/*`, `/api/system/dgx-resource/*` は未認証でHTTP `401`。
- `/api/system/metrics` は業務件数とNode.js/サイネージ状態を返すため、次段階の優先度が高い。
- Pi5は `USE_LOCAL_CERTS=true` のため `Caddyfile.local` を使用しており、`Caddyfile.production` にある `/admin*` CIDR制限ブロックが無い。

推奨:

- 第3段階で、`metrics` / `system-info` / `network-mode` は ADMIN/MANAGER 必須へ変更済み、Pi5反映済み。
- 第3段階で、`health` は公開薄型 + 詳細認証へ分割済み、Pi5反映済み。
- 第3段階で、`deploy-status` は有効な `x-client-key` 必須へ変更済み、Pi5反映済み。

## Pi5反映翌朝確認（2026-07-01 07:33 JST）

目的:

- 2026-06-30 21:10 JST 頃のPi5反映後、一晩の安定性を確認する。
- 現場端末での貸出/返却は利用者確認で正常。
- こちらではAPI health、認証拒否ログ、Docker/APIログ、コンテナ状態を読み取り確認。

結果:

- `GET /api/system/health`: HTTP `200`, `status=ok`
- health checks: `database=ok`, `memory=ok`, `eventLoop=ok`, `playwright=ok`
- api/db/web: 起動中。api/db は healthy。
- api/web/db restart count: `0`
- api/web/db OOMKilled: `false`
- `AUTH_OR_CLIENT_KEY_REQUIRED`: 2026-06-30 21:10 JST 以降 `0` 件
- `CLIENT_KEY_CLIENT_MISMATCH`: 2026-06-30 21:10 JST 以降 `0` 件
- `INVALID_CLIENT_KEY` / `CLIENT_KEY_INVALID`: 2026-06-30 21:10 JST 以降 `0` 件

補足:

- API health の `memory` には `Allocated heap usage warning` が付いていたが、heap上限に対する使用率は低く、既知の運用上の警告表示。
- 2026-07-01 02:02 JST 頃に Dropbox の古いバックアップ掃除で `429 too_many_requests` が発生。対象はバックアップ後のcleanupであり、今回の貸出API強化とは別系統。
- 2026-07-01 03:02 JST 頃に Caddy reverse proxy の一時 `502` が2件発生。対象は `/api/kiosk/pallet-visualization/board` と `/api/clients/status`。apiコンテナ停止・restart・OOMは無く、現在のhealthは正常。
- 2026-07-01 06:00 JST 以降、level 50 のAPIエラーは確認されず、残るwarningは既存のCSV日付形式、サイネージschedule fallback、rigging gear不一致のskip。

## 運用上の注意

- 正常なキオスク端末は、有効な `x-client-key` を持っていれば従来どおり利用可能。
- 不正/古い `x-client-key`、またはキーと違う `clientId` を送る呼び出しは拒否される。
- OAuth設定作業中に古い認可URLを開いていた場合は、管理画面から認可URLを発行し直す。

## 保留した項目

- MFA/2段階認証: iPhone/旧スマホ確認完了まで保留。
- system系APIの無人metrics scrape: 現時点では専用トークン未設計。必要になった場合に内部限定経路または専用トークンを設計する。
- Ansible vault 暗号化/秘密情報ローテーション: 実機運用と復旧手順に影響するため未変更。
- APIコンテナのSSH鍵/Ansibleマウント縮小: デプロイ経路に影響するため未変更。
- Tailscale ACLの実設定レビュー: repo外のtailnet設定確認が必要。
- `x-client-key` のローテーション/強化: キオスク端末全台の同期が必要。
