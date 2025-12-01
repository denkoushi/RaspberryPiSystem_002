---
title: Ansible改善 Phase1-2 実機テスト計画
tags: [Ansible, テスト計画, 実機検証]
audience: [開発者, 運用者]
last-verified: 2025-12-01
related: [ansible-improvement-plan.md]
category: plans
update-frequency: high
---

# Ansible改善 Phase1-2 実機テスト計画

最終更新: 2025-12-01

## テスト目的

Phase1（エラーハンドリング強化）とPhase2（バリデーション強化）の実装が正常に動作することを確認する。

## テスト環境

- **Ansible Controller**: Raspberry Pi 5 (192.168.128.131)
- **テスト対象**: 
  - Raspberry Pi 4 (192.168.128.102) - キオスク
  - Raspberry Pi 3 (192.168.128.152) - サイネージ

## テスト項目

### テスト1: シンタックスチェック ✅ 完了

**目的**: プレイブックの構文エラーがないことを確認

**手順**:
```bash
ansible-playbook -i inventory.yml playbooks/update-clients.yml --syntax-check
ansible-playbook -i inventory.yml playbooks/manage-system-configs.yml --syntax-check
ansible-playbook -i inventory.yml playbooks/manage-app-configs.yml --syntax-check
```

**期待結果**: エラーなし

**結果**: ✅ 完了（2025-12-01）

---

### テスト2: バリデーション機能のテスト

#### テスト2-1: 必須変数チェック（assert）

**目的**: 必須変数が未定義の場合にエラーになることを確認

**手順**:
1. `inventory.yml`から`nfc_agent_client_id`を一時的に削除
2. `manage-app-configs.yml`を実行
3. assertエラーが発生することを確認
4. 変数を復元

**期待結果**: 
- `nfc_agent_client_id`が未定義の場合、assertエラーが発生
- エラーメッセージが明確

**優先度**: 🔴 高

#### テスト2-2: .envファイル構文チェック

**目的**: 不正な.envファイルがデプロイされないことを確認

**手順**:
1. テンプレートに不正な構文（例: `KEY=value`の後に改行なしで続く）を意図的に追加
2. `manage-app-configs.yml`を実行
3. バリデーションエラーが発生することを確認

**期待結果**: 
- 不正な構文の場合、バリデーションエラーが発生
- エラーメッセージが明確

**優先度**: 🔴 高

#### テスト2-3: systemdユニットファイル検証

**目的**: 不正なsystemdユニットファイルがデプロイされないことを確認

**手順**:
1. `kiosk-browser.service.j2`テンプレートに不正な構文を意図的に追加
2. `manage-system-configs.yml`を実行
3. `systemd-analyze verify`エラーが発生することを確認

**期待結果**: 
- 不正な構文の場合、検証エラーが発生
- エラーメッセージが明確

**優先度**: 🔴 高

---

### テスト3: エラーハンドリング機能のテスト

#### テスト3-1: Git操作のリトライ機能

**目的**: 一時的なネットワークエラーで自動リトライされることを確認

**手順**:
1. ネットワークを一時的に切断（またはGitHubへの接続をブロック）
2. `update-clients.yml`を実行
3. リトライが実行されることを確認
4. ネットワークを復旧
5. 最終的に成功することを確認

**期待結果**: 
- ネットワークエラー時に自動リトライ（最大3回）
- リトライ間隔が適切（5秒）
- 最終的に成功する

**優先度**: 🟡 中（ネットワーク障害の再現が困難なため）

#### テスト3-2: サービス再起動のrescue処理

**目的**: サービス再起動失敗時にrescueブロックが実行されることを確認

**手順**:
1. 存在しないサービス名を`services_to_restart`に追加
2. `update-clients.yml`を実行
3. rescueブロックが実行され、エラーログが出力されることを確認
4. プレイブックが適切に失敗することを確認

**期待結果**: 
- サービス再起動失敗時にrescueブロックが実行
- エラーログが詳細に出力される
- プレイブックが適切に失敗する

**優先度**: 🔴 高

#### テスト3-3: Docker再起動のrescue処理

**目的**: Docker再起動失敗時にrescueブロックが実行されることを確認

**手順**:
1. Dockerサービスを停止
2. `update-clients.yml`を実行（サーバーのみ）
3. rescueブロックが実行され、エラーログが出力されることを確認
4. Dockerサービスを再起動

**期待結果**: 
- Docker再起動失敗時にrescueブロックが実行
- エラーログが詳細に出力される
- プレイブックが適切に失敗する

**実施結果（2025-12-01）**:
- `/usr/bin/docker`を一時的にリネームしてコマンド欠如状態を再現
- `docker compose restart`が`rc=127`で失敗し、rescueブロックが発動
- `docker`コマンドが存在しない場合は`journalctl -u docker.service`へ自動フォールバックし、ログ採取に成功
- テスト後、`/usr/bin/docker`を復旧し、通常運用へ戻した

**優先度**: 🔴 高

---

### テスト4: 正常系の動作確認

#### テスト4-1: 通常のデプロイ動作確認

**目的**: 改善後のプレイブックが正常に動作することを確認

**手順**:
1. `update-clients.yml`を実行
2. すべてのタスクが成功することを確認
3. ログ出力が適切であることを確認

**期待結果**: 
- すべてのタスクが成功
- ログ出力が構造化されている
- デプロイサマリーが出力される

**優先度**: 🔴 高

#### テスト4-2: 設定ファイル管理の動作確認

**目的**: 設定ファイル管理プレイブックが正常に動作することを確認

**手順**:
1. `manage-system-configs.yml`を実行
2. systemdユニットファイルが正しくデプロイされることを確認
3. `manage-app-configs.yml`を実行
4. .envファイルが正しくデプロイされることを確認

**期待結果**: 
- すべてのタスクが成功
- 設定ファイルが正しくデプロイされる
- バリデーションが実行される

**優先度**: 🔴 高

---

## テスト実行順序

1. ✅ テスト1: シンタックスチェック（済）
2. ✅ テスト4-1: 通常のデプロイ動作確認（済）
3. ✅ テスト4-2: 設定ファイル管理の動作確認（済）
4. ✅ テスト2-1: 必須変数チェック（済）
5. ✅ テスト2-2: .envファイル構文チェック（APIテンプレートを破壊 → 期待どおり失敗）
6. ✅ テスト2-3: systemdユニットファイル検証（kioskテンプレートを破壊 → 期待どおり失敗）
7. ✅ テスト3-2: サービス再起動のrescue処理（失敗サービスを検知しrescueでログ収集→期待どおり停止）
8. ✅ テスト3-3: Docker再起動のrescue処理（dockerコマンド欠如時にrescueでsystemdログへフォールバック）
9. ⚠️ テスト3-1: Git操作のリトライ機能（`git`タスクが1回目で致命的失敗しリトライが働かない）

## テスト結果記録

各テストの結果を以下に記録する：

| テストID | テスト名 | 結果 | 備考 |
|---------|---------|------|------|
| テスト1 | シンタックスチェック | ✅ 成功 | 2025-12-01：3本のプレイブックすべて構文OK |
| テスト2-1 | 必須変数チェック | ✅ 成功 | raspberrypi4から`nfc_agent_client_id`/`secret`削除→assertで停止 |
| テスト2-2 | .envファイル構文チェック | ✅ 成功 | `infrastructure/ansible/templates/api.env.j2`に不正行を追加→`Validate API .env syntax`が`Invalid API .env lines -> 21:THIS LINE IS INVALID`で停止 |
| テスト2-3 | systemdユニットファイル検証 | ✅ 成功 | `kiosk-browser.service.j2`の`ExecStart`を不正化→`restart kiosk-browser`が`BadUnitSetting`で停止 |
| テスト3-1 | Git操作のリトライ機能 | ❌ 要修正 | `/etc/hosts`で`github.com`を127.0.0.1へ向けると`git`タスクが即時fatal。`retries/until`が働かずプレイブックが終了 |
| テスト3-2 | サービス再起動のrescue処理 | ✅ 成功 | `ansible-test-fail.service`を再起動 → `systemctl is-active`で失敗を検出しrescue発動。journal抜粋を取得後に安全に停止 |
| テスト3-3 | Docker再起動のrescue処理 | ✅ 成功 | `/usr/bin/docker`退避 → `docker compose restart`が`rc=127`で失敗しrescue発火。`docker`不存在時は`journalctl -u docker`ログへ自動フォールバック |
| テスト4-1 | 通常のデプロイ動作確認 | ✅ 成功 | `update-clients.yml`を全ホスト対象で実行。既知のkiosk-browser実行ファイル欠如ログあり |
| テスト4-2 | 設定ファイル管理の動作確認 | ✅ 成功 | `manage-system-configs.yml` / `manage-app-configs.yml`を実行。バリデーション含め成功 |

## 次のステップ

1. **テスト3系の改善設計**: `git`/`systemd`/`docker`の失敗を確実に「失敗扱い」にするロジックを見直し（`failed_when`や追加バリデーション）
2. **実装修正**: 上記改善に基づきプレイブックを改修（gitタスクの`until`再検証、systemdモジュールの戻り値検査、docker restartの失敗判定）
3. **再テスト**: 改修後にテスト3-1/3-2/3-3を再実行し、rescueの動作とリトライ挙動を確認
4. **ログ整理**: 失敗時に記録されるstdout/stderrをKnowledge Baseへ追記
5. **ドキュメント更新**: 本ドキュメントおよび`INDEX.md`に改善内容と結果を反映

