# Raspberry Pi 5 キオスク設定手順

最終更新: 2025-12-01

## 概要

Raspberry Pi 5（サーバー）で再起動後に自動的にキオスク（ブラウザ）を起動する設定手順です。

## 前提条件

- Raspberry Pi 5にディスプレイが接続されている
- Raspberry Pi OSがGUIモードで起動している（`raspi-config`で確認）
- Chromiumブラウザがインストールされている

## 設定手順

### 1. 現在の状態を確認

```bash
# キオスクサービスが存在するか確認
systemctl list-unit-files | grep kiosk

# キオスクサービスが有効になっているか確認
systemctl is-enabled kiosk-browser.service 2>/dev/null || echo "kiosk-browser.service は存在しません"

# Chromiumがインストールされているか確認
which chromium-browser || which chromium || echo "Chromiumがインストールされていません"
```

### 2. Chromiumのインストール（未インストールの場合）

```bash
sudo apt update
sudo apt install -y chromium-browser
```

### 3. キオスク設定スクリプトの実行

**管理画面を表示する場合**:
```bash
cd /opt/RaspberryPiSystem_002
sudo ./scripts/client/setup-kiosk.sh https://localhost:4173/login
```

**サイネージを表示する場合**:
```bash
cd /opt/RaspberryPiSystem_002
sudo ./scripts/client/setup-kiosk.sh https://localhost:4173/signage
```

**注意**: 
- URLは実際の環境に合わせて変更してください（`localhost`ではなくIPアドレスやホスト名を使用する場合）
- HTTPSを使用している場合は`https://`を使用してください

### 4. 設定の確認

```bash
# サービスが有効になっているか確認
systemctl is-enabled kiosk-browser.service

# サービスが実行中か確認
systemctl is-active kiosk-browser.service

# サービスのログを確認
journalctl -u kiosk-browser.service -n 20 --no-pager
```

### 5. 再起動して動作確認

```bash
sudo reboot
```

再起動後、自動的にブラウザがフルスクリーンで起動することを確認してください。

## トラブルシューティング

### キオスクが起動しない場合

1. **Xサーバーが起動しているか確認**:
   ```bash
   echo $DISPLAY
   xrandr
   ```
   `DISPLAY`が設定されていない、または`xrandr`がエラーを返す場合は、GUIモードが有効になっていない可能性があります。

2. **GUIモードを有効化**:
   ```bash
   sudo raspi-config
   # System Options > Boot / Auto Login > Desktop Autologin を選択
   ```

3. **サービスのログを確認**:
   ```bash
   journalctl -u kiosk-browser.service -n 50 --no-pager
   ```

4. **手動でブラウザを起動してテスト**:
   ```bash
   export DISPLAY=:0
   chromium-browser --kiosk --app="https://localhost:4173/login"
   ```

### サービスを停止・無効化する場合

```bash
sudo systemctl stop kiosk-browser.service
sudo systemctl disable kiosk-browser.service
```

### サービスを再起動する場合

```bash
sudo systemctl restart kiosk-browser.service
```

## 関連ドキュメント

- [クライアント（Raspberry Pi 4）セットアップ](../README.md#クライアント-raspberry-pi-4-セットアップ)
- [デジタルサイネージモジュール仕様](../modules/signage/README.md)

