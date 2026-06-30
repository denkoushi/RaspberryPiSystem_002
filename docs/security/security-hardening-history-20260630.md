# セキュリティ強化履歴（2026-06-30 第1-2段階 + Pi5反映）

最終更新: 2026-06-30 21:14 JST

## 前提

- 対象はローカルリポジトリ `/Users/tsudatakashi/RaspberryPiSystem_002`。
- Pi5実機へ反映済み。Pi4/Pi3は今回の反映対象外。
- 既存DBデータの変更を目的とする操作は行っていない。DB migration追加もなし。
- 一時Postgresコンテナはローカル検証後に削除済み。
- 2段階認証/MFAは、iPhone/旧スマホの確認が終わるまで保留。今回も未変更。
- Ansible vault の中身確認、鍵ローテーション、実機SSH設定変更は未実施。

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

## 検証履歴

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

## 運用上の注意

- 正常なキオスク端末は、有効な `x-client-key` を持っていれば従来どおり利用可能。
- 不正/古い `x-client-key`、またはキーと違う `clientId` を送る呼び出しは拒否される。
- OAuth設定作業中に古い認可URLを開いていた場合は、管理画面から認可URLを発行し直す。

## 保留した項目

- MFA/2段階認証: iPhone/旧スマホ確認完了まで保留。
- system系APIの公開範囲整理: `/api/system/health` と `/api/system/metrics` は監視・手順依存が大きいため未変更。`system-info`/`network-mode` も preview画面への波及確認後に別段階で扱う。
- Ansible vault 暗号化/秘密情報ローテーション: 実機運用と復旧手順に影響するため未変更。
- APIコンテナのSSH鍵/Ansibleマウント縮小: デプロイ経路に影響するため未変更。
- Tailscale ACLの実設定レビュー: repo外のtailnet設定確認が必要。
- `x-client-key` のローテーション/強化: キオスク端末全台の同期が必要。
