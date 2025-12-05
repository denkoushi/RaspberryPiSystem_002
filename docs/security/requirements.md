# セキュリティ要件定義

最終更新: 2025-12-05

## 概要

本ドキュメントでは、Raspberry Pi NFC 持出返却システムのセキュリティ要件を定義します。

## 運用環境

- **通常運用**: ローカルネットワークのみ（インターネット接続なし）
- **メンテナンス時**: インターネット接続が必要（MacからRaspberry Piへ指令、GitHubからpull）

## セキュリティ要件の分類

### 1. メンテナンス時のセキュリティ

**要件**: メンテナンス時にインターネット経由でAnsible実行・GitHubからpullする際、SSHポートをインターネットに公開せず、安全に接続できること。

**対策**:
- TailscaleなどのVPNを導入し、メンテナンス時にTailscale経由でSSH接続する
- 通常運用時はローカルネットワークのIPアドレスを使用する
- SSH接続設定を2つ用意（Tailscale IP用とローカルIP用）

**優先度**: 最高（メンテナンス時にインターネット経由でAnsibleを実行する場合）

**関連要件**: [IPアドレス管理](#6-ipアドレス管理)

### 2. 通常運用時のセキュリティ対策

**要件**: 通常運用時（Web UI、API経由のアクセス）において、適切なセキュリティ対策が実装されていること。

**対策**:
- ファイアウォール設定（ufw）
- HTTPS強制設定
- IP制限（管理画面へのアクセス）
- fail2ban（ブルートフォース対策）

**実装状況（2025-12-05）**:
- ✅ ufwを導入し、HTTP/HTTPSと信頼済みSSH経路のみ許可
- ✅ CaddyでHTTP→HTTPSを常時リダイレクト、自己署名証明書を継続活用
- ✅ fail2ban（SSH/Caddy HTTP）を導入し、CLFログ監視で自動遮断
- 🔸 管理画面のIP制限は今後の課題（Tailscale ACLと併用予定）

**優先度**: 高

### 3. ランサムウェア対策

**要件**: ランサムウェアに感染しても、データを復旧できること。

**対策**:
- バックアップの暗号化
- バックアップのオフライン保存
- ファイルシステム保護（読み取り専用マウント）

**テスト状況（2025-12-05）**:
- ✅ 暗号化バックアップ/復号テスト（`backup-encrypted.sh` → GPG復号まで実施）
- ✅ 検証用DBへのフルリストア検証（`borrow_return_restore_test` にリストアし、Loan 436件・復元後にDB削除まで完了）
- ⚠️ オフライン保存用USBメディアを実際にマウントした状態でのコピー/削除テストは未実施（USB接続時に実施予定）

**優先度**: 最高

### 4. マルウェア対策

**要件**: マルウェアに感染しないこと、または感染を早期に検知できること。

**対策**:
- セキュリティソフトの導入（ClamAV、Trivy、rkhunter）
- 定期スキャンの設定
- Dockerイメージのスキャン

**実装状況（2025-12-05）**:
- ✅ Pi5にClamAV/Trivy/rkhunterを導入し、日次cronと`/var/log/{clamav,trivy,rkhunter}`へのログ集約を実装
- ✅ Pi4に軽量ClamAV/rkhunterを導入し、ストレージ配下のみを週次スキャン（CPU負荷を最小化）
- ✅ 手動スキャン（2025-12-05）で動作確認済み  
  - `sudo /usr/local/bin/clamav-scan.sh` → ログ `/var/log/clamav/clamav-scan.log` に成功記録、アラート発生なし  
  - `sudo /usr/local/bin/trivy-scan.sh` → 秘密鍵検出は skip-dir 設定で抑制済み（ログで過去検出との区別可）  
  - `sudo /usr/local/bin/rkhunter-scan.sh` → 既知警告（PermitRootLogin 等）で `alert-20251205-184324.json` が生成されることを確認
- 🔸 TrivyでDockerイメージ単位のスキャン、およびスキャンログの自動監視はPhase7後の課題

**優先度**: 高

### 5. 監視・アラート

**要件**: セキュリティインシデントを早期に検知し、適切に対応できること。

**対策**:
- セキュリティログの監視
- 異常検知時のアラート通知
- スキャン結果のログ監視

**実装状況（2025-12-05）**:
- ✅ `security-monitor.sh`でfail2banログ（Banイベント）と状態ファイルを監視し、`alerts/`に自動通知
- ✅ ClamAV/Trivy/rkhunterスクリプトが感染検知・スキャン失敗時に即時アラートを発火
- ✅ systemd timer（15分間隔）で監視を自動実行し、管理画面の既存アラート機能で確認可能
- ✅ fail2ban → アラート動作テスト（2025-12-05）: `fail2ban-client set sshd banip 203.0.113.50` で `alert-20251205-182352.json` が生成されることを確認し、解除後にBanリストが空に戻ることを確認
- 🔸 将来的にSlack等への外部通知を追加する場合は、アラートスクリプトの拡張で対応予定

**優先度**: 中

### 6. IPアドレス管理と運用モード可視化

**要件**: ローカルネットワークとTailscaleの切り替えを安全かつ効率的に行えること。現在の運用モードを可視化すること。

**現状の問題**:
- IPアドレスが複数の設定ファイルに直接記述されている
- ネットワーク環境が変わった際に、複数箇所を手動で修正する必要がある
- メンテナンス時と通常運用時の切り替えが煩雑
- 現在の運用モード（ローカル/メンテナンス）が分からない

**対策**:
- Ansibleの`group_vars/all.yml`にIPアドレス変数を定義
- ローカルネットワーク用とTailscale用のIPアドレスを変数で管理
- ネットワークモード（`local`/`tailscale`）で切り替え可能にする
- 既存コードのIPアドレス直接記述箇所を洗い出し、変数参照に変更
- **管理画面で現在の運用モードを可視化**（自動検出）

**運用モードの可視化**:
- **要件**: 管理画面のヘッダーまたはダッシュボードに現在のモードを表示する
- **自動検出**: インターネット接続の有無で判定
  - インターネット接続あり → 「メンテナンスモード」
  - インターネット接続なし → 「ローカル運用モード」
- **表示内容**:
  - 現在のモード（バッジやアイコンで表示）
  - ネットワーク状態（インターネット接続の有無）
  - 最後のメンテナンス日時（オプション）
- **切り替え方法**: UIでの切り替えは実装しない。Ansible変数（`group_vars/all.yml`の`network_mode`）で管理する
- **理由**: メンテナンスは頻度が低く、UIでの切り替えは誤操作リスクがあるため

**実装内容**:

1. **Ansibleの変数定義** (`infrastructure/ansible/group_vars/all.yml`)
   ```yaml
   # ネットワークモード: local または tailscale
   network_mode: "local"
   
   # ローカルネットワーク用IPアドレス
   local_network:
     raspberrypi5_ip: "192.168.10.230"
     raspberrypi4_ip: "192.168.10.223"
     raspberrypi3_ip: "192.168.10.109"
   
   # Tailscale用IPアドレス（メンテナンス時のみ使用）
   # 注意: Tailscale IPアドレスは動的に割り当てられるが、デバイスごとに固定される
   # メンテナンス時に `tailscale status` で確認して設定する
   tailscale_network:
     raspberrypi5_ip: ""  # メンテナンス時に確認して設定
     raspberrypi4_ip: ""
     raspberrypi3_ip: ""
   
   # 現在のネットワーク設定（network_modeに基づいて自動選択）
   current_network: "{{ local_network if network_mode == 'local' else tailscale_network }}"
   ```

2. **Ansibleのインベントリファイル** (`infrastructure/ansible/inventory.yml`)
   ```yaml
   ansible_host: "{{ current_network.raspberrypi5_ip }}"
   ```

3. **テンプレートファイルの修正**
   - 古いIPアドレス（`192.168.128.131`など）のデフォルト値を削除
   - 変数のみ参照するように変更

4. **既存コードのIPアドレス直接記述箇所の洗い出し**
   - `infrastructure/ansible/inventory.yml`: 複数箇所
   - `infrastructure/ansible/templates/*.j2`: デフォルト値に古いIPアドレス
   - `scripts/register-clients.sh`: ハードコードされたIPアドレス
   - ドキュメント内: 多数（参考情報として残す）

**検証状況（2025-12-05）**:
- ✅ `ansible raspberrypi5 ... -e network_mode={local,tailscale}` で `server_ip/kiosk_ip/signage_ip` が期待通りに切り替わることを確認
- ✅ `/api/system/network-mode` エンドポイントが `detectedMode=maintenance` / `configuredMode=local` / `status=internet_connected` を返し、Network Mode Badgeが実際の回線状態を表示することを確認

**優先度**: 高（メンテナンス時の運用効率化のため）

**関連要件**: [メンテナンス時のセキュリティ](#1-メンテナンス時のセキュリティ)

## デバイス別のセキュリティ要件

### Raspberry Pi 5（サーバー）

**必須の対策**:
- Tailscale導入（メンテナンス時のみ使用、インターネット接続あり）
- ファイアウォール設定（ufw）
- HTTPS強制設定
- fail2ban導入
- バックアップ暗号化・オフライン保存
- ClamAV導入
- Trivy導入（Dockerイメージスキャン）
- rkhunter導入

**推奨の対策**:
- IP制限（管理画面へのアクセス）
- ログ監視・アラート設定

### Raspberry Pi 4（キオスク）

**推奨の対策**:
- ClamAV導入（軽量設定、週1回スキャン）
- rkhunter導入（システム整合性チェック）

**不要な対策**:
- Tailscale導入（ローカルネットワークのみ）
- ファイアウォール設定（ローカルネットワークのみ）
- HTTPS強制設定（サーバー側で対応）

### Raspberry Pi 3（サイネージ）

**不要な対策**:
- セキュリティソフト導入（リソース不足のため）
- Tailscale導入（ローカルネットワークのみ）
- ファイアウォール設定（ローカルネットワークのみ）

**代替対策**:
- Pi5での対策を徹底する
- 定期的な再起動でクリーンな状態を保つ

## セキュリティ要件の優先順位

### 最優先（即座に実施）

1. バックアップ暗号化・オフライン保存
2. Tailscale導入（メンテナンス時のみ使用）
3. IPアドレス管理の変数化（運用効率化のため）

### 優先度: 高（1週間以内）

4. ファイアウォール設定（ufw）
5. HTTPS強制設定
6. fail2ban導入
7. ClamAV導入（Pi5）
8. Trivy導入（Pi5）

### 優先度: 中（1ヶ月以内）

9. rkhunter導入（Pi5）
10. ClamAV導入（Pi4、軽量設定）
11. IP制限（管理画面へのアクセス）
12. ログ監視・アラート設定

### 優先度: 低（実施しない）

13. Raspberry Pi 3へのセキュリティソフト導入（リソース不足のため）

## 関連ドキュメント

- [セキュリティ検証レビュー](./validation-review.md) - 既存のセキュリティ対策のレビュー
- [セキュリティ強化 ExecPlan](../plans/security-hardening-execplan.md) - 実装計画の詳細
- [セキュリティ強化テスト計画](../guides/security-test-plan.md) - テスト計画の詳細

