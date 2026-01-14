---
title: トークプラザ工場 導入チェックリスト（最小）
tags: [導入, 運用, トークプラザ, Ansible, マルチ拠点]
audience: [運用者, 開発者]
last-verified: 2026-01-14
related: [deployment.md, environment-setup.md, status-agent.md]
category: guides
update-frequency: medium
---

## 目的（MVP）
- ✅ **管理画面にログインできる**
- ✅ **サイネージが表示される**
- ✅ **キオスク（貸出/返却）が動く**

## 前提
- トークプラザ工場は当面**別Pi5（別DB）で通常運用**
- 将来、第2工場Pi5へDB集約予定（時期未定）
- トークプラザ工場内でDNS運用:
  - `pi5.talkplaza.local`
  - `pi4.talkplaza.local`
  - `signage01.talkplaza.local`

## 0. ネットワーク（現地）準備
- **DHCP予約（固定IP）**を設定（Pi5/Pi4/サイネージ端末）
- ルータ/社内DNSにホスト名を登録（上記3つ）

## 1. リポジトリ側（Mac）準備
- ブランチは`main`を使用（導入時は安定版）
- トークプラザ用inventoryが存在すること:
  - `infrastructure/ansible/inventory-talkplaza.yml`
  - `infrastructure/ansible/group_vars/talkplaza.yml`
  - `infrastructure/ansible/host_vars/talkplaza-*/`

## 2. シークレット（トークプラザ用）設定
トークプラザ用の`vault.yml`に必要値を入れる:
- `infrastructure/ansible/host_vars/talkplaza-pi5/vault.yml`
  - `vault_talkplaza_api_jwt_*`
  - `vault_talkplaza_slack_kiosk_support_webhook_url`（トークプラザ専用Webhook推奨）
  - `vault_talkplaza_dropbox_*`（トークプラザ専用トークン推奨）
- `infrastructure/ansible/host_vars/talkplaza-pi4/vault.yml`
  - `vault_talkplaza_nfc_agent_client_secret`（端末固有）
- `infrastructure/ansible/host_vars/talkplaza-signage01/vault.yml`
  - `vault_talkplaza_signage01_client_key`（端末固有）

## 3. デプロイ（Macから、現地LAN接続で実行）
このリポジトリでは誤デプロイ防止のため、`inventory`指定が必須:

```bash
./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml
```

## 4. ヘルスチェック（最低限）
- **Pi5 API**:
  - `https://pi5.talkplaza.local/api/system/health`
- **管理画面**:
  - `https://pi5.talkplaza.local/admin`

## 5. クライアント端末登録（管理画面）
管理画面の「クライアント端末」タブで、以下を登録/設定:
- **Pi4（キオスク）**
  - `apiKey`: `client-key-talkplaza-pi4-kiosk01`
  - `name`: `talkplaza-pi4-kiosk01`（例）
  - `location`: `トークプラザ: キオスク01`
  - `statusClientId`: `talkplaza-pi4-kiosk01`（status-agentのCLIENT_IDと一致させる）
- **サイネージ**
  - `apiKey`: `client-key-talkplaza-signage01`
  - `name`: `talkplaza-signage01`（例）
  - `location`: `トークプラザ: サイネージ01`
  - `statusClientId`: `talkplaza-signage01`

## 6. サイネージ動作確認
- サイネージ端末で表示が継続して更新されること
- `host_vars/talkplaza-signage01/main.yml` の `signage_update_interval`（デフォルト60秒）で、Zero2Wでも更新が安定すること

## 7. キオスク動作確認（貸出/返却）
- Pi4でキオスクURLにアクセスできること:
  - `https://pi5.talkplaza.local/kiosk`
- NFC読み取り→貸出/返却の基本フローが動くこと

## 8. Dropbox保存先の分離（重要）
トークプラザPi5ではDropbox保存先を **`/backups/talkplaza`** に寄せる。\n
- Ansible側の`.env`で `DROPBOX_BASE_PATH=/backups/talkplaza` が入る想定\n
（空文字の場合はデフォルトにフォールバックするため、設定漏れに注意）

