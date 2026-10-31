# キオスクで「置いて育てる手順書」を4週間試す

この ExecPlan は生きた文書である。実装時は Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を更新し、末尾へ変更理由を記録する。書式と保守はリポジトリルートの `.agent/PLANS.md` に従う。本文のパスは、外部入力の絶対パスを除き、すべてリポジトリルートからの完全な相対パスである。

## Purpose / Big Picture

現場の人が日をまたいで投稿したメモ、写真、PDFページを、案件ごとのキオスク盤面へドラッグして手順書の形に育てる。人が置いた場所を業務 AI が読み、未配置の素材の置き場所、ページ見出し、抜け、数値の食い違いを提案する。人の配置は確定した手がかりとして保持し、AI の提案が人の配置を上書きしないようにする。

完成後は選んだキオスク1台で「技能検定の申込み」の3ページを開き、写真を文章の横へ置き、列幅を変え、文章を直し、後日届いた素材への提案を採用できる。「AIで整える」では段組みと決まった強調スタイルを確認してから採用できる。4週間の記録から、採用率と素材1件あたりの作業時間が改善したか、素材にない数値・手順の書き足しがなかったかを判断する。

今回の依頼はこの計画書1ファイルの新規作成だけである。コード実装、依存追加、DB変更、commit、push、PR作成、merge、release、deploy は実行しない。以下の PR1〜3 は将来の実装単位を示し、その段階の実行許可を意味しない。今回の指定を優先し、索引など他ファイルも変更しない。

## Progress

- [x] (2026-10-31 12:54Z) 必須ルール、承認済み HTML、試験計画、素材・推論・端末・キオスク・移行検証の実装を読み、計画を作成した。
- [x] (2026-10-31 12:54Z) 現行の移行検証器が指定の端末フラグ追加文を拒否することを、DBに接続しない検証で確認した。
- [ ] PR1: スキーマ、端末設定、盤面保存、操作記録、週次指標、対象テストを実装済み。DB不要テスト23件・既存worker回帰5件、schema、SQL、対象lint、変更部分の型検査は成功。専用DB検証と指定の全体型検査は環境・既存設定の阻害により未完了（Artifacts and Notes参照）。
- [ ] PR2: ローカル実装済み。指定5ファイル42件、schema、SQL、対象lint、build型検査が成功。DBのmigration適用・repository.local検証は依頼どおりClaude側へ引継ぎ（Artifacts and Notes参照）。
- [ ] PR3: webの盤面・編集・AI提案・直列保存をローカル実装。対象テストは直近29/30件成功（残るGETモック漏れを修正済み、追加実行の承認待ち）。対象lint、web build、取説source-check、既存ポータル7件は成功。最終差分の対象再検証とブラウザー/Pi4表示・性能確認は未完了。
- [ ] integrationPending: 各段階が別途承認された後、PR番号、push済みSHA、必要なCI、mainのmerge SHA、mainでの確認結果を記録する。
- [ ] 別途承認されたdeployで対象端末をユーザーが選び、4週間の試験を始める。毎週数字と素材にない書き足しの件数を記録する。
- [ ] 4週目の合否を判定し、継続・拡大・終了の判断と運用証拠を記録する。

## Surprises & Discoveries

Observation: モックは本物のAIや永続化を持たない。`M` の `p` / `o` が正解ページと順序で、`topicMap` / `aiTarget` がそれを使う。`analyze` の待ちは700ms固定である。Evidence: `/private/tmp/claude-501/-Users-tsudatakashi-RaspberryPiSystem-002/9032a6ba-20c9-45a7-8e52-9abcca61100c/scratchpad/kentei-mock.html` の上記関数。実装ではこの正解情報を持たず、人が置いた内容と素材を推論へ渡す。数秒〜数分の待ちを扱う。

Observation: 試験計画の旧案は音声・動画も素材としているが、現在の受付はメモと `image` / `pdf` だけである。Evidence: 外部入力 `trial-plan.md` の「作るもの」と `apps/api/src/services/knowledge/knowledge-intake.service.ts` の `intakeRequestSchema.files.kind`。合意済みの新判断を優先して音声・動画を除外する。既存投稿は社員タグを要求するが、盤面の操作に社員タグは要求しない。

Observation: 素材に似た名前が2系統ある。Evidence: `apps/api/prisma/schema.prisma` の `KnowledgeProcedureMaterial` と、`apps/api/src/services/knowledge/procedure-material.port.ts` の型名 `ProcedureMaterial`。後者はナレッジ側の型であり、組立の Prisma モデル `ProcedureMaterial` を使う意味ではない。

Observation: 過去の棚フラグmigrationが存在しても、現行のexpand-only規則は既存表への `DEFAULT` / `NOT NULL` 追加を一般には許さない。Evidence: `scripts/deploy/validate-expand-only-migrations.py` の `DISALLOWED_COLUMN_CLAUSE` と `validate_statement`。`validate_sql` を直接呼ぶ確認結果は次のとおりだった。

    disallowed statement in proposed-procedure-board: ALTER TABLE "ClientDevice" ADD COLUMN "procedureBoardEnabled" BOOLEAN NOT NULL DEFAULT false

一方、`ALTER TABLE "ClientDevice" ADD COLUMN "procedureBoardEnabled" BOOLEAN;`(null許容、defaultなし)は同じ `validate_sql` で通ることを確認した。検証器は変更せず、null許容の列で null を無効として扱う。

Observation: DADSトークンの依存はすでに存在する。Evidence: `apps/web/package.json` に `@digital-go-jp/design-tokens: 1.1.9`、`apps/web/src/index.css` に Noto Sans JP のフォールバックがある。本計画のためのnpm依存は追加しない。ローカルのインストール済み `dist/tokens.css` は今回確認できていないため、指定hexを承認済み入力として記載し、意味色のhexは実装時の確認事項とする。

## Decision Log

Decision: PR1の端末フラグを `20261101085900_add_client_procedure_board_enabled/migration.sql`、新表を予定どおり `20261101090000_add_knowledge_procedure_boards/migration.sql` に分離した。Rationale: 今回の実装依頼が、列追加1文とCREATE TABLE・同時作成インデックスだけのmigrationを個別に要求しているため。どちらも既存validate_sqlを変更せず直接検証した。Date/Author: 2026-10-31 / 実装担当。

Decision: 保存イベントのpayloadに `_save` を保持せず、新表の `layoutHash TEXT` 列へ正規化layoutの安定SHA-256を保存する。同じUUID・盤面・端末とlayoutハッシュなら現在の盤面を返し、不一致は409とする。Rationale: 履歴への盤面全体の重複保存を避け、統計の必要列・payload内の必要キーだけを保存確定後のトランザクション外で取得・集計するため。Date/Author: 2026-10-31 / レビュー修正担当。

Decision: 素材の正本を `KnowledgeProcedureMaterial`、案件を `KnowledgeProcedure` とし、案件ごとに盤面を1つ持つ。組立の `ProcedureMaterial` / `ProcedureVideo` は変更しない。Rationale: 案件への素材割当がすでに存在し、別業務の素材棚を混ぜずに試験できる。根拠は `apps/api/prisma/schema.prisma` と `apps/api/src/services/knowledge/prisma-procedure-material.repository.ts`。Date/Author: 2026-10-31 / ユーザー合意、計画書担当。

Decision: 試験素材はメモ・写真・PDFページだけとし、モックの音声・動画再生と旧試験案の対象範囲を採用しない。Rationale: 現行の受付とPDFページ展開をそのまま使い、投稿仕様を拡張しないため。根拠は `apps/api/src/services/knowledge/knowledge-intake.service.ts`、`apps/api/src/services/knowledge/pdf-knowledge-importer.ts`。Date/Author: 2026-10-31 / ユーザー合意。

Decision: 盤面をrevisionとは別の新テーブルに保存し、layout JSONとversionを持たせる。試験中は盤面から公開せず、育てている内容の閲覧と編集に限定する。Rationale: `apps/api/src/services/knowledge/procedure-worker.ts` は再構成から自動公開または承認依頼まで行うため、その経路へ盤面を書き込むと既存チャットの手順書へ影響する。Date/Author: 2026-10-31 / ユーザー合意。

Decision: 項目を素材参照と直接作成したテキストに分け、テキスト種別をtitle / subtitle / bodyとする。素材文の編集は項目のoverrideに保存する。Rationale: 根拠である `source.text` を保存し、同じ素材を参照する別項目にも編集を波及させないため。Date/Author: 2026-10-31 / ユーザー合意。

Decision: ドラッグによる配置・移動、最大3列、列幅変更、ペイン開閉、その場編集、新規テキスト、複製、盤面から外す操作を提供する。複製は新しいitemIdを持ち、素材の場合は同じmaterialIdを参照する。Rationale: 承認済みモックの `normalize` / `place` / `dropTarget` を操作の基準とし、元素材の破壊を避ける。Date/Author: 2026-10-31 / ユーザー合意。

Decision: 上辺に「タイトル」「サブタイトル」「本文」「複製」「AIで整える」を集める。「最初から」や架空の素材到着ボタンを置かず、補助ラベル・説明文を足さない。Rationale: `AGENTS.md` の UI Text と合意済みの本番操作に合わせる。選択中の項目の直下、未選択なら最後に選んだページの末尾（初期は1ページ目）へ新規テキストを入れる。Date/Author: 2026-10-31 / ユーザー合意、未選択時だけ計画上の補足。

Decision: 置き場所提案は自動・非同期とし、未配置素材だけを対象にする。version単位で保存し、新versionでは旧提案をstale（現在の盤面には適用できない状態）にする。人が置いた項目を動かす提案はコードで捨て、食い違いは人が選ぶまで未決定とする。Rationale: 人の配置を一番強い手がかりにし、遅れて返った推論が作業を壊さないため。根拠は `apps/api/src/services/knowledge/procedure-inference.ts` と `apps/api/src/services/knowledge/procedure-worker.ts` の背景実行・延期・leaseのパターン。Date/Author: 2026-10-31 / ユーザー合意。

Decision: 「AIで整える」は押したときだけ実行し、段組みと固定スタイル名だけを返させ、プレビューを「採用」または「戻す」で確定する。Rationale: 内容判断と装飾判断を分け、人の配置や文章を勝手に確定しないため。任意色コードやCSSは受け付けない。Date/Author: 2026-10-31 / ユーザー合意。

Decision: 紙面をDADSの明るい配色、Noto Sans JP、本文16px相当・行間1.5以上、文字4.5:1以上、枠線・アイコン3:1以上、黄色と黒の二重フォーカスにする。外枠は既存キオスクへ合わせる。Rationale: 読む紙面の可読性と既存画面の連続性を両立する。依存追加をせず使う色だけを出典コメント付きCSS変数に埋め込む。Date/Author: 2026-10-31 / ユーザー合意。

Decision: `ClientDevice.procedureBoardEnabled BOOLEAN`(null許容、Prismaは `Boolean?`、null と false は無効、`=== true` だけ有効)で端末ごとに有効化し、無効端末の盤面APIは403、UIは非表示にする。管理画面から切り替え、対象端末はdeploy時にユーザーが決める。Rationale: 既定無効で試験1台へ限定する。前例は `apps/api/prisma/migrations/20260523100000_mobile_placement_shelf_layout_master/migration.sql`、`apps/api/src/services/mobile-placement/client-capabilities.service.ts`、`apps/web/src/pages/admin/ClientsPage.tsx`。null許容にすることで現行のexpand-only検証器を変更せずに済む(安全側の規則を緩めない)。Date/Author: 2026-10-31 / ユーザー合意、検証器対応は実ファイル調査に基づく計画判断。

Decision: 操作者は `x-client-key` で解決した端末だけを記録し、社員は特定しない。提案表示、採用、外す、ゴースト移動、手配置、移動、書き直し、テキスト追加、複製、整形採用・戻すを別表へ追記する。Rationale: 人別評価をせず、盤面version・時刻・端末に対応した試験証拠を残すため。投稿時の既存社員情報は変更しない。Date/Author: 2026-10-31 / ユーザー合意。

Decision: 採用・修正・手で配置の定義を上辺の数字と週次APIで統一し、採用率の分母を実際に表示した置き場所提案とする。Rationale: 見出し案採用や整形採用で率を水増ししないため。モックの見出し採用・幅変更の単純加算はそのまま移植しない。Date/Author: 2026-10-31 / ユーザー合意。

Decision: 数秒〜数分の推論待ち、background枠、429/503による延期を通常状態として扱う。画面はポーリングし、前回提案を薄く残す。Rationale: `InferenceDeferredError` と既存workerの再試行に合わせ、操作を止めないため。古い提案は表示参照だけとし、そのまま採用できない。Date/Author: 2026-10-31 / ユーザー合意、stale時の採用禁止は整合性の補足。

Decision: PR1を保存・権限・記録・指標、PR2を推論、PR3を画面に分ける。Rationale: 前段だけでもCIが通り、既定無効で既存本番機能を変えずに確認できるため。Date/Author: 2026-10-31 / ユーザー合意。

Decision: 素材集合の変化も盤面versionを進め、同じlayoutで再推論する。作業時間は前面で実際に素材を扱った時間を週ごとに合算し、扱った素材の実数で割る。Rationale: 後日到着した素材を拾い、日をまたぐ放置時間を手間と混同しないため。集計方法の詳細を以下で固定し、試験開始後に恣意的に変更しない。Date/Author: 2026-10-31 / 計画書担当による具体化。

## Outcomes & Retrospective

2026-10-31 PR1実装: 管理画面の切り替えを含む保存・端末権限・記録・週次集計を追加した。PR2/PR3は未着手。DB不要の対象検証は成功したが、DB接続と指定の全体型検査は未完了であり、PR1全体の検証完了は主張しない。実行結果はArtifacts and NotesのPR1実装証拠を正本とする。

計画作成時点では実装・アプリのテスト・移行適用・CI・本番確認は未実施である。現在の成果はこの実行計画と、端末フラグのSQLが現行検証器に拒否されるという確認である。PR1〜3の各完了時に、実際の差分、対象検証コマンド・所要時間・結果、残る不確実性をこの節へ追記する。feature branchの成功をmain統合や本番反映の成功と扱わない。

4週間終了時には、週別の表示数・採用率・修正数・手配置数・素材1件あたり時間・書き足し件数と試料数を残す。合否を満たしても、どの素材が扱いやすかったか、未完了作業や計測欠落が結論に影響しないかを振り返る。

## Context and Orientation

作業ルートは `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--kiosk-procedure-board`。APIはFastify、DBはPostgreSQLとPrisma、画面はReactとReact Query、検証はVitestである。versionによる楽観ロックとは、読み取ったversionと保存先versionが一致する場合だけ更新し、他の操作が先に保存されていたら409を返す方式である。workerはHTTP応答とは別にDBに残った仕事を取り出して処理するもの、leaseは同じ仕事を同時実行しないための期限付き処理権である。

`apps/api/src/services/knowledge/knowledge-intake.service.ts` が投稿を受け付け、`apps/api/src/services/knowledge/pdf-knowledge-importer.ts` がPDFをページへ分け、`apps/api/src/services/knowledge/knowledge-source.ts` が素材の元文章・画像・PDFページ情報を検証する。`apps/api/src/services/knowledge/prisma-procedure-material.repository.ts` の `materialsOf` はassigned素材を古い順で取得する。盤面は `procedureId` が一致し `state=assigned` の素材だけを参照する。投稿直後で未割当の素材は、既存仕分けで案件が決まってから盤面へ現れる。既存受付・仕分けの仕様は変えない。

`apps/api/src/services/knowledge/procedure-inference.ts` の `ProcedureInference` は `apps/api/src/services/inference/ports/text-completion.port.ts` の `TextCompletionPort.complete` を呼ぶ。`useCase:'business_hermes'`、`background:true`、`jsonOutput:true`、JSON.parseとZod検証を新workerにも使う。モデル名やDGX API・認証設定は変更しない。`apps/api/src/services/knowledge/procedure-worker.ts` は5秒ごとに1仕事を処理し、`InferenceDeferredError` を失敗確定とせず延期する。

`apps/api/src/services/knowledge/knowledge-runtime.ts` が依存を組み立て、`apps/api/src/bootstrap/start-post-listen-schedulers.ts` が `HERMES_KNOWLEDGE_ENABLED=true` のとき既存workerを起動・停止する。盤面の推論もこの有効条件を継承する。`apps/api/src/routes/index.ts` で `/api` 配下のルートを登録する。`apps/api/src/routes/hermes-knowledge.ts` の既存公開手順書や `apps/web/src/features/hermes-knowledge/KnowledgeProcedureView.tsx` は盤面を読み込むように変更しない。

端末認証は `apps/api/src/services/clients/client-device-auth.service.ts` の `requireKioskClientDevice`、capabilityは `apps/api/src/services/mobile-placement/client-capabilities.service.ts` を使う。既存管理更新は `apps/api/src/routes/clients/shared.ts`、`apps/api/src/routes/clients/core.ts`、`apps/api/src/services/clients/client-telemetry.service.ts` を通る。画面の型は `apps/web/src/api/domains/clients.ts` と `apps/web/src/api/hooks/clients.ts` にある。

キオスクルートは `apps/web/src/App.tsx` の `KioskLayout` 配下に加える。入口は `apps/web/src/pages/kiosk/KioskPortalPage.tsx` に端末条件付きの「手順づくり」カードを加え、既存タブ順序の共通契約を拡張しない。ドラッグの前例は `apps/web/src/features/assembly/AssemblyProcedureMarkerLayer.tsx` で、pointer capture、requestAnimationFrame、pointercancelによる取消を参照する。組立側のファイルそのものは変更しない。

承認済み見本は `/private/tmp/claude-501/-Users-tsudatakashi-RaspberryPiSystem-002/9032a6ba-20c9-45a7-8e52-9abcca61100c/scratchpad/kentei-mock.html`、試験案は同じディレクトリの `trial-plan.md`。これらは一時ファイルなので、次節以降へ必要な操作・試験条件を埋め込んだ。実装者が再度アクセスできなくても本計画だけで進められる。

## Plan of Work

### 共通の盤面契約と正規化

盤面は初期3ページとし、ページ番号は1〜3、row / col / indexは0始まりとする。ページ見出しは `heading`、行の列幅比は `w` で保存する。項目には盤面内で一意のUUID `itemId` を付ける。同じmaterialIdの複数参照は許可するが、同じitemIdの重複は拒否する。AIゴースト（未確定の仮配置）や抜けの枠を確定layoutの項目にはしない。

PR1で `apps/api/src/services/knowledge/procedure-board-layout.ts` に次のZod案を実装する。`strict` は未定義キーを拒否する指定である。API入力・DB読取り・AI出力をこの境界で検証する。

    const styleSchema = z.enum(['heading','subheading','body','caution','key-number','figure']);
    const itemSchema = z.discriminatedUnion('kind', [
      z.object({
        itemId: z.string().uuid(), kind: z.literal('material'),
        materialId: z.string().min(1), override: z.string().max(12000).optional(),
        origin: z.enum(['human','ai-accepted']), style: styleSchema
      }).strict(),
      z.object({
        itemId: z.string().uuid(), kind: z.literal('text'),
        textKind: z.enum(['title','subtitle','body']), text: z.string().max(12000),
        origin: z.literal('human'), style: styleSchema
      }).strict()
    ]);
    const colSchema = z.object({ items: z.array(itemSchema).max(200) }).strict();
    const rowSchema = z.object({
      cols: z.array(colSchema).max(3),
      w: z.array(z.number().finite().positive()).max(3)
    }).strict().refine(r => r.cols.length === r.w.length);
    const layoutSchema = z.object({
      formatVersion: z.literal(1),
      pages: z.array(z.object({
        page: z.number().int().min(1).max(3), heading: z.string().max(120),
        rows: z.array(rowSchema).max(200)
      }).strict()).length(3)
    }).strict();

追加検証でページ番号が1,2,3の順に1回ずつ現れること、盤面全体のitemIdが一意で項目合計600以下であること、素材がその案件のassigned素材であることを確認する。新規テキストは編集開始時に空を許し、確定時は空白だけなら挿入を取り消す。直接テキストは初期styleをtitle→heading、subtitle→subheading、body→bodyとする。素材は画像/PDFページならfigure、メモならbodyを初期値にする。

`normalizeLayout` はモックの `normalize` と同じく、空の列を対応するwと一緒に消し、空の行を消す。1列だけ残った行は、列内の項目ごとに1列1項目・w=[1]の行へ戻す。2〜3列の行は順序を保持してwの合計を1へ正規化する。幅は各列15%以上となるよう操作中に制限し、保存でも検証する。4列以上、負数・NaNの幅、wとcolsの個数違いは補正せず400にする。正規化を2回適用しても結果が同じになることをテストする。

`placeItem` はモックの `place` の3操作を持つ。mode=rowは新しい1列行を挿入、mode=colは既存行へ横の列を挿入、mode=inは既存列内へ挿入する。移動では最初に元itemIdだけを外して正規化した配列へ、ドロップ時に計算した座標で挿入する。同じ素材への別参照は外さない。画像を文章の横へ初めて置く場合の初期比は2:1、同種の横列は等幅とする。削除で1列になった場合の復元もこの関数を通す。

`aiTarget` はモックでは写真を直前の文章の横へ、文章を新しい行へ置くための仮の正解探索だった。実装では正解順序 `p/o` を使わず、AIに同じ3種類の目標を返させる。提案の座標は確定layoutだけに対する座標とし、他のゴーストを含めて数えない。複数ゴーストは表示層で組み立て、1件採用するとversionを進めて残りを再提案する。

保存例の `layout` は次の形になる。以下のJSON中の素材IDは読みやすく短縮した例で、itemIdは実際にもUUIDとする。

    {"formatVersion":1,"pages":[
      {"page":1,"heading":"受検の準備","rows":[{"cols":[
        {"items":[{"itemId":"00000000-0000-4000-8000-000000000001","kind":"material","materialId":"mat-memo","origin":"human","style":"body","override":"受検料を確認する"}]},
        {"items":[{"itemId":"00000000-0000-4000-8000-000000000002","kind":"material","materialId":"mat-photo","origin":"human","style":"figure"}]}
      ],"w":[0.666667,0.333333]}]},
      {"page":2,"heading":"","rows":[]},
      {"page":3,"heading":"","rows":[]}
    ]}

### PR1: 保存、端末フラグ、操作記録、指標を独立して動かす

PR1終了時には画面とAIがなくても、認証済み端末が案件の素材を取得し、盤面を保存して再取得できる。無効端末の403、二重保存の409、操作の一度だけの記録、週次集計をHTTPテストで示す。AIが未実装でも `ai.status='unavailable'` を返して保存機能は動作する。

新規ファイルは `apps/api/prisma/migrations/20261101090000_add_knowledge_procedure_boards/migration.sql`、`apps/api/src/routes/kiosk-procedure-boards.ts`、`apps/api/src/services/knowledge/procedure-board-layout.ts`、`apps/api/src/services/knowledge/procedure-board.service.ts`、`apps/api/src/services/knowledge/prisma-procedure-board.repository.ts`、`apps/api/src/services/knowledge/procedure-board-metrics.ts` とする。テストは `apps/api/src/routes/__tests__/kiosk-procedure-boards.test.ts`、`apps/api/src/services/knowledge/__tests__/procedure-board-layout.test.ts`、`apps/api/src/services/knowledge/__tests__/procedure-board-metrics.test.ts`、`apps/api/src/services/knowledge/__tests__/procedure-board-repository.local.test.ts` を新設する。migration名の時刻が衝突した場合だけ未適用の新規名へ変更し、本計画にも反映する。

既存変更は `apps/api/prisma/schema.prisma`、`apps/api/src/routes/index.ts`、`apps/api/src/services/knowledge/knowledge-runtime.ts`、`apps/api/src/services/mobile-placement/client-capabilities.service.ts`、`apps/api/src/routes/clients/shared.ts`、`apps/api/src/routes/clients/core.ts`、`apps/api/src/services/clients/client-telemetry.service.ts` に限定する。端末設定UIをPR1で完成させるため、`apps/web/src/api/domains/clients.ts`、`apps/web/src/api/hooks/clients.ts`、`apps/web/src/pages/admin/ClientsPage.tsx`、`apps/web/src/pages/admin/ClientsPage.site.test.tsx` もフラグの型・送信・表示・保持テストを追加する。既存の棚フラグに隣接させ、省略更新では既存値を保持する。

移行検証器 `scripts/deploy/validate-expand-only-migrations.py` は変更しない。列は `ALTER TABLE "ClientDevice" ADD COLUMN "procedureBoardEnabled" BOOLEAN;` の1文で追加する。過去migrationは変更しない。新テーブルの制約はCREATE TABLE内に書き、既存表へ外部キーを追加するALTER文は生成しない。

テーブル定義は次を実装する。PrismaではJSONBをJson、TIMESTAMP(3)をDateTime、TEXTをStringへ対応させ、createdAtにnow、updatedAtに@updatedAtを設定する。ボードのprocedureIdへuniqueを置き、KnowledgeProcedure側に逆参照を加える。新表の外部キーはON DELETE RESTRICTとし、履歴を自動削除しない。

    ClientDeviceへの追加:
      procedureBoardEnabled BOOLEAN   -- null許容。null/false は無効

    KnowledgeProcedureBoard:
      id TEXT PRIMARY KEY
      procedureId TEXT NOT NULL UNIQUE REFERENCES KnowledgeProcedure(id)
      layout JSONB NOT NULL
      decisions JSONB NOT NULL DEFAULT '{}'
      version INTEGER NOT NULL DEFAULT 1
      materialFingerprint TEXT NOT NULL
      lastRequestedClientDeviceId TEXT NOT NULL
      trialStartedAt TIMESTAMP(3) NULL
      createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      updatedAt TIMESTAMP(3) NOT NULL
      CHECK(version >= 1)

    KnowledgeProcedureBoardEvent:
      id TEXT PRIMARY KEY                       -- 端末生成UUID、再送の重複防止
      boardId TEXT NOT NULL REFERENCES KnowledgeProcedureBoard(id)
      boardVersion INTEGER NOT NULL
      type TEXT NOT NULL                        -- 下記の操作種別をZodで限定
      dedupeKey TEXT NULL UNIQUE                -- 表示はshow:<提案セットID>:<提案ID>
      clientDeviceId TEXT NOT NULL              -- 認証から設定、入力値は不可
      occurredAt TIMESTAMP(3) NOT NULL           -- APIが受理した時刻
      payload JSONB NOT NULL                    -- itemId/materialId/提案ID/前後位置等
      INDEX(boardId, occurredAt)
      INDEX(boardId, boardVersion)

`decisions` は拒否した提案の素材IDと素材fingerprint、拒否見出し、食い違いの選択（2素材IDと選択素材IDまたはnull）を保持するJSONで、サービス側の専用Zodで検証する。素材が更新されたときだけその素材の拒否を再検討できるようにする。採用済みゴーストはlayoutに通常項目として入り、未決定の食い違いはnullを保つ。端末IDは秘密のclient key自体ではなくDBのidを保存する。

素材fingerprintは案件のassigned素材のid、source内容、updatedAtを安定順にハッシュ化する値である。`ProcedureWorker` の40件制限を盤面へ流用しない。素材一覧はcreatedAtとidの順で100件ずつcursor取得し、全件を棚へ表示できるようにする。AIへ渡す未配置候補は直近40件までとし、残りも手で配置できる。確定項目は全600件まで文脈へ含め、入力上限を超える場合は切捨てず提案を延期・エラー表示する。

認証はすべての盤面用ルートで `requireKioskClientDevice` と `requireProcedureBoardEnabled` を順に呼び、`HERMES_KNOWLEDGE_ENABLED` も確認する。無キー・不正キーは既存関数の401、正しい無効端末は403 `PROCEDURE_BOARD_FORBIDDEN`。管理JWTだけでは盤面を操作できない。capabilityを読む既存 `GET /api/mobile-placement/client-capabilities` は無効端末にも200を返し、`procedureBoardEnabled:false` を追加する。これは入口の非表示判断に必要な既存能力照会であり、盤面操作APIの例外を増やすものではない。

APIの完全なパスとJSON契約は以下に固定する。`{layout}` などの表記は直前の具体例と同じJSONオブジェクトを差し込む位置を表す。

    PUT /api/clients/device-1                 管理者・管理者相当の既存権限
    request:  {"procedureBoardEnabled":true}
    response: {"client":{"id":"device-1","procedureBoardEnabled":true}}
    GET /api/mobile-placement/client-capabilities
    request body: なし
    response: {"shelfLayoutEditEnabled":false,"haizenEdgeEnabled":false,"procedureBoardEnabled":true}

    GET /api/kiosk/procedure-boards/procedures?cursor=topic-0&limit=100
    request body: なし
    response: {"procedures":[{"procedureId":"topic-1","title":"技能検定の申込み","boardId":null}],"nextCursor":null}

    POST /api/kiosk/procedure-boards/topic-1
    request:  {}
    response (201、再送は200): {"boardId":"board-1","procedureId":"topic-1","version":1,"layout":{"formatVersion":1,"pages":[{"page":1,"heading":"","rows":[]},{"page":2,"heading":"","rows":[]},{"page":3,"heading":"","rows":[]}]}}

    GET /api/kiosk/procedure-boards/topic-1/materials?limit=100
    request body: なし
    response: {"materials":[{"materialId":"mat-memo","createdAt":"2026-11-01T00:00:00Z","text":"受検料を確認する","images":[],"pdf":null}],"nextCursor":null,"materialFingerprint":"sha256..."}

    GET /api/kiosk/procedure-boards/topic-1
    request body: なし
    response: {"boardId":"board-1","version":1,"layout":{layout},"decisions":{"dismissedPlacements":[],"dismissedHeadings":[],"conflicts":[]},"materialFingerprint":"sha256...","ai":{"status":"unavailable"},"stats":{"accepted":0,"modified":0,"manual":0}}

    PUT /api/kiosk/procedure-boards/topic-1
    request:  {"expectedVersion":1,"layout":{layout},"event":{"id":"00000000-0000-4000-8000-000000000010","type":"material_placed","payload":{"materialId":"mat-memo","itemId":"00000000-0000-4000-8000-000000000001","to":{"page":1,"row":0,"col":0,"index":0},"workId":"00000000-0000-4000-8000-000000000020","activeMs":4200}}}
    response: {"boardId":"board-1","version":2,"layout":{layout},"ai":{"status":"unavailable"},"stats":{"accepted":0,"modified":0,"manual":1}}
    conflict (409): {"statusCode":409,"code":"PROCEDURE_BOARD_VERSION_CONFLICT","currentVersion":2}

    POST /api/kiosk/procedure-boards/topic-1/events
    request:  {"boardVersion":2,"events":[{"id":"00000000-0000-4000-8000-000000000011","type":"material_work","payload":{"materialId":"mat-memo","workId":"00000000-0000-4000-8000-000000000020","activeMs":4200,"completed":true}}]}
    response: {"recorded":1,"duplicates":0}

    GET /api/kiosk/procedure-boards/topic-1/metrics?trialStart=2026-11-01T00%3A00%3A00%2B09%3A00&weeks=4
    request body: なし
    response: {"timezone":"Asia/Tokyo","weeks":[{"week":1,"displayedPlacements":10,"accepted":6,"acceptanceRate":0.6,"modified":3,"manual":2,"handledMaterials":8,"activeMs":240000,"msPerMaterial":30000,"incompleteWork":1,"unsupportedAdditions":0}]}

指標の `trialStart` はboard.trialStartedAtと一致させ、週境界を試験開始から7日ごとに固定する。開始設定は `PUT /api/kiosk/procedure-boards/topic-1/trial`、入力 `{"expectedVersion":2,"startedAt":"2026-11-01T00:00:00+09:00"}`、応答 `{"version":3,"trialStartedAt":"2026-10-31T15:00:00Z"}`。初回だけ設定可能とし、開始後の変更は409。試験開始前のデモイベントを集計へ混ぜない。

写真・PDFページは新規 `GET /api/kiosk/procedure-boards/topic-1/materials/mat-photo/images/<imageId>` で画像bytesを返す。JSON要求本文はなく、成功200のContent-Typeはimage/jpeg、他案件の画像IDは404。素材のsource.imagesにあるIDだけを解決し、ストレージキーを任意入力させない。PDFのページ画像も既存importerのsource.imagesを使い、pdf.pageNumberを表示する。チャットの公開revision用画像ルートは使わない。

保存は正規化・素材検証・現在version付きupdateMany・イベント追記を1トランザクションにする。イベント種別と実際のlayout差分を照合し、採用・移動を偽装した指標加算を拒否する。保存イベントID再送で同一盤面・端末・layoutハッシュなら現在の盤面を返し、不一致なら409。新規盤面POSTもprocedureIdのuniqueで一度だけ作る。空盤面のGETを勝手な作成にはしない。

イベント種別は `placement_shown`、`placement_accepted`、`placement_dismissed`、`ghost_relocated`、`material_placed`、`item_moved`、`item_removed`、`text_edited`、`text_created`、`item_duplicated`、`columns_resized`、`heading_accepted`、`heading_dismissed`、`conflict_selected`、`format_requested`、`format_accepted`、`format_reverted`、`material_work`、`addition_audited` とする。layoutまたはdecisionsを変える操作は保存API（PR2の提案判断を含む）へ記録を同梱し、events APIで状態変更の代用はさせない。events APIは表示・時間・監査の追記だけを許す。作成時刻はサーバー時刻、payloadの時刻があれば参考値として区別する。

採用は `placement_accepted` で提案座標へそのまま置いた件数、手で配置は提案が表示されていない素材の `material_placed`、修正は `placement_dismissed` / `ghost_relocated` / 配置後の `item_moved` / 内容が変わった `text_edited` を各操作1件とする。盤面から外す `item_removed` も配置後の修正として数える。同じ位置へのdrop、入力取消、幅変更、直接テキスト作成、複製、見出し採用、整形採用・戻すは独立ログだけとし、この3数字へ混ぜない。

表示数は「実際に開いているページの表示領域内で描画した、提案セットID＋提案ID」の重複なし件数で、poll・再読込・別端末で同じ提案を再描画しても増やさない。既存ブラウザーのIntersectionObserverで可視領域を確認し、閉じたペインやスクロール外は表示に数えない。表示用dedupeKeyのuniqueで同時送信も1件にする。他操作のdedupeKeyはnullとする。採用率は表示した提案を基準とする週の集合に対する、その集合の採用件数/表示件数とする。採用が翌週でも表示週へ帰属させるため、過去週の率は追跡期間中に更新される。上辺は試験開始以降の累計の同じ定義で返す。分母0ならrate=nullとする。

素材1件あたり時間は、その週に完了した素材操作の前面作業時間の合計/異なるmaterialIdの件数と定義する。素材へ触れた時、またはそのゴーストを確認し始めた時から計時し、配置・移動・編集・提案判断の保存成功までを1作業区間とする。画面非表示と60秒超の無操作時間は除外し、AI待ち中でも前面で確認を続ける時間は含む。`workId` ごとに累積activeMsを `material_work` として10秒ごと・非表示時・完了時に追記し、集計は最大値だけを使う。操作保存にも同じworkId/activeMsを入れ、送信失敗による計時欠落を減らす。中断区間はincompleteWorkとして別表示する。直接テキスト・複製作業は素材時間の母数に混ぜない。閲覧だけの時間、素材到着から数日待った時間とは区別し、この定義を試験の週次記録にも書く。

週をまたぐ作業区間は境界で分け、クライアント値は有限・0〜24時間、サーバー受理間隔と矛盾しない累積値かを検証する。社員IDやキーは受け取らない。数値・手順の書き足しは人の監査結果を `addition_audited` の `{"suggestionSetId":"ai-1","unsupportedCount":0}` として追記し、同じ対象の最新監査だけを集計する。未監査件数も応答へ加え、未監査を0件と解釈しない。

### PR2: 置き場所と「AIで整える」を非同期で提案する

PR2終了時には画面なしでも、保存後の提案をpollで取得でき、429/503や再起動後も延期から復帰できる。整形は押下要求がある場合だけ生成し、明示採用までlayoutを変えない。PR1の保存機能はAI停止中にも動く。

新規ファイルは `apps/api/prisma/migrations/20261101091000_add_knowledge_procedure_board_ai/migration.sql`、`apps/api/src/services/knowledge/procedure-board-inference.ts`、`apps/api/src/services/knowledge/procedure-board-worker.ts`、`apps/api/src/services/knowledge/__tests__/procedure-board-inference.test.ts`、`apps/api/src/services/knowledge/__tests__/procedure-board-worker.test.ts` とする。既存変更は `apps/api/prisma/schema.prisma`、`apps/api/src/services/knowledge/prisma-procedure-board.repository.ts`、`apps/api/src/services/knowledge/procedure-board.service.ts`、`apps/api/src/services/knowledge/knowledge-runtime.ts`、`apps/api/src/bootstrap/start-post-listen-schedulers.ts`、`apps/api/src/bootstrap/__tests__/start-post-listen-schedulers.test.ts`、`apps/api/src/routes/kiosk-procedure-boards.ts` とPR1のルート・repositoryテストに限定する。schedulerの既存グループ名を保ち、新workerも起動・停止と失敗時の停止対象に入ることを確認する。

新表を次の定義で加える。state/kindは新表内CHECKとZodの両方で限定し、索引・外部キーは新表内に置く。PR1の表は変更しない。

    KnowledgeProcedureBoardAi:
      id TEXT PRIMARY KEY
      boardId TEXT NOT NULL REFERENCES KnowledgeProcedureBoard(id)
      boardVersion INTEGER NOT NULL
      kind TEXT NOT NULL                        -- placement | format
      requestKey TEXT NOT NULL                  -- 自動はversion、整形は要求UUID
      requestedByClientDeviceId TEXT NOT NULL
      state TEXT NOT NULL DEFAULT 'pending'     -- pending/running/ready/deferred/failed/stale/accepted/reverted
      input JSONB NOT NULL                      -- 対象versionのlayout・素材・decisions
      result JSONB NULL
      attempts INTEGER NOT NULL DEFAULT 0
      retryAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      leaseToken TEXT NULL
      leaseUntil TIMESTAMP(3) NULL
      errorCode TEXT NULL
      createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      updatedAt TIMESTAMP(3) NOT NULL
      UNIQUE(boardId, kind, requestKey)
      INDEX(state, retryAt, createdAt)
      INDEX(boardId, boardVersion, kind)

保存トランザクション内でplacement仕事を作り、version更新時に古い未確定仕事をstaleにする。提案表示イベントの追記はversionを変えず、再推論の連鎖を起こさない。素材の追加・割当変更は、盤面GET時とworkerの巡回時にfingerprintを比較し、差があればlayoutを保持したままversionを1増やして仕事を作る。PR1で作られた盤面に現行versionの仕事がまだない場合も、巡回で一度だけ補う。元素材の変更を検知してもoverrideを消さない。参照から外れた素材は保存時に新規参照を拒否し、既存項目は欠落状態を示して人が外せるようにし、別案件の内容を配信しない。

新workerは5秒tick・同時1件・DBの期限付きleaseで取り出す。jobの要求端末が無効なら推論を実行せず延期し、有効な端末の新操作で要求端末を更新できる。終了時はAbortControllerで停止する。`TextCompletionPort` の呼出しを次のように固定する。

    text.complete({
      useCase: 'business_hermes', background: true, jsonOutput: true,
      temperature: 0, enableThinking: false, maxTokens: 4000, signal,
      messages: [{role:'system', content:instruction}, {role:'user', content:JSON.stringify(input)}]
    })

入力には素材の原文・画像説明・PDFページ情報、すべての確定配置・override・見出し・拒否・食い違いの人の判断を渡す。画像説明と既存AIのorganized要約は原文と区別し、原文の確定事実として引用しない。素材内の指示はデータとして扱う。新規本文・数値・手順は生成させず、抜けは「未確認の問い」の短文だけにする。新しい数値を含む見出し/抜け、他素材にない具体手順を断定する出力は拒否し、人の監査対象にも含める。

置き場所提案の応答例は次の形とし、`placements` / `headings` / `gaps` / `conflicts` をZodのstrict objectで検証する。上限はそれぞれ4 / 3 / 6 / 10件とする。

    {"placements":[{"id":"p1","materialId":"mat-photo","page":1,"row":0,"col":1,"index":0,"mode":"col"}],
     "headings":[{"id":"h1","page":1,"text":"受検の準備"}],
     "gaps":[{"id":"g1","page":2,"row":1,"col":0,"index":0,"mode":"row","text":"払い込み方法は確認済みですか"}],
     "conflicts":[{"id":"c1","materialIds":["mat-fee-a","mat-fee-b"],"quotes":["18,200円","17,900円"]}]}

materialIdが存在しない・別案件・配置済みならその配置提案を捨てる。確定項目の移動・編集フィールドはschemaで拒否する。modeごとに座標を検証し、colなら現在列数未満3、index=0、rowならcol=index=0、inなら対象列内の挿入範囲内とする。conflictsの2素材は異なり、quotesが各source.textに含まれることを照合する。画像しか根拠がなく確認不能な数値は断定せず未確認に残す。見出しがあるページへ上書き提案を出さない。

claim時と完了保存時にversionとfingerprintを比較する。遅れて返った旧versionはstaleとして保存し、現行結果へ昇格しない。leaseTokenが一致するworkerだけ完了できる。deferredや429/503はretryAtを30秒、60秒、120秒…最大5分へ延ばし、恒久失敗と区別する。プロセス停止・期限切れleaseは回収できる。JSON不正やZod違反はfailedとし同一入力を自動で無限再試行しない。次versionまたは整形の新しい明示要求で新仕事を作れる。

APIを次の形で加える。AIのHTTP要求は推論完了を待たない。

    GET /api/kiosk/procedure-boards/topic-1/suggestions
    request body: なし
    response: {"boardVersion":7,"status":"ready","current":{"id":"ai-7","boardVersion":7,"placements":[{"id":"p1","materialId":"mat-photo","page":1,"row":0,"col":1,"index":0,"mode":"col"}],"headings":[],"gaps":[],"conflicts":[]},"previous":null,"pollAfterMs":5000}
    deferred例: {"boardVersion":8,"status":"deferred","current":null,"previous":{"id":"ai-7","boardVersion":7,"stale":true,"placements":[]},"pollAfterMs":10000}

    POST /api/kiosk/procedure-boards/topic-1/suggestions/ai-7/decisions
    request:  {"expectedVersion":7,"eventId":"00000000-0000-4000-8000-000000000030","proposalId":"p1","action":"accept","itemId":"00000000-0000-4000-8000-000000000003","workId":"00000000-0000-4000-8000-000000000020","activeMs":8000}
    response: {"version":8,"layout":{layout},"stats":{"accepted":1,"modified":0,"manual":0}}

`action` はaccept / dismiss / relocate / select_conflict。relocateでは `target:{page,row,col,index,mode}` を加え、異なる場所への配置を `ghost_relocated` として記録する。select_conflictでは `selectedMaterialId` を加える。見出し案の採用もproposalIdで区別し、headings用の記録を残す。食い違いの選択は盤面decisionsだけを変え、素材の原文やどちらかの値を消さない。提案を外すと素材は棚へ戻り、同じ素材fingerprintでは再提案しない。外した後に手で配置することは可能。staleの採用は409 `PROCEDURE_BOARD_SUGGESTION_STALE`。表示記録はPR1のevents APIへ `placement_shown` とsuggestionSetId/proposalIdを送る。採用前に表示記録が確定するよう送信を直列化する。

整形のモデル出力は内容を持たず、ページごとの `rows:[{cols:[{itemIds:[...]}],w:[...]}]` と `styles:[{itemId,style}]` だけとする。元ページごとにitemIdの集合と個数が完全一致し、項目の文章・override・origin・素材参照・ページ帰属・見出しを変えないことをコードで保証する。固定styleはheading / subheading / body / caution / key-number / figure。4列、任意hex、任意CSS、未知style、項目の追加・欠落・重複はfailedである。

    POST /api/kiosk/procedure-boards/topic-1/format-proposals
    request:  {"expectedVersion":8,"requestId":"00000000-0000-4000-8000-000000000040"}
    response (202): {"proposalId":"fmt-8","boardVersion":8,"status":"pending","pollAfterMs":5000}

    GET /api/kiosk/procedure-boards/topic-1/format-proposals/fmt-8
    request body: なし
    response: {"proposalId":"fmt-8","boardVersion":8,"status":"ready","result":{"pages":[{"page":1,"rows":[{"cols":[{"itemIds":["00000000-0000-4000-8000-000000000001"]},{"itemIds":["00000000-0000-4000-8000-000000000002"]}],"w":[0.67,0.33]}]},{"page":2,"rows":[]},{"page":3,"rows":[]}],"styles":[{"itemId":"00000000-0000-4000-8000-000000000001","style":"key-number"},{"itemId":"00000000-0000-4000-8000-000000000002","style":"figure"}]}}

    POST /api/kiosk/procedure-boards/topic-1/format-proposals/fmt-8/decision
    request:  {"expectedVersion":8,"eventId":"00000000-0000-4000-8000-000000000041","action":"accept"}
    response: {"version":9,"proposalId":"fmt-8","state":"accepted","layout":{layout}}
    戻すrequest: {"expectedVersion":8,"eventId":"00000000-0000-4000-8000-000000000042","action":"revert"}
    戻すresponse: {"version":8,"proposalId":"fmt-8","state":"reverted","layout":{元のlayout}}

プレビュー中に別操作が保存されると提案はstaleになり、採用は409。「戻す」は元layoutを再保存する操作ではなくプレビューを破棄する操作なので、人の新しい変更を巻き戻さない。採用はversion確認・layout変更・記録を1トランザクションで行い、通常の配置提案を新versionで再要求する。

### 軽快さ(ユーザー要求)

ユーザーから「軽く軽快に動くように」と指示があった。PR3はこれを受入条件に含める。

- ドラッグ中は React の盤面全体を再描画しない。pointermove では座標だけを ref に持ち、requestAnimationFrame で1フレーム1回だけ置き場所の枠を更新する。対象の項目とゴーストだけが変わり、他のページや素材は再描画されないように memo とキーを設計する。
- 置く・動かす・書き直す・追加・複製は画面を先に確定し(楽観更新)、保存は後ろで行う。連続した操作は短い間隔(例 300ms)でまとめて1回のPUTにし、操作記録はまとめて送る。保存待ちで入力を止めない。
- AIの提案は待たない。解析中も全操作ができ、新しい提案はポーリングで取りに行く。
- 写真は縮小画像を使い、`loading="lazy"` と大きさ固定で、表示されるときだけ読み込む。原寸は開いたときだけ。
- 新しいライブラリやアニメーションは足さない。影・ぼかし・大きな transition を使わない(Pi4 の GPU が弱いため)。
- 確認: 実機と同じ Pi4 のキオスクで、素材30件・3ページの盤面を使い、ドラッグ中に引っかかりがないこと(DevTools の Performance で長いタスク 50ms 超が続かない)と、置いてから画面に反映されるまで 100ms 以内であることを測り、結果を Artifacts and Notes に残す。

### PR3: 承認済み操作をキオスク画面へ実装する

PR3終了時には有効端末のポータルから案件を選んで盤面を開き、再読込後も配置と文章が残る。無効端末には入口も盤面も出ない。APIの403を受けたら編集を止める。PR3にDB表追加・API追加はなく、PR1/2の契約を利用する。

新規ファイルは `apps/web/src/pages/kiosk/KioskProcedureBoardPage.tsx`、`apps/web/src/features/procedure-board/ProcedureBoard.tsx`、`apps/web/src/features/procedure-board/procedureBoardApi.ts`、`apps/web/src/features/procedure-board/procedureBoardLayout.ts`、`apps/web/src/features/procedure-board/useProcedureBoard.ts`、`apps/web/src/features/procedure-board/procedureBoard.css`、`apps/web/src/features/procedure-board/ProcedureBoard.test.tsx`、`apps/web/src/features/procedure-board/procedureBoardLayout.test.ts`、`apps/web/src/features/procedure-board/useProcedureBoard.test.ts` とする。変更する既存ファイルは `apps/web/src/App.tsx`、`apps/web/src/pages/kiosk/KioskPortalPage.tsx`。ポータルの表示条件テストは `apps/web/src/pages/kiosk/KioskPortalPage.procedure-board.test.tsx` を新設する。

`/kiosk/procedure-board` を案件選択、`/kiosk/procedure-board/:procedureId` を盤面ルートとして登録する。新規カードは既存ポータルのカードと同じ外観で端末capabilityと既存ナレッジenabledの両方がtrueのときだけ表示する。案件選択ではPR1の案件一覧を使い、最初に開く際だけPOSTで盤面を作る。素材棚を別途作成・複製する機能は加えない。

画面は上辺のメニューバー、左の素材ペイン、右の3ページを基本とする。1920×1080を基準にKioskLayoutのヘッダーを含む高さへ収め、各ペイン内部でスクロールする。モックは素材幅380px、閉じた帯40px、残るページが等分だったので初期値を踏襲し、文字の16px化であふれる場合は紙面の内部スクロールで扱う。狭い画面では1列で並び、本文を縮めない。

素材は日付、種類アイコン、縮小画像、原文を表示する。棚の本文は編集しない。通常項目は選択し、文章へ触れるとその場編集する。Enterまたは外側クリックで確定、Escで取消、IME変換中のEnterは確定操作にしない。編集中のdraftはpollで上書きしない。素材編集はoverride、直接テキスト編集はtextに保存する。表示用テキストをHTMLとして解釈しない。

ドラッグは6px以上の移動で開始し、pointer captureとrequestAnimationFrameを使う。素材の左22%・右22%へ落とすと横列、上下へ落とすと上/下の行、すでに段組みなら列内の上/下へ挿入する。最大3列では左右端による追加を出さない。置く場所は青い実線の枠で示し、AI提案の点線と形でも区別する。盤面内移動は元itemIdだけを除いて座標を計算する。閉じたページの帯へ落とすとそのページ末尾へ置く。盤面から素材棚へ戻すと参照だけを外す。直接テキストを外す場合も盤面項目だけを削除する。

列境界をドラッグすると隣接2列の合計幅を保って幅比を変える。ゴーストや空き枠だけの表示には保存用の幅ハンドルを付けない。保存はpointerupで1回、pointercancelは元状態へ戻す。途中のpointermoveごとにversionやイベントを増やさない。ペイン閉鎖は細い縦帯になり、帯を触ると再開する。開閉と選択は端末ローカル状態で、盤面versionに含めない。

上辺の「タイトル」「サブタイトル」「本文」は選択項目の直下（同じ列内、正規化後も順序維持）へ新規テキストを挿入し、その場編集を始める。「複製」は選択中の確定項目だけに作用し、同じ列の直後へ新itemIdを入れる。素材ならmaterialIdとoverrideをコピーする。選択なしの複製はdisabled。削除はDeleteキーおよび選択項目の外す操作で行い、元素材削除APIは呼ばない。ゴーストは複製できない。

通常時は提案を点線ゴーストとして表示し、ここに置く/外すのアイコン、見出し案の採用/外す、抜けの点線枠、数値の食い違い2素材を提示する。食い違いのどちらを採るかは初期未選択とし、人が選ぶまで値の優先表示や自動削除をしない。別の場所へゴーストをドラッグしたら採用でなく修正を記録する。解析中は「解析中」と前回の未配置素材の提案を薄く残すが、stale提案の採用アイコンは無効にする。すでに置かれた素材の旧ゴーストは隠す。

pollは既存React Queryで、表示中は5秒、deferredは応答のpollAfterMs（例10秒）を使い、非表示タブは停止する。盤面GETと提案GETのversionが違う場合は盤面を先に再取得する。ドラッグ・列幅変更・本文編集中は新しい結果を保留し、操作完了後に適用する。保存は端末内で直列化し、409では保存していないdraftを保持したまま最新盤面を取得し、人が再操作できるようにする。ネットワーク失敗時に自動で古いlayoutを上書きしない。

「AIで整える」はPOST後も通常操作を止めず、readyになったら盤面にプレビューを重ねる。採用/戻すは同じ上辺へ表示し、採用成功まで正本のlayoutを変更しない。本文・素材・ページ帰属は変えず、決められた段組みとスタイルだけを描く。

`procedureBoard.css` の盤面ルート内だけに、次のCSS変数を埋め込む。コメントに「出典: @digital-go-jp/design-tokens 1.1.9 dist/tokens.css」と書く。既存の全体テーマやpackage.jsonを変更しない。

    blue-50 #e8f1fe; blue-100 #d9e6ff; blue-200 #c5d7fb;
    blue-600 #3460fb; blue-800 #0031d8; blue-900 #0017c1; blue-1000 #00118f;
    solid-gray-50 #f2f2f2; solid-gray-100 #e6e6e6; solid-gray-200 #cccccc;
    solid-gray-420 #949494; solid-gray-536 #767676; solid-gray-600 #666666;
    solid-gray-800 #333333; solid-gray-900 #1a1a1a; white #ffffff; black #000000;
    success-1 = green-600; error-1 = red-800;
    warning-yellow-1 = yellow-700; warning-orange-1 = orange-600;

意味色4色のhexは実装時に同パッケージの `dist/tokens.css` で確認して埋め込む。黄色のフォーカス色も同じ出典のfocus指定を確認し、黒との二重で実装する。薄いgrayを本文や重要枠線に安易に使わず、実際の前景/背景の組合せでコントラストを計算する。headingはblue-900文字と下線、subheadingはblue-800文字、bodyはsolid-gray-900文字、cautionはwarning-orange系左帯と暗い文字、key-numberはblue-50背景、figureは図・写真の枠と説明の固定CSSとする。figureの説明も元素材またはoverrideだけを使う。

紙面はwhiteを基調とし本文16px相当・行間1.5以上、フォントはNoto Sans JPを優先する。端末に実フォントがあるかも表示確認する。外枠・素材欄は既存の `bg-inv-*` / `text-inv-*` 系へ合わせる。色だけで提案/確定/食い違いを区別しない。アイコンにはaria-labelを付け、Tab移動・Enter採用・Esc取消を確認する。キーボード操作では選択項目をSpaceで移動状態にし、矢印で既存のdrop先を選びEnterで確定、Escで取消とし、ドラッグと同じplace関数へ渡す。補助説明文や新しいアニメーションは足さない。

## Concrete Steps

以下は実装段階で使うコマンドであり、計画作成時には実行していない。作業ディレクトリは上記リポジトリルート。Node >=24、pnpm 12.16.1と既存依存が必要で、package.jsonのscript名は現物を確認済みである。最初に差分を確認し既存WIPを保護する。別途Git段階が承認されるまでは、この計画を根拠にlifecycle start、commitやPR作成をしない。

### PR1の検証コマンド

最初に純粋な正規化と指標、HTTP権限を狭く検証し、次に移行とDB競合を確認する。

    pnpm --filter @raspi-system/api test src/services/knowledge/__tests__/procedure-board-layout.test.ts src/services/knowledge/__tests__/procedure-board-metrics.test.ts src/routes/__tests__/kiosk-procedure-boards.test.ts
    pnpm --filter @raspi-system/web test src/pages/admin/ClientsPage.site.test.tsx
    DATABASE_URL=postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test pnpm --filter @raspi-system/api exec prisma validate
    python3 -B -m unittest discover -s scripts/deploy/tests -p test_validate_expand_only_migrations.py

期待結果は対象テストすべてpass、`The schema ... is valid`、Pythonの `OK`、いずれもexit 0。新しいテストが実際に実行されたことを確認し、skipを成功証拠にしない。validatorは変更しないため、既存のvalidatorテストがそのまま通ることだけを確認する。

未commitのSQLはvalidator CLIのcandidate-refでは読めない。ファイル自体を検証するため、ルートで次を実行する（PR2では2番目のmigrationも同じ `validate_sql` へ渡す）。

    python3 -B - <<'PY'
    import importlib.util, pathlib, sys
    p = pathlib.Path('scripts/deploy/validate-expand-only-migrations.py')
    spec = importlib.util.spec_from_file_location('board_gate', p)
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    migration = pathlib.Path('apps/api/prisma/migrations/20261101090000_add_knowledge_procedure_boards/migration.sql')
    m.validate_sql(migration.read_bytes(), str(migration))
    print('board migration SQL: OK')
    PY

期待結果は `board migration SQL: OK`。これはSQL許可規則だけの証拠であり、台帳整合の検証とは区別する。将来commit/PR段階が承認され、不変の候補SHAと対応する適用済み台帳が用意できたら、既存CLIも次の形で1回実行する。`<...>` はその時点の証拠値に置き換え、空台帳で過去migrationまで未適用扱いにしない。

    python3 scripts/deploy/validate-expand-only-migrations.py --repository "$PWD" --base-ref <比較元SHA> --candidate-ref <候補SHA> --applied-checksums /private/tmp/procedure-board-applied-checksums.txt

台帳は `migration_name|checksum` の1行1件で、検証対象環境から取得したものを使う。成功はexit 0、拒否はexit 1と対象SQL/台帳エラー。`--require-all-candidate-applied` は適用後の検証専用で、未適用PRの事前検証には付けない。

DB競合テストは既存 `apps/api/src/services/knowledge/__tests__/knowledge-procedure-repository.local.test.ts` と同じ専用loopback DBだけを使う。通常のDATABASE_URLを引き継がず、テスト本体にも専用URLと `KNOWLEDGE_DATABASE_TEST=1` のガードを置く。専用DBがなければ既存コンテナを消す `scripts/test/start-postgres.sh` は流用せず、空きポート25433を確認して独立コンテナを初回だけ作る。

    docker run --name procedure-board-db-test -e POSTGRES_PASSWORD=disposable-test -e POSTGRES_DB=knowledge_test -p 127.0.0.1:25433:5432 -d pgvector/pgvector:pg18
    docker exec procedure-board-db-test pg_isready -U postgres -d knowledge_test
    DATABASE_URL=postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test pnpm --filter @raspi-system/api exec prisma migrate deploy
    pnpm --filter @raspi-system/api exec prisma generate
    KNOWLEDGE_DATABASE_TEST=1 pnpm --filter @raspi-system/api test src/services/knowledge/__tests__/procedure-board-repository.local.test.ts

既存の同名コンテナ・同ポートがある場合は内容と用途を確認し、新規作成や削除を繰り返さない。期待結果はDB ready、migration成功、同じexpectedVersionを使った2保存のうち1件だけ成功して他方409、イベントは成功側1件だけ、再送でもイベント増加なし。失敗途中のDBをresetしない。

### PR2の検証コマンド

推論portをfakeへ差し替える対象テストから始め、実DGXを呼ばず状態遷移を確認する。

    pnpm --filter @raspi-system/api test src/services/knowledge/__tests__/procedure-board-inference.test.ts src/services/knowledge/__tests__/procedure-board-worker.test.ts src/routes/__tests__/kiosk-procedure-boards.test.ts src/services/knowledge/__tests__/procedure-worker.test.ts src/bootstrap/__tests__/start-post-listen-schedulers.test.ts
    DATABASE_URL=postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test pnpm --filter @raspi-system/api exec prisma validate
    python3 -B -m unittest discover -s scripts/deploy/tests -p test_validate_expand_only_migrations.py

続いて前節の `validate_sql` のmigrationパスを `apps/api/prisma/migrations/20261101091000_add_knowledge_procedure_board_ai/migration.sql` に替えて検証し、専用DBへのmigrate deploy / prisma generate / repository.local.test.tsをPR2の最終差分で実行する。期待結果は全対象pass、schema valid、SQL検証OK、lease失効から再取得可、古い結果はstale、整形戻すではversion/layout不変である。PR1で通った同一入力のコマンドを理由なく再実行しないが、schemaとrepositoryを変更したPR2ではその変更分を再検証する。

### PR3の検証コマンド

    pnpm --filter @raspi-system/web test src/features/procedure-board/procedureBoardLayout.test.ts src/features/procedure-board/ProcedureBoard.test.tsx src/features/procedure-board/useProcedureBoard.test.ts src/pages/kiosk/KioskPortalPage.procedure-board.test.tsx
    pnpm --filter @raspi-system/web exec eslint src/pages/kiosk/KioskProcedureBoardPage.tsx src/features/procedure-board src/pages/kiosk/KioskPortalPage.tsx src/App.tsx
    pnpm --filter @raspi-system/web build
    pnpm kiosk-sop:source-check

期待結果は対象テストpass、対象lintとbuild成功、取説source-checkがfresh。staleなら `.cursor/rules/33-frontend-ui-quality.mdc` に従い、既存取説画面が変わっていない場合だけsource-refresh、変わる場合はgenerateを将来の実装差分として扱う。今回の計画作成では生成しない。PR3ではDB定義を変えないのでprisma validateとexpand-only検証は追加実行不要で、PR1/2の証拠を参照する。

ローカル画面確認は、専用開発DBへ既存アプリ起動に必要な設定を用意したうえで、別ターミナルで次を実行する。既存秘密設定を計画・ログへコピーしない。

    HERMES_KNOWLEDGE_ENABLED=true pnpm --filter @raspi-system/api dev
    pnpm --filter @raspi-system/web dev --host 127.0.0.1

Viteが表示したURLに `/kiosk/procedure-board` を付けて開く。端末のclient keyは既存 `apps/web/src/api/http.ts` の設定機構を使い、URLへ入れない。専用開発端末を管理画面で有効化する。試験用案件へメモ2件、写真1件、PDF1ページを既存投稿から割り当て、下記受入シナリオを確認する。実AIの接続確認は別途許可された開発環境で1回とし、接続不能ならfakeでの契約検証と実モデル未確認を分けて残す。

各PR単体で `.github/workflows/ci.yml` の変更分類に応じた必要checksが通るようにする。ローカル予算はPR1のDB/移行45分、PR2/3は通常20分（DB検証を行うPR2は45分）。失敗再実行は環境要因または関連修正後に1回まで。同一SHA・入力・環境の成功検査を重複させず、無関係な失敗は修正しない。時間上限や必須検査の阻害では証拠と未完了を記録して停止する。

## Validation and Acceptance

PR1の受入は、有効端末だけが空盤面を作れて、素材参照と直接テキストを混在保存できること、別案件素材が400/404、無効端末が403、競合保存が409になることである。正規化テストには空行・空列、1列復元、最大3列、幅境界、同じ素材の複製、異なるitemIdの維持を含める。overrideを保存した後も `KnowledgeProcedureMaterial.source` と `KnowledgeProcedureRevision` の内容・件数が変わらないことを確認する。

指標は固定時刻のfixtureで表示10・採用6→0.6、表示0→null、同じ表示再送→分母不変、翌週採用→表示週へ帰属、見出し採用/幅変更/複製→採用数不変、素材8件・240000ms→30000ms/件を確認する。時間の累積送信を二重合算しないこと、週境界、中断、未監査もテストする。

PR2の受入は、fake推論で未配置素材だけの提案が得られ、配置済み素材の移動提案は捨てられ、同じversionの仕事が重複作成されないことである。version変更中に旧推論を完了させるテスト、deferred→再試行、429/503、壊れたJSON、未知style/hex、任意項目の欠落/重複、lease失効、無効化端末のジョブ停止、数値の食い違いが未決定のまま残るテストを含める。既存 `procedure-worker.test.ts` が通り、盤面保存・整形が既存公開revisionを書かないことを確認する。

PR3の受入は、人が素材を1ページ目へ置くと、次の提案がそのページの内容を手がかりにすることをfake応答の入力検証と実画面で示すことである。写真を文章の横へ置き2列にし、さらに3列まで増やし、4列目が作れないことを確認する。幅を変更し、項目を外して1列へ戻すと項目ごとの行へ戻ること、閉じたページの帯に落とすと末尾へ入ることを確認する。

直接タイトル/サブタイトル/本文を選択項目の直下へ追加し、素材を複製し、片方のoverrideだけを書き直す。再読込後も両方の参照と片方のoverrideが残り、元素材のtextは変わらない。外すと素材が棚に戻る。Enter/外側確定、Esc取消、IME、pointercancel、編集中poll、409、保存失敗を確認する。キーボードでも同じ配置・取消ができる。

提案をそのまま採用、外す、別位置へドラッグ、採用後移動、書き直しを順に行い、上辺とmetrics APIの数字が一致することを確認する。AI待ちを数分に延ばしても通常操作ができ、旧提案が薄く残り、古い採用はできない。「AIで整える」の戻すで元の配置が残り、採用で段組みと固定styleだけが変わる。無効化後は入口が消え、直URLでも素材・盤面が取得できない。

1920×1080で、KioskLayoutを含む全画面、3列紙面、閉じたペイン、フォーカス、整形プレビューの表示を確認して証拠を残す。紙面の本文16px/行間1.5、指定配色、文字4.5:1・枠線/アイコン3:1、黄色+黒フォーカスを実際の組合せで測る。モックの14px/暗い紙面はそのまま使わない。テキスト強調を濃淡だけに頼らず、意味色背景上の文字も基準を満たす。

## Trial Operations

PR1〜3の実装と必要な統合が済み、対象SHAのCI成功を確認した後、別途deploy承認を得て標準手順で反映する。具体的な対象端末とbranch/SHAはユーザーがdeploy時に指定する。対象が決まる前に端末を推測しない。deploy手順の正本は `docs/guides/deployment.md` と `docs/guides/quick-start-deployment.md` であり、実機接続前にその時点の手順を読む。

最初は現場キオスク1台だけを管理画面の端末設定から有効にする。`HERMES_KNOWLEDGE_ENABLED` と素材の既存案件割当を確認し、「技能検定の申込み」案件を開く。管理APIで試験開始日時を固定し、事前デモのイベントを試験集計に入れない。社員タグを盤面操作の条件にしない。日をまたいで投稿されたメモ・写真・PDFページが、同じ案件の素材欄へ到着することを確認する。

4週間、毎週同じ曜日・時刻にmetrics APIで開始週から当週までを取得し、本計画のArtifacts and Notesへ取得日時、対象端末ID、期間、表示数、採用・修正・手配置、採用率、handledMaterials、msPerMaterial、中断数、未監査数、素材にない数値/手順の件数を記録する。週末時点のJSONを要約して残し、後日採用で過去週が更新された場合は取得時点を併記する。作業時間は前述の前面操作時間であり、素材が届いてからの経過日数ではない。

担当者は毎週、AIが出した置き場所・見出し・抜け・食い違い・整形結果を根拠素材と照合し、素材にない数値・手順を追加した件数を監査記録へ送る。抜けの「未確認の問い」を確定手順として扱わない。書き足しが発見された場合はその提案を採用せず、対象・根拠・件数を残す。4週目に未監査が残る場合は安全条件の達成を断言しない。

合否の目安は4週目の採用率60%以上、4週目のmsPerMaterialが1週目の半分以下、4週間全体で素材にない数値・手順の書き足し0件である。分母や時間試料が0なら判定不能とし、0除算や便宜的な合格にしない。件数と素材の難しさの違いも併記し、統計的な効果を断言しない。合否と運用者の判断を記録して、拡大・改善・終了は別途ユーザーが決める。

範囲外は動画・音声、盤面からの公開、社員単位の操作記録、研削・組立の変更である。フローティングチャットの既存手順書、自動再構成・公開、投稿の社員特定も変更しない。

## Idempotence and Recovery

再読込とpollは保存操作にしない。ただし素材fingerprintが変わった場合のversion更新は同じfingerprintにつき1回だけとし、同時pollはversion条件付き更新で競合を防ぐ。各作業要求はUUIDで一度だけ保存し、ネットワーク再送で配置・操作数・推論仕事を増やさない。409は最新を読み直して操作をやり直し、古い全layoutを無条件再送しない。API停止後もDBのjobとleaseから復帰できる。

試験中止や不調時は管理画面で対象端末のフラグをfalseへ戻す。UI入口を隠し、APIで403にし、無効端末の新しい推論を止める。既存素材・既存公開手順書・試験ログは保持する。追加テーブル/列をdropする逆migrationや、元素材書換えによる復旧はしない。整形の「戻す」は未採用プレビューを閉じるだけである。

migrationは専用DBで先に確認し、既存migrationのchecksumを変更しない。適用に失敗した場合は原因とDBの適用台帳を確認し、手で台帳を直したりresetしたりしない。本番の復旧は `docs/runbooks/deploy-status-recovery.md` をその時点で読み、承認済み標準経路で行う。本計画作成では実機接続もDB操作も行っていない。

## Artifacts and Notes

### PR3実装証拠 (2026-11-01)

web内に案件選択と3ページ盤面を実装。素材配置・移動・3列までの段組み・列幅変更・外す・IME対応編集・直接テキスト・複製、AIの点線提案・見出し・食い違い判断・整形プレビューを既存HTTP契約へ接続した。403で編集停止、409でdraftを保持して最新を取得し、通信失敗時は自動書込みを止める。最新から再開しても元draftを別に保持する。

端末capabilityはPR1で拡張済みの `/mobile-placement/client-capabilities`、ナレッジenabledは `/hermes-knowledge/capabilities` を併用する。設定API追加は不要で、API・DB・依存・本番設定は変更していない。承認済みモックの配置と操作を使い、サンプル文言は持ち込まない。色は指定済みDADS値を盤面ルートへ限定した。

実APIのsaveBoardSchemaとvalidateLayoutEventはPUTごとに厳密に1操作を要求する。このため異種操作の一括PUTは行えず、約300msの待機後に各操作を直列PUTする。同一項目の連続編集・同一行の幅変更だけを1操作へまとめる。表示・作業時間の追記イベントはまとめて送る。提案表示はIntersectionObserverで可視のものだけを数え、採用判断の前に直列送信する。pointermoveはrefとrAFによる枠・幅のDOM更新だけを行う。

検証の直近結果: 指定web対象テスト29/30件成功。残る1件は保存後のversion照合で使うGETモックの応答漏れで、fixtureを修正した。再実行上限に達したため、最終差分への追加実行はユーザーの承認待ち。対象eslintは成功、web buildは成功（既存サイズ警告のみ）、kiosk-sop:source-checkはfresh、既存KioskPortalPage.test.tsxは7件成功。build前に既存shelf-layout-core/slip-match-core/part-search-coreのdistを生成した。

指定PATHのpnpm shimは存在しないbin/pnpm.cjsを参照していたため、同じインストールにある12.16.1のpnpm-nativeを一時PATHで利用した。開発サーバーはlisten EPERM、ChromiumはMachPortRendezvousのPermission denied、Computer Useはbrowser access host unavailableで表示検証できなかった。1920×1080の実ブラウザー表示、Pi4の30素材での50ms超タスク・100ms以内反映、実APIでの永続化は未検証。commit/push/PR/merge/deployは実施していない。

### PR2実装証拠 (2026-10-31)

指定の新規5ファイル・既存9ファイルと本計画のProgress/Artifactsだけを変更。開始時はcleanで既存WIPなし。commit/push/branch操作、PR、merge、deploy、実DGX・外部ネットワーク呼出しは未実施。依存定義・既存migration・既存ProcedureWorker・公開revision更新経路は変更していない。

実装判断: 新表だけを追加し、盤面ロック下でversion/fingerprint更新、旧仕事のstale化、現行placement仕事の作成を直列化した。巡回は20盤面ずつ順送り、推論は5秒tickで同時1件。10分の推論timeoutより長い11分leaseを使い、期限とtokenの両方で完了を制限する。延期は30/60/120/240/300秒、JSON/schema不正はfailedで固定する。整形は元ページのitem集合を照合して元項目から再構築し、style以外の内容をモデルから受け取らない。戻すはstale後も現在のlayout/versionを保持する。HTTPはenqueue/pollだけを行い、推論を待たない。

提案座標は各modeの挿入範囲を検証し、不在・配置済み・同一fingerprintで拒否済みの素材を落とす。見出し/抜けの数値は原文だけに照合し、抜けは短い未確認の問いに限定。conflictsは異なる2素材の原文quoteだけを残し、自動選択しない。過去提案も現行素材で再検証して別案件へ移った原文を配信しない。要求/判断UUIDの再送は重複記録しない。scheduler名hermes-knowledgeを保ち、全workerの通常停止・起動失敗時停止・後続グループ失敗時停止を検証した。計画の契約からの変更はない。

検証はすべて `export PATH=/private/tmp/procedure-board-bin:$PATH` 後に実行（時間は概算）。

    pnpm --filter @raspi-system/api test src/services/knowledge/__tests__/procedure-board-inference.test.ts src/services/knowledge/__tests__/procedure-board-worker.test.ts src/routes/__tests__/kiosk-procedure-boards.test.ts src/services/knowledge/__tests__/procedure-worker.test.ts src/bootstrap/__tests__/start-post-listen-schedulers.test.ts
    exit 0、5ファイル42件pass、約17秒。すべてfake推論。初回の座標検証で提案の余分な属性をstrict座標schemaへ渡していた問題を修正済み。

    pnpm --filter @raspi-system/api exec prisma generate
    DATABASE_URL=postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test pnpm --filter @raspi-system/api exec prisma validate
    両方exit 0、Prisma Client 7.10.1生成・schema valid、各約1〜3秒。

    python3 -B -m unittest discover -s scripts/deploy/tests -p test_validate_expand_only_migrations.py
    前述のimportlib手順で20261101091000_add_knowledge_procedure_board_ai/migration.sqlをvalidate_sqlへ渡す
    両方exit 0、既存34件pass（約5秒）・新規SQL検証OK。validatorは変更していない。

    pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit
    exit 0、約1分。最初はworkspace共通パッケージのdist不足で失敗し、既存shared-types/slip-match-core/shelf-layout-core/part-search-coreをbuildして準備した（定義・lockfile変更なし）。次に検出した今回のnull判定を修正し、成功した。

    pnpm --filter @raspi-system/api exec tsc -p /private/tmp/procedure-board-pr2-tests.json
    exit 0、約1分。既存tsconfigをextendsし、変更した5テストと既存Fastify型拡張だけをincludeした一時設定。最初の一時設定にFastify型拡張がなく失敗したため、既存宣言をincludeした。repository.localも型検査済みだがDB実行の証拠ではない。

    pnpm --filter @raspi-system/api exec eslint <変更したTypeScript全12ファイル>
    exit 0、約10秒。最後のrepository/DBテスト追記後はその2ファイルを再確認した。

未実行: 依頼どおりDBのmigrate deployとrepository.localテストはClaude側へ引継ぎ。DBテストには仕事の重複防止、既存盤面作成/保存の競合、lease失効・token fencing、延期の上限、旧version/原文変更時のstale、failedの非再試行、整形の採用/戻す/再送、配置の採用/拒否/移動、見出し・未決定conflict、原文/公開revision不変、参照を外れた素材の扱いを追加した。実モデルの品質とDB上の状態遷移は未確認として区別する。

#### PR2レビュー修正 (2026-10-31)

開始時の未コミットPR2を保持して5点だけ修正。モデル出力のJSON/schema/整形項目検証は専用エラー型でfailedに限定し、DB・接続障害などはdeferredにする。整形要求は既存イベントIDを照合し、P2002時は既存save/appendEvents同様にトランザクションを再実行して、再送は既存提案、別盤面や別イベントとの衝突は409にする。stale整形のrevertは提案version/現在versionのどちらも受け付け、現在layout/versionを返す。無効端末はattempts増分を戻して固定30秒延期。dismiss/select_conflictのitemIdは禁止した。

検証: 指定4ファイル42件pass（約8秒）、追加した整形項目不一致ケースを含むworker単独16件pass（約1秒、他3ファイルと合わせ43件）。build用tsc --noEmitと今回変更したTypeScript 8ファイルのeslintもexit 0（各約15秒以内）。workerテスト追記後は同ファイルのeslintを再実行。repository.localには同時再送・別盤面/既存イベントID衝突・固定30秒/attempts不増・stale後の両versionのrevertとaccept拒否を追加したが、DB実行は指定どおりClaudeへ引継ぎ。apps/web、migration SQL、本番設定、デプロイ関連は今回変更せず、commit/push/branch操作も未実施。

### PR1実装証拠 (2026-10-31)

ローカル実装のみ。commit/push/branch操作、PR作成、merge、deployは未実施。開始時のWIPは未追跡の本ExecPlanだけで、既存本文を保った上でPR1の進捗・判断・証拠を追記した。既存ProcedureWorker、KnowledgeProcedureMaterial.sourceの更新経路、公開revisionの更新経路、移行検証器は変更していない。DBでの不変性・競合・再送確認は下記接続阻害で未検証である。

検証時に通常のpnpm shimが存在しない `pnpm.cjs` を参照して失敗したため、`/private/tmp/procedure-board-bin/pnpm` からインストール済み12.16.1の `bin/pnpm.mjs` を起動した。以下のpnpmコマンドは `PATH=/private/tmp/procedure-board-bin:$PATH` を設定して実行した。最初のoffline installはローカルstoreのtarball不足、通常installはDNS解決不可で失敗し、通常installを中断した。同じPrisma 7.10.1を持つ別worktreeのnode_modulesを当worktreeへコピーし、元worktreeには書き込んでいない。コピーにはReact 18の依存が含まれ、現在のpackage.jsonが指定するReact 19と一致しないため、web全体型検査の証拠にはこの制約がある。依存定義・lockfileは変更していない。

実行コマンドと結果（時間は概算）:

    pnpm --filter @raspi-system/api test src/services/knowledge/__tests__/procedure-board-layout.test.ts src/services/knowledge/__tests__/procedure-board-metrics.test.ts src/routes/__tests__/kiosk-procedure-boards.test.ts
    exit 0、3ファイル16件pass、約0.7秒。追加・修正した最終対象入力で検証した。

    pnpm --filter @raspi-system/web test src/pages/admin/ClientsPage.site.test.tsx
    初回はshared-typesのdist欠落で失敗。workspace package buildもslip-match-coreのtsc実行環境不足で失敗し、中断されたshared-typesのビルド後に最終差分を検証した。
    最終結果はexit 0、7件pass、約1.1秒。

    DATABASE_URL=postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test pnpm --filter @raspi-system/api exec prisma validate
    exit 0、schema valid、約1秒。

    python3 -B -m unittest discover -s scripts/deploy/tests -p test_validate_expand_only_migrations.py
    exit 0、既存34件pass、約4秒。

    前述のimportlib Python手順でvalidate_sqlを直接呼び、新規migration 2本を個別に検証
    exit 0、両方OK。検証器の変更なし。

    pnpm --filter @raspi-system/api exec prisma generate
    exit 0、Prisma Client 7.10.1生成、約1秒。

    docker info --format '{{.ServerVersion}}'
    exit 1、Docker socketへのpermission denied。新規コンテナは作成していない。

    DATABASE_URL=postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test pnpm --filter @raspi-system/api exec prisma migrate deploy
    exit 1、P1001、127.0.0.1:25433へ接続不可。migrationは適用できなかった。

    KNOWLEDGE_DATABASE_TEST=1 pnpm --filter @raspi-system/api test src/services/knowledge/__tests__/procedure-board-repository.local.test.ts
    exit 1、beforeAll/afterAllでconnect EPERM 127.0.0.1:25433。3テストの本体は未実行（成功・skip成功として扱わない）。

    pnpm --filter @raspi-system/api exec tsc --noEmit
    exit 1、既存tsconfigのrootDir=srcとprisma/seed.ts・scripts・vitest.config.tsのincludeが不整合（TS6059）。設定は変更していない。

    pnpm --filter @raspi-system/web exec tsc --noEmit
    exit 1。最初はworkspace dist欠落、準備後はコピー元依存にないslip-match-coreのリンクとReact 18型の不一致による既存ファイルのエラー。変更したClientsPage・clients型/hookにエラーはなかった。全体型検査の成功は主張しない。

    pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json
    初回はコピー元のapi依存にないjszipのリンク欠落で失敗。既存ローカルjszip 3.10.1へのリンクを準備後、exit 0、約20秒。

    pnpm --filter @raspi-system/api exec tsc -p /private/tmp/procedure-board-api-review.json
    pnpm --filter @raspi-system/web exec tsc -p /private/tmp/procedure-board-web-review.json
    上記は一時configで既存tsconfigをextendsし、APIは新規4テスト（その依存として新サービス・ルート）、webは変更した3実装ファイルをincludeした。初回は一時configからのtypes解決先不足、絶対typesパスへ修正後は両方exit 0（約1〜20秒）。リポジトリの型設定は変更していない。

    pnpm --filter @raspi-system/api test src/services/knowledge/__tests__/procedure-worker.test.ts
    exit 0、既存5件pass、約0.2秒。

    pnpm --filter @raspi-system/api exec eslint \
      src/routes/kiosk-procedure-boards.ts src/routes/__tests__/kiosk-procedure-boards.test.ts \
      src/services/knowledge/procedure-board-layout.ts src/services/knowledge/procedure-board.service.ts \
      src/services/knowledge/prisma-procedure-board.repository.ts src/services/knowledge/procedure-board-metrics.ts \
      src/services/knowledge/__tests__/procedure-board-layout.test.ts src/services/knowledge/__tests__/procedure-board-metrics.test.ts \
      src/services/knowledge/__tests__/procedure-board-repository.local.test.ts src/routes/index.ts \
      src/services/knowledge/knowledge-runtime.ts src/services/mobile-placement/client-capabilities.service.ts \
      src/routes/clients/shared.ts src/routes/clients/core.ts src/services/clients/client-telemetry.service.ts
    pnpm --filter @raspi-system/web exec eslint src/api/domains/clients.ts src/api/hooks/clients.ts src/pages/admin/ClientsPage.tsx src/pages/admin/ClientsPage.site.test.tsx
    API/webともexit 0（API約10秒、web約3秒）。対象には追加テストを含む。

    git diff --check
    exit 0。

計画との差分は、上記の端末列migration分離、検証環境によるDB未検証・全体型検査未完了である。PR2のAI worker/整形APIとPR3のキオスク画面は実装していない。DB検証は専用loopback DBへの接続が可能な環境で、指定のmigration適用とlocal testを実行する必要がある。全体型検査は正しい依存を用意し、既存API tsconfigのTS6059を別件として解消してから再確認する。

PR1レビュー修正 (2026-10-31): 表示済み素材の手動配置拒否を削除（指標定義は維持）、表示dedupeKeyへboard.idを追加、幅配列と列数の不一致を400にした。再送判定はlayoutHash列へ移し、統計の取得・計算を保存トランザクション外へ移した。既存表への変更は増やしていない。DBテストのFK順の後片付けは変更していない。

レビュー修正後の検証（`apps/api`、指定PATH使用）:

- `pnpm exec vitest run src/services/knowledge src/routes/__tests__/kiosk-procedure-boards.test.ts`: exit 0、99件pass / 39件skip、約7秒。
- `pnpm exec tsc --noEmit`: exit 2。既存tsconfigのrootDir外includeによるTS6059（prisma/seed.ts、scripts、vitest.config.ts）。依頼外の設定修正は行わず、型検査は未完了。
- 今回変更したTypeScript 5ファイルのeslint: exit 0。
- Prisma Client再生成、変更migrationのexpand-only検証: 成功。検証器のimport方法を修正して再実行した。
- DBテスト: 専用loopbackポート25433に接続できず未実行。手動再配置・最新盤面を返す再送・盤面別表示dedupeのDB回帰テストを追加・更新済み。
- 既存WIPを保持。commit/push/branch操作、PR、merge、deployは未実施。

計画作成時の証拠は、前述の実ファイル参照と移行SQL検証の拒否結果である。アプリの成功ログ、CI成功、PR番号、merge SHA、deploy run IDはまだ存在しない。この欄へ将来、各PRの対象テストのpass要約・schema valid・SQL検証OK・CIと不変SHA、統合状態を短く追記する。承認済みdeploy後には対象端末、run ID、status、recap、health、rollback結果を実施した段階だけ記録する。

週次記録の記入例は形式だけを示す。以下の未計測値を実測として扱わない。

    取得日時: 未実施 / 対象端末: deploy時に決定 / 試験開始: 未設定
    週: 1 / 表示: 未計測 / 採用率: 未計測 / 修正: 未計測 / 手で配置: 未計測
    素材実数: 未計測 / msPerMaterial: 未計測 / 中断: 未計測
    書き足し: 未監査 / 未監査数: 未計測 / 参照version範囲: 未計測

実装完了の証拠と4週間の効果判定は分ける。各停止時はProgressとOutcomesを更新し、未実施段階と保護したWIPを明記する。今回の開始時に未コミット変更はなかった。計画書以外の変更が最後に見つかった場合は本作業へ混ぜず報告する。

## Interfaces and Dependencies

既存のFastify、Prisma、Zod、React、React Queryだけを使う。新規npm依存、汎用ジョブ基盤、組立用ドラッグ部品の改造、共通公開手順書型の変更は行わない。API側のschemaを正本とし、web側 `procedureBoardLayout.ts` には同じJSON契約と正規化を実装して境界例テストで一致を確認する。

`apps/api/src/services/knowledge/procedure-board-layout.ts` では `layoutSchema`、`normalizeLayout(layout): BoardLayout`、`placeItem(layout, item, target): BoardLayout` をexportする。`target` は `{page:number,row:number,col:number,index:number,mode:'row'|'col'|'in'}` とする。

`apps/api/src/services/knowledge/prisma-procedure-board.repository.ts` では `getOrCreate(procedureId, clientDeviceId)`、`save(expectedVersion, layout, event)`、`appendEvents(events)`、`refreshMaterials(procedureId)`、`weeklyMetrics(boardId, trialStart, weeks)` を実装する。PR2で `enqueueAi`、`claimAi(leaseToken)`、`saveAiResult(id, leaseToken, boardVersion, result)`、`deferAi` を追加する。DB書込みと状態遷移をこの境界に置き、推論portはDBへ直接触れない。

`apps/api/src/services/knowledge/procedure-board-inference.ts` では `ProcedureBoardInference` が `TextCompletionPort` を受け取り、`suggest(input, signal): Promise<PlacementResult>` と `format(input, signal): Promise<FormatResult>` を提供する。`apps/api/src/services/knowledge/procedure-board-worker.ts` は `start` / `kick` / `stop` / `tick` を提供し、既存ProcedureWorkerとは別のDB仕事だけを扱う。既存runtimeが同じtext portを注入する。

`apps/web/src/features/procedure-board/procedureBoardApi.ts` は上記HTTP契約を既存 `api` クライアントで包み、client keyは既存機構で付ける。`useProcedureBoard.ts` が保存直列化、poll、編集中の受信保留、version競合、表示・時間記録を扱う。`ProcedureBoard.tsx` が表示と操作、CSSが許可styleの描画を担当する。API認可をUI非表示だけで代替しない。

変更履歴: 2026-10-31、計画書担当が初版を作成した。承認済みの14設計判断とモック操作を実ファイルへ対応させ、移行検証器との食い違い、座標・計測・再送・古い提案の扱いを具体化した。今回の成果物を指定の1ファイルに限定した。

変更履歴: 2026-10-31、実装担当がユーザーのPR1限定実装依頼に基づいてPR1進捗、実装上の判断、ローカル検証結果と未完了の検証を追記した。PR2/PR3・Git操作・統合・本番反映は未実施。
