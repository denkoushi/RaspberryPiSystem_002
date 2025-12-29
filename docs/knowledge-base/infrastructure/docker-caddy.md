---
title: トラブルシューティングナレッジベース - Docker/Caddy関連
tags: [トラブルシューティング, インフラ]
audience: [開発者, 運用者]
last-verified: 2025-12-29
related: [../index.md, ../../guides/deployment.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - Docker/Caddy関連

**カテゴリ**: インフラ関連 > Docker/Caddy関連  
**件数**: 8件  
**索引**: [index.md](../index.md)

Docker ComposeとCaddyリバースプロキシに関するトラブルシューティング情報

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

---

### [KB-063] WebSocket接続エラー（502）: Caddyの環境変数置換が機能しない

**EXEC_PLAN.md参照**: なし（2025-12-02発生）

**事象**: 
- Pi4のキオスク画面で `WebSocket connection to 'wss://192.168.10.230/stream' failed: Error during WebSocket handshake: Unexpected response code: 502` エラーが発生
- Caddyのログに `dial tcp 192.168.128.102:7071: i/o timeout` エラーが記録される
- NFCイベントが受信できないため、カメラ撮影機能が動作しない

**要因**: 
- `Dockerfile.web`の`envsubst`コマンドの引数が不適切で、環境変数`NFC_AGENT_HOST`が正しく置換されていなかった
- `Caddyfile.local.template`内の`$NFC_AGENT_HOST`が古いIPアドレス（`192.168.128.102`）のまま残っていた
- シェル環境変数に古いIPアドレスが設定されていた可能性がある

**試行した対策**: 
- [試行1] `envsubst '$$NFC_AGENT_HOST'` → **失敗**（エスケープが不適切）
- [試行2] `envsubst '\$NFC_AGENT_HOST'` → **失敗**（変数名が正しく認識されない）
- [試行3] `envsubst '${NFC_AGENT_HOST}'` → **失敗**（envsubstの引数形式が誤り）
- [試行4] `envsubst`（引数なし）→ **成功**（すべての環境変数を置換）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-02）:
  1. `Dockerfile.web`の`CMD`を修正し、`envsubst`の引数を削除してすべての環境変数を自動的に置換するように変更
  2. `.env`ファイルに`NFC_AGENT_HOST=192.168.10.223`を設定
  3. シェル環境変数を明示的に設定してからDocker Composeを起動
  4. `docker-compose.server.yml`の`environment`セクションで`NFC_AGENT_HOST: ${NFC_AGENT_HOST:-192.168.10.223}`を設定（デフォルト値付き）

**学んだこと**: 
- `envsubst`コマンドは引数を指定しない場合、すべての環境変数を自動的に置換する
- 引数を指定する場合は、`envsubst '$VAR1 $VAR2'`のようにシングルクォートで囲む必要がある
- Docker Composeの環境変数は`.env`ファイル、シェル環境変数、`docker-compose.yml`の順で優先順位が決まる
- ネットワーク変更時は、`.env`ファイルとシェル環境変数の両方を確認する必要がある

**解決状況**: ✅ **解決済み**（2025-12-02）

**関連ファイル**: 
- `infrastructure/docker/Dockerfile.web`
- `infrastructure/docker/Caddyfile.local.template`
- `infrastructure/docker/docker-compose.server.yml`
- `.env`（プロジェクトルート）

---

---
