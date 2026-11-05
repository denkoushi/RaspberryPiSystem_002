# KB-437: 2026-11 security audit — rate-limit bypass, kiosk key leaks, backup Ansible injection

- Status: active; small fixes merged via the audit PR, larger items open
- Scope: `apps/api` (rate limit, request logging, kiosk power/order, loans, backup client targets, backup config health)
- Date: 2026-11-04

## Context

コード全体をサブエージェントで分野別（認証・権限、SQL/コマンド/パス、秘密情報、依存、API公開範囲など12分野）に点検した。
各候補は別エージェント2体が「再現」と「既存の防御で止まらないか」の観点で反証を試み、両方が反証できず、かつ再現できたものだけを確定とした（31件 → 重複除去27件 → 確定17件、意見が割れた8件、反証2件）。

## Symptoms Or Trigger

- `POST /api/auth/login` などのルート別レート制限が、`/api/auth/logi%6E` のようなパーセントエンコード表記で無制限に回避できた（実装した Fastify + `@fastify/rate-limit` で再現）。
- キオスク端末の認証キー（`ClientDevice.apiKey`）が、手動順番更新のログ、電源操作キューのファイル名、`?key=` / `?clientKey=` 付き URL の Fastify 標準リクエストログに平文で残っていた。
- バックアップの `client-file` / `client-directory` の `source` が `ansible-playbook -e key=value` にそのまま渡り、Jinja 式で API コンテナ上のコマンド実行、空白で別変数の注入ができた。同じ理由で `ansible_ssh_common_args` が空白で分割され、known_hosts 固定などの SSH 設定が ssh に届いていなかった（ansible-core で確認）。
- 端末キーだけで `DELETE /api/tools/loans/:id`（貸出記録の物理削除）ができた。
- キオスクの返却で本文の `performedByUserId` が実施者として記録できた。
- `/api/backup/config/health/internal` が `172.*` を内部扱いしており、Caddy 経由（Docker bridge）で認証なしに読めた。

## Root Cause

- レート制限キーが生の `request.url` で、ルータは復号後に照合するため表記ごとに別カウンタになった。
- ログ出力箇所で端末キーを識別子として扱っていた。Fastify 既定の `req` シリアライザはクエリ込みの URL を出す。
- Ansible の CLI extra vars は key=value を空白で分割し、値を Jinja として評価する。
- 貸出 delete が「有効な端末キーがあれば許可」の共通ヘルパーを使っていた。
- 内部用エンドポイントの送信元判定が Docker bridge 全体を信頼していた。

## Fix

- `plugins/rate-limit.ts`: キーとスキップ判定のパスを1回復号して正規化（`normalizeRateLimitPath`）。
- `lib/log-url.ts`: 認証系クエリ（`key`, `clientKey`, `token`, `code` など）の値を `[REDACTED]` にする `redactUrlForLog` と、Fastify 既定と同じ項目の `serializeRequestForLog` を追加し、`app.ts` の logger と `error-handler.ts` で使用。
- `routes/kiosk/production-schedule/order.ts`: ログを `actorClientDeviceId` に変更。
- `routes/kiosk/power.ts`: キューファイル名を `<時刻>-<端末ID>-<requestId>.json` に変更（本文の `clientKey` は `power-control.yml` が使うため維持）。
- `services/backup/backup-ssh-policy.ts`: `parseClientBackupSource` でホスト `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`、パス `^/[A-Za-z0-9._/@+-]*$` に限定し、extra vars と `ansible_ssh_common_args` を JSON 1引数で渡す。
- `routes/tools/loans/delete.ts`: `authorizeRoles('ADMIN', 'MANAGER')` を必須化。
- `services/tools/loan.service.ts`: 返却の実施者は認証済みユーザーからのみ決める（本文の値は互換のため受理するが使わない）。
- `routes/backup/config-read.ts`: 内部ヘルスを `isLoopbackAddress` に限定。

## Operational Notes

- バックアップの SSH 設定（`StrictHostKeyChecking=yes`、専用 `known_hosts`）が実際に効くようになる。専用 known_hosts に載っていない端末のクライアントバックアップは失敗するので、反映後の初回バックアップ結果を確認する。
- 既存の `backup.json` に許可文字外（空白、日本語、`:` を含むパスなど）の `client-*` source があると、そのターゲットは 400 で失敗する。
- 内部ヘルスは Pi5 上の `curl -sk https://localhost/api/backup/config/health/internal`（Caddy 経由）では 403 になる。API コンテナ内から `docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api node -e "fetch('http://127.0.0.1:8080/api/backup/config/health/internal').then(r=>r.text()).then(console.log)"` で確認するか、管理画面の認証付き `/api/backup/config/health` を使う。
- 既に Pi5 の `power-actions/processed|failed` やログ名に残っている端末キー入りのファイル名、過去のAPIログは今回の変更では消えない。必要なら運用判断で整理・キー更新する。

## Prevention

- 回帰テスト: `plugins/__tests__/rate-limit-path-normalization.test.ts`、`lib/__tests__/log-url.test.ts`、`services/backup/__tests__/backup-ssh-policy.test.ts`、`routes/backup/__tests__/config-read.internal.test.ts`、`routes/tools/loans/__tests__/device-auth.test.ts`（delete）、`services/tools/__tests__/loan.service.test.ts`（performedByUserId）。

## Validation

- `cd apps/api && npx vitest run src/plugins src/lib src/routes/kiosk src/routes/tools src/routes/backup src/services/backup src/services/tools` → 854 passed、DB 接続が必要な `csv-backup.target.test.ts` の2件のみ失敗（ローカルに Postgres なし、変更と無関係）。
- ansible-core（scratch venv）で JSON extra vars が分割されず `ansible_ssh_common_args` 全体が渡ること、旧形式では `-o` だけになることを確認。

## Open Items

対応済み（PR 作成済み、マージとデプロイは別途）:

- `apps/api/src/app.ts` に `trustProxy` が無い件: Caddy の1段だけを信頼し、API 宛ての全 Caddy で X-Forwarded-For を上書き（PR #2543）。
- `GET /backup/config` が秘密値を平文で返す件: 伏字で返し、PUT では伏字・未指定の値を既存値で補う。省略された設定欄は前の設定をまるごと残し、`${VAR}` 参照は保存時に保つ（`fix/backup-config-redact` の PR）。

判断待ち（業務への影響をユーザーに確認中）:

| 場所 | 影響 | 直し方の案 |
| --- | --- | --- |
| `routes/clients/core.ts` heartbeat の `location` | 端末が自分の location（スコープキー）を変更でき、他端末やサイトの割当範囲を乗っ取れる | heartbeat から location を外す（初回のみ受理）か、管理者 PUT でのみ変更可能にする |
| `routes/clients/core.ts` status の `clientId` | 任意端末が他端末の `statusClientId` を名乗り、状態・最終確認時刻を上書きできる | 初回バインド後は不一致を 409、`statusClientId` に一意制約（既存重複の確認と再バインド手段が必要） |
| `routes/kiosk/production-schedule/due-management-global-rank.ts` | 代理権限のない端末でも任意の `targetLocation` の全体ランクを読み書きできる | 他ルートと同じく `canProxyTargetLocation` でない場合は actorLocation 以外を 403（意図確認が必要） |
| `routes/assembly/procedure-documents.ts` ほか | 手順書の割当解除・下書き削除・改名などがキオスク端末キーだけで実行でき、PIN は UI でのみ確認 | どの操作を PIN 必須にするか決め、サーバー側で `requireAccessPassword` か短期トークンを要求 |
| 監査メタデータの `actorClientKey`（global rank、order split、学習イベント） | 端末キーが DB の監査 JSON に平文で残る | 今後は端末IDかハッシュを保存。既存行の整理は移行が必要 |
| `power-control.yml` の `clientKey` 照合 | キュー本文に端末キーが残る | playbook を `clientDeviceId` で対象解決するよう変更後、本文から削除 |

検証で意見が割れたもの（参考、未修正）: MFA バックアップコードの非原子的消費（`services/auth/auth.service.ts`）、`/kiosk/support` の本文 `clientId` 信頼、WebRTC の `?clientKey=` が Caddy アクセスログに残る件、nfc/barcode agent の CORS `*` と Origin 未検査、`ADMIN_ALLOW_NETS` が `/admin*` の直接読込しか止めない件、署名配信の SSH host key 検証無効、DGX embedding イメージの Pillow 12.3.0。

## References

- Audit PR: `claude/wizardly-sagan-e8q3qw`
