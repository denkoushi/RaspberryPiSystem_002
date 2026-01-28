# セキュリティ評価計画書

最終更新: 2026-01-18

## 概要

本ドキュメントは、Raspberry Pi NFC持出返却システム（RaspberryPiSystem_002）の安全性・セキュリティ強度を、OWASP Top 10、IPA「安全なウェブサイトの作り方」、CISベンチマーク、NIST Cybersecurity Framework等の標準的なセキュリティ評価指標に基づいて評価するための実施計画を定義します。

## 評価目的

1. **現状強度の可視化**: 主要フレームワーク（OWASP Top 10 / IPA / CIS / NIST CSF）に対する「達成状況」と「ギャップ」を1枚で説明できる状態を実現する
2. **リスクの優先順位付け**: 影響度×起こりやすさ×検知/復旧性で、上位10件程度の改善候補を抽出する
3. **運用可能性の担保**: Raspberry Pi（Pi5/Pi4/Pi3）の制約を踏まえ、現実的な運用・監視・復旧の実施手順に落とす

## 評価対象と範囲

### 評価対象デバイス

- **Raspberry Pi 5（サーバー）**: 主要な評価対象
  - アプリケーション（API、Web UI）
  - データベース（PostgreSQL）
  - インフラ（Docker、ネットワーク、OS）
  - 監視・アラート機能
- **Raspberry Pi 4（キオスク）**: 限定的評価
  - 軽量マルウェア対策（ClamAV/rkhunter）
  - クライアント認証（`x-client-key`）
- **Raspberry Pi 3（サイネージ）**: 評価対象外
  - リソース制約によりセキュリティソフト導入見送り
  - Pi5での対策徹底により代替

### 評価環境

- **通常運用**: ローカルネットワーク中心（インターネット接続なし）
- **メンテナンス時**: インターネット接続が必要（Tailscale経由）

### 評価の境界

- **評価対象**: 
  - アプリケーション層（API、Web UI）
  - インフラ層（Docker、ネットワーク、OS）
  - データ保護（暗号化、バックアップ）
  - 監視・検知・対応（ログ、アラート、インシデント対応）
- **評価対象外**:
  - 物理セキュリティ（施設の入退室管理など）
  - ネットワークインフラ（ルーター、スイッチの設定）
  - 外部サービス（Dropbox、Gmail、Slack）のセキュリティ設定

## 評価フレームワーク

### 1. OWASP Top 10 2021

Webアプリケーションの最も重大なセキュリティリスクを評価します。

- A01: アクセス制御の不備（Broken Access Control）
- A02: 暗号化の失敗（Cryptographic Failures）
- A03: インジェクション（Injection）
- A04: 安全でない設計（Insecure Design）
- A05: セキュリティの設定ミス（Security Misconfiguration）
- A06: 脆弱で古くなったコンポーネント（Vulnerable and Outdated Components）
- A07: 識別と認証の失敗（Identification and Authentication Failures）
- A08: ソフトウェアとデータの整合性の失敗（Software and Data Integrity Failures）
- A09: セキュリティログとモニタリングの失敗（Security Logging and Monitoring Failures）
- A10: サーバーサイドリクエストフォージェリ（SSRF）

### 2. IPA「安全なウェブサイトの作り方」

日本語の実務チェック観点に基づいて評価します。

- SQLインジェクション対策
- XSS対策
- CSRF対策
- セッション管理
- アクセス制御
- パストラバーサル対策
- HTTPヘッダ・インジェクション対策

### 3. CIS Benchmarks

インフラ・コンテナ・データベースのハードニング観点を評価します。

- **CIS Docker Benchmark**: コンテナイメージ、実行時セキュリティ、ネットワークセキュリティ
- **CIS PostgreSQL Benchmark**: 認証と認可、ネットワークセキュリティ、ログと監視
- **CIS Debian Linux Benchmark**: OSレベルのセキュリティ設定（該当部分）

### 4. NIST Cybersecurity Framework 2.0相当

運用成熟度の観点から評価します。

- **Identify（識別）**: 資産管理、リスク評価、ガバナンス
- **Protect（保護）**: アクセス制御、データ保護、セキュリティ対策
- **Detect（検知）**: 異常検知、セキュリティ監視、検知プロセス
- **Respond（対応）**: インシデント対応、コミュニケーション、分析
- **Recover（復旧）**: 復旧計画、改善、コミュニケーション

## 評価アプローチ（3レイヤ）

### 1) 机上評価（ドキュメント/設定/設計）

**目的**: 現状対策を棚卸しし、評価観点ごとの「達成/未達/要再確認」を確定する

**主な入力**:
- セキュリティ要件と実装状況: [requirements.md](./requirements.md)
- 既存監査: [standard-security-checklist-audit.md](./standard-security-checklist-audit.md)
- Phase 9/10詳細仕様: [phase9-10-specifications.md](./phase9-10-specifications.md)
- ポートセキュリティ監査: [port-security-audit.md](./port-security-audit.md)
- ポートセキュリティ検証結果: [port-security-verification-results.md](./port-security-verification-results.md)
- 実装妥当性評価: [implementation-assessment.md](./implementation-assessment.md)

**評価方法**:
- 既存ドキュメントの横断レビュー
- 設定ファイルの確認（Docker Compose、Ansible、Caddy設定など）
- コードレビュー（認証・認可ロジック、入力バリデーションなど）

## 実施安全策（本番影響の最小化）

### 負荷・レート制御

- **検証環境で先行**: ZAP/ポートスキャン/負荷系は検証環境で実施し、再現できた手順のみ本番で縮小実施
- **レート制限順守**: 認証10 req/min、全体120 req/minを上限としてZAPのスレッド/頻度を抑制
- **対象の限定**: 非認証/認証済み/`x-client-key`系を分離し、必要最小限のURLだけを対象化

### 停止条件（即時中断）

- レート制限によるブロックが継続する
- API応答が継続的に5xxになる
- 監視アラートが急増する（`alerts/`の異常増加）
- 既存業務フローに影響が出たと判断できる

### 事前バックアップ

- 本番実機は**評価開始前に暗号化バックアップを取得**
- 手順: `scripts/server/backup-encrypted.sh`（詳細は [docs/guides/backup-and-restore.md](../guides/backup-and-restore.md)）

## 証跡の保存方針

- 保存先: `docs/security/evidence/`
- 命名規則: `YYYYMMDD-HHMM_<env>_<category>_<detail>.<ext>`
- 詳細ルール: [docs/security/evidence/README.md](./evidence/README.md)

### 2) 自動評価（脆弱性/設定）

**目的**: 「人間が見落としやすい」脆弱性・設定不備を網羅的に拾う

**実施ツールと実行条件**:

#### 2.1 依存関係/イメージ脆弱性スキャン（Trivy）

**実行条件**: CIと同等条件で再実行し、差分を確認する

**CI設定参照**: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

**実行コマンド**:
```bash
# ファイルシステムスキャン（CI同等条件）
trivy fs \
  --ignore-unfixed \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --scanners vuln \
  --skip-dirs "**/certs" \
  --skip-dirs "**/alerts" \
  /opt/RaspberryPiSystem_002

# Dockerイメージスキャン（api/web）
docker build -t raspisys-api:security-eval -f infrastructure/docker/Dockerfile.api .
docker build -t raspisys-web:security-eval -f infrastructure/docker/Dockerfile.web .

trivy image \
  --ignore-unfixed \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --scanners vuln \
  raspisys-api:security-eval

trivy image \
  --ignore-unfixed \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --scanners vuln \
  --trivyignores .trivyignore \
  raspisys-web:security-eval
```

**評価観点**:
- HIGH/CRITICAL脆弱性の有無
- 修正可能な脆弱性の数
- 修正不可能な脆弱性の影響範囲

#### 2.2 Webスキャン（OWASP ZAP - 限定）

**実行条件**: 管理画面IP制限や認証があるため、スコープを絞る

**実行方法**:
- 認証済みセッションでのスキャン（管理画面のみ）
- キオスクAPIのスキャン（`x-client-key`認証）
- 認証不要エンドポイントのスキャン（`/api/system/health`など）

**注意事項**:
- レート制限（認証10 req/min、グローバル120 req/min）に注意
- アカウントロックのリスクを避けるため、低頻度で実行

#### 2.3 Docker設定観点（CIS Docker Benchmark相当）

**確認項目**:
- コンテナの読み取り専用ルートファイルシステム（readOnlyRootFilesystem）
- セキュリティコンテキストの設定（securityContext）
- リソース制限（CPU/メモリ）
- ログドライバーの設定
- ヘルスチェックの実装

**確認方法**:
- `docker-compose.server.yml`の設定確認
- Dockerfileの設定確認
- 実行時設定の確認（`docker inspect`）

### 3) 実機/運用評価（露出面・検知・復旧）

**目的**: 実運用で効くか（露出が減っているか、検知できるか、復旧できるか）を確認する

**主要証跡の再確認**:
- ポート露出削減・不要サービス停止・監視ノイズ低減: [port-security-verification-results.md](./port-security-verification-results.md)
- ポートベースライン: [ports-baseline-20260118.md](../knowledge-base/infrastructure/ports-baseline-20260118.md)

**評価項目**:
- ポート公開状況（意図した露出のみか）
- 検知→通知→可視化の経路（fail2ban、マルウェアスキャン、ports監視）
- バックアップ・復元の実効性（暗号化、オフライン保管、USB運用）

## 評価項目（チェックリスト）

### アプリケーション（OWASP/IPA中心）

#### 認証/認可

**評価観点**:
- JWT認証の実装（アクセストークン/リフレッシュトークン）
- RBAC（ロールベースアクセス制御）の実装
- MFA（多要素認証）の実装
- レート制限の実装
- 認証ログの記録

**確認箇所**:
- [apps/api/src/routes/auth.ts](../../apps/api/src/routes/auth.ts)
- [apps/api/src/lib/auth.ts](../../apps/api/src/lib/auth.ts)
- [apps/api/src/plugins/authorization.ts](../../apps/api/src/plugins/authorization.ts)
- [apps/api/src/plugins/rate-limit.ts](../../apps/api/src/plugins/rate-limit.ts)
- [apps/api/src/lib/mfa.ts](../../apps/api/src/lib/mfa.ts)

**既存証跡**:
- [standard-security-checklist-audit.md](./standard-security-checklist-audit.md): A01（アクセス制御）、A07（識別と認証）実施済み
- [phase9-10-specifications.md](./phase9-10-specifications.md): MFA実装完了

#### 入力検証/インジェクション

**評価観点**:
- Zodによる入力バリデーションの適用範囲
- PrismaによるSQLインジェクション対策
- 危険な生SQLの使用有無
- パストラバーサル対策

**確認箇所**:
- [apps/api/src/routes/](../../apps/api/src/routes/) のすべてのルート
- [apps/api/src/services/](../../apps/api/src/services/) のすべてのサービス層
- [apps/api/src/services/backup/](../../apps/api/src/services/backup/) のバックアップサービス

**既存証跡**:
- [validation-review.md](./validation-review.md): 121箇所でzodが使用、PrismaによるSQLインジェクション対策実施済み
- [standard-security-checklist-audit.md](./standard-security-checklist-audit.md): A03（インジェクション）実施済み

#### CSRF/セッション

**評価観点**:
- Cookie運用の有無
- SameSite Cookie属性の設定
- CSRFトークンの実装
- セッション管理の実装

**確認箇所**:
- [infrastructure/docker/Caddyfile.production](../../infrastructure/docker/Caddyfile.production)
- [apps/api/src/routes/auth.ts](../../apps/api/src/routes/auth.ts)

**既存証跡**:
- [standard-security-checklist-audit.md](./standard-security-checklist-audit.md): CSRF対策未実施（中優先度）

#### XSS/ヘッダ

**評価観点**:
- Reactのデフォルトエスケープ機能の使用
- CSP（Content Security Policy）の設定
- セキュリティヘッダーの設定（Helmet）
- リバースプロキシ設定の整合

**確認箇所**:
- [apps/api/src/plugins/security-headers.ts](../../apps/api/src/plugins/security-headers.ts)
- [infrastructure/docker/Caddyfile.production](../../infrastructure/docker/Caddyfile.production)
- [apps/web/src/](../../apps/web/src/) のすべてのReactコンポーネント

**既存証跡**:
- [validation-review.md](./validation-review.md): Reactのデフォルトエスケープ機能使用、`dangerouslySetInnerHTML`未使用
- [standard-security-checklist-audit.md](./standard-security-checklist-audit.md): セキュリティヘッダー実装済み

#### 情報漏洩

**評価観点**:
- エラー応答に秘密情報が含まれないか
- ログに秘密情報が含まれないか（`x-client-key`、Webhook URLなど）
- 個人情報の最小化（キオスクAPIの列挙耐性）

**確認箇所**:
- [apps/api/src/lib/errors.ts](../../apps/api/src/lib/errors.ts)
- [apps/api/src/routes/](../../apps/api/src/routes/) のすべてのルート
- [apps/api/src/routes/kiosk/](../../apps/api/src/routes/kiosk/) のキオスクAPI

**既存証跡**:
- [requirements.md](./requirements.md): 2.6 キオスクAPIの個人情報最小化・列挙耐性（将来要件）

### インフラ/コンテナ（CIS中心）

#### 公開面（Attack Surface）

**評価観点**:
- ポート公開状況（80/443/22/5900等の意図した露出のみか）
- プロセスのバインドアドレス（外部露出か、ループバックのみか）
- 不要サービスの停止（rpcbind/avahi/exim4/cups）

**確認方法**:
```bash
# Pi5上で実行
sudo ss -H -tulpen
sudo ufw status verbose
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps
```

**既存証跡**:
- [port-security-verification-results.md](./port-security-verification-results.md): 期待ポート（22/80/443/5900）のみ外部露出、Docker内部ポート（5432/8080）は非公開
- [ports-baseline-20260118.md](../knowledge-base/infrastructure/ports-baseline-20260118.md): ポートベースライン証跡

#### Docker Compose設計

**評価観点**:
- DB/APIの非公開化（ポートマッピング削除）
- ネットワーク境界（Docker内部ネットワークの使用）
- 最小権限（非rootユーザーでの実行）
- リソース制限（メモリ/CPU）

**確認箇所**:
- [infrastructure/docker/docker-compose.server.yml](../../infrastructure/docker/docker-compose.server.yml)
- [infrastructure/docker/Dockerfile.api](../../infrastructure/docker/Dockerfile.api)
- [infrastructure/docker/Dockerfile.web](../../infrastructure/docker/Dockerfile.web)

**既存証跡**:
- [port-security-audit.md](./port-security-audit.md): PostgreSQL（5432）とAPI（8080）のポートマッピング削除済み
- [standard-security-checklist-audit.md](./standard-security-checklist-audit.md): CIS Dockerベンチマークの一部未実施項目あり

#### ホストOS

**評価観点**:
- 不要サービスのmask（rpcbind/avahi/exim4/cups）
- SSH到達制御（UFW、信頼ネットワークのみ）
- ログ収集/ローテーション（fail2ban、Caddy、アプリケーションログ）

**確認箇所**:
- [infrastructure/ansible/group_vars/all.yml](../../infrastructure/ansible/group_vars/all.yml)
- [infrastructure/ansible/roles/server/tasks/security.yml](../../infrastructure/ansible/roles/server/tasks/security.yml)

**既存証跡**:
- [port-security-verification-results.md](./port-security-verification-results.md): 不要サービス（rpcbind/avahi/exim4/cups）がmask/inactive状態

### データ保護/復旧（NIST Recover中心）

#### バックアップ

**評価観点**:
- 暗号化（GPG）
- 復元テスト（検証用DBで実施済み）
- オフライン保管（USB運用の未検証部分を評価に含める）

**確認箇所**:
- [scripts/server/backup.sh](../../scripts/server/backup.sh)
- [scripts/server/backup-encrypted.sh](../../scripts/server/backup-encrypted.sh)
- [docs/guides/backup-and-restore.md](../guides/backup-and-restore.md)

**既存証跡**:
- [implementation-assessment.md](./implementation-assessment.md): バックアップ暗号化・復元テスト実施済み、USBメディアテスト未実施

#### 秘密情報管理

**評価観点**:
- `.env`ファイルの保護（`.gitignore`、バックアップ）
- Ansible Vaultの使用（`host_vars/*/vault.yml`）
- 証明書ファイルの保護
- 環境変数の管理方法

**確認箇所**:
- [.gitignore](../../.gitignore)
- [infrastructure/ansible/host_vars/*/vault.yml](../../infrastructure/ansible/host_vars/)
- [infrastructure/docker/docker-compose.server.yml](../../infrastructure/docker/docker-compose.server.yml)

**既存証跡**:
- [requirements.md](./requirements.md): 環境変数によるパスワード管理の実装手順

### 監視/検知/対応（NIST Detect/Respond中心）

#### 検知

**評価観点**:
- fail2ban監視（Banイベントの自動検知）
- マルウェアスキャン結果の自動アラート化
- ports監視（`ports-unexpected`の検知）
- ファイル整合性監視
- プロセス監視

**確認箇所**:
- [infrastructure/ansible/templates/security-monitor.sh.j2](../../infrastructure/ansible/templates/security-monitor.sh.j2)
- [scripts/generate-alert.sh](../../scripts/generate-alert.sh)
- [infrastructure/ansible/templates/clamav-scan.sh.j2](../../infrastructure/ansible/templates/clamav-scan.sh.j2)
- [infrastructure/ansible/templates/trivy-scan.sh.j2](../../infrastructure/ansible/templates/trivy-scan.sh.j2)
- [infrastructure/ansible/templates/rkhunter-scan.sh.j2](../../infrastructure/ansible/templates/rkhunter-scan.sh.j2)

**既存証跡**:
- [phase9-10-specifications.md](./phase9-10-specifications.md): リアルタイム監視強化実装完了
- [implementation-assessment.md](./implementation-assessment.md): fail2ban監視、マルウェアスキャン結果の自動アラート化実施済み

#### 対応

**評価観点**:
- インシデント対応手順の実効性（初動・封じ込め・復旧）
- アラート通知（ファイルベース、Webhook）
- 管理画面でのアラート表示

**確認箇所**:
- [docs/security/incident-response.md](./incident-response.md)
- [scripts/generate-alert.sh](../../scripts/generate-alert.sh)
- [apps/web/src/pages/admin/](../../apps/web/src/pages/admin/) のアラート表示機能

**既存証跡**:
- [incident-response.md](./incident-response.md): インシデント対応手順定義済み
- [phase9-10-specifications.md](./phase9-10-specifications.md): Webhookアラート通知実装完了

## 既存証跡のマッピング

### 評価項目と既存証跡の対応表

| 評価項目 | 既存証跡 | 状態 | 未確認点 |
|---------|---------|------|---------|
| **OWASP A01（アクセス制御）** | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) | ✅ 実施済み | 権限監査の異常パターン検知の動作確認 |
| **OWASP A02（暗号化）** | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) | ✅ 実施済み | バックアップ暗号化の鍵管理方法 |
| **OWASP A03（インジェクション）** | [validation-review.md](./validation-review.md) | ✅ 実施済み | 生SQLの使用有無の網羅的確認 |
| **OWASP A04（安全でない設計）** | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) | ⚠️ 未実施 | セキュリティ設計レビューの実施 |
| **OWASP A05（設定ミス）** | [port-security-audit.md](./port-security-audit.md) | ✅ 実施済み | Docker設定の詳細確認（readOnlyRootFilesystem等） |
| **OWASP A06（脆弱コンポーネント）** | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | ✅ 実施済み | Trivyスキャンの定期実行確認 |
| **OWASP A07（認証失敗）** | [phase9-10-specifications.md](./phase9-10-specifications.md) | ✅ 実施済み | MFAの実機テスト結果確認 |
| **OWASP A08（整合性失敗）** | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) | ⚠️ 未実施 | パッケージ署名検証、SRIの実装 |
| **OWASP A09（ログ/監視失敗）** | [phase9-10-specifications.md](./phase9-10-specifications.md) | ✅ 実施済み | ログの長期保存と分析 |
| **OWASP A10（SSRF）** | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) | ⚠️ 未実施 | 外部URLリクエスト機能の有無確認 |
| **IPA CSRF対策** | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) | ⚠️ 未実施 | SameSite Cookie属性、CSRFトークンの実装 |
| **CIS Docker** | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) | ⚠️ 一部未実施 | readOnlyRootFilesystem、securityContext、ヘルスチェック |
| **CIS PostgreSQL** | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) | ⚠️ 一部未実施 | SSL/TLS接続強制、監査ログ設定 |
| **NIST Protect** | [port-security-audit.md](./port-security-audit.md) | ✅ 実施済み | 管理画面IP制限の動作確認 |
| **NIST Detect** | [phase9-10-specifications.md](./phase9-10-specifications.md) | ✅ 実施済み | 検知→通知→可視化のE2E確認 |
| **NIST Respond** | [incident-response.md](./incident-response.md) | ✅ 実施済み | インシデント対応演習の実施 |
| **NIST Recover** | [implementation-assessment.md](./implementation-assessment.md) | ⚠️ 一部未実施 | USBメディアテスト、オフライン保存の検証 |

## 自動評価の実施手順

### Trivyスキャン（依存関係/イメージ脆弱性）

**実行環境**: Pi5上またはCI環境

**実行手順**:

1. **ファイルシステムスキャン**:
   ```bash
   cd /opt/RaspberryPiSystem_002
   trivy fs \
     --ignore-unfixed \
     --severity HIGH,CRITICAL \
     --exit-code 1 \
     --scanners vuln \
     --skip-dirs "**/certs" \
     --skip-dirs "**/alerts" \
     --format json \
     --output trivy-fs-report.json \
     .
   ```

2. **Dockerイメージスキャン**:
   ```bash
   # イメージをビルド
   docker build -t raspisys-api:security-eval -f infrastructure/docker/Dockerfile.api .
   docker build -t raspisys-web:security-eval -f infrastructure/docker/Dockerfile.web .
   
   # スキャン実行
   trivy image \
     --ignore-unfixed \
     --severity HIGH,CRITICAL \
     --exit-code 1 \
     --scanners vuln \
     --format json \
     --output trivy-image-api-report.json \
     raspisys-api:security-eval
   
   trivy image \
     --ignore-unfixed \
     --severity HIGH,CRITICAL \
     --exit-code 1 \
     --scanners vuln \
     --trivyignores .trivyignore \
     --format json \
     --output trivy-image-web-report.json \
     raspisys-web:security-eval
   ```

3. **結果の分析**:
   - HIGH/CRITICAL脆弱性のリストアップ
   - 修正可能な脆弱性の特定
   - 修正不可能な脆弱性の影響範囲評価

**CI同等条件**:
- `--ignore-unfixed`: 修正不可能な脆弱性を無視
- `--severity HIGH,CRITICAL`: HIGH/CRITICALのみ検出
- `--exit-code 1`: 脆弱性検出時に失敗

### OWASP ZAPスキャン（Webアプリケーション）

**実行環境**: 外部マシン（Mac等）からPi5へアクセス

**実行手順**:

1. **認証済みセッションの取得**:
   ```bash
   # ログインしてトークンを取得
   curl -X POST https://<pi5-ip>/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin1234","totpCode":"123456"}'
   ```

2. **ZAPスキャンの実行**:
   ```bash
   # ZAPを起動
   docker run -t owasp/zap2docker-stable zap-baseline.py \
     -t https://<pi5-ip>/admin \
     -J \
     -j \
     -r zap-report.html \
     -I \
     -a \
     -z "-config replacer.full_list(0).description=Authorization" \
     -z "-config replacer.full_list(0).enabled=true" \
     -z "-config replacer.full_list(0).matchtype=REQ_HEADER" \
     -z "-config replacer.full_list(0).matchstr=Authorization" \
     -z "-config replacer.full_list(0).regex=false" \
     -z "-config replacer.full_list(0).replacement=Bearer <access-token>"
   ```

**注意事項**:
- レート制限（認証10 req/min、グローバル120 req/min）に注意
- アカウントロックのリスクを避けるため、低頻度で実行
- 管理画面IP制限により、許可ネットワークからのみアクセス可能

### Docker設定チェック（CIS Docker Benchmark相当）

**実行手順**:

1. **docker-compose設定の確認**:
   ```bash
   cd /opt/RaspberryPiSystem_002/infrastructure/docker
   # 設定ファイルの確認
   cat docker-compose.server.yml
   ```

2. **実行時設定の確認**:
   ```bash
   # コンテナの詳細情報を確認
   docker inspect docker-api-1 | jq '.[0].HostConfig'
   docker inspect docker-web-1 | jq '.[0].HostConfig'
   docker inspect docker-db-1 | jq '.[0].HostConfig'
   ```

3. **チェック項目**:
   - ポートマッピングの有無（DB/APIは非公開）
   - リソース制限（メモリ/CPU）
   - ログドライバーの設定
   - ヘルスチェックの設定
   - セキュリティコンテキストの設定

## 手動レビュー範囲とチェックリスト

### 認証・認可

**確認観点**:

- [ ] JWT認証の実装確認
  - [ ] アクセストークンとリフレッシュトークンの分離
  - [ ] トークンの有効期限設定（15分/7日）
  - [ ] トークンの検証ロジック
- [ ] RBACの実装確認
  - [ ] `authorizeRoles`関数の動作確認
  - [ ] ロールごとの権限設定（ADMIN/MANAGER/VIEWER）
  - [ ] エンドポイントごとの権限設定
- [ ] MFAの実装確認
  - [ ] TOTP認証の動作確認
  - [ ] バックアップコードの生成・使用
  - [ ] 30日記憶オプション（remember-me）の動作確認
- [ ] レート制限の実装確認
  - [ ] 認証エンドポイント（10 req/min）
  - [ ] グローバル（120 req/min）
  - [ ] レート制限超過時のエラーレスポンス

**確認箇所**:
- [apps/api/src/routes/auth.ts](../../apps/api/src/routes/auth.ts)
- [apps/api/src/lib/auth.ts](../../apps/api/src/lib/auth.ts)
- [apps/api/src/plugins/authorization.ts](../../apps/api/src/plugins/authorization.ts)
- [apps/api/src/plugins/rate-limit.ts](../../apps/api/src/plugins/rate-limit.ts)
- [apps/api/src/lib/mfa.ts](../../apps/api/src/lib/mfa.ts)

### 秘密情報管理

**確認観点**:

- [ ] `.env`ファイルの保護
  - [ ] `.gitignore`に含まれているか
  - [ ] バックアップスクリプトに含まれているか
  - [ ] ファイル権限の設定（600）
- [ ] Ansible Vaultの使用
  - [ ] `host_vars/*/vault.yml`の存在確認
  - [ ] Vaultパスワードの管理方法
  - [ ] 機密情報の暗号化確認
- [ ] 証明書ファイルの保護
  - [ ] 証明書ファイルの場所（`/opt/RaspberryPiSystem_002/certs/`）
  - [ ] ファイル権限の設定（644/600）
  - [ ] バックアップ方法の確認
- [ ] 環境変数の管理
  - [ ] デフォルト値の使用有無（開発環境用）
  - [ ] 本番環境での強力なパスワード設定
  - [ ] 環境変数のログ出力有無

**確認箇所**:
- [.gitignore](../../.gitignore)
- [infrastructure/ansible/host_vars/*/vault.yml](../../infrastructure/ansible/host_vars/)
- [infrastructure/docker/docker-compose.server.yml](../../infrastructure/docker/docker-compose.server.yml)
- [apps/api/src/config/env.ts](../../apps/api/src/config/env.ts)

### ログ/監視

**確認観点**:

- [ ] ログの記録
  - [ ] 認証ログ（ログイン成功/失敗）
  - [ ] アクセスログ（APIエンドポイント、HTTPステータス）
  - [ ] エラーログ（例外、スタックトレース）
  - [ ] セキュリティログ（fail2ban、マルウェアスキャン）
- [ ] ログの保護
  - [ ] 秘密情報のログ出力有無（`x-client-key`、Webhook URLなど）
  - [ ] 個人情報のログ出力有無
  - [ ] ログファイルの権限設定
- [ ] ログローテーション
  - [ ] ログローテーション設定の有無
  - [ ] ログ保持期間（52週）
  - [ ] ログの圧縮設定
- [ ] 監視の動作確認
  - [ ] fail2ban監視（15分間隔）
  - [ ] マルウェアスキャン結果の自動アラート化
  - [ ] ports監視（`ports-unexpected`の検知）
  - [ ] ファイル整合性監視
  - [ ] プロセス監視

**確認箇所**:
- [infrastructure/ansible/templates/security-monitor.sh.j2](../../infrastructure/ansible/templates/security-monitor.sh.j2)
- [infrastructure/ansible/templates/logrotate-security.conf.j2](../../infrastructure/ansible/templates/logrotate-security.conf.j2)
- [infrastructure/docker/docker-compose.server.yml](../../infrastructure/docker/docker-compose.server.yml)（ログドライバー設定）
- [apps/api/src/lib/errors.ts](../../apps/api/src/lib/errors.ts)

## 実機/運用評価の実施手順

### ポート露出の確認

**目的**: 意図したポート（80/443/22/5900）のみが外部露出されていることを確認する

**実施手順**:

1. **Pi5上でポート状態を確認**:
   ```bash
   # LISTEN/UNCONNの実態確認（プロセス付き）
   sudo ss -H -tulpen
   
   # UFW許可の確認
   sudo ufw status verbose
   
   # Dockerコンテナのポートマッピング確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps
   ```

2. **外部からのポートスキャン**（許可ネットワークから）:
   ```bash
   # 外部マシン（Mac等）から実行
   nmap -p 22,80,443,5900,5432,8080 <pi5-ip>
   ```

3. **期待値**:
   - 22（SSH）: 許可ネットワークからのみアクセス可能
   - 80（HTTP）: アクセス可能（HTTPSリダイレクト）
   - 443（HTTPS）: アクセス可能
   - 5900（VNC）: 許可ネットワークからのみアクセス可能
   - 5432（PostgreSQL）: 接続拒否（Docker内部のみ）
   - 8080（API）: 接続拒否（Docker内部のみ）

**既存証跡**:
- [port-security-verification-results.md](./port-security-verification-results.md): 期待ポート（22/80/443/5900）のみ外部露出、Docker内部ポート（5432/8080）は非公開

### 検知→通知→可視化の経路確認

**目的**: fail2ban/マルウェアスキャン/ports監視の「検知→通知→可視化」経路が正常に動作することを確認する

**実施手順**:

1. **fail2ban監視の確認**:
   ```bash
   # Pi5上で実行
   # 意図的なBanイベントを生成
   sudo fail2ban-client set sshd banip 203.0.113.50
   
   # 15分待機（security-monitor.timerの実行間隔）
   sleep 900
   
   # アラートファイルの確認
   ls -lt /opt/RaspberryPiSystem_002/alerts/ | head -5
   cat /opt/RaspberryPiSystem_002/alerts/alert-*.json | jq .
   
   # 管理画面でアラート表示を確認
   # https://<pi5-ip>/admin にアクセス
   
   # Ban解除
   sudo fail2ban-client set sshd unbanip 203.0.113.50
   ```

2. **マルウェアスキャン結果の確認**:
   ```bash
   # Pi5上で実行
   # 手動スキャンを実行
   sudo /usr/local/bin/clamav-scan.sh
   sudo /usr/local/bin/trivy-scan.sh
   sudo /usr/local/bin/rkhunter-scan.sh
   
   # ログの確認
   tail -100 /var/log/clamav/clamav-scan.log
   tail -100 /var/log/trivy/trivy-scan.log
   tail -100 /var/log/rkhunter/rkhunter.log
   
   # アラートファイルの確認
   ls -lt /opt/RaspberryPiSystem_002/alerts/ | head -5
   ```

3. **ports監視の確認**:
   ```bash
   # Pi5上で実行
   # security-monitor.shを手動実行
   sudo /usr/local/bin/security-monitor.sh
   
   # アラートファイルの確認
   ls -lt /opt/RaspberryPiSystem_002/alerts/ | head -5
   ```

**既存証跡**:
- [phase9-10-specifications.md](./phase9-10-specifications.md): リアルタイム監視強化実装完了、実機テスト完了
- [implementation-assessment.md](./implementation-assessment.md): fail2ban監視、マルウェアスキャン結果の自動アラート化実施済み

### バックアップ・復元の実効性確認

**目的**: バックアップ暗号化・復元テスト・オフライン保管（USB運用）の実効性を確認する

**実施手順**:

1. **暗号化バックアップの実行**:
   ```bash
   # Pi5上で実行
   cd /opt/RaspberryPiSystem_002
   sudo ./scripts/server/backup-encrypted.sh
   
   # バックアップファイルの確認
   ls -lh /opt/backups/
   ```

2. **復元テスト**（検証用DBで実施）:
   ```bash
   # Pi5上で実行
   # 検証用DBを作成
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -c "CREATE DATABASE borrow_return_restore_test;"
   
   # 復元スクリプトを実行
   sudo ./scripts/server/restore-encrypted.sh \
     /opt/backups/backup-encrypted-*.gpg \
     borrow_return_restore_test
   
   # データの確認
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -d borrow_return_restore_test \
     -c "SELECT COUNT(*) FROM \"Loan\";"
   
   # 検証用DBを削除
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -c "DROP DATABASE borrow_return_restore_test;"
   ```

3. **オフライン保存用USBメディアテスト**（USB接続時に実施）:
   ```bash
   # USBメディアをマウント
   sudo mount /dev/sda1 /mnt/usb
   
   # バックアップファイルをコピー
   sudo cp /opt/backups/backup-encrypted-*.gpg /mnt/usb/
   
   # バックアップファイルを削除（Pi5上）
   sudo rm /opt/backups/backup-encrypted-*.gpg
   
   # USBメディアから復元
   sudo cp /mnt/usb/backup-encrypted-*.gpg /opt/backups/
   sudo ./scripts/server/restore-encrypted.sh \
     /opt/backups/backup-encrypted-*.gpg \
     borrow_return_restore_test
   
   # USBメディアをアンマウント
   sudo umount /mnt/usb
   ```

**既存証跡**:
- [implementation-assessment.md](./implementation-assessment.md): バックアップ暗号化・復元テスト実施済み、USBメディアテスト未実施

## スコアリング方法

### スコアリング基準（0-3スケール）

各評価項目を以下の基準で評価します：

- **0: 未実施 / 不明**
  - 対策が実装されていない、または実装状況が不明
- **1: 部分実施（抜けがある）**
  - 対策が部分的に実装されているが、抜けがある
  - 例: CSRF対策がSameSite Cookieのみで、CSRFトークンが未実装
- **2: 実施済み（妥当）**
  - 対策が実装されており、妥当なレベル
  - 例: JWT認証、RBAC、MFAが実装されている
- **3: 実施済み + 証跡/自動化/監視まで整備**
  - 対策が実装され、さらに証跡（テスト/ログ）、自動化、監視まで整備されている
  - 例: MFAが実装され、統合テスト・実機テスト・監視まで整備されている

### リスク優先度の付け方

各評価項目に以下の観点でリスク優先度を付与します：

- **High（高）**: 
  - 影響が大きい（データ漏洩、システム停止など）
  - 起こりやすさが高い（外部からアクセス可能、デフォルト設定など）
  - 検知性が低い（ログが記録されない、監視がないなど）
  - 復旧性が低い（バックアップがない、復旧手順がないなど）
- **Med（中）**: 
  - 影響が中程度、または起こりやすさが中程度
  - 検知性・復旧性が部分的に整備されている
- **Low（低）**: 
  - 影響が小さい、または起こりやすさが低い
  - 検知性・復旧性が整備されている

### スコアリング例

| 評価項目 | スコア | リスク優先度 | 根拠 |
|---------|--------|------------|------|
| **OWASP A01（アクセス制御）** | 3 | Low | JWT/RBAC/MFA実装済み、統合テスト・実機テスト完了、権限監査実装済み |
| **OWASP A02（暗号化）** | 2 | Low | HTTPS強制、バックアップ暗号化実装済み、鍵管理方法の確認が必要 |
| **OWASP A03（インジェクション）** | 3 | Low | Prisma/Zod実装済み、121箇所でzod使用、テスト実装済み |
| **OWASP A04（安全でない設計）** | 1 | Med | セキュリティ設計レビュー未実施、新機能追加時のチェックリスト未作成 |
| **OWASP A05（設定ミス）** | 2 | Low | ポートマッピング削除済み、セキュリティヘッダー実装済み、Docker設定の一部未実施 |
| **OWASP A06（脆弱コンポーネント）** | 3 | Low | TrivyスキャンCI実装済み、HIGH/CRITICALでFail、定期実行スクリプト追加済み |
| **OWASP A07（認証失敗）** | 3 | Low | MFA実装完了、TOTP/バックアップコード、統合テスト・実機テスト完了 |
| **OWASP A08（整合性失敗）** | 1 | Med | パッケージ署名検証未実装、SRI未実装、pnpmロックファイルとTrivyスキャンで対策 |
| **OWASP A09（ログ/監視失敗）** | 3 | Low | セキュリティログ監視実装済み、アラート通知実装済み、リアルタイム監視強化実装完了 |
| **OWASP A10（SSRF）** | 2 | Low | 外部URLリクエスト機能が限定的、URLバリデーション実装済み、内部ネットワークへのアクセス制限あり |
| **IPA CSRF対策** | 1 | Med | CSRFトークン未実装、SameSite Cookie属性未設定、JWT認証によりリスク低減 |
| **CIS Docker** | 2 | Low | ポートマッピング削除済み、非rootユーザー実行、readOnlyRootFilesystem等未実施 |
| **CIS PostgreSQL** | 2 | Med | ポートマッピング削除済み、パスワードポリシー強化済み、SSL/TLS接続強制未実施 |
| **NIST Protect** | 3 | Low | 多層防御実装済み、管理画面IP制限、セキュリティヘッダー、レート制限実装済み |
| **NIST Detect** | 3 | Low | fail2ban監視、マルウェアスキャン結果の自動アラート化、リアルタイム監視強化実装完了 |
| **NIST Respond** | 2 | Med | インシデント対応手順定義済み、実機テスト未実施、インシデント対応演習未実施 |
| **NIST Recover** | 2 | Med | バックアップ暗号化・復元テスト実施済み、USBメディアテスト未実施 |

## 成果物の出力フォーマット

### 1. セキュリティ現状スコアカード

**フォーマット**: カテゴリ別スコアと根拠リンクを含む表形式

**例**:

| カテゴリ | スコア | 実施率 | 根拠リンク |
|---------|--------|--------|----------|
| **OWASP Top 10 2021** | 2.3/3.0 | 77% | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) |
| **IPA「安全なウェブサイトの作り方」** | 2.5/3.0 | 83% | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) |
| **CIS Dockerベンチマーク** | 2.0/3.0 | 67% | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) |
| **CIS PostgreSQLベンチマーク** | 2.0/3.0 | 67% | [standard-security-checklist-audit.md](./standard-security-checklist-audit.md) |
| **NIST CSF 2.0相当** | 2.5/3.0 | 83% | [implementation-assessment.md](./implementation-assessment.md) |

### 2. ギャップ一覧

**フォーマット**: 未実施/要再確認項目の一覧と推奨対応

**例**:

| 評価項目 | 現状 | リスク優先度 | 推奨対応 | 実装難易度 | 想定工数 |
|---------|------|------------|---------|-----------|---------|
| **CSRF対策** | 未実施 | Med | SameSite Cookie属性の設定、CSRFトークンの実装 | 中 | 1-2日 |
| **PostgreSQL SSL/TLS接続強制** | 未実施 | Med | PostgreSQLのSSL設定の有効化、クライアント接続でのSSL/TLS接続の強制 | 中 | 1日 |
| **PostgreSQL監査ログ** | 未実施 | Med | PostgreSQLの監査ログ設定（`log_statement`、`log_connections`など） | 低 | 0.5日 |
| **セキュリティ設計レビュー** | 未実施 | Med | セキュリティ設計レビューの実施（年1回）、新機能追加時のセキュリティ設計チェックリストの作成 | 中 | 2-3日 |
| **依存関係の整合性検証** | 未実施 | Med | パッケージ署名検証の実装（pnpmの`verifySignatures`機能）、Subresource Integrity (SRI) の実装 | 中 | 1-2日 |
| **USBメディアテスト** | 未実施 | High | USBメディアへの実際のコピー/削除テスト | 低 | 0.5日 |

### 3. トップリスク10

**フォーマット**: 優先度順にリスクを列挙し、対策案・想定工数・副作用を記載

**例**:

| 順位 | リスク | 影響 | 起こりやすさ | 検知性 | 復旧性 | 対策案 | 想定工数 | 副作用 |
|------|--------|------|------------|--------|--------|--------|---------|--------|
| 1 | **USBメディアテスト未実施** | High | Med | High | Low | USBメディアへの実際のコピー/削除テストを実施 | 0.5日 | なし |
| 2 | **CSRF対策未実施** | Med | Med | Med | Med | SameSite Cookie属性の設定、CSRFトークンの実装 | 1-2日 | 認証フローの変更が必要 |
| 3 | **PostgreSQL SSL/TLS接続強制未実施** | Med | Low | Med | Med | PostgreSQLのSSL設定の有効化 | 1日 | 接続設定の変更が必要 |
| 4 | **セキュリティ設計レビュー未実施** | Med | Low | Low | Med | セキュリティ設計レビューの実施（年1回） | 2-3日 | なし |
| 5 | **依存関係の整合性検証未実施** | Med | Low | Med | Med | パッケージ署名検証の実装、SRIの実装 | 1-2日 | ビルド時間の増加可能性 |
| 6 | **PostgreSQL監査ログ未実施** | Med | Low | Low | Med | PostgreSQLの監査ログ設定 | 0.5日 | ログファイルサイズの増加 |
| 7 | **Docker readOnlyRootFilesystem未実施** | Low | Low | Med | Med | 必要最小限のディレクトリのみ書き込み可能にする | 1-2日 | アプリケーションログの書き込み先変更が必要 |
| 8 | **Docker securityContext未設定** | Low | Low | Med | Med | `securityContext`の設定（`runAsNonRoot: true`など） | 0.5日 | なし |
| 9 | **Dockerヘルスチェック未実装** | Low | Low | Med | Med | Docker Composeの`healthcheck`設定の追加 | 0.5日 | なし |
| 10 | **SSRF対策の明示的実装未確認** | Low | Low | Med | Med | 外部URLリクエスト機能実装時に、URLバリデーションとホワイトリスト制御を実装 | 1日 | なし |

### 4. 再評価サイクル

**フォーマット**: 評価の実施頻度とトリガー条件を定義

**実施頻度**:
- **包括的評価**: 年1回（1月に実施）
- **簡易評価**: 半期1回（7月に実施）
- **変更時評価**: 以下の変更時に実施
  - 新機能追加時（認証・認可関連）
  - 外部サービス連携追加時（Dropbox、Gmail、Slackなど）
  - インフラ変更時（Docker設定、ネットワーク設定など）
  - 重大な脆弱性情報公開時

**評価範囲**:
- **包括的評価**: 全評価項目を実施
- **簡易評価**: 自動評価（Trivyスキャン）と主要項目の確認
- **変更時評価**: 変更に関連する評価項目のみ実施

## 評価実施スケジュール（推奨）

### Phase 1: 準備（1週間）

**実施内容**:
- 評価ツールの準備（Trivy、OWASP ZAP等）
- 評価環境のセットアップ
- 評価チェックリストの最終確認
- 既存証跡の横断レビュー

**成果物**:
- 評価環境セットアップ手順書
- 評価チェックリスト（詳細版）

### Phase 2: 自動評価（1週間）

**実施内容**:
- Trivyスキャン（ファイルシステム、Dockerイメージ）
- OWASP ZAPスキャン（Webアプリケーション）
- Docker設定チェック（CIS Docker Benchmark相当）

**成果物**:
- Trivyスキャンレポート（JSON形式）
- OWASP ZAPスキャンレポート（HTML形式）
- Docker設定チェックレポート

### Phase 3: 手動評価（2週間）

**実施内容**:
- 設定ファイルレビュー（Docker Compose、Ansible、Caddy設定など）
- コードレビュー（認証・認可ロジック、入力バリデーションなど）
- アーキテクチャレビュー（セキュリティ設計の妥当性）

**成果物**:
- 設定ファイルレビューレポート
- コードレビューレポート
- アーキテクチャレビューレポート

### Phase 4: 実機検証（1週間）

**実施内容**:
- ポートスキャン（意図した露出のみか）
- バックアップ・復元テスト（暗号化、オフライン保管）
- セキュリティ機能の動作確認（fail2ban、マルウェアスキャン、ports監視）

**成果物**:
- ポートスキャンレポート
- バックアップ・復元テストレポート
- セキュリティ機能動作確認レポート

### Phase 5: 報告書作成（1週間）

**実施内容**:
- 評価結果のまとめ
- 改善提案の優先順位付け
- 報告書の作成

**成果物**:
- セキュリティ評価報告書（包括版）
- セキュリティ現状スコアカード
- ギャップ一覧
- トップリスク10
- 再評価サイクル

## 評価実施時の注意事項

### 安全性チェック

- **システム変更は行わない**: この計画自体は評価手順のため、システム変更は行わない
- **実機検証の副作用**: 実機検証を行う場合は、以下の副作用があり得るため、スコープと実施時間帯を明確化する
  - 負荷（CPU/メモリ使用率の増加）
  - ログ量（大量のログが生成される可能性）
  - アカウントロック（レート制限による）
  - ネットワーク負荷（ポートスキャン、Webスキャンなど）

### 実施時間帯

- **通常運用時間外**: 実機検証は通常運用時間外（深夜・休日）に実施することを推奨
- **メンテナンス時間**: メンテナンス時間を確保してから実施する

### バックアップ

- **評価前のバックアップ**: 評価実施前にバックアップを取得することを推奨
- **評価結果の保存**: 評価結果は安全な場所に保存する

## 関連ドキュメント

- [セキュリティ要件定義](./requirements.md)
- [セキュリティ実装の妥当性評価](./implementation-assessment.md)
- [標準セキュリティチェックリスト監査レポート](./standard-security-checklist-audit.md)
- [ポートセキュリティ監査レポート](./port-security-audit.md)
- [ポートセキュリティ修正後の実機検証結果](./port-security-verification-results.md)
- [Phase 9/10 詳細仕様書](./phase9-10-specifications.md)
- [インシデント対応手順](./incident-response.md)
- [バックアップ・リストア手順](../guides/backup-and-restore.md)
- [ポートベースライン（2026-01-18）](../knowledge-base/infrastructure/ports-baseline-20260118.md)

## 参照フレームワーク

- [OWASP Top 10 2021](https://owasp.org/Top10/2021/ja/)
- [IPA「安全なウェブサイトの作り方」](https://www.ipa.go.jp/security/vuln/website.html)
- [CIS Dockerベンチマーク](https://www.cisecurity.org/benchmark/docker)
- [CIS PostgreSQLベンチマーク](https://www.cisecurity.org/benchmark/postgresql)
- [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework)
