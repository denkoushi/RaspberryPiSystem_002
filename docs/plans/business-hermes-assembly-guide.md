# 業務Hermesによる組立作業案内の最小縦断

このExecPlanは生きた実装計画であり、リポジトリルートの `.agent/PLANS.md` に従って更新する。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は実装の停止点ごとに更新する。

## Purpose / Big Picture

組立キオスクの作業者が、現在の締付対象と公開済み手順の本文を根拠に、短いHermes案内を確認できるようにする。案内が停止・未設定・タイムアウトでも締付画面は従来どおり操作できる。実際のNGイベントから生成された自発提案は作業者へ出さず、管理者だけが根拠付きで確認できる。

## Progress

- [x] (2026-09-05 JST) `KioskAssemblyWorkSessionPage` を対象に決定し、既存のセッション・手順・現在ボルト表示を確認した。
- [x] (2026-09-05 JST) `feat/business-hermes-assembly-guide` の専用worktreeをライフサイクルCLIで作成した。
- [x] (2026-09-05 JST) 業務Hermes専用設定、本文取得、認証・端末分離、guide APIを実装した。
- [x] (2026-09-05 JST) NG実イベントの管理者限定提案記録と確認API/UIを実装した。
- [x] (2026-09-05 JST) キオスク表示、revisionによる古い応答破棄、業務継続を実装した。
- [x] (2026-09-05 JST) focused tests/build/lintを実行し、実機未検証を記録した。
- [x] (2026-09-05 JST) 業務Pi5用の公式Hermes固定image、専用egress proxy、非root直接CLI起動、resource limit、標準release連携を追加した。
- [x] (2026-09-05 JST) 新規専用volumeでCompose profileを起動し、health、未認証401、正常停止、cleanupをテスト用資格情報で確認した。
- [x] (2026-09-05 JST) 業務profileのmemory、user profile、skills、session searchを無効化し、Private Hermesの記憶・skills・過去会話検索を共有しない設定を追加した。

## Surprises & Discoveries

- 現行 `AssemblyProcedureDocument` は画像ページ中心で本文列を持たない。一方、閲覧順の `KioskDocument` には `extractedText` と `confirmedSummaryText` があり、テンプレート手順ステップには `instructionText` がある。したがって現在対象に紐づく本文をサーバーで解決し、本文が空ならHermesを呼ばず不明扱いにする。
- 既存の推論ランタイムは `INFERENCE_PROVIDERS_JSON` から既定providerを合成し、`LOCAL_LLM_*` にフォールバックする。業務HermesはPrivate Pi5との完全分離が条件なので、この経路を再利用しない。
- `BUSINESS_HERMES_BASE_URL` は `/v1` などのパスを含めるとURL組み立て時に意図しないため、originだけを受け付け、業務APIが `/v1/chat/completions` を付加する契約にした。
- 既存 `ClientLog` は管理者以外にも閲覧できる一覧があるため、提案本文を混ぜず、専用の `BusinessHermesProactiveSuggestion` テーブルをADMIN専用APIから読む構成にした。

## Decision Log

- Decision: 対象画面は `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` とする。Rationale: 同画面だけでセッション状態、現在ボルト、公開手順シーケンス、対象UIが揃い、既存業務操作をブロックせず縦断できる。 Date/Author: 2026-09-05 / Luna xhigh。
- Decision: 本番のHermes未設定時はmockを返さず `unavailable` を返す。mockはテストのfetch差し替えだけに限定する。 Rationale: 未接続を成功扱いにしない。 Date/Author: 2026-09-05 / Luna xhigh。
- Decision: キオスクguideは実際の `x-client-key` とDBセッションの `clientDeviceId`、サーバー記録の `operatorEmployeeId` を照合する。クライアントが送る端末・利用者IDは契約に含めない。 Rationale: 自己申告で別端末・別利用者を混ぜない。 Date/Author: 2026-09-05 / Luna xhigh。
- Decision: 自発提案は既存の締付NGイベントを起点にバックグラウンド生成し、専用の `BusinessHermesProactiveSuggestion` へ秘密を含まない根拠メタデータと短文を保存し、ADMIN限定APIと管理画面で確認する。 Rationale: 既存一般ログの権限範囲を広げず、利用者通知を抑える。 Date/Author: 2026-09-05 / Luna xhigh。
- Decision: モデルが指定できる表示対象は実装済みの現在ボルトだけに限定し、UIで実際にリング表示する。 Rationale: 表示対象を許可したのにUIが示せない状態を作らない。 Date/Author: 2026-09-05 / Luna xhigh。

## Outcomes & Retrospective

ローカル実装と接続契約の検証は完了した。固定digestの公式Hermes本体を専用volume、非root直接CLI、cap_drop ALL、read-onlyで起動し、healthと未認証401、停止cleanupを確認した。memory、user profile、skills、session searchの無効化は公式イメージ内の既存設定契約と既存Private profileの設定形を確認して反映した。実APIキー、Vault、Pi5/Pi4への配備・実OpenAI推論・実機操作は未検証である。

## Context and Orientation

APIは `apps/api/src/routes/assembly/index.ts` が組立ルートを登録し、`AssemblyWorkSessionService.getDetail` が作業セッションとテンプレートをDBから取得する。Webは `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` がセッション取得、手順シーケンス取得、現在ボルト表示、締付操作を一画面で行う。APIとHermes間の境界は新しい業務Hermesサービスに閉じ込め、既存のPrivate Pi5管理APIや既存LocalLLM設定を参照しない。

業務HermesはOpenAI互換の `POST /v1/chat/completions` を提供する独立endpointとして扱う。APIは専用の `BUSINESS_HERMES_*` 環境変数だけを読み、どれか一つでも欠ければ未設定とする。手順本文は現在のボルトに対応する公開済み閲覧順のKioskDocument `extractedText`、またはAssembly template stepの `instructionText` をサーバーで取得する。

## Plan of Work

`apps/api/src/config/env/business-hermes.ts` に専用endpoint URL、APIキー、モデル、timeoutの設定を追加し、既存LocalLLM設定へのフォールバックを作らない。`apps/api/src/services/assembly/business-hermes.service.ts` に、DBから現在セッション・現在ボルト・手順本文を取得して安全なpromptを作り、JSON応答をallowlist検証し、unknown/unavailableを返す処理を追加する。本文やAPIキーはログに出さない。

`apps/api/src/routes/assembly/index.ts` から業務Hermesルートを登録する。キオスクguideはclient key必須でセッションの端末・作業者状態をサーバー照合し、ADMIN限定の提案一覧はBearer認証を要求する。既存の締付NG成功後に自発提案生成を非同期で起動し、結果を専用提案テーブルへ保存する。APIは外部停止やtimeoutを締付レスポンスへ伝播させない。

`apps/web/src/api/domains/assembly.ts` にguide取得と管理者一覧の型・関数を追加する。`KioskAssemblyWorkSessionPage.tsx` の現在対象近くに確認ボタンと短文表示を追加し、画面revision・セッション一致を確認して古い応答を捨てる。対象キーはリング表示できる現在ボルトだけに固定し、無効な対象は表示しない。`DashboardPage.tsx` にはADMINだけが見られる提案一覧を追加する。

`apps/api/.env.example`、Ansibleの業務API envテンプレート、`infrastructure/docker/docker-compose.phase3.yml`、`docs/runbooks/business-hermes.md` に独立設定例と最小疎通手順を追加する。公式imageの `/opt/data` copy-upを利用してinitコンテナを置かず、実値や秘密はコミットしない。

## Concrete Steps

作業場所は `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--business-hermes-assembly-guide` とする。API focused testsは `pnpm --filter @raspi-system/api test -- src/config/business-hermes.env.test.ts src/services/assembly/business-hermes.service.test.ts src/routes/assembly/__tests__/business-hermes.routes.test.ts`、Web focused testsは `pnpm --filter @raspi-system/web test -- src/pages/kiosk/KioskAssemblyWorkSessionPage.test.tsx` を実行した。続いてAPI/Webのbuild、変更範囲のESLint、Prisma validateを実行した。追加構築検証では固定digestのCompose profileを新規volumeで起動し、health、未認証401、正常停止、cleanupを確認した。実OpenAI推論、Pi5、Pi4、実認証、実機配備は実行していない。

## Validation and Acceptance

本文を持つ現在対象で専用endpointが設定されているテストでは、送信payloadに本文と現在状態が含まれ、応答の短文・根拠・固定対象キーが返る。本文がない、専用設定が欠ける、upstreamがtimeout/停止する場合は `unavailable` または `unknown` になり、締付操作の成功レスポンスは変わらない。端末キーとDBセッション端末が違う、operatorEmployeeIdがない、対象セッションが違う場合は拒否する。画面revisionが変わった後に到着した応答は表示されない。実NGイベントは利用者表示なしで管理記録になり、ADMINだけがイベント、根拠文書、ページ、対象キー、短文を確認できる。ログとレスポンスにAPIキー、認証ヘッダ、自由文の内部エラーを含めない。

## Idempotence and Recovery

未設定または接続失敗は業務操作を止めない。guideリクエストはDB状態を変更せず、提案記録はNGイベントごとに追記する。UI revision変更時はAbortControllerで前リクエストを中断し、競合応答もrevision照合で捨てる。途中でテストが失敗した場合は変更を専用worktree内に残し、mainや既存worktreeを変更しない。実値を設定したローカル検証はテスト後に削除し、秘密を保存しない。

## Artifacts and Notes

完了時の報告には専用worktree絶対パス、変更ファイル、focused test/build/lintのコマンドと結果、実機未検証、Hermes未設定時の挙動、未達条件を記載する。

## Interfaces and Dependencies

キオスクguide APIは `POST /api/assembly/work-sessions/:id/hermes-guide` とし、入力は最大512文字の完全な画面状態 `uiRevision` と allowlistされた `eventCode` だけにする。レスポンスは `status: ready | unavailable | unknown`、同じ `uiRevision`、短い `message`、`targetKey`、`evidence`、`reasonCode` を返す。管理者提案APIは `GET /api/assembly/business-hermes/proactive-suggestions?limit=` とし、`ADMIN`だけに許可する。外部依存は独立した業務HermesのOpenAI互換HTTP endpointだけであり、Private Pi5の設定・API・起動停止には依存しない。
