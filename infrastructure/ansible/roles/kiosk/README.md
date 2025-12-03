# role: kiosk

用途:
  - キオスク端末でのみ必要な処理（`kiosk-launch.sh`テンプレート配布、kiosk-browser.service管理、`kiosk_url`ヘルスチェック）を行う。

適用条件:
  - `manage_kiosk_browser | bool` が真の場合にのみこのロールを適用する。

必要変数:
  - `kiosk_url`
  - `repo_path`（テンプレート配置元）
