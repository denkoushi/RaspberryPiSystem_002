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
# 出力されたIPアドレスをメモしてください

# Raspberry Pi 4で実行（VNC経由など）
hostname -I
# 出力されたIPアドレスをメモしてください

# Raspberry Pi 3で実行（VNC経由など）
hostname -I
# 出力されたIPアドレスをメモしてください
```

**または、管理画面で確認**:
- Raspberry Pi 5の管理画面（`https://<pi5-ip>/admin/clients`）でクライアントのIPアドレスを確認

### Step 2: MacからPi5へのSSH接続確認

**Macのターミナルで実行**:

```bash
# Pi5のTailscale IPで接続テスト（標準）
ssh denkon5sd02@100.106.158.2

# または、ローカルIPで接続テスト（緊急時のみ）
# ssh denkon5sd02@192.168.10.230

# 接続成功したら、Pi5のシェルが起動します
# 接続できない場合:
# 1. IPアドレスが正しいか確認
# 2. Pi5が起動しているか確認
# 3. SSHサーバーが起動しているか確認（Pi5で `sudo systemctl status ssh`）
# 4. Tailscaleが接続されているか確認（Pi5で `tailscale status`）
```

### Step 3: ネットワークモード設定（推奨方法）

**⚠️ 重要**: `inventory.yml`を直接編集するのではなく、`group_vars/all.yml`の`network_mode`設定を使用することを推奨します。これにより、ネットワーク環境に応じたIPアドレスの切り替えが自動的に行われます。

**Pi5上の`group_vars/all.yml`を更新**:

```bash
# Pi5上のgroup_vars/all.ymlを編集
ssh denkon5sd02@100.106.158.2 "nano /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

**更新内容**:

1. **ネットワークモードの選択**:
   ```yaml
   # 通常運用（標準）
   network_mode: "tailscale"
   
   # 緊急時のみ（Tailscale障害/認証不能時）
   network_mode: "local"
   ```

2. **ローカルネットワークIPの更新**（`network_mode: "local"`の場合）:
   ```yaml
   local_network:
     raspberrypi5_ip: "<hostname -Iで取得したPi5のIP>"
     raspberrypi4_ip: "<hostname -Iで取得したPi4のIP>"
     raspberrypi3_ip: "<hostname -Iで取得したPi3のIP>"
   ```

3. **Tailscale IPの確認**（`network_mode: "tailscale"`の場合）:
   ```yaml
   tailscale_network:
     raspberrypi5_ip: "100.106.158.2"    # Pi5のTailscale IP（通常は変更不要）
     raspberrypi4_ip: "100.74.144.79"   # Pi4のTailscale IP（通常は変更不要）
     raspberrypi3_ip: "100.105.224.86"  # Pi3のTailscale IP（通常は変更不要）
   ```

**確認**:
```bash
# Pi5上で確認
ssh denkon5sd02@100.106.158.2 "grep -A 3 'network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"

# 実際に使われるIPを確認
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && ansible raspberrypi4 -i infrastructure/ansible/inventory.yml -m debug -a 'var=kiosk_ip'"
```

**⚠️ 注意**: 
- `network_mode: "tailscale"`が標準です（通常運用）
- `network_mode: "local"`は緊急時のみ使用してください
- 設定が合っていないと、接続エラーが発生します

### Step 4: 旧方法（inventory.yml直接編集）

**⚠️ 非推奨**: 以下の方法は、`group_vars/all.yml`の`network_mode`設定を使用できない場合のみ使用してください。

**Mac側のinventory.ymlを更新**:

```bash
# Macのプロジェクトディレクトリで実行
cd /Users/tsudatakashi/RaspberryPiSystem_002
nano infrastructure/ansible/inventory.yml
```

**更新内容**:
- `ansible_host`: 各Raspberry Piの新しいIPアドレスに更新（変数参照`{{ kiosk_ip }}`などは変更不要）

**Pi5上のinventory.ymlの更新**:

```bash
# MacからPi5にinventory.ymlをコピー
cat infrastructure/ansible/inventory.yml | ssh denkon5sd02@100.106.158.2 "sudo tee /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml > /dev/null && sudo chown denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml"
```

### Step 5: Pi5からPi4/3へのSSH接続確認（network_mode設定後）

**Macのターミナルで実行**:

```bash
# Pi5からPi4への接続テスト（Tailscale IPを使用、標準）
ssh denkon5sd02@100.106.158.2 'ssh -o StrictHostKeyChecking=no tools03@100.74.144.79 "echo Pi4接続成功 && hostname"'

# Pi5からPi3への接続テスト（Tailscale IPを使用、標準）
ssh denkon5sd02@100.106.158.2 'ssh -o StrictHostKeyChecking=no signageras3@100.105.224.86 "echo Pi3接続成功 && hostname"'

# または、Ansible接続テスト（推奨、実際に使われるIPでテスト）
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && ansible all -i infrastructure/ansible/inventory.yml -m ping"
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
# Pi5に接続（実際のIPアドレスに置き換える）
# Tailscale経由の場合: ssh denkon5sd02@100.106.158.2
# ローカルネットワークの場合: ssh denkon5sd02@<pi5のIP>

# Pi5上で実行: Pi4に公開鍵を追加（実際のIPアドレスに置き換える）
ssh-copy-id -i ~/.ssh/id_ed25519.pub tools03@<pi4のIP>
# パスワード入力が必要（初回のみ）

# Pi5上で実行: Pi3に公開鍵を追加（実際のIPアドレスに置き換える）
ssh-copy-id -i ~/.ssh/id_ed25519.pub signageras3@<pi3のIP>
# パスワード入力が必要（初回のみ）
```

**既に公開鍵が設定されている場合**:
- `ssh-copy-id`を実行すると「All keys were skipped because they already exist」と表示されます
- これは正常です。接続テスト（Step 5）を実行してください

### Step 7: Ansible接続テスト

**Pi5上で実行**:

```bash
# Pi5に接続（実際のIPアドレスに置き換える）
# Tailscale経由の場合: ssh denkon5sd02@100.106.158.2
# ローカルネットワークの場合: ssh denkon5sd02@<pi5のIP>

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
# Tailscale経由の場合（標準）
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
# ローカルネットワークの場合（緊急時のみ）: export RASPI_SERVER_HOST="denkon5sd02@<pi5のIP>"
# inventory指定が必須（誤デプロイ防止）
# 第2工場（既存）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
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
# Macから実行: sudoを使用してコピー（実際のPi5のIPアドレスに置き換える）
# Tailscale経由の場合（標準）: ssh denkon5sd02@100.106.158.2
# ローカルネットワークの場合（緊急時のみ）: ssh denkon5sd02@<pi5のIP>
cat infrastructure/ansible/inventory.yml | ssh denkon5sd02@<pi5のIP> "sudo tee /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml > /dev/null && sudo chown denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml"
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
- Mac側の設定は更新したが、Ansibleが古いIPアドレスに接続しようとする

**原因**:
- Pi5上の`group_vars/all.yml`の`network_mode`設定が適切でない
- または、Pi5上の`group_vars/all.yml`の`local_network`設定が古い

**解決方法**:
- Step 3を実行してPi5上の`group_vars/all.yml`の`network_mode`とIP設定を更新してください
- `network_mode: "tailscale"`に設定することで、Tailscale IPが自動的に使われます（推奨）

## 実例: ネットワーク環境の変更

### 推奨方法: network_mode設定の変更

**自宅ネットワーク → オフィスネットワーク**:
```bash
# Pi5上のgroup_vars/all.ymlを編集
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"tailscale\"/network_mode: \"local\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"

# local_networkのIPを更新（必要に応じて）
ssh denkon5sd02@100.106.158.2 "nano /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

**オフィスネットワーク → 自宅ネットワーク/リモートアクセス**:
```bash
# Pi5上のgroup_vars/all.ymlを編集（推奨）
ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"local\"/network_mode: \"tailscale\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
```

### 旧方法: IPアドレスの直接変更

**⚠️ 注意**: ローカルIPはネットワーク環境によって変動します。`network_mode: "tailscale"`を使用することで、ネットワーク環境に依存しないデプロイが可能です。

**重要**: ローカルIPは環境ごとに異なります。実際のIPアドレスは`hostname -I`コマンドで確認してください。固定IPアドレスをドキュメントに記載しないよう注意してください。

### 実施した手順（2025-12-01）

1. **IPアドレスの確認**: 各Raspberry Piで`hostname -I`を実行して新しいIPアドレスを確認
2. **Mac側のinventory.yml更新**: 新しいIPアドレスに更新
3. **Pi5上のinventory.yml更新**: `sudo tee`を使用してコピー（権限問題を解決）
4. **SSH接続確認**: Pi5からPi4/3への接続を確認（既にSSH鍵が設定済み）
5. **Ansible接続テスト**: 全ホストに接続成功を確認

**所要時間**: 約10分

## チェックリスト

環境構築が完了したら、以下のチェックリストを確認してください：

- [ ] MacからPi5にSSH接続できる（Tailscale IPが標準）
- [ ] Pi5からPi4/3にSSH接続できる（SSH鍵認証）
- [ ] Pi5上の`group_vars/all.yml`の`network_mode`が適切に設定されている（`local`または`tailscale`）
- [ ] Pi5上の`group_vars/all.yml`のIP設定が正しい（`local_network`または`tailscale_network`）
- [ ] Ansible接続テストが成功する（`ansible all -m ping`）
- [ ] 一括更新スクリプトが正常に動作する（`./scripts/update-all-clients.sh`）
- [ ] **Pi5のDockerコンテナが再ビルドされている**（ネットワーク変更時は自動検出・再ビルド）
- [ ] **Pi3のsignage-update.shが新しいIPアドレスに更新されている**（Ansibleで自動更新）
- [ ] Pi3のサイネージが最新画像を表示している
- [ ] Pi4のキオスクが正しいモード（PHOTO/TAG）で動作している

## 関連ドキュメント

- [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md): SSH接続の構成と説明
- [SSH鍵ベース運用ガイド](./ssh-setup.md): Pi5からPi4/3へのSSH鍵設定手順
- [クイックスタートガイド](./quick-start-deployment.md): 一括更新の実行方法
- [デプロイメントガイド](./deployment.md): 詳細なデプロイ手順とネットワークモード設定
- [MacからRaspberry Pi 5へのSSH接続ガイド](./mac-ssh-access.md): MacからPi5への接続設定

## 更新履歴

- 2025-12-01: 初版作成（自宅ネットワーク → オフィスネットワークへの変更手順を記録）

