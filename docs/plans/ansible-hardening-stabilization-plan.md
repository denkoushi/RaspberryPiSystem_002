---
title: Ansible堅牢化・安定化計画
tags: [Ansible, 堅牢化, 安定化, 設定管理]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [production-deployment-management-plan.md, ansible-error-handling.md]
category: plans
update-frequency: high
---

# Ansible堅牢化・安定化計画

最終更新: 2025-12-01

## 概要

本計画では、Ansible実装以降に発生した深刻な不具合（`git clean`による設定ファイル削除、polkit設定ファイルの削除など）を踏まえ、Ansibleの堅牢化・安定化を実現します。

## 背景と問題点

### 発生した不具合

1. **`git clean -fd`による設定ファイル削除**
   - `storage/`と`certs/`が削除された（写真ファイル、PDFファイル、自己署名証明書が消失）
   - `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`が削除され、NFCリーダーが使用不能に

2. **システム設定ファイルの管理不足**
   - polkit設定ファイルがAnsibleで管理されていない
   - その他の`/etc/`配下の設定ファイルの管理方針が不明確

3. **`git clean`のリスク**
   - `.gitignore`に含まれていないファイルが削除される
   - `/etc/`配下の設定ファイルは`.gitignore`では保護できない

## 目標

1. **システム設定ファイルのAnsible管理化**
   - polkit設定ファイルをAnsibleで管理
   - その他の`/etc/`配下の設定ファイルもAnsibleで管理

2. **`git clean`の安全化**
   - 削除対象を明確化
   - システム設定ファイルを保護

3. **Ansibleの堅牢化**
   - エラーハンドリングの強化
   - ロールバック機能の実装
   - 設定ファイルのバックアップ機能

4. **ドキュメント化**
   - Ansibleで管理すべき設定ファイルの一覧
   - `git clean`のリスクと対策
   - トラブルシューティング手順

## 実装計画

### Phase 1: 現状把握と体系化 ✅ 進行中

**目標**: Ansibleで管理すべき設定ファイルを明確化

**作業内容**:
1. システム設定ファイルの一覧作成
2. Ansibleで管理すべき設定ファイルの特定
3. 管理方針の明確化

**成果物**:
- `docs/guides/ansible-managed-files.md` - Ansibleで管理すべき設定ファイルの一覧

**完了条件**:
- すべてのシステム設定ファイルが一覧化されている
- 管理方針が明確化されている

### Phase 2: `git clean`の安全化

**目標**: `git clean`による設定ファイル削除を防止

**作業内容**:
1. `git clean`コマンドの改善
2. 除外リストの明確化
3. 安全なクリーンアップ手順の確立

**成果物**:
- `infrastructure/ansible/playbooks/update-clients.yml` - 改善された`git clean`コマンド
- `docs/guides/git-clean-safety.md` - `git clean`の安全な使用方法

**完了条件**:
- `git clean`がシステム設定ファイルを削除しない
- 除外リストが明確化されている

### Phase 3: システム設定ファイルのAnsible管理化

**目標**: システム設定ファイルをAnsibleで管理

**作業内容**:
1. polkit設定ファイルのAnsible管理化
2. その他のシステム設定ファイルのAnsible管理化
3. 設定ファイルのテンプレート化

**成果物**:
- `infrastructure/ansible/playbooks/manage-system-configs.yml` - システム設定ファイル管理プレイブック
- `infrastructure/ansible/templates/polkit-50-pcscd-allow-all.rules.j2` - polkit設定ファイルテンプレート

**完了条件**:
- polkit設定ファイルがAnsibleで管理されている
- 設定ファイルが削除されても自動復旧できる

### Phase 4: エラーハンドリングとロールバック機能

**目標**: エラー時の自動復旧機能を実装

**作業内容**:
1. エラーハンドリングの強化
2. ロールバック機能の実装
3. 設定ファイルのバックアップ機能

**成果物**:
- `infrastructure/ansible/playbooks/rollback.yml` - ロールバックプレイブック
- `scripts/ansible-backup-configs.sh` - 設定ファイルバックアップスクリプト

**完了条件**:
- エラー時に自動的にロールバックできる
- 設定ファイルのバックアップが自動化されている

### Phase 5: ドキュメント化とナレッジベース更新

**目標**: 進捗とナレッジをドキュメントに反映

**作業内容**:
1. ナレッジベースの更新
2. トラブルシューティング手順の追加
3. ベストプラクティスの文書化

**成果物**:
- `docs/knowledge-base/infrastructure.md` - KB-061追加（Ansible堅牢化）
- `docs/guides/ansible-best-practices.md` - Ansibleベストプラクティス

**完了条件**:
- すべての進捗がナレッジベースに反映されている
- トラブルシューティング手順が明確化されている

## 実装詳細

### 1. Ansibleで管理すべき設定ファイルの一覧

#### システム設定ファイル（`/etc/`配下）

| ファイルパス | 説明 | 優先度 | 状態 |
|------------|------|--------|------|
| `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules` | polkit設定（NFCリーダーアクセス許可） | 高 | 未管理 |
| `/etc/systemd/system/status-agent.service` | status-agent systemdサービス | 高 | ✅ 管理済み |
| `/etc/systemd/system/status-agent.timer` | status-agent systemdタイマー | 高 | ✅ 管理済み |
| `/etc/raspi-status-agent.conf` | status-agent設定ファイル | 高 | ✅ 管理済み |
| `/etc/systemd/system/kiosk-browser.service` | キオスクブラウザ systemdサービス | 中 | 未管理 |
| `/etc/systemd/system/signage-lite.service` | サイネージ systemdサービス | 中 | 未管理 |

#### アプリケーション設定ファイル

| ファイルパス | 説明 | 優先度 | 状態 |
|------------|------|--------|------|
| `/opt/RaspberryPiSystem_002/apps/api/.env` | API環境変数 | 高 | 未管理 |
| `/opt/RaspberryPiSystem_002/apps/web/.env` | Web環境変数 | 高 | 未管理 |
| `/opt/RaspberryPiSystem_002/clients/nfc-agent/.env` | NFCエージェント環境変数 | 高 | 未管理 |
| `/opt/RaspberryPiSystem_002/infrastructure/docker/.env` | Docker Compose環境変数 | 高 | 未管理 |

### 2. `git clean`の安全化

#### 現在の実装

```yaml
- name: Clean untracked files before checkout (excluding storage and certs)
  ansible.builtin.shell: |
    set -euo pipefail
    cd {{ repo_path }} && git clean -fd -e storage/ -e 'storage/**' -e certs/ -e 'certs/**' || true
```

#### 改善案

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
```

**注意**: `/etc/`配下の設定ファイルはGitリポジトリ外にあるため、`git clean`では削除されない。しかし、Ansibleで管理することで、削除されても自動復旧できる。

### 3. システム設定ファイルのAnsible管理化

#### polkit設定ファイルの管理

**テンプレートファイル**: `infrastructure/ansible/templates/polkit-50-pcscd-allow-all.rules.j2`

```javascript
polkit.addRule(function(action, subject) {
    if (action.id == "org.debian.pcsc-lite.access_pcsc" || action.id == "org.debian.pcsc-lite.access_card") {
        return polkit.Result.YES;
    }
});
```

**プレイブックタスク**:

```yaml
- name: Ensure polkit rules directory exists
  ansible.builtin.file:
    path: /etc/polkit-1/rules.d
    state: directory
    mode: '0755'

- name: Deploy polkit rule for pcscd access
  ansible.builtin.template:
    src: polkit-50-pcscd-allow-all.rules.j2
    dest: /etc/polkit-1/rules.d/50-pcscd-allow-all.rules
    owner: root
    group: root
    mode: '0644'
  notify: restart pcscd
```

### 4. エラーハンドリングとロールバック機能

#### 設定ファイルのバックアップ

**バックアップスクリプト**: `scripts/ansible-backup-configs.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/opt/backups/configs"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# polkit設定ファイルのバックアップ
if [ -f /etc/polkit-1/rules.d/50-pcscd-allow-all.rules ]; then
  cp /etc/polkit-1/rules.d/50-pcscd-allow-all.rules \
     "$BACKUP_DIR/polkit-50-pcscd-allow-all.rules.$DATE"
fi

# systemdサービスのバックアップ
for service in status-agent.service status-agent.timer kiosk-browser.service signage-lite.service; do
  if [ -f "/etc/systemd/system/$service" ]; then
    cp "/etc/systemd/system/$service" \
       "$BACKUP_DIR/$service.$DATE"
  fi
done

echo "Backup completed: $BACKUP_DIR"
```

#### ロールバックプレイブック

**プレイブック**: `infrastructure/ansible/playbooks/rollback.yml`

```yaml
- name: Rollback system configuration files
  hosts: clients
  become: true
  tasks:
    - name: Find latest backup
      ansible.builtin.find:
        paths: /opt/backups/configs
        patterns: "*.rules.*"
        file_type: file
      register: backup_files

    - name: Restore polkit configuration
      ansible.builtin.copy:
        src: "{{ item.path }}"
        dest: /etc/polkit-1/rules.d/50-pcscd-allow-all.rules
        owner: root
        group: root
        mode: '0644'
      loop: "{{ backup_files.files | sort(attribute='mtime', reverse=true) | list | first }}"
      when: backup_files.matched > 0
```

## 成功条件（Definition of Done）

1. ✅ **Phase 1完了**: Ansibleで管理すべき設定ファイルの一覧が作成されている
2. ⏳ **Phase 2完了**: `git clean`がシステム設定ファイルを削除しない
3. ⏳ **Phase 3完了**: polkit設定ファイルがAnsibleで管理されている
4. ⏳ **Phase 4完了**: エラー時に自動的にロールバックできる
5. ⏳ **Phase 5完了**: すべての進捗がナレッジベースに反映されている

## リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| 設定ファイルの誤削除 | 高 | Ansibleで管理し、削除されても自動復旧 |
| `git clean`の誤実行 | 高 | 除外リストを明確化し、安全なクリーンアップ手順を確立 |
| ロールバック機能の不具合 | 中 | バックアップ機能を実装し、手動復旧も可能にする |
| 設定ファイルの不整合 | 中 | テンプレート化し、バージョン管理を徹底 |

## 関連ドキュメント

- [プロダクション環境デプロイメント管理計画](./production-deployment-management-plan.md)
- [Ansibleエラーハンドリングガイド](../guides/ansible-error-handling.md)
- [トラブルシューティングナレッジベース](../knowledge-base/infrastructure.md)

## 更新履歴

- 2025-12-01: 初版作成

