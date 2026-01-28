---
title: トラブルシューティングナレッジベース - その他
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2025-12-29
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - その他

**カテゴリ**: インフラ関連 > その他  
**件数**: 17件  
**索引**: [index.md](../index.md)

その他のインフラ関連トラブルシューティング情報

---

### [KB-018] オフライン耐性の実装

**EXEC_PLAN.md参照**: Validation 6 (行30-31)

**事象**: 
- オフライン時にNFCイベントが失われる
- オンライン復帰後にイベントが送信されない

**要因**: 
- オフライン耐性機能が実装されていない

**有効だった対策**: 
- ✅ **解決済み**（2025-11-24）: NFCエージェントにSQLiteキューを実装し、オフライン時にイベントを保存し、オンライン復帰時にキューからイベントを送信するように実装

**学んだこと**: 
- オフライン耐性を実装するには、イベントをキューに保存する必要がある
- オンライン復帰時にキューからイベントを送信する必要がある

**解決状況**: ✅ **解決済み**（2025-11-24）

**関連ファイル**: 
- `clients/nfc-agent/src/nfc_agent/queue.py`
- `clients/nfc-agent/src/nfc_agent/agent.py`

---

---

### [KB-019] USB一括登録機能の実装

**EXEC_PLAN.md参照**: Validation 7 (行31-32)

**事象**: 
- USBメモリからのCSVインポート機能が実装されていない

**要因**: 
- 機能が実装されていない

**有効だった対策**: 
- ✅ **解決済み**（2025-11-25）: USBメモリからのCSVインポート機能を実装

**学んだこと**: 
- CSVインポート機能は、バリデーションを適切に実装する必要がある
- エラーメッセージを分かりやすくする必要がある

**解決状況**: ✅ **解決済み**（2025-11-25）

**関連ファイル**: 
- `apps/api/src/routes/imports.ts`
- `apps/web/src/pages/admin/MasterImportPage.tsx`

---

---

### [KB-021] 監視・アラート機能の実装

**EXEC_PLAN.md参照**: 次のタスク (行119)

**事象**: 
- 監視・アラート機能が実装されていない

**要因**: 
- 機能が実装されていない

**有効だった対策**: 
- ✅ **実装完了**（2025-11-25）: 監視・アラートスクリプトを実装し、CIテストを追加

**学んだこと**: 
- 監視・アラート機能は、システムの健全性を保つために重要
- CIテストを追加することで、機能の動作を確認できる

**解決状況**: ✅ **実装完了**（2025-11-25）

**関連ファイル**: 
- `scripts/server/monitor.sh`
- `scripts/test/monitor.test.sh`
- `apps/api/src/routes/system/health.ts`
- `apps/api/src/routes/system/metrics.ts`

---

---

### [KB-034] ラズパイのロケール設定（EUC-JP）による文字化け

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- ラズパイ5でUTF-8エンコードのファイルが文字化けする
- `nano`エディタで日本語コメントが正しく表示されない
- Pythonスクリプトで`UnicodeDecodeError: 'euc_jp' codec can't decode byte 0xe7`エラー

**要因**: 
- ラズパイ5のOS再インストール時に、ロケールがEUC-JP（`ja_JP.eucJP`）に設定されていた
- UTF-8エンコードのファイルをEUC-JPとして読み込もうとしてエラーが発生

**試行した対策**: 
- [試行1] Pythonスクリプトで`encoding='utf-8'`を明示 → **部分的に成功**（スクリプトは動作したが、システム全体の問題は解決しない）
- [試行2] `sudo raspi-config`でロケールをUTF-8（`ja_JP.UTF-8`）に変更 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. `sudo raspi-config`を実行
  2. `5 Localisation Options` → `L1 Locale`を選択
  3. `ja_JP.UTF-8 UTF-8`を選択し、デフォルトロケールに設定
  4. ラズパイを再起動

**学んだこと**: 
- **ロケール設定は重要**: 日本語環境では、EUC-JPとUTF-8の混在に注意が必要
- **OS再インストール時の確認**: Raspberry Pi Imagerでのインストール時に、ロケール設定を確認する
- **文字化けの診断**: `locale`コマンドで現在のロケール設定を確認できる
- **Pythonでの対処**: `open(file, encoding='utf-8')`で明示的にエンコーディングを指定することで、一時的に回避できる

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- なし（システム設定の問題）

---

---

### [KB-039] CPU温度取得のDocker対応（/sys/class/thermalマウント）

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- キオスクヘッダーにCPU温度・負荷モニターを追加したが、温度が表示されない
- APIのレスポンスで`cpuTemp: null`が返される
- `vcgencmd measure_temp`コマンドがDockerコンテナ内で実行できない

**要因**: 
- `vcgencmd`コマンドはホストのコマンドで、Dockerコンテナ内からは直接アクセスできない
- Dockerコンテナ内からホストのシステム情報にアクセスするには、ボリュームマウントが必要

**試行した対策**: 
- [試行1] `vcgencmd measure_temp`コマンドを実行 → **失敗**（Dockerコンテナ内でコマンドが見つからない）
- [試行2] `/sys/class/thermal/thermal_zone0/temp`ファイルを読み取る方式に変更 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. `/sys/class/thermal/thermal_zone0/temp`ファイルを読み取る方式に変更（ミリ度で返されるため、1000で割って度に変換）
  2. Docker Composeで`/sys/class/thermal`を読み取り専用でマウント: `- /sys/class/thermal:/sys/class/thermal:ro`
  3. `fs/promises`の`readFile`を使用してファイルを読み取り
  4. エラーハンドリングを改善し、ログ出力を`info`レベルに変更

**学んだこと**: 
- **Dockerコンテナからのシステム情報取得**: `/sys`ディレクトリをマウントすることで、ホストのシステム情報にアクセスできる
- **ファイルベースのアプローチ**: コマンド実行よりも、ファイルを読み取る方が確実で軽量
- **ボリュームマウント**: 読み取り専用（`:ro`）でマウントすることで、セキュリティを確保
- **エラーハンドリング**: ファイルが読めない場合（非ラズパイ環境など）は、`null`を返して処理を継続

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/api/src/routes/system/system-info.ts`
- `infrastructure/docker/docker-compose.server.yml`

---

---

### [KB-041] Wi-Fi変更時のIPアドレス設定が手動で再ビルドが必要だった問題（環境変数化）

**EXEC_PLAN.md参照**: Progress (2025-11-28)

**事象**: 
- Wi-Fiが変わると、ラズパイ4のIPアドレスが変わる
- Caddyfile.localのIPアドレスを手動で更新して、Webコンテナを再ビルドする必要があった
- 再ビルドに時間がかかり、運用が煩雑だった

**要因**: 
- Caddyfile.localにIPアドレスがハードコードされていた
- DockerイメージにCaddyfile.localが埋め込まれているため、IPアドレス変更時に再ビルドが必要だった
- 環境変数でIPアドレスを設定できる仕組みがなかった

**試行した対策**: 
- [試行1] Caddyfile.localを直接編集して再ビルド → **成功したが運用が煩雑**
- [試行2] Caddyfile.localをテンプレート化し、起動時に環境変数でIPアドレスを置換 → **成功**（再ビルド不要で対応可能）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. Caddyfile.localをテンプレート化（`Caddyfile.local.template`）し、`$NFC_AGENT_HOST`をプレースホルダーとして使用
  2. Dockerfile.webで起動時に`sed`コマンドで環境変数`NFC_AGENT_HOST`の値を置換してCaddyfile.localを生成
  3. docker-compose.server.ymlで環境変数`NFC_AGENT_HOST`を設定可能に（デフォルト値: `192.168.128.102`）
  4. Wi-Fi変更時は、環境変数を変更してWebコンテナを再起動するだけで対応可能（再ビルド不要）

**学んだこと**: 
- **環境変数による設定の柔軟性**: ハードコードされた値を環境変数化することで、再ビルド不要で設定変更が可能
- **テンプレート化の重要性**: 設定ファイルをテンプレート化し、起動時に動的に生成することで、運用の柔軟性が向上
- **Docker Composeの環境変数**: `${ENV_VAR:-default}`形式でデフォルト値を設定できる
- **運用の簡素化**: 再ビルド不要で設定変更できることで、運用コストが大幅に削減

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `infrastructure/docker/Caddyfile.local.template`
- `infrastructure/docker/Dockerfile.web`
- `infrastructure/docker/docker-compose.server.yml`

---

---

### [KB-042] pdf-popplerがLinux（ARM64）をサポートしていない問題

**EXEC_PLAN.md参照**: Progress (2025-11-28)

**事象**: 
- デジタルサイネージ機能でPDFを画像に変換する際、`pdf-poppler`パッケージを使用していた
- Dockerコンテナ内で`pdf-poppler`をインポートすると「linux is NOT supported.」というエラーが発生
- APIコンテナが起動できない

**要因**: 
- `pdf-poppler`パッケージは`darwin`（macOS）と`win32`（Windows）のみをサポートしている
- Linux（ARM64）環境では動作しない
- パッケージの`index.js`でプラットフォームチェックがあり、Linuxの場合は`process.exit(1)`で終了する

**試行した対策**: 
- [試行1] `pdf-poppler`パッケージを使用 → **失敗**（Linux環境で動作しない）
- [試行2] PopplerのCLIツール（`pdftoppm`）を直接使用する方式に変更 → **成功**（Linux環境で動作）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. `pdf-poppler`パッケージを削除
  2. PopplerのCLIツール（`pdftoppm`）を直接使用する`pdf-converter.ts`を作成
  3. `child_process.spawn`を使用して`pdftoppm`コマンドを実行
  4. Dockerfile.apiで`poppler-utils`パッケージをインストール（既にインストール済み）
  5. PDFをJPEG形式で画像に変換し、指定されたディレクトリに保存

**学んだこと**: 
- **プラットフォーム依存パッケージの確認**: npmパッケージがすべてのプラットフォームをサポートしているとは限らない
- **CLIツールの直接使用**: パッケージがサポートしていない場合、CLIツールを直接使用する方が確実
- **Docker環境での動作確認**: ローカル環境（macOS）で動作しても、Docker環境（Linux）で動作しない場合がある
- **PopplerのCLIツール**: `pdftoppm`はLinux環境で標準的に使用できるPDF変換ツール

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/api/src/lib/pdf-converter.ts`
- `apps/api/src/lib/pdf-storage.ts`
- `apps/api/package.json`
- `infrastructure/docker/Dockerfile.api`

---

---

### [KB-048] NFCエージェントのDockerビルドでuvicornが見つからない問題

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行621)

**事象**: 
- NFCエージェントコンテナを起動すると `ModuleNotFoundError: No module named 'uvicorn'` エラーが発生する
- コンテナが起動直後に終了し、再起動を繰り返す
- `poetry install` が実行されているが、依存パッケージがインストールされていない

**要因**: 
- `Dockerfile.nfc-agent` の `poetry install` コマンドに `--no-dev --no-root` オプションが使用されていた
- Poetry 2.x では `--no-dev` オプションが廃止され、`--without dev` に変更された
- `|| true` が含まれていたため、`poetry install` が失敗してもエラーが無視されていた

**試行した対策**: 
- [試行1] `poetry install` のログを確認 → **問題発見**（`--no-dev` オプションが存在しないというエラー）
- [試行2] `--no-dev` を `--without dev` に変更し、`|| true` を削除 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-29）:
  1. `infrastructure/docker/Dockerfile.nfc-agent` の `poetry install` コマンドを修正
  2. `--no-dev` を `--without dev` に変更（Poetry 2.x対応）
  3. `|| true` を削除して、エラーが発生した場合はビルドを失敗させるように変更
  4. これにより、依存パッケージ（uvicorn含む）が正しくインストールされるようになった

**学んだこと**: 
- **Poetryのバージョン互換性**: Poetry 2.xでは `--no-dev` が `--without dev` に変更された
- **エラーの無視は危険**: `|| true` でエラーを無視すると、後で問題が発見しにくくなる
- **ビルド時のエラー検出**: 依存関係のインストールに失敗した場合は、ビルドを失敗させることで早期に問題を発見できる

**解決状況**: ✅ **解決済み**（2025-11-29）

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.nfc-agent`

---

---

### [KB-049] NFCエージェントのDockerビルドでgccが見つからない問題

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行621)

**事象**: 
- NFCエージェントコンテナのビルド時に `error: command 'gcc' failed: No such file or directory` エラーが発生する
- `pyscard` パッケージのビルド時にC拡張をコンパイルする必要があるが、gccがインストールされていない
- `poetry install` が失敗し、依存パッケージがインストールされない

**要因**: 
- `Dockerfile.nfc-agent` のベースイメージが `python:3.11-slim` で、ビルドツール（gcc、swigなど）が含まれていない
- `pyscard` パッケージはC拡張を含むため、ビルド時にコンパイラが必要
- `pcscd` と `libpcsclite-dev` はインストールされていたが、Cコンパイラが不足していた

**試行した対策**: 
- [試行1] `poetry install` のログを確認 → **問題発見**（gccが見つからない）
- [試行2] `Dockerfile.nfc-agent` に `build-essential` と `swig` を追加 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-29）:
  1. `infrastructure/docker/Dockerfile.nfc-agent` の `apt-get install` コマンドを修正
  2. `build-essential`（gcc、makeなど）と `swig`（pyscardのビルドに必要）を追加
  3. これにより、`pyscard` パッケージのC拡張が正常にビルドされ、依存パッケージがインストールされるようになった

**学んだこと**: 
- **Pythonパッケージのビルド要件**: C拡張を含むPythonパッケージ（pyscardなど）は、ビルド時にコンパイラが必要
- **slimイメージの制限**: `python:3.11-slim` は軽量だが、ビルドツールが含まれていないため、必要に応じて追加する必要がある
- **依存関係の確認**: Pythonパッケージのビルド要件を事前に確認し、必要なビルドツールをDockerfileに含める

**解決状況**: ✅ **解決済み**（2025-11-29）

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.nfc-agent`

---

---

### [KB-050] 軽量サイネージクライアントが自己署名証明書で画像を取得できない

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行655付近)

**事象**:
- Raspberry Pi 3 の軽量クライアントが `/api/signage/current-image` の取得に失敗し、`feh: No loadable images specified` でサービスが再起動を繰り返す
- `journalctl -u signage-lite` では `Failed to update image, using cached version` が連続し、`/var/cache/signage/current.jpg` が生成されない

**要因**:
- サーバー (Raspberry Pi 5) が自己署名証明書を使用しており、`signage-update.sh` の `curl` が証明書検証で失敗していた
- 初回取得が失敗するとキャッシュが存在せず `feh` が読み込む画像がないまま終了する

**試行した対策**:
- [試行1] ラズパイ3で手動 `curl https://...` を実行 → **成功**（`-k` オプションを付与した場合のみ成功することを確認）
- [試行2] `signage-update.sh` を手動で `curl -k` に書き換え → **成功**（画像取得に成功し、キャッシュが生成された）
- [試行3] セットアップスクリプトに `SIGNAGE_ALLOW_INSECURE_TLS` を追加し、初回起動時に画像が存在するまで待機 → **成功**

**有効だった対策**:
- ✅ **解決済み**（2025-11-30）:
  1. `scripts/client/setup-signage-lite.sh` で `SIGNAGE_ALLOW_INSECURE_TLS` (デフォルト:true) を導入し、自己署名証明書でも `curl -k` を自動付与
  2. 表示スクリプトで初回ダウンロードを試行し、キャッシュファイルが生成されるまでループ待機
  3. ドキュメントに証明書設定とトラブルシューティング手順を追記

**学んだこと**:
- 自己署名証明書を使用する閉域網では、クライアント側でも証明書検証を制御できる仕組みが必須
- 初回起動時にリソースが未取得だとビューアがクラッシュするため、待機＆再試行ロジックを組み込むべき
- スクリプトに環境変数フックを設けておくと、将来的に商用証明書へ切り替える際も柔軟に対応できる

**解決状況**: ✅ **解決済み**（2025-11-30）

**関連ファイル**:
- `scripts/client/setup-signage-lite.sh`
- `docs/modules/signage/signage-lite.md`
- `docs/knowledge-base/infrastructure.md`

---

---

### [KB-053] サイネージの自動レンダリング画像が更新されない（SIGNAGE_RENDER_DIRのパス不一致）

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行663付近)

**事象**:
- `/api/signage/current-image` を取得しても常に同じJPEGが返り、軽量クライアントに最新コンテンツが表示されない
- `docker compose exec api ls /app/storage/signage-rendered` では新しいファイルが増えるが、`current.jpg` のタイムスタンプが更新されない

**要因**:
- `SignageRenderStorage` のデフォルト保存先が `/opt/RaspberryPiSystem_002/storage/signage-rendered` で、APIコンテナ内の実パス `/app/storage/signage-rendered` と一致していなかった
- その結果、`current.jpg` はホスト側の未マウント領域に保存され、コンテナ内で参照されるパスは更新されなかった

**試行した対策**:
- [試行1] `current.jpg` を手動でコピー → **失敗**（自動レンダリングが再び古いパスに書き込む）
- [試行2] `signage-rendered` ボリュームを確認し、環境変数で保存先を上書き → **成功**

**有効だった対策**:
- ✅ **解決済み**（2025-11-30）:
  1. `docker-compose.server.yml` の `api` サービスに `SIGNAGE_RENDER_DIR=/app/storage/signage-rendered` を追加
  2. ボリューム `signage-rendered-storage` を同じパスにマウントし、ホストとコンテナで保存先を統一
  3. 再ビルド後に `current.jpg` の更新が再開し、軽量クライアントにも最新画像が配信されるようになった

**学んだこと**:
- コンテナとホストでストレージパスが異なる場合は、環境変数や `.env` で明示的に合わせる
- `current.jpg` の更新状況は `ls -lh` や `md5sum` で簡単に確認でき、問題切り分けに有効

**関連ファイル**:
- `infrastructure/docker/docker-compose.server.yml`
- `apps/api/src/lib/signage-render-storage.ts`

---

---

### [KB-057] SSH接続でホスト名解決が失敗しパスワード認証が通らない問題

**EXEC_PLAN.md参照**: Phase 2.4 実機テスト（2025-12-01）

**事象**: 
- MacからRaspberry Pi 5にSSH接続しようとしたが、パスワード認証が通らない
- RealVNC Viewerでは接続できているため、パスワードは正しい
- SSH鍵認証を設定したが機能しない
- ホスト名 `raspberrypi` で接続を試みたが、サーバー側のログに接続試行が記録されない
- IPアドレス `192.168.128.131` で接続すると成功する

**要因**: 
- **ホスト名解決の問題**: Mac側で `raspberrypi` というホスト名が正しいIPアドレス（`192.168.128.131`）に解決されていない
- Mac側の `/etc/hosts` やDNS設定に `raspberrypi` のエントリがない、または古いIPアドレスが登録されている可能性
- SSH接続時にホスト名解決が失敗し、別のホスト（または存在しないホスト）に接続しようとしていた
- そのため、サーバー側のログに接続試行が記録されず、パスワード認証も鍵認証も機能しなかった

**試行した対策**: 
- [試行1] SSH設定ファイルで `PasswordAuthentication yes` を確認・有効化 → **問題なし**（設定は正しい）
- [試行2] SSH設定ファイルで `PubkeyAuthentication yes` を確認・有効化 → **問題なし**（設定は正しい）
- [試行3] `authorized_keys` ファイルに公開鍵を登録 → **問題なし**（鍵は正しく登録されている）
- [試行4] SSHサーバーのログレベルをDEBUG3に上げて詳細ログを確認 → **接続試行が記録されない**
- [試行5] IPアドレスを直接指定して接続 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: IPアドレスを直接指定してSSH接続する
  - `ssh denkon5sd02@192.168.128.131` で接続成功
  - ホスト名解決の問題を回避できる
  - SSH鍵認証も正常に機能する

**学んだこと**: 
- **ホスト名解決の確認**: SSH接続が失敗する場合、まずホスト名が正しいIPアドレスに解決されているか確認する
- **IPアドレスでの接続**: ホスト名解決に問題がある場合は、IPアドレスを直接指定することで回避できる
- **ログの重要性**: サーバー側のログに接続試行が記録されない場合は、ホスト名解決の問題を疑う
- **SSH設定の確認**: パスワード認証や鍵認証の設定が正しくても、接続試行自体がサーバーに届かない場合は機能しない
- **RealVNCとの違い**: RealVNC Viewerでは接続できても、SSH接続でホスト名解決が失敗する場合がある

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `/etc/ssh/sshd_config`（Raspberry Pi 5側）
- `~/.ssh/authorized_keys`（Raspberry Pi 5側）
- `/etc/hosts`（Mac側、必要に応じて）

---

---

### [KB-059] ローカルアラートシステムのDockerコンテナ内からのファイルアクセス問題

**EXEC_PLAN.md参照**: Phase 2.4 実機テスト（2025-12-01）

**事象**: 
- 管理画面でアラートが表示されない
- `GET /api/clients/alerts` エンドポイントが404を返す
- `POST /api/clients/alerts/:id/acknowledge` エンドポイントが500エラーを返す
- アラートファイルはRaspberry Pi 5のホスト側に存在するが、APIコンテナからアクセスできない
- `process.cwd()`でアラートディレクトリを取得していたが、Dockerコンテナ内では正しいパスが取得できない

**要因**: 
- **Dockerコンテナ内の作業ディレクトリ**: APIコンテナ内で`process.cwd()`を使用していたが、コンテナ内の作業ディレクトリ（`/app`）とホスト側のディレクトリ（`/opt/RaspberryPiSystem_002/alerts`）が異なる
- **ボリュームマウントの未設定**: `docker-compose.server.yml`で`alerts/`ディレクトリがボリュームマウントされていなかった
- **環境変数の未設定**: `ALERTS_DIR`環境変数が設定されていなかった

**試行した対策**: 
- [試行1] アラートファイルを手動で生成して確認 → **ファイルは存在するがAPIからアクセスできない**
- [試行2] APIサーバーを再起動 → **問題が解決しない**
- [試行3] `process.cwd()`の代わりに環境変数を使用するように修正 → **成功**
- [試行4] `docker-compose.server.yml`に`alerts/`ディレクトリのボリュームマウントを追加 → **成功**
- [試行5] `ALERTS_DIR`環境変数を設定 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **環境変数の使用**: `process.cwd()`の代わりに`ALERTS_DIR`環境変数からアラートディレクトリのパスを取得
  2. **ボリュームマウントの追加**: `docker-compose.server.yml`で`alerts/`ディレクトリを`/app/alerts`にマウント
  3. **環境変数の設定**: APIコンテナに`ALERTS_DIR=/app/alerts`を設定

**学んだこと**: 
- **Dockerコンテナ内のパス**: コンテナ内の作業ディレクトリとホスト側のディレクトリは異なるため、`process.cwd()`は信頼できない
- **ボリュームマウントの重要性**: ホスト側のファイルシステムにアクセスするには、ボリュームマウントが必要
- **環境変数の活用**: パスなどの設定値は環境変数で管理することで、環境間の差異に対応できる
- **コンテナ再起動の必要性**: ボリュームマウントや環境変数の変更後は、コンテナの再起動が必要
- **ファイルベースのアラートシステム**: インターネット接続が不要なローカル環境での通知に有効

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `apps/api/src/routes/clients.ts`（アラートエンドポイント）
- `infrastructure/docker/docker-compose.server.yml`（ボリュームマウント設定）
- `scripts/generate-alert.sh`（アラート生成スクリプト）

---

---

### [KB-070] 運用モード可視化（ネットワークモード自動検出API）

**EXEC_PLAN.md参照**: Phase 1 IPアドレス管理の変数化と運用モード可視化（2025-12-04）、[security-hardening-execplan.md](../plans/security-hardening-execplan.md)

**事象**: 
- 現在の運用モード（ローカル/メンテナンス）が分からない
- インターネット接続の有無が分からない
- メンテナンス時に誤ってローカルネットワーク設定で操作してしまうリスクがある

**要因**: 
1. **可視化の不足**: 現在のネットワーク状態を表示する機能がなかった
2. **自動検出の不足**: インターネット接続の有無を自動的に検出する機能がなかった
3. **UI表示の不足**: 管理画面で運用モードが表示されていなかった

**試行した対策**: 
- [試行1] 環境変数で手動設定 → **失敗**（設定ミスのリスクがある）
- [試行2] 設定ファイルで管理 → **失敗**（動的な状態を反映できない）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. `/api/system/network-mode`エンドポイントを実装
  2. DNSルックアップ（`github.com`, `tailscale.com`, `cloudflare.com`）でインターネット接続を自動検出
  3. 接続あり → `{ mode: "maintenance", status: "internet_connected" }`
  4. 接続なし → `{ mode: "local", status: "local_network_only" }`
  5. 環境変数`NETWORK_STATUS_OVERRIDE`でテスト時に上書き可能にする
  6. 管理画面のヘッダーに`NetworkModeBadge`コンポーネントを追加
  7. React Queryで30秒ごとに自動更新
  8. バッジやアイコンで視覚的に表示（ローカル: 緑、メンテナンス: オレンジ）

**実装の詳細**:
- API側（`apps/api/src/routes/system/network-mode.ts`）:
  - `dns.promises.lookup()`でDNSルックアップを実行
  - タイムアウト2秒で複数のホストを試行
  - 接続成功したホスト名を`source`として返す
  - レイテンシを計測して返す
- フロントエンド側（`apps/web/src/components/NetworkModeBadge.tsx`）:
  - `useNetworkModeStatus`フックでAPIをポーリング（30秒間隔）
  - 検出モードと設定モードの不一致を警告表示
  - ネットワーク状態とレイテンシを表示
  - 最終更新時刻を表示

**学んだこと**: 
- DNSルックアップは軽量で、インターネット接続の検出に適している
- 複数のホストを試行することで、特定ホストの障害に影響されない
- タイムアウトを短く設定することで、レスポンス時間を短縮できる
- UIでの可視化により、運用ミスを防げる
- 環境変数での上書きにより、テストが容易になる

**解決状況**: ✅ **解決済み**（2025-12-04）

**関連ファイル**: 
- `apps/api/src/routes/system/network-mode.ts`
- `apps/api/src/routes/__tests__/network-mode.test.ts`
- `apps/api/src/config/env.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/api/hooks.ts`
- `apps/web/src/components/NetworkModeBadge.tsx`
- `apps/web/src/layouts/AdminLayout.tsx`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

---

### [KB-092] Pi4キオスクのGPUクラッシュ問題

**EXEC_PLAN.md参照**: 実機検証準備完了（2025-12-08）

**事象**: 
- Pi4キオスクがエンドレスエラー中
- ブラウザの開発者コンソールが開けない環境（フルスクリーン）でエラーの詳細が不明
- キオスク画面が表示されない、または頻繁にクラッシュする

**要因**: 
- ChromiumのGPUアクセラレーションがPi4のハードウェアと相性が悪い
- GPU関連エラー（SharedImage/GPU state invalid）が頻発
- メモリ不足やGPUリソース不足により、ブラウザプロセスがクラッシュ

**エラーログの例**:
```
ERROR:gpu/command_buffer/service/shared_image/shared_image_factory.cc:928] Could not find SharedImageBackingFactory
ERROR:gpu/ipc/service/shared_image_stub.cc:206] SharedImageStub: Unable to create shared image
ERROR:gpu/ipc/client/command_buffer_proxy_impl.cc:327] GPU state invalid after WaitForGetOffsetInRange
```

**試行した対策**: 
- [試行1] キオスクブラウザサービスを再起動 → **一時的解決**（再起動後は動作するが、時間が経つと再発）
- [試行2] Pi4を再起動 → **確認中**（ユーザー要請により実施）

**有効だった対策**: 
- ✅ **一時的解決**（2025-12-08）:
  1. `sudo -n systemctl restart kiosk-browser.service`でサービス再起動
  2. Pi4の再起動でGPUリソースをリセット

**推奨対策**（検討中）:
- **注意**: GPU無効化はCPU負荷を増加させる可能性があるため、慎重に検討が必要
- GPU無効化オプション: Chromium起動時に`--disable-gpu`を追加（CPU負荷増加のリスクあり）
- ソフトウェアレンダリング: `--use-gl=swiftshader`オプションを追加（CPU負荷増加のリスクあり）
- **代替案**: 
  1. GPUドライバーの更新・再インストール
  2. Chromiumのバージョン変更（より安定したバージョンへのダウングレード）
  3. メモリ使用量の最適化: 不要なタブや拡張機能を無効化
  4. 定期的な再起動スケジュール（cronで自動再起動）

**学んだこと**: 
- Pi4のChromiumでGPU関連エラーが頻発する可能性がある
- フルスクリーン環境ではブラウザコンソールが開けないため、systemdログで問題を特定する必要がある
- GPU無効化はCPU負荷を増加させるため、リソース制約のあるPi4では逆効果の可能性がある
- 再起動で一時的に解決するが、根本的な対策は慎重に検討が必要
- GPU関連エラーの根本原因（ドライバー、Chromiumバージョン、ハードウェア）を特定することが重要

**解決状況**: 🔄 **一時的解決**（2025-12-08、根本対策は検討中）

**関連ファイル**: 
- `/etc/systemd/system/kiosk-browser.service`
- `scripts/client/setup-kiosk.sh`

**次のステップ**（優先順位順）:
1. GPUドライバーの状態確認と更新
2. Chromiumのバージョン確認と安定版への変更検討
3. 定期的な再起動スケジュールの設定（cron）
4. メモリ使用量の最適化
5. GPU無効化は最後の手段として検討（CPU負荷増加のリスクを理解した上で）

---

---

### [KB-093] 計測機器APIの401エラー（期限切れJWTとx-client-keyの競合）

**EXEC_PLAN.md参照**: 計測機器管理システム実機検証（2025-12-10）

**事象**: 
- キオスクの計測機器持出画面（`/kiosk/instruments/borrow`）でドロップダウンが空になる
- APIログに`AUTH_TOKEN_INVALID`（401）エラーが連続して記録される
- `curl -H 'x-client-key: ...' http://localhost:8080/api/measuring-instruments`は成功するが、ブラウザからのリクエストは失敗

**APIエラーログの例**:
```json
{"level":40,"time":...,"errorCode":"AUTH_TOKEN_INVALID","errorMessage":"トークンが無効です","statusCode":401}
```

**要因**: 
- ブラウザが期限切れのJWTトークン（`Authorization: Bearer eyJ...`）と`x-client-key`の両方を送信
- APIの`allowView`関数が`Authorization`ヘッダーの存在を優先し、JWT認証失敗時に`x-client-key`へフォールバックしない実装だった

**問題のコード（修正前）**:
```typescript
const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
  if (request.headers.authorization) {
    await canView(request, reply);  // JWT失敗で例外→x-client-keyフォールバックなし
    return;
  }
  await allowClientKey(request);
};
```

**有効だった対策**: 
- ✅ **解決済み**（2025-12-10）: `allowView`と`allowWrite`を修正し、JWT認証失敗時に`x-client-key`へフォールバックするようtry-catchを追加

**修正後のコード**:
```typescript
const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
  if (request.headers.authorization) {
    try {
      await canView(request, reply);
      return;
    } catch {
      // JWT認証失敗時はx-client-keyへフォールバック
    }
  }
  await allowClientKey(request);
};
```

**学んだこと**: 
- ブラウザは古いJWTトークンを`localStorage`等に保持し続け、キオスク画面でも送信する可能性がある
- `Authorization`ヘッダーと`x-client-key`の両方が存在する場合の優先順位とフォールバックを明確に設計する必要がある
- キオスク向けAPIは`x-client-key`認証を確実にフォールバックとして機能させる必要がある

**解決状況**: ✅ **解決済み**（2025-12-10）

**関連ファイル**: 
- `apps/api/src/routes/measuring-instruments/index.ts`（`allowView`, `allowWrite`関数）
- `apps/api/src/lib/auth.ts`（`authorizeRoles`関数）

---

### [KB-130] Pi5のストレージ使用量が異常に高い問題（Docker Build Cacheとsignage-rendered履歴画像の削除）

**EXEC_PLAN.md参照**: ストレージ管理（2026-01-04）

**事象**: 
- Pi5のストレージ使用量が管理コンソールで27%（約270GB）と表示される
- 開発段階で1TBストレージの27%を使用するのは異常に高い
- `/var/lib/containerd`が224GBと最も大きい
- `/opt/RaspberryPiSystem_002/storage/signage-rendered`が15GBと大きい

**要因**: 
1. **Docker Build Cacheの蓄積**: `docker builder du`で確認すると237.2GBのreclaimable build cacheが存在
2. **signage-renderedの履歴画像の蓄積**: `signage_*.jpg`ファイルが13,519件（約6.2GB）蓄積されていたが、実際に使用されているのは`current.jpg`のみ

**調査手順**:
1. `df -hT`でディスク使用量を確認
2. `sudo du -sh /`でトップレベルのディレクトリサイズを確認
3. `/var/lib/containerd`を詳細調査（`docker system df`でDockerの使用量を確認）
4. `/opt/RaspberryPiSystem_002/storage/signage-rendered`を調査（`find -mtime +7`で7日超のファイルを確認）
5. `apps/api/src/lib/signage-render-storage.ts`と`apps/api/src/routes/signage/render.ts`を確認し、`current.jpg`のみが使用されていることを確認

**有効だった対策**: 
- ✅ **解決済み**（2026-01-04）:
  1. **signage-renderedの履歴画像削除**:
     - 7日超の`signage_*.jpg`ファイルを`_quarantine`ディレクトリに隔離
     - `current.jpg`が正常に存在し、`/api/signage/current-image`がHTTP 200を返すことを確認
     - 隔離ファイルを削除（6.2GB削減、15GB→8.1GB）
  2. **Docker Build Cache削除**:
     - `docker builder prune -a --force`でbuild cacheを削除（237.2GB→0B）
     - 稼働コンテナが正常に動作することを確認（docker-web-1, docker-api-1, docker-db-1）

**結果**:
- ディスク使用量: 249GB（27%）→23GB（3%）（約226GB削減）
- containerdディレクトリ: 224GB→3.7GB（約220GB削減）
- signage-renderedディレクトリ: 15GB→8.1GB（約6.9GB削減）
- Docker Build Cache: 237.2GB→0B（完全削除）

**学んだこと**: 
- Docker Build Cacheは開発中に大量に蓄積されるため、定期的に`docker builder prune`で削除する必要がある
- signage-renderedの履歴画像は`current.jpg`のみが使用されているため、古いファイルは定期的に削除すべき
- 削除前には必ず隔離→動作確認→削除の手順を踏むことで、システム破壊を防止できる
- `docker builder prune`は稼働中のコンテナには影響しない（build cacheのみを削除）

**解決状況**: ✅ **解決済み**（2026-01-04）

**関連ファイル**: 
- `apps/api/src/lib/signage-render-storage.ts`（signage画像の保存・読み込み）
- `apps/api/src/routes/signage/render.ts`（`/current-image`エンドポイント）
- `infrastructure/docker/docker-compose.server.yml`（signage-renderedストレージのマウント設定）

**推奨対策**:
- **ストレージ保存ポリシー（10年運用対応）**:
  1. **signage-renderedの履歴画像は保持しない**: `current.jpg`のみが運用上必要。`signage_*.jpg`は生成されないようにコードを修正済み（環境変数`SIGNAGE_RENDER_KEEP_HISTORY=1`で有効化可能だが、デフォルトは無効）。もし生成された場合は自動メンテナンスで削除される。
  2. **Docker Build Cacheの自動削除**: 月1回、`docker builder prune -a --force`でbuild cacheを削除（systemd timerで自動化済み）。
  3. **ストレージ使用量の監視**: 管理コンソールでストレージ使用量を監視し、70%で警告、80%でアラート、90%でクリティカルアラートを生成（`monitor.sh`で自動検知、ファイルベースアラート経由で管理コンソールに表示）。
  4. **自動メンテナンス**: `storage-maintenance.sh`がsystemd timerで毎日実行され、signage履歴画像の削除と月1回のbuild cache削除を自動実行。失敗時は`storage-maintenance-failed`アラートを生成。

---

### [KB-158] Macのstatus-agent未設定問題とmacOS対応

**EXEC_PLAN.md参照**: status-agent問題の診断と修正（2026-01-09）

**事象**:
- 管理コンソールでMacのステータスが表示されない（`lastSeen`が古い）
- MacにはLinux用の`status-agent.py`が存在していたが、macOSでは動作しない
- `launchd`設定ファイルが存在しなかった

**要因**:
- **プラットフォームの違い**: macOSでは`systemd`ではなく`launchd`を使用するため、Linux用のスクリプトでは動作しない
- **コマンドの違い**: macOSでは`ps`、`vm_stat`、`df`などのコマンドの出力形式がLinuxと異なる
- **設定ファイルの未作成**: macOS用の`launchd`設定ファイル（`.plist`）が存在しなかった

**調査手順**:
1. データベースで`ClientDevice`の`lastSeen`を確認（Macが古い）
2. Macで`status-agent.py`の存在を確認（Linux用スクリプトのみ存在）
3. Macで`status-agent`の設定ファイルを確認（存在しない）
4. Macで`launchd`設定ファイルを確認（存在しない）

**有効だった対策**:
- ✅ **解決済み**（2026-01-09）:
  1. **macOS用status-agentスクリプトの作成**:
     - `clients/status-agent/status-agent-macos.py`を作成
     - macOS用のコマンド（`ps`、`vm_stat`、`df`、`sysctl`）を使用してシステムメトリクスを取得
     - `platform.system()`でプラットフォームを判定し、macOS専用の処理を実装
  2. **macOS用設定ファイルの作成**:
     - `~/.status-agent.conf`を作成し、`API_BASE_URL`、`CLIENT_ID`、`CLIENT_KEY`、`LOCATION`を設定
     - `CLIENT_KEY`は管理コンソールで確認した値を設定
  3. **launchd設定ファイルの作成**:
     - `~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist`を作成
     - `StartInterval`を60秒に設定し、1分ごとに実行
     - `StandardOutPath`と`StandardErrorPath`を設定し、ログを記録
  4. **launchdサービスの有効化**:
     - `launchctl load ~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist`でサービスを有効化
     - `launchctl list | grep status-agent`でサービスが起動していることを確認
  5. **ドキュメント更新**:
     - `docs/guides/status-agent.md`にmacOS向けセットアップ手順を追加

**学んだこと**:
- **プラットフォームの違い**: macOSとLinuxでは、システムメトリクス取得のコマンドや出力形式が異なる
- **launchdとsystemdの違い**: macOSでは`systemd`ではなく`launchd`を使用するため、別の設定方法が必要
- **status-agentのプラットフォーム対応**: Linux用とmacOS用で別のスクリプトが必要（コマンドやAPIの違い）
- **設定ファイルの管理**: macOSでは`~/.status-agent.conf`と`~/Library/LaunchAgents/`に設定ファイルを配置する必要がある

**解決状況**: ✅ **解決済み**（2026-01-09: macOS用status-agent実装完了）

**関連ファイル**:
- `clients/status-agent/status-agent-macos.py`（macOS用status-agentスクリプト）
- `~/Library/LaunchAgents/com.raspberrypisystem.status-agent.plist`（macOS用launchd設定）
- `~/.status-agent.conf`（macOS用設定ファイル）
- `docs/guides/status-agent.md`（status-agentセットアップガイド）

**確認コマンド**:
```bash
# Macのstatus-agent状態確認
launchctl list | grep status-agent
cat ~/.status-agent.conf
tail -f ~/Library/Logs/com.raspberrypisystem.status-agent.log

# status-agentの手動実行（テスト）
python3 ~/RaspberryPiSystem_002/clients/status-agent/status-agent-macos.py
```

**macOS用status-agentの実装詳細**:
- **CPU使用率**: `ps`コマンドで全プロセスのCPU使用率を合計
- **メモリ使用率**: `vm_stat`コマンドでメモリ統計を取得し、使用率を計算
- **ディスク使用率**: `df`コマンドでディスク使用量を取得
- **温度**: macOSではCPU温度を直接取得できないため、`None`を返す
- **稼働時間**: `sysctl -n kern.boottime`で起動時刻を取得し、現在時刻との差分を計算

**再発防止策**:
- **プラットフォーム判定**: `platform.system()`でプラットフォームを判定し、適切なスクリプトを実行する
- **設定ファイルの管理**: macOS用の設定ファイルを`docs/guides/status-agent.md`に記載し、セットアップ手順を明確化
- **定期確認**: クライアント端末のステータスが定期的に更新されていることを確認する（管理コンソールの「クライアント端末」タブで確認）

**注意事項**:
- macOSではCPU温度を直接取得できないため、`temperature`フィールドは`None`になる
- `launchd`の設定ファイルは`~/Library/LaunchAgents/`に配置する必要がある（ユーザー固有の設定）
- システム全体の設定は`/Library/LaunchAgents/`または`/Library/LaunchDaemons/`に配置する（管理者権限が必要）

---

## KB-210: Pi3/Pi4でWi-Fi認証ダイアログが時々表示される問題

**発生日**: 2026-01-28

**事象**:
- Pi3やPi4で時々「Wi-Fiネットワークの認証が必要です」というダイアログが表示される
- ユーザーが「スクリーンショットのポップアップ」と認識していたが、実際にはWi-Fi認証ダイアログ
- 特定のWi-Fiネットワーク（例: `TP-Link_D2EC_5G_EXT`）への接続時にパスワード入力が求められる

**症状**:
- キオスク画面の上にWi-Fi認証ダイアログが表示される
- パスワード入力フィールドと「接続」「取り消し」ボタンが表示される
- ダイアログが表示されると、キオスク画面が操作できなくなる

**調査過程**:
1. **仮説1**: Chromiumブラウザの設定問題 → REJECTED（`GTK_USE_PORTAL=0`や`GNOME_KEYRING_CONTROL=""`は既に設定済み）
2. **仮説2**: NetworkManagerの自動接続設定 → CONFIRMED（保存済みのWi-Fiネットワークへの自動接続時に認証情報が不足）
3. **仮説3**: Wi-Fiパスワードが変更された → CONFIRMED（パスワード変更後、保存済みの認証情報が無効になっている可能性）

**根本原因**:
- NetworkManagerが保存済みのWi-Fiネットワークに自動接続を試みるが、認証情報が不足または無効
- キオスクブラウザの環境変数設定だけでは、NetworkManagerの認証ダイアログを抑制できない
- NetworkManagerの設定で、不要なネットワークへの自動接続が有効になっている

**解決方法**:
1. **NetworkManager設定の追加**（`infrastructure/ansible/roles/client/tasks/network.yml`）:
   - すべてのWi-Fi接続の自動接続を無効化（`connection.autoconnect no`）
   - NetworkManager.confに`no-auto-default=*`を追加（新しいネットワークへの自動接続を無効化）
   - NetworkManager.confに`auth-polkit=false`を追加（認証ダイアログを抑制）

2. **キオスクブラウザの環境変数追加**:
   - `kiosk-launch.sh.j2`と`kiosk-browser.service.j2`に以下を追加:
     - `NM_CLI_NO_TERSE=1`
     - `NM_CLI_NO_ASK_PASSWORD=1`

3. **必要なWi-Fiネットワークの事前設定**:
   - 使用するWi-Fiネットワークのパスワードを事前に設定し、自動接続を有効化
   - 不要なWi-Fiネットワークは「忘れる」設定を行う

**解決状況**: ✅ **解決済み**（2026-01-28）

**関連ファイル**:
- `infrastructure/ansible/roles/client/tasks/network.yml`（新規作成、NetworkManager設定）
- `infrastructure/ansible/roles/client/tasks/main.yml`（network.ymlのインポート追加）
- `infrastructure/ansible/templates/kiosk-launch.sh.j2`（環境変数追加）
- `infrastructure/ansible/templates/kiosk-browser.service.j2`（環境変数追加）

**再発防止策**:
- Ansibleデプロイ時に自動的にNetworkManager設定を適用
- 不要なWi-Fiネットワークへの自動接続を無効化
- 必要なWi-Fiネットワークのみを事前に設定し、パスワードを保存
- キオスクブラウザの環境変数でNetworkManagerの認証ダイアログを抑制

**運用上の注意**:
- 新しいWi-Fiネットワークを使用する場合は、事前に`nmcli`コマンドで接続設定を行う
- パスワードが変更された場合は、NetworkManagerの接続設定を更新する必要がある
- ダイアログが表示された場合は、「取り消し」を選択して、必要なネットワークのみを手動で設定する

**関連ナレッジ**:
- KB-158: Macのstatus-agent未設定問題とmacOS対応

---
