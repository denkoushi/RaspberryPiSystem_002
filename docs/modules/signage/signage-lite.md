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

### トラブルシューティング

- **画像が表示されない**: `/var/cache/signage/current.jpg` が存在するか確認
- **ネットワークエラー**: サーバーURLとクライアントキーが正しいか確認
- **X11エラー**: `export DISPLAY=:0` が設定されているか確認

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

