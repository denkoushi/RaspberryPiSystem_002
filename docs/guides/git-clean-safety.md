---
title: git cleanの安全な使用方法
tags: [Git, 安全運用, Ansible]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [ansible-hardening-stabilization-plan.md, ansible-managed-files.md]
category: guides
update-frequency: medium
---

# git cleanの安全な使用方法

最終更新: 2025-12-01

## 概要

本ドキュメントでは、`git clean`コマンドの安全な使用方法を説明します。

## `git clean`のリスク

### 削除されるファイル

`git clean -fd`を実行すると、以下のファイルが削除されます：
- Gitで追跡されていないファイル（untracked files）
- Gitで追跡されていないディレクトリ（untracked directories）

### 削除されないファイル

以下のファイルは削除されません：
- Gitで追跡されているファイル（tracked files）
- `.gitignore`に記載されているファイル（ただし、`-x`オプションを使用した場合は削除される）

### 注意点

**重要**: `/etc/`配下の設定ファイルはGitリポジトリ外にあるため、`git clean`では削除されません。しかし、Ansibleで管理することで、削除されても自動復旧できます。

## 安全な使用方法

### 1. ドライランで確認

**推奨手順**:
1. `--dry-run`オプションで削除候補を確認
2. 問題がなければ実際に実行

**実装例**:
```bash
# 削除候補を確認
git clean -fd --dry-run

# 実際に削除
git clean -fd
```

### 2. 保護が必要なディレクトリを除外

**保護対象ディレクトリ**:
- `storage/` - ユーザーアップロードファイル（写真、PDFなど）
- `certs/` - SSL証明書
- `alerts/` - アラートファイル
- `logs/` - ログファイル

**実装例**:
```bash
# 保護対象を除外して削除
git clean -fd \
  -e storage/ -e 'storage/**' \
  -e certs/ -e 'certs/**' \
  -e alerts/ -e 'alerts/**' \
  -e logs/ -e 'logs/**'
```

### 3. Ansibleプレイブックでの使用

**推奨実装**:
```yaml
- name: Clean untracked files before checkout (excluding protected directories)
  ansible.builtin.shell: |
    set -euo pipefail
    cd {{ repo_path }} && git clean -fd \
      -e storage/ -e 'storage/**' \
      -e certs/ -e 'certs/**' \
      -e alerts/ -e 'alerts/**' \
      -e logs/ -e 'logs/**' \
      || true
  args:
    executable: /bin/bash
  ignore_errors: true
  vars:
    # 注意: /etc/配下の設定ファイルはGitリポジトリ外にあるため、
    # git cleanでは削除されない。しかし、Ansibleで管理することで、
    # 削除されても自動復旧できる。
```

## `.gitignore`の設定

### 推奨設定

以下のディレクトリを`.gitignore`に追加することを推奨します：

```gitignore
# Storage (user-uploaded files)
storage/

# SSL certificates
certs/

# Alert files
alerts/

# Log files
logs/
```

### 注意点

**重要**: `.gitignore`に追加しても、`git clean -fd`では削除されません。`-x`オプションを使用した場合のみ削除されます。

## トラブルシューティング

### 1. 誤ってファイルを削除した場合

**対処方法**:
1. バックアップから復旧（`scripts/ansible-backup-configs.sh`でバックアップを取得している場合）
2. Ansibleプレイブックで再デプロイ（`manage-system-configs.yml`など）

**実装例**:
```bash
# バックアップから復旧
ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/rollback.yml

# または、Ansibleで再デプロイ
ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/manage-system-configs.yml
```

### 2. 保護対象ディレクトリが削除された場合

**確認項目**:
- `.gitignore`に追加されているか
- `git clean`コマンドで除外されているか

**対処方法**:
1. `.gitignore`に追加
2. `git clean`コマンドで除外オプションを追加

## ベストプラクティス

### 1. 常にドライランで確認

**推奨手順**:
```bash
# 1. ドライランで確認
git clean -fd --dry-run

# 2. 問題がなければ実際に実行
git clean -fd
```

### 2. 保護対象を明示的に除外

**推奨事項**:
- 保護が必要なディレクトリは常に除外オプションを指定
- コメントで理由を明記

### 3. Ansibleで管理

**推奨事項**:
- システム設定ファイルはAnsibleで管理
- 削除されても自動復旧できるようにする

## 関連ドキュメント

- [Ansible堅牢化・安定化計画](../plans/ansible-hardening-stabilization-plan.md)
- [Ansibleで管理すべき設定ファイル一覧](./ansible-managed-files.md)
- [Ansibleベストプラクティス](./ansible-best-practices.md)

## 更新履歴

- 2025-12-01: 初版作成

