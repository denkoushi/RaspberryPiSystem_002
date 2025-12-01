---
title: Ansible設定ファイル管理化実装計画
tags: [Ansible, 設定管理, 実装計画]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [ansible-hardening-stabilization-plan.md, ansible-progress-summary.md]
category: plans
update-frequency: high
---

# Ansible設定ファイル管理化実装計画

最終更新: 2025-12-01

## 概要

Ansible堅牢化・安定化のPhase 1-5完了後、実用段階に達するために必要な追加実装計画です。

## 背景

現状、以下の設定ファイルがAnsibleで管理されていません：
- systemdサービスファイル（`kiosk-browser.service`、`signage-lite.service`）
- アプリケーション設定ファイル（`.env`ファイル）

これらが削除された場合、サービスが起動しなくなったり、環境変数の変更が手動作業になったりする問題があります。

## 実装目標

1. **systemdサービスファイルのAnsible管理化**
   - `kiosk-browser.service`のテンプレート化
   - `signage-lite.service`のテンプレート化
   - `manage-system-configs.yml`への統合

2. **アプリケーション設定ファイルのAnsible管理化**
   - `manage-app-configs.yml`プレイブックの作成
   - 各`.env`ファイルのテンプレート化
   - 環境変数の管理方針の明確化

## 実装計画

### Phase 1: systemdサービスファイルの管理化

#### 1.1 kiosk-browser.serviceテンプレート作成

**ファイル**: `infrastructure/ansible/templates/kiosk-browser.service.j2`

**内容**:
- `setup-kiosk.sh`の内容をベースにテンプレート化
- ユーザー名を変数化（`{{ ansible_user }}`）
- URLを変数化（`{{ kiosk_url }}`）

**見積もり**: 30分

#### 1.2 signage-lite.serviceテンプレート作成

**ファイル**: `infrastructure/ansible/templates/signage-lite.service.j2`

**内容**:
- `setup-signage-lite.sh`の内容をベースにテンプレート化
- サーバーURL、クライアントキーを変数化

**見積もり**: 30分

#### 1.3 manage-system-configs.ymlへの統合

**タスク追加**:
- kiosk-browser.serviceのデプロイタスク
- signage-lite.serviceのデプロイタスク
- サービス再起動ハンドラー

**見積もり**: 30分

### Phase 2: アプリケーション設定ファイルの管理化

#### 2.1 manage-app-configs.ymlプレイブック作成

**ファイル**: `infrastructure/ansible/playbooks/manage-app-configs.yml`

**内容**:
- アプリケーション設定ファイルのデプロイ
- 環境変数のテンプレート化
- バックアップ機能の統合

**見積もり**: 1時間

#### 2.2 テンプレートファイル作成

**対象ファイル**:
- `infrastructure/ansible/templates/api.env.j2`
- `infrastructure/ansible/templates/web.env.j2`
- `infrastructure/ansible/templates/nfc-agent.env.j2`
- `infrastructure/ansible/templates/docker.env.j2`

**見積もり**: 1時間

#### 2.3 環境変数の管理方針明確化

**ドキュメント更新**:
- `docs/guides/ansible-managed-files.md`に環境変数の管理方針を追加
- 機密情報の扱い方針を明確化

**見積もり**: 30分

### Phase 3: ドキュメント化とナレッジベース更新

#### 3.1 INDEX.md更新

**追加リンク**:
- 実装計画へのリンク
- ガイドドキュメントへのリンク

**見積もり**: 10分

#### 3.2 ナレッジベース更新

**KB-062追加**:
- 設定ファイル管理化の実装内容
- トラブルシューティング情報

**見積もり**: 30分

#### 3.3 進捗サマリー更新

**更新内容**:
- Phase 1-2の完了状況
- 実用段階への到達確認

**見積もり**: 10分

## 成功条件（Definition of Done）

1. ✅ systemdサービスファイルがAnsibleで管理されている
2. ✅ アプリケーション設定ファイルがAnsibleで管理されている
3. ✅ 設定ファイルが削除されても自動復旧できる
4. ✅ 環境変数の変更がAnsibleで可能
5. ✅ ドキュメントが更新されている

## 見積もり

| Phase | 見積もり |
|-------|---------|
| Phase 1: systemdサービスファイル管理化 | 1.5時間 |
| Phase 2: アプリケーション設定ファイル管理化 | 2.5時間 |
| Phase 3: ドキュメント化 | 50分 |
| **合計** | **約4.5時間** |

## リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| テンプレート変数の不足 | 中 | 既存スクリプトを確認して変数を洗い出す |
| 環境変数の機密情報漏洩 | 高 | `.env`ファイルはGitにコミットしない、Ansible Vaultを使用 |
| サービス再起動の失敗 | 中 | ハンドラーで条件分岐、エラーハンドリングを実装 |

## 関連ドキュメント

- [Ansible堅牢化・安定化計画](./ansible-hardening-stabilization-plan.md)
- [Ansibleで管理すべき設定ファイル一覧](../guides/ansible-managed-files.md)
- [Ansible進捗サマリー](./ansible-progress-summary.md)

## 更新履歴

- 2025-12-01: 初版作成

