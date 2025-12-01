---
title: トラブルシューティングナレッジベース - インフラ関連
tags: [トラブルシューティング, インフラ, Docker, Caddy]
audience: [開発者, 運用者]
last-verified: 2025-11-30
related: [index.md, ../guides/deployment.md, ../guides/monitoring.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - インフラ関連

**カテゴリ**: インフラ関連  
**件数**: 22件  
**索引**: [index.md](./index.md)

---

### [KB-014] Caddyのリバースプロキシ設定が不適切

**EXEC_PLAN.md参照**: Surprises & Discoveries (行157-158)

**事象**: 
- `/borrow`が404の場合はCaddy側で`/api/*`が素の`/borrow`になっていた

**要因**: 
- Caddyfileの設定が不適切

**有効だった対策**: 
- ✅ **解決済み**（2025-11-20）: Caddyfileを`@api /api/* /ws/*` → `reverse_proxy @api api:8080`に固定し、パスを保持して転送するように変更

**学んだこと**: 
- Caddyのリバースプロキシ設定は、パスを保持して転送する必要がある
- `/api/*`パスを正しく転送するには、`reverse_proxy @api api:8080`の設定が必要

**解決状況**: ✅ **解決済み**（2025-11-20）

**関連ファイル**: 
- `infrastructure/docker/Caddyfile`

---

### [KB-025] Caddyfileのサムネイル配信パスが正しく設定されていない

**EXEC_PLAN.md参照**: Phase 6 実機テスト（2025-11-27）

**事象**: 
- `/storage/thumbnails/*`のパスでサムネイルファイルが配信されない
- curlでアクセスすると0バイトのファイルが返される
- 接続がリセットされるエラーが発生する

**要因**: 
- Caddyfileの`handle /storage/thumbnails/*`ブロック内で、`root * /srv/storage`と設定していたため、実際のファイルパスが`/srv/storage/storage/thumbnails/...`になってしまっていた
- `uri strip_prefix`ディレクティブが期待通りに動作しなかった

**有効だった対策**: 
- ✅ **解決済み**（2025-11-27）: `handle /storage/thumbnails/*`ブロック内で`rewrite * /storage/thumbnails{path} {path}`を使用してパスプレフィックスを削除し、`root * /srv/storage/thumbnails`を設定
- これにより、`/storage/thumbnails/2025/11/file.jpg`というURLが`/srv/storage/thumbnails/2025/11/file.jpg`のファイルを正しく参照できるようになった

**学んだこと**: 
- Caddyfileで`handle`ブロック内でパスを書き換えるには、`rewrite`ディレクティブを使用する
- `rewrite * /storage/thumbnails{path} {path}`の形式で、パスプレフィックスを削除できる
- `root`ディレクティブは、書き換え後のパスに対して適用される

**解決状況**: ✅ **解決済み**（2025-11-27）

**関連ファイル**: 
- `infrastructure/docker/Caddyfile`
- `infrastructure/docker/Caddyfile.production`

---

### [KB-015] Docker Composeのポート設定が不適切

**EXEC_PLAN.md参照**: Surprises & Discoveries (行147)

**事象**: 
- Webポートが4173ではなく80になっていた
- Caddyfileの設定が不適切

**要因**: 
- `docker-compose.server.yml`のポート設定が不適切
- Caddyfileの設定が不適切

**有効だった対策**: 
- ✅ **解決済み**（2025-11-19）: `docker-compose.server.yml`を`4173:80`に修正、Caddyfileを`:80` + SPA rewrite付きに更新、Dockerfile.webのCMDを`caddy run --config /srv/Caddyfile`に変更

**学んだこと**: 
- Docker Composeのポート設定は、正しく設定する必要がある
- Caddyfileの設定は、SPA rewriteを含める必要がある

**解決状況**: ✅ **解決済み**（2025-11-19）

**関連ファイル**: 
- `infrastructure/docker/docker-compose.server.yml`
- `infrastructure/docker/Caddyfile`
- `infrastructure/docker/Dockerfile.web`

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

### [KB-020] バックアップ・リストア機能の実装

**EXEC_PLAN.md参照**: 次のタスク (行118)

**事象**: 
- バックアップ・リストア機能が実装されていない

**要因**: 
- 機能が実装されていない

**有効だった対策**: 
- ✅ **実装完了**（2025-11-25）: バックアップ・リストアスクリプトを実装し、CIテストを追加

**学んだこと**: 
- バックアップ・リストア機能は、定期的に実行する必要がある
- CIテストを追加することで、機能の動作を確認できる

**解決状況**: ✅ **実装完了**（2025-11-25）

**関連ファイル**: 
- `scripts/server/backup.sh`
- `scripts/server/restore.sh`
- `scripts/test/backup-restore.test.sh`

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

### [KB-030] カメラAPIがHTTP環境で動作しない（HTTPS必須）

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- `navigator.mediaDevices.getUserMedia`がundefinedになりカメラが使用できない
- エラーメッセージ: `Cannot read properties of undefined (reading 'getUserMedia')`
- USBカメラは正しく認識されているにもかかわらず、ブラウザからアクセスできない

**要因**: 
- ブラウザのセキュリティ制約により、カメラAPI（`navigator.mediaDevices.getUserMedia`）はHTTPSまたはlocalhostでのみ動作する
- 工場環境では`http://192.168.10.230:4173`でアクセスしていたため、カメラAPIが利用不可だった

**試行した対策**: 
- [試行1] カメラ接続確認（`lsusb`、`v4l2-ctl --list-devices`）→ カメラは正しく認識されていることを確認
- [試行2] HTTP環境でカメラAPIを呼び出す → **失敗**（`navigator.mediaDevices`がundefined）
- [試行3] 自己署名証明書を生成してHTTPS環境を構築 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 工場環境向けに自己署名証明書を使用したHTTPS設定を実装
  1. `/opt/RaspberryPiSystem_002/certs/`に自己署名証明書（`cert.pem`、`key.pem`）を生成
  2. `infrastructure/docker/Caddyfile.local`を作成し、HTTPS（ポート443）で配信
  3. `infrastructure/docker/Dockerfile.web`を修正し、`USE_LOCAL_CERTS`環境変数で`Caddyfile.local`を選択
  4. `infrastructure/docker/docker-compose.server.yml`でポート80/443を公開し、証明書ボリュームをマウント

**学んだこと**: 
- ブラウザのカメラAPI（`navigator.mediaDevices`）はHTTPSまたはlocalhostでのみ動作する
- 工場などインターネット接続のない環境では、自己署名証明書を使用してHTTPS環境を構築する必要がある
- 自己署名証明書を使用する場合、ブラウザで証明書警告が表示されるが、「詳細設定」から続行できる
- 証明書の有効期限は10年（3650日）に設定し、長期運用に対応

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `infrastructure/docker/Caddyfile.local`
- `infrastructure/docker/Dockerfile.web`
- `infrastructure/docker/docker-compose.server.yml`
- `/opt/RaspberryPiSystem_002/certs/cert.pem`（ラズパイ5上）
- `/opt/RaspberryPiSystem_002/certs/key.pem`（ラズパイ5上）

---

### [KB-031] WebSocket Mixed Content エラー（HTTPSページからws://への接続）

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- HTTPSページから`ws://192.168.10.223:7071/stream`への接続がブラウザでブロックされる
- エラーメッセージ: `Mixed Content: The page at 'https://...' was loaded over HTTPS, but attempted to connect to the insecure WebSocket endpoint 'ws://...'. This request has been blocked; this endpoint must be available over WSS.`

**要因**: 
- ブラウザのMixed Content制限により、HTTPSページから非セキュアなWebSocket（ws://）への接続がブロックされる
- NFCエージェントはラズパイ4で動作しており、直接HTTPSに対応させるのは困難

**試行した対策**: 
- [試行1] `useNfcStream.ts`で`ws://`を`wss://`に自動変換 → **部分的に成功**（ブラウザエラーは解消したが、接続先がない）
- [試行2] Caddyfile.localに`/ws/*`パスのWebSocketプロキシを追加 → **失敗**（502エラー）
- [試行3] WebSocketプロキシのパスを`/stream`に変更し、NFCエージェントに直接プロキシ → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: Caddyをリバースプロキシとして使用し、`wss://`を`ws://`に変換
  1. `apps/web/src/hooks/useNfcStream.ts`を修正し、HTTPSページでは自動的に`wss://`を使用
  2. `infrastructure/docker/Caddyfile.local`に`/stream`パスのWebSocketプロキシを追加
  3. HTTPバージョンを`1.1`に指定してWebSocketハンドシェイクを正しく処理
  4. `@spa`ブロックから`/stream`パスを除外して、プロキシが優先されるように設定

**学んだこと**: 
- HTTPSページから非セキュアなWebSocketへの接続は、ブラウザのMixed Content制限によりブロックされる
- Caddyをリバースプロキシとして使用することで、`wss://`を`ws://`に変換できる
- WebSocketプロキシでは、HTTPバージョンを`1.1`に指定する必要がある（HTTP/2ではWebSocketハンドシェイクが正しく動作しない場合がある）
- SPAリライトよりもWebSocketプロキシを優先するため、`@spa`ブロックから該当パスを除外する必要がある

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `apps/web/src/hooks/useNfcStream.ts`
- `infrastructure/docker/Caddyfile.local`

---

### [KB-032] Caddyfile.local のHTTPバージョン指定エラー

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- Caddyが起動時にエラーで停止する
- エラーメッセージ: `unsupported HTTP version: h1, supported version: 1.1, 2, h2c, 3`

**要因**: 
- Caddyfile.localで`transport http { versions h1 }`と指定していたが、`h1`は無効な値
- Caddyの正しい指定は`1.1`（数値形式）

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: `versions h1`を`versions 1.1`に修正

**学んだこと**: 
- Caddyのtransport設定でHTTPバージョンを指定する場合、`1.1`、`2`、`h2c`、`3`のいずれかを使用する
- `h1`という省略形は使用できない
- Caddyのエラーメッセージは詳細で、サポートされているバージョンを明示してくれる

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `infrastructure/docker/Caddyfile.local`

---

### [KB-033] docker-compose.server.yml のYAML構文エラー（手動編集による破壊）

**EXEC_PLAN.md参照**: Phase 6 実機テスト（USB接続カメラ連携）（2025-11-28）

**事象**: 
- `docker compose config`で`yaml: line XX: did not find expected '-' indicator`エラー
- `docker compose up`でコンテナが起動しない
- 複数のYAML構文エラーが連鎖的に発生

**要因**: 
- ラズパイ5上で直接`sed`コマンドやPythonスクリプトを使用してYAMLファイルを編集したため、構文が壊れた
- 具体的な問題:
  1. `environment:`キーの欠落（インデントの誤り）
  2. 複数の`environment:`ブロックが不正な位置に挿入された
  3. 文字化けによる不正な文字の混入

**試行した対策**: 
- [試行1] `sed`コマンドで`environment:`行を挿入 → **失敗**（インデントが正しくない）
- [試行2] Pythonスクリプトで行を挿入 → **失敗**（ロケールの問題でUnicodeDecodeError）
- [試行3] `nano`エディタで直接編集 → **失敗**（文字化けで編集困難）
- [試行4] `git checkout -- infrastructure/docker/docker-compose.server.yml`で元に戻す → **成功**
- [試行5] Mac側でファイルを修正し、git pushしてラズパイでgit pull → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-28）: 
  1. `git checkout -- infrastructure/docker/docker-compose.server.yml`で元のファイルに戻す
  2. Mac側（開発環境）でファイルを正しく修正
  3. `git commit`と`git push`でリモートリポジトリを更新
  4. ラズパイ5で`git pull`して最新の正しいファイルを取得
  5. `docker compose up -d --force-recreate --build`で再ビルド

**学んだこと**: 
- **YAMLファイルを直接編集しない**: 特にラズパイなどの本番環境では、`sed`やPythonスクリプトでYAMLを編集するのは危険
- **Gitワークフローを遵守する**: 設定変更は開発環境（Mac）で行い、git経由でデプロイする
- **YAMLの構文エラーは連鎖する**: 1箇所の誤りが複数のエラーを引き起こす
- **`docker compose config`で検証**: 変更後は`docker compose config > /dev/null && echo "OK"`で構文を検証する
- **`git checkout`で復旧**: 構文が壊れた場合は、`git checkout`で元のファイルに戻すのが最も確実

**解決状況**: ✅ **解決済み**（2025-11-28）

**関連ファイル**: 
- `infrastructure/docker/docker-compose.server.yml`

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

### [KB-056] 工具スキャンが二重登録される問題（NFCエージェントのキュー処理改善）

**EXEC_PLAN.md参照**: Phase 8 / Surprises & Discoveries (行655付近)

**事象**: 
- タグを1回スキャンしても、貸出が2件登録されることがある
- 再現性が100%ではなく、時折発生する
- タグのスキャンは1回しかしていないことは確実

**要因**: 
- NFCエージェントがイベントをSQLiteキューに**常に追加するだけで削除していなかった**
- Pi4のエージェントを再起動したり、WebSocketを張り直すたびに「過去の履歴」が再送され、同じUIDが複数回フロントへ届いていた
- フロント側の重複排除は「`uid + timestamp`」をキーにしているため、再送時は新しいタイムスタンプとなり、借用処理が二度実行されていた

**試行した対策**: 
- [試行1] フロント側の重複排除ロジックを確認 → **問題なし**（`uid + timestamp`で正しく重複排除している）
- [試行2] NFCエージェントのキュー処理を確認 → **問題発見**（オンライン時もキューに残っていた）
- [試行3] オンライン時にイベントを即座に配信し、配信成功したイベントはキューから削除するように変更 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-11-30）:
  1. `WebSocketManager.broadcast()` が「1件でも送信に成功したか」を返すように変更
  2. イベントキューへ書き込むたびに挿入IDを受け取り、**配信に成功したイベントは即時削除**するように変更
  3. SQLiteの `enqueue` が挿入IDを返すよう修正
  4. これにより、オンライン時のイベントは蓄積せず、オフライン時だけキューに残る設計になった

**学んだこと**: 
- **キュー処理の設計**: オンライン時は即座に配信し、オフライン時だけキューに残す設計が重要
- **再送時のタイムスタンプ**: 再送時にタイムスタンプが更新されると、フロント側の重複排除が機能しない
- **イベントのライフサイクル**: イベントは「生成 → キュー追加 → 配信 → 削除」の流れを明確にする必要がある
- **SQLiteの挿入ID**: `lastrowid` を使用して挿入IDを取得できる

**解決状況**: ✅ **解決済み**（2025-11-30）

**関連ファイル**: 
- `clients/nfc-agent/nfc_agent/main.py`
- `clients/nfc-agent/nfc_agent/queue_store.py`

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

### [KB-058] Ansible接続設定でRaspberry Pi 3/4への接続に失敗する問題（ユーザー名・SSH鍵・サービス存在確認）

**EXEC_PLAN.md参照**: Phase 1 実機テスト（2025-12-01）

**事象**: 
- Raspberry Pi 5からAnsibleでRaspberry Pi 4とRaspberry Pi 3への接続テストが失敗
- `ansible all -i infrastructure/ansible/inventory.yml -m ping` で `Permission denied (publickey,password)` エラー
- インベントリファイルで `ansible_user: pi` と指定していたが、実際のユーザー名が異なる
- Raspberry Pi 4のユーザー名は `tools03`、Raspberry Pi 3のユーザー名は `signageras3`
- SSH鍵認証を設定する際、各クライアントに公開鍵を追加する必要があった
- プレイブック実行時に `owner: pi` と `group: pi` が指定されていたが、実際のユーザー名と不一致でエラー
- プレイブックで指定されたサービス（`signage-lite.service`、`kiosk-browser.service`）がRaspberry Pi 4に存在しないため、サービス再起動タスクが失敗

**要因**: 
- **インベントリファイルのユーザー名設定**: デフォルトで `ansible_user: pi` と設定されていたが、実際のクライアントでは異なるユーザー名が使用されていた
- **SSH鍵認証の未設定**: Raspberry Pi 5から各クライアントへのSSH鍵認証が設定されていなかった
- **プレイブックのユーザー名ハードコーディング**: プレイブック内で `owner: pi` と `group: pi` がハードコーディングされていた
- **サービス存在の前提**: プレイブックが全クライアントに同じサービスが存在することを前提としていたが、実際にはクライアントごとに異なるサービスが稼働していた

**試行した対策**: 
- [試行1] インベントリファイルで `ansible_user: pi` を確認 → **失敗**（実際のユーザー名が異なる）
- [試行2] `--ask-pass` オプションでパスワード認証を試行 → **パスワードが不明**
- [試行3] Raspberry Pi 5でSSH鍵を生成し、各クライアントに公開鍵を追加 → **成功**
  - `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""` で鍵を生成
  - RealVNC経由で各クライアントに接続し、`~/.ssh/authorized_keys` に公開鍵を追加
- [試行4] インベントリファイルで各ホストごとにユーザー名を指定 → **成功**
  - `raspberrypi4` に `ansible_user: tools03`、`raspberrypi3` に `ansible_user: signageras3` を設定
- [試行5] プレイブックの `owner: pi` を `owner: "{{ ansible_user }}"` に変更 → **成功**
- [試行6] サービス再起動タスクに `ignore_errors: true` を追加 → **成功**（存在しないサービスをスキップ）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **SSH鍵認証の設定**: Raspberry Pi 5でSSH鍵を生成し、各クライアントに公開鍵を追加
  2. **インベントリファイルのユーザー名設定**: 各ホストごとに正しいユーザー名を指定
  3. **プレイブックのユーザー名動的化**: `owner: "{{ ansible_user }}"` で動的にユーザー名を設定
  4. **サービス存在チェック**: `ignore_errors: true` で存在しないサービスをスキップ

**学んだこと**: 
- **インベントリファイルの重要性**: 各クライアントの実際のユーザー名を正確に設定することが重要
- **SSH鍵認証の設定**: パスワード認証に頼らず、SSH鍵認証を設定することで自動化が可能になる
- **プレイブックの柔軟性**: ユーザー名やサービス名をハードコーディングせず、変数や条件分岐を使用する
- **クライアント間の差異**: 全クライアントが同じ設定・サービスを持つとは限らないため、エラーハンドリングが重要
- **RealVNC経由での設定**: SSH接続が確立する前は、RealVNC経由で設定を行うことが有効
- **段階的な問題解決**: 接続→認証→プレイブック実行の順で段階的に問題を解決する

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `infrastructure/ansible/inventory.yml`（インベントリファイル）
- `infrastructure/ansible/playbooks/update-clients.yml`（更新プレイブック）
- `~/.ssh/id_ed25519.pub`（Raspberry Pi 5側の公開鍵）
- `~/.ssh/authorized_keys`（各クライアント側）

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

### [KB-060] Dockerコンテナ内からNFCリーダー（pcscd）にアクセスできない問題

**EXEC_PLAN.md参照**: Phase 2.4 実機テスト（2025-12-01）

**事象**: 
- Raspberry Pi 4のキオスクでNFCリーダーからのタグスキャンが機能しない
- `curl http://localhost:7071/api/agent/status` で `readerConnected: false` が返る
- `Service not available. (0x8010001D)` エラーが発生する
- `Failed to establish context` エラーが発生する
- `pcsc_scan`はrootで動作するが、一般ユーザーでは動作しない
- Dockerコンテナ内から`pcscd`にアクセスできない

**要因**: 
- **Dockerコンテナ内からのpcscdアクセス**: Dockerコンテナ内からホストの`pcscd`デーモンにアクセスするには、`/run/pcscd/pcscd.comm`ソケットファイルへのアクセスが必要だが、`docker-compose.client.yml`に`/run/pcscd`のマウントが設定されていなかった
- **polkit設定ファイルの削除**: `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`が削除された（`git clean`など）ため、polkitが`pcscd`へのアクセスを拒否していた
- **ポート7071の競合**: 古い`nfc_agent`プロセスがポート7071を占有していた

**試行した対策**: 
- [試行1] `pcscd`サービスを再起動 → **失敗**（コンテナ内からアクセスできない）
- [試行2] `tools03`ユーザーを`pcscd`グループに追加 → **失敗**（グループが存在しない）
- [試行3] `pcscd.service`に`--ignore-polkit`オプションを追加 → **一時的に有効だが、設定がリセットされた**
- [試行4] `/etc/polkit-1/rules.d/`ディレクトリが存在しないことを確認 → **polkit設定ファイルが削除されていた**
- [試行5] polkit設定ファイルを再作成 → **成功**（一般ユーザーで`pcsc_scan`が動作）
- [試行6] `docker-compose.client.yml`に`/run/pcscd`のマウントを追加 → **成功**（コンテナ内から`pcscd`にアクセス可能）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **polkit設定ファイルの再作成**: `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`を作成して、すべてのユーザーが`pcscd`にアクセスできるように設定
  2. **Dockerコンテナへの`/run/pcscd`マウント**: `docker-compose.client.yml`の`volumes`セクションに`/run/pcscd:/run/pcscd:ro`を追加
  3. **コンテナの再作成**: ボリュームマウント設定を反映するため、コンテナを再作成

**学んだこと**: 
- **Dockerコンテナからのホストサービスアクセス**: ホストのデーモン（`pcscd`など）にアクセスするには、ソケットファイル（`/run/pcscd/pcscd.comm`）へのアクセスが必要で、ボリュームマウントで明示的にマウントする必要がある
- **polkit設定の重要性**: `pcscd`はpolkitを使用してアクセス制御を行っており、設定ファイルが削除されると一般ユーザーからアクセスできなくなる
- **git cleanの影響**: `git clean -fd`などの操作で、`.gitignore`に含まれていない設定ファイル（`/etc/polkit-1/rules.d/`など）が削除される可能性がある
- **システム設定ファイルの保護**: `/etc/`配下の設定ファイルは、`.gitignore`に追加するか、Ansibleなどの設定管理ツールで管理する必要がある
- **コンテナ再作成の必要性**: ボリュームマウント設定を変更した場合は、コンテナの再作成が必要

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `infrastructure/docker/docker-compose.client.yml`（`/run/pcscd`のマウント設定）
- `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`（polkit設定ファイル）
- `docs/modules/tools/operations.md`（NFCリーダーのトラブルシューティング手順）
- `docs/troubleshooting/nfc-reader-issues.md`（NFCリーダーの詳細なトラブルシューティング）

---