# Phase 2: クライアント状態可視化とデバッグ支援 ExecPlan

This ExecPlan is a living document and must be maintained according to `.agent/PLANS.md` throughout implementation. Keep the `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections up to date.

## Purpose / Big Picture

After this work,運用者は Raspberry Pi クライアントの稼働状況と直近ログをブラウザから確認でき、問題発生時に現地へ行かず原因を把握できます。各クライアントは定期的に CPU/メモリ/温度/ログを API へ送信し、サーバーはそれを保存して検索・一覧表示します。完了後は `curl -X POST http://<server>/api/clients/status` で状態を登録でき、`GET /api/clients/status` で直近情報を取得できます。

## Progress

- [x] (2025-11-30 03:40Z) Prisma schema に ClientStatus / ClientLog モデルを追加しマイグレーション完了。`apps/api/prisma/migrations/20251201030000_add_client_status_logs`
- [x] (2025-11-30 04:30Z) API ルータ `/api/clients/status` `/api/clients/logs` を実装し統合テストを追加。
- [x] (2025-11-30 13:55Z) クライアント側 status-agent（Python + systemd timer）を追加し、CPU/メモリ/温度メトリクスを 1 分毎に HTTP 送信できるようにした。`clients/status-agent/`
- [x] (2025-11-30 15:30Z) 管理画面 `/admin/clients` に稼働状況カードとログビューを追加。`GET /api/clients/status` と `GET /api/clients/logs` を可視化し、12時間以上更新がない端末を赤色で表示する。
- [x] (2025-12-01 09:35Z) 実機テスト完了: Raspberry Pi 5上でstatus-agentを設定・実行し、systemd timerで1分ごとに自動実行されることを確認。管理画面で稼働状況カードが正しく表示され、CPU/メモリ/温度などのメトリクスが更新されることを確認。

## Surprises & Discoveries

- Observation: `pnpm prisma migrate dev` はローカルDB接続が必須のため、CIでも利用できるよう `prisma migrate diff --from-schema-datamodel` を使って差分SQLを生成した。
  Evidence: `apps/api/prisma/migrations/20251201030000_add_client_status_logs/migration.sql` が hand-crafted diff で追加された。

## Decision Log

- Decision: ClientLog と ClientStatus の間にDBレベルの外部キーを張らず、`clientId` 文字列で疎結合のままにする。
  Rationale: ログだけ先行送信するケースや未知の端末からの暫定送信を許容するため。
  Date/Author: 2025-11-30 / GPT-5.1 Codex
- Decision: status-agent は Bash ではなく Python3 単体スクリプトで実装する。
  Rationale: `/proc/stat` 差分計算・JSONシリアライズを標準ライブラリのみで安全に実装でき、追加パッケージが不要なため（Raspberry Pi OS は Python3 同梱）。
  Date/Author: 2025-11-30 / GPT-5.1 Codex

## Outcomes & Retrospective

**実機テスト結果（2025-12-01）**:
- ✅ Raspberry Pi 5上でstatus-agentを設定・実行し、APIサーバーに正常に送信されることを確認
- ✅ systemd timerで1分ごとに自動実行され、管理画面で状態が更新されることを確認
- ✅ 管理画面の「クライアント稼働状況」カードにCPU/メモリ/ディスク/温度が正しく表示されることを確認
- ✅ Prisma型エラー（InputJsonValue）を修正し、マイグレーションを適用してテーブルを作成
- ✅ SSH接続の問題（ホスト名解決）を解決し、IPアドレスで接続できることを確認
- ✅ ローカルアラートシステムの実装完了: アラート生成、表示、確認済み機能が正常に動作することを確認（2025-12-01 12:00Z）

**学んだこと**:
- 実機環境では最新のコードをビルド・デプロイする必要がある（`docker compose up -d --build`）
- マイグレーションは明示的に実行する必要がある（`pnpm prisma migrate deploy`）
- SSH接続でホスト名解決が失敗する場合は、IPアドレスを直接指定することで回避できる
- Prismaの`InputJsonValue`型を使用する際は、`Record<string, unknown>`を明示的にキャストする必要がある
- Dockerコンテナ内からホストのファイルシステムにアクセスする際は、ボリュームマウントと環境変数の設定が重要
- ファイルベースのアラートシステムは、インターネット接続が不要なローカル環境での通知に有効

## Context and Orientation

バックエンドは `apps/api` の Fastify アプリで構成され、Prisma ORM (`apps/api/prisma/schema.prisma`) を通じて PostgreSQL へ接続します。ルート登録は `apps/api/src/routes/index.ts` から行われ、ドメインごとのルーターが `apps/api/src/routes/<domain>` 配下にあります。クライアント側（Raspberry Pi）は `clients/` 配下のスクリプトで管理されています。今回の変更では以下が必要です。

1. Prisma スキーマに `ClientStatus` と `ClientLog` モデルを追加し、マイグレーションを生成する。
2. Fastify ルート `apps/api/src/routes/clients/` を新設し、状態登録/取得とログ登録/検索をREST APIとして提供する。
3. Raspberry Pi 用の軽量 agent (`clients/status-agent/`) を追加し、systemd service + timer で1分毎にAPIへ報告する。
4. Web管理画面 (`apps/web/src/pages/admin/clients/`) に一覧とログビューを実装する（Next.js または現行フロントの仕組みに合わせる）。

## Plan of Work

Milestone 1: Prisma schema 拡張
- `apps/api/prisma/schema.prisma` に ClientStatus/ClientLog モデルを追加し、外部キーやインデックスを設定する。
- `pnpm prisma migrate dev --name add_client_status_logs` でマイグレーションを生成し、`apps/api/prisma/migrations/` に保存する。
- `pnpm prisma generate` を実行し、`node_modules/.prisma` の生成物がアップデートされることを確認する。

Milestone 2: API 実装
- `apps/api/src/routes/clients/index.ts` を追加し、4エンドポイントを定義する。
  - `POST /api/clients/status`: 認証は `x-client-key` で行い、`clientId`, `hostname`, `ipAddress`, `metrics` を保存する。
  - `GET /api/clients/status`: 全クライアントの最新状態を返す。12時間以上報告がないクライアントには `stale=true` を付与する。
  - `POST /api/clients/logs`: クライアントログを受信し、最大1,000文字にトリミングして保存。
  - `GET /api/clients/logs`: `clientId`, `level`, `since` パラメータで検索できるようにする。
- `apps/api/src/services/clients/` にビジネスロジックを切り出し、Prisma を直接呼び出す処理をまとめる。
- 単体テストを `apps/api/src/routes/clients/__tests__/clients.test.ts` に追加し、Fastify インスタンスを使ってリクエストをシミュレートする。

Milestone 3: クライアント status-agent
- `clients/status-agent` ディレクトリに Python スクリプト `status-agent.py` と設定テンプレート、systemd ユニットを配置する。
- `/proc/stat`, `/proc/meminfo`, `/sys/class/thermal/thermal_zone0/temp`, `shutil.disk_usage('/')` からメトリクスを収集し JSON を組み立てる。
- systemd service (`status-agent.service`) と timer (`status-agent.timer`) を同梱し、`/etc/systemd/system/` に配置して 1 分毎に実行する。

Milestone 4: 管理画面
- `apps/web/src/pages/admin/clients/index.tsx` に一覧ページを作成し、`GET /api/clients/status` を呼び出す Hooks/Client を追加。
- `apps/web/src/pages/admin/clients/logs.tsx` もしくは `/admin/clients/[clientId].tsx` でログ検索UIを追加。
- 12時間以上報告無しのクライアントに赤いバッジを表示し、`stale` フラグを示す。

Milestone 5: E2E検証
- API サーバーを起動 (`docker compose -f infrastructure/docker/docker-compose.server.yml up -d api web db`)
- `STATUS_AGENT_CONFIG=.local/raspi-status-agent.conf clients/status-agent/status-agent.py` でローカルからAPIへ送信し、レスポンス200を確認する。
- ブラウザで `https://<server>/admin/clients` を開き、ダミーデータが表示されることを確認する。
- `pnpm test --filter api` と `pnpm test --filter web` を実行し、新規テストが通ることを確認する。

## Concrete Steps

1. `cd /Users/tsudatakashi/RaspberryPiSystem_002`
2. `pnpm prisma migrate dev --name add_client_status_logs`
3. `pnpm prisma generate`
4. API/フロントのテストを順次実行（詳細は Validation セクション参照）

## Validation and Acceptance

- `pnpm test --filter api` で API テストがすべて PASS。
- `pnpm test --filter web` で Web テストが PASS。
- `curl -X POST http://localhost:8080/api/clients/status -H "x-client-key: <key>" -H "Content-Type: application/json" -d '{"clientId":"pi-kiosk-01", ...}'` が HTTP 200 を返す。
- `curl http://localhost:8080/api/clients/status` に `stale` 判定を含むJSONが返る。
- ブラウザで `/admin/clients` を表示し、送信したダミークライアントが一覧とログ画面に表示される。

## Idempotence and Recovery

マイグレーションは一度だけ適用されるため、本番に適用する前に `docker compose exec db pg_dump` でバックアップを取得する。Ansible/agentのインストールスクリプトは冪等性を意識し、同じファイルを上書きしても構わないよう `install -m 0755` を使う。API がエラーを返した場合は `docker compose logs api` で構造化ログを確認できる。

## Artifacts and Notes

- 代表的な status POST 例:
      curl -s -X POST http://localhost:8080/api/clients/status \\
        -H "x-client-key: kiosk-secret" \\
        -H "Content-Type: application/json" \\
        -d '{
             "clientId": "pi-kiosk-01",
             "hostname": "pi-kiosk-01",
             "ipAddress": "192.168.0.30",
             "cpuUsage": 32.5,
             "memoryUsage": 41.2,
             "diskUsage": 58.0,
             "temperature": 49.7,
             "lastBoot": "2025-11-29T12:00:00.000Z",
             "logs": ["signage-lite restarted", "CPU temp 50C"]
           }'

## Interfaces and Dependencies

- Prisma models `ClientStatus` と `ClientLog` は `apps/api/prisma/schema.prisma` に常駐し、`clientId` をキーに紐づく。`ClientLog` は `clientId` と `createdAt` に複合インデックスを持たせる。
- Fastify route module exposes `registerClientRoutes(app: FastifyInstance)` and is imported in `apps/api/src/routes/index.ts`.
- status-agent は Python3 単体スクリプトで実装し、追加パッケージ不要。systemd service / timer を `/etc/systemd/system/status-agent.{service,timer}` に配置し、`STATUS_AGENT_CONFIG` で設定ファイルを切り替える。

---
Last updated: 2025-11-30 by GPT-5.1 Codex. Reason: 初版作成（Phase2実装に向けたExecPlan）
