---
title: Ansibleエラーハンドリングガイド
tags: [Ansible, エラーハンドリング, トラブルシューティング]
audience: [運用者, 開発者]
last-verified: 2025-12-01
related: [quick-start-deployment.md, operation-manual.md]
category: guides
update-frequency: medium
---

# Ansibleエラーハンドリングガイド

最終更新: 2025-12-27（KB-098参照追加）

## 概要

本ガイドでは、Ansibleプレイブック実行時のエラーハンドリングとトラブルシューティング方法を説明します。

## エラーハンドリングの改善点

### 1. エラー詳細ログの出力

Ansibleプレイブックは、実行結果を詳細に記録します：

- **失敗したホストの特定**: `ansible_failed_hosts`で失敗したホストを特定
- **到達不能ホストの特定**: `ansible_unreachable_hosts`で到達不能なホストを特定
- **デプロイメントサマリー**: 成功/失敗/到達不能の件数を表示

### 2. 更新スクリプトの改善

`scripts/update-all-clients.sh`は以下の機能を提供します：

- **エラーコードの返却**: 失敗時は適切なエラーコードを返却
- **サマリーファイルの生成**: JSON形式で実行結果を保存
- **失敗ホストの一覧**: 失敗したホストを特定可能

## 使用方法

### 更新スクリプトの実行

```bash
# Macから実行
export RASPI_SERVER_HOST="denkon5sd02@192.168.128.131"
./scripts/update-all-clients.sh
```

**実行結果の確認:**

```
[INFO] Deployment Summary:
{
  "timestamp": "20251201-103259",
  "logFile": "logs/ansible-update-20251201-103259.log",
  "totalHosts": 2,
  "failedHosts": [],
  "unreachableHosts": [],
  "success": true
}
```

### 更新ステータスの確認

```bash
# 最新のログからステータスを確認
./scripts/check-update-status.sh

# 特定のログファイルを指定
./scripts/check-update-status.sh ansible-update-20251201-103259.log
```

## エラーパターンと対応

### パターン1: SSH接続エラー / ansible pingタイムアウト

**症状**:
```
raspberrypi4 | UNREACHABLE! => {"msg": "Failed to connect to the host via ssh"}
# または
ansible pingが120秒でタイムアウト
```

**原因**:
- SSH鍵認証が設定されていない
- ネットワーク接続の問題
- ユーザー名が間違っている
- **`inventory.yml`の`ansible_ssh_common_args`に`RequestTTY=force`が設定されている**（[KB-098](../knowledge-base/infrastructure.md#kb-098-ansible_ssh_common_argsのrequestttyforceによるansible-pingタイムアウト)参照）

**対応**:
1. **直接SSH接続を確認**:
   ```bash
   ssh tools03@192.168.128.102
   ```
   - 直接SSHが成功する場合、`inventory.yml`の設定を確認

2. **直接IP指定でansible ping**:
   ```bash
   ansible all -i '100.105.224.86,' -u signageras3 -m ping
   ```
   - 直接IP指定で成功する場合、`inventory.yml`の`ansible_ssh_common_args`を確認

3. **インベントリファイルを確認**:
   ```bash
   cat infrastructure/ansible/inventory.yml | grep ansible_ssh_common_args
   ```
   - `RequestTTY=force`が設定されている場合は削除（[KB-098](../knowledge-base/infrastructure.md#kb-098-ansible_ssh_common_argsのrequestttyforceによるansible-pingタイムアウト)参照）

4. **Ansible接続テスト**:
   ```bash
   ansible all -i infrastructure/ansible/inventory.yml -m ping
   ```

### パターン2: Gitリポジトリ更新エラー

**症状**:
```
raspberrypi3 | FAILED! => {"msg": "Failed to update git repository"}
```

**原因**:
- Gitリポジトリが破損している
- ネットワーク接続の問題
- ディスク容量不足

**対応**:
1. クライアントに直接接続して確認:
   ```bash
   ssh signageras3@192.168.128.152
   cd /opt/RaspberryPiSystem_002
   git status
   ```

2. 手動でGitリポジトリを更新:
   ```bash
   git fetch origin
   git reset --hard origin/main
   ```

3. ディスク容量を確認:
   ```bash
   df -h
   ```

### パターン3: サービス再起動エラー

**症状**:
```
raspberrypi3 | FAILED! => {"msg": "Could not find the requested service"}
```

**原因**:
- サービスが存在しない
- サービス名が間違っている

**対応**:
1. 存在するサービスを確認:
   ```bash
   systemctl list-units --type=service --state=running | grep -E 'signage|kiosk'
   ```

2. プレイブックのサービスリストを確認:
   ```bash
   cat infrastructure/ansible/playbooks/update-clients.yml | grep -A 5 "services_to_restart"
   ```

3. 存在しないサービスは`ignore_errors: true`でスキップされる（正常動作）

## ログファイルの確認

### ログファイルの場所

- **Mac**: `logs/ansible-update-YYYYMMDD-HHMMSS.log`
- **サマリーファイル**: `logs/ansible-update-YYYYMMDD-HHMMSS.summary.json`

### ログファイルの検索

```bash
# エラーのみを抽出
grep -E "FAILED|UNREACHABLE|ERROR" logs/ansible-update-*.log

# 特定のホストのログを抽出
grep "raspberrypi3" logs/ansible-update-*.log

# 最新のログファイルを確認
ls -lt logs/ansible-update-*.log | head -1
```

## ベストプラクティス

### 1. 更新前の確認

```bash
# ドライランで確認
ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/update-clients.yml \
  --check
```

### 2. 段階的な更新

```bash
# 1台ずつ更新して確認
ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/update-clients.yml \
  --limit raspberrypi3
```

### 3. ログの保存

- ログファイルは自動的に`logs/`ディレクトリに保存されます
- 定期的に古いログファイルを削除してください（30日以上古いものなど）

### 4. エラー時の対応

1. **ログファイルを確認**: エラーの詳細を確認
2. **サマリーファイルを確認**: 失敗したホストを特定
3. **個別に確認**: 失敗したホストに直接接続して問題を確認
4. **修正後再実行**: 問題を修正してから再実行

## 関連ドキュメント

- [クイックスタートガイド](./quick-start-deployment.md)
- [運用マニュアル](./operation-manual.md)
- [トラブルシューティングナレッジベース](../knowledge-base/index.md)

