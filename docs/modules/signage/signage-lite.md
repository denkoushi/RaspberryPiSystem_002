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
- [ ] Raspberry Pi OS Lite 用のセットアップスクリプトを追加（`scripts/client/setup-signage-lite.sh` など）
- [ ] `feh` + systemd サービスで `current.jpg` をループ表示（再取得間隔 configurable）
- [ ] ネットワーク断時はローカルキャッシュを表示、復帰後に自動更新

### Phase D: モード切替と統合
- [ ] 管理画面で「表示モード（通常 / 軽量）」を切り替えられるようにする
- [ ] `setup-signage.sh` を通常モード、`setup-signage-lite.sh` を軽量モードとして提供
- [ ] Raspberry Pi 3 / Zero 2W で 24時間連続稼働テストを実施し、温度/負荷/再接続テストを記録

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

