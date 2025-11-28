---
title: トラブルシューティングナレッジベース - インフラ関連
tags: [トラブルシューティング, インフラ, Docker, Caddy]
audience: [開発者, 運用者]
last-verified: 2025-11-27
related: [index.md, ../guides/deployment.md, ../guides/monitoring.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - インフラ関連

**カテゴリ**: インフラ関連  
**件数**: 13件  
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

