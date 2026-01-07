---
title: デジタルサイネージ軽量モード計画
tags: [デジタルサイネージ, Raspberry Pi Zero, Raspberry Pi 3, 軽量クライアント]
audience: [開発者, 運用者]
last-verified: 2025-11-28
related: [README.md, ../../EXEC_PLAN.md, ../../scripts/client/setup-signage.sh]
category: modules
update-frequency: high
---

# デジタルサイネージ軽量モード計画

## 背景

- 工場現場では **Raspberry Pi 3 や Raspberry Pi Zero 2W** をクライアントとして常時稼働させたい。
- 既存の `/signage`（React + Chromium）構成は、1GB未満のメモリ環境では CPU / メモリ負荷が高く、Chromium の警告ダイアログも表示される。
- ラズパイ 5 で PDF を JPEG に変換する処理は完了したが、クライアントは依然としてブラウザ描画を行っているため、軽量とは言えない。

## 設計方針（安定化施策）

### SDカードへの書込み削減（最優先）
- **画像キャッシュをtmpfs（RAM）に配置**: `/run/signage` を使用することで、30秒ごとのJPEG更新によるSDカードへの書込みをほぼゼロ化
- **効果**: SDカードの寿命延長、破損リスクの低減、システム安定性の向上
- **実装**: systemd-tmpfilesで `/run/signage` ディレクトリを自動作成（再起動後も確実に作成される）

### 自動復旧機能
- **watchdog**: 画像更新が停止した場合（2分以上更新されていない）を検知し、自動的に復旧を試行
  - 1. `signage-lite-update.service` を手動実行
  - 2. 復旧しない場合は `signage-lite.service` を再起動
- **日次再起動**: 毎日深夜3時に自動再起動し、メモリリークや累積エラーのリセット

### サービス堅牢化
- **DISPLAY準備待ち**: `ExecStartPre` でX11が利用可能になるまで待機（最大30秒）
- **暴走防止**: `StartLimitIntervalSec/StartLimitBurst` で連続失敗時の制御
- **enabled状態の収束**: Ansibleデプロイ時に必ず `enabled=true` を保証（サービス無効化ドリフトの防止）

## 目的

1. **低スペック端末でも安定稼働する軽量表示経路**を提供する。
2. **サーバー側レンダリング（静止画出力）**を導入し、クライアント処理を最小化する。
3. Raspberry Pi 3 / Zero 2W で 24h 連続稼働できる構成を確立する。

## スコープ

| 項目 | 内容 |
|------|------|
| 表示形式 | 静止画（JPEG）を基本とし、サーバー側で生成した1枚の画像をループ表示 |
| クライアントOS | Raspberry Pi OS Lite（GUIなし）を基本とし、必要な最小限の X11 + ビューアのみを導入 |
| ビューア | `feh` などの軽量画像ビューア、もしくは `imv` / `mpv` 等 |
| コンテンツ更新 | HTTP で最新画像を取得、または rsync/SCP でローカルキャッシュを更新 |

## 段階的な実装計画

### Phase A: 設計とPoC
- [ ] サーバー側でツール表示 / PDF表示 / 分割表示を **静止画にレンダリングするパイプライン**（例: Puppeteer, headless Chromium, html-to-image）を設計
- [ ] 軽量クライアントの PoC（Raspberry Pi 3 + feh で `/tmp/signage/current.jpg` を表示）を用意

### Phase B: サーバー側レンダリング機構
- [ ] 既存 `/signage` UI を headless で撮影し `/storage/signage-rendered/latest.jpg` を生成
- [ ] 30秒ごとに画像生成ジョブを実行、API `/api/signage/current-image` で配信
- [ ] 生成失敗時のフォールバック画像/メッセージを用意

### Phase C: 軽量クライアント実装
- [x] Raspberry Pi OS Lite 用のセットアップスクリプトを追加（`scripts/client/setup-signage-lite.sh`）
- [x] `feh` + systemd サービスで `current.jpg` をループ表示（再取得間隔 configurable）
- [x] ネットワーク断時はローカルキャッシュを表示、復帰後に自動更新

### Phase D: モード切替と統合
- [ ] 管理画面で「表示モード（通常 / 軽量）」を切り替えられるようにする
- [ ] `setup-signage.sh` を通常モード、`setup-signage-lite.sh` を軽量モードとして提供
- [ ] Raspberry Pi 3 / Zero 2W で 24時間連続稼働テストを実施し、温度/負荷/再接続テストを記録

## 軽量クライアントのセットアップ

### 前提条件

- Raspberry Pi 3 / Zero 2W に Raspberry Pi OS Lite をインストール済み
- X11が利用可能（GUI環境またはX11のみインストール）
- サーバー（Raspberry Pi 5）のURLとクライアントキーを取得済み

### セットアップ手順

1. **リポジトリをクローンまたは更新**:
   ```bash
   cd /opt
   git clone https://github.com/denkoushi/RaspberryPiSystem_002.git
   # または既存のリポジトリを更新
   cd RaspberryPiSystem_002
   git pull origin feature/signage-lite-client
   ```

2. **セットアップスクリプトを実行**:
   ```bash
   sudo ./scripts/client/setup-signage-lite.sh <サーバーURL> <クライアントキー>
   ```
   
   例:
   ```bash
   sudo ./scripts/client/setup-signage-lite.sh https://192.168.128.131 abc123def456...
   ```

3. **動作確認**:
   ```bash
   # サービスステータス確認
   systemctl status signage-lite
   
   # ログ確認
   journalctl -u signage-lite -f
   
   # 画像更新タイマー確認
   systemctl status signage-lite-update.timer
   ```

### 設定のカスタマイズ

環境変数で更新間隔を変更可能：

```bash
export SIGNAGE_UPDATE_INTERVAL=60  # 60秒間隔に変更
sudo ./scripts/client/setup-signage-lite.sh <サーバーURL> <クライアントキー>
```

自己署名証明書を使用する環境では、デフォルトで `curl -k` を付与して証明書検証をスキップします。商用証明書を導入済みの場合は以下で無効化できます。

```bash
export SIGNAGE_ALLOW_INSECURE_TLS=false  # 証明書検証を有効化
sudo ./scripts/client/setup-signage-lite.sh <サーバーURL> <クライアントキー>
```

### トラブルシューティング

- **画像が表示されない**: `/run/signage/current.jpg` が存在するか確認（tmpfsのため再起動後は空）
- **初回ダウンロードで `feh: No loadable images specified` が出る**: `signage-lite` サービス再起動前に `/usr/local/bin/signage-update.sh` を実行してキャッシュを生成
- **ネットワークエラー**: サーバーURLとクライアントキーが正しいか確認
- **自己署名証明書で失敗する**: `SIGNAGE_ALLOW_INSECURE_TLS=true` のまま実行するか、端末にルート証明書をインポート
- **X11エラー**: `export DISPLAY=:0` が設定されているか確認
- **画像更新が停止している**: `systemctl status signage-lite-watchdog.timer` でwatchdogが動作しているか確認。手動復旧: `systemctl start signage-lite-update.service`
- **サービスが無効化されている**: `systemctl is-enabled signage-lite.service` で確認。`enabled` でない場合は `systemctl enable signage-lite.service` で再有効化

### 運用メモ（自動/手動レンダリング）

- APIサーバー起動時に `SignageRenderScheduler` が自動で起動し、既定で30秒間隔 (`SIGNAGE_RENDER_INTERVAL_SECONDS`) で `current.jpg` を再生成します。  
- 管理画面のサイネージスケジュール一覧には「再レンダリング」ボタンとステータス表示を追加済みで、`GET /api/signage/render/status` → `POST /api/signage/render` を内部で呼び出しています。  
- 軽量クライアントは `/api/signage/current-image` を取得するだけなので、サーバー側で `current.jpg` が更新されているかを `docker compose exec api ls -lh /app/storage/signage-rendered/current.jpg` で確認すると切り分けが容易です。

### ストレージ保存ポリシー（10年運用対応）

**重要**: `SIGNAGE_RENDER_DIR`（デフォルト: `/opt/RaspberryPiSystem_002/storage/signage-rendered`）配下のファイル保存ポリシー：

- **`current.jpg`のみが運用上必要**: このファイルのみが`/api/signage/current-image`エンドポイントで配信され、クライアントが取得する唯一の画像です。
- **履歴画像は保持しない**: `signage_${Date.now()}.jpg`形式の履歴画像は**デフォルトでは生成されません**（環境変数`SIGNAGE_RENDER_KEEP_HISTORY=1`で有効化可能だが、推奨しない）。
- **自動メンテナンス**: もし履歴画像が生成された場合、`storage-maintenance.service`（systemd timer）が毎日自動実行され、`signage_*.jpg`ファイルを削除します（`current.jpg`は保持）。
- **ストレージ使用量の監視**: ディスク使用量が80%または90%を超えた場合、`monitor.sh`が`storage-usage-high`アラートを生成し、管理コンソールに表示されます。

詳細は [KB-130](../../knowledge-base/infrastructure/miscellaneous.md#kb-130-pi5のストレージ使用量が異常に高い問題docker-build-cacheとsignage-rendered履歴画像の削除) を参照してください。

### Pi3クライアント側のストレージ（tmpfs化）

**画像キャッシュはtmpfs（RAM）に配置**:

- **キャッシュディレクトリ**: `/run/signage`（tmpfs、再起動で消える）
- **効果**: SDカードへの書込みをほぼゼロ化（30秒ごとのJPEG更新による書込みを削減）
- **自動作成**: systemd-tmpfiles（`/etc/tmpfiles.d/signage-lite.conf`）で再起動後も確実に作成
- **注意**: 再起動後は画像が消えるため、初回起動時にサーバーから取得する（ネットワーク未接続時は表示できない）

## 解像度設定

50インチなどの大型モニタで近くから見る場合、文字のボケを防ぐため4K解像度（3840x2160）を推奨します。

### 環境変数による設定

`docker-compose.server.yml` の `api` サービスに以下の環境変数を追加：

```yaml
api:
  environment:
    # 4K解像度に設定（デフォルト: 1920x1080）
    SIGNAGE_RENDER_WIDTH: "3840"
    SIGNAGE_RENDER_HEIGHT: "2160"
    # PDF変換DPIも上げる（デフォルト: 150、4Kの場合は300推奨）
    SIGNAGE_PDF_DPI: "300"
```

### 解像度別の推奨設定

| モニタサイズ | 解像度 | DPI | 用途 |
|------------|--------|-----|------|
| 32インチ以下 | 1920x1080 | 150 | 遠くから見る場合 |
| 50インチ以上 | 3840x2160 | 300 | 近くから見る場合、文字の可読性重視 |

**注意**: 4K解像度にすると、画像サイズが約4倍になり、レンダリング処理時間とネットワーク転送時間が増加します。

## 自動レンダリング機能

定期レンダリングは `node-cron` を使用して実装されています。APIサーバー起動時に自動的に開始されます。

### 設定方法

環境変数 `SIGNAGE_RENDER_INTERVAL_SECONDS` でレンダリング間隔を設定可能（デフォルト: 30秒）：

```yaml
# docker-compose.server.yml
api:
  environment:
    SIGNAGE_RENDER_INTERVAL_SECONDS: "30"  # 30秒ごとにレンダリング
    SIGNAGE_TIMEZONE: "Asia/Tokyo"        # スケジュール判定用タイムゾーン
```

### 動作確認

1. **APIコンテナのログを確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "signage render"
   ```

2. **レンダリングされた画像を確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
     ls -la /app/storage/signage-rendered
   ```

3. **current-image APIで取得**:
   ```bash
   curl -H "x-client-key: <CLIENT_KEY>" \
     http://localhost:8080/api/signage/current-image \
     --output /tmp/current.jpg
   ```

## 計測機器持出アイテムの表示改善（2025-12-11）

サイネージの工具データ左ペインで、計測機器の持出アイテムを視覚的に識別できるよう改善しました。

### 変更内容

1. **バックエンド（`signage.service.ts`）**:
   - `getToolsData()` で `measuringInstrument` をincludeし、`isInstrument` / `managementNumber` フィールドを追加
   - 計測機器の場合は名称・管理番号を計測機器マスターから取得

2. **レンダラー（`signage.renderer.ts`）**:
   - `buildToolCardGrid()` で `isInstrument` 判定を追加
   - 計測機器: 藍系背景（`rgba(49,46,129,0.6)`）、藍系ストローク（`rgba(99,102,241,0.5)`）
   - 計測機器: 管理番号を上段（藍色・小さめ）、名称を下段（白・標準）に表示
   - 工具: 従来のダーク背景を維持

3. **フロントエンド（`SignageDisplayPage.tsx`）**:
   - `ToolCard` コンポーネントで `isInstrument` 判定を追加
   - 計測機器は `bg-indigo-900/30` + `border-indigo-400/40` で表示
   - 計測機器は管理番号＋名称の2行表示

### 確認方法

```bash
# サイネージコンテンツAPIで確認
curl -s -H 'x-client-key: client-key-raspberrypi3-signage1' \
  http://localhost:8080/api/signage/content | jq '.tools[] | {name, isInstrument, managementNumber}'
```

## 安定化施策（実装済み）

- [x] **tmpfs化**: 画像キャッシュを `/run/signage`（tmpfs）に移行し、SDカードへの書込みを削減 ✅
- [x] **watchdog**: 画像更新停止を検知して自動復旧 ✅
- [x] **日次再起動**: 毎日深夜3時に自動再起動 ✅
- [x] **サービス堅牢化**: DISPLAY準備待ち、StartLimit追加 ✅
- [x] **enabled状態の収束**: Ansibleデプロイ時に必ず有効化を保証 ✅

## 今後のタスク

- [x] **自動レンダリング機能**: node-cron を使用して、定期的にコンテンツをレンダリングする機能を実装 ✅
- [x] **計測機器持出アイテムの識別表示**: 藍系背景・管理番号表示で工具と識別 ✅
- [ ] **管理画面からの手動トリガー**: 管理画面にボタンを追加して、必要時に手動でレンダリングを実行できるようにする
- [ ] **Raspberry Pi Zero 2W での実機テスト**: 24時間連続稼働テストを実施し、CPU温度・メモリ使用量・ネットワーク断時の挙動を記録
- [ ] **モード切替機能**: 管理画面またはセットアップスクリプトで「通常モード / 軽量モード」を選択できるようにする
- Raspberry Pi Zero 2Wによる24時間耐久テストで温度・再接続シナリオを記録する。
- 通常モード / 軽量モードをセットアップ時に選択できるようにする。

## 追加で検討する項目

- **ログ取得**: 軽量クライアントでも `journalctl -u signage-lite` でログを確認可能にする。
- **キャッシュ戦略**: 画像を `/var/cache/signage/current.jpg` に保存し、サーバー更新が失敗しても前回画像を表示。
- **セキュリティ**: HTTPS + client key を利用する場合、`curl` or `wget` で `--header` オプションを設定。
- **監視**: サーバー側で最新画像の更新成否を Datadog / Prometheus などに送信。

## 参考ソリューション

- Screenly OSE / Screenly Lite
- info-beamer
- Pi Presents

これらはローカルキャッシュ型・画像/動画プレイリスト型のアーキテクチャであり、今回の軽量モードも同様に「サーバー側で素材を整備し、クライアントは単純再生する」方針を採用する。

---

この文書は `EXEC_PLAN.md` の Phase 8 と連動し、タスクの進捗に応じて更新する。

