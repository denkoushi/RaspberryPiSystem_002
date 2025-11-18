```md
# Raspberry Pi NFC 持出返却システム設計・実装計画

このExecPlanは生きたドキュメントであり、作業の進行に合わせて `Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を常に更新しなければならない。.agent/PLANS.md に従って維持すること。

## Purpose / Big Picture

工場でタグ付き工具や備品の持出状況を紙に頼らず正確に把握したい。完成後は Raspberry Pi 5 上で API・DB・Web UI を提供し、複数の Raspberry Pi 4 クライアントがブラウザキオスクとして接続する。各 Pi4 には Sony RC-S300/S1 NFC リーダーが接続されており、オペレーターはアイテムタグ→社員証の順にかざすだけで持出を登録し、返却は画面のボタンを押すだけで記録できる。従業員・アイテム・履歴の登録／編集はサーバー管理画面とキオスク双方から操作可能。データは PostgreSQL に集約し、社員テーブルは将来モジュールでも共通利用できるように設計する。

## Progress

- [x] (2024-05-27 15:40Z) アーキテクチャ／データモデル／作業手順を含む初回のExecPlanを作成。
- [x] (2024-05-27 16:30Z) Milestone 1: モノレポ足場、pnpm/Poetry 設定、Docker 雛形、`.env.example`、スクリプト、雛形アプリ（Fastify/React/NFC エージェント）を作成し `pnpm install` 済み。
- [x] (2025-11-18 01:45Z) Milestone 2: Prisma スキーマ／マイグレーション／シード、Fastify ルーティング、JWT 認証、従業員・アイテム CRUD、持出・返却・履歴 API を実装し `pnpm --filter api lint|test|build` を完走。
- [x] (2025-11-18 02:40Z) Milestone 3: Web UI（ログイン、キオスク持出/返却、管理 CRUD、履歴表示）を React + React Query + XState で実装し `pnpm --filter web lint|test|build` を完走。
- [x] (2025-11-18 02:55Z) USBメモリ由来の従業員・アイテム一括登録機能（ImportJob + `/imports/master` + 管理UI）を実装し、拡張モジュール共通基盤を説明に反映。
- [x] (2025-11-18 03:20Z) Milestone 4: Pi4 NFC エージェント（pyscard + FastAPI + SQLite キュー + mock fallback）を実装し、`pnpm --filter api lint|test|build` / `pnpm --filter web lint|test|build` 後に `poetry run python -m nfc_agent` でリーダー検出・WebSocket配信を確認（ソフトウェア実装段階まで完了、実機統合は次フェーズで実施）。
- [x] サーバー側サービス（API、DBマイグレーション、認証）を実装。
- [x] クライアントWeb UIフローとNFCイベント連携を実装。
- [x] Pi4用NFCエージェントサービスとパッケージングを実装。
- [x] (2025-11-18 07:20Z) Pi5/Pi4 の OS / Docker / Poetry / NFC リーダー環境構築を完了し、README に手順とトラブルシューティングを反映（コンテナ起動およびエージェント起動は確認済みだが、Validation and Acceptance の8項目は未検証）。
- [ ] (Upcoming) Milestone 5: 実機検証フェーズ。Pi5 上の API/Web/DB と Pi4 キオスク・NFC エージェントを接続し、Validation and Acceptance セクションの 8 シナリオを順次実施してログと証跡を残す。

## Surprises & Discoveries

- 観測: `fastify-swagger@^8` が存在せず `@fastify/swagger` に名称変更されていた。  
  エビデンス: `pnpm install` で `ERR_PNPM_NO_MATCHING_VERSION fastify-swagger@^8.13.0`。  
  対応: 依存を `@fastify/swagger` に切り替え済み。
- 観測: 現在の開発環境 Node.js が v18.20.8 のため `engines.node >=20` で警告。  
  対応: 一旦 `>=18.18.0` まで許容し、Pi5 では Node20 を推奨する方針。Milestone 2 で README/ExecPlan に補足予定。
- 観測: `jsonwebtoken` の型定義が厳格で、`expiresIn` を文字列で渡す場合に `SignOptions` キャストが必要だった。  
  対応: `SignOptions['expiresIn']` へキャストしたオプションを用意し型エラーを解消。
- 観測: React Query v5 では mutation の状態フラグが `isLoading` ではなく `isPending` に変更され、`keepPreviousData` も `placeholderData` へ置き換えが必要だった。  
  対応: フラグ名とオプションを v5 API に合わせて更新。
- 観測: XState v5 では typed machine の generics指定が非推奨になり `types` セクションで文脈/イベントを定義する必要があった。  
  対応: `createBorrowMachine` を純粋な状態遷移マシンにし、API呼び出しは React 側で制御（`SUCCESS`/`FAIL` イベントを送る）するよう変更。
- 観測: 一部の Pi4 では `pyscard` が RC-S300/S1 を認識せず、PC/SC デーモンの再起動や libpcsclite の再インストールが必要だった。  
  対応: NFC エージェントのステータス API に詳細メッセージを表示し `AGENT_MODE=mock` で代替動作へ切り替えられるようにした上で、README に `pcsc_scan` を使った診断手順を追記。
- 観測: pyscard 2.3.1 (Python 3.13) では `smartcard.Exceptions.NoReadersAvailable` が提供されず ImportError となる個体があった。  
  対応: 該当例外の import を任意化し、reader.py で警告ログを出しつつ `Exception` へフォールバックして実行を継続するよう変更。

## Decision Log

- 決定: サーバー（Pi5）は Docker Compose で PostgreSQL・API・Web サーバーを構成し、将来の機能追加でも同一手順でデプロイできるようにする。  
  理由: Raspberry Pi OS 64bit に標準で含まれ、再起動や依存関係管理が容易なため。  
  日付/担当: 2024-05-27 / Codex
- 決定: Pi4 では `pyscard` を用いた軽量Pythonサービスを作り、`localhost` WebSocket/REST を提供してブラウザUIがNFCイベントを購読できるようにする（ブラウザ標準のNFC APIには依存しない）。  
  理由: Raspberry Pi のChromiumにはNFC APIが実装されておらず、ローカルWebSocketであればCORS問題なくUSB処理をフロントから切り離せるため。  
  日付/担当: 2024-05-27 / Codex
- 決定: データストアは PostgreSQL とし、社員レコードをUUID主体で設計して将来他モジュールが参照しやすい構造にする。  
  理由: 64bit Pi 環境で安定し、Docker運用しやすく、リレーショナル整合性を保てるため。  
  日付/担当: 2024-05-27 / Codex
- 決定: Node系パッケージは pnpm ワークスペース、Python NFCエージェントは Poetry で管理する。  
  理由: pnpm は node_modules を重複管理せずメモリを節約でき、Poetry は `pyscard` 依存を隔離できるため。  
  日付/担当: 2024-05-27 / Codex
- 決定: JWT シークレットや DATABASE_URL には開発用のデフォルト値を `env.ts` で与え、CI/テストで環境変数が未設定でも Fastify を起動できるようにする。本番では `.env` で上書きする。  
  理由: `vitest` や lint 実行時に `.env` がなくても型初期化エラーを防ぐため。  
  日付/担当: 2025-11-18 / Codex
- 決定: キオスク端末の持出・返却 API は当面 JWT を必須にせず、`x-client-key` ヘッダーもしくは `clientId` で `ClientDevice` を特定する方式で受け付ける。  
  理由: ブラウザキオスクでの UX を優先しつつ、今後デバイス単位の API キー差し替えで段階的に強化できるため。  
  日付/担当: 2025-11-18 / Codex
- 決定: フロントエンドの持出フローは XState で状態遷移のみ管理し、実際の API 呼び出しは React 側の `useEffect` でトリガーして成功/失敗イベントをマシンに通知する。  
  理由: ブラウザ・テスト双方で外部依存を注入しやすくなり、`pyscard` の挙動差異や非同期処理をマシン本体に閉じ込めなくて済むため。  
  日付/担当: 2025-11-18 / Codex
- 決定: Pi4 で NFC エージェントを素の Poetry 実行で使う場合、キュー DB (`QUEUE_DB_PATH`) は `$HOME/.local/share/nfc-agent` に配置し `/data` は Docker 専用とする。  
  理由: 通常ユーザーが `/data` を作成すると権限エラーになりやすく、XDG Base Directory に従う方が再現性が高いため。  
  日付/担当: 2025-11-18 / Codex
- 決定: `engines.node` を `>=18.18.0` に緩和し、開発中は Node18 を許容する。Pi5 本番には Node20 を導入予定であることを README/ExecPlan で周知する。  
  理由: 現在の実行環境（v18.20.8）と整合させて初期 `pnpm install` を成功させる必要があったため。  
  日付/担当: 2024-05-27 / Codex
- 決定: 将来のPDF/Excelビューワーや物流モジュールでも共通的に使えるよう、インポート処理を `ImportJob` テーブル + Fastify エンドポイント `/imports/*` として実装する。  
  理由: ファイル投入系の機能を横展開できるジョブ基盤を先に整備しておくと、USBインポート・ドキュメントビューワー・物流連携を同一パターンで構築できるため。  
  日付/担当: 2025-11-18 / Codex

## Outcomes & Retrospective

- 実装完了時に記載する。

## Context and Orientation

現状リポジトリには `AGENTS.md` と `.agent/PLANS.md` しかない。本計画に従い以下のディレクトリを作成する。

* `apps/api`: Fastify + Prisma + PostgreSQL の TypeScript API。REST/WebSocket による持出・返却処理、従業員／アイテム CRUD、履歴参照、JWT 認証を提供。
* `apps/web`: React + Vite UI。キオスクビュー（フルスクリーン）と管理ビューを1本化し、API とは HTTPS、ローカルNFCエージェントとは `ws://localhost:7071` で連携。
* `clients/nfc-agent`: Python 3.11 サービス。`pyscard` で RC-S300 を監視し、WebSocket でUIDイベントを配信。オフライン時は SQLite にキューイングし、API への再送を行う。
* `infrastructure/docker`: API/Web/DB 用 Dockerfile と Compose ファイル（サーバー用、クライアント用）。  
* `scripts`: サーバー・クライアントセットアップ、デプロイ、データ投入などのシェルスクリプト。
* `apps/api/src/routes/imports.ts` と `apps/web/src/pages/admin/MasterImportPage.tsx`: USB一括登録および将来のPDF/物流モジュール共通の Import Job 管理を担う。

すべて Raspberry Pi OS 64bit 上で動作させる。Docker イメージは Pi 上でビルドするため `linux/arm64` ベースを使用する（PostgreSQL15-alpine、Node20-alpine など）。Pi4の NFC エージェントは `--network host` で動かし、USB デバイスをコンテナへマウントする。

## Milestones

1. **リポジトリ足場とインフラ**: pnpm ワークスペース、Poetry プロジェクト、Dockerfile、docker-compose、`.env.example` を作成。受入: `pnpm install`、`poetry install`、`docker compose config` が Pi5/Pi4 で成功。
2. **バックエンドAPIとDB**: Prisma スキーマに `employees` `items` `loans` `transactions` `clients` `users` を定義。REST エンドポイント `/api/employees` `/api/items` `/api/loans` `/api/transactions` `/api/auth/login` `/api/clients/heartbeat` `/api/borrow` `/api/return` を実装。受入: `pnpm --filter api test` が通り、curl で持出/返却フローを確認。
3. **Webアプリ**: React Router と状態機械でキオスクフローを構築し、履歴・管理画面を実装。受入: `pnpm --filter web build` が成功し、モックAPIで確認可能。
4. **NFCエージェント**: Python サービスで RC-S300 から UID を取得し、WebSocket配信とオフラインキューを実装。受入: `pytest` が通り、実機で UID を検出。
5. **統合とデプロイ**: Web UI と API、ローカルエージェントを接続し、Docker Compose 本番構成と手順書を完成。受入: Pi4 クライアントで実際に持出→返却が完結する。

## Plan of Work

1. **モノレポ初期化**: ルートに `package.json`（private, workspaces）、`pnpm-workspace.yaml`、`turbo.json`（任意）を作成。`apps/api`, `apps/web`, `clients/nfc-agent`, `infrastructure/docker`, `scripts` を用意し、`.editorconfig`、`.gitignore`、`.env.example`、README、ExecPlan へのリンクを追加。
2. **DBスキーマとマイグレーション**: `prisma/schema.prisma` を作成し、以下を定義。
   * `Employee`: `id(UUID)`, `employeeCode`, `displayName`, `nfcTagUid`, `department`, `contact`, `status`, `createdAt`, `updatedAt`
   * `Item`: `id`, `itemCode`, `name`, `nfcTagUid`, `category`, `storageLocation`, `status`, `notes`
   * `Loan`: `id`, `itemId`, `employeeId`, `borrowedAt`, `dueAt`, `clientId`, `notes`, `returnedAt`
   * `Transaction`: `id`, `loanId`, `action`, `actorEmployeeId`, `performedByUserId`, `clientId`, `payloadJson`, `createdAt`
   * `ClientDevice`: `id`, `name`, `location`, `apiKey`, `lastSeenAt`
   * `User`: `id`, `username`, `passwordHash`, `role`, `status`
   Prisma Migrate でマイグレーションとシード（管理者1件、従業員・アイテム例）を作る。
3. **API実装**: `apps/api` で Fastify をセットアップ。`zod` で入力バリデーション、`prisma` サービス層でビジネスロジックを実装。持出エンドポイントは `{itemTagUid, employeeTagUid, clientId}` を受け、トランザクションで Loan/Transaction を作成。返却エンドポイントは `loanId` を受けて `returnedAt` を更新。`/ws/notifications` WebSocket を追加し、貸出状況を即時配信。OpenAPI スキーマを `app/openapi.ts` に出力。
4. **Webアプリ**: `apps/web` で React + Vite + TypeScript を用い、TailwindCSS と XState を導入。主要ページ:
   * `/kiosk`: フルスクリーンUI。`ws://localhost:7071/stream` と接続し、`item -> employee -> confirm` の状態遷移で `POST /api/borrow` を呼ぶ。
   * `/kiosk/return`: 現在借用中のリストを表示し、返却ボタンで `POST /api/return`。
   * `/admin/employees`, `/admin/items`: テーブルと詳細フォーム、NFCタグ割り当て。ローカルエージェントのスキャンを利用して UID を取得するボタンを提供。
   * `/admin/history`: 取引履歴のフィルタ表示。
   認証は JWT + refresh cookie。キオスクはデバイス API キーでトークン取得。
5. **NFCエージェント**: `clients/nfc-agent` で Poetry プロジェクトを作成し、`pyscard`, `fastapi`, `websockets`, `python-dotenv` を利用して RC-S300/S1 からの UID を検出・配信する。`pcscd` が利用できない場合は自動でモックモードへ切り替え、「pyscard が動作しないため nfcpy 等の代替案を検討」というメッセージを `/api/agent/status` で返す。UID は WebSocket (`/stream`) と REST (`/api/agent/status`) に公開し、SQLite キューへ保存してオフライン耐性を確保する。
6. **インフラとデプロイ**: `infrastructure/docker/Dockerfile.api`・`Dockerfile.web` を multi-stage で作成。`docker-compose.server.yml` には `db(PostgreSQL)`, `api`, `web`, `reverse-proxy(Caddy)` を束ね、`scripts/server/deploy.sh` で Pi5 へ一括デプロイできるようにする。Pi4 クライアントでは `docker-compose.client.yml` を `scripts/client/setup-nfc-agent.sh` から呼び出して NFC エージェントを Docker で常駐化し、`scripts/client/setup-kiosk.sh` で Chromium キオスクの systemd サービスを構成する。
7. **テストとCI**: `scripts/test.sh` で `pnpm lint`, `pnpm --filter api test`, `pnpm --filter web test`, `poetry run pytest` を実行。Pi 実機用に `scripts/server/run-e2e.sh` を作り、Playwright でエンドツーエンドテストを行いモックNFCイベントを送出。
8. **USBマスタ一括登録と拡張モジュール基盤**（追加要件）: `prisma/schema.prisma` に `ImportJob` モデルおよび `ImportStatus` enum を追加し、各インポート処理のステータスとサマリーを保持する。Fastify 側には `@fastify/multipart` を導入し、`POST /imports/master` エンドポイントで USB から取得した `employees.csv` / `items.csv` をアップロード→サーバーでCSV解析→従業員／アイテムを upsert する導線を実装。結果は `ImportJob.summary` に格納し、後続機能（ドキュメントビューワー、物流管理など）が同じジョブ管理テーブルを使えるようにする。Web管理画面には「一括登録」ページを追加し、USBマウント先から選択したファイルをアップロードして進捗・結果を確認できるUIを作る。

## Concrete Steps

以下のコマンドを随時実行し、結果を記録する。Milestone 1 では `pnpm install` を Node v18.20.8 + pnpm 9.1.1 の環境で実行し、`pnpm-lock.yaml` を生成済み。

1. 依存インストール（Pi5 もしくは開発機）  
    作業ディレクトリ: リポジトリルート  
        sudo apt-get update && sudo apt-get install -y nodejs npm python3 python3-venv python3-pip libpcsclite-dev pcscd chromium-browser
        corepack enable
        pnpm install
        poetry install -C clients/nfc-agent

2. 環境変数ファイル作成  
    作業ディレクトリ: リポジトリルート  
        cp apps/api/.env.example apps/api/.env
        cp clients/nfc-agent/.env.example clients/nfc-agent/.env

3. DBマイグレーションとシード  
    作業ディレクトリ: リポジトリルート  
        pnpm --filter api prisma migrate deploy
        pnpm --filter api prisma db seed

4. サーバースタック起動（Pi5）  
    作業ディレクトリ: リポジトリルート  
        docker compose -f infrastructure/docker/docker-compose.server.yml up --build

5. クライアント側 NFC エージェントとキオスク起動（Pi4）  
    作業ディレクトリ: リポジトリルート  
        sudo scripts/client/setup-nfc-agent.sh
        sudo scripts/client/setup-kiosk.sh https://<server-hostname>/kiosk

6. 自動テスト  
    作業ディレクトリ: リポジトリルート  
        pnpm lint
        pnpm --filter api test
        pnpm --filter web test
        poetry run -C clients/nfc-agent pytest

## Validation and Acceptance

最終的に以下の挙動を実機で確認する。2025-11-18 時点では環境構築まで完了しており、これら 8 項目はまだ未実施であるため Milestone 5（実機検証フェーズ）で順次消化する。

1. **サーバーヘルス**: Pi5 で `curl http://<server>:8080/health` を実行し、HTTP 200 / ボディ `OK` を確認。
2. **従業員・アイテム管理**: Chromium から `https://<server>/admin/employees` にアクセスし、管理者でログイン。新規従業員を作成し、Pi4 の「スキャン」ボタンでNFC UIDを割り当てる。画面および `SELECT * FROM employees;` で登録済みを確認。
3. **持出フロー**: Pi4 キオスクで `https://<server>/kiosk` を開き、アイテムタグ→社員証の順でかざす。「検出 -> 確認 -> 完了」状態遷移と `POST /api/borrow` 201 応答を確認し、`SELECT * FROM loans WHERE returned_at IS NULL;` にレコードが存在すること。
4. **返却フロー**: 対象レコードの「返却」ボタンを押し、`POST /api/return` 200 応答と一覧からの消失を確認。`transactions` に借用・返却の両方が記録されること。
5. **履歴画面**: 管理UIの履歴検索で日時フィルタをかけ、直近の操作が表示されること。
6. **オフライン耐性**: Pi4 の Wi-Fi を一時切断してスキャン→再接続すると、エージェントがキューを自動送信し、ステータス画面に `queuedEvents: 0` が表示されること。
7. **USB一括登録**: 管理画面「一括登録」で USB 内の `employees.csv` / `items.csv` を選択して取り込み、インポート結果が画面と `import_jobs` テーブルに反映され、従業員・アイテム一覧にアップロード内容が反映されること。
8. **NFC エージェント**: Pi4 で `poetry run python -m nfc_agent` を実行し、`GET http://localhost:7071/api/agent/status` で `readerConnected=true` が返ることを確認。タグをかざすと `ws://localhost:7071/stream` に UID イベントが届き、`/api/agent/queue` の件数が増減する。pyscard が利用できない状態では status メッセージに代替案（mock モード）が表示される。

これらが一貫して成功すれば受け入れ完了。

## Idempotence and Recovery

`pnpm prisma migrate deploy` などのマイグレーションコマンドは冪等で、再実行しても安全。Docker Compose は `--force-recreate` で再起動可能。持出 API で失敗した場合は Prisma のトランザクションがロールバックし、フロントは再送ボタンを提供する。NFCエージェントの SQLite キューはコンテナ再起動後も保持され、API復旧後にフラッシュされる。バックアップは `pg_dump` を cron で実行し、`.env` を安全な場所に保管。問題発生時は Compose を停止→`pg_restore`→再起動で復旧する。

## Artifacts and Notes

実装時は成功例を以下のように記録する（本節に随時追加）。

    $ docker compose -f infrastructure/docker/docker-compose.server.yml ps
    NAME                    COMMAND                  STATE   PORTS
    rps_api_1               "docker-entrypoint..."   Up      0.0.0.0:8080->8080/tcp
    rps_web_1               "caddy run --config…"    Up      443/tcp
    rps_db_1                "docker-entrypoint…"     Up      5432/tcp

    $ curl -X POST http://localhost:8080/api/borrow \
        -H "Authorization: Bearer <token>" \
        -H "Content-Type: application/json" \
        -d '{"itemTagUid":"04AABBCC","employeeTagUid":"04776655","clientId":"pi4-01"}'
    {"loanId":"f4c1...","status":"checked_out"}

## Interfaces and Dependencies

* **APIエンドポイント** (`/api` プレフィックス)
  * `POST /auth/login`: `{username,password}` -> `{accessToken,refreshToken}`
  * `GET/POST/PUT /employees` `/items`: CRUD + NFC UID 更新
  * `POST /borrow`: `{itemTagUid, employeeTagUid, clientId, note?}`
  * `POST /return`: `{loanId, performedByUserId?, clientId}`
  * `GET /loans/active`, `GET /transactions`
  * `POST /clients/heartbeat`: Pi4 からシリアルと状態を送信
  * `GET /kiosk/config`: キオスク固有設定
  * `POST /imports/master`: USB由来の `employees.csv` / `items.csv` をアップロードして従業員・アイテムを一括登録
  * `GET /imports/jobs`: 最新のインポートジョブ履歴を取得（将来のドキュメント/物流ジョブでも共通利用）
* **WebSocket**
  * `/ws/notifications`: サーバー→クライアントのリアルタイム通知
  * `ws://localhost:7071/stream`: Pi4 ローカルNFCエージェント→ブラウザ（UIDイベント）
* **NFCエージェント REST**
  * `GET /api/agent/status`: リーダー接続状況、キュー長
  * `GET /api/agent/queue`: 未送信イベントの確認
  * `POST /api/agent/flush`: 手動送信
  * `WebSocket /stream`: ブラウザへ UID をリアルタイム送信
* **主要依存**
  * Fastify, Prisma, PostgreSQL15, pnpm, React18, Vite, XState, TailwindCSS, pyscard, websockets(Python), pcscd, Chromium Browser, Docker

バージョンは `package.json` `pyproject.toml` `Dockerfile` で固定する。社員テーブルなどのインターフェースは将来機能追加に備え安定性を重視する。

---

変更履歴: 2024-05-27 Codex — 初版（全セクションを日本語で作成）。
変更履歴: 2025-11-18 Codex — Progress を更新して実機検証が未完であることを明記し、Validation and Acceptance の未実施状態を加筆。Milestone 5（実機検証フェーズ）を追加。
```
