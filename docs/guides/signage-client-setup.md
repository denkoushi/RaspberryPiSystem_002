---
title: デジタルサイネージクライアント端末セットアップガイド
tags: [デジタルサイネージ, セットアップ, ラズパイ3, ラズパイZero2W, Android]
audience: [運用者, 開発者]
last-verified: 2026-04-07
related: [../modules/signage/README.md, deployment.md]
category: guides
update-frequency: medium
---

# デジタルサイネージクライアント端末セットアップガイド

最終更新: 2025-11-28

## 概要

本ドキュメントでは、Raspberry Pi 3またはRaspberry Pi Zero 2Wをデジタルサイネージ表示端末としてセットアップする手順を説明します。型落ち **Android タブレット**向けの **軽量URL（`/signage-lite`）** は [Android タブレット（軽量表示）](#android-signage-lite) を参照してください。

<a id="android-signage-lite"></a>

## Android タブレット（軽量表示）

低スペックな Android タブレットでは、React ベースの `/signage` より **`/signage-lite`** の利用を推奨する。サーバ側が生成した JPEG（`GET /api/signage/current-image`）を **約30秒間隔**で表示するだけのページであり、端末側の描画負荷が小さい。

### 端末キー（`clientKey` / `apiKey`）

- 端末は **`ClientDevice.apiKey`** で識別する（IP アドレスではない）。
- 推奨例: `client-key-factory-android-signage-161`（`signage` または `android-signage` を含むと、管理画面のスケジュール対象端末候補に出やすい）。
- DB にレコードを作る: 既存運用どおり **`POST /api/clients/heartbeat`**（`apiKey`, `name`, `location`）で upsert 可能。

### 表示URL

```text
https://<サーバのホスト>/signage-lite?clientKey=client-key-factory-android-signage-161
```

初回アクセスで `clientKey` はブラウザの `localStorage` に保存される。長期運用ではブックマークまたはキオスク常駐ブラウザのスタートURLを上記に固定する。

### スケジュールの割当

管理画面 **`/admin/signage/schedules`** で、対象スケジュールの **`targetClientKeys`** に当該 `apiKey` を含める（空は全端末向け）。詳細は [ADR-20260407](../decisions/ADR-20260407-signage-target-client-keys.md)。

### TLS

HTTPS／自己署名証明書の扱いは Pi 向け Chromium と同様。端末に信頼させるか、運用ポリシーに応じて証明書警告の扱いを決める。

## 前提条件

- Raspberry Pi 3 または Raspberry Pi Zero 2W
- Raspberry Pi OS (64bit) がインストール済み
- HDMI接続のディスプレイ（1920x1080推奨）
- ネットワーク接続（Raspberry Pi 5サーバーと同一ネットワーク）

## セットアップ手順

### 1. システムの更新

```bash
sudo apt-get update
sudo apt-get upgrade -y
```

### 2. リポジトリのクローン

```bash
git clone https://github.com/denkoushi/RaspberryPiSystem_002.git /opt/RaspberryPiSystem_002
cd /opt/RaspberryPiSystem_002
```

### 3. セットアップスクリプトの実行

```bash
# サイネージURLを指定してセットアップ
sudo ./scripts/client/setup-signage.sh https://192.168.10.230/signage
```

**重要**: `https://192.168.10.230/signage` の部分は、実際のRaspberry Pi 5サーバーのIPアドレスに置き換えてください。

### 4. 動作確認

セットアップスクリプト実行後、自動的にChromiumが起動し、サイネージが表示されます。

手動で確認する場合：

```bash
# サービスステータス確認
systemctl status signage-display

# ログ確認
journalctl -u signage-display -f
```

### 5. 再起動テスト

```bash
sudo reboot
```

再起動後、自動的にサイネージが表示されることを確認してください。

## トラブルシューティング

### Chromiumが起動しない

```bash
# ログを確認
journalctl -u signage-display -n 50

# 手動で起動テスト
sudo -u pi /usr/local/bin/signage-launch.sh
```

### 画面が表示されない

- HDMIケーブルの接続を確認
- ディスプレイの電源を確認
- `xset`コマンドで画面設定を確認

```bash
xset q
```

### ネットワーク接続エラー

- Raspberry Pi 5サーバーとのネットワーク接続を確認
- ファイアウォール設定を確認
- サイネージURLが正しいか確認

### サイネージ画像が更新されない

**症状**: Pi3のサイネージ画面が古い画像のまま更新されない

**原因**: `signage-lite-update.timer`が停止している可能性があります

**解決方法**:
```bash
# Pi3で実行
sudo systemctl start signage-lite-update.timer
sudo systemctl enable signage-lite-update.timer

# タイマーの状態を確認
systemctl is-active signage-lite-update.timer

# 手動で画像更新を実行（確認用）
sudo systemctl start signage-lite-update.service
```

**確認方法**:
```bash
# 画像ファイルの更新日時を確認（tmpfs: /run/signage）
ls -lh /run/signage/current.jpg
stat -c "%y" /run/signage/current.jpg
```

**注意**: 
- `signage-lite-update.timer`は30秒ごとに画像を更新します。タイマーが停止していると、Pi3は古い画像を表示し続けます。
- 画像キャッシュは `/run/signage`（tmpfs）に配置されており、再起動後は消えます（SDカードへの書込みを削減するため）。
- 画像更新が停止した場合、`signage-lite-watchdog.timer`が自動的に復旧を試行します（1分間隔で監視）。

```bash
# サーバーへの接続確認
curl -k https://192.168.10.230/api/system/health
```

### 自己署名証明書の警告

HTTPSを使用している場合、自己署名証明書の警告が表示される可能性があります。

Chromiumの起動オプションに以下を追加することで警告を無視できます（セキュリティリスクあり）：

```bash
--ignore-certificate-errors
```

ただし、本番環境では適切な証明書を使用することを推奨します。

## 設定の変更

### サイネージURLの変更

```bash
# サービスを停止
sudo systemctl stop signage-display

# ランチャースクリプトを編集
sudo nano /usr/local/bin/signage-launch.sh

# 新しいURLを設定してサービスを再起動
sudo systemctl start signage-display
```

### 自動起動の無効化

```bash
sudo systemctl disable signage-display
```

### 自動起動の再有効化

```bash
sudo systemctl enable signage-display
```

## パフォーマンス最適化

### Raspberry Pi Zero 2W向けの最適化

低スペックデバイスでの動作を改善するため、以下の設定を推奨します：

1. **GPUメモリの増加**

```bash
sudo raspi-config
# Advanced Options > Memory Split > 128
```

2. **不要なサービスの無効化**

```bash
# Bluetoothを無効化（不要な場合）
sudo systemctl disable bluetooth

# WiFi省電力モードを無効化
sudo iwconfig wlan0 power off
```

3. **オーバークロック（推奨）**

```bash
sudo raspi-config
# Advanced Options > Overclock > Medium
```

## 関連ドキュメント

- [デジタルサイネージモジュール仕様書](../modules/signage/README.md)
- [デプロイメントガイド](deployment.md)
- [運用マニュアル](operation-manual.md)

