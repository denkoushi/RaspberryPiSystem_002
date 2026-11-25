---
title: インフラ基盤
tags: [アーキテクチャ, インフラ, Docker, 運用]
audience: [アーキテクト, 運用者, 開発者]
last-verified: 2026-11-25
related: [overview.md, ../guides/deployment.md, ../guides/monitoring.md, single-instance-state.md]
category: architecture
update-frequency: low
---

# インフラ基盤

最終更新: 2026-11-25

## 1. 概要

本書は、工場向け Raspberry Pi システムの土台（サーバー、コンテナ、保存場所、配備、監視、バックアップ）を、現在のコードと設定に合わせて説明します。システム全体の位置づけは [overview.md](./overview.md) を参照してください。

- Pi5 がサーバーで、API、Web、データベース、入口の Caddy を Docker Compose で動かします。
- Pi4 は現場のキオスク、Pi3 はデジタルサイネージの表示端末です。端末の種類と役割は [../runbooks/device-model-roles.md](../runbooks/device-model-roles.md) にあります。
- 設定の取り込みと配備は Ansible とスクリプトで行い、手作業での反映を標準にしません。

根拠: `infrastructure/docker/docker-compose.server.yml`、`infrastructure/docker/docker-compose.phase3.yml`、`infrastructure/ansible/inventory.yml`

## 2. 全体構成

```
 現場の端末(Pi4 キオスク / Pi3 サイネージ / モバイル)
        │  HTTPS (Tailscale 経由)
        ▼
 ┌────────────────────── Pi5 ──────────────────────┐
 │  gateway (Caddy)  80/443 だけを外へ公開          │
 │     ├─ 現行スロット: web (静的ファイル + Caddy) │
 │     │                 api (Fastify, 内部 8080)  │
 │     └─ もう一方のスロット (切替・戻し用)         │
 │  db (PostgreSQL + pgvector, ポート非公開)       │
 │  保存場所: <repo>/storage/* (写真・PDF・描画等) │
 └─────────────────────────────────────────────────┘
```

- 本番の構成は `docker-compose.phase3.yml` で、ブルー/グリーンの 2 スロットを切り替えて更新します。基本のサービス定義は `docker-compose.server.yml` にあります。
- ホストに公開するポートは gateway の 80/443 だけです。API は内部の 8080、データベースの 5432 は公開しません。
- 古い資料にある「単一の API コンテナ + 4173 番の Web」「ブルーグリーンは将来」は現在の構成ではありません。

根拠: `docker-compose.phase3.yml`、`docker-compose.server.yml`、`Caddyfile.gateway.template`、`Caddyfile.slot.template`

## 3. コンテナ構成

| サービス | 内容 |
|---|---|
| gateway | Caddy。TLS の固定入口。`/admin` の許可リストとセキュリティヘッダーを設定。認証ヘッダー(`X-Client-Key` など)はアクセスログで伏せる。内部用エンドポイントは外部からは 404 |
| web | ビルド済みの静的ファイルを Caddy で配信(内部 80 番) |
| api | Node 24 の Fastify。内部 8080 番 |
| db | `pgvector/pgvector:pg18`。データは名前付きボリューム `db-data-pg18`。旧バージョンのデータは移行用に読み取り専用でのみ接続 |

- 資源の取り合いを避けるため `cpu_shares` を設定しています(db と api は 4096、web と gateway は 2048)。
- ログは JSON 形式で、10MB × 3 世代で回転します。
- API と Web のコンテナは `read_only`、`cap_drop: ALL`、`no-new-privileges`、`tmpfs` で締めています。

根拠: `docker-compose.server.yml`、`docker-compose.phase3.yml`、`Dockerfile.api`、`Dockerfile.web`

## 4. データの置き場所

- 写真、サムネイル、PDF、PDF のページ画像、サイネージの描画結果、測定図面などの永続データは、Pi5 上のリポジトリ直下 `storage/` 配下をコンテナへバインドして保存します。どのフォルダを持つかは契約ファイルで定義し、Ansible の `pi5_storage` ロールが用意します。
- データベースは前述のボリュームに保存します。
- バックアップ設定は `<repo>/config` 配下の `backup.json` で、コンテナの `/app/config/backup.json` として読まれます(環境変数 `BACKUP_CONFIG_PATH` で変更可)。

根拠: `infrastructure/ansible/vars/pi5-storage-contract.yml`、`docker-compose.phase3.yml`、`apps/api/src/services/backup/`

## 5. セキュリティの基本

- 通信は Tailscale を前提にし、gateway だけが外に出ます(公開ポートの扱いは [../runbooks/ports-unexpected-and-port-exposure.md](../runbooks/ports-unexpected-and-port-exposure.md))。
- API は `@fastify/rate-limit` を全体に適用しています(1 分あたり 120 回。端末またはIPとルートごとに数えます)。CORS も登録済みです。以前の「レート制限は実質無効」は現在は当てはまりません。
- 秘密情報は Ansible Vault で管理し、`templates/docker.env.j2` から環境ファイルとして配ります。リポジトリには置きません。
- CI にはコードスキャン(CodeQL)と秘密情報の検出(gitleaks)が入っています。

根拠: `apps/api/src/plugins/rate-limit.ts`、`apps/api/src/app.ts`、`infrastructure/ansible/templates/docker.env.j2`、`.github/workflows/codeql.yml`、`.github/workflows/gitleaks.yml`

## 6. 監視とヘルスチェック

- `GET /api/system/health` はコンテナのヘルスチェックから呼ばれ、データベース、メモリ、イベントループ、Playwright の状態を見ます。
- `GET /api/system/metrics` は Prometheus 形式の指標を返します。
- `GET /api/system/deploy-status` で配備の状態を確認できます。`/api/system/deploy-readiness/internal` は内部専用で、外部には閉じています。
- 通知は Slack の 4 系統(deploy / ops / support / security)に振り分けます。設定は [../guides/slack-webhook-setup.md](../guides/slack-webhook-setup.md) を参照してください。
- 運用の見方は [../guides/monitoring.md](../guides/monitoring.md) にあります。

根拠: `apps/api/src/routes/system/`、`apps/api/src/services/alerts/alerts-config.ts`

## 7. 配備(デプロイ)

- 通常の更新は `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml` を使います。先に `--print-plan` で対象と順序を確認し、実行では `--limit PATTERN` か `--full-fleet` を明示します。
- 中身は Ansible の `deploy-release-standard.yml` で、`server`、`release_pi5`、`release_kiosk`、`release_signage`、`signage` などのロールが使われます。
- Pi5 は新しいスロットを起動して確認してから gateway を切り替えるため、更新中も入口は止まりません。
- 端末ごとの制約と復旧は [../guides/deployment.md](../guides/deployment.md)、[../guides/quick-start-deployment.md](../guides/quick-start-deployment.md)、[../runbooks/deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) が正本です。

根拠: `scripts/update-all-clients.sh`、`infrastructure/ansible/playbooks/deploy-release-standard.yml`、`infrastructure/ansible/roles/`

## 8. CI

`.github/workflows/ci.yml` で、API、Web、DB とインフラ、配備の契約、コンテナ実行の予行、サイネージ成果物の契約、Docker のセキュリティ、E2E、リリースセットの各確認を行います。マージはすべて合格した場合に限ります。

根拠: `.github/workflows/ci.yml`

## 9. バックアップと災害復旧

- アプリのバックアップ先は local / Dropbox / Gmail で、必要に応じて暗号化します(鍵は Vault 管理)。詳細は [../guides/backup-and-restore.md](../guides/backup-and-restore.md) と [../api/backup.md](../api/backup.md)。
- Pi5 から Google Drive へ毎日 23:00(日本時間)に災害復旧用のコピーを取ります(`google_drive_dr_timer_enabled` で有効化)。手順は [../runbooks/google-drive-disaster-recovery.md](../runbooks/google-drive-disaster-recovery.md)。
- Oracle 側への複写タイマー(毎日 04:30)は、認証ファイルが root 所有・権限 0600 の通常ファイルのときだけ有効になります。
- 復元の訓練は [../runbooks/pi5-restore-drill.md](../runbooks/pi5-restore-drill.md) にあります。

根拠: `infrastructure/ansible/playbooks/deploy-google-drive-disaster-recovery.yml`、`apps/api/src/services/backup/`

## 10. 拡張するときの考え方

- 機能は API のルート/サービス単位のモジュールとして足します(境界は [../decisions/001-module-structure.md](../decisions/001-module-structure.md))。
- API は 1 台構成が前提です。メモリに持つ状態や定期処理のリーダー制御は [single-instance-state.md](./single-instance-state.md) を参照してください。
- 新しい保存フォルダは契約ファイルに追加し、コンテナのバインド設定と合わせます。

## 11. 確認できていない事項

次はコードと設定からは確認できなかったため、本書には書いていません。

- Pi5/Pi4 の CPU、メモリ、ストレージの仕様
- `scripts/server/deploy.sh` の現在の用途(標準手順は 7 章のスクリプト)
- 監視スクリプト `scripts/server/monitor.sh` を定期実行している設定

## 関連ドキュメント

- [overview.md](./overview.md)
- [../guides/deployment.md](../guides/deployment.md)
- [../guides/monitoring.md](../guides/monitoring.md)
- [../guides/external-integration-ledger.md](../guides/external-integration-ledger.md)
