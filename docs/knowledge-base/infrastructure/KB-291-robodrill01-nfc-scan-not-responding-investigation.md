---
title: KB-291: ロボドリル01（raspi4-robodrill01）NFCスキャンが反応しない調査報告
tags: [NFC, Pi4, ロボドリル01, raspi4-robodrill01, 機能調査]
audience: [開発者, 運用者]
last-verified: 2026-03-05
related: [../hardware-nfc.md, ../../troubleshooting/nfc-reader-issues.md, ../../guides/client-initial-setup.md]
category: knowledge-base
update-frequency: medium
---

# KB-291: ロボドリル01（raspi4-robodrill01）NFCスキャンが反応しない調査報告

**日付**: 2026-03-05  
**ステータス**: 調査完了・恒久対策実装済み（2026-03-05）

## Context

- **事象**: パイ4ロボドリル01（raspi4-robodrill01）にNFCリーダーを接続したが、スキャンが反応しない
- **問い**: Pi4増設時のNFC仕様・ロジックが存在するか、既存ロジック・仕様ドキュメントとの整合性

## 調査結果サマリ

| 項目 | 存在 | 備考 |
|------|------|------|
| inventory の nfc_agent 変数 | ✅ あり | raspi4-robodrill01 に `nfc_agent_client_id`, `nfc_agent_client_secret` 等が定義済み |
| NFCエージェント .env のデプロイ | ⚠️ 条件付き | `manage-app-configs.yml` で配布可能だが、**標準デプロイフローに含まれていない** |
| NFCエージェントの起動・自動起動 | ❌ なし | Ansible に nfc-agent 起動タスクが存在しない |
| client-initial-setup.md のNFC手順 | ❌ なし | status-agent・kiosk-browser のみ。NFCエージェントの手順が欠落 |
| docker-compose.client.yml の env 参照 | ⚠️ 不整合 | `env_file: .env.example` を参照。Ansible でデプロイする `.env` がコンテナに渡らない |

---

## 1. 既存仕様・ロジックの精査結果

### 1.1 インベントリ定義（存在する）

`infrastructure/ansible/inventory.yml` の raspi4-robodrill01 に以下が定義済み:

```yaml
nfc_agent_api_base_url: "{{ api_base_url }}"
nfc_agent_client_id: "raspi4-robodrill01-kiosk1"
nfc_agent_client_secret: "client-key-raspi4-robodrill01-kiosk1"
```

### 1.2 NFCエージェント .env のデプロイ

- **プレイブック**: `manage-app-configs.yml`（hosts: server:clients）
- **テンプレート**: `nfc-agent.env.j2` → `clients/nfc-agent/.env`
- **問題**: `scripts/update-all-clients.sh` → `deploy-staged.yml` の標準デプロイフローでは **manage-app-configs.yml が実行されない**
- **結論**: 標準デプロイでは nfc-agent 用 .env が自動デプロイされない

### 1.3 NFCエージェントの起動

- **想定方式**: Docker Compose（`docker-compose.client.yml`）または Poetry 直接実行
- **起動スクリプト**: `scripts/client/setup-nfc-agent.sh`（手動実行用）
- **Ansible**: nfc-agent の起動・再起動タスクは **存在しない**
- **services_to_restart**: raspi4-robodrill01 は `kiosk-browser.service`, `status-agent.service`, `status-agent.timer` のみ。nfc-agent は含まれない

### 1.4 新規クライアント初期設定ドキュメント

`docs/guides/client-initial-setup.md` の構成:

- Step 1–4: 基本設定・SSH・Git・status-agent
- Step 5: kiosk-browser.service
- Step 6: 管理コンソールでの確認

**NFCエージェントの手順は含まれていない。**

### 1.5 docker-compose.client.yml の env 参照

```yaml
# infrastructure/docker/docker-compose.client.yml
services:
  nfc-agent:
    env_file:
      - ../../clients/nfc-agent/.env.example   # ← .env ではなく .env.example
```

- Ansible が `clients/nfc-agent/.env` をデプロイしても、コンテナは `.env.example` を参照
- 端末固有の CLIENT_ID / CLIENT_SECRET がコンテナに渡らない可能性がある

---

## 2. 既存のNFC動作フロー（参照）

NFCが動作する場合の経路:

1. **NFCエージェント**（Pi4上）: pyscard または TS100 HID で UID 取得 → `ws://localhost:7071/stream` に WebSocket 配信
2. **フロントエンド**: `useNfcStream`（localOnly ポリシー）で `ws://localhost:7071/stream` に接続
3. **キオスクページ**: 工具持出・計測機器持出・吊具持出・写真持出などで NFC イベントを処理

スキャンが反応しない場合の主な要因（[nfc-reader-issues.md](../../troubleshooting/nfc-reader-issues.md) 参照）:

- NFCエージェントが起動していない
- pcscd が停止している、または polkit 設定不足
- WebSocket 接続失敗（`ws://localhost:7071/stream`）
- リーダー未認識（`pcsc_scan` で確認）

---

## 3. 根本原因の整理

ロボドリル01でNFCスキャンが反応しない主因として、以下が考えられる:

1. **NFCエージェントが起動していない**
   - 初期設定・デプロイに nfc-agent 起動手順が含まれていない
   - `setup-nfc-agent.sh` の手動実行が必要だが、ドキュメントに明示されていない

2. **.env が正しく渡っていない**
   - docker-compose.client.yml が `.env.example` を参照しており、Ansible でデプロイした `.env` が使われない可能性

3. **pcscd / polkit / USB の未設定**
   - client ロールで polkit ルールはデプロイされるが、Docker が Pi4 に存在するか、`/run/pcscd` マウントが有効かは環境依存

---

## 4. 恒久対策（2026-03-05 実装完了）

以下を実装済みです。

- **docker-compose.client.yml**: `env_file` を `.env` に変更（運用実体を参照）
- **client role**: nfc-agent 設定配布（`nfc-agent.yml`）と起動保証（`nfc-agent-lifecycle.yml`）を統合
- **変数契約**: `nfc_agent_client_id` / `nfc_agent_client_secret` を必須化し fail-fast

### デプロイ・検証手順（RoboDrill01先行）

```bash
# Pi5で実行（RASPI_SERVER_HOST を設定済み前提）
RASPI_SERVER_HOST=100.106.158.2 ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit "server:raspi4-robodrill01" --foreground

# デプロイ後、raspi4-robodrill01 で確認
ssh tools04@100.123.1.113 "curl -s http://localhost:7071/api/agent/status"
```

期待: `readerConnected: true` および `status: ok` が返ること。

### 即時対応（手動、デプロイ前）

```bash
cd /opt/RaspberryPiSystem_002
sudo scripts/client/setup-nfc-agent.sh
```

---

## 6. 実機検証完了・デプロイトラブルシュート（2026-03-05）

### 実機検証結果

- **吊具タグ**: NFCスキャンで画面遷移をトリガーし、正常動作を確認
- **計測機器タグ**: 同様に画面遷移をトリガーし、正常動作を確認

### デプロイ時に発生したトラブルと対策

| 事象 | 根因 | 対策 |
|------|------|------|
| `readerConnected: false` | **pcscd** が未導入または非稼働。nfc-agent は pcscd 経由でリーダーにアクセスする | `nfc-agent-lifecycle.yml` で pcscd・pcsc-tools を自動インストール、pcscd.service を有効化・起動。pcscd 状態変更時に nfc-agent を再起動 |
| `nfc-agent には Docker が必要です` | raspi4-robodrill01 に Docker が未インストール | 手動: `curl -fsSL https://get.docker.com \| sh` および `sudo usermod -aG docker <user>`。恒久対策: 新規 Pi4 追加時は client-initial-setup.md の前提条件に Docker を含める |
| `Refusing to deserialize an invalid UTF8 string` | journalctl/df 出力に無効 UTF-8（サロゲート等）が混入し、Ansible の Python が失敗 | `update-clients-core.yml` で `iconv -f utf-8 -t utf-8 -c` により無効文字を除去 |
| health-check で `iconv` が非ゼロ終了 | iconv が無効文字を除去すると終了コード 1 を返す | `health-check.yml` で `iconv ... \|\| true` を付与し、タスク失敗を回避 |

### 知見

- **pcscd と nfc-agent の起動順序**: nfc-agent は起動時に pcscd ソケットを参照する。pcscd が後から起動した場合、nfc-agent を再起動しないと `readerConnected` が true にならない。`nfc-agent-lifecycle.yml` は pcscd の状態変更時に nfc-agent を再起動する。
- **Docker 未導入の検出**: `nfc-agent-lifecycle.yml` の `docker --version` チェックで fail-fast。新規 Pi4 追加時は Docker を先に導入する必要がある。

---

## 7. 関連ドキュメント

- [hardware-nfc.md](./hardware-nfc.md)（本KBの要約）
- [NFCリーダーのトラブルシューティング](../../troubleshooting/nfc-reader-issues.md)
- [client-initial-setup.md](../../guides/client-initial-setup.md)
- [auto-startup-status.md](../../guides/auto-startup-status.md)（Pi4 nfc-agent: 開発中は手動起動と記載）
