# コントロール再評価メモ（OWASP/IPA/CIS/NIST）

最終更新: 2026-01-28

## 目的

既存評価（2026-01-18）を基に、現在のコード・設定・運用ドキュメントに紐づく証跡を整理する。
再評価の差分確認ポイントを明示し、最終報告書作成時の根拠とする。

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

