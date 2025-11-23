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
- [x] (2025-11-19 00:30Z) Validation 1: Pi5 で Docker コンテナを再起動し、`curl http://localhost:8080/health` が 200/`{"status":"ok"}` を返すことを確認。
- [x] (2025-11-19 03:00Z) Validation 2: 管理画面にアクセス。Web ポート、Caddy 設定、Dockerfile.web の不備を修正し、`http://<pi5>:4173/login` からログイン画面へ到達できることを確認（ダッシュボード: 従業員2 / アイテム2 / 貸出0 を表示）。
- [x] (2025-11-20 00:20Z) Validation 3: 持出フロー。実機 UID をシードに揃え、client-key を統一。キオスクでタグ2枚を順序問わずスキャン→記録が成功し、返却ペインに表示・返却できることを確認。
- [x] (2025-11-20 00:17Z) Validation 4: 返却フロー。`/api/borrow` で作成された Loan をキオスク返却ペインから返却し、`/loans/active` が空・DB の `returnedAt` が更新され、`Transaction` に BORROW/RETURN の両方が記録されることを確認。タグの組み合わせを順不同で試し、いずれも返却ペインで消えることを確認済み。
- [x] (2025-11-20 01:00Z) Validation 5: 履歴画面に日時フィルタと CSV エクスポートを実装し、管理コンソールから絞り込みとダウンロードが正常動作することを確認。
- [x] (2025-11-20 14:30Z) 履歴の精度向上: BORROW/RETURN 登録時にアイテム/従業員のスナップショットを Transaction.details に保存し、履歴表示・CSV でスナップショットを優先するように変更。マスタ編集後も過去履歴の値が変わらないことを実機で確認。
- [ ] (Upcoming) Milestone 5: 実機検証フェーズ。Pi5 上の API/Web/DB と Pi4 キオスク・NFC エージェントを接続し、Validation and Acceptance セクションの 8 シナリオを順次実施してログと証跡を残す。
- [x] (2025-01-XX) Milestone 6: モジュール化リファクタリング Phase 1 & 3 完了。共通パッケージ（packages/shared-types）を作成し、API/Web間で型定義を共有化。APIルートを routes/tools/ にモジュール化し、/api/tools/* パスを追加（既存パスは後方互換性のため維持）。ビルド成功を確認済み。Phase 2（サービス層導入）とPhase 4（フロントエンドモジュール化）は未実施。

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
- 観測: Pi5 をシャットダウンすると Docker コンテナ（api/web）が Exited のまま復帰しない。  
  エビデンス: Validation 1 前に `docker-api-1` (Exited 137) / `docker-web-1` (Exited 0) が `docker compose ps` で確認された。  
  対応: `docker compose up -d` で手動再起動。`restart: always` ポリシーを追加し、Pi5 再起動時に自動復帰させる。
- 観測: Web サーバーの設定が三点（ポート公開、Caddy リッスン/SPA フォールバック、Dockerfile の CMD）で不整合を起こし、`/admin/*` や `/login` に直接アクセスすると常に 404 になっていた。  
  エビデンス: `http://<pi5>:4173/admin/employees` が Caddy の 404 を返し、Caddyfile が `:8080` + `file_server` のみ、Dockerfile.web が `caddy file-server` を起動していた。  
  対応: `docker-compose.server.yml` を `4173:80` に修正、Caddyfile を `:80` + SPA rewrite 付きに更新、Dockerfile.web の CMD を `caddy run --config /srv/Caddyfile` に変更。
- 観測: キオスクの状態機械 `borrowMachine.ts` で XState v5 の `assign` を誤用し、`pnpm run build` が TypeScript エラー（`event is possibly undefined` / `property 'type' does not exist on type never`）で停止した。  
  エビデンス: `docker compose ... build web` が `src/features/kiosk/borrowMachine.ts` に対する TS18048/TS2339 を出力。GitHub commit `17dbf9d` から assign の書き方を変更した直後に再現。  
  対応: `assign(({ event }) => ({ ... }))` 形式で context 差分を返すよう修正し、イベント存在を `event?.type` で確認したうえで UID を設定。README のトラブルシューティングに同様の注意を追記。
- 観測: 実機 UID と seed データが不一致で `/borrow` が 404/400（従業員/アイテム未登録）になる。  
  エビデンス: `curl /api/borrow` が「対象従業員/アイテムが登録されていません」を返した。  
  対応: `apps/api/prisma/seed.ts` を実機タグ（アイテム: 04DE8366BC2A81、社員: 04C362E1330289）に合わせ、再シード。
- 観測: client-key が未設定のキオスクから `/loans/active` を呼ぶと 401。  
  エビデンス: 返却一覧で 401、リクエストヘッダーに `x-client-key` が無い。  
  対応: KioskBorrow/Return のデフォルト `client-demo-key` を設定し、`useActiveLoans`/借用・返却の Mutation に確実にキーを渡す。
- 観測: `/borrow` が 404 の場合は Caddy 側で `/api/*` が素の `/borrow` になっていた。  
  対応: Caddyfile を `@api /api/* /ws/*` → `reverse_proxy @api api:8080` に固定し、パスを保持して転送。
- 観測: 同じアイテムが未返却のまま再借用すると API が 400 で「貸出中」と返す。  
  対応: これは仕様とし、返却してから再借用する運用を明示。必要に応じて DB の `returned_at` をクリアする手順を提示。
- 観測: 返却一覧に表示されないのは `x-client-key` 未設定が原因で 401 となるケースがあった。  
  対応: Kiosk UI のデフォルト clientKey を `client-demo-key` に設定し、Borrow/Return と ActiveLoans の呼び出しに必ずヘッダーを付与するよう修正。
- 観測: 管理 UI の履歴画面に日付フィルタ/CSV エクスポートがなく、確認が手作業になっていた。  
  対応: HistoryPage に日時フィルタと CSV ダウンロードを追加し、API `/transactions` に日付フィルタを実装。
- 観測: Prisma マイグレーションが未適用でテーブルが存在せず、`P2021` エラー（table does not exist）が発生した。  
  エビデンス: Pi5 で `pnpm prisma migrate status` を実行すると `20240527_init` と `20240527_import_jobs` が未適用。  
  対応: `pnpm prisma migrate deploy` と `pnpm prisma db seed` を実行し、テーブル作成と管理者アカウント（admin/admin1234）を投入。
- 観測: API ルートが `/auth/login` に直下で公開されており、Web UI から呼び出す `/api/auth/login` が 404 になる。  
  エビデンス: Browser DevTools で `/api/auth/login` が 404、`/auth/login` は 200。  
  対応: `apps/api/src/routes/index.ts` を `{ prefix: '/api' }` 付きでサブルータ登録するよう修正。
- 観測: Caddy の `@spa` マッチャーが `/api/*` や `/ws/*` にも適用され、`POST /api/auth/login` が `Allow: GET, HEAD` の 405 になる。  
  エビデンス: `curl -X POST http://localhost:8080/api/auth/login` が 405 を返し、Caddyfile に API 除外が無かった。  
  対応: `@spa` へ `not path /api/*` と `not path /ws/*` を追加し、API/WS パスを SPA フォールバック対象から除外。
- 観測: マスタの名称変更が履歴表示に反映され、過去の記録が「最新名」に書き換わってしまう。  
  対応: BORROW/RETURN 登録時にアイテム/従業員のスナップショット（id/code/name/uid）を Transaction.details に保存し、履歴表示・CSV はスナップショットを優先するように更新。既存データは順次新規記録から適用。
- 観測: モジュール化の観点から現プロジェクト構造を評価した結果、基本的な分離はできているが、モジュール境界が不明確で、共通パッケージの活用が不足している。  
  エビデンス: 単一の `schema.prisma` に全テーブルが定義され、APIルートがフラット構造（`/api/employees` など）で名前空間がない。`packages/*` が定義されているが未使用。ルートハンドラーに直接Prismaクエリが記述されており、ビジネスロジックが分散している。  
  対応: Phase 1でAPIルートを `routes/tools/` にモジュール化し、`/api/tools/*` パスを追加（既存パスは後方互換性のため維持）。Phase 3で共通パッケージ `packages/shared-types` を作成し、API/Web間で型定義を共有化。Phase 2でサービス層を導入し、ビジネスロジックをルートから分離予定。Phase 4でフロントエンドをモジュール化予定。

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
- 決定: Pi5 の無人運用を安定させるため、`infrastructure/docker/docker-compose.server.yml` の各サービスへ `restart: always` を追加する方針。  
  理由: Pi5 電源再投入後にコンテナが自動起動しないことが発覚したため。  
  日付/担当: 2025-11-19 / 実機検証チーム  
  備考: Validation 2〜8 完了後に反映予定。
- 決定: Web 配信は Caddy を 80/tcp で公開し、SPA の任意パスを `/index.html` にフォールバックさせる。Dockerfile.web は常に `caddy run --config /srv/Caddyfile` で起動し、docker-compose の公開ポートは `4173:80` に固定する。  
  理由: Validation 2 で直接 URL へアクセスすると 404 になる問題が判明したため。  
  日付/担当: 2025-11-19 / 現地検証チーム
- 決定: API ルートは Fastify で `/api` プレフィックスを付与し、Caddy の SPA フォールバックから `/api/*` と `/ws/*` を除外する。  
  理由: Web UI が `/api` 経由でアクセスする前提で実装されており、プレフィックス不一致と SPA rewrite の干渉で 404/405 になるため。  
  日付/担当: 2025-11-19 / Validation 2 実施チーム
- 決定: XState v5 の `assign` は context/event を直接書き換えずに差分オブジェクトを返す形 (`assign(({ event }) => ({ ... }))`) に統一する。  
  理由: 従来のジェネリック指定 + 2引数シグネチャを使うと `pnpm build` で `event` が `never` 扱いになり、Pi5 の Web イメージがビルドできなかったため。  
  日付/担当: 2025-11-20 / 現地検証チーム
- 決定: 実機タグの UID は seed と同期し、`client-demo-key` をデフォルト clientKey としてキオスク UI に設定する。  
  理由: seed 不一致や clientKey 未入力で `/borrow` や `/loans/active` が 404/401 になるため。  
  日付/担当: 2025-11-20 / 現地検証チーム
- 決定: `/borrow` は未返却の同一アイテムがある場合 400 を返す仕様とし、再借用する際は返却してから実行する運用とする。  
  理由: 状態整合性を保ち、重複貸出を防ぐため。  
  日付/担当: 2025-11-20 / 現地検証チーム
- 決定: 履歴の正確性を担保するため、トランザクション登録時にアイテム/従業員のスナップショットを details に保存し、履歴表示ではスナップショットを優先する。  
  理由: マスタ編集や論理削除後でも過去の表示を固定し、監査性を維持するため。スキーマ変更は行わず details に冗長保存する方式とした。  
  日付/担当: 2025-11-20 / 現地検証チーム
- 決定: モジュール化リファクタリングを段階的に実施し、各Phase完了後に動作確認を行う。Phase 1（APIルートのモジュール化）とPhase 3（共通パッケージ作成）を優先実施し、Phase 2（サービス層導入）とPhase 4（フロントエンドモジュール化）は後続で実施する。  
  理由: 将来の機能拡張（工具管理以外のモジュール追加）に備えて、モジュール境界を明確化し、拡張性・保守性を向上させるため。既存の動作を維持しつつ段階的に改善する方針。  
  日付/担当: 2025-01-XX / リファクタリング計画
- 決定: APIルートを `/api/tools/*` パスにモジュール化し、既存の `/api/employees` などのパスは後方互換性のため維持する。共通パッケージ `packages/shared-types` を作成し、API/Web間で型定義を共有する。  
  理由: 新モジュール追加時のルート名衝突を防止し、型安全性を向上させるため。既存システムへの影響を最小限に抑えるため、後方互換性を維持。  
  日付/担当: 2025-01-XX / Phase 1 & 3 実装

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
6. **モジュール化リファクタリング**: 将来の機能拡張に備えてモジュール化を進める。ブランチ `refactor/module-architecture` で実施し、各Phase完了後に動作確認を実施。問題があれば `git checkout main` で即座にロールバック可能。
   * **Phase 1: APIルートのモジュール化**（完了）: `apps/api/src/routes/tools/` ディレクトリを作成し、`employees.ts`, `items.ts`, `loans.ts`, `transactions.ts` を移動。`routes/index.ts` を更新して `/api/tools/*` パスで登録。既存の `/api/employees` などのパスは後方互換性のため維持。検証: 既存のAPIエンドポイントが正常に動作することを確認。リスク: 低。
   * **Phase 2: サービス層の導入**（未実施）: `apps/api/src/services/tools/` ディレクトリを作成し、`employee.service.ts`, `item.service.ts`, `loan.service.ts` を作成。ルートハンドラーからPrismaクエリをサービス層に移動。ルートハンドラーはサービス層を呼び出すだけにする。検証: 既存のAPI動作が変わらないことを確認、テストが正常に動作することを確認。リスク: 中（ロジックの移動によりバグが発生する可能性）。
   * **Phase 3: 共通パッケージの作成**（完了）: `packages/shared-types/` を作成し、API/Webで共通利用する型定義を移動。`apps/api` と `apps/web` から `@raspi-system/shared-types` を参照。検証: 型定義が正しく共有される、ビルドが正常に完了する、型エラーが発生しない。リスク: 低。
   * **Phase 4: フロントエンドのモジュール化**（未実施）: `apps/web/src/pages/tools/` ディレクトリを作成し、`admin/employees`, `admin/items`, `admin/history` を `tools/` に移動。ルーティングを更新（`/admin/tools/employees` など）。検証: 既存のページが正常に表示される、ルーティングが正常に動作する。リスク: 低。

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
9. **モジュール化リファクタリングの詳細作業**（Milestone 6）:
   * **Phase 1 作業手順**: `apps/api/src/routes/tools/` ディレクトリを作成。`employees.ts`, `items.ts`, `loans.ts`, `transactions.ts` を `tools/` に移動し、インポートパスを `../lib/` から `../../lib/` に修正。`routes/tools/index.ts` を作成して `registerToolsRoutes` 関数を実装。`routes/index.ts` を更新して `/api/tools/*` パスで登録し、既存パスも後方互換性のため維持。検証: 既存のAPIエンドポイント（`/api/employees` など）が正常に動作することを確認。新しいモジュールパス（`/api/tools/employees` など）が同じデータを返すことを確認。フロントエンドからのリクエストが正常に処理されることを確認。ラズパイ上で動作確認。
   * **Phase 2 作業手順**: `apps/api/src/services/tools/` ディレクトリを作成。`employee.service.ts`, `item.service.ts`, `loan.service.ts` を作成し、各ルートハンドラーからPrismaクエリを移動。ルートハンドラーはサービス層を呼び出すだけにする。検証: 既存のAPI動作が変わらないことを確認。テストが正常に動作することを確認。ラズパイ上で動作確認。
   * **Phase 3 作業手順**: `packages/shared-types/` を作成し、`package.json`, `tsconfig.json` を設定。`src/tools/index.ts`, `src/auth/index.ts`, `src/common/index.ts` を作成し、型定義を整理。`apps/api` と `apps/web` の `package.json` に `@raspi-system/shared-types` を追加。`apps/web/src/api/types.ts` を共通パッケージから再エクスポートするように変更。検証: 型定義が正しく共有される。ビルドが正常に完了する。型エラーが発生しない。
   * **Phase 4 作業手順**: `apps/web/src/pages/tools/` ディレクトリを作成。`admin/employees`, `admin/items`, `admin/history` を `tools/` に移動。ルーティングを更新（`/admin/tools/employees` など）。検証: 既存のページが正常に表示される。ルーティングが正常に動作する。ラズパイ上で動作確認。
   * **動作確認チェックリスト**（各Phase完了後）: APIサーバーが正常に起動する。データベース接続が正常。認証・認可が正常に動作。主要なAPIエンドポイントが正常に応答。Web UIが正常に表示される。キオスク機能が正常に動作。NFCエージェントとの連携が正常。ラズパイ上での動作確認。
   * **ロールバック計画**: 各Phase完了後、問題が発生した場合、`git checkout main` で元の状態に戻る。部分的なロールバックが必要な場合は、問題のあるPhaseのみを元に戻す。ブランチ上で修正を続行する。

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

7. モジュール化リファクタリング（Milestone 6）  
    作業ディレクトリ: リポジトリルート  
    Phase 1 & 3 完了後の動作確認（ラズパイ5）:
        cd /opt/RaspberryPiSystem_002
        git fetch origin
        git checkout refactor/module-architecture
        git pull origin refactor/module-architecture
        pnpm install
        cd packages/shared-types && pnpm build && cd ../..
        cd apps/api && pnpm build && cd ../..
        docker compose -f infrastructure/docker/docker-compose.server.yml down
        docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build
        curl http://localhost:8080/health
        curl http://localhost:8080/api/employees
        curl http://localhost:8080/api/tools/employees
    Phase 1 & 3 完了後の動作確認（ラズパイ4）:
        cd /opt/RaspberryPiSystem_002
        git fetch origin
        git checkout refactor/module-architecture
        git pull origin refactor/module-architecture
        pnpm install
        cd apps/web && pnpm build && cd ../..

## Validation and Acceptance

最終的に以下の挙動を実機で確認する。2025-11-18 時点では環境構築まで完了しており、これら 8 項目はまだ未実施であるため Milestone 5（実機検証フェーズ）で順次消化する。

1. **サーバーヘルス**: Pi5 で `curl http://<server>:8080/health` を実行し、HTTP 200 / ボディ `OK` を確認。
2. **従業員・アイテム管理**  
    実行場所: Pi5 (管理UI) + Pi4 (キオスク)  
    1. 管理 UI で従業員登録  
            chromium https://<server>/admin/employees  
       新規従業員を作成し、画面右上の「保存」完了メッセージを確認する。  
    2. Pi4 で NFC UID を割り当て  
            # Pi4 でブラウザが起動済みの場合
            # 「スキャン」ボタンを押し、社員証をかざす
       期待: API ログに `PUT /employees/:id/bind` が記録され、画面に UID が表示される。  
    3. DB で確認  
            docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
              psql -U postgres -d borrow_return \
              -c "SELECT employee_code, nfc_tag_uid FROM employees WHERE employee_code='<code>';"  
       期待: 画面と DB の UID が一致。失敗時は Fastify ログ (`docker compose logs api`) とフォーム入力内容を確認。

3. **持出フロー**  
    実行場所: Pi4 (キオスク) + Pi5 (ログ/DB)  
    1. Pi4 でキオスク表示  
            chromium --app=https://<server>/kiosk  
    2. アイテムタグ→社員証を順にスキャン。  
       期待: 画面で「検出 → 確認 → 完了」の状態遷移が表示され、Pi5 ログに `POST /api/borrow 201`。  
    3. DB で未返却レコードを確認  
            docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
              psql -U postgres -d borrow_return \
              -c "SELECT id, item_id, employee_id FROM loans WHERE returned_at IS NULL;"  
       成功: 対象レコードが存在。失敗: ジャーナル (`journalctl -u kiosk-browser -f`) と API ログでエラー詳細を確認。

4. **返却フロー**  
    実行場所: Pi4 + Pi5  
    1. Pi4 の借用一覧で対象アイテムの「返却」を押す。  
    2. API ログに `POST /api/return 200` が記録される。  
    3. DB で `loans.returned_at` が更新されているか確認  
            docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
              psql -U postgres -d borrow_return \
              -c "SELECT id, returned_at FROM loans WHERE id='<loan_id>';"  
       成功: `returned_at` に時刻が入り、画面一覧から消える。失敗: API レスポンスのエラーメッセージと `transactions` を照合。

5. **履歴画面**  
    実行場所: Pi5 もしくは PC ブラウザ  
    1. 管理 UI で履歴ページへアクセス  
            chromium https://<server>/admin/history  
    2. 日付フィルタを指定して検索。  
    3. 期待: 直近の持出/返却が表示され、CSV エクスポートが成功する。  
       DB でクロスチェック  
            docker compose exec db \
              psql -U postgres -d borrow_return \
              -c "SELECT id, action, created_at FROM transactions ORDER BY created_at DESC LIMIT 5;"  
       成功: 画面の表示と一致。失敗: `GET /transactions` のレスポンス (Chrome DevTools Network) を確認。

6. **オフライン耐性**  
    実行場所: Pi4  
    1. Wi-Fi を切断  
            nmcli radio wifi off  
    2. NFC カードをかざす。  
    3. ステータス確認  
            curl http://localhost:7071/api/agent/status | jq  
       期待: `queueSize` が 1 以上でイベントが保持される。  
    4. Wi-Fi を再接続  
            nmcli radio wifi on  
       期待: `queueSize` が 0 に戻り、Pi5 の API ログにまとめて送信された記録が出る。失敗時は `clients/nfc-agent/queue_store.py` の SQLite ファイル権限と API エラーログを調査。

7. **USB 一括登録**  
    実行場所: Pi5 管理 UI + DB  
    1. USB に `employees.csv`, `items.csv` を配置し Pi5 にマウント。  
    2. 管理 UI の「一括登録」で各 CSV を選択してアップロード。  
    3. 成功ダイアログの件数を記録。  
    4. `import_jobs` テーブル確認  
            docker compose exec db \
              psql -U postgres -d borrow_return \
              -c "SELECT id, file_name, status FROM import_jobs ORDER BY created_at DESC LIMIT 1;"  
       成功: ジョブが `COMPLETED` で、従業員/アイテム一覧に反映。失敗: Caddy (`docker compose logs web`) および Fastify (`logs api`) のエラーを調べる。

8. **NFC エージェント単体**  
    実行場所: Pi4  
    1. エージェント起動  
            cd /opt/RaspberryPiSystem_002/clients/nfc-agent
            poetry run python -m nfc_agent
    2. ステータス確認（別ターミナル）  
            curl http://localhost:7071/api/agent/status | jq  
       期待: `readerConnected:true`, `message:"監視中"`, `lastError:null`。  
    3. WebSocket テスト  
            websocat ws://localhost:7071/stream  
       NFC カードをかざし、UID JSON が受信できること。失敗時は `journalctl -u pcscd -f`、`poetry run python -c "from smartcard.System import readers; print(readers())"` でドライバ状況を診断し、必要に応じて `.env` の `AGENT_MODE=mock` で切り分ける。

これらが一貫して成功すれば受け入れ完了。

### Milestone 6: モジュール化リファクタリングの評価指標

リファクタリング完了後、以下の観点からモジュール化の達成度を評価する。

**評価基準（目標スコア: 9/10以上）**

1. **モジュール境界の明確性**
   - [ ] APIルートがモジュール単位（`/api/tools/*`）に整理されている
   - [ ] フロントエンドのページ構造がモジュール単位に整理されている
   - [ ] データベーススキーマがモジュール別に分割されている（または将来分割可能な構造）
   - [ ] 新モジュール追加時にルート名の衝突がない

2. **共通パッケージの活用**
   - [ ] `packages/shared-types` が作成され、API/Web間で型定義を共有している
   - [ ] 型定義の重複がなく、単一の情報源（Single Source of Truth）になっている
   - [ ] ビルドが正常に完了し、型エラーが発生しない

3. **ビジネスロジックの分離**
   - [ ] サービス層が導入され、ルートハンドラーからビジネスロジックが分離されている
   - [ ] サービス層のテストが容易に書ける構造になっている
   - [ ] ロジックの再利用性が向上している

4. **拡張性**
   - [ ] 新モジュール追加時の作業手順が明確である
   - [ ] 既存モジュールへの影響なく新モジュールを追加できる
   - [ ] モジュール間の依存関係が明確である

5. **後方互換性**
   - [ ] 既存のAPIパス（`/api/employees` など）が正常に動作する
   - [ ] 既存のフロントエンドコードが変更なしで動作する
   - [ ] 既存のテストが正常に動作する

**標準的なアーキテクチャパターンとの比較**

- **Domain-Driven Design (DDD)**: ドメイン層の分離ができているか
- **Feature-Based Structure**: 機能単位のグループ化ができているか
- **Module-Based Monorepo**: モジュール単位のパッケージ分離ができているか

**評価方法**

各Phase完了後、上記の評価基準をチェックし、達成度を記録する。全Phase完了後、総合評価を「Outcomes & Retrospective」セクションに記載する。

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

    # 実機 UID での borrow 確認 (Pi5)
    $ curl -i -X POST http://localhost:8080/api/borrow \
        -H "Content-Type: application/json" \
        -H "x-client-key: client-demo-key" \
        -d '{"itemTagUid":"04DE8366BC2A81","employeeTagUid":"04C362E1330289"}'
    HTTP/1.1 200 ...
    {"loanId":"...","item":{"nfcTagUid":"04DE8366BC2A81"},"employee":{"nfcTagUid":"04C362E1330289"}}

    # 返却確認 (Pi5)
    $ docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
        psql -U postgres -d borrow_return \
        -c "SELECT id, \"returnedAt\" FROM \"Loan\" WHERE id='1107a9fb-d9b7-460d-baf7-edd5ae3b4660';"
      returnedAt が更新されている。
    $ docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
        psql -U postgres -d borrow_return \
        -c "SELECT action, \"createdAt\" FROM \"Transaction\" WHERE \"loanId\"='1107a9fb-d9b7-460d-baf7-edd5ae3b4660' ORDER BY \"createdAt\";"
      BORROW / RETURN の両方が記録されている。
    # 2025-11-19 Server health validation (Pi5)
    $ cd /opt/RaspberryPiSystem_002
    $ docker compose -f infrastructure/docker/docker-compose.server.yml ps
    NAME           STATUS         PORTS
    docker-api-1   Up 9s          0.0.0.0:8080->8080/tcp
    docker-db-1    Up 15h         0.0.0.0:5432->5432/tcp
    docker-web-1   Up 8s          0.0.0.0:4173->8080/tcp, 80/tcp, 443/tcp

    $ curl -s -w "\nHTTP Status: %{http_code}\n" http://localhost:8080/health
    {"status":"ok"}
    HTTP Status: 200

    # 2025-11-19 Admin UI validation (Pi5)
    # docker-compose server ports updated
    $ grep -n "4173" -n infrastructure/docker/docker-compose.server.yml
        - "4173:80"

    # Caddyfile with SPA fallback
    $ cat infrastructure/docker/Caddyfile
    {
      auto_https off
    }

    :80 {
      root * /srv/site
      @api {
        path /api/*
        path /ws/*
      }
      reverse_proxy @api api:8080
      @spa {
        not file
      }
      rewrite @spa /index.html
      file_server
    }

    # Dockerfile.web uses caddy run with config
    $ tail -n 5 infrastructure/docker/Dockerfile.web
    COPY --from=build /app/apps/web/dist ./site
    COPY infrastructure/docker/Caddyfile ./Caddyfile
    CMD ["caddy", "run", "--config", "/srv/Caddyfile"]

    # Prisma migrate & seed (Pi5)
    $ cd /opt/RaspberryPiSystem_002/apps/api
    $ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return" pnpm prisma migrate deploy
    $ DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return" pnpm prisma db seed
    Seed data inserted. 管理者: admin / admin1234

    # API login (after prefix fix)
    $ curl -X POST http://localhost:8080/api/auth/login \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"admin1234"}'
    {"accessToken":"...","refreshToken":"...","user":{...}}

    # Admin UI access
    ブラウザ: http://localhost:4173/login → admin/admin1234 でログイン
    ダッシュボード: 従業員 2 / アイテム 2 / 貸出中 0 を表示

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
変更履歴: 2025-11-19 Codex — Validation 1 実施結果と Docker 再起動課題を追記し、`restart: always` の方針を決定。
変更履歴: 2025-11-19 Codex — Validation 2 実施結果を反映し、Web コンテナ (ports/Caddy/Dockerfile.web) の修正内容を記録。
```
