---
title: Ansibleベストプラクティス
tags: [Ansible, ベストプラクティス, 運用]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [ansible-hardening-stabilization-plan.md, ansible-managed-files.md, ansible-error-handling.md]
category: guides
update-frequency: medium
---

# Ansibleベストプラクティス

最終更新: 2025-12-06

## 概要

本ドキュメントでは、RaspberryPiSystem_002プロジェクトにおけるAnsibleのベストプラクティスを説明します。

## 基本原則

### 1. 設定ファイルの一元管理

**原則**: すべてのシステム設定ファイルはAnsibleで管理する

**理由**:
- 設定ファイルの削除や変更による障害を防止
- 設定の一貫性と再現性を確保
- バックアップからの自動復旧が可能

**実装**:
- システム設定ファイル（`/etc/`配下）は`manage-system-configs.yml`で管理
- アプリケーション設定ファイル（`.env`など）は`manage-app-configs.yml`で管理（将来実装予定）

### 2. `git clean`の安全な使用

**原則**: `git clean`を実行する前に、保護が必要なディレクトリを明示的に除外する

**保護対象ディレクトリ**:
- `storage/` - ユーザーアップロードファイル（写真、PDFなど）
- `certs/` - SSL証明書
- `alerts/` - アラートファイル
- `logs/` - ログファイル

**実装例**:
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
```

### 3. バックアップの自動化

**原則**: 設定ファイルの変更前にバックアップを取得する

**実装**:
- `scripts/ansible-backup-configs.sh`でバックアップを取得
- バックアップは`/opt/backups/configs/`に保存
- タイムスタンプ付きファイル名で管理

**使用方法**:
```bash
# リモートホストでバックアップを取得
./scripts/ansible-backup-configs.sh tools03@192.168.128.102
```

### 4. ロールバック機能の実装

**原則**: エラー時に自動的にロールバックできる仕組みを用意する

**実装**:
- `infrastructure/ansible/playbooks/rollback.yml`でロールバックを実行
- 最新のバックアップから設定ファイルを復旧

**使用方法**:
```bash
ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/rollback.yml
```

### 5. エラーハンドリングの徹底

**原則**: すべてのタスクでエラーハンドリングを実装する

**実装例**:
```yaml
- name: Deploy configuration file
  ansible.builtin.template:
    src: template.j2
    dest: /etc/config.conf
  register: deploy_result
  failed_when: false
  changed_when: deploy_result.rc == 0

- name: Verify deployment
  ansible.builtin.stat:
    path: /etc/config.conf
  register: config_stat
  failed_when: not config_stat.stat.exists
```

## プレイブック作成のガイドライン

### 1. タスクの構造化

**推奨構造**:
```yaml
---
- name: Playbook description
  hosts: target_hosts
  gather_facts: true
  become: true
  
  pre_tasks:
    - name: Pre-requisite checks
      # ...
  
  tasks:
    - name: Main task 1
      # ...
    
    - name: Main task 2
      # ...
  
  post_tasks:
    - name: Verification
      # ...
  
  handlers:
    - name: restart service
      # ...
```

### 2. 変数の使用

**推奨事項**:
- プレイブックの先頭で変数を定義
- デフォルト値を設定
- 環境ごとの差異は変数で管理

**実装例**:
```yaml
vars:
  repo_path: /opt/RaspberryPiSystem_002
  backup_dir: /opt/backups/configs
  service_name: "{{ item }}"
```

### 3. 条件分岐の明確化

**推奨事項**:
- `when`条件を明確に記述
- 複雑な条件は`set_fact`で変数化

**実装例**:
```yaml
- name: Check if service exists
  ansible.builtin.stat:
    path: /etc/systemd/system/{{ service_name }}.service
  register: service_stat

- name: Restart service
  ansible.builtin.systemd:
    name: "{{ service_name }}"
    state: restarted
  when: service_stat.stat.exists
```

### 4. ハンドラーの適切な使用

**推奨事項**:
- サービス再起動などはハンドラーで実装
- ハンドラーは必要な場合のみ実行されるように条件を設定

**実装例**:
```yaml
handlers:
  - name: restart pcscd
    ansible.builtin.systemd:
      name: pcscd
      state: restarted
    when: ansible_facts.services['pcscd.service'] is defined
```

## 運用のベストプラクティス

### 1. デプロイ前のリソース確保（重要）

**原則**: リソース制約のある環境（特にPi3）では、デプロイ前に不要なサービスを停止する

**理由**:
- Pi3はメモリが少ない（1GB、実質416MB）
- サイネージサービスが動作していると、デプロイ時の`systemd`モジュール実行時にメモリ不足でハングする可能性がある
- `apt`パッケージマネージャーの実行時にもリソースを消費する

**実装手順**:
```bash
# 1. サイネージサービスを停止（Pi3の場合）
ssh signageras3@<pi3_ip> 'sudo systemctl stop signage-lite.service signage-lite-update.timer'

# 2. メモリ使用状況を確認（120MB以上空きがあることを確認）
ssh signageras3@<pi3_ip> 'free -m'

# 3. 既存のAnsibleプロセスをkill（重複実行防止）
ssh denkon5sd02@<pi5_ip> 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ'

# 4. デプロイ実行
cd /opt/RaspberryPiSystem_002/infrastructure/ansible
ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
  ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3

# 5. デプロイ完了後、サービスを再起動
ssh signageras3@<pi3_ip> 'sudo systemctl start signage-lite.service signage-lite-update.timer'
```

**注意事項**:
- デプロイ前に必ずサービスを停止する（約束を守る）
- メモリ使用状況を確認し、十分な空き容量を確保する
- デプロイ前に既存のAnsibleプロセスをkillし、重複実行を防止する
- デプロイ完了後、サービスを再起動する

**関連ナレッジ**: [KB-086](../knowledge-base/infrastructure.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題)

### 2. プレイブック実行前の確認

**推奨手順**:
1. `--check`モードで実行して変更内容を確認
2. `--diff`オプションで差分を確認
3. 問題がなければ実際に実行

**実装例**:
```bash
# ドライランで確認
ansible-playbook -i inventory.yml playbook.yml --check --diff

# 実際に実行
ansible-playbook -i inventory.yml playbook.yml
```

### 2. ログの記録

**推奨事項**:
- プレイブック実行時にログを記録
- エラー発生時の原因特定に役立つ

**実装例**:
```bash
ansible-playbook -i inventory.yml playbook.yml \
  | tee logs/ansible-$(date +%Y%m%d-%H%M%S).log
```

### 3. インベントリの管理

**推奨事項**:
- インベントリファイルはバージョン管理する
- 環境ごとにインベントリを分ける
- 変数はインベントリで管理

**実装例**:
```yaml
# inventory.yml
all:
  children:
    server:
      hosts:
        raspberrypi5:
          ansible_host: 192.168.128.131
    clients:
      hosts:
        raspberrypi4:
          ansible_host: 192.168.128.102
          status_agent_client_id: raspberrypi4-kiosk1
```

### 4. テストの実施

**推奨事項**:
- 新しいプレイブックはテスト環境で検証
- 実機検証を実施してから本番環境に適用

**実装例**:
```bash
# テスト環境で実行
ansible-playbook -i inventory-test.yml playbook.yml

# 実機検証
ansible-playbook -i inventory.yml playbook.yml --check --diff
```

## トラブルシューティング

### 1. プレイブック実行時のエラー

**確認項目**:
- SSH接続が確立されているか
- 必要な権限があるか（`become: true`が必要な場合）
- 変数が正しく設定されているか

**対処方法**:
```bash
# SSH接続確認
ansible all -i inventory.yml -m ping

# 変数の確認
ansible-playbook -i inventory.yml playbook.yml --check -v
```

### 2. テンプレートファイルが見つからない

**確認項目**:
- テンプレートファイルのパスが正しいか
- `playbook_dir`を使用してパスを解決しているか

**対処方法**:
```yaml
# 推奨: playbook_dirを使用
src: "{{ playbook_dir }}/../templates/template.j2"

# 非推奨: 絶対パス
src: /opt/RaspberryPiSystem_002/infrastructure/ansible/templates/template.j2
```

### 3. サービスが存在しない場合のエラー

**確認項目**:
- サービスが存在するか確認
- `service_facts`でサービス情報を取得

**対処方法**:
```yaml
- name: Gather service facts
  ansible.builtin.service_facts:

- name: Restart service
  ansible.builtin.systemd:
    name: service_name
    state: restarted
  when: ansible_facts.services['service_name.service'] is defined
```

## 関連ドキュメント

- [Ansible堅牢化・安定化計画](../plans/ansible-hardening-stabilization-plan.md)
- [Ansibleで管理すべき設定ファイル一覧](./ansible-managed-files.md)
- [Ansibleエラーハンドリングガイド](./ansible-error-handling.md)
- [Ansible関連の進捗と残タスク](../plans/ansible-progress-summary.md)

## 更新履歴

- 2025-12-06: デプロイ前のリソース確保セクションを追加（KB-086参照）
- 2025-12-01: 初版作成

