# role: server

用途:
  - Raspberry Pi 5（サーバー）向けのhost package、security、systemd、API/Web/Dockerの`.env`を配置する。
  - API/Webのimage、migration、traffic切替、health、rollbackは`deploy-release-standard.yml`の`release_pi5` roleが所有する。

必要変数:
  - `api_*`, `web_*`, `docker_*`（`inventory.yml`または`host_vars/raspberrypi5`で定義）
  - `repo_path`（設定ファイルの配置先）
  - `docker_server_ip`（ネットワーク変更検出に利用）
