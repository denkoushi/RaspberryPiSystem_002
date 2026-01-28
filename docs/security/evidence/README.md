## セキュリティ評価 証跡ガイド

このディレクトリは、セキュリティ評価の実行ログ・レポート・スクリーンショット等の
証跡を整理して保存するためのものです。評価内容の再現性と監査性を確保します。

### 1. 収集方針
- 実行コマンドと結果は可能な限りファイル化して保存する
- 本番環境の証跡は、必要最小限の情報に絞る（機密情報はマスク）
- 変更点の評価は「差分」を明示する

### 2. 命名規則
以下の形式で保存します。

```
YYYYMMDD-HHMM_<env>_<category>_<detail>.<ext>
```

例:
- `20260128-2130_staging_zap_baseline.html`
- `20260128-2205_prod_ports_nmap.txt`
- `20260128-2310_repo_trivy_fs.json`

**env**:
- `repo` / `staging` / `prod`

**category**:
- `zap` / `ports` / `trivy` / `audit` / `logs` / `backup` / `restore` / `misc`

### 3. 保存すべき最低限の証跡
- Trivy FS / Image スキャンレポート（JSON）
- pnpm audit 結果（txt）
- ZAP レポート（HTML/JSON）
- ポート露出確認（ss/ufw/nmapの結果）
- 監視アラート動作（fail2ban / security-monitor / malware）
- バックアップ/復元テスト結果（コマンドログ）

### 4. 機密情報の扱い
- 秘密情報やキーは必ずマスクする
- `x-client-key`、Webhook URL、トークン、パスワードは証跡に残さない

### 5. 実機検証の実行

**自動スクリプト実行（推奨）**:
```bash
# Pi5にSSH接続後
cd /opt/RaspberryPiSystem_002
sudo ./scripts/security/verify-production-security.sh
```

詳細は [production-verification-guide.md](./production-verification-guide.md) を参照してください。
