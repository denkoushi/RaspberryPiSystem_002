# role: client

用途:
  - クライアント端末全般（kiosk/signage含む）でstatus-agent設定、polkitルール、systemdサービス、共通サービス再起動、ヘルス情報収集を行う。

必要変数:
  - `status_agent_*`（ID/KEY/ロケーション等）
  - `services_to_restart`（各ホストのsystemdユニット配列）
  - `manage_kiosk_browser`, `manage_signage_lite`（下位ロールに引き渡すフラグ）

NFCエージェント（Pi4キオスク）:
  - `nfc_agent_client_id`（必須）: クライアント識別子
  - `nfc_agent_client_secret`（必須）: API認証用シークレット
  - `nfc_agent_api_base_url`（任意）: 未定義時は api_base_url を継承

Zero2W 配膳エッジ（`haizen-agent`）:
  - `haizen_agent_enabled`（boolean）: `true` のホストで unit・`/etc/raspi-haizen-agent.conf` を配備
  - `haizen_agent_client_key`: `X_CLIENT_KEY`
  - `haizen_agent_api_base_url`: Pi5 の HTTPS オリジン（`/api` なし）。未設定時は `server_base_url` 等の共通変数にフォールバック（`group_vars` を参照）
  - `haizen_agent_tls_verify_mode`: `insecure`（既定）または `system`（証明書検証）。`status_agent_tls_skip_verify` とは **別経路**（誤注入防止）
  - `haizen_agent_hid_device` / `haizen_agent_install_evdev`: HID・evdev パッケージ
