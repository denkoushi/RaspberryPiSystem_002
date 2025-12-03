# role: server

用途:
  - Raspberry Pi 5（サーバー）向けにAPI/Web/NFC/Dockerの`.env`テンプレートを配置し、Docker Composeサービスを再ビルド・再起動し、APIヘルスチェックを行う。

必要変数:
  - `api_*`, `web_*`, `docker_*`（`inventory.yml`または`host_vars/raspberrypi5`で定義）
  - `repo_path`（Docker Composeファイルの位置）
  - `docker_server_ip`（ネットワーク変更検出に利用）
