---
title: 環境構築ガイド - ローカルネットワーク変更時の対応
tags: [環境構築, ネットワーク, IPアドレス, SSH, Ansible]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [ansible-ssh-architecture.md, quick-start-deployment.md, ssh-setup.md]
category: guides
update-frequency: medium
---

# 環境構築ガイド - ローカルネットワーク変更時の対応

最終更新: 2025-12-01

## 概要

本ドキュメントでは、ローカルネットワークが変更された場合（例: 自宅ネットワーク → オフィスネットワーク）の環境構築手順を説明します。

## 前提知識

**重要なポイント**:
- MacからRaspberry Pi 3/4への直接SSH接続は**不要**です
- Macからは**Raspberry Pi 5にのみSSH接続**します
- Raspberry Pi 5上でAnsibleが実行され、Pi5からPi3/4にSSH接続して更新を実行します

詳細は [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md) を参照してください。

## ネットワーク変更時の対応手順

### Step 1: 新しいIPアドレスの確認

**各Raspberry PiでIPアドレスを確認**:

```bash
# Raspberry Pi 5で実行
hostname -I
# 例: 192.168.10.230

# Raspberry Pi 4で実行（VNC経由など）
hostname -I
# 例: 192.168.10.223

# Raspberry Pi 3で実行（VNC経由など）
hostname -I
# 例: 192.168.10.109
```

**または、管理画面で確認**:
- Raspberry Pi 5の管理画面（`https://<pi5-ip>/admin/clients`）でクライアントのIPアドレスを確認

### Step 2: MacからPi5へのSSH接続確認

**Macのターミナルで実行**:

```bash
# Pi5の新しいIPアドレスで接続テスト
ssh denkon5sd02@192.168.10.230

# 接続成功したら、Pi5のシェルが起動します
# 接続できない場合:
# 1. IPアドレスが正しいか確認
# 2. Pi5が起動しているか確認
# 3. SSHサーバーが起動しているか確認（Pi5で `sudo systemctl status ssh`）
```

### Step 3: inventory.ymlの更新

**Mac側のinventory.ymlを更新**:

```bash
# Macのプロジェクトディレクトリで実行
cd /Users/tsudatakashi/RaspberryPiSystem_002
nano infrastructure/ansible/inventory.yml
```

**更新内容**:
- `ansible_host`: 各Raspberry Piの新しいIPアドレスに更新
- `docker_server_ip`: Pi5の新しいIPアドレスに更新
- `web_agent_ws_url`: Pi5の新しいIPアドレスに更新
- `kiosk_url`: Pi5の新しいIPアドレスに更新
- `signage_server_url`: Pi5の新しいIPアドレスに更新
- `nfc_agent_api_base_url`: Pi5の新しいIPアドレスに更新
- `status_agent_api_base_url`: Pi5の新しいIPアドレスに更新

**更新例**:
```yaml
server:
  hosts:
    raspberrypi5:
      ansible_host: 192.168.10.230  # 新しいIPアドレス
      docker_server_ip: "192.168.10.230"
      web_agent_ws_url: "ws://192.168.10.230:7071/stream"
clients:
  hosts:
    raspberrypi4:
      ansible_host: 192.168.10.223  # 新しいIPアドレス
      kiosk_url: "https://192.168.10.230/kiosk"
      nfc_agent_api_base_url: "http://192.168.10.230:8080/api"
    raspberrypi3:
      ansible_host: 192.168.10.109  # 新しいIPアドレス
      signage_server_url: "https://192.168.10.230"
  vars:
    status_agent_api_base_url: "http://192.168.10.230:8080/api"
```

### Step 4: Pi5上のinventory.ymlの更新

**MacからPi5にinventory.ymlをコピー**:

```bash
# Macのターミナルで実行
# 方法1: sudoを使用してコピー（推奨）
cat infrastructure/ansible/inventory.yml | ssh denkon5sd02@192.168.10.230 "sudo tee /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml > /dev/null && sudo chown denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml"

# 方法2: 一時ファイル経由でコピー
scp infrastructure/ansible/inventory.yml denkon5sd02@192.168.10.230:/tmp/inventory.yml
ssh denkon5sd02@192.168.10.230 "sudo mv /tmp/inventory.yml /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml && sudo chown denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml"
```

**確認**:
```bash
# Pi5上で確認
ssh denkon5sd02@192.168.10.230 "cat /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml | grep -A 2 'raspberrypi4:' | head -3"
# ansible_host: 192.168.10.223 が表示されればOK
```

### Step 5: Pi5からPi4/3へのSSH接続確認

**Pi5に接続して実行**:

```bash
# Pi5にSSH接続
ssh denkon5sd02@192.168.10.230

# Pi5上で実行: Pi4への接続テスト
ssh -o StrictHostKeyChecking=no tools03@192.168.10.223 "echo 'Pi4接続成功' && hostname"

# Pi5上で実行: Pi3への接続テスト
ssh -o StrictHostKeyChecking=no signageras3@192.168.10.109 "echo 'Pi3接続成功' && hostname"
```

**期待される結果**:
```
Pi4接続成功
raspberrypi
Pi3接続成功
raspberrypi
```

**接続が失敗する場合**:
- SSH鍵が設定されていない可能性があります
- [SSH鍵ベース運用ガイド](./ssh-setup.md) を参照してSSH鍵を設定してください

### Step 6: SSH鍵の設定（必要に応じて）

**Pi5からPi4/3へのSSH鍵が設定されていない場合**:

```bash
# Pi5に接続
ssh denkon5sd02@192.168.10.230

# Pi5上で実行: Pi4に公開鍵を追加
ssh-copy-id -i ~/.ssh/id_ed25519.pub tools03@192.168.10.223
# パスワード入力が必要（初回のみ）

# Pi5上で実行: Pi3に公開鍵を追加
ssh-copy-id -i ~/.ssh/id_ed25519.pub signageras3@192.168.10.109
# パスワード入力が必要（初回のみ）
```

**既に公開鍵が設定されている場合**:
- `ssh-copy-id`を実行すると「All keys were skipped because they already exist」と表示されます
- これは正常です。接続テスト（Step 5）を実行してください

### Step 7: Ansible接続テスト

**Pi5上で実行**:

```bash
# Pi5に接続
ssh denkon5sd02@192.168.10.230

# Pi5上で実行: Ansible接続テスト
cd /opt/RaspberryPiSystem_002
ansible all -i infrastructure/ansible/inventory.yml -m ping
```

**期待される結果**:
```
raspberrypi5 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
raspberrypi4 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
raspberrypi3 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
```

**接続が失敗する場合**:
- `inventory.yml`のIPアドレスが正しいか確認
- Pi5からPi4/3へのSSH接続が成功するか確認（Step 5）
- Pi4/3のSSHサーバーが起動しているか確認

### Step 8: 動作確認

**Macから一括更新スクリプトを実行**:

```bash
# Macのターミナルで実行
cd /Users/tsudatakashi/RaspberryPiSystem_002
export RASPI_SERVER_HOST="denkon5sd02@192.168.10.230"
./scripts/update-all-clients.sh
```

**期待される結果**:
```
PLAY RECAP *********************************************************************
raspberrypi5               : ok=XX    changed=X    unreachable=0    failed=0
raspberrypi4               : ok=XX    changed=X    unreachable=0    failed=0
raspberrypi3                : ok=XX    changed=X    unreachable=0    failed=0
```

## よくある問題と解決方法

### 問題1: Pi5上のinventory.ymlが更新されない

**症状**:
- Mac側の`inventory.yml`は更新したが、Pi5上のファイルが古いIPアドレスのまま
- Ansible接続テストで古いIPアドレスに接続しようとする

**原因**:
- Pi5上の`inventory.yml`の所有者が`root`で、通常ユーザーでは書き込みできない

**解決方法**:
```bash
# Macから実行: sudoを使用してコピー
cat infrastructure/ansible/inventory.yml | ssh denkon5sd02@192.168.10.230 "sudo tee /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml > /dev/null && sudo chown denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml"
```

### 問題2: SSH接続がタイムアウトする

**症状**:
- `Connection timed out`エラーが発生する

**確認事項**:
1. IPアドレスが正しいか（`ping <ip>`で確認）
2. Raspberry Piが起動しているか
3. SSHサーバーが起動しているか（`sudo systemctl status ssh`）
4. ファイアウォール設定が正しいか

**解決方法**:
```bash
# Pi5/4/3で実行: SSHサーバーの状態確認
sudo systemctl status ssh

# SSHサーバーが停止している場合
sudo systemctl start ssh
sudo systemctl enable ssh
```

### 問題3: SSH鍵認証が失敗する

**症状**:
- `Permission denied (publickey,password)`エラーが発生する

**確認事項**:
1. 公開鍵が正しく追加されているか（`~/.ssh/authorized_keys`を確認）
2. 権限が正しいか（`~/.ssh`は700、`authorized_keys`は600）
3. ユーザー名が正しいか（`inventory.yml`を確認）

**解決方法**:
```bash
# Pi4/3で実行: 公開鍵と権限を確認
ls -la ~/.ssh/
cat ~/.ssh/authorized_keys

# 権限が正しくない場合
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys

# 公開鍵が追加されていない場合
# Pi5から公開鍵を追加（Step 6を参照）
```

### 問題4: Ansible接続テストで古いIPアドレスに接続しようとする

**症状**:
- Mac側の`inventory.yml`は更新したが、Ansibleが古いIPアドレスに接続しようとする

**原因**:
- Pi5上の`inventory.yml`が更新されていない

**解決方法**:
- Step 4を実行してPi5上の`inventory.yml`を更新してください

## 実例: 自宅ネットワーク → オフィスネットワークへの変更

### 変更前（自宅ネットワーク）

```
Raspberry Pi 5: 192.168.128.131
Raspberry Pi 4: 192.168.128.102
Raspberry Pi 3: 192.168.128.152
```

### 変更後（オフィスネットワーク）

```
Raspberry Pi 5: 192.168.10.230
Raspberry Pi 4: 192.168.10.223
Raspberry Pi 3: 192.168.10.109
```

### 実施した手順（2025-12-01）

1. **IPアドレスの確認**: 各Raspberry Piで`hostname -I`を実行して新しいIPアドレスを確認
2. **Mac側のinventory.yml更新**: 新しいIPアドレスに更新
3. **Pi5上のinventory.yml更新**: `sudo tee`を使用してコピー（権限問題を解決）
4. **SSH接続確認**: Pi5からPi4/3への接続を確認（既にSSH鍵が設定済み）
5. **Ansible接続テスト**: 全ホストに接続成功を確認

**所要時間**: 約10分

## チェックリスト

環境構築が完了したら、以下のチェックリストを確認してください：

- [ ] MacからPi5にSSH接続できる
- [ ] Pi5からPi4/3にSSH接続できる（SSH鍵認証）
- [ ] Mac側の`inventory.yml`が新しいIPアドレスに更新されている
- [ ] Pi5上の`inventory.yml`が新しいIPアドレスに更新されている
- [ ] Ansible接続テストが成功する（`ansible all -m ping`）
- [ ] 一括更新スクリプトが正常に動作する（`./scripts/update-all-clients.sh`）

## 関連ドキュメント

- [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md): SSH接続の構成と説明
- [SSH鍵ベース運用ガイド](./ssh-setup.md): Pi5からPi4/3へのSSH鍵設定手順
- [クイックスタートガイド](./quick-start-deployment.md): 一括更新の実行方法
- [MacからRaspberry Pi 5へのSSH接続ガイド](./mac-ssh-access.md): MacからPi5への接続設定

## 更新履歴

- 2025-12-01: 初版作成（自宅ネットワーク → オフィスネットワークへの変更手順を記録）

