---
title: Ansible SSH接続アーキテクチャの説明
tags: [Ansible, SSH, アーキテクチャ, 運用]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [ssh-setup.md, quick-start-deployment.md, ansible-improvement-plan.md]
category: guides
update-frequency: medium
---

# Ansible SSH接続アーキテクチャの説明

最終更新: 2025-12-27（KB-098参照追加）

## 概要

本ドキュメントでは、Ansibleを使用した一括更新システムにおけるSSH接続の構成と、なぜMacから直接Raspberry Pi 3/4に接続する必要がないのかを説明します。

## 接続構成図

```
┌─────────────┐
│     Mac     │
│  (開発者PC) │
└──────┬──────┘
       │ SSH接続
       │ (denkon5sd02@192.168.10.230)
       ▼
┌─────────────────┐
│  Raspberry Pi 5 │
│    (サーバー)    │
│                 │
│  ┌───────────┐  │
│  │  Ansible  │  │
│  └─────┬─────┘  │
└────────┼────────┘
         │ SSH接続（Ansible経由）
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌─────────┐ ┌─────────┐
│Pi4/3    │ │Pi4/3    │
│(クライアント)│ │(クライアント)│
└─────────┘ └─────────┘
```

## 重要なポイント

### ✅ MacからPi3/4への直接接続は不要

**理由**:
- Macからは**Pi5にのみSSH接続**します
- Pi5上でAnsibleが実行され、Pi5からPi3/4にSSH接続して更新を実行します
- Macから直接Pi3/4に接続する必要はありません

**実際の動作**:
```bash
# Macのターミナルで実行
export RASPI_SERVER_HOST="denkon5sd02@192.168.10.230"
./scripts/update-all-clients.sh

# 内部的な動作:
# 1. Mac → Pi5にSSH接続
# 2. Pi5上で ansible-playbook を実行
# 3. Pi5 → Pi3/4にSSH接続（Ansible経由）
# 4. Pi3/4で更新を実行
```

### ✅ Pi5からPi3/4へのSSH接続が必要

**理由**:
- AnsibleはPi5からPi3/4にSSH接続して、更新コマンドを実行します
- この接続には**SSH鍵認証**が推奨されます（パスワード認証でも動作しますが、自動化のためには鍵認証が便利）

**SSH鍵設定の目的**:
- Pi5からPi3/4への接続を自動化するため
- パスワード入力なしで更新を実行できるようにするため
- セキュリティを向上させるため（パスワード認証を無効化可能）

## 接続の種類と目的

| 接続 | 必要？ | 目的 | 設定方法 |
|------|--------|------|----------|
| **Mac → Pi5** | ✅ 必要 | 更新スクリプトの実行 | [mac-ssh-access.md](./mac-ssh-access.md) |
| **Pi5 → Pi3/4** | ✅ 必要 | Ansibleによる一括更新 | [ssh-setup.md](./ssh-setup.md) |
| **Mac → Pi3/4** | ❌ 不要 | 直接接続は不要 | - |

## SSH鍵設定の手順

### 前提条件

- MacからPi5にSSH接続できること
- Pi5からPi3/4にパスワード認証でSSH接続できること（初回設定時）

### 手順1: Pi5からPi3/4へのSSH鍵設定

**Pi5に接続して実行**:
```bash
# Pi5にSSH接続
ssh denkon5sd02@192.168.10.230

# Pi5上で実行: Pi4に公開鍵を追加
ssh-copy-id -i ~/.ssh/id_ed25519.pub tools03@192.168.10.223
# パスワード入力が必要（初回のみ）

# Pi5上で実行: Pi3に公開鍵を追加
ssh-copy-id -i ~/.ssh/id_ed25519.pub signageras3@192.168.10.109
# パスワード入力が必要（初回のみ）
```

**または、手動で公開鍵を追加**:
```bash
# Pi5の公開鍵を表示
cat ~/.ssh/id_ed25519.pub

# Pi4に接続して公開鍵を追加
ssh tools03@192.168.10.223
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
exit

# Pi3に接続して公開鍵を追加
ssh signageras3@192.168.10.109
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..." >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
exit
```

### 手順2: 接続テスト

**Pi5から接続テスト**:
```bash
# Pi5に接続
ssh denkon5sd02@192.168.10.230

# Pi5上で実行: Pi4への接続テスト
ssh -o StrictHostKeyChecking=no tools03@192.168.10.223 "echo 'Pi4接続成功' && hostname"

# Pi5上で実行: Pi3への接続テスト
ssh -o StrictHostKeyChecking=no signageras3@192.168.10.109 "echo 'Pi3接続成功' && hostname"
```

**Ansible接続テスト**:
```bash
# Macのターミナルで実行
export RASPI_SERVER_HOST="denkon5sd02@192.168.10.230"
ssh denkon5sd02@192.168.10.230 "cd /opt/RaspberryPiSystem_002 && ansible all -i infrastructure/ansible/inventory.yml -m ping"
```

## よくある質問

### Q1: MacからPi3/4に直接SSH接続する必要はありますか？

**A**: いいえ、必要ありません。MacからはPi5にのみ接続し、Pi5経由でAnsibleがPi3/4を更新します。

### Q2: Pi5からPi3/4へのSSH接続は必須ですか？

**A**: はい、必須です。AnsibleがPi5からPi3/4にSSH接続して更新を実行します。

### Q3: SSH鍵認証は必須ですか？

**A**: 必須ではありませんが、**強く推奨**します。理由：
- パスワード入力なしで自動更新が可能
- セキュリティが向上（パスワード認証を無効化可能）
- 運用が簡単になる

### Q4: パスワード認証でも動作しますか？

**A**: はい、動作します。ただし、Ansible実行時にパスワード入力が必要になるため、自動化には不向きです。

### Q5: 昨日の自宅環境ではPi3/4に直接接続していなかったのはなぜですか？

**A**: 正しい理解です。MacからPi5に接続し、Pi5経由でAnsibleがPi3/4を更新する構成のため、MacからPi3/4への直接接続は不要です。

## トラブルシューティング

### Pi5からPi3/4への接続が失敗する場合

**確認事項**:
1. Pi3/4のIPアドレスが正しいか（`inventory.yml`を確認）
2. Pi3/4のSSHサーバーが起動しているか
3. 公開鍵が正しく追加されているか（`~/.ssh/authorized_keys`を確認）
4. 権限が正しいか（`~/.ssh`は700、`authorized_keys`は600）

**解決方法**:
```bash
# Pi5から接続テスト（詳細モード）
ssh -v tools03@192.168.10.223

# Pi4側でSSH設定を確認
ssh tools03@192.168.10.223
ls -la ~/.ssh/
cat ~/.ssh/authorized_keys
```

### Ansible接続が失敗する場合

**確認事項**:
1. `inventory.yml`のIPアドレスとユーザー名が正しいか
2. Pi5からPi3/4へのSSH接続が成功するか
3. Pi3/4のユーザーが`sudo`権限を持っているか

**解決方法**:
```bash
# Pi5からAnsible接続テスト
ssh denkon5sd02@192.168.10.230
cd /opt/RaspberryPiSystem_002
ansible all -i infrastructure/ansible/inventory.yml -m ping -vvv
```

## AnsibleとTailscale連携の詳細

### 変数展開の仕組み

Ansible Playbookで`hosts: "{{ client_host }}"`のように直接ホストを指定すると、以下のように変数が展開されます：

1. **Ansible Playbookの実行**:
   ```yaml
   hosts: "{{ client_host }}"  # 例: "raspberrypi4"
   ```

2. **inventory.ymlの参照**:
   ```yaml
   raspberrypi4:
     ansible_host: "{{ kiosk_ip }}"  # 変数参照
   ```

3. **group_vars/all.ymlの変数解決**:
   ```yaml
   network_mode: "tailscale"  # または "local"
   kiosk_ip: "{{ current_network.raspberrypi4_ip | default(local_network.raspberrypi4_ip) }}"
   ```

4. **最終的なIPアドレスの解決**:
   - `network_mode: "tailscale"`の場合: `tailscale_network.raspberrypi4_ip`（例: `100.74.144.79`）
   - `network_mode: "local"`の場合: `local_network.raspberrypi4_ip`（例: `192.168.10.224`）

### `hosts: localhost`の問題

`hosts: localhost`で実行すると、`group_vars/all.yml`の変数が読み込まれず、`ansible_host: "{{ kiosk_ip }}"`が展開されません。そのため、`hosts: "{{ client_host }}"`のように直接ホストを指定する必要があります。

### Dockerコンテナ内からのSSH接続

Dockerコンテナ内からSSH接続する場合は、SSH鍵をマウントする必要があります：

```yaml
# docker-compose.server.yml
volumes:
  - /home/denkon5sd02/.ssh:/root/.ssh:ro
```

これにより、Dockerコンテナ内からPi4へのSSH接続が可能になります。

**注意**: 
- クライアント端末バックアップ機能の実装時に、AnsibleとTailscaleの連携で問題が発生しました。詳細は [KB-102](../knowledge-base/infrastructure.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) を参照してください。
- **重要**: `inventory.yml`の`ansible_ssh_common_args`に`-o RequestTTY=force`を設定してはいけません。このオプションはAnsibleのsftpファイル転送と干渉し、ansible pingがタイムアウトする原因になります。詳細は [KB-098](../knowledge-base/infrastructure.md#kb-098-ansible_ssh_common_argsのrequestttyforceによるansible-pingタイムアウト) を参照してください。

## 関連ドキュメント

- [SSH鍵ベース運用ガイド](./ssh-setup.md): Pi5からPi3/4へのSSH鍵設定手順
- [MacからRaspberry Pi 5へのSSH接続ガイド](./mac-ssh-access.md): MacからPi5への接続設定
- [クイックスタートガイド](./quick-start-deployment.md): 一括更新の実行方法
- [Ansible改善計画](../plans/ansible-improvement-plan.md): Ansibleの堅牢化・安定化計画
- [KB-102](../knowledge-base/infrastructure.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題): AnsibleとTailscale連携の問題と対策

