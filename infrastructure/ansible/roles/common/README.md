# role: common

用途:
  - すべてのホストで共通となる前処理・後処理（リポジトリ同期、git clean、バックアップ取得、デプロイサマリ出力）を実行する。
  - `docs` の扱いはホスト種別で分岐する（`server` は保持、`kiosk`/`signage` は削除）。

必要変数:
  - `repo_path`（デフォルト: `/opt/RaspberryPiSystem_002`）
  - `backup_dir`, `backup_service_files`
  - `ansible_user`（バックアップファイルの所有者となる）
