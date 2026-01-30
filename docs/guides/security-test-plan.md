# セキュリティ強化テスト計画

最終更新: 2025-12-04

## 概要

本ドキュメントでは、セキュリティ強化実装後のテスト計画を定義します。各フェーズごとにテスト項目を明確にし、実装漏れ・テスト漏れを防ぎます。

## テスト対象フェーズ

### Phase 1: IPアドレス管理の変数化と運用モード可視化

#### テスト項目

1. **変数定義の確認**
   - [ ] `infrastructure/ansible/group_vars/all.yml`が存在し、正しく定義されている
   - [ ] `network_mode`が`local`または`tailscale`のいずれかに設定されている
   - [ ] ローカルネットワーク用IPアドレスが正しく定義されている
   - [ ] Tailscale用IPアドレスが定義されている（空文字列でも可）

2. **インベントリファイルの変数参照確認**
   - [ ] `infrastructure/ansible/inventory.yml`で変数が正しく参照されている
   - [ ] `ansible_host`が変数参照になっている
   - [ ] URLやWebSocket URLが変数参照になっている

3. **テンプレートファイルの変数参照確認**
   - [ ] `infrastructure/ansible/templates/nfc-agent.env.j2`で変数が正しく参照されている
   - [ ] `infrastructure/ansible/templates/status-agent.conf.j2`で変数が正しく参照されている
   - [ ] `infrastructure/ansible/templates/docker.env.j2`で変数が正しく参照されている
   - [ ] 古いIPアドレス（`192.168.128.131`など）のデフォルト値が削除されている

4. **スクリプトの変数参照確認**
   - [ ] `scripts/register-clients.sh`で変数が正しく参照されている
   - [ ] ハードコードされたIPアドレスが削除されている

5. **切り替えテスト**
   - [ ] `network_mode: "tailscale"`でAnsibleが正常に動作する（通常運用）
   - [ ] `network_mode: "local"`でAnsibleが正常に動作する（緊急時のみ）
   - [ ] テンプレートファイルが正しくレンダリングされる
   - [ ] `scripts/register-clients.sh`が正しく動作する

6. **運用モード自動検出APIのテスト**
   - [ ] `/api/system/network-mode`エンドポイントが存在する
   - [ ] インターネット接続ありの場合、`{ mode: "maintenance", status: "internet_connected" }`が返る（運用上はTailscale通常運用として扱う）
   - [ ] インターネット接続なしの場合、`{ mode: "local", status: "local_network_only" }`が返る
   - [ ] APIのレスポンス時間が適切（5秒以内）

7. **管理画面での運用モード表示テスト**
   - [ ] 管理画面のヘッダーまたはダッシュボードに運用モードが表示される
   - [ ] バッジやアイコンで視覚的に表示される
   - [ ] 運用モードの表示が定期的に更新される（30秒ごと）
   - [ ] インターネット接続の有無に応じて正しく表示が切り替わる

#### テスト手順

```bash
# 1. 変数定義の確認
cat infrastructure/ansible/group_vars/all.yml

# 2. インベントリファイルの変数参照確認
grep -r "{{.*network.*}}" infrastructure/ansible/inventory.yml

# 3. テンプレートファイルの変数参照確認
grep -r "{{.*network.*}}" infrastructure/ansible/templates/

# 4. スクリプトの変数参照確認
grep -r "192\.168\.\d+\.\d+" scripts/register-clients.sh

# 5. 切り替えテスト（ローカルネットワーク）
cd infrastructure/ansible
ansible-playbook -i inventory.yml playbooks/ping.yml

# 6. 切り替えテスト（Tailscale、通常運用）
# network_modeをtailscaleに変更してから実行
ansible-playbook -i inventory.yml playbooks/ping.yml

# 7. 運用モード自動検出APIのテスト
curl http://192.168.10.230:8080/api/system/network-mode
# 期待: { mode: "local", status: "local_network_only" } または { mode: "maintenance", status: "internet_connected" }

# 8. 管理画面での運用モード表示テスト
# ブラウザで管理画面を開き、ヘッダーまたはダッシュボードに運用モードが表示されることを確認
# インターネット接続を有効/無効にして、表示が切り替わることを確認
```

### Phase 2: 通常運用の安全化（Tailscale導入）

#### テスト項目

1. **Tailscaleクライアントのインストール確認**
   - [ ] Raspberry Pi 5にTailscaleクライアントがインストールされている
   - [ ] Raspberry Pi 4/3にTailscaleクライアントがインストールされている（必要に応じて）

2. **Tailscale接続確認**
   - [ ] MacからTailscale IP経由でPi5にSSH接続できる（通常運用）
   - [ ] Pi5からTailscale IP経由でPi4/3にSSH接続できる（通常運用）

3. **緊急時の接続確認**
   - [ ] 緊急時のみローカルネットワークのIPアドレスでSSH接続できる
   - [ ] 緊急時のみローカルネットワーク経由でAnsibleを実行できる

4. **通常運用の運用確認**
   - [ ] Tailscale経由でAnsibleを実行できる
   - [ ] Tailscale経由でGitHubからpullできる

#### テスト手順

```bash
# 1. Tailscaleクライアントのインストール確認
ssh denkon5sd02@192.168.10.230 "tailscale version"

# 2. Tailscale接続確認（通常運用）
tailscale status
ssh raspi5-tailscale

# 3. 緊急時の接続確認（local）
ssh raspi5-local

# 4. 通常運用の運用確認
ssh raspi5-tailscale "cd /opt/RaspberryPiSystem_002 && git pull"
```

### Phase 3: バックアップ暗号化・オフライン保存

#### テスト項目

1. **バックアップ暗号化の確認**
   - [ ] バックアップファイルが暗号化されている
   - [ ] 暗号化されたバックアップを復号化できる

2. **オフライン保存の確認**
   - [ ] バックアップがUSBメモリ/外部HDDに保存されている
   - [ ] バックアップがネットワークから切り離されている

3. **バックアップ復元テスト**
   - [ ] データベースのリストアが正常に動作する
   - [ ] ファイルのリストアが正常に動作する

#### テスト手順

```bash
# 1. バックアップ暗号化の確認
ssh denkon5sd02@192.168.10.230 "cd /opt/RaspberryPiSystem_002 && ./scripts/backup.sh"
file /path/to/backup/backup-*.enc

# 2. オフライン保存の確認
ls -la /mnt/usb/backups/

# 3. バックアップ復元テスト
gpg --decrypt backup-*.enc | tar -xzf -
psql -U postgres -d borrow_return < backup.sql
```

### Phase 4: 通常運用時のセキュリティ対策

#### テスト項目

1. **ファイアウォール設定の確認**
   - [ ] ufwが有効になっている
   - [ ] 必要なポート（80, 443）のみ開放されている
   - [ ] SSHポートがローカルネットワークまたはTailscale経由のみ許可されている
   - [ ] 不要なポートが閉じられている

2. **HTTPS強制の確認**
   - [ ] HTTPアクセスがHTTPSにリダイレクトされる
   - [ ] HTTPS接続が正常に動作する

3. **fail2banの動作確認**
   - [ ] fail2banがインストールされている
   - [ ] fail2banがブルートフォース攻撃をブロックする

#### テスト手順

```bash
# 1. ファイアウォール設定の確認
ssh denkon5sd02@192.168.10.230 "sudo ufw status"

# 2. HTTPS強制の確認
curl -I http://192.168.10.230
# 期待: HTTP 301または302でHTTPSにリダイレクト

curl -I https://192.168.10.230
# 期待: HTTP 200

# 3. fail2banの動作確認
ssh denkon5sd02@192.168.10.230 "sudo fail2ban-client status"
# ブルートフォース攻撃をシミュレートして、IPがブロックされることを確認
```

### Phase 5: マルウェア対策

#### テスト項目

1. **ClamAVの動作確認**
   - [ ] ClamAVがインストールされている
   - [ ] ウイルス定義が最新である
   - [ ] 定期スキャンが設定されている
   - [ ] スキャンが正常に動作する

2. **Trivyの動作確認**
   - [ ] Trivyがインストールされている
   - [ ] Dockerイメージのスキャンが正常に動作する
   - [ ] 定期スキャンが設定されている

3. **rkhunterの動作確認**
   - [ ] rkhunterがインストールされている
   - [ ] 初期データベースが作成されている
   - [ ] 定期スキャンが設定されている
   - [ ] スキャンが正常に動作する

#### テスト手順

```bash
# 1. ClamAVの動作確認
ssh denkon5sd02@192.168.10.230 "sudo clamscan --version"
sudo clamscan -r /opt/RaspberryPiSystem_002

# 2. Trivyの動作確認
ssh denkon5sd02@192.168.10.230 "trivy --version"
trivy image postgres:15-alpine

# 3. rkhunterの動作確認
ssh denkon5sd02@192.168.10.230 "sudo rkhunter --versioncheck"
sudo rkhunter --check
```

### Phase 6: 監視・アラート

#### テスト項目

1. **セキュリティログの監視確認**
   - [ ] ログファイルが正しく記録されている
   - [ ] 異常パターンが検知されている

2. **アラート通知の確認**
   - [ ] 異常検知時にアラート通知が送信される
   - [ ] アラート通知が正しく設定されている

3. **スキャン結果のログ確認**
   - [ ] ClamAV、Trivy、rkhunterのスキャン結果がログに記録されている
   - [ ] 異常検知時にアラート通知が送信される

#### テスト手順

```bash
# 1. セキュリティログの監視確認
tail -f /var/log/auth.log
tail -f /var/log/fail2ban.log

# 2. アラート通知の確認
# 異常パターンをシミュレートして、アラート通知が送信されることを確認

# 3. スキャン結果のログ確認
tail -f /var/log/clamav/clamav.log
tail -f /var/log/trivy/trivy.log
tail -f /var/log/rkhunter/rkhunter.log
```

## テスト実行チェックリスト

### 実装前チェック

- [ ] セキュリティ要件定義を確認
- [ ] 実装計画を確認
- [ ] テスト計画を確認

### 実装中チェック

- [ ] 各フェーズの実装が完了したら、そのフェーズのテストを実行
- [ ] テストが失敗した場合は、実装を修正して再テスト

### 実装後チェック

- [ ] すべてのフェーズのテストが成功している
- [ ] テスト結果を記録している
- [ ] テスト漏れがないことを確認

## 関連ドキュメント

- [セキュリティ要件定義](../security/requirements.md) - セキュリティ要件の詳細
- [セキュリティ強化 ExecPlan](../plans/security-hardening-execplan.md) - 実装計画の詳細

