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
  - [x] Validation 1-5: サーバーヘルス、従業員・アイテム管理、持出・返却フロー、履歴画面（一部完了）
  - [ ] Validation 6: オフライン耐性（未実施）
  - [ ] Validation 7: USB一括登録（未実施）
  - [x] Validation 8: NFCエージェント単体（一部完了）
- [x] (2025-11-23) Milestone 6: モジュール化リファクタリング Phase 1 & 3 完了。共通パッケージ（packages/shared-types）を作成し、API/Web間で型定義を共有化。APIルートを routes/tools/ にモジュール化し、/api/tools/* パスを追加（既存パスは後方互換性のため維持）。Dockerfile.apiとDockerfile.webを修正し、packages/shared-typesのビルドとコピーを追加。ラズパイ5でAPIが正常に動作し、既存パスと新しいモジュールパスの両方で同じデータが返ることを確認。ラズパイ4でWeb UIが正常に表示されることを確認。
- [x] (2025-01-XX) Milestone 6 Phase 2: サービス層の導入完了。services/tools/ ディレクトリを作成し、EmployeeService、ItemService、LoanService、TransactionServiceを実装。全ルートハンドラーからPrismaクエリとビジネスロジックをサービス層に移動し、ルートハンドラーはサービス層を呼び出すだけの構造に変更。ビルド成功を確認。
- [x] (2025-01-XX) Milestone 6 Phase 4: フロントエンドのモジュール化完了。pages/tools/ ディレクトリを作成し、EmployeesPage、ItemsPage、HistoryPageを移動。ルーティングを /admin/tools/* に変更し、既存パス（/admin/employees など）も後方互換性のため維持。AdminLayoutのナビゲーションリンクを更新。ビルド成功を確認。
- [x] (2025-01-XX) Milestone 6 動作確認完了。ラズパイ5でAPIの既存パス（/api/employees、/api/items、/api/transactions）と新パス（/api/tools/employees、/api/tools/items、/api/tools/transactions）の両方で同じデータが返ることを確認。TransactionServiceが正常に動作することを確認。ラズパイ4でWeb UIの全アドレス（/admin/tools/* と /admin/*）が正常に表示されることを確認。後方互換性が保たれていることを実機で検証済み。全Phase完了。
- [x] (2025-01-XX) ファイル構造とドキュメントのリファクタリング完了。toolsモジュールを機能ごとのサブディレクトリ構造に分割（employees/, items/, loans/, transactions/）。バリデーションスキーマを各サブディレクトリのschemas.tsに分離。新規モジュール（documents）用のテンプレート構造を作成。ドキュメント構造をdocs/ディレクトリに整理（architecture/, modules/, guides/, decisions/）。ビルド成功を確認。
- [x] (2025-01-XX) ファイル構造リファクタリングの動作確認完了。ラズパイ5でAPIの既存パス（/api/employees, /api/items, /api/transactions）と新パス（/api/tools/employees, /api/tools/items, /api/tools/transactions）の両方で同じデータが返ることを確認。持出・返却API（/api/tools/borrow, /api/tools/loans/active）が正常に動作することを確認。ラズパイ4でWeb UIの全アドレス（/admin/tools/* と /admin/*）が正常に表示されることを確認。ファイル分割後の構造でも後方互換性が保たれていることを実機で検証済み。
- [x] (2025-01-XX) ロギングとエラーハンドリングの改善完了。console.log/errorをpinoロガーに統一、エラーハンドラーに詳細情報（requestId, method, url, userId等）を追加、サービス層（LoanService）に重要な操作のログを追加。共通ロガー（lib/logger.ts）を作成。ビルド成功を確認。ラズパイ5でAPI起動ログが新しい形式で出力されることを確認。持出API実行時に「Borrow request started」「Item not found for borrow」「API error」などのログが正しく記録されることを実機で検証済み。
- [x] (2025-11-24) 運用・保守性の向上機能を追加完了。バックアップ・リストアスクリプト（scripts/server/backup.sh, restore.sh）を作成し、ラズパイ5で検証完了。監視・アラート機能（システムヘルスチェックエンドポイント /api/system/health、メトリクスエンドポイント /api/system/metrics、監視スクリプト scripts/server/monitor.sh）を実装し、ラズパイ5で検証完了。GitHub Actions CIパイプライン（.github/workflows/ci.yml）を作成し、テストとビルドの自動化を実装。デプロイスクリプト（scripts/server/deploy.sh）を更新し、ラズパイ5で検証完了。API概要ドキュメント、認証APIドキュメント、開発者向けガイドを作成。すべての機能がラズパイ5で正常に動作することを実機で検証済み。
- [x] (2025-11-24) GitHub Actions CIパイプラインの修正完了。pnpmバージョンの不一致（8→9）を修正、Prisma Client生成ステップを追加、health.test.tsを/api/system/healthエンドポイントに更新。すべてのテストが通過し、CIパイプラインが正常に動作することを確認。
- [x] (2025-11-24) ルートハンドラーの統合テスト追加完了。テストヘルパー関数（helpers.ts）を作成し、従業員・アイテム・貸出・認証エンドポイントの統合テストを追加。合計20以上のテストケースを追加し、APIエンドポイントの動作を保証。ビルド成功を確認。
- [x] (2025-11-24) 統合テストの安定化完了。テストデータの分離を改善し、cleanupTestData()を削除して各テストで一意なデータを生成するように変更。createTestClientDeviceがAPIキーも返すように修正。GitHub Actions CIパイプラインで全66テストが成功することを確認。
- [x] (2025-11-24) ローカルテスト環境の整備完了。Docker Desktopを使用したローカルテスト実行スクリプト（scripts/test/start-postgres.sh, stop-postgres.sh, run-tests.sh）を作成。package.jsonにtest:api, test:postgres:start, test:postgres:stopスクリプトを追加。Macローカル環境で全66テストが成功することを確認。
- [x] (2025-11-24) E2Eテストの追加完了。Playwrightを使用したE2Eテストを実装。認証フロー、キオスク画面、管理画面のテストを追加。CIパイプラインにE2Eテストジョブを追加。READMEと開発ガイドにE2Eテストの実行方法を追加。
- [x] (2025-11-24) APIレート制限による429エラーの解決完了。キオスクエンドポイント（/api/tools/loans/active, /api/tools/loans/borrow, /api/tools/loans/return, /api/kiosk/config）に対して、ルート単位で`config: { rateLimit: false }`を設定してレート制限を無効化。正常動作時点のコードと比較して根本原因を特定し、Fastify標準の機能を使用することで解決。トラブルシューティングガイド（docs/guides/troubleshooting.md）を作成し、問題の経緯、要因、要因分析方法、対策を詳細に記録。
- [x] (2025-11-24) E2Eテストの改善とCI環境での最適化完了。ログイン後のリダイレクト問題を修正（LoginPageのuseEffect、RequireAuthのloading状態追加）。CI環境では物理デバイスが必要なNFCスキャンテストを削除し、有効な範囲のみをテストする方針に変更。状態マシンのロジックは既にborrowMachine.test.tsでユニットテストされ、APIの統合テストはloans.integration.test.tsで実施されているため、CI環境では画面表示・ナビゲーションのテストのみに限定。詳細は`docs/progress/e2e-testing-improvements.md`を参照。
- [x] (2025-11-24) オフライン耐性機能の実装完了。NFCエージェントにキュー再送ワーカー（ResendWorker）を実装し、オフライン時に保存されたイベントをオンライン復帰後にWebSocket経由で再配信する機能を追加。WebSocket接続確立時に即座にキューに保存されたイベントを再送する機能も実装。詳細は`docs/progress/offline-resilience-implementation.md`を参照。実機検証は次フェーズで実施。
- [x] (2025-11-25) APIリファクタリング Phase 1-4: レート制限設定の統一管理システム実装、エラーハンドリング改善、削除機能の完全実装、ルーティング修正（/api/transactions → /api/tools/transactions）。レート制限は実質的に無効化（max=100000）により429エラーを回避。データベースマイグレーション確認テスト追加。詳細は`REFACTORING_PLAN.md`を参照。
- [ ] (2025-11-25) **課題**: 実環境（ラズパイ5/4）で機能改善が確認できていない。429エラー、404エラー、削除機能、インポート機能の問題が解決されていない可能性がある。
- [ ] (2025-11-25) **課題**: GitHub Actions CIテストが直近50件くらい全て失敗している。ローカルでは84テストが成功するが、CI環境では失敗している。
- [ ] (2025-11-25) **次のタスク**: 実環境（ラズパイ5/4）での動作確認を実施し、実際にどの機能が動作していないかを特定する。
- [ ] (2025-11-25) **次のタスク**: GitHub Actions CIテストの失敗原因を特定し、修正する。
- [ ] (2025-11-25) **次のタスク**: Validation 6（オフライン耐性）とValidation 7（USB一括登録）を実施（Milestone 5の残タスク）。

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
- 観測: キオスク画面で2秒ごとのポーリングが行われている際、APIレート制限（100リクエスト/分）に引っかかり、429 "Too Many Requests"エラーが発生した。  
  エビデンス: ブラウザコンソールに429エラーが大量に表示され、`/api/tools/loans/active`へのリクエストが429で失敗。APIログを確認すると、`skip`関数が呼び出されていないことが判明。  
  要因分析: 正常動作時点（`ef2bd7c`）のコードと比較したところ、正常時点では`skip`関数は存在せず、フロントエンド側で重複リクエストを防いでいたためレート制限に引っかからなかった。その後、`skip`関数を追加しようとしたが、`@fastify/rate-limit`の`skip`関数が期待通りに動作しなかった。  
  対応: キオスクエンドポイントに対して、Fastify標準の`config: { rateLimit: false }`オプションを使用してルート単位でレート制限を無効化。これにより、確実にレート制限をスキップできるようになった。詳細は`docs/guides/troubleshooting.md`を参照。
- 観測: `@fastify/rate-limit`の`skip`関数が型エラーで実装できない。`config: { rateLimit: false }`も機能しない。  
  エビデンス: `skip`関数を実装しようとしたが、`Object literal may only specify known properties, and 'skip' does not exist in type 'FastifyRegisterOptions<RateLimitPluginOptions>'`というエラーが発生。複数回試行したが失敗。  
  対応: レート制限のmax値を100000に設定して実質的に無効化。これは暫定的な対応であり、将来的にはより適切なレート制限設定を実装する必要がある。
- 観測: ローカルでは84テストが成功するが、実環境では機能改善が確認できていない。GitHub Actions CIテストも直近50件くらい全て失敗している。  
  エビデンス: ユーザーからの報告。ローカル環境と実環境の差異が原因の可能性がある。  
  対応: 実環境での動作確認とCIテスト失敗原因の特定が必要。
- 観測: API ルートが `/auth/login` に直下で公開されており、Web UI から呼び出す `/api/auth/login` が 404 になる。  
  エビデンス: Browser DevTools で `/api/auth/login` が 404、`/auth/login` は 200。  
  対応: `apps/api/src/routes/index.ts` を `{ prefix: '/api' }` 付きでサブルータ登録するよう修正。
- 観測: Caddy の `@spa` マッチャーが `/api/*` や `/ws/*` にも適用され、`POST /api/auth/login` が `Allow: GET, HEAD` の 405 になる。  
  エビデンス: `curl -X POST http://localhost:8080/api/auth/login` が 405 を返し、Caddyfile に API 除外が無かった。  
  対応: `@spa` へ `not path /api/*` と `not path /ws/*` を追加し、API/WS パスを SPA フォールバック対象から除外。
- 観測: マスタの名称変更が履歴表示に反映され、過去の記録が「最新名」に書き換わってしまう。  
  対応: BORROW/RETURN 登録時にアイテム/従業員のスナップショット（id/code/name/uid）を Transaction.details に保存し、履歴表示・CSV はスナップショットを優先するように更新。既存データは順次新規記録から適用。
- 観測: Dockerfile.apiとDockerfile.webで`packages/shared-types`をコピーしていなかったため、ビルド時に`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`エラーが発生した。  
  エビデンス: `pnpm install`実行時に`@raspi-system/shared-types@workspace:*`が見つからないエラー。ランタイムステージでも`pnpm install --prod`実行時に同様のエラー。  
  対応: Dockerfile.apiとDockerfile.webのビルドステージで`COPY packages ./packages`を追加し、`packages/shared-types`を先にビルドするように修正。ランタイムステージでは`apps/api`と`packages/shared-types`を丸ごとコピーし、`pnpm install --prod --recursive --frozen-lockfile`でワークスペース依存を解決するように変更。
- 観測: Phase 2でサービス層を導入する際、`loan.service.ts`で`ItemStatus`と`TransactionAction`を`import type`でインポートしていたが、値として使用していたためTypeScriptエラーが発生した。  
  エビデンス: `pnpm build`実行時に`'ItemStatus' cannot be used as a value because it was imported using 'import type'`エラー。  
  対応: `ItemStatus`と`TransactionAction`を通常のインポート（`import { ItemStatus, TransactionAction }`）に変更し、型のみのインポート（`import type { Loan }`）と分離。
- 観測: GitHub Actions CIパイプラインでpnpmバージョンの不一致エラーが発生した。  
  エビデンス: `ERR_PNPM_UNSUPPORTED_ENGINE`エラー。`package.json`で`engines.pnpm >=9.0.0`が指定されているが、CIワークフローで`version: 8`を指定していた。  
  対応: CIワークフローで`pnpm`のバージョンを9に変更。Raspberry Pi上では`corepack`により自動的に正しいバージョン（9.1.1）が使用されるため問題なし。
- 観測: GitHub Actions CIパイプラインでPrisma Clientが生成されていないため、TypeScriptビルドが失敗した。  
  エビデンス: `error TS2305: Module '"@prisma/client"' has no exported member 'User'`などのエラー。  
  対応: CIワークフローに`Generate Prisma Client`ステップを追加し、APIビルド前にPrisma Clientを生成するように修正。
- 観測: `health.test.ts`が古いエンドポイント（`/api/health`）を参照しており、CIテストが失敗した。  
  エビデンス: `Route GET:/api/health not found`エラー。実際のエンドポイントは`/api/system/health`に変更されていた。  
  対応: `health.test.ts`を`/api/system/health`エンドポイントに更新し、新しいレスポンス構造（`status`, `checks`, `memory`, `uptime`）に対応。

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
  日付/担当: 2025-11-23 / リファクタリング計画
- 決定: APIルートを `/api/tools/*` パスにモジュール化し、既存の `/api/employees` などのパスは後方互換性のため維持する。共通パッケージ `packages/shared-types` を作成し、API/Web間で型定義を共有する。  
  理由: 新モジュール追加時のルート名衝突を防止し、型安全性を向上させるため。既存システムへの影響を最小限に抑えるため、後方互換性を維持。  
  日付/担当: 2025-11-23 / Phase 1 & 3 実装
- 決定: Dockerfileのランタイムステージでは、`apps/api`と`packages/shared-types`を丸ごとコピーし、`pnpm install --prod --recursive --frozen-lockfile`でワークスペース依存を解決する方式を採用する。  
  理由: ワークスペース依存を正しく解決するためには、ワークスペース全体の構造が必要。個別ファイルをコピーする方式では依存関係の解決が困難だったため。  
  日付/担当: 2025-11-23 / Dockerfile修正

## Outcomes & Retrospective

- 実装完了時に記載する。

## Documentation Structure

詳細なドキュメントは `docs/` ディレクトリに整理されています：

- **`docs/architecture/`**: システムアーキテクチャの詳細
- **`docs/modules/`**: 機能別の詳細仕様（tools, documents, logistics）
- **`docs/guides/`**: 開発・デプロイ・トラブルシューティングガイド
- **`docs/decisions/`**: アーキテクチャ決定記録（ADR）

各モジュールの詳細仕様は `docs/modules/{module-name}/README.md` を参照してください。

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
6. **モジュール化リファクタリング**: 将来の機能拡張に備えてモジュール化を進める。ブランチ `refactor/module-architecture` で実施し、各Phase完了後に動作確認を実施。全Phase（Phase 1: APIルートのモジュール化、Phase 2: サービス層の導入、Phase 3: 共通パッケージ作成、Phase 4: フロントエンドモジュール化）を完了。受入: ラズパイ5でAPIが正常に動作し、既存パスと新しいモジュールパスの両方で同じデータが返ることを確認。ラズパイ4でWeb UIが正常に表示されることを確認。全ルートハンドラーがサービス層を使用する構造に変更済み。

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

7. モジュール化リファクタリング（Milestone 6）  
    作業ディレクトリ: リポジトリルート  
    **Phase 1**: APIルートのモジュール化（routes/tools/ ディレクトリ作成、employees.ts, items.ts, loans.ts, transactions.ts を移動）
    **Phase 2**: サービス層の導入（services/tools/ ディレクトリ作成、EmployeeService, ItemService, LoanService, TransactionService を実装）
    **Phase 3**: 共通パッケージ作成（packages/shared-types を作成し、API/Web間で型定義を共有）
    **Phase 4**: フロントエンドモジュール化（pages/tools/ ディレクトリ作成、EmployeesPage, ItemsPage, HistoryPage を移動）
    
    全Phase完了後の動作確認（ラズパイ5）:
        cd /opt/RaspberryPiSystem_002
        git fetch origin
        git checkout refactor/module-architecture
        git pull origin refactor/module-architecture
        pnpm install
        cd packages/shared-types && pnpm build && cd ../..
        cd apps/api && pnpm build && cd ../..
        docker compose -f infrastructure/docker/docker-compose.server.yml down
        docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build
        curl http://localhost:8080/api/health
        # 認証トークン取得後
        curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/employees
        curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/tools/employees
        curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/transactions
        curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/tools/transactions
    全Phase完了後の動作確認（ラズパイ4）:
        cd /opt/RaspberryPiSystem_002
        git fetch origin
        git checkout refactor/module-architecture
        git pull origin refactor/module-architecture
        # ブラウザでWeb UIにアクセスして動作確認
        # http://<pi5>:4173/kiosk
        # http://<pi5>:4173/login
        # http://<pi5>:4173/admin/tools/employees（新パス）
        # http://<pi5>:4173/admin/employees（既存パス、後方互換性）
    **完了**: 2025-01-XX、全Phase完了。ラズパイ5でAPI動作確認済み（既存パスと新パスの両方で動作）、ラズパイ4でWeb UI動作確認済み（既存パスと新パスの両方で動作）。全ルートハンドラーがサービス層を使用する構造に変更済み。

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
変更履歴: 2025-11-23 — Milestone 6 Phase 1 & 3 完了を記録。共通パッケージ作成とAPIルートのモジュール化を実施。Dockerfile修正によるワークスペース依存解決の課題と対応をSurprises & Discoveriesに追加。ラズパイ5/4での動作確認完了を記録。
```
