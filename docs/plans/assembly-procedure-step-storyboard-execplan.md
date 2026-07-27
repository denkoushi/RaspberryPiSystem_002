---
title: 組立手順 仮想ステップ・矩形フォーカス・全体俯瞰 ExecPlan
status: completed
created: 2026-07-26
branch: feat/assembly-procedure-step-storyboard
related:
  - ../decisions/ADR-20260726-assembly-template-procedure-steps.md
  - ./assembly-unified-template-editor-execplan.md
  - ./assembly-crop-shared-marker-followup-execplan.md
---

# 組立手順 仮想ステップ・矩形フォーカス・全体俯瞰 ExecPlan

この文書は `.agent/PLANS.md` に従う living document である。実装中に判明した事実、判断、検証結果を継続して更新する。

## Purpose / Big Picture

組立テンプレートの文書列とは別に、元ページ全体またはページ上の矩形を「独立した表示ステップ」として最大300件並べられるようにする。同じ元画像を再利用し、画像ファイルは複製しない。作業者は手順全体の位置をストーリーボードと文書区間マップで把握しながら、現在の矩形を拡大して確認できる。

丸数字、チェック、矢視は既存の元文書・元ページ・比率座標を正本とする。矩形内のマーカーだけをステップ内座標へ変換して表示する。閲覧自体は作業完了条件にせず、締付と必須チェックの既存ゲートを維持する。

## Progress

- [x] 2026-07-26: `main` を fast-forward 確認し、`feat/assembly-procedure-step-storyboard` を作成した。
- [x] 2026-07-26: 現行の文書列、マーカー参照、テンプレート改版トランザクション、作業画面resolver、画像配信、migration gate、Docker検証手順を調査した。
- [x] 2026-07-26: Expand-only migration、共有幾何、API契約、専用ステップサービス、参照ガードを実装した。
- [x] 2026-07-26: 統合エディタへ仮想ストーリーボード、矩形drag/四隅編集、指示・重要度、保存前マーカー可視性検証を実装した。
- [x] 2026-07-26: 作業画面へ平坦な前後手順、crop表示、全体マップ、ミニマップ、現在丸数字ジャンプ、最大12件LRUを実装した。
- [x] 2026-07-26: Codex同梱Node 24でlint/build、全API/Web test、対象Playwrightを実行した。
- [x] 2026-07-26: 固有名の一時PostgreSQL環境でfresh/upgrade migration、SQL制約、20,100件fixtureのEXPLAIN、関連・全API統合testを実行し、資源の残存0件を確認した。
- [x] 2026-07-26: ADR、INDEX、後継リンク、検証結果、retrospectiveを完成させた。
- [x] 2026-07-26: PR #1094を`main`へsquash mergeし、main push CI、CodeQL、secret scanの成功を確認した。
- [x] 2026-07-26: 標準rolling release run `20260726-125509-839a17`でPi5、Pi4 Kiosk 6台、Pi3 Signage 1台へ本番反映し、全台のrelease identityとmaintenance解除を確認した。
- [x] 2026-07-26: 本番データを変更しない互換API・DB・配信assetのspot checkと、Phase12実機検証`PASS 47 / WARN 0 / FAIL 0`を完了した。

## Surprises & Discoveries

- 現行migration validatorは、新規テーブル内のFK/CHECK/UNIQUEは許可するが、既存テーブルへの `ADD CONSTRAINT` は許可しない。このためステップは独立した新規テーブルとして追加する。
- 組立手順書PDFは取込時に144 DPIのページ画像へ変換され、元PDFは保持されない。crop派生画像を作っても解像度は増えないため、元画像をCSSで仮想的に切り抜く。
- `@tanstack/react-virtual` と比率座標対応のzoom/pan canvasは既に導入済みである。
- 共有の `scripts/test/start-postgres.sh` は固定コンテナ名と固定ポートを使い、同名コンテナを削除する。今回の検証では使用しない。
- Mac既定Nodeは18だが、Codex同梱Node 24を利用できる。
- Codex同梱runtimeの現在のfallback `pnpm` は11系で、既存pnpm 9配置の`node_modules`再構成を要求した。依存を変更せず、同梱Node 24から既存のPrisma/TypeScript/Vitest実体を直接実行して検証する。
- 既存Web test fixtureの作業手順レスポンスには`pages`がなく`pageUrls`だけのものがある。新viewerの旧契約fallbackは既存`getSequenceDocumentPages` adapterを再利用し、両形式を受ける。
- 明示ステップでは、入力文書列の順序を先に既存ルールで拒否すると「ステップ初出順へ正規化する」という新仕様へ到達できない。明示ステップ時だけ主文書先頭の事前強制を外し、検証後に初出順と主手順書を同じトランザクション内で正規化する。
- LRUは取得完了からReactの利用参照取得までに短い空白があり、既存12件がすべて表示中だと新着画像自身を追い出し得た。取得待ちconsumerも保護対象に数え、表示中参照を解放した時点で12件へ収束させる。
- `object-fit: contain` の余白を無視してcropとマーカーを親要素比率で配置すると、縦横比が異なる画像で1px精度を守れない。画像の実寸からcontain領域を算出する共通hookを作り、画像、crop、マーカーを同じ座標枠へ載せた。

## Decision Log

- 2026-07-26: 表示ステップはテンプレート版が所有する新規テーブルとし、既存テンプレートはDBバックフィルせず文書全ページを動的展開する。
- 2026-07-26: マーカーはステップ固有に複製せず元ページで共有する。明示ステップ保存時は全マーカーが少なくとも1ステップで見えることを検証する。
- 2026-07-26: 閲覧履歴・閲覧完了ゲートは追加しない。
- 2026-07-26: 最大ステップ数は300、cropの各辺は元ページ比率2%以上とする。
- 2026-07-26: v1はcrop画像を永続生成せず、可視項目だけを読み込むLRU BlobキャッシュとCSS clipを使う。
- 2026-07-26: 文書ペインの手動順よりステップ列の最初の出現を優先し、保存payloadの文書集合と主手順書をステップ列から導出する。既存の文書移動UIはステップ順を暗黙に変更しない。

## Context and Orientation

テンプレート版の文書集合は `AssemblyTemplateProcedureItem` が所有し、作業セッションはその版を参照する。現在のresolverは文書ごとに全ページを展開し、Web viewerは文書indexとページindexを別々に移動する。マーカーは `AssemblyTemplateBolt` と `AssemblyTemplateCheckItem` に文書ID、ページ番号、0〜1の座標を持つ。

新しい `AssemblyTemplateProcedureStep` はテンプレート版、元文書、元ページ、表示種別、crop矩形、タイトル、指示、重要度、全体順序を持つ。APIは文書レスポンスを残したまま平坦な `steps` を追加する。保存済みステップがない版では、resolverが現在と同じ全ページ列を合成する。

## Plan of Work

1. 共通パッケージへステップ型・上限・crop幾何を追加し、API/Webが同じ変換を使う。
2. Prisma enumとステップテーブルを新規migrationで追加する。既存行と既存migrationは変更しない。
3. ステップの正規化、参照ページ検証、文書集合との整合、マーカー可視性、保存、改版コピー、互換展開を専用サービスへ分離する。
4. 既存テンプレート作成・改版トランザクションへステップ保存を組み込み、既存入力では未保存の互換展開を維持する。
5. Template DTOとwork-session procedure sequence DTOへ `steps` と `stepSource` を追加する。
6. エディタのドラフト状態を文書、ステップ、工程、マーカーに分離し、仮想ストーリーボード、矩形編集、指示インスペクタ、保存前整合検証を追加する。
7. 作業viewerを平坦なステップindexへ変更し、crop変換、ミニマップ、全体マップ、現在丸数字ジャンプを追加する。
8. 組立手順画像の取得を最大12件のLRU/in-flight dedupeに変更し、可視サムネイルと現在＋次だけを取得する。
9. focused/full tests、Playwright、fresh/upgrade migration、SQL制約、EXPLAINを隔離環境で検証し、文書へ結果を記録する。

## Validation and Acceptance

- 共有型、API、WebのlintとbuildはCodex同梱Node 24.14.0で成功した。
- API全testは466ファイル成功・2ファイルskip、2,461件成功・7件skip。隔離DBに向けた組立統合testは30/30件成功した。
- Web全testは307ファイル・1,523件すべて成功した。共有幾何、reducer、crop、マーカー変換、LRUと同時fetch重複排除を含む。
- Playwrightは対象2 spec、17/17件成功した。1366×768、1920×1080、900×900で、複数文書、矩形drag、同一ページ再利用、並べ替え、保存payload、平坦な前後手順、全体マップ、ミニマップ、丸数字jump、横overflowなし、40px以上の操作対象、中央canvas 55%以上、crop内マーカー誤差1 CSS px以内、300ステップ時のDOMカード30件以下を確認した。
- `pgvector/pgvector:pg15` の固有名container/volume/networkと動的localhost portを使用した。全156 migrationのfresh deploy/statusが成功した。
- `origin/main` の全migration適用後に既存テンプレート、文書列、丸数字、チェックを投入し、候補migrationを適用した。前後の既存行snapshotは同一で、ステップ行は0件のままだった。
- 直接SQLで文書参照XOR、非負ページ番号、crop必須/null・範囲・最小幅高、テンプレート内順序一意、テンプレートCASCADE、文書RESTRICTを確認した。
- 20,100件のステップを投入して`ANALYZE`後に`EXPLAIN (ANALYZE, BUFFERS)`を実行し、テンプレート順読込は`AssemblyTemplateProcedureStep_unique_template_sort`、組立手順書参照は`AssemblyTemplateProcedureStep_idx_assembly_document`、Kiosk文書参照は`AssemblyTemplateProcedureStep_idx_kiosk_document`を選択した。実測はいずれも約0.05ms以内だった。
- migration検証は `scripts/deploy/validate-candidate-migrations.sh origin/main HEAD` を通過した。検証終了後、専用labelによるcontainer/volume/network残存は0件だった。

## Production Deployment and Real-device Verification

- PR [#1094](https://github.com/denkoushi/RaspberryPiSystem_002/pull/1094)をsquash mergeした。デプロイ対象の`main` SHAは`37935581fe75e664e60dfaf74675cc96ec51807d`で、main push CI、CodeQL、secret scanはすべて成功した。
- `scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan`で8対象とPi5必須、migration、Kiosk canary holdを確認後、標準rolling releaseをdetach実行した。Run IDは`20260726-125509-839a17`。
- Pi5では候補API/Web imageのbuild、migration `20260726173000_assembly_template_procedure_steps`、inactive slot準備、traffic switch、302秒のstability monitor、cleanupが成功した。API/Webのobserved identityはいずれも対象SHAと一致し`verified`になった。
- Kiosk canary `raspi4-kensaku-stonebase01`のrepository、compiled Web ready ACK、evidence、maintenance解除成功後に残りKioskを承認した。`raspberrypi4`、`raspi4-robodrill01`、`raspi4-fjv60-80`、`raspi4-sessaku-01`、`raspi4-assembly-01`も同じSHAで`verified`になり、maintenanceを解除した。
- 主対象`raspi4-assembly-01`はNFC、barcode、torque-agent、トルクレンチBluetooth HID/udev/fail-closed guard、Kiosk browserの実機ロールを通過した。compiled Web ready verification IDは`ac421a1fd919b7cabe5d69afd1c1deb0`。
- Pi3 `raspberrypi3`はsignage ready ACK、repository identity、`signage-lite`/timerを確認し、同じSHAで`verified`になった。runは`success / completed`、全対象のmaintenanceは解除済み。
- 同一SHAで再度`--print-plan`を実行し、`targets: []`、8台すべて`verified at desired SHA`のno-opを確認した。
- `scripts/deploy/verify-phase12-real.sh`はTailscale実機経路で`PASS 47 / WARN 0 / FAIL 0`。API health、全Kiosk deploy-status、Signage image、認可401、Prisma migration status、fallback 0件、auto-tuning、全Pi4 Kiosk/status-agent、Pi3 signage、`verify-services-real.sh`を含む。
- 本番の組立Kiosk identityで既存テンプレート5件を読み取り、DBバックフィルなしで全件が`stepSource: document_expansion`、`full_page`の`steps`を返すことを確認した。新テーブルは既存行0件、制約10件、索引4件で、既存業務データは変更していない。
- 本番配信chunkに、エディタの`手順指示`、`文書・工程`、`矩形追加`、`全体を一時表示`と、作業画面の`現在の丸数字へ`が含まれることを確認した。Macの自動ブラウザ目視は自己署名証明書を安全に通過できず、Chrome拡張も未導入だったため実施していない。代わりに実機Kioskのcompiled Web ready ACK、配信asset、API互換、サービス状態を証跡とした。productionで明示cropステップを作る操作は業務データを変えるため実施していない。

## Idempotence and Recovery

migrationは新規ファイルのみとし、再適用はPrismaのmigration ledgerに委ねる。テンプレート作成・改版は既存のlineage lockと単一トランザクションを使用し、失敗時は文書列・ステップ・工程・マーカーをすべてrollbackする。

Docker検証資源は実行ごとにUUIDを含む名前とlabelを使う。既存コンテナ・DB・volume・networkを停止、再利用、変更しない。終了処理後に同じlabelの資源が0件であることを確認する。

## Outcomes & Retrospective

テンプレート版は、複数文書の任意ページを全体または複数の矩形として最大300ステップまで任意順で保持できるようになった。各ステップは独立した番号、タイトル、指示、重要度を持つが、画像とマーカーの正本は元ページのままである。cropでは矩形内の丸数字、チェック、矢視だけが同じcontain座標枠へ変換される。

エディタは文書・工程とストーリーボードを分離し、検索、文書区間マップ、仮想リスト、数値移動、複製、矩形作成・四隅編集、ミニマップ、指示インスペクタを提供する。作業画面は文書境界を意識せず前手順・次手順で進み、cropと元ページの位置関係を常に確認できる。画像は派生保存せず、可視サムネイルと現在・次だけを最大12件LRU/in-flight dedupe経由で取得する。

既存テンプレートはDB更新なしで従来の文書順・ページ順に展開され、既存セッションは開始時のテンプレート版を使い続ける。既存`documents`、`procedureItems`、source表示、締付・必須チェックによる完了条件も維持した。

Expand-only migration、fresh/upgrade、SQL制約、索引利用、全API/Web test、対象Playwright、lint/buildは上記の通り完了した。検証用Docker資源は削除済みである。本番デプロイと実機自動検証も完了した。crop画像やPDFの永続生成、印刷再出力、閲覧監査・閲覧必須ゲートは実施していない。
