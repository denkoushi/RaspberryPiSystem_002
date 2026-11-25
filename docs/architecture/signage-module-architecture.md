---
title: デジタルサイネージモジュール アーキテクチャ
tags: [アーキテクチャ, デジタルサイネージ, モジュール化]
audience: [開発者, アーキテクト]
last-verified: 2026-11-25
related: [../decisions/001-module-structure.md, ../modules/signage/README.md, ../modules/signage/signage-lite.md]
category: architecture
update-frequency: low
---

# デジタルサイネージモジュール アーキテクチャ

最終更新: 2026-11-25

## 1. 概要

サイネージは、Pi3 などの表示端末に画面を出す機能です。サーバー(Pi5)が表示内容を画像に描画し、端末はその画像を取得して表示するだけの構成です。

- 表示内容は、スケジュールで「いつ、どの端末に、何を、どの配置で」出すかを決めます。
- 以前の資料は「既存システムから完全に独立」と書いていましたが、現在は持出返却、生産日程、CSV ダッシュボード、可視化、モバイル配置、キオスク用データなど、他の機能のデータも表示します。独立しているのはコードの置き場所と画面の入口で、データは共有します。

根拠: `apps/api/src/routes/signage/`、`apps/api/src/services/signage/`

## 2. 全体の流れ

```
管理画面(/admin/signage)  → スケジュール・PDF・緊急表示・Web ページを登録
        │
        ▼
API (Pi5)  SignageRenderScheduler が一定間隔で端末ごとに画像を描画
        │   → signage-rendered の保存場所へ保存
        ▼
端末 (Pi3)  /api/signage/current-image を定期的に取得して表示
```

- 描画の間隔は既定 30 秒(`SIGNAGE_RENDER_INTERVAL_SECONDS`、10〜3600 秒)。本番では子プロセスの worker で描画します(`SIGNAGE_RENDER_RUNNER`)。
- 画像は端末ごとに作られ、既定サイズは 1920x1080 です。
- 配備中は描画を一時停止し、終われば再開します(`bootstrap/start-post-listen-schedulers.ts`)。

根拠: `apps/api/src/config/env/signage.ts`、`apps/api/src/services/signage/`、`apps/api/src/bootstrap/start-post-listen-schedulers.ts`

## 3. API とコードの構成

API は `/api/signage/*` にまとまっています。

| 範囲 | 内容 |
|---|---|
| schedules / schedules/management | スケジュールの取得と管理 |
| content | 表示内容の取得 |
| pdfs | PDF の登録 |
| emergency | 緊急表示 |
| render / render/status | 描画の実行と状態 |
| current-image | 端末が取得する最新画像 |
| canvas-preview、visualization-image、preview/csv-dashboard/:id | 管理画面のプレビュー用 |
| web-captures | Web ページの取り込み |
| management/overview | 管理画面の一覧 |

Web 側は `/signage`(表示)、`/signage-lite`(軽量表示)、`/admin/signage`(管理。旧サブルートはここへ転送)です。

根拠: `apps/api/src/routes/signage/`、`apps/web/src/`(SignageDisplayPage、SignageHubPage)

## 4. 表示内容と配置

表示の優先順は次のとおりです。

1. 緊急表示が有効なら、それを最優先で表示する。
2. なければ、端末と時間帯に合うスケジュールを優先度の高い順に並べ、一定間隔(`SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS`、既定 30 秒)で切り替える。

スケジュールの項目は、対象端末、曜日、開始・終了時刻、優先度、有効/無効、配置設定です。

表示できる種類(スロット)は次のとおりです。

- PDF
- 持出一覧(loans)
- CSV ダッシュボード
- 可視化
- キオスクの進捗概況
- キオスクのリーダー向け指示カード
- モバイル配置の部品棚グリッド
- 自主検査の機械ボード
- Web ページ(全画面配置のみ)

配置は、全画面(FULL)、左右 2 分割(SPLIT)、自由配置のキャンバスがあります。

根拠: `apps/api/src/services/signage/`、`apps/api/prisma/schema.prisma`(SignageSchedule など)

## 5. データベースと保存場所

- テーブル: SignageSchedule(スケジュール)、SignagePdf、SignageWebCapture、SignageEmergency(緊急表示)。
- 描画結果は専用ボリューム `signage-rendered-storage` に置き、API からは `SIGNAGE_RENDER_DIR=/app/storage/signage-rendered` で参照します。PDF など他の保存場所とともに、Compose の設定で永続化されています。以前「PDF 保存場所の定義が足りない」としていた点は解消済みです。
- PDF の画像化は poppler の `pdftoppm`(解像度は `SIGNAGE_PDF_DPI`、既定 240)を使います。

根拠: `apps/api/prisma/schema.prisma`、`infrastructure/docker/docker-compose.phase3.yml`、`apps/api/src/config/env/signage.ts`

## 6. 描画の仕組み

- 画像の生成は sharp と SVG が基本です。持出一覧のグリッドは既定で SVG 方式(`svg_legacy`)で、Playwright による HTML 方式(`playwright_html`)も選べます。
- Web ページの取り込みは、同じスロットの Web に Playwright でアクセスして撮ります(`SIGNAGE_WEB_CAPTURE_BASE_URL`)。

根拠: `apps/api/src/services/signage/`、`apps/api/src/config/env/signage.ts`

## 7. 表示端末(Pi3)

- 画像表示は `feh` です。
- `signage-lite-update.timer`(起動 1 分後から 30 秒ごと)が、端末のキーを付けて `/api/signage/current-image` を取得し、メモリ上の `/run/signage` に保存します。
- `signage-lite-watchdog.timer`(1 分ごと)は、画像が 120 秒より古ければ更新を実行し、失敗すれば表示サービスを再起動します。
- `signage-daily-reboot.timer` が毎日 3:00 に再起動します。
- 配備中は保守中の画面を表示します。サーバーの証明書の公開鍵を固定して接続します(`client_server_cert_pin` ロール)。

根拠: `infrastructure/ansible/roles/signage/`、`infrastructure/ansible/group_vars/signage.yml`

## 8. 将来の分離と制約

- ルート、サービス、環境変数、テーブル名はサイネージ専用の名前に分かれているため、画面と API の入口を別サービスに切り出す余地はあります。ただし表示するデータは他機能のサービスを呼ぶため、分離するときは呼び出し先の整理が必要です。
- 描画は API の定期処理として動くため、API を複数台にするときは [single-instance-state.md](./single-instance-state.md) の前提を確認してください。

## 9. 確認できていない事項

- 管理画面で扱う各スロット固有の設定項目の全一覧は、本書では網羅していません。
- `../modules/signage/signage-lite.md` には古い計画の記述が残っており、本書とは整合を取っていません。

## 関連ドキュメント

- [../decisions/001-module-structure.md](../decisions/001-module-structure.md)
- [../modules/signage/README.md](../modules/signage/README.md)
- [../modules/signage/signage-lite.md](../modules/signage/signage-lite.md)
- [infrastructure-base.md](./infrastructure-base.md)
