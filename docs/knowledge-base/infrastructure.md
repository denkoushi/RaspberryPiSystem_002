---
title: トラブルシューティングナレッジベース - インフラ関連
tags: [トラブルシューティング, インフラ, Docker, Caddy]
audience: [開発者, 運用者]
last-verified: 2025-12-10
related: [index.md, ../guides/deployment.md, ../guides/monitoring.md]
category: knowledge-base
update-frequency: medium
---

# トラブルシューティングナレッジベース - インフラ関連

**カテゴリ**: インフラ関連  
**件数**: 50件  
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

### [KB-083] サイネージカードレイアウトが崩れる（2カラム固定・サムネ比率）

**EXEC_PLAN.md参照**: Progress (2025-12-06)

**事象**: 
- 工具カードの列幅が不揃いで間延びし、サムネイルの縦横比も崩れて表示が潰れる。ヘッダ文字が大きく表示領域が狭い。

**要因**: 
- サムネイルを`contain`で描画して余白が生じ、列数も可変でグリッドが緩みやすかった。clipがないため角丸内に収まらず、視覚的に崩れていた。

**有効だった対策**: 
- `SignageRenderer`でカード列を2カラムに固定し、gapを20px相当に統一。サムネイルを16:9相当＋`cover`＋`clipPath`で角丸内に収め、タイトル/テキストを縮小。
- Pi5で `docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build api` を実行してデプロイ。Pi3/4への操作は従来通りPi5経由SSHのみで行い、Pi3は`signage-lite`再起動で反映予定。

**学んだこと**: 
- サイネージのカードレイアウトは列数と幅を固定し、サムネイルは`cover`＋`clipPath`で比率と角丸を両立させると崩れを防げる。

**解決状況**: 🔄 進行中（Pi3実機での最終表示確認待ち）

**関連ファイル**: 
- `apps/api/src/services/signage/signage.renderer.ts`
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

### [KB-061] Ansible実装後の設定ファイル削除問題と堅牢化対策

**EXEC_PLAN.md参照**: Ansible堅牢化・安定化計画 (2025-12-01)

**事象**: 
- `git clean -fd`を実行すると、`storage/`と`certs/`が削除された（写真ファイル、PDFファイル、自己署名証明書が消失）
- `/etc/polkit-1/rules.d/50-pcscd-allow-all.rules`が削除され、NFCリーダーが使用不能になった
- システム設定ファイルの管理方針が不明確で、削除されても自動復旧できない

**要因**: 
- **`git clean`の危険性**: `.gitignore`に含まれていないファイルが削除される
- **システム設定ファイルの管理不足**: `/etc/`配下の設定ファイルがAnsibleで管理されていない
- **保護ディレクトリの不足**: `alerts/`と`logs/`が除外されていない

**試行した対策**: 
- [試行1] `.gitignore`に`storage/`と`certs/`を追加 → **成功**（これらのディレクトリは保護された）
- [試行2] `git clean`コマンドで`storage/`と`certs/`を除外 → **成功**（一時的な対策）
- [試行3] polkit設定ファイルを手動で再作成 → **成功**（一時的な復旧）
- [試行4] Ansibleでpolkit設定ファイルを管理するプレイブックを作成 → **成功**（自動復旧可能に）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **`git clean`の改善**: `alerts/`と`logs/`を除外リストに追加し、コメントで`/etc/`配下の設定ファイルについて説明を追加
  2. **polkit設定ファイルのAnsible管理化**: `infrastructure/ansible/templates/polkit-50-pcscd-allow-all.rules.j2`を作成し、`update-clients.yml`に統合
  3. **バックアップ機能の実装**: `scripts/ansible-backup-configs.sh`を作成し、設定ファイルのバックアップを自動化
  4. **ロールバック機能の実装**: `infrastructure/ansible/playbooks/rollback.yml`を作成し、設定ファイルの自動復旧を可能に
  5. **ドキュメント化**: `docs/plans/ansible-hardening-stabilization-plan.md`と`docs/guides/ansible-managed-files.md`を作成し、管理方針を明確化

**学んだこと**: 
- **`git clean`のリスク**: `.gitignore`に含まれていないファイルは削除されるため、保護が必要なディレクトリは明示的に除外する必要がある
- **システム設定ファイルの管理**: `/etc/`配下の設定ファイルはGitリポジトリ外にあるが、Ansibleで管理することで削除されても自動復旧できる
- **Ansibleの堅牢化**: 設定ファイルのバックアップとロールバック機能を実装することで、誤削除時の影響を最小限に抑えられる
- **ドキュメント化の重要性**: 管理方針を明確化することで、将来の同様の問題を防げる

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `infrastructure/ansible/playbooks/update-clients.yml`（`git clean`の改善、polkit設定ファイルの管理）
- `infrastructure/ansible/templates/polkit-50-pcscd-allow-all.rules.j2`（polkit設定ファイルテンプレート）
- `infrastructure/ansible/playbooks/manage-system-configs.yml`（システム設定ファイル管理プレイブック）
- `infrastructure/ansible/playbooks/rollback.yml`（ロールバックプレイブック）
- `scripts/ansible-backup-configs.sh`（設定ファイルバックアップスクリプト）
- `docs/plans/ansible-hardening-stabilization-plan.md`（Ansible堅牢化・安定化計画）
- `docs/guides/ansible-managed-files.md`（Ansibleで管理すべき設定ファイル一覧）

---

### [KB-062] Ansible設定ファイル管理化の実装（systemdサービス・アプリケーション設定）

**EXEC_PLAN.md参照**: Ansible設定ファイル管理化実装計画 (2025-12-01)

**事象**: 
- `kiosk-browser.service`、`signage-lite.service`がAnsibleで管理されていないため、削除されても自動復旧できない
- アプリケーション設定ファイル（`.env`）が手動管理のため、IP変更時などに手動作業が必要
- 実用段階に達するために必要な設定ファイルの管理化が未実装

**要因**: 
- **systemdサービスファイルの未管理**: `kiosk-browser.service`、`signage-lite.service`がテンプレート化されていない
- **アプリケーション設定ファイルの未管理**: API/Web/NFCエージェント/Docker Composeの`.env`ファイルがAnsibleで管理されていない
- **環境変数の管理方針の不明確化**: 機密情報の扱い方針が明確でない

**試行した対策**: 
- [試行1] `kiosk-browser.service`テンプレートを作成 → **成功**
- [試行2] `signage-lite.service`テンプレートを作成 → **成功**
- [試行3] `manage-system-configs.yml`にsystemdサービス管理タスクを追加 → **成功**
- [試行4] `manage-app-configs.yml`プレイブックを作成 → **成功**
- [試行5] 各`.env`ファイルのテンプレートを作成 → **成功**

**有効だった対策**: 
- ✅ **解決済み**（2025-12-01）: 以下の対策を組み合わせて解決
  1. **systemdサービスファイルのテンプレート化**: `infrastructure/ansible/templates/kiosk-browser.service.j2`、`infrastructure/ansible/templates/signage-lite.service.j2`を作成
  2. **manage-system-configs.ymlへの統合**: systemdサービス管理タスクを追加し、条件分岐で適切なホストにのみデプロイ
  3. **アプリケーション設定ファイルの管理化**: `infrastructure/ansible/playbooks/manage-app-configs.yml`を作成し、API/Web/NFCエージェント/Docker Composeの`.env`ファイルをテンプレート化
  4. **inventory.ymlへの変数追加**: 環境変数の値をinventory.ymlで管理し、環境ごとの差異に対応
  5. **機密情報の扱い明確化**: テンプレートにコメントを追加し、Ansible Vaultの使用を推奨

**学んだこと**: 
- **systemdサービスファイルの管理**: テンプレート化することで、設定変更をAnsibleで一元管理できる
- **アプリケーション設定ファイルの管理**: `.env`ファイルをテンプレート化することで、IP変更などの環境変更に対応しやすくなる
- **条件分岐の重要性**: クライアントごとに異なるサービスを管理するため、`when`条件で適切に分岐する必要がある
- **機密情報の扱い**: JWT_SECRETなどの機密情報はAnsible Vaultで暗号化するか、inventory.ymlで変数として管理する
- **実用段階への到達**: 重要な設定ファイルをAnsibleで管理することで、実用段階に到達できる

**解決状況**: ✅ **解決済み**（2025-12-01）

**関連ファイル**: 
- `infrastructure/ansible/templates/kiosk-browser.service.j2`（キオスクブラウザサービステンプレート）
- `infrastructure/ansible/templates/signage-lite.service.j2`（サイネージサービステンプレート）
- `infrastructure/ansible/playbooks/manage-system-configs.yml`（システム設定ファイル管理プレイブック）
- `infrastructure/ansible/playbooks/manage-app-configs.yml`（アプリケーション設定ファイル管理プレイブック）
- `infrastructure/ansible/templates/api.env.j2`（API環境変数テンプレート）
- `infrastructure/ansible/templates/web.env.j2`（Web環境変数テンプレート）
- `infrastructure/ansible/templates/nfc-agent.env.j2`（NFCエージェント環境変数テンプレート）
- `infrastructure/ansible/templates/docker.env.j2`（Docker Compose環境変数テンプレート）
- `infrastructure/ansible/inventory.yml`（環境変数の変数定義）
- `docs/plans/ansible-config-files-management-plan.md`（実装計画）

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

### [KB-066] ラズパイ3でのAnsibleデプロイ失敗（サイネージ稼働中のリソース不足・自動再起動・401エラー）

**EXEC_PLAN.md参照**: Phase 3 自動バックアップ＆ロールバック実装（2025-12-02）

**事象**: 
- ラズパイ3でAnsibleデプロイが失敗する
- デプロイ中にサイネージ（signage-lite.service）が稼働しており、リソース不足で処理が不安定になる
- サイネージを停止しても`Restart=always`により自動的に再起動してしまう
- サイネージヘルスチェック（`/api/signage/render/status`）が401エラーを返し、デプロイが中断される
- ラズパイ4と5では成功していた（サイネージが稼働していないため）

**要因**: 
1. **リソース不足**: ラズパイ3はCPU/RAMが限られており、サイネージ稼働中にデプロイ処理（依存インストール、ファイルコピー等）を実行するとリソース競合が発生
2. **自動再起動**: `signage-lite.service`に`Restart=always`が設定されており、`systemctl stop`しても自動的に再起動してしまう
3. **認証エラー**: サイネージヘルスチェックエンドポイントが認証トークンを要求するが、Ansibleからは`x-client-key`ヘッダーのみ送信しており、401エラーが発生

**試行した対策**: 
- [試行1] デプロイ前にサイネージを停止 → **失敗**（自動再起動してしまう）
- [試行2] `systemctl mask`でサービスをマスク → **失敗**（サービスファイルが存在する場合は使用不可）
- [試行3] `systemctl disable`で自動起動を無効化 → **成功**（自動再起動を防止）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-02）:
  1. デプロイ前に`signage-lite.service`と`signage-lite-update.timer`を`enabled: false`で無効化し、その後停止
  2. デプロイ処理を実行（リソースに余裕を持たせる）
  3. デプロイ後に`enabled: true`で再有効化し、サービスを再起動
  4. サイネージヘルスチェックの401エラーを`failed_when: false`で警告として扱い、デプロイを継続

**学んだこと**: 
- リソースが限られた環境（ラズパイ3）では、デプロイ前に重いサービスを停止してリソースに余裕を持たせる必要がある
- `systemctl stop`だけでは`Restart=always`が設定されたサービスは自動再起動するため、`systemctl disable`で自動起動を無効化する必要がある
- `systemctl mask`はサービスファイルが存在しない場合のみ使用可能
- 認証が必要なエンドポイントのヘルスチェックは、失敗してもデプロイを継続できるように警告として扱うべき

**解決状況**: ✅ **解決済み**（2025-12-02）

**関連ファイル**: 
- `infrastructure/ansible/tasks/update-clients-core.yml`
- `infrastructure/ansible/playbooks/update-clients.yml`
- `infrastructure/ansible/inventory.yml`

---

### [KB-067] 工具スキャンが重複登録される問題（NFCエージェントのeventId永続化対策）

**EXEC_PLAN.md参照**: Phase 6 実機検証（2025-12-01）、[tool-management-debug-execplan.md](../plans/tool-management-debug-execplan.md)

**事象**: 
- NFCタグを1回しかスキャンしていないのに、1〜2件の貸出が勝手に追加される
- 再現性は100%ではないが、WebSocket再接続後などに発生しやすい
- 同じUIDのイベントが複数回処理される

**要因**: 
1. **キュー再送による重複**: NFCエージェントのキュー再送機能により、過去のイベントがWebSocket再接続時に再配信される
2. **フロントエンドの重複判定不足**: フロントエンドの重複判定がWebSocket切断時にリセットされるため、再送イベントを弾けない
3. **イベントIDの欠如**: WebSocket payloadに一意のeventIdが含まれておらず、タイムスタンプのみでは重複判定が不完全

**試行した対策**: 
- [試行1] フロントエンドで3秒以内の同一UIDを除外 → **部分的成功**（通常時は動作するが、WebSocket再接続時に失敗）
- [試行2] WebSocket再接続時にイベントキーをリセット → **失敗**（再送イベントを弾けない）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. NFCエージェントでSQLiteの`queued_events.id`を`eventId`としてWebSocket payloadに含める
  2. フロントエンドで`sessionStorage`に最後に処理した`eventId`を永続化
  3. `useNfcStream`フックで`eventId`の単調増加を監視し、過去のIDを弾く
  4. `eventId`が無い場合は従来の`uid:timestamp`方式でフォールバック

**学んだこと**: 
- WebSocket再接続時にフロントエンドの状態がリセットされるため、永続的なストレージ（`sessionStorage`）が必要
- タイムスタンプのみでは重複判定が不完全（再送イベントは新しいタイムスタンプを持つ可能性がある）
- イベントIDの単調増加を監視することで、確実に重複を防止できる
- SQLiteの`lastrowid`を活用することで、一意のIDを簡単に生成できる

**解決状況**: ✅ **解決済み**（2025-12-04）

**関連ファイル**: 
- `clients/nfc-agent/nfc_agent/main.py`
- `clients/nfc-agent/nfc_agent/resend_worker.py`
- `clients/nfc-agent/nfc_agent/queue_store.py`
- `apps/web/src/hooks/useNfcStream.ts`
- `docs/plans/tool-management-debug-execplan.md`

---

### [KB-069] IPアドレス管理の変数化（Ansible group_vars/all.yml）

**EXEC_PLAN.md参照**: Phase 1 IPアドレス管理の変数化と運用モード可視化（2025-12-04）、[security-hardening-execplan.md](../plans/security-hardening-execplan.md)

**事象**: 
- IPアドレスが複数の設定ファイルに直接記述されている
- ネットワーク環境が変わった際に、複数箇所を手動で修正する必要がある
- メンテナンス時と通常運用時の切り替えが煩雑
- `inventory.yml`、テンプレートファイル（`.j2`）、スクリプトなどにIPアドレスが散在している

**要因**: 
1. **設定の分散**: IPアドレスが各ファイルに直接記述されており、一元管理されていない
2. **変数化の不足**: Ansibleの変数機能を活用していなかった
3. **ネットワークモードの切り替え不足**: ローカルネットワークとTailscaleの切り替えが手動で行う必要があった

**試行した対策**: 
- [試行1] 各ファイルを個別に修正 → **失敗**（修正漏れが発生しやすい）
- [試行2] 環境変数で管理 → **部分的成功**（Ansibleテンプレートでは使用できない）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. `infrastructure/ansible/group_vars/all.yml`を作成し、IPアドレス変数を一元管理
  2. `network_mode`（`local`/`tailscale`）で切り替え可能にする
  3. `local_network`と`tailscale_network`の2つのIPアドレスセットを定義
  4. `current_network`変数で`network_mode`に応じて自動選択
  5. `inventory.yml`で変数を参照するように修正（`ansible_host`、URL、WebSocket URLなど）
  6. テンプレートファイル（`.j2`）のデフォルト値を削除し、変数のみ参照
  7. `scripts/register-clients.sh`を環境変数またはAnsible変数から読み込むように修正

**実装の詳細**:
- `group_vars/all.yml`に以下の変数を定義:
  - `network_mode`: `"local"`または`"tailscale"`
  - `local_network`: ローカルネットワーク用IPアドレス（`raspberrypi5_ip`, `raspberrypi4_ip`, `raspberrypi3_ip`）
  - `tailscale_network`: Tailscale用IPアドレス（メンテナンス時のみ使用）
  - `current_network`: `network_mode`に基づいて自動選択
  - `server_ip`, `kiosk_ip`, `signage_ip`: 共通変数として定義
  - `api_base_url`, `websocket_agent_url`など: よく使うURLを共通変数として定義
- `inventory.yml`で`ansible_host: "{{ current_network.raspberrypi5_ip }}"`のように変数参照
- テンプレートファイルで`{{ api_base_url }}`のように変数参照

**学んだこと**: 
- Ansibleの`group_vars/all.yml`を使用することで、IPアドレスを一元管理できる
- `network_mode`で切り替え可能にすることで、メンテナンス時と通常運用時の切り替えが容易になる
- 変数化により、ネットワーク環境変更時の修正箇所が1箇所に集約される
- デフォルト値に古いIPアドレスを残さないことで、設定ミスを防げる

**解決状況**: ✅ **解決済み**（2025-12-04）

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/inventory.yml`
- `infrastructure/ansible/templates/nfc-agent.env.j2`
- `infrastructure/ansible/templates/status-agent.conf.j2`
- `infrastructure/ansible/templates/docker.env.j2`
- `scripts/register-clients.sh`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

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

### [KB-071] Tailscale導入とSSH接続設定

**EXEC_PLAN.md参照**: Phase 2 メンテナンス時の安全化（Tailscale導入）（2025-12-04）、[security-hardening-execplan.md](../plans/security-hardening-execplan.md)

**事象**: 
- メンテナンス時にインターネット経由でAnsible実行・GitHubからpullする際、SSHポートをインターネットに公開する必要がある
- 動的IPアドレスで接続が不安定になる可能性がある
- 自宅と会社の両方から接続する際、IPアドレスが異なる

**要因**: 
1. **VPNの未導入**: TailscaleなどのVPNが導入されていなかった
2. **SSHポートの公開**: SSHポート（22）をインターネットに公開する必要があった
3. **動的IPの問題**: 動的IPアドレスで接続が不安定になる可能性がある

**試行した対策**: 
- [試行1] 固定IPアドレスを取得 → **失敗**（コストが高い、設定が複雑）
- [試行2] ポート転送を設定 → **失敗**（セキュリティリスクがある）

**有効だった対策**: 
- ✅ **解決済み**（2025-12-04）:
  1. Tailscaleアカウントを作成（無料プランで100デバイスまで利用可能）
  2. MacにTailscaleクライアントをインストール・認証
  3. Pi5、Pi4、Pi3にTailscaleクライアントをインストール
  4. 各デバイスで`sudo tailscale up`を実行して認証
  5. Tailscale IPアドレスを`group_vars/all.yml`に設定
  6. Mac側の`~/.ssh/config`に2つの接続設定を追加:
     - `raspi5-local`: 通常運用時（ローカルネットワーク `192.168.10.230`）
     - `raspi5-tailscale`: メンテナンス時（Tailscale経由 `100.106.158.2`）
  7. Ansibleタスク（`roles/common/tasks/tailscale.yml`）を作成し、自動インストール可能にする

**実装の詳細**:
- Tailscaleインストール:
  - Pi5: `curl -fsSL https://tailscale.com/install.sh | sh`
  - Pi4: Pi5経由でSSH接続してインストール
  - Pi3: Pi5経由でSSH接続してインストール（サイネージサービスを停止してから実行）
- Tailscale認証:
  - 各デバイスで`sudo tailscale up`を実行
  - 認証URLが表示されるので、Macのブラウザで開いて承認
  - `tailscale status`でIPアドレスを確認
- SSH接続設定:
  - `~/.ssh/config`に`raspi5-local`と`raspi5-tailscale`を追加
  - `IdentityFile`に正しいSSH鍵（`id_ed25519`）を指定
  - `StrictHostKeyChecking no`でホストキーチェックを無効化（初回接続時）

**学んだこと**: 
- Tailscaleは無料で利用でき、設定が簡単
- WireGuardベースで暗号化が強固
- 動的IPアドレスでも固定IPのように接続可能
- SSHポートをインターネットに公開する必要がない
- メンテナンス時のみ使用し、通常運用時はローカルネットワークを使用する運用が適切
- Pi3はリソースが限られているため、サイネージサービスを停止してからインストールする必要がある

**解決状況**: ✅ **解決済み**（2025-12-04）

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/roles/common/tasks/tailscale.yml`
- `infrastructure/ansible/roles/common/tasks/main.yml`
- `~/.ssh/config`（Mac側）
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

### [KB-072] Pi5のUFW適用とHTTPSリダイレクト強化

**EXEC_PLAN.md参照**: Phase 4 通常運用時のセキュリティ対策（2025-12-05）

**事象**: 
- Pi5のポート80/443/22以外も開放されており、SSHがインターネット側から到達可能だった
- HTTPアクセスがそのまま提供され、HTTPS強制が徹底されていなかった

**要因**: 
1. UFWが未導入で、iptablesのデフォルト許可状態だった
2. HTTP→HTTPSリダイレクトはCaddyfile.localに存在したが、設定がコード化されておらず再現性が低かった

**試行した対策**: 
- [試行1] iptablesで手動設定 → **失敗**（再起動で消える、Ansible未管理）
- [試行2] Caddyでヘッダー追加のみ → **部分的成功**（HTTPSは使用できるがHTTPが残る）

**有効だった対策**: 
- ✅ UFWをAnsibleで導入し、デフォルトdeny/allow構成に設定
- ✅ HTTP(S)のみ許可、SSHはローカルLANとTailscaleのサブネットからのみ許可
- ✅ Caddyfile（dev/local/production）にHTTP→HTTPSリダイレクトとセキュリティヘッダーを明記
- ✅ `docker-compose.server.yml`で`/var/log/caddy`をホストにマウントして設定を一元化

**学んだこと**: 
- 工場LANとTailscaleネットワークだけを明示的に許可する事で、SSH暴露を避けられる
- WebサーバーのHTTPSリダイレクトはCaddyレイヤーで完結させるとシンプル
- ファイアウォールとリバースプロキシの設定はAnsible管理に統一しておくと再現性が高い

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/docker/Caddyfile*`
- `infrastructure/docker/docker-compose.server.yml`
- `docs/security/requirements.md`

---

### [KB-073] Caddyアクセスログとfail2ban（SSH/HTTP）の連携

**EXEC_PLAN.md参照**: Phase 4 通常運用時のセキュリティ対策（2025-12-05）

**事象**: 
- fail2banでHTTP/APIの不正アクセスを検知したかったが、Caddyのログがstdoutのみで参照できない
- SSHブルートフォースも検知できていなかった

**要因**: 
1. Caddyコンテナのログがファイルに出力されておらず、ホスト上でfail2banが読めない
2. fail2banのjail/filterが未構成

**試行した対策**: 
- [試行1] docker logsをfail2banで読み込む → **失敗**（ファイルではないため不可）
- [試行2] journalctlでCaddyログを拾う → **失敗**（コンテナがjournaldに書き込んでいない）

**有効だった対策**: 
- ✅ `/var/log/caddy`をホストで作成し、コンテナにマウント
- ✅ Caddyの`log`ディレクティブでCLF形式をファイル出力
- ✅ fail2banに`factory.conf`（sshd + caddy-http-auth）と専用filterを追加
- ✅ Ansibleでテンプレート化し、サービス再起動まで自動化

**学んだこと**: 
- fail2banは標準でCLF（common log format）を解析できるため、CaddyでもCLFを採用すると流用しやすい
- コンテナのセキュリティログはホストへバインドマウントし、OS側ツールと連携させると管理が単純化する
- SSH/HTTP双方の閾値をAnsible変数化しておくと、リスクレベルに応じた調整が容易

**関連ファイル**: 
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/ansible/templates/fail2ban.local.j2`
- `infrastructure/ansible/templates/fail2ban-filter-caddy-http.conf.j2`
- `infrastructure/docker/Caddyfile*`
- `docs/plans/security-hardening-execplan.md`### [KB-074] Pi5のマルウェアスキャン自動化（ClamAV/Trivy/rkhunter）

**EXEC_PLAN.md参照**: Phase 5 マルウェア対策（2025-12-05）

**事象**: 
- Pi5にウイルス/ルートキット検知の仕組みがなく、感染を検知できない
- スキャンログが分散し、監視フェーズで再利用しづらかった

**有効だった対策**: 
- ✅ ClamAV/Trivy/rkhunterをAnsibleで導入し、`/usr/local/bin/*-scan.sh`を配置
- ✅ 03:00/03:30/04:00のcronで夜間スキャンを自動化し、ログを`/var/log/{clamav,trivy,rkhunter}`へ集約
- ✅ TrivyはGitHub公式ARM64 `.deb`をダウンロードしてdpkgでインストール（APTリポジトリが無いため）

**学んだこと**: 
- Debian bookworm系ではTrivyのAPTパッケージが提供されていないため、公式リリースを直接導入するのが確実
- `freshclam`デーモンに任せれば手動`freshclam`は不要で、ログロックエラーも避けられる

**関連ファイル**: 
- `infrastructure/ansible/roles/server/tasks/malware.yml`
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/trivy-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

### [KB-075] Pi4キオスクの軽量マルウェア対策

**EXEC_PLAN.md参照**: Phase 5 マルウェア対策（2025-12-05）

**事象**: 
- Pi4（キオスク）はリソースが限られており、Pi5と同じ対象・頻度でスキャンするとUIレスポンスが低下する

**有効だった対策**: 
- ✅ ClamAVとrkhunterのみを導入し、対象を`/opt/RaspberryPiSystem_002/storage`に限定
- ✅ 週1回（日曜02:00開始）のcronを設定し、低負荷時間帯だけスキャン
- ✅ Pi5と同じスクリプト/ログ命名に揃え、監視・アラートの共通化を容易にした

**学んだこと**: 
- リソースが限られた端末では、対象フォルダと頻度を絞ることでセキュリティとUXの両立が可能
- Pi5を経由したscp→sshの配布フローを整備すると、再デプロイが容易になる

**関連ファイル**: 
- `infrastructure/ansible/roles/kiosk/tasks/security.yml`
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

### [KB-076] fail2ban連携のセキュリティ監視タイマー

**EXEC_PLAN.md参照**: Phase 6 監視・アラート（2025-12-05）

**事象**: 
- ローカル運用では外部通知サービス（Slack等）が使えず、fail2banログを目視しないと侵入試行に気付けない
- 既存の`alerts/`ファイルベース通知と連携できていなかった

**有効だった対策**: 
- ✅ `/usr/local/bin/security-monitor.sh`を追加し、fail2banログのBan行を15分間隔で走査
- ✅ systemd timer（`security-monitor.timer`）で常時起動し、stateファイルで重複通知を防止
- ✅ Banイベントを検知すると`generate-alert.sh`を呼び、管理コンソールのアラートバナーへ自動表示

**学んだこと**: 
- 初回実行時は既存ログを基準化してから監視を開始しないと、過去のBanが大量通知になる
- `logger`タグを付与しておくと、journalctlでも監視スクリプトの動作状況を追跡しやすい

**関連ファイル**: 
- `infrastructure/ansible/templates/security-monitor.sh.j2`
- `infrastructure/ansible/templates/security-monitor.service.j2`
- `infrastructure/ansible/templates/security-monitor.timer.j2`
- `infrastructure/ansible/roles/server/tasks/monitoring.yml`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

### [KB-077] マルウェアスキャン結果の自動アラート化

**EXEC_PLAN.md参照**: Phase 6 監視・アラート（2025-12-05）

**事象**: 
- ClamAV/Trivy/rkhunterが感染や秘密情報を検出しても、ログを開かなければ気づけなかった
- rkhunterの既知警告やTrivyの秘密鍵検出など、誤検知を抑制しつつ通知したかった

**有効だった対策**: 
- ✅ 各スキャンスクリプトで終了コード／警告行を判定し、`generate-alert.sh`に詳細を渡すよう改修
- ✅ Trivyの`--skip-dirs`とignoreパターン、rkhunterの除外リストをAnsible変数にして誤検知を抑制
- ✅ アラート種別（`clamav-detection`、`trivy-detection`、`rkhunter-warning`）を分け、管理画面で原因を特定しやすくした

**学んだこと**: 
- `clamscan`はexit code=1で感染ファイル、2でエラーなので、両ケースを分けて通知する必要がある
- Trivyの秘密鍵検出は証明書ディレクトリを`--skip-dirs`対象にすることでノイズを大幅に減らせる

**関連ファイル**: 
- `infrastructure/ansible/templates/clamav-scan.sh.j2`
- `infrastructure/ansible/templates/trivy-scan.sh.j2`
- `infrastructure/ansible/templates/rkhunter-scan.sh.j2`
- `infrastructure/ansible/group_vars/all.yml`
- `docs/security/requirements.md`
- `docs/plans/security-hardening-execplan.md`

---

### [KB-078] 複数ローカルネットワーク環境でのVNC接続設定

**EXEC_PLAN.md参照**: Phase 7 テスト・検証（2025-12-05）

**事象**: 
- 会社のネットワーク（192.168.10.0/24）と自宅のネットワーク（192.168.128.0/24）で異なるIPアドレスを使用
- UFWでVNCポート（5900/tcp）が `192.168.10.0/24` からのみ許可されていたため、自宅からRealVNC ViewerでPi5に接続できなかった

**有効だった対策**: 
- ✅ UFWのVNC許可ネットワークに `192.168.128.0/24` を追加（`sudo ufw allow from 192.168.128.0/24 to any port 5900`）
- ✅ Ansibleの `group_vars/all.yml` の `ufw_vnc_allowed_networks` に両方のネットワークを定義し、次回デプロイ時に自動反映されるように設定
- ✅ 複数のローカルネットワークに対応できるよう、リスト形式で管理

**学んだこと**: 
- 異なるネットワーク環境（会社/自宅）で運用する場合、ファイアウォール設定も複数のネットワークを許可する必要がある
- UFWのルールは `ufw_vnc_allowed_networks` のようなリスト変数で管理することで、環境ごとの追加が容易になる
- Tailscale経由での接続は別途設定されているため、ローカルネットワークの追加設定は必要ない

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml` (ufw_vnc_allowed_networks)
- `infrastructure/ansible/roles/server/tasks/security.yml` (VNCポート許可タスク)
- `docs/plans/security-hardening-execplan.md`
- `docs/security/requirements.md`

---

### [KB-079] Phase7セキュリティテストの実施結果と検証ポイント

**EXEC_PLAN.md参照**: Phase 7 テスト・検証（2025-12-05）

**事象**: 
- Phase1-6で実装したセキュリティ対策が正しく動作するか、包括的なテストが必要だった
- ネットワーク環境の切り替え、Tailscale経路、ファイアウォール、HTTPS強制、fail2ban、バックアップ復元、マルウェアスキャンの各機能を検証する必要があった

**実施した検証**:
- ✅ **IPアドレス管理の切り替え**: `ansible ... -e network_mode={local,tailscale}` で server/kiosk/signage IP が正しく切り替わることを確認
- ✅ **Tailscale接続**: Mac → Pi5 への Tailscale SSH/HTTPS が機能し、インターネット経由でも安全に接続できることを確認
- ✅ **ファイアウォール設定**: UFWで許可されたポート（80/443/22/5900）のみ通過し、その他が遮断されることを確認
- ✅ **HTTPS強制**: HTTPアクセスが301リダイレクトでHTTPSに転送されることを確認
- ✅ **fail2ban動作**: 意図的なBanイベントで `security-monitor.sh` がアラートを生成し、解除後に正常に戻ることを確認
- ✅ **バックアップ暗号化・復元**: GPG暗号化バックアップからテストDBへ復元し、データ整合性（Loan 436件）を確認
- ✅ **マルウェアスキャン**: ClamAV/Trivy/rkhunterの手動スキャンでログとアラート生成を確認

**学んだこと**: 
- ネットワークモードの切り替えは `-e network_mode=` で動的に変更でき、Ansible変数が正しく展開されることを確認
- Tailscale経由での接続はローカルネットワークが変わっても安定して機能する
- fail2banのBanイベントは `security-monitor.sh` で自動的にアラート化され、管理画面で確認可能
- バックアップ復元テストは本番DBとは別のテストDBを使用することで、安全に検証できる
- Trivyの秘密鍵検出は `--skip-dirs` で抑制できるが、ログには過去の検出履歴も残るためタイムスタンプで判断する必要がある
- rkhunterの既知警告（PermitRootLogin等）はアラート経由で把握できるため、運用上問題なし

**残課題**:
- オフラインUSBメディアを実際にマウントした状態でのバックアップコピー/削除テストは未実施（USB接続時に実施予定）
- TrivyのDockerイメージ単位のスキャンは未実装（今後の課題）

**関連ファイル**: 
- `docs/plans/security-hardening-execplan.md` (Phase 7 進捗)
- `docs/security/requirements.md` (テスト状況)
- `scripts/server/backup-encrypted.sh`
- `scripts/server/restore-encrypted.sh`
- `infrastructure/ansible/roles/server/tasks/security.yml`
- `infrastructure/ansible/roles/server/tasks/monitoring.yml`

---

### [KB-080] Pi4キオスクがTailscale URL固定でレイアウトが旧状態のままになる

**EXEC_PLAN.md参照**: Phase 8 サイネージ／キオスク回帰対応（2025-12-05）

**事象**:
- Pi4（キオスク端末）の画面が tagモード＋旧レイアウトのまま更新されない
- 管理コンソールのURLや表示スタイルがローカル運用時と一致せず、ユーザーが混乱

**要因**:
- `kiosk-launch.sh` の `--app="https://100.106.158.2/kiosk"` がTailscale経路に固定されていた
- `network_mode` を `local` に戻した後も、再デプロイを実施していなかったためURLが上書きされなかった
- Tailscale経路では証明書警告を回避するためのフラグが有効になっており、Chromiumが常にTailscale URLを優先していた

**試行した対策**:
- [x] Pi5経由でPi4へSSHし、`systemctl status kiosk-browser.service` と `cat /usr/local/bin/kiosk-launch.sh` を取得して状況を可視化
- [ ] Ansibleで `network_mode=local` を指定して `deploy.yml` を再実行し、`kiosk_url` 変数からローカルIPを再配布（未実施）
- [ ] `signage/kiosk` ロールに「現在のURLと `current_network` の不一致を検知して警告するタスク」を追加（未実施）

**有効だった対策 / 次のアクション**:
- 調査完了。再デプロイでURLを更新し、`kiosk_launch.sh.j2` に `current_network` の値を埋め込むことで解消予定。

**関連ファイル**:
- `infrastructure/ansible/group_vars/all.yml` (`network_mode`, `server_ip`, `kiosk_full_url`)
- `infrastructure/ansible/templates/kiosk-launch.sh.j2`
- `docs/plans/security-hardening-execplan.md`
- `docs/INDEX.md`（最新アップデート欄）

---

### [KB-081] Pi3サイネージのPDF/TOOLS画面が新デザインへ更新されない

**EXEC_PLAN.md参照**: Phase 8 サイネージ／キオスク回帰対応（2025-12-05）

**事象**:
- Raspberry Pi 3 のサイネージ画面が、Reactで刷新したモダンUIではなく旧デザインのまま表示される
- PDFスライドショーのページ送りやカードデザインが物理サイネージに反映されず、利用者が変更を確認できない

**要因**:
- 実機が参照しているのは `SignageRenderer`（`apps/api/src/services/signage/signage.renderer.ts`）が生成するJPEGであり、React側のUI更新だけでは反映されない
- Phase 6/7 ではReact UIの改善のみを実施し、サーバー側レンダラーのSVGテンプレートを更新していなかった

**試行した対策**:
- [x] APIコードを確認し、`SignageRenderer` が旧SVGを組み立てていることを確認
- [ ] Pi3から `/var/cache/signage/current.jpg` を取得し、実際に描画されている内容を確認（未実施）
- [x] `SignageRenderer` の `renderTools` / `renderSplit` / `renderPdfImage` をReact版のスタイルに合わせて書き換え（2025-12-05）  
      - グラデーション背景・ガラス調カード・PDF表示のスライド情報表示・CPU/温度メトリクスをSVGで再構築  
      - TOOLS/PDF/SPLITの各モードでサーバーサイド描画結果がReact UIと視覚的に整合するように調整

**有効だった対策 / 次のアクション**:
- 調査段階。Phase 8-2 で新デザインのSVGテンプレートを実装し、`signage-test-plan.md` を更新する。

**関連ファイル**:
- `apps/api/src/services/signage/signage.renderer.ts`
- `apps/web/src/pages/signage/SignageDisplayPage.tsx`
- `docs/plans/security-hardening-execplan.md`
- `docs/guides/signage-test-plan.md`
- `docs/INDEX.md`（最新アップデート欄）

---

### [KB-082] 管理コンソールでSPLITを指定してもサイネージAPIが常にTOOLSを返す

**EXEC_PLAN.md参照**: Phase 8 サイネージ／キオスク回帰対応（2025-12-06）

**事象**:
- 管理コンソールで左右2ペイン（SPLIT）を設定しているのに、実機サイネージは単一ペイン（TOOLS）表示のまま
- `/api/signage/content` を確認すると `contentType: "TOOLS"` が返却され、`pdf` 情報も付与されていない

**要因**:
- 営業時間（07:30–21:00）外ではどのスケジュールにも一致せず、デフォルトの TOOLS へフォールバックしていた  
- セキュリティ機能（Tailscale/UFW）ではなく、`SignageService.getContent()` のフォールバック仕様不足が根本原因

**試行した対策**:
- [x] Pi3クライアント側で `SERVER_URL` を Tailscale IP へ一時切替 → サーバーの最新 `current.jpg` とハッシュ一致することを確認（レンダラー改修は反映済み）  
- [x] `prisma.signageSchedule` を直接確認し、営業終了後（21:00以降）はどのスケジュールにも一致せず `TOOLS` にフォールバックしていた事実を把握  
- [x] `SignageService.getContent()` にフォールバック処理を追加し、SPLITスケジュールが存在する場合は優先的に返却するよう改修（2025-12-05）

**有効だった対策 / 残作業**:
- ✅ `/api/signage/content` が営業時間外でも `contentType: "SPLIT"` を返すようになり、Pi3実機も左右ペイン表示へ復帰  
- 🔄 必要に応じてスケジュール（start/end）を見直し、意図的に単一ペインへ切り替えたい時間帯があるかを運用ドキュメントへ追記する

**関連ファイル**:
- `apps/api/src/services/signage/signage.service.ts`
- `apps/api/src/services/signage/signage.renderer.ts`
- `docs/plans/security-hardening-execplan.md`
- `docs/INDEX.md`（最新アップデート欄）

---

### [KB-084] サイネージSVGレンダラーでカード内テキストが正しい位置に表示されない

**EXEC_PLAN.md参照**: Phase 8 サイネージデザイン調整（2025-12-06）

**事象**:
- サイネージ画面で2列カードレイアウトを実装したが、テキストがサムネイル右側ではなく画面左端に表示される
- 右列のカードにはテキストが一切表示されず、サムネイルのみが描画される

**要因**:
- SVGの `<text>` 要素の `x` 座標に、カード内相対位置（`textAreaX`）をそのまま使用していた
- 正しくは、カードの絶対位置 `x` にカード内相対位置 `textAreaX` を加算した `x + textAreaX` を使用する必要がある

**誤ったコード例**:
```typescript
// ❌ 間違い: textAreaXはカード内の相対位置（例: 120px）
<text x="${textAreaX}" y="${primaryY}">...</text>
```

**正しいコード例**:
```typescript
// ✅ 正解: カードの絶対位置 + カード内相対位置
const textX = x + textAreaX;
<text x="${textX}" y="${primaryY}">...</text>
```

**学んだこと**:
1. **SVGの座標は常に絶対座標**: SVGでは親要素からの相対位置ではなく、ビューポート（画面）からの絶対座標を指定する
2. **カードレイアウトの座標計算**: グリッド内の各カード位置 `(x, y)` を基準に、カード内要素の位置を計算する
   - サムネイル: `x + cardPadding`, `y + cardPadding`
   - テキスト: `x + cardPadding + thumbnailWidth + gap`, `y + textOffset`
3. **2列表示の設定**: `maxColumns: 2`, `maxRows: 3` でグリッドを制御
4. **テキスト縦並び順序**: アイテム名 → 従業員名 → 日付 → 時刻 → 警告（12時間超過時は赤色）
5. **SPLIT右ペインのタイトル/ファイル名/画像の位置決め**:
   - `text`の`y`はベースライン。フォント20pxの場合、下方向に約4pxぶん余白を見込む
   - タイトルとファイル名は基準オフセット（例: titleOffsetY ≈ 22px * scale）で揃える
   - PDF画像開始はタイトル下余白（rightHeaderHeight）を最小化して黒地を最大化（例: rightHeaderHeight ≈ 12px * scale）
   - 外枠余白は0〜2px * scale程度に抑え、上貼り付きだけ防ぐ

**有効だった対策**:
- ✅ すべての `<text>` 要素の `x` 座標を `x + textAreaX` に修正
- ✅ サムネイルの `x`, `y` 座標も同様にカード位置を基準に計算

**関連ファイル**:
- `apps/api/src/services/signage/signage.renderer.ts` (`buildToolCardGrid` メソッド)
- `apps/api/src/services/signage/signage.renderer.ts`（SPLITペインのタイトル/ファイル名/画像オフセット調整）
- `docs/knowledge-base/infrastructure.md`（本エントリ）

---

### [KB-085] サイネージTOOLS左ペインを3列化・右ペインの更新文言削除

**EXEC_PLAN.md参照**: Phase 8 サイネージデザイン調整（2025-12-06）

**事象**:
- 左ペイン（TOOLS）が2列のままで表示面積が不足し、サムネイルを大きく表示できない
- 右ペインに「30s更新」表記があり、不要な文言となっている

**要因**:
- `buildToolCardGrid` の `maxColumns` が2に固定されていた
- SPLIT右ペインでスライド間隔を表示していた

**実施した対策**:
- `maxColumns: 3` に変更し、gapを14px相当に微調整してサムネイルを大型化
- SPLIT右ペインの更新間隔表示を削除
- Pi5でAPIビルド → Docker再起動 → Pi3 `signage-lite.service` 再起動

**関連ファイル**:
- `apps/api/src/services/signage/signage.renderer.ts`
- `infrastructure/docker/docker-compose.server.yml`（APIコンテナ）
- `infrastructure/ansible/playbooks/restart-services.yml`（signage-lite再起動）

---

### [KB-086] Pi3サイネージデプロイ時のsystemdタスクハング問題

**EXEC_PLAN.md参照**: Phase 8 デプロイモジュール実装・実機検証（2025-12-06）

**事象**:
- Pi3へのAnsibleデプロイ実行時に、`systemd`モジュールのタスクで約44分間ハング
- `update-clients-core.yml`の「Re-enable signage-lite service before restart」タスクで停止
- デプロイプロセスが完了せず、`PLAY RECAP`が出力されない
- 複数のAnsibleプロセスが重複実行され、リソースを消費

**経緯**:
1. **2025-12-06 18:27**: 最初のデプロイ実行（サイネージサービスを停止せずに実行）
   - `ansible-playbook`を実行し、`common`ロールのタスクまで正常に進行
   - `signage`ロールのタスクでサイネージサービスを停止・再起動
   - `update-clients-core.yml`の「Re-enable signage-lite service before restart」タスクでハング
   - 約44分間停止し、デプロイが完了しない

2. **2025-12-06 19:39**: ユーザーから「サイネージを停止してからデプロイする約束を守っていない」と指摘
   - 約束を無視していたことを認識
   - ドキュメントを参照せずに進めていたことを認識

3. **2025-12-06 19:46**: サイネージサービスを停止してから再デプロイを実行
   - `sudo systemctl stop signage-lite.service signage-lite-update.timer`を実行
   - メモリ使用状況を確認（120MB空き）
   - デプロイを再実行

4. **2025-12-06 19:47**: 複数のAnsibleプロセスが重複実行されていることを発見
   - `ps aux | grep ansible`で3つのプロセスを確認
   - 全てのプロセスをkillしてから再実行

5. **2025-12-06 19:59**: サイネージを停止してから実行することで、デプロイが正常に完了
   - `PLAY RECAP`: ok=77, changed=16, failed=0
   - サイネージサービスを再起動し、正常動作を確認

**要因**:
1. **リソース不足**: Pi3のメモリが少ない（1GB、実質416MB）
   - サイネージサービス（`feh`プロセス）が動作していると、メモリ使用量が約295MB
   - デプロイ時の`systemd`モジュール実行時に、メモリ不足でハング
   - `apt`パッケージマネージャーの実行時にもリソースを消費

2. **重複プロセス実行**: 複数のAnsibleプロセスが同時に実行されていた
   - 以前のデプロイプロセスが完全に終了していなかった
   - 新しいデプロイを実行すると、複数のプロセスが競合
   - SSH接続のControlMaster接続が残っていた

3. **標準手順の無視**: ドキュメントに記載されている標準手順を守っていなかった
   - 「サイネージを停止してからデプロイする」という約束を無視
   - ドキュメントを参照せずに進めていた
   - 同じミスを繰り返していた

**有効だった対策**:
- ✅ **サイネージサービスを事前に停止**: デプロイ前に`sudo systemctl stop signage-lite.service signage-lite-update.timer`を実行
- ✅ **メモリ使用状況の確認**: `free -m`でメモリ空き容量を確認（120MB以上確保）
- ✅ **重複プロセスのkill**: デプロイ前に`pkill -9 -f ansible-playbook`で全てのAnsibleプロセスを停止
- ✅ **SSH接続のクリーンアップ**: ControlMaster接続をクリーンアップ
- ✅ **標準手順の遵守**: ドキュメントに記載されている標準手順を必ず守る

**学んだこと**:
1. **リソース制約のある環境でのデプロイ**: Pi3のようなリソースが少ない環境では、デプロイ前に不要なサービスを停止する必要がある
2. **デプロイプロセスの重複実行防止**: デプロイ前に既存のプロセスをkillし、クリーンな状態で実行する
3. **標準手順の重要性**: ドキュメントに記載されている標準手順を必ず守る。無視すると同じミスを繰り返す
4. **メモリ使用状況の監視**: デプロイ前にメモリ使用状況を確認し、十分な空き容量を確保する
5. **ドキュメント参照の徹底**: デプロイ前に必ずドキュメントを参照し、標準手順を確認する

**標準プロセス**（KB-089で更新）:
1. **デプロイ前の準備**:
   ```bash
   # Pi3サイネージサービスを停止・無効化（自動再起動を防止）
   ssh signageras3@<pi3_ip> 'sudo systemctl stop signage-lite.service signage-lite-update.timer'
   ssh signageras3@<pi3_ip> 'sudo systemctl disable signage-lite.service signage-lite-update.timer'
   
   # メモリ使用状況を確認（120MB以上空きがあることを確認）
   ssh signageras3@<pi3_ip> 'free -m'
   
   # 既存のAnsibleプロセスをkill
   ssh denkon5sd02@<pi5_ip> 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ'
   ```

2. **デプロイ実行**:
   ```bash
   # Pi5からPi3へデプロイ
   cd /opt/RaspberryPiSystem_002/infrastructure/ansible
   ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles \
     ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3
   ```

3. **デプロイ後の確認**:
   ```bash
   # デプロイが正常に完了したことを確認（PLAY RECAPでfailed=0）
   # サイネージサービスを再有効化・再起動
   ssh signageras3@<pi3_ip> 'sudo systemctl enable signage-lite.service signage-lite-update.timer'
   ssh signageras3@<pi3_ip> 'sudo systemctl start signage-lite.service signage-lite-update.timer'
   
   # サービスが正常に動作していることを確認
   ssh signageras3@<pi3_ip> 'systemctl is-active signage-lite.service'
   ```

**解決状況**: ✅ **解決済み**（2025-12-06）

**関連ファイル**:
- `infrastructure/ansible/playbooks/deploy.yml`
- `infrastructure/ansible/tasks/update-clients-core.yml`
- `infrastructure/ansible/roles/signage/tasks/main.yml`
- `docs/guides/deployment.md`（標準プロセスとして追記）
- `docs/guides/ansible-best-practices.md`（ベストプラクティスとして追記）

---

### [KB-087] Pi3 status-agent.timer 再起動時のsudoタイムアウト

**EXEC_PLAN.md参照**: Phase 8 デプロイ再実証（2025-12-07）

**事象**:
- Pi3への標準デプロイ実行中、`status-agent.timer` 再起動タスクで `Timeout (12s) waiting for privilege escalation prompt` が発生し `UNREACHABLE`
- `signage-lite.service` や `signage-lite-update.timer` の再起動は成功するが、`status-agent.*` のみ失敗

**要因**:
1. `signageras3` の `sudo -l` を確認したところ、`NOPASSWD` が `signage-lite` 系コマンドのみに限定されていた
2. `status-agent.service` / `status-agent.timer` に対する `systemctl` はパスワードが必要で、Ansibleはbecome passwordを持たないため昇格プロンプト待ちでタイムアウトしていた

**対策**:
- `inventory.yml` にホストごとの `sudo_nopasswd_commands` を定義（Pi3: signage-lite + status-agent、Pi4: kiosk-browser + status-agent）
- `roles/client` に sudoers テンプレート（`/etc/sudoers.d/<user>`）を追加し、上記コマンドに `NOPASSWD` を付与
- `visudo -cf` 検証を組み込み、設定ミスを防止

**結果**:
- 再デプロイ時に `status-agent.timer` もパスワードなしで再起動可能となり、タイムアウトは再現しなくなった
- 既存ノウハウ（サイネージ停止→Ansible→サービス再起動）の中で sudo 権限定の抜け漏れを防止できるようになった

**関連ファイル**:
- `infrastructure/ansible/inventory.yml`（`sudo_nopasswd_commands`）
- `infrastructure/ansible/roles/client/tasks/main.yml`
- `infrastructure/ansible/roles/client/templates/sudoers-client.j2`
- `docs/guides/deployment.md`（標準プロセスの補足）

---

### [KB-088] Prisma P3009 (Signage migrations) 既存型が残存し migrate deploy 失敗

**EXEC_PLAN.md参照**: Phase 8 デプロイ再実証（2025-12-07）

**事象**:
- `pnpm prisma migrate status` が `Following migration have failed: 20251128180000_add_signage_models` を出力
- `pnpm prisma migrate deploy` で `P3018` / `ERROR: type "SignageContentType" already exists`（DBエラー 42710）
- DBには既に`SignageSchedule`/`SignagePdf`/`SignageEmergency`テーブルと `SignageContentType`/`SignageDisplayMode` ENUM が存在していた

**要因**:
- 過去にマイグレーションが途中適用され、DB上では型・テーブルが作成済みだが、Prismaのマイグレーション状態は「failed」のまま残っていた（不整合）

**対策**:
1. **バックアップ取得**: `docker compose exec db pg_dump -U postgres -Fc borrow_return > /var/lib/postgresql/data/backups/borrow_return_pre_20251207.dump`
2. **残存ENUMの確認/削除**: `SELECT typname FROM pg_type ... WHERE typname ILIKE 'signage%';` で存在を確認し、必要に応じて `DROP TYPE IF EXISTS "SignageContentType" CASCADE; DROP TYPE IF EXISTS "SignageDisplayMode" CASCADE;`
3. **マイグレーション状態の調整**: `pnpm prisma migrate resolve --applied 20251128180000_add_signage_models`
4. **整合性確認**: `pnpm prisma migrate deploy` → pendingなしを確認

**結果**:
- `migrate deploy` で pending 0 を確認し、P3009は解消
- Signage関連テーブル/ENUMはDBに存在し、再作成は不要

**関連ファイル/コマンド**:
- `apps/api/prisma/migrations/20251128180000_add_signage_models/migration.sql`
- `/var/lib/postgresql/data/backups/borrow_return_pre_20251207.dump`（DBバックアップ）
- `docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status|deploy`

---

### [KB-089] Pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング

**EXEC_PLAN.md参照**: Phase 8 デプロイ再実証（2025-12-07）

**事象**:
- `deploy-all.sh`実行中、Pi3へのAnsibleデプロイが12分以上ハング
- Pi3向けAnsibleプロセスが重複起動（親子プロセス）
- ログが`impact-analyzer`で止まり、`deploy-executor`の結果が記録されない
- Pi3のメモリ空きが80-100MB程度で不足（120MB以上必要）

**経緯**:
1. **11:33**: deploy-all.sh実行開始、Pi3サイネージサービスを停止してから実行
2. **11:33-11:45**: Pi3デプロイが進行中、Ansibleプロセスが重複起動
3. **11:45**: Pi4デプロイ開始、Pi3デプロイは継続中
4. **11:48**: Pi3デプロイ完了（756秒）、Pi4デプロイ完了（121秒）、Serverデプロイ完了（45秒）
5. **11:48**: 検証完了、全PASS

**要因**:
1. **サイネージサービスの自動再起動**: `signage-lite-update.timer`が有効なままで、デプロイ中にサイネージサービスが自動再起動し、メモリを消費
2. **メモリ不足**: Pi3のメモリは416MB（実質利用可能120MB程度）。サイネージサービスが起動するとメモリ使用量が約295MBとなり、Ansibleデプロイ時にメモリ不足でハング
3. **標準手順の無視**: KB-086で「サイネージサービスを停止してからデプロイ」と明記されているが、`systemctl disable`で自動再起動を防止する手順が実行されていなかった

**有効だった対策**:
- ✅ **サイネージサービスのdisable**: `sudo systemctl disable signage-lite.service signage-lite-update.timer`で自動再起動を防止
- ✅ **十分な待機時間**: Pi3デプロイに756秒（約12.6分）を要したが、プロセスをkillせずに完了を待った
- ✅ **プロセスの完全停止**: 再実行前に`pkill -9 ansible; pkill -9 -f deploy-all`で全プロセスをkill

**標準プロセス**（KB-086を更新）:
1. **デプロイ前の準備**:
   ```bash
   # Pi3サイネージサービスを停止・無効化（自動再起動を防止）
   ssh signageras3@<pi3_ip> 'sudo systemctl stop signage-lite.service signage-lite-update.timer'
   ssh signageras3@<pi3_ip> 'sudo systemctl disable signage-lite.service signage-lite-update.timer'
   
   # メモリ使用状況を確認（120MB以上空きがあることを確認）
   ssh signageras3@<pi3_ip> 'free -m'
   
   # 既存のAnsibleプロセスをkill
   ssh denkon5sd02@<pi5_ip> 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ'
   ```

2. **デプロイ実行**:
   ```bash
   # Pi5からPi3へデプロイ（deploy-all.sh経由）
   cd /opt/RaspberryPiSystem_002
   NETWORK_MODE=tailscale DEPLOY_EXECUTOR_ENABLE=1 DEPLOY_VERIFIER_ENABLE=1 ROLLBACK_ON_FAIL=1 \
     bash scripts/deploy/deploy-all.sh
   ```

3. **デプロイ後の確認**:
   ```bash
   # デプロイが正常に完了したことを確認（ログでfailed=0）
   # サイネージサービスを再有効化・再起動
   ssh signageras3@<pi3_ip> 'sudo systemctl enable signage-lite.service signage-lite-update.timer'
   ssh signageras3@<pi3_ip> 'sudo systemctl start signage-lite.service signage-lite-update.timer'
   
   # サービスが正常に動作していることを確認
   ssh signageras3@<pi3_ip> 'systemctl is-active signage-lite.service'
   ```

**学んだこと**:
1. **自動再起動の防止**: `systemctl stop`だけでは不十分。`systemctl disable`で自動再起動を防止する必要がある
2. **十分な待機時間**: Pi3デプロイは10-15分かかる可能性がある。プロセスをkillせずに完了を待つ
3. **標準手順の徹底**: KB-086/KB-089の標準手順を必ず実行する。特にPi3デプロイ時は`systemctl disable`を忘れない
4. **注意**: `systemctl disable`だけでは不十分な場合がある。`systemctl mask --runtime`も必要（[KB-097](#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）

**解決状況**: ✅ **解決済み**（2025-12-07）

**関連ファイル**:
- `scripts/deploy/deploy-all.sh`（標準手順参照を追加）
- `docs/guides/deployment.md`（標準プロセスの更新）
- `docs/knowledge-base/infrastructure.md`（KB-086更新、KB-089追加）

**注意**: KB-089の対策（`systemctl disable`）だけでは不十分な場合があります。`systemctl mask --runtime`も必要です（[KB-097](#kb-097-pi3デプロイ時のsignage-liteサービス自動再起動の完全防止systemctl-maskの必要性)参照）。

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

### [KB-094] Ansibleデプロイ時の`group_vars/all.yml`の`network_mode`設定がリポジトリ更新で失われる問題

**EXEC_PLAN.md参照**: デプロイプロセス改善（2025-12-13）

**事象**: 
- Pi5上の`group_vars/all.yml`の`network_mode`を`tailscale`に手動変更しても、Ansibleデプロイ時に`local`に戻る
- リモートアクセス環境（自宅ネットワーク）でデプロイすると、Pi4やPi3への接続が失敗する（`ssh: connect to host 192.168.x.x port 22: Connection timed out`）

**要因**: 
- `group_vars/all.yml`はGit管理されているファイル
- Ansibleの`common : Sync repository to desired state`タスクが`git reset --hard {{ repo_version }}`を実行し、ローカルの変更（`network_mode: "tailscale"`）を上書きする
- リポジトリのデフォルト値が`network_mode: "local"`のため、デプロイのたびに設定がリセットされる

**問題のコード**:
```yaml
# infrastructure/ansible/roles/common/tasks/main.yml
- name: Sync repository to desired state (with retries)
  git:
    repo: "{{ repo_url }}"
    dest: "{{ repo_path }}"
    version: "{{ repo_version }}"
    force: yes
  register: git_sync_result
  retries: 3
  until: git_sync_result is succeeded
  delay: 5

- name: Reset repository to desired branch
  command: git reset --hard {{ repo_version | quote }}
  args:
    chdir: "{{ repo_path }}"
```

**有効だった対策**: 
- ✅ **デプロイスクリプトに自動チェック機能を追加**（2025-12-13）: `scripts/update-all-clients.sh`に`check_network_mode()`関数を追加し、デプロイ前に`network_mode`を確認・警告
- ✅ **手動修正コマンドの提供**: デプロイ前に`ssh ${REMOTE_HOST} "sed -i 's/network_mode: \"local\"/network_mode: \"tailscale\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"`で設定を変更
- ✅ **ヘルスチェック前の再確認を標準化**: デプロイ後のgit syncで`network_mode`が戻る場合があるため、ヘルスチェック実行前にも再確認する運用を追加（ヘルスチェックがローカルIPに向かわないようにする）
- ✅ **ローカルIPは都度取得**: 例示の`192.168.x.x`を固定値で使わず、毎回`hostname -I`等で実IPを取得して`group_vars/all.yml`を更新する

**標準プロセス**:
1. **デプロイ前の確認**:
   ```bash
   # Pi5上のnetwork_modeを確認
   ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
   
   # リモートアクセス環境の場合はtailscaleに変更
   ssh denkon5sd02@100.106.158.2 "sed -i 's/network_mode: \"local\"/network_mode: \"tailscale\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
   ```

2. **デプロイ実行**:
   ```bash
   # update-all-clients.shが自動的にnetwork_modeをチェック（警告表示）
   ./scripts/update-all-clients.sh main
   ```

3. **デプロイ後の確認**:
   ```bash
   # network_modeが正しく設定されているか確認
   ssh denkon5sd02@100.106.158.2 "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml"
   ```

**学んだこと**: 
- Git管理されている設定ファイルは、`git reset --hard`でローカル変更が失われる
- 環境依存の設定（`network_mode`）は、リポジトリのデフォルト値と実際の環境が異なる場合、デプロイのたびに再設定が必要
- デプロイスクリプトに自動チェック機能を追加することで、設定ミスを事前に検出できる

**解決状況**: ⚠️ **部分的に解決**（2025-12-13）
- デプロイスクリプトに自動チェック機能を追加済み
- 根本的な解決（`group_vars/all.yml`をGit管理外にする、または環境変数化）は今後の課題

**関連ファイル**: 
- `infrastructure/ansible/group_vars/all.yml`（`network_mode`設定）
- `infrastructure/ansible/roles/common/tasks/main.yml`（`Sync repository`タスク）
- `scripts/update-all-clients.sh`（`check_network_mode()`関数）
- `docs/guides/deployment.md`（デプロイ前チェックリスト）

---

### [KB-095] Pi4デプロイ時のファイルが見つからないエラーと権限問題

**EXEC_PLAN.md参照**: デプロイプロセス改善（2025-12-13）

**事象**: 
- Pi4へのAnsibleデプロイ時に`Source /opt/RaspberryPiSystem_002/clients/status-agent/status-agent.service not found`エラーが発生
- `Permission denied`エラーが発生し、Git操作が失敗する

**要因**: 
- Pi4上のリポジトリが古く（302コミット遅れ）、ファイル構造が変わっていた
- `/opt/RaspberryPiSystem_002`ディレクトリの所有者が`tools03`ユーザーではなく、rootや他のユーザーになっていた
- 古いリポジトリには`clients/status-agent/status-agent.service`ファイルが存在しない（削除されたか、パスが変更された）

**有効だった対策**: 
- ✅ **権限の修正**: `sudo chown -R tools03:tools03 /opt/RaspberryPiSystem_002`で所有者を修正
- ✅ **リポジトリの強制更新**: `git reset --hard origin/main && git clean -fd && git pull origin main`でリポジトリを最新状態に強制更新

**標準プロセス**:
1. **デプロイ前の確認**:
   ```bash
   # Pi4のリポジトリ状態を確認
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.106.158.4 'cd /opt/RaspberryPiSystem_002 && git log --oneline -5'"
   
   # 権限を確認
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.106.158.4 'ls -ld /opt/RaspberryPiSystem_002'"
   ```

2. **問題が発生した場合の修正**:
   ```bash
   # Pi4にSSH接続（Pi5経由）
   ssh denkon5sd02@100.106.158.2
   ssh tools03@100.106.158.4
   
   # 権限を修正
   sudo chown -R tools03:tools03 /opt/RaspberryPiSystem_002
   
   # リポジトリを強制更新
   cd /opt/RaspberryPiSystem_002
   git reset --hard origin/main
   git clean -fd
   git pull origin main
   ```

3. **デプロイ再実行**:
   ```bash
   # Macから再デプロイ
   ./scripts/update-all-clients.sh main
   ```

**学んだこと**: 
- クライアントデバイスのリポジトリが古いと、ファイル構造の変更によりデプロイが失敗する
- 権限問題は、手動操作や過去のデプロイ失敗により発生する可能性がある
- 定期的なデプロイでリポジトリの遅れを防ぐことが重要

**解決状況**: ✅ **解決済み**（2025-12-13）

**関連ファイル**: 
- `infrastructure/ansible/roles/common/tasks/main.yml`（リポジトリ同期タスク）
- `docs/guides/deployment.md`（デプロイ前チェックリスト）

---

### [KB-096] Pi3デプロイに時間がかかる問題（リポジトリの遅れ・メモリ制約）

**EXEC_PLAN.md参照**: デプロイプロセス改善（2025-12-13）

**事象**: 
- Pi3へのAnsibleデプロイに10-15分以上かかる
- デプロイ中にPi3へのSSH接続がタイムアウトする
- ログに`git reset --hard`や`git clean`の操作が長時間実行されている

**要因**: 
- Pi3上のリポジトリが302コミット遅れている（`git log --oneline | wc -l`で確認）
- Pi3のメモリが少ない（1GB、実質416MB、利用可能120MB程度）
- `git reset --hard`や`git clean -fd`などの操作がメモリを消費し、処理が遅くなる
- サイネージサービスが起動している場合、メモリ不足でハングする可能性がある（KB-089参照）

**有効だった対策**: 
- ✅ **十分な待機時間の確保**: Pi3デプロイには15-20分の時間を確保する
- ✅ **サイネージサービスの停止**: デプロイ前に`sudo systemctl stop signage-lite.service signage-lite-update.timer`でサービスを停止（KB-089参照）
- ✅ **定期的なデプロイ**: リポジトリの遅れを防ぐため、定期的にデプロイを実行する

**標準プロセス**:
1. **デプロイ前の準備**（KB-089参照）:
   ```bash
   # Pi3サイネージサービスを停止・無効化
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.106.158.3 'sudo systemctl stop signage-lite.service signage-lite-update.timer'"
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.106.158.3 'sudo systemctl disable signage-lite.service signage-lite-update.timer'"
   
   # メモリ使用状況を確認（120MB以上空きがあることを確認）
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.106.158.3 'free -m'"
   ```

2. **デプロイ実行**:
   ```bash
   # Pi3デプロイには15-20分の時間を確保
   ./scripts/update-all-clients.sh main
   ```

3. **デプロイ後の確認**:
   ```bash
   # デプロイが正常に完了したことを確認（PLAY RECAPでfailed=0）
   # サイネージサービスを再有効化・再起動
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.106.158.3 'sudo systemctl enable signage-lite.service signage-lite-update.timer'"
   ssh denkon5sd02@100.106.158.2 "ssh tools03@100.106.158.3 'sudo systemctl start signage-lite.service'"
   ```

**学んだこと**: 
- リポジトリが大幅に遅れている場合、デプロイに時間がかかる
- Pi3のようなリソース制約のあるデバイスでは、メモリ使用量に注意が必要
- サイネージサービスが起動している状態でのデプロイは、メモリ不足でハングするリスクがある

**解決状況**: ⚠️ **部分的に解決**（2025-12-13）
- 標準プロセスを確立済み
- 定期的なデプロイでリポジトリの遅れを防ぐことが重要

**関連ファイル**: 
- `docs/guides/deployment.md`（デプロイ前チェックリスト、Pi3サイネージサービス停止手順）
- `docs/knowledge-base/infrastructure.md`（KB-089: Pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング、KB-097: systemctl maskの必要性）

---

### [KB-097] Pi3デプロイ時のsignage-liteサービス自動再起動の完全防止（systemctl maskの必要性）

**EXEC_PLAN.md参照**: Pi3デプロイプロセス改善（2025-12-13）

**事象**: 
- Pi3デプロイ中に`signage-lite.service`が自動再起動し、リソースを奪う
- `systemctl disable`だけでは不十分で、デプロイ中にサービスが復帰する
- デプロイが30分以上経過しても完了しない

**要因**: 
- `signage-lite.service`が`enabled`のままだと、systemdが自動的に再起動を試みる
- `systemctl disable`だけでは、既に`enabled`状態のサービスがデプロイ中に再起動される可能性がある
- `status-agent.timer`も`enabled`のままで、関連サービスが自動起動する可能性がある
- Pi3固有の問題（Pi4では発生しない）

**調査結果**:
```bash
# デプロイ中にサービス状態を確認
systemctl is-active signage-lite.service  # → active（自動再起動していた）
systemctl is-enabled signage-lite.service  # → enabled（無効化されていなかった）
systemctl is-enabled signage-lite-update.timer  # → enabled
systemctl is-enabled status-agent.timer  # → enabled（これも無効化が必要）
```

**有効だった対策**: 
- ✅ **`systemctl mask --runtime`の追加**: `systemctl disable`に加えて`systemctl mask --runtime`を実行することで、デプロイ中の自動再起動を完全に防止
- ✅ **`status-agent.timer`も無効化**: `signage-lite.service`だけでなく、`status-agent.timer`も無効化対象に追加
- ✅ **デプロイ完了後はAnsibleが自動再有効化**: デプロイ後は手動で再有効化する必要がない（Ansibleが自動的に行う）

**標準プロセス**（KB-089を更新）:
1. **デプロイ前の準備**（完全な停止・無効化・マスク）:
   ```bash
   # Pi5からPi3へSSH接続してサイネージサービスを停止・無効化・マスク
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl stop signage-lite.service signage-lite-update.timer status-agent.timer'"
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl disable signage-lite.service signage-lite-update.timer status-agent.timer'"
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'sudo systemctl mask --runtime signage-lite.service'"
   
   # メモリ使用状況を確認（120MB以上空きがあることを確認）
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'free -m'"
   
   # プロセスが完全に停止していることを確認
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'ps aux | grep signage-lite | grep -v grep'"
   # → 何も表示されないことを確認
   
   # Pi5上で既存のAnsibleプロセスをkill（重複実行防止）
   ssh denkon5sd02@100.106.158.2 'pkill -9 -f ansible-playbook; pkill -9 -f AnsiballZ || true'
   ```

2. **デプロイ実行**:
   ```bash
   # Pi5からPi3へデプロイ
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles ANSIBLE_REPO_VERSION=main ansible-playbook -i inventory.yml playbooks/deploy.yml --limit raspberrypi3"
   ```

3. **デプロイ後の確認**:
   ```bash
   # デプロイが正常に完了したことを確認（PLAY RECAPでfailed=0）
   # 注意: Ansibleが自動的にサービスを再有効化・再起動するため、手動操作は不要
   ssh denkon5sd02@100.106.158.2 "ssh signageras3@100.105.224.86 'systemctl is-active signage-lite.service'"
   # → active を確認（Ansibleが自動的に再有効化している）
   ```

**学んだこと**: 
1. **`systemctl disable`だけでは不十分**: `enabled`状態のサービスは、デプロイ中に自動再起動する可能性がある
2. **`systemctl mask --runtime`の重要性**: デプロイ中の自動再起動を完全に防止するには、`mask --runtime`が必要
3. **関連タイマーも無効化**: `signage-lite.service`だけでなく、`status-agent.timer`も無効化対象に追加する必要がある
4. **Pi3固有の問題**: Pi4では発生しないPi3固有の問題であることを認識する
5. **Ansibleの自動再有効化**: デプロイ完了後はAnsibleが自動的にサービスを再有効化・再起動するため、手動操作は不要

**解決状況**: ✅ **解決済み**（2025-12-13）

**関連ファイル**:
- `docs/guides/deployment.md`（Pi3デプロイ前準備手順の更新）
- `docs/knowledge-base/infrastructure.md`（KB-089更新、KB-097追加）

---

### [KB-098] Phase 9/10 セキュリティ強化実装の実機テストと仕様記録

**EXEC_PLAN.md参照**: Phase 9/10 実装完了（2025-12-14）

**実装内容**: 
- Phase 9: インターネット接続時の追加防御（管理画面IP制限、Webhookアラート、セキュリティヘッダー、レート制限、ログローテーション）
- Phase 10: 認証・監視強化（MFA、リアルタイム監視、権限監査）

**実機テスト結果（2025-12-14）**:
- ✅ HTTPS/ヘッダー確認: HTTP→HTTPSリダイレクト（301）、Strict-Transport-Security含む主要セキュリティヘッダーを確認
- ✅ 管理画面IP制限: `ADMIN_ALLOW_NETS`環境変数が正しく設定され、許可IPからのアクセスが200 OK
- ✅ Webhookアラート: Webhook URL未設定時はファイルアラートのみ、設定時はWebhook送信成功
- ✅ レート制限: 認証エンドポイント10 req/min、システムAPI 120 req/minが正しく動作
- ✅ リアルタイム監視: `security-monitor.sh`が存在し実行可能、アラートファイルが生成される
- ✅ MFA/権限監査: APIエンドポイントが存在し正しく応答、統合テストで動作確認済み

**重要な知見**:
- **Strict-Transport-Securityヘッダーの追加**: `Caddyfile.local.template`に`Strict-Transport-Security`ヘッダーを追加する必要があった。デフォルトのCaddyfileには含まれていないため、明示的に追加が必要。Dockerビルドキャッシュの影響で、変更を反映するには`--no-cache`オプションでの再ビルドが必要な場合がある。
- **レート制限の実装**: Fastifyの`@fastify/rate-limit`プラグインを使用し、エンドポイント別にレート制限を設定。キー生成方法（`{IP}:{URL}`）により、同一IPから異なるエンドポイントへのアクセスは別々にカウントされる。allowListで高トラフィックエンドポイント（キオスク、WebSocket等）を除外することで、通常運用への影響を最小化。
- **Webhook送信のフォールバック**: Webhook URLが未設定でもファイルアラートは必ず生成される設計。Webhook送信失敗時もスクリプトは継続し、ファイルアラートは確実に生成される。これにより、ネットワーク障害時でもアラートが失われない。
- **環境変数のデフォルト値**: `security-monitor.sh`は環境変数のデフォルト値を使用するため、systemdサービスから実行される際も動作する。ただし、明示的に環境変数を設定することで、より柔軟な監視設定が可能。

**設定方法**:
- 詳細は [security/phase9-10-specifications.md](../security/phase9-10-specifications.md) を参照

**解決状況**: ✅ **実装完了・実機テスト完了**（2025-12-14）

**関連ファイル**: 
- `infrastructure/docker/Caddyfile.local.template`（セキュリティヘッダー設定）
- `apps/api/src/plugins/rate-limit.ts`（レート制限実装）
- `scripts/generate-alert.sh`（Webhookアラート通知）
- `infrastructure/ansible/templates/security-monitor.sh.j2`（リアルタイム監視スクリプト）
- `apps/api/src/routes/auth.ts`（MFA/権限監査API）
- `docs/security/phase9-10-specifications.md`（詳細仕様書）

---

### [KB-100] CIテストが失敗してもマージが進んでしまう問題（再発）

**発生日**: 2025-12-15

**事象**: 
- CIテストが失敗しているにもかかわらず、PRがマージされてしまう
- ブランチ保護ルールが設定されていない、または適切に設定されていない

**要因**: 
- GitHubのブランチ保護ルールが設定されていない
- 「Do not allow bypassing the above settings」がチェックされていない
- CIワークフローで一部のステップに`|| exit 1`が設定されていない

**有効だった対策**: 
- ✅ **CIワークフローの強化**（2025-12-15）:
  - すべてのテストステップに`|| exit 1`を追加
  - `e2e-tests`ジョブから`continue-on-error: true`を削除（既に実施済み）
  - `e2e-tests`ジョブのコメントを修正（「non-blocking」→「blocking」に変更）
  - `imports-dropbox`テストをCIワークフローに追加
- ✅ **ドキュメントの作成**（2025-12-15）:
  - `.github/BRANCH_PROTECTION_SETUP.md`を作成（設定手順を明確化）
  - `docs/guides/ci-branch-protection.md`を更新
  - `README.md`にブランチ保護設定のリンクを追加

**必須対応**: 
- ⚠️ **GitHubでのブランチ保護ルール設定**（手動で実施が必要）:
  1. GitHubリポジトリの「Settings」→「Branches」にアクセス
  2. `main`ブランチの保護ルールを追加
  3. 「Require status checks to pass before merging」にチェック
  4. 「Require branches to be up to date before merging」にチェック
  5. 必須チェックとして以下を選択：
     - `lint-and-test`
     - `e2e-smoke`
     - `docker-build`
  6. **「Do not allow bypassing the above settings」にチェック**（最重要）
  7. 設定を保存
  8. `develop`ブランチにも同様の設定

**学んだこと**: 
- CIワークフローで`|| exit 1`を設定しても、ブランチ保護ルールが設定されていないとマージできてしまう
- 「Do not allow bypassing the above settings」をチェックしないと、管理者でもテストをスルーできてしまう
- ブランチ保護ルールの設定は手動で実施する必要があり、自動化できない
- CI必須化の実装だけでなく、GitHubの設定も必須

**解決状況**: ⚠️ **部分解決**（CIワークフローは強化済み、ブランチ保護ルールの設定は手動で実施が必要）

**関連ファイル**: 
- `.github/workflows/ci.yml`（CIワークフロー）
- `.github/BRANCH_PROTECTION_SETUP.md`（設定手順）
- `docs/guides/ci-branch-protection.md`（詳細ガイド）
- `README.md`（READMEにリンク追加）

---

### [KB-102] Ansibleによるクライアント端末バックアップ機能実装時のAnsibleとTailscale連携問題

**EXEC_PLAN.md参照**: Phase 6: Ansibleによるクライアント端末バックアップ機能（2025-12-19）

**事象**: 
- クライアント端末（Pi4、Pi3など）のファイルをAnsible経由でバックアップする機能を実装中に、Ansible Playbookの実行が失敗する
- エラーメッセージ: `raspberrypi4({{ kiosk_ip }})`として表示され、変数が展開されていない
- SSH接続エラー: `Permission denied (publickey,password)`
- ファイル不存在エラー: `the remote file does not exist, not transferring, ignored`

**要因**: 

1. **Ansible Playbookの`hosts`指定と変数展開の問題**:
   - 初期実装では`hosts: localhost` + `delegate_to: "{{ client_host }}"`パターンを使用していた
   - `hosts: localhost`で実行すると、`group_vars/all.yml`の変数（`kiosk_ip`など）が読み込まれない
   - 結果として、`ansible_host: "{{ kiosk_ip }}"`が展開されず、`{{ kiosk_ip }}`のままになる
   - Ansibleは`raspberrypi4({{ kiosk_ip }})`というホスト名で接続を試み、失敗する

2. **SSH鍵のマウント問題**:
   - Dockerコンテナ内からSSH接続する際に、Pi5のホスト側のSSH鍵（`/home/denkon5sd02/.ssh/id_ed25519`）がマウントされていない
   - `docker-compose.server.yml`にSSH鍵ディレクトリのマウント設定がなかった
   - 結果として、Dockerコンテナ内からPi4へのSSH接続が失敗する

3. **Tailscale経由の接続と変数展開**:
   - システムはTailscale経由で接続されることが多く、`group_vars/all.yml`の`network_mode`が`tailscale`に設定されている
   - `network_mode: "tailscale"`の場合、`kiosk_ip`は`tailscale_network.raspberrypi4_ip`（例: `100.74.144.79`）に解決される必要がある
   - `hosts: localhost`では、この変数展開が行われない

4. **エラーハンドリングの不足**:
   - Ansible Playbookのエラーメッセージを解析せず、汎用的な500エラーを返していた
   - ファイルが存在しない場合と、SSH接続エラーの区別ができなかった

**試行した対策**: 

- [試行1] `hosts: localhost` + `ansible_connection: local`を追加 → **部分的に成功**（SSH接続は成功したが、変数展開の問題は解決しない）
- [試行2] SSH鍵をマウント → **成功**（SSH接続エラーは解消）
- [試行3] `hosts: "{{ client_host }}"`に変更 → **成功**（変数展開の問題が解決）

**有効だった対策**: 

1. **Ansible Playbookの`hosts`指定を変更**:
   ```yaml
   # 変更前
   hosts: localhost
   delegate_to: "{{ client_host }}"
   
   # 変更後
   hosts: "{{ client_host }}"
   # delegate_toを削除
   ```
   - `hosts: "{{ client_host }}"`に変更することで、Ansibleは`inventory.yml`から`raspberrypi4`を検索
   - `inventory.yml`の`raspberrypi4`の`ansible_host: "{{ kiosk_ip }}"`が`group_vars/all.yml`の`kiosk_ip`で展開される
   - `network_mode: "tailscale"`の場合、`kiosk_ip`は`tailscale_network.raspberrypi4_ip`に解決される
   - 結果として、Ansibleは正しいTailscale IPでPi4に接続できる

2. **SSH鍵のマウント追加**:
   ```yaml
   # docker-compose.server.yml
   volumes:
     - /home/denkon5sd02/.ssh:/root/.ssh:ro
   ```
   - Pi5のホスト側のSSH鍵（`/home/denkon5sd02/.ssh/id_ed25519`）をDockerコンテナ内の`/root/.ssh/id_ed25519`にマウント
   - 読み取り専用（`:ro`）でマウントし、セキュリティを確保

3. **エラーハンドリングの改善**:
   ```typescript
   // Ansible Playbookのエラーメッセージを解析
   const errorMessage = stderr || stdout || '';
   const isFileNotFound = 
     errorMessage.includes('the remote file does not exist') ||
     errorMessage.includes('not transferring') ||
     errorMessage.includes('does not exist');
   
   if (isFileNotFound) {
     throw new ApiError(404, `バックアップ対象のファイルが見つかりません: ${this.clientHost}:${this.remotePath}`);
   }
   ```
   - Ansible Playbookのエラーメッセージを解析し、「ファイルが存在しない」場合は404エラーを返す
   - `FileBackupTarget`と同様のエラーハンドリングを実装

**学んだこと**: 

1. **Ansible Playbookの`hosts`指定の重要性**:
   - `hosts: localhost`で実行すると、`group_vars/all.yml`の変数が読み込まれない
   - `hosts: "{{ client_host }}"`のように直接ホストを指定すると、inventoryの変数が正しく展開される
   - `delegate_to`を使う場合でも、`hosts`で直接ホストを指定する方が変数展開が確実

2. **Tailscale経由の接続とAnsible**:
   - Tailscale経由の接続でも、Ansibleのinventoryで正しくIPアドレスが解決されれば問題なく動作する
   - `network_mode: "tailscale"`の場合、`group_vars/all.yml`の`kiosk_ip`は`tailscale_network.raspberrypi4_ip`に解決される
   - `hosts: "{{ client_host }}"`で実行すると、この変数展開が正しく行われる

3. **Dockerコンテナ内からのSSH接続**:
   - Dockerコンテナ内からSSH接続する場合は、SSH鍵をマウントする必要がある
   - 読み取り専用（`:ro`）でマウントし、セキュリティを確保する
   - SSH鍵のパーミッション（`~/.ssh`は700、`id_ed25519`は600）も重要

4. **Ansible Playbookのエラーハンドリング**:
   - Ansible Playbookのエラーメッセージを適切に解析することで、より明確なエラーハンドリングが可能
   - 「ファイルが存在しない」場合は404エラー、「SSH接続エラー」の場合は500エラーを返すなど、エラーの種類に応じた適切なHTTPステータスコードを返す

**解決状況**: ✅ **解決済み**（2025-12-19）

**関連ファイル**: 
- `infrastructure/ansible/playbooks/backup-clients.yml`
- `apps/api/src/services/backup/targets/client-file-backup.target.ts`
- `infrastructure/docker/docker-compose.server.yml`
- `infrastructure/ansible/inventory.yml`
- `infrastructure/ansible/group_vars/all.yml`

**関連ドキュメント**:
- [Ansible SSH接続アーキテクチャの説明](../guides/ansible-ssh-architecture.md)
- [バックアップ設定ガイド](../guides/backup-configuration.md)
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)

---

### [KB-103] バックアップ対象ごとのストレージプロバイダー指定機能実装（Phase 1-2）

**EXEC_PLAN.md参照**: Phase 8: バックアップ対象ごとのストレージプロバイダー指定機能（2025-12-28）

**背景**: 
- バックアップ対象ごとに異なるストレージプロバイダー（ローカル/Dropbox）を指定したい要望があった
- 重要な設定ファイルはローカルとDropboxの両方にバックアップしたい（多重バックアップ）
- 大きなファイル（写真データなど）はローカルのみにバックアップしたい

**実装内容**:

**Phase 1: 単一プロバイダー指定**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`storage.provider`を追加（オプショナル）
- ✅ StorageProviderFactory: `createFromTarget`メソッドを追加
- ✅ BackupScheduler: 対象ごとのストレージプロバイダーを使用
- ✅ UI: バックアップ先選択欄を追加（ドロップダウン）
- ✅ 後方互換性: `storage`未指定時は全体設定を使用

**Phase 2: 多重バックアップ**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`storage.providers`配列を追加
- ✅ BackupScheduler: 複数のプロバイダーに順次バックアップを実行
- ✅ UI: チェックボックスで複数のプロバイダーを選択可能に
- ✅ エラーハンドリング: 1つのプロバイダーで失敗しても他のプロバイダーへのバックアップは継続

**UI変更**:
- スケジュール入力UIを改善（テキスト入力 → 時刻入力フィールド + 曜日選択ボタン）
- バックアップ先選択をチェックボックス形式に変更（複数選択可能）

**技術的な詳細**:

- **スキーマ構造**:
  ```typescript
  {
    storage?: {
      provider?: 'local' | 'dropbox';  // Phase 1: 単一プロバイダー
      providers?: ('local' | 'dropbox')[];  // Phase 2: 複数プロバイダー
    }
  }
  ```

- **優先順位**:
  1. `storage.providers`が指定されている場合 → 配列を使用（多重バックアップ）
  2. `storage.provider`が指定されている場合 → 単一プロバイダーとして扱う
  3. 未指定の場合 → 全体設定（`config.storage.provider`）を使用

- **多重バックアップの動作**:
  - 各プロバイダーに順次バックアップを実行
  - 1つのプロバイダーで失敗しても、他のプロバイダーへのバックアップは継続
  - すべてのプロバイダーで失敗した場合のみエラーをスロー

**学んだこと**: 
- 後方互換性を保ちながら段階的に機能を拡張できる（Phase 1 → Phase 2）
- UIの改善（スケジュール入力）と機能追加（ストレージプロバイダー指定）を同時に実装できる
- E2EテストはUI変更に合わせて修正が必要（`getByLabel` → `locator`）

**解決状況**: ✅ **解決済み**（2025-12-28）

**関連ファイル**: 
- `apps/api/src/services/backup/backup-config.ts`
- `apps/api/src/services/backup/storage-provider-factory.ts`
- `apps/api/src/services/backup/backup-scheduler.ts`
- `apps/api/src/routes/backup.ts`
- `apps/web/src/components/backup/BackupTargetForm.tsx`
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`
- `e2e/admin.spec.ts`

**関連ドキュメント**: 
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)
- [バックアップ・リストア手順](../guides/backup-and-restore.md)

---

### [KB-104] バックアップ対象ごとの保持期間設定と自動削除機能実装（Phase 3）

**EXEC_PLAN.md参照**: Phase 9: バックアップ対象ごとの保持期間設定と自動削除機能（2025-12-28）

**背景**: 
- バックアップ対象ごとに異なる保持期間を設定したい要望があった
- データベースは30日、写真データは7日など、対象ごとに最適な保持期間を設定したい
- 手動での削除作業を自動化したい

**実装内容**:

**Phase 3: 対象ごとの保持期間設定**:
- ✅ BackupConfigスキーマ: `BackupTarget`に`retention`フィールドを追加（`days`、`maxBackups`）
- ✅ BackupScheduler: `cleanupOldBackups`メソッドを対象ごとの`retention`設定に対応
- ✅ 対象ごとのバックアップのみをクリーンアップ（`prefix`でフィルタ）
- ✅ UI: 保持期間設定欄を追加（保持日数、最大保持数の入力フィールド）
- ✅ UI: テーブルに保持期間列を追加
- ✅ 後方互換性: `retention`未指定時は全体設定を使用

**技術的な詳細**:

- **スキーマ構造**:
  ```typescript
  {
    retention?: {
      days?: number;  // 保持日数（例: 30日）
      maxBackups?: number;  // 最大保持数（例: 10件）
    }
  }
  ```

- **優先順位**:
  1. 対象ごとの`retention`設定（指定されている場合）
  2. 全体設定（`config.retention`）
  3. 未指定の場合はクリーンアップを実行しない

- **自動削除の動作**:
  - バックアップ実行時に自動的に期限切れバックアップを削除
  - 対象ごとのバックアップのみをクリーンアップ（`prefix`でフィルタ）
  - 保持日数を超えたバックアップを削除
  - 最大保持数を超えた場合は古いものから削除

- **クリーンアップの実装**:
  ```typescript
  // 対象ごとのバックアップのみを取得（prefixが指定されている場合）
  const backups = await backupService.listBackups({ prefix });
  const retentionDate = new Date(now.getTime() - retention.days * 24 * 60 * 60 * 1000);
  // 期限切れバックアップを削除
  ```

**UI変更**:
- 保持期間設定欄を追加（保持日数、最大保持数の入力フィールド）
- テーブルに保持期間列を追加（例: "30日 / 最大10件" または "全体設定: 30日 / 最大10件"）

**学んだこと**: 
- 対象ごとの設定を実装する際は、全体設定との優先順位を明確にする必要がある
- バックアップのクリーンアップは対象ごとに実行するため、`prefix`でフィルタすることが重要
- 後方互換性を保つため、未指定時は全体設定を使用する設計が有効

**解決状況**: ✅ **解決済み**（2025-12-28）

**関連ファイル**: 
- `apps/api/src/services/backup/backup-config.ts`
- `apps/api/src/services/backup/backup-scheduler.ts`
- `apps/api/src/routes/backup.ts`
- `apps/web/src/components/backup/BackupTargetForm.tsx`
- `apps/web/src/pages/admin/BackupTargetsPage.tsx`

**関連ドキュメント**: 
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)
- [バックアップ・リストア手順](../guides/backup-and-restore.md)

---

### [KB-101] Pi5へのSSH接続不可問題の原因と解決

**発生日時**: 2025-12-15（推定）

**症状**: 
- Pi5 (`raspberrypi.local`) へのSSH接続が突然失敗
- エラーメッセージ: `REMOTE HOST IDENTIFICATION HAS CHANGED!`
- `Permission denied (publickey,password)` エラー

**原因分析**:

#### 1. SSHホストキーの不一致（主原因）

**状況**:
- Pi5のSSHホストキー（`/etc/ssh/ssh_host_ed25519_key.pub`）は **2025-11-24 11:11** に作成
- クライアント側の `~/.ssh/known_hosts` に古いホストキーが記録されていた
- Pi5のSSHホストキーが変更されたか、またはクライアント側のknown_hostsが古い状態だった

**確認方法**:
```bash
# クライアント側で確認
ssh-keygen -F raspberrypi.local -l

# Pi5側で確認
sudo cat /etc/ssh/ssh_host_ed25519_key.pub
```

#### 2. Git force pushの影響（主原因の可能性）

**状況**:
- **2025-12-15 16:53:49**: mainブランチに`feature/dropbox-csv-import-phase1`をマージ
- **2025-12-15 16:59:57**: mainブランチをforce pushでロールバック（`git reset --hard af2946e` → `git push origin main --force`）
- **2025-12-15 17:01**: Pi5がシステム再起動

**影響**:
- Pi5側の`refactor/imports-ts-refactoring`ブランチがリモートより13コミット先行している状態になった
- Pi5側は既に`git pull`で新しいコミット（`feature/dropbox-csv-import-phase1`のコミット）を取得していた
- force pushによりリモートブランチが巻き戻り、Pi5側のローカルブランチがリモートより先行
- この状態で`git pull`を実行すると、競合やエラーが発生する可能性がある

**確認方法**:
```bash
# Pi5側で確認
git log --oneline refactor/imports-ts-refactoring ^origin/refactor/imports-ts-refactoring
# 13コミットが先行していることを確認

# リモートとの差分確認
git fetch origin
git log --oneline origin/refactor/imports-ts-refactoring..refactor/imports-ts-refactoring
```

**根本原因**:
- **mainブランチへのforce push**により、リモートのブランチ履歴が巻き戻った
- Pi5側は既に新しいコミットを取得していたため、ローカルブランチがリモートより先行
- この状態でgit操作（`git pull`など）を実行すると、予期しない動作やエラーが発生する可能性がある

#### 3. システム再起動の影響

**状況**:
- Pi5は **2025-12-15 17:01** に再起動（force pushの直後）
- SSHサービスは正常に起動（`systemctl status ssh`）
- WiFi接続も正常に確立（`wlan0: 192.168.10.230`）

**影響**:
- 再起動によりネットワーク設定がリセットされた可能性
- mDNS/Bonjourサービス（`avahi-daemon`）も再起動
- **force pushの影響で壊れたgit状態が、再起動時に問題を引き起こした可能性**

#### 4. ネットワークの一時的な問題

**状況**:
- WiFi接続は12月15日17:01に確立
- mDNS/Bonjourサービスは正常動作
- `.local` ドメイン解決は正常

**可能性**:
- WiFi接続の一時的な不安定さ
- mDNS/Bonjourの解決遅延

#### 5. ユーザー名の不一致

**状況**:
- 最初は `tsuda@raspberrypi.local` で接続試行 → 失敗
- その後 `denkon5sd02@raspberrypi.local` で接続成功

**原因**:
- Pi5に `tsuda` ユーザーが存在しない、またはSSH公開鍵が登録されていない

**解決方法**:

##### 1. SSHホストキーの更新（実施済み）

```bash
# クライアント側で古いホストキーを削除
ssh-keygen -R raspberrypi.local

# 新しいホストキーで接続（自動的に追加される）
ssh -o StrictHostKeyChecking=accept-new denkon5sd02@raspberrypi.local
```

##### 2. 正しいユーザー名の使用

```bash
# 正しいユーザー名で接続
ssh denkon5sd02@raspberrypi.local

# または、IPアドレス直接指定
ssh denkon5sd02@192.168.10.230
```

##### 3. SSH設定の確認

**Pi5側の設定**:
- `PubkeyAuthentication yes` ✅
- `PasswordAuthentication yes` ✅
- SSHポート: 22（デフォルト）

**クライアント側の設定**:
- `~/.ssh/config` に設定があれば確認
- SSH公開鍵が正しく登録されているか確認

##### 4. ネットワーク接続の確認

```bash
# Pi5へのping確認
ping -c 3 raspberrypi.local

# mDNS解決の確認
avahi-resolve -n raspberrypi.local

# 直接IPアドレスで接続
ssh denkon5sd02@192.168.10.230
```

**根本原因**:

1. **Git force pushの影響**（最も可能性が高い）
   - mainブランチへのforce pushにより、リモートブランチが巻き戻った
   - Pi5側は既に新しいコミットを取得していたため、ローカルブランチがリモートより先行
   - この状態でgit操作を実行すると、予期しない動作やエラーが発生
   - **force pushのタイミング（16:59:57）とPi5の再起動（17:01）が一致している**

2. **SSHホストキーの不一致**
   - Pi5のSSHホストキーが変更された（OS再インストール、SSH設定の再生成など）
   - クライアント側のknown_hostsが古い状態だった
   - ただし、これはforce pushとは直接関係ない可能性が高い

3. **ユーザー名の不一致**
   - `tsuda` ユーザーが存在しない、またはSSH公開鍵が登録されていない
   - 正しいユーザー名 `denkon5sd02` を使用する必要がある

4. **システム再起動の影響**
   - 12月15日17:01に再起動があり、ネットワーク設定がリセットされた可能性
   - force pushの直後に再起動が発生したため、git状態の問題が表面化した可能性

**再発防止策**:

1. **mainブランチへのforce pushの禁止**:
   - mainブランチへのforce pushは絶対に避ける
   - ロールバックが必要な場合は、新しいコミットで修正する
   - 既にpullしたリモート環境への影響を考慮する

2. **Git状態の確認**:
   ```bash
   # Pi5側で定期的にgit状態を確認
   git fetch origin
   git status
   git log --oneline HEAD..origin/refactor/imports-ts-refactoring
   ```

3. **SSH接続の自動化スクリプト**:
   ```bash
   # ~/.ssh/config に設定を追加
   Host raspberrypi
       HostName raspberrypi.local
       User denkon5sd02
       StrictHostKeyChecking accept-new
       UserKnownHostsFile ~/.ssh/known_hosts
   ```

4. **定期的な接続確認**:
   ```bash
   # 接続テストスクリプト
   ssh -o ConnectTimeout=5 denkon5sd02@raspberrypi.local "echo 'OK'"
   ```

5. **SSHホストキーのバックアップ**:
   ```bash
   # Pi5側でホストキーをバックアップ
   sudo tar czf /opt/backup/ssh_host_keys_$(date +%Y%m%d).tar.gz /etc/ssh/ssh_host_*_key*
   ```

6. **監視とアラート**:
   - SSH接続失敗を監視
   - ホストキー変更を検知したらアラート

**学んだこと**: 
- **mainブランチへのforce pushは絶対に避けるべき**。既にpullしたリモート環境に深刻な影響を与える
- force pushの影響で、リモートブランチが巻き戻ると、既に新しいコミットを取得していた環境でgit状態が壊れる
- Pi5側の`refactor/imports-ts-refactoring`ブランチがリモートより13コミット先行している状態は、force pushの影響によるもの
- SSHホストキーの変更は、OS再インストールやSSH設定の再生成時に発生する
- `REMOTE HOST IDENTIFICATION HAS CHANGED!` エラーは、セキュリティ上の警告であり、正しいホストキーで更新する必要がある
- ユーザー名の不一致も接続失敗の原因となる
- システム再起動後は、ネットワーク設定やサービスがリセットされる可能性がある
- **force pushのタイミングと問題発生のタイミングが一致している場合、git操作が原因の可能性が高い**

**解決状況**: ✅ **解決済み**（2025-12-16）

**関連ファイル**: 
- `~/.ssh/known_hosts`（クライアント側）
- `/etc/ssh/ssh_host_*_key*`（Pi5側）
- `~/.ssh/config`（SSH設定ファイル）

---
