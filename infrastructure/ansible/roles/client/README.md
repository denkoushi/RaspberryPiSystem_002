# role: client

用途:
  - クライアント端末全般（kiosk/signage含む）でstatus-agent設定、polkitルール、systemdサービス、共通サービス再起動、ヘルス情報収集を行う。

必要変数:
  - `status_agent_*`（ID/KEY/ロケーション等）
  - `services_to_restart`（各ホストのsystemdユニット配列）
  - `manage_kiosk_browser`, `manage_signage_lite`（下位ロールに引き渡すフラグ）
