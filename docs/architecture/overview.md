---
title: システムアーキテクチャ概要
tags: [アーキテクチャ, 設計, システム構成]
audience: [アーキテクト, 開発者, 新規参加者, 業務システム担当者]
last-verified: 2026-11-25
related: [infrastructure-base.md, deployment-modules.md, signage-module-architecture.md, ../decisions/001-module-structure.md, ../runbooks/device-model-roles.md, ../guides/deployment.md]
category: architecture
update-frequency: medium
---

# システムアーキテクチャ概要

本書は、工場業務システム（RaspberryPiSystem_002）の全体構成を説明する入口の文書です。個別の仕様や手順は、各節のリンク先の文書を正本とします。

## 1. 全体構成

サーバー 1 台（Raspberry Pi 5）と、現場に置く端末で構成されます。端末はサーバーの API を HTTPS で呼び出します。

```
  管理者・現場の端末（ブラウザ）
        |  HTTPS
        v
  Raspberry Pi 5（サーバー、Docker Compose）
    gateway（Caddy）
      -> Web（api/web とも blue と green の 2 系統を持ち、片方が稼働）
      -> API（Fastify + Prisma） -> PostgreSQL
    業務向け Hermes（チャット案内）の各コンテナ
    ホスト側: status-agent、夜間バックアップなど
        ^
        |  API 呼び出し（端末ごとのキー）
  Raspberry Pi 4 キオスク（8 台）
    Chromium（キオスク画面）+ nfc-agent / barcode-agent / torque-agent + status-agent
  Raspberry Pi 3 サイネージ（1 台）
    feh による静止画表示 + status-agent
  Raspberry Pi Zero 系（個別配備）
    zero-edge-agent または watch-cam-agent を 1 つだけ実行
```

端末の種類と台数は、標準の台帳 `infrastructure/ansible/inventory.yml` に従います。

- サーバー: Pi 5 が 1 台です（`server` グループ）。
- キオスク: Pi 4 が 8 台です（`clients.kiosk` グループ）。そのうち 1 台は更新時の先行確認用（カナリア）に指定されています。
- サイネージ: Pi 3 が 1 台です（`clients.signage` グループ）。
- Pi Zero 系（Zero W、Zero 2W）: 標準の台帳には含めず、専用の台帳（`inventory-zero-edge.yml`）と専用の手順で個別に配備します。棚スキャナーまたは監視カメラ用で、業務 agent を 1 台につき 1 つだけ動かす決まりです。標準の更新（ローリング更新）の対象ではありません。
- 検証用: `inventory-staging.yml` に、検証用のサーバーとキオスクの定義があります。

機種ごとに動かしてよいもの・いけないものは [機種ごとの役割と資源の運用表](../runbooks/device-model-roles.md) が正本です。ネットワークの運用は Tailscale を主とします（[ADR-20260130](../decisions/ADR-20260130-tailscale-primary-operations.md)、[Tailscale ポリシー](../security/tailscale-policy.md)）。

## 2. サーバーの中身

Pi 5 では Docker Compose でサービスを動かします。定義は `infrastructure/docker/` にあります。

- `docker-compose.server.yml`: PostgreSQL（`db`、イメージは pgvector 付きの PostgreSQL 18）と、API、Web の基本定義、業務ファイルの保存用ボリューム（写真、PDF、図面、要領書の画像や資料、レポートなど）。
- `docker-compose.phase3.yml`: 本番で使う構成です。次のサービスを持ちます。
  - `gateway`: Caddy のリバースプロキシです。HTTPS を受け、稼働中の系統へ中継します。Caddy の設定は `Caddyfile.*` にあります。
  - `api-blue` / `api-green`、`web-blue` / `web-green`: API と Web を 2 系統用意し、新しい版を空いている系統で起動して確認してから切り替えます（blue-green）。
  - `business-hermes`、`business-hermes-chat`、それぞれの送信用の中継コンテナ（`*-egress`）、`business-hermes-answer-cache`: 業務向けのチャット案内（Hermes）に関するコンテナです。
- サーバーのホスト側には、`status-agent`、夜間のバックアップや災害復旧（DR）のタイマーなどが入ります（Ansible の `server` ロールと `release_pi5` ロール）。
- `services/hermes-answer-cache`: 回答キャッシュの補助サービスです。

根拠: `docker-compose.server.yml`、`docker-compose.phase3.yml`、`inventory.yml`。

## 3. 端末の中身

### キオスク（Pi 4）

画面は Chromium が表示するキオスク画面（Web アプリの `/kiosk` 以下）です。Chromium は NFC などのエージェントと、同じ端末内の WebSocket（`ws://localhost`）で通信します。端末で動くエージェントは `clients/` にあります。

- `clients/nfc-agent`（Python）: NFC リーダー（Sony RC-S300/S1）からカードの UID を読み、画面へ配信します。送信待ちは SQLite に保存します。
- `clients/barcode-agent`（Python）: シリアル接続のバーコードリーダーの読み取りを画面へ配信します。
- `clients/torque-agent`（Python）: トルクレンチ（HID 機器）の入力を端末内に保存してから、組立の API へ送ります。
- `clients/status-agent`: 1 分ごとに CPU、メモリ、ディスク、温度などを API へ送ります。サーバー側の端末状態の画面に表示されます（[status-agent](../guides/status-agent.md)）。

NFC、バーコード、トルクの 3 つは Docker のコンテナとして、status-agent はホストの systemd サービスとして動きます。必要な機能だけを端末ごとの設定で有効にします。

### サイネージ（Pi 3）

`feh` で静止画を表示するだけの専用端末です。Docker も Chromium も使いません。画像はサーバー側で作り、端末が定期的に取得します（[サイネージのアーキテクチャ](signage-module-architecture.md)、[signage-lite](../modules/signage/signage-lite.md)）。

### Pi Zero 系

- `clients/zero-edge-agent`: USB のスキャナーで伝票を読み、端末に割り当てた棚へ記録する棚スキャナーです。送信待ちを SQLite に保存します。
- `clients/watch-cam-agent`: 監視カメラの撮影と送信を行います。
- `clients/haizen-agent`: Zero 2W などの USB バーコードリーダーの入力を、配膳の API へ送ります。

### Ansible のロール

`infrastructure/ansible/roles/` の要点です。標準の更新は `playbooks/deploy-release-standard.yml` から呼ばれます。

- `server`: サーバーのホスト設定、systemd、API/Web の環境変数ファイルの配置。
- `release_pi5`: サーバーのイメージ更新、マイグレーション、blue-green の切り替え、ヘルス確認、ロールバック。
- `release_kiosk`: キオスクの更新（Chromium 起動、各エージェントの配備、ホストの設定）。
- `release_signage`、`signage`: サイネージ端末の更新と表示の設定。
- `release_torque_cutover`、`torque_agent_contract`: トルクレンチ用エージェントの切り替えと、サーバーとの契約の確認。
- `client`、`kiosk`、`common`: 端末共通の設定、キオスク固有の設定、全ホスト共通の前後処理。
- `client_server_cert_pin`: Chromium がサーバー証明書の公開鍵を固定して確認する設定。
- `pi5_storage`: サーバーの保存先（SSD）の設定。

## 4. 機能の領域

README の「主な機能」ごとに、受け持つ API と Web の場所を示します。パスは `apps/api/src/routes/`（API）、`apps/web/src/features/` と `apps/web/src/pages/`（Web）の下です。

- 持出返却（工具、計測機器、吊具）: API は `tools/`、`measuring-instruments/`、`rigging/`。Web は `pages/kiosk/KioskBorrowPage` などの持出返却の画面、`features/nfc`、`features/measuring-instrument-analytics`、`features/rigging-analytics`、`features/kiosk-loan-analytics`。
- 生産日程と負荷調整: API は `kiosk/production-schedule/`、`production-schedule-settings.ts`、`imports/schedule.ts`。Web は `pages/kiosk/ProductionSchedule*`、管理画面の `ProductionSchedule*` の設定画面。
- 自主検査と部品測定: API は `part-measurement/`。Web は `features/part-measurement`、`pages/kiosk/KioskPartMeasurement*`、`KioskInspectionDrawing*`、`KioskSelfInspection*`。
- 組立（要領書、チェックシート、作業セッション、記録の承認、トレーサビリティ、教育）: API は `assembly/`、`work-instructions/`、`torque-training/`。Web は `features/assembly`、`features/work-instructions`、`pages/kiosk/KioskAssembly*`。
- トルクレンチ: API は `torque-wrenches/`。Web は `features/torque-wrench-connection`。
- 配膳（棚在庫）と購買: API は `item-inventory/`、`kiosk/purchase-order-lookup.ts`。Web は `pages/kiosk/KioskItemInventory*`、`KioskHaizen*`、`features/purchase-order-lookup`。
- モバイル: API は `mobile-placement/`、`kiosk/mobile-app.ts`。Web は `features/mobile-placement`、`features/mobile-app-shell`、`features/scan-bench`、`features/barcode-scan`。
- 手順掲示板と機械信号: API は `kiosk-procedure-boards.ts`、`machine-signal/`。Web は `features/procedure-board`、`features/machine-signal`。
- 手順書・文書: API は `documents/`、`kiosk-documents.ts`。Web は `features/kiosk-sop`、`pages/kiosk/KioskDocumentsPage`。
- サイネージ: API は `signage/`。Web は `pages/signage`、管理画面の `SignageHubPage`。
- チャット案内と呼び出し、音声: API は `kiosk/inquiries.ts`、`kiosk/call-targets.ts`、`webrtc/`、`hermes-knowledge.ts`、`assembly/business-hermes*.ts`。Web は `features/hermes-knowledge`、`features/voice`、`features/webrtc`、`features/overlays`。
- 管理画面（マスタ、CSV 取込、バックアップ、監視、設定）: API は `auth.ts`、`clients/`、`imports/`、`csv-import-configs.ts`、`csv-dashboards/`、`backup/`、`gmail/`、`storage/`、`system/`、`watch-camera/`、`visualizations/`、`reports/`。Web は `pages/admin`、`features/admin`。

モジュール境界の考え方は次の文書にあります。

- [ADR-001 モジュール構造](../decisions/001-module-structure.md): ルートを機能ごとのサブディレクトリに分ける方針（サービス層の分割は計画のままで、実施されていない部分が注記されています）。
- [ADR-002 サービス層](../decisions/002-service-layer.md): ルートから業務ロジックを分け、`services/` に置く方針。
- [ADR-20261116 リファクタ対象の選び方](../decisions/ADR-20261116-refactoring-target-selection.md)。
- API が使うサービス層は `apps/api/src/services/`、共有ライブラリは `packages/`（`shared-types`、`kiosk-sop-core`、`part-search-core`、`shelf-layout-core`、`slip-match-core`）にあります。

## 5. 技術スタック

版は各 `package.json`、`pyproject.toml`、Dockerfile、compose の指定によります（2026-11-25 時点）。

- ランタイム: Node.js 24 以上、パッケージ管理は pnpm 12.16.1（モノレポ）。
- API: Fastify 5、Prisma 7.10.1、Zod 4、認証に JWT と bcrypt、テストは Vitest 4。
- Web: React 19、Vite 6、TanStack Query 5、Tailwind CSS 3、テストは Vitest 4。E2E は Playwright。
- データベース: PostgreSQL 18（pgvector 付きのイメージ）。
- エージェント: Python 3.11 以上（nfc-agent、barcode-agent は FastAPI と pyscard など）。zero-edge-agent は Python 3.9 以上。
- コンテナと配備: Docker Compose、Caddy、Ansible。
- 補助サービスのイメージ: 業務向け Hermes は `nousresearch/hermes-agent` を固定の版で使います。

## 6. 主なデータの流れ

### 持出返却

1. 現場の人が NFC カードをリーダーにかざします。
2. nfc-agent が UID を読み、同じ端末の Chromium の画面へ WebSocket で渡します。
3. 画面が端末のキーを付けて API（`tools/` のルート）を呼びます。
4. API が持出・返却を PostgreSQL に記録します。写真記録がある場合は写真を保存先に置きます。
5. 返却の状況は、キオスクの一覧、管理画面、サイネージに反映されます。

### 生産日程の取り込み

- 取込は CSV が基本です。管理画面からのアップロードのほか、Dropbox や Gmail から定期的に取得する経路があります（スケジュールは管理画面で設定します）。仕様は [CSV 取込・出力仕様](../guides/csv-import-export.md)、Gmail の設定は [Gmail 連携セットアップ](../guides/gmail-setup-guide.md) です。
- 取り込んだ日程を、キオスクの生産日程、負荷調整、進捗の画面とサイネージが使います。
- 工程の完了状況は、メールで届く FKOJUNST_Status などを正本とします（[ADR-20260508](../decisions/ADR-20260508-fkojunst-status-sole-source.md)、[ADR-20260526](../decisions/ADR-20260526-production-schedule-completion-status-only.md)）。

### サイネージ表示

1. 管理画面でスケジュールとコンテンツ（工具の状況、生産日程、PDF など）を設定します。
2. サーバーが表示内容を画像に描画して保存します。
3. Pi 3 が画像を定期的に取得し、`feh` で表示します。

### 本番反映（ローリング更新）

1. 対象のブランチと CI の成功を確認します。
2. `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan` で対象と順序を確認します。
3. `--limit` または `--full-fleet` を付けて実行します。Ansible がサーバー（blue-green の切り替え）、キオスク、サイネージを順に更新します。
4. 状態とヘルスチェックを確認します。失敗時は [デプロイ状態の復旧手順](../runbooks/deploy-status-recovery.md) に従います。

手順は [デプロイメントガイド](../guides/deployment.md) と [クイックスタート](../guides/quick-start-deployment.md) が正本です。

## 7. 認証とセキュリティの要点

- 管理画面のログイン: ユーザー名とパスワードで認証し、JWT（アクセストークンと更新トークン）を使います。権限は ADMIN、MANAGER、VIEWER の 3 種類です。ADMIN と MANAGER は多要素認証（TOTP）を設定できます（`apps/api/src/routes/auth.ts`、[MFA 設定手順](../guides/mfa-setup-step-by-step.md)）。ログインにはレート制限があります。
- 端末の認証: 端末ごとの API キー（クライアントキー）をヘッダー `x-client-key` に付けて API を呼びます。キーは Ansible Vault で管理します（[APIキー統一の方針](../guides/api-key-policy.md)。同文書の一覧表は 2025-12 時点の履歴です）。
- HTTPS: サーバーの入口は Caddy（gateway）です。キオスクの Chromium は、サーバー証明書の公開鍵を固定して確認します（`client_server_cert_pin` ロール、KB-413）。
- ネットワーク: Tailscale を主な運用経路とし、不要なポートを閉じます（[Tailscale ポリシー](../security/tailscale-policy.md)、[ポート露出の手順](../runbooks/ports-unexpected-and-port-exposure.md)）。
- 秘密情報: パスワード、トークン、各種キーは Ansible Vault に置き、Ansible が API の環境変数ファイルへ反映します。リポジトリには置きません。ログの秘匿は [log-redaction](../security/log-redaction-implementation.md) を参照してください。
- バックアップ: 管理画面から設定するバックアップ（Dropbox など。暗号化して保存）と、Google Drive への夜間の災害復旧バックアップがあります（[バックアップ・リストア手順](../guides/backup-and-restore.md)、[Google Drive DR](../runbooks/google-drive-disaster-recovery.md)、[ADR-20260820](../decisions/ADR-20260820-google-drive-disaster-recovery.md)）。
- そのほか: [セキュリティ利用者ガイド](../guides/security-user-guide.md)、[インシデント対応](../security/incident-response.md)、[システム資産台帳](../security/system-inventory.md)。

## 8. 外部連携と責任分界

外部サービスとの連携は [外部連携運用台帳](../guides/external-integration-ledger.md) にまとめています。

- Dropbox: バックアップの保存先とリストア元、CSV の取得。
- Gmail: CSV やメールの取り込み（生産日程、組立の要領書など）。
- Slack: キオスクのお問い合わせ通知、運用アラートの通知。

設定は Ansible Vault と Ansible で永続化します。OAuth トークンの扱いは各連携のガイドを参照してください。

DGX Spark（ローカル LLM の実行基盤）の排他調停、個人用 Pi 5 の管理画面、温度・履歴の監視は、別リポジトリ [`denkoushi/DGXSparkControlPlane`](https://github.com/denkoushi/DGXSparkControlPlane) の担当です。本リポジトリは業務キオスク、業務管理画面、業務 Pi 5 と Pi 4、および業務側からの DGX API 利用を担当します。DGX の互換 API や認証方式を変えるときだけ両方を確認し、別々の PR で進めます。詳細は [責任分界の正本](https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/repository-boundary.md) を参照してください。

## 9. 関連文書

- 全文書の索引: [docs/INDEX.md](../INDEX.md)
- このディレクトリの文書: [インフラ基盤](infrastructure-base.md)、[デプロイ基盤](deployment-modules.md)、[サイネージのアーキテクチャ](signage-module-architecture.md)、[単一インスタンスの状態](single-instance-state.md)、[同時実行の制御](concurrency-control.md)、[バックアップのモジュール性の評価](backup-modularity-assessment.md)
- 開発: [開発ガイド](../guides/development.md)、[システム要件定義](../requirements/system-requirements.md)
- 反映と復旧: [デプロイメントガイド](../guides/deployment.md)、[デプロイ状態の復旧手順](../runbooks/deploy-status-recovery.md)、[端末の新規導入](../guides/client-initial-setup.md)
- 運用: [運用マニュアル](../guides/operation-manual.md)、[Runbook 一覧](../runbooks/)、[監視](../guides/monitoring.md)
- 設計判断: [ADR 一覧](../decisions/)、[ナレッジベース](../knowledge-base/index.md)
- 機能別: [モジュール文書](../modules/)、[キオスク操作ガイド](../kiosk-operation-guide/)
