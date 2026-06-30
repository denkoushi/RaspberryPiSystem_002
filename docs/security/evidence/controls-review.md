# コントロール再評価メモ（OWASP/IPA/CIS/NIST）

最終更新: 2026-07-01

## 目的

既存評価（2026-01-18）を基に、現在のコード・設定・運用ドキュメントに紐づく証跡を整理する。
再評価の差分確認ポイントを明示し、最終報告書作成時の根拠とする。

## 2026-06-30 強化差分

詳細履歴: [../security-hardening-history-20260630.md](../security-hardening-history-20260630.md)

今回の差分は Pi5 へ反映済み。Pi4/Pi3、MFA/2段階認証、既存DBデータ、鍵ローテーションは変更していない。

| 項目 | 差分 | 状態 |
|------|------|------|
| A01 Access Control | `/api/tools/loans/*` の未認証操作を遮断。`x-client-key` と `clientId` の不一致を拒否。 | Pi5反映済み・統合テスト済み |
| CSRF / OAuth | Dropbox/Gmail OAuth callback に署名付き `state` 検証を追加。 | Pi5反映済み・統合テスト済み |
| パストラバーサル | 写真/ローカルバックアップ保存で保存ディレクトリ外パスを拒否。 | Pi5反映済み・単体テスト済み |
| 運用監視API | `/api/system/metrics`, `/api/system/system-info`, `/api/system/network-mode` を ADMIN/MANAGER 必須化。`/api/system/health` は公開薄型 + 詳細認証へ分割。`/api/system/deploy-status` は `x-client-key` 必須化。 | ローカル実装済み・実機未反映 |
| Security Misconfig | Pi5実機が使う `Caddyfile.local` / template に `/admin*` CIDR制限を追加。 | ローカル実装済み・実機未反映 |

検証:

- `pnpm --filter @raspi-system/api build` 成功。
- DBなしテスト 11件成功。
- 一時Postgresで migration 122件適用成功。
- 貸出/写真貸出/バックアップOAuth関連の統合テスト 35件成功、1件skip。
- 一時Postgresコンテナは削除済み。
- Pi5反映 run `20260630-210326-19753` 成功。PLAY RECAP `failed=0`。
- Pi5反映後、API health `200`、貸出系未認証拒否 `401`、正規 `x-client-key` 付き `/api/tools/loans/active` `200` を確認。
- system系API公開範囲レビュー: [../system-api-exposure-review-20260630.md](../system-api-exposure-review-20260630.md)
- 2026-07-01 第3段階のローカル検証結果は [../security-hardening-history-20260630.md](../security-hardening-history-20260630.md) へ追記済み。

## OWASP Top 10 2021（再評価の基準）

| 項目 | 現状評価 | 主な証跡 | 差分確認ポイント |
|------|----------|----------|------------------|
| A01 Access Control | 実施済み | `apps/api/src/lib/auth.ts`, `docs/security/evaluation-report.md` | 新規エンドポイントの認可漏れ |
| A02 Cryptographic Failures | 実施済み | `docs/security/evaluation-report.md` | 鍵管理方式の変更有無 |
| A03 Injection | 実施済み | `docs/security/validation-review.md` | 生SQLの追加有無 |
| A04 Insecure Design | 部分実施 | `docs/security/evaluation-report.md` | 新機能の設計レビュー有無 |
| A05 Security Misconfig | 実施済み | `docs/security/port-security-audit.md` | Docker設定の変更有無 |
| A06 Vulnerable Components | 実施済み | `.github/workflows/ci.yml` | 依存更新の差分 |
| A07 Auth Failures | 実施済み | `docs/security/phase9-10-specifications.md` | MFA設定変更の有無 |
| A08 Integrity Failures | 部分実施 | `docs/security/evaluation-report.md` | 署名検証/SRIの実装有無 |
| A09 Logging/Monitoring | 実施済み | `docs/security/implementation-assessment.md` | ログ秘匿の変更有無 |
| A10 SSRF | 実施済み | `docs/security/evaluation-report.md` | 外部URL操作の追加有無 |

## IPA「安全なウェブサイトの作り方」

| 項目 | 現状評価 | 主な証跡 | 差分確認ポイント |
|------|----------|----------|------------------|
| SQLi | 実施済み | `docs/security/validation-review.md` | 生SQL追加の有無 |
| XSS | 実施済み | `docs/security/validation-review.md` | `dangerouslySetInnerHTML`の導入有無 |
| CSRF | 部分実施 | `docs/security/evaluation-report.md` | SameSite/CSRFトークン追加の有無 |
| セッション管理 | 実施済み | `docs/api/auth.md` | トークン有効期限変更 |
| アクセス制御 | 実施済み | `apps/api/src/lib/auth.ts` | 新規ルートの認可 |
| パストラバーサル | 実施済み | `docs/security/validation-review.md` | ファイル操作の追加 |
| ヘッダ対策 | 実施済み | `apps/api/src/plugins/security-headers.ts` | CSP変更 |

## CIS Docker / PostgreSQL

| 項目 | 現状評価 | 主な証跡 | 差分確認ポイント |
|------|----------|----------|------------------|
| Docker runtime hardening | 部分実施 | `infrastructure/docker/docker-compose.server.yml` | readOnlyRootFilesystem等の追加有無 |
| Docker logging | 部分実施 | `docs/security/evaluation-report.md` | ログドライバ設定 |
| PostgreSQL TLS | 未実施 | `docs/security/evaluation-report.md` | TLS強制の有無 |
| PostgreSQL監査ログ | 未実施 | `docs/security/evaluation-report.md` | 監査ログ設定 |

## NIST CSF 2.0

| 項目 | 現状評価 | 主な証跡 | 差分確認ポイント |
|------|----------|----------|------------------|
| Identify | 実施済み | `docs/security/requirements.md` | 資産一覧の更新 |
| Protect | 実施済み | `docs/security/implementation-assessment.md` | 防御機能の追加/削除 |
| Detect | 実施済み | `docs/security/implementation-assessment.md` | 監視対象/頻度の変更 |
| Respond | 部分実施 | `docs/security/incident-response.md` | 演習の実施有無 |
| Recover | 部分実施 | `docs/guides/backup-and-restore.md` | USBオフライン検証の実施 |
