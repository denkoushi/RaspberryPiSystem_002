---
title: Ansibleで管理すべき設定ファイル一覧
tags: [Ansible, 設定管理, システム設定]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [ansible-hardening-stabilization-plan.md, ansible-error-handling.md]
category: guides
update-frequency: high
---

# Ansibleで管理すべき設定ファイル一覧

最終更新: 2025-12-01

## 概要

本ドキュメントでは、Ansibleで管理すべき設定ファイルの一覧と管理方針を説明します。

## 管理方針

### 原則

1. **システム設定ファイルはAnsibleで管理**
   - `/etc/`配下の設定ファイルはAnsibleで管理し、削除されても自動復旧できるようにする
   - Gitリポジトリ外の設定ファイルもAnsibleで管理

2. **アプリケーション設定ファイルはテンプレート化**
   - `.env`ファイルなどはAnsibleテンプレートで管理
   - 環境ごとの差異は変数で管理

3. **バックアップ機能の実装**
   - 設定ファイルの変更前にバックアップを取得
   - ロールバック機能を実装

## システム設定ファイル（`/etc/`配下）

### 高優先度（必須管理）

#### 1. polkit設定ファイル

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules` |
| **説明** | NFCリーダー（pcscd）へのアクセス許可設定 |
| **管理方法** | Ansibleテンプレート |
| **テンプレート** | `infrastructure/ansible/templates/polkit-50-pcscd-allow-all.rules.j2` |
| **プレイブック** | `infrastructure/ansible/playbooks/manage-system-configs.yml` |
| **状態** | ⏳ 実装予定 |

**設定内容**:
```javascript
polkit.addRule(function(action, subject) {
    if (action.id == "org.debian.pcsc-lite.access_pcsc" || action.id == "org.debian.pcsc-lite.access_card") {
        return polkit.Result.YES;
    }
});
```

**重要性**: NFCリーダーが使用不能になるため、**必須管理**

#### 2. status-agent systemdサービス

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/etc/systemd/system/status-agent.service` |
| **説明** | status-agent systemdサービス定義 |
| **管理方法** | Ansibleコピー |
| **ソース** | `clients/status-agent/status-agent.service` |
| **プレイブック** | `infrastructure/ansible/playbooks/update-clients.yml` |
| **状態** | ✅ 管理済み |

#### 3. status-agent systemdタイマー

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/etc/systemd/system/status-agent.timer` |
| **説明** | status-agent systemdタイマー定義 |
| **管理方法** | Ansibleコピー |
| **ソース** | `clients/status-agent/status-agent.timer` |
| **プレイブック** | `infrastructure/ansible/playbooks/update-clients.yml` |
| **状態** | ✅ 管理済み |

#### 4. status-agent設定ファイル

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/etc/raspi-status-agent.conf` |
| **説明** | status-agent設定ファイル |
| **管理方法** | Ansibleテンプレート |
| **テンプレート** | `clients/status-agent/status-agent.conf.j2` |
| **プレイブック** | `infrastructure/ansible/playbooks/update-clients.yml` |
| **状態** | ✅ 管理済み |

### 中優先度（推奨管理）

#### 5. キオスクブラウザ systemdサービス

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/etc/systemd/system/kiosk-browser.service` |
| **説明** | キオスクブラウザ systemdサービス定義 |
| **管理方法** | Ansibleテンプレート |
| **テンプレート** | `infrastructure/ansible/templates/kiosk-browser.service.j2` |
| **プレイブック** | `infrastructure/ansible/playbooks/manage-system-configs.yml` |
| **状態** | ⏳ 実装予定 |

#### 6. サイネージ systemdサービス

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/etc/systemd/system/signage-lite.service` |
| **説明** | サイネージ systemdサービス定義 |
| **管理方法** | Ansibleテンプレート |
| **テンプレート** | `infrastructure/ansible/templates/signage-lite.service.j2` |
| **プレイブック** | `infrastructure/ansible/playbooks/manage-system-configs.yml` |
| **状態** | ⏳ 実装予定 |

## アプリケーション設定ファイル

### 高優先度（必須管理）

#### 1. API環境変数ファイル

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/opt/RaspberryPiSystem_002/apps/api/.env` |
| **説明** | API環境変数（JWTシークレット、データベース接続情報など） |
| **管理方法** | Ansibleテンプレート |
| **テンプレート** | `infrastructure/ansible/templates/api.env.j2` |
| **プレイブック** | `infrastructure/ansible/playbooks/manage-app-configs.yml` |
| **状態** | ⏳ 実装予定 |

#### 2. Web環境変数ファイル

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/opt/RaspberryPiSystem_002/apps/web/.env` |
| **説明** | Web環境変数（API URL、WebSocket URLなど） |
| **管理方法** | Ansibleテンプレート |
| **テンプレート** | `infrastructure/ansible/templates/web.env.j2` |
| **プレイブック** | `infrastructure/ansible/playbooks/manage-app-configs.yml` |
| **状態** | ⏳ 実装予定 |

#### 3. NFCエージェント環境変数ファイル

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/opt/RaspberryPiSystem_002/clients/nfc-agent/.env` |
| **説明** | NFCエージェント環境変数（API URL、クライアントキーなど） |
| **管理方法** | Ansibleテンプレート |
| **テンプレート** | `infrastructure/ansible/templates/nfc-agent.env.j2` |
| **プレイブック** | `infrastructure/ansible/playbooks/manage-app-configs.yml` |
| **状態** | ⏳ 実装予定 |

#### 4. Docker Compose環境変数ファイル

| 項目 | 内容 |
|------|------|
| **ファイルパス** | `/opt/RaspberryPiSystem_002/infrastructure/docker/.env` |
| **説明** | Docker Compose環境変数（IPアドレスなど） |
| **管理方法** | Ansibleテンプレート |
| **テンプレート** | `infrastructure/ansible/templates/docker.env.j2` |
| **プレイブック** | `infrastructure/ansible/playbooks/manage-app-configs.yml` |
| **状態** | ⏳ 実装予定 |

## 保護が必要なディレクトリ（`git clean`除外対象）

### 現在の除外対象

- `storage/` - ユーザーアップロードファイル（写真、PDFなど）
- `certs/` - SSL証明書

### 追加推奨除外対象

- `alerts/` - アラートファイル
- `logs/` - ログファイル

**注意**: `/etc/`配下の設定ファイルはGitリポジトリ外にあるため、`git clean`では削除されない。しかし、Ansibleで管理することで、削除されても自動復旧できる。

## 管理状況の確認方法

### システム設定ファイルの確認

```bash
# polkit設定ファイルの確認
ls -la /etc/polkit-1/rules.d/50-pcscd-allow-all.rules

# systemdサービスの確認
systemctl list-unit-files | grep -E 'status-agent|kiosk-browser|signage-lite'
```

### Ansibleでの管理状況確認

```bash
# プレイブックの実行（ドライラン）
ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/manage-system-configs.yml \
  --check --diff
```

## トラブルシューティング

### 設定ファイルが削除された場合

1. **Ansibleで自動復旧**:
   ```bash
   ansible-playbook -i infrastructure/ansible/inventory.yml \
     infrastructure/ansible/playbooks/manage-system-configs.yml
   ```

2. **バックアップから復旧**:
   ```bash
   ansible-playbook -i infrastructure/ansible/inventory.yml \
     infrastructure/ansible/playbooks/rollback.yml
   ```

### 設定ファイルが更新されない場合

1. **プレイブックの実行**:
   ```bash
   ansible-playbook -i infrastructure/ansible/inventory.yml \
     infrastructure/ansible/playbooks/manage-system-configs.yml
   ```

2. **手動で確認**:
   ```bash
   # 設定ファイルの内容を確認
   cat /etc/polkit-1/rules.d/50-pcscd-allow-all.rules
   ```

## 関連ドキュメント

- [Ansible堅牢化・安定化計画](../plans/ansible-hardening-stabilization-plan.md)
- [Ansibleエラーハンドリングガイド](./ansible-error-handling.md)
- [トラブルシューティングナレッジベース](../knowledge-base/infrastructure.md)

## 更新履歴

- 2025-12-01: 初版作成

