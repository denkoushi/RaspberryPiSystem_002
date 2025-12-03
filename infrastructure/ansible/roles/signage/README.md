# role: signage

用途:
  - サイネージ端末でのみ必要な処理（signage-lite停止/再開、`signage-update.sh`のURL更新、依存インストール、サイネージAPIヘルスチェック）を行う。

適用条件:
  - `manage_signage_lite | bool` が真の場合のみこのロールを適用する。

必要変数:
  - `signage_server_url`
  - `signage_client_key`
  - `repo_path`（スクリプト配置元）
