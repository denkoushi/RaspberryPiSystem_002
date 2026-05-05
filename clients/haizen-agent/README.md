# haizen-agent

Raspberry Pi Zero 2 W などで、**USB HID バーコードリーダー**（キーボードウェッジ）の入力を読み取り、Pi 5 の **`POST /api/mobile-placement/haizen-scans`** に送ります。

## 前提

- Pi 5 API が Tailscale 等で到達可能
- 端末の `ClientDevice` に **`haizenPresetShelfCodeRaw`** が設定済み（`PATCH /api/mobile-placement/haizen-preset-shelf` または DB）
- 推奨: `python3-evdev`（`sudo apt-get install -y python3-evdev`）＋ `HAIZEN_HID_DEVICE=/dev/input/eventN`

## 設定（/etc/raspi-haizen-agent.conf）

`KEY="value"` 形式（`#` 行コメント）。`status-agent` と同様、先頭で指定してください。

| キー | 必須 | 説明 |
|------|------|------|
| `API_BASE_URL` | はい | Pi5 の HTTPS **オリジン**（例 `https://100.x.x.x`）。**`/api` は付けない**（末尾スラッシュなし） |
| `X_CLIENT_KEY` | はい | `ClientDevice.apiKey` |
| `HAIZEN_TLS_VERIFY_MODE` | いいえ | `insecure`（既定・自己署名許容・**Ansible 既定 `haizen_agent_tls_verify_mode`**）または `system`（OS 信頼ストアで検証） |
| `TLS_SKIP_VERIFY` | いいえ | **互換用**。`1` で検証スキップ。`HAIZEN_TLS_VERIFY_MODE` より **優先**（明示的に残したい場合のみ） |
| `CONFIG_PATH` | いいえ | 既定 `/etc/raspi-haizen-agent.conf` |
| `HAIZEN_HID_DEVICE` | いいえ | `evdev` デバイスパス。未設定時は **標準入力** から1行ずつ読む（手動テスト用） |

**標準配備**: Ansible の **`client`** ロールが **`/etc/raspi-haizen-agent.conf`** と **`clients/haizen-agent/haizen-agent.service`** を Zero に配置する（`roles/client/tasks/haizen-agent.yml`・断片インベントリ `haizen_agent_*`）。手順は [zero2w-tanaban-edge-setup.md](../../docs/runbooks/zero2w-tanaban-edge-setup.md)。

## 分配番号 QR

- 値が **1〜999 の整数**のみ（1〜3桁）のスキャンは「次の製造 order 1件用の分配番号」として扱います。
- その直後の製造 order スキャンにだけ `distributionNumber` として付与され、**消費後は未設定に戻ります**。

## 実行

```bash
sudo HAIZEN_HID_DEVICE=/dev/input/eventX python3 -m haizen_agent
# または設定ファイルのみ
python3 -m haizen_agent
```

## systemd

リポジトリ同梱の **`haizen-agent.service`** を `/etc/systemd/system/` に配置（Ansible **`zero2w-edge-setup.yml` + `client` ロール**が正本）。現行 unit は **root 実行**で、`haizen_agent.config` が既定で **`/etc/raspi-haizen-agent.conf`** を読む。

**設定ファイルの権限**: **`/etc/raspi-haizen-agent.conf` は `root:root` + `chmod 640`** を推奨。`x-client-key` を含むため **world-readable にしない**。詳細は [KB-368](../../docs/knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)・[zero2w-tanaban-edge-setup.md](../../docs/runbooks/zero2w-tanaban-edge-setup.md)。
