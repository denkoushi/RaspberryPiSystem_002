---
title: Hermes横断検索の土台（ソース追加の共通口・DB索引・ページ文脈）
tags: [hermes, retrieval, cross-source, knowledge, floating-chat, execplan]
audience: [ai-agent, developer]
last-verified: 2026-10-04
related: [../decisions/ADR-20260923-hermes-cross-source-retrieval.md, ./hermes-cross-source-retrieval-execplan.md, ./hermes-knowledge-procedures-execplan.md, ./hermes-retrieval-accuracy-log.md]
category: plans
update-frequency: high
---

# Hermes横断検索の土台（ソース追加の共通口・DB索引・ページ文脈）

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. この文書はリポジトリ直下の `.agent/PLANS.md` に従って保守する。

## Purpose / Big Picture

いまフローティングChatの「JEV記録」モードは不適合記録1種類だけを検索できる。この計画が終わると、同じChatに「○○の手順書はある？」と聞けば公開済みの手順書が返り、「この品番の不適合と手順書」と聞けば2種類の記録が出典名つきで並ぶ。さらに、組立の作業画面を開いているときにChatへ「この品番の不適合」と聞くだけで、画面上の品番を自動で使って答える。

同時に、3つ目以降のソース（図面、測定、設備稼働）を足すときの手順を「定義ファイル1枚とAPI側の読み出し1本を足すだけ」に固定し、記録件数が今の10倍になっても検索workerのメモリに収まらない事態を避けるために索引をPostgreSQLへ移す。

## Progress

- [x] (2026-10-04 02:30Z) 現状調査と所見。不適合1ソースの検索は実用域、横断の土台（共通アダプタ、外部索引、ページ文脈）は未着手と判定。ユーザーが3段階の提案を承認。
- [x] (2026-10-04 02:45Z) branch `feat/hermes-cross-source-foundation` と worktree を `python3 -m scripts.git_lifecycle.cli start` で作成。
- [x] (2026-10-04 05:01Z) Milestone 1: ソース定義の複数化と2つ目のソース（#1680、Pi5 配布 run 20261004-033605-802983）。配布経路の修正 #1683 の後、維持経路 run 20261004-045601-6a2031 で `HERMES_RETRIEVAL_SOURCES=nonconformity,knowledge_procedure` を有効化。手順書の読込 1 件（本番の公開済み手順書は 1 件で一致）。
- [x] (2026-10-04 04:00Z) Milestone 2 の2つの試作: pg_trgm の候補再現率（移行保留、#1681）と worker のメモリ内訳（本文は小さく、ベクトルと下ごしらえが大きい）。
- [x] (2026-10-04 05:01Z) Milestone 2（改訂）: worker のメモリ報告、ソース別の見える範囲、索引の二重保持の解消（#1685、Pi5 配布 run 20261004-044836-c11c1c）。
- [x] (2026-10-04 05:30Z) Milestone 3: 自主検査画面の品番を Chat に渡す（#1682、Pi5 配布 run 20261004-035811-a39a70）。キオスク実機でユーザーが確認: 不適合質問は従来どおり、「この品番の不適合」は画面の品番で絞られる。
- [x] (2026-10-04 05:30Z) 各マイルストーンの PR → CI → merge → Pi5 デプロイを完了（#1680、#1681、#1682、#1683、#1685）。残る実機確認は、有効化後に手順書の質問が【手順書】付きで返ること。
- [ ] 有効化後のキオスク確認（手順書の質問）と、Pi5 のメモリ値を 1 週間追った上での次の判断（ベクトル量子化、下ごしらえストア縮小）。

- [x] (2026-10-04 03:07Z) Milestone 1 の許可されたローカル実装。ソース登録、公開済み手順書の変換・読み出し、ソース別の検索・表示・値索引、未知ソースの起動拒否、明示設定時だけのリリース変数書き込みを追加。既定の1ソース、1引数の authorizedRecords、answer の引数、bare string[] の candidateIds を維持。
- [x] (2026-10-04 03:07Z) 対象 Node テスト24/24、ソース定義5/5が成功。依存パッケージを既存worktreeから参照する一時コピーで、API対象22/22とlint（エラー0件）が成功。元worktreeには依存リンクを作らず、install・lockfile変更はしていない。
- [x] (2026-10-04 03:30Z) 調整役が依存を入れた worktree で再検証: `node --test retrieval/` 160/160、ソース定義 5/5、API vitest（hermes-search）22/22、API lint エラー0、`tsc -p tsconfig.build.json` のエラー11件はすべて未ビルドの他パッケージ由来で変更ファイルには無し、`git diff --check` 指摘0。Codex 実行時の失敗（listen EPERM、Node 異常終了）はサンドボックス起因で、通常環境では再現しない。
- [ ] (2026-10-04 03:07Z) integrationPending: PR、hermes-retrieval / ci-required のCI、main統合、Pi5デプロイ、キオスク確認、翌朝の夜間実行確認は未実施。複数ソースを自然文から同時選択する計画器の拡張も未実施（今回の変更禁止ファイル）。Milestone 1 全体の完了チェックは残す。

- [x] (2026-10-04 03:35Z) Milestone 3 の許可されたローカル実装。自主検査画面の非空 `instructionPartNumber` を React Provider に登録し、空・アンマウントで消去。JEV記録モードだけが任意 `pageContext` を送信し、API の入れ子の strict zod 検証、service、worker、計画器まで接続。4種類の指示語をコードで判定し、フィルタ／手順書ソースヒントとログ専用 receipt を追加。文脈なしの呼び出しと bare `candidateIds` は維持。
- [x] (2026-10-04 03:35Z) API 対象24/24、Web 対象63/63、Node の計画器・worker 対象40/40が成功。API 型検査は指定の既知11件だけで変更ファイルのエラー0件。待受けを使わない Node テスト139/139も成功。
- [x] (2026-10-04 03:50Z) 調整役が依存入りの worktree で再検証: `node --test retrieval/` 167/167、API vitest（hermes-search）24/24、API lint 0、Web vitest（HermesFloatingChat / HermesPageContext / KioskSelfInspectionPage）63/63、Web lint 0、API/Web の tsc は変更ファイルにエラー無し（既知の未ビルド依存由来のみ）。Codex 実行時の 2 失敗はサンドボックス起因。
- [x] (2026-10-04 03:38Z) API lint / Web lint はエラー0件（Web の import 順序8件を修正後の1回再実行）。git diff --check は指摘0件。変更は指定の17ファイルのみで、開始時の未コミット WIP は無し。
- [ ] (2026-10-04 03:35Z) Milestone 3 の commit、push、PR、main統合、deploy、キオスク実機確認は未実施（今回の依頼はローカル実装のみ）。

- [x] (2026-10-04 04:13Z) Milestone 2（改訂）のローカル実装: worker の起動・corpus 更新応答に小数1桁のメモリとソース別件数を追加し、API の runtime.memory・数値ログ・scope に接続。visibility の必須検証と主体別の計画器入力・検索・表示制限を追加。複数ソースの全体語句索引を生成しない。既存 pageContext 第3引数、principal 無しの全ソース検索、authorizedRecords の1引数、bare candidateIds を維持。
- [x] (2026-10-04 04:13Z) 検証: 対象 Node 29/29、待受けを使う2ファイルを除く retrieval 145/145、ソース定義6/6、API hermes-search 27/27が成功。API lint 指摘0件。API tsc は既知の未ビルド依存由来11件のみで、hermes の変更ファイルにエラー0件。
- [ ] (2026-10-04 04:13Z) Milestone 2 の全体検証・本番確認: 指定の node --test retrieval/ は既存 dense-dgx の localhost listen EPERM 2件と Node 24.3.0 の異常終了で未完了。待受け2ファイルの対象を絞った確認も同じ環境制約で停止。commit / push / PR / merge / deploy は未実施。Pi5 のログ・scope・RSS / p95 と10倍外挿は配布後の確認として残す。既存 prototypes と本計画の先行更新は保持。

## Surprises & Discoveries

- Observation: 2026-10-04 時点で `hermes-source-catalog/v1` は複数エントリを受け付ける形（`catalogEntries`）になっているが、呼び出し側は `loadNonconformityCatalog()` の1件固定で、記録行の変換 `recordFromAuthorizedRow` は不適合の列名を直書きしている。
  Evidence: `scripts/hermes-search/retrieval/corpus.mjs` の `TEXT_FIELDS` と `row.kind !== 'nonconformity'`、`worker.mjs` の `loadNonconformityCatalog()` 呼び出し2か所。
- Observation: 計画器（`planner-jev.mjs`）と値索引（`value-index.mjs`）はすでに複数エントリを前提に書かれている。2つ目のソースで実際に壊れるのは corpus、worker の答え整形、API の読み出しの3か所に限られる見込み。

- Observation: KnowledgeProcedureDocumentにはpublishedAtが無く、listPublishedの要約だけが公開日時を持つ。公開日時はrevision.updatedAt由来で、createdAtは公開日ではない。
  Evidence: knowledge-procedure.port.ts、prisma-knowledge-procedure.repository.tsのlistPublished / toDocument。API読み出しで要約のpublishedAtを文書に添え、revisionNumberが変わった行は次回更新へ回す。
- Observation: 現行計画器はvalueIndexを使う通常経路でsourcesを1件に限定する。またdisplayには全ソースの欄、sortにはカタログ先頭の日付欄が入り、手順書だけの計画はそのままだと検証に落ちる。
  Evidence: planner-jev.mjsのplannedSources / display / recentField。実計画器を使う手順書テストで再現し、worker側で選択外の既知表示欄を除き、日付sortを選択ソースの日付欄に合わせた。未知の欄は検証エラーとして残す。
- Observation: 元worktreeにはAPIの依存パッケージが無く、サンドボックスではlocalhost待受けが許可されていない。依存を参照する一時コピーでも指定tsconfigのrootDir設定と既存の型エラーが必須検証を妨げる。
  Evidence: vitest / tsc / eslintの起動エラー、dense-dgx.test.mjsのlisten EPERM、補助型検査と変更前コピーの756件一致。検証ログは/private/tmp側だけに置いた。

- Observation: 自主検査画面は `instructionPartNumber` を持ち、移動票の FHINCD バーコードを「部品番号スキャン」で受け取る。一方、「移動票スキャン」ボタンの既存ハンドラは製造order番号を設定する。
  Evidence: KioskSelfInspectionPage.tsx の handlePartScan / acceptPartScan と handleMovementScan。今回の文脈は依頼どおり instructionPartNumber だけに連動し、既存のスキャン動作は変更しない。
- Observation: ページ由来フィルタを previousPlan に保存すると、指示語のない次の質問でも JEV に画面の値が送られ得る。
  Evidence: worker.mjs の sessionOf / compactPlan と planner-jev.mjs の previous_plan / carried。ページ由来フィルタを次ターン用 plan から外し、同一 session での無指示語テストで値の持ち越しがないことを確認。

- Observation: loadEnrichmentById は既に HERMES_RETRIEVAL_ENRICHMENT_ENABLED が文字列 true のときだけストアを読む。applyEnrichment 自体はストアを読まず、起動・更新経路の呼び出しはこのゲートを通る。
  Evidence: worker.mjs の enrichmentAttachEnabled / loadEnrichmentById / main / replaceCorpus と既存ストア保持テスト。enrichment の実装変更は不要だった。
- Observation: corpus 更新は worker 内で完結し、応答を stdout に送っていなかった。また起動用 loadRetrievalResources も複数ソース全体の語句索引を作っていた。
  Evidence: worker.mjs の main の corpus 分岐と loadRetrievalResources。更新応答の JSON-lines 出力を追加し、起動時の複数ソース全体索引も生成しないことをテストした。

## Decision Log

- Decision: 2つ目のソースは「公開済みの手順書」（`KnowledgeProcedure` の `publishedRevision`）にする。作業指示（`work_instruction`）ではない。
  Rationale: 手順書はChatのナレッジ機能の成果物で、利用者が「手順書を探す」需要がすでにある（手順書計画の Milestone 6 がこの登録を待っている）。公開済みに限ることで承認待ちの草稿が検索に出ることを防ぐ。手順書の本文を社外のJEV（TypeSafe）へ送ることは 2026-09-27 に承認済み。
  Date/Author: 2026-10-04 / Claude（ユーザー承認済みの提案に基づく）
- Decision: 有効なソースの一覧は環境変数 `HERMES_RETRIEVAL_SOURCES`（カンマ区切り、既定は `nonconformity`）で与え、API と worker が同じ値を読む。知らないソース名は起動時にエラーにして止める。
  Rationale: 既定を不適合だけにすれば、デプロイしても設定を変えるまで本番の挙動は変わらない。黙って無視されるフラグは事故になる（T48 の教訓）ので、未知の値は即エラー。
  Date/Author: 2026-10-04 / Claude
- Decision: Milestone 1 では意味検索（DGX埋め込み）は不適合だけに限り、手順書は語句一致だけで検索する。
  Rationale: 埋め込みの一括計算は夜間2時間枠に限られ、手順書の件数は少ない。横断の口を先に固めることが目的で、意味検索の拡張は Milestone 2 の索引移行と一緒に扱う方が二重作業にならない。
  Date/Author: 2026-10-04 / Claude
- Decision: `corpus.mjs` の `authorizedRecords(rows)` は名前と「API行 → 記録」の役割を残し、第2引数（カタログ）を省略したときは従来どおり不適合だけとして動く。
  Rationale: 合成質問の実行器（`flywheel-live.mjs`、精度改善タスク T10 が継続中）がこの関数を1引数で使っている。無変更で動かし続ける。
  Date/Author: 2026-10-04 / Claude（T10 セッションとの合意）

- Decision: 1引数のauthorizedRecordsでは、不適合以外の文字列id行を通過させる従来の契約も保護する。カタログを明示したAPI/worker経路では、無効・未知ソースを除く。結合・会話中の除外はsourceIdとidの組で扱う。
  Rationale: sourceIdの追加以外の1引数互換と、同じidを持つ異なるソースの独立性を両立するため。
  Date/Author: 2026-10-04 / Codex
- Decision: 公開手順書を含む設定では各更新をfull置換とし、既定の不適合のみでは従来のincrementalを維持する。DGX、enrichment付与、APIのenrichment/flywheel夜間入力は不適合だけに限定する。
  Rationale: 公開一覧から消えた手順書を検索結果に残さず、既存の不適合向け処理へ別ソースを渡さないため。
  Date/Author: 2026-10-04 / Codex
- Decision: workerのcreateRetrievalAnsweringに任意のplanner注入を加え、2ソース計画の実行・出典ラベル・bare candidateIdsをテストする。既存のevaluate注入とanswer(question, session, {stageDump})は維持する。
  Rationale: 実計画器は1ソースしか選ばず、planner-jev.mjsは今回変更禁止。手順書1ソースは実計画器のevaluate偽物で確認し、自然文の同時選択は完了扱いにしない。
  Date/Author: 2026-10-04 / Codex
- Decision: ソース追加の4点は、定義JSON、JS登録表、API読取関数とそのソースid登録、表示ラベルとする。Outcomes & Retrospectiveには追記しない。
  Rationale: 今回の文書編集許可はProgress、Surprises & Discoveries、Decision Logの追記だけであり、Outcomesへの4点記載という計画規定よりユーザーの編集境界を優先する。
  Date/Author: 2026-10-04 / Codex

- Decision: Milestone 3 の最初の対象を組立作業画面から自主検査画面 `/kiosk/part-measurement/self-inspection` に変更する。
  Rationale: 組立作業画面は品番を持っていない。自主検査画面には移動票の FHINCD を受け取る instructionPartNumber があり、既存の値でページ文脈を設定・消去できる。ユーザー指定の対象変更を採用し、他画面は変更しない。
  Date/Author: 2026-10-04 / Codex
- Decision: Web → API → worker の任意項目は `pageContext: { path, entity: { kind, value } }` に固定し、計画器へは質問が `/この|現在の|いまの|今の/u` に合致するときだけ `page_context: { kind, value }` を渡す。
  Rationale: 曖昧な context 契約を避け、path は JEV に送らず、文脈使用の判定をモデルに任せない。partNumber / nonconformityNo は対応欄、drawingNumber は手順書欄に使用し、procedureId は手順書ソースの選択ヒントだけにする。receipt.pageContext の used / kind / value は API ログへ残し、キオスク応答から除く。
  Date/Author: 2026-10-04 / Codex
- Decision: ページ由来フィルタは、その質問の receipt.plan に記録し、次ターンの session.previousPlan には持ち越さない。
  Rationale: 指示語がない質問では文脈を JEV にも渡さないという契約を、会話中でも維持する。指示語がある次ターンは現在のページ値を改めて適用する。
  Date/Author: 2026-10-04 / Codex

- Decision: Milestone 2 を「索引を PostgreSQL へ」から「メモリ報告と見える範囲」に改める。本文を持たない設計も採らない。
  Rationale: pg_trgm の再現率は同等と証明できず p95 が約2倍。メモリ計測では本文 2.3MB・正規化本文 4MB に対しベクトル 32MB・下ごしらえ 24MB で、本文除去は 10 倍時でも 23MB しか効かない。まず実機の数字を継続的に取り、ベクトル量子化や下ごしらえ縮小はその数字で判断する。
  Date/Author: 2026-10-04 / Claude

- Decision: service.answer の既存第3引数 pageContext を保ち、第4引数に { principal } を受け取る。worker は要求ごとの可視カタログと値索引を計画器へ渡し、見えないソースを含む保存済み計画は再利用しない。
  Rationale: 既存呼び出しとの互換を保ち、管理者の会話状態が viewer の次の質問へ持ち込まれてもソースの値・出典・表示済み件数を漏らさない。主体なしは既存 CLI とテストの全ソース検索を維持する。
  Date/Author: 2026-10-04 / Codex

## Outcomes & Retrospective

- Milestone 1（2026-10-04、#1680）: ソースを足す手順は4点に収まった。定義 JSON（`hermes-sources/<id>.json`）、`hermes-source-definition.mjs` の登録表、API の読み出し関数（`hermes-search-sources.ts` の登録表）、`source-labels.json` のラベル。配布後の Pi5 は health 200、既定では挙動不変。
- Milestone 3（2026-10-04、#1682）: 最初の対象は自主検査画面（品番）。キオスク実機でユーザーが確認済み（不適合質問は従来どおり、「この品番の不適合」は画面の品番で絞られる）。
- Milestone 2 の試作（2026-10-04、#1681 と #1685）: 上記 Milestone 2 の冒頭に数字を記した。
- Milestone 2（2026-10-04、#1685）: Pi5 実機の worker メモリ（API ログ `hermes retrieval memory`）。配布直後、不適合のみ 8,265 件: heapUsed 134MB、rss 391.2MB、external 129.4MB、arrayBuffers 93.6MB。手順書を有効化して API を作り直した直後、8,266 件: heapUsed 165MB、rss 400.8MB、external 97.7MB、arrayBuffers 94.1MB。Mac の計測（heap 47MB、ArrayBuffer 32.5MB）より heap が約 3 倍、ArrayBuffer が約 3 倍大きい。差分の候補は DGX 埋め込みの実行時バッファ（Mac では `.bin` を読んだだけ）と、質問処理のごみ。rss は `--max-old-space-size=384` の近傍にあり、V8 が上限まで回収を遅らせていると見られる。10 倍への外挿は、この heap 165MB と ArrayBuffer 94MB を基準にすると約 2.6GB で、Pi5 の 8GB（可用 4.7GB）に対して余裕が小さい。次の判断材料として、1 週間分の値を集めてから、ベクトルの Int8 量子化（94MB → 約 24MB）と下ごしらえストアの縮小を別マイルストーンで検討する。
- 手順書ソースの有効化（2026-10-04、維持経路 run 20261004-045601-6a2031）: API env に `HERMES_RETRIEVAL_SOURCES=nonconformity,knowledge_procedure` が 1 行加わり、他の Hermes 設定は不変。手順書の読込 1 件は本番の公開済み手順書 1 件（事務手続き）と一致。

## Context and Orientation

この節は、このリポジトリを初めて読む人向けに現状を説明する。

「Hermes」は業務Pi5（Raspberry Pi 5）で動く社内アシスタントの名前で、Webアプリの全ページに浮かぶチャット窓（フローティングChat、`apps/web/src/components/hermes/HermesFloatingChat.tsx`、`apps/web/src/App.tsx` の末尾でルートの外に置かれている）から使う。Chatには複数のモードがあり、本計画が扱うのは「JEV記録」モードである。このモードは `POST /assembly/hermes-search-trial/answer` に `{question, sessionId}` を送り、答えの文字列と `recordIds`（`不適合:ID` 形式の文字列の配列）を受け取って表示する。ルートは `apps/api/src/routes/assembly/hermes-search-trial.ts` にあり、キオスク端末の共有鍵か、ADMIN/MANAGER/VIEWER のいずれかのJWTで通る。

APIサーバー（Fastify、`apps/api`）は検索の本体を自分では持たず、`apps/api/src/services/assembly/hermes-search-trial.service.ts` の `HermesSearchTrialService` が別プロセスの Node worker を `--max-old-space-size=384` で起動する。worker の入口は `scripts/hermes-search/retrieval/worker.mjs` で、標準入出力で1行JSONをやりとりする。API は 300 秒ごとに「認可済みの読み出し」で全記録を取り、`{type:'corpus', mode:'full'|'incremental', records, asOf}` を worker に流し込む（`refreshCorpus`）。worker は記録を全部メモリに持ち、文字2-gramのBM25索引（`executor.mjs` の `prepareLexicalCorpus`）と、任意でDGXの埋め込みによるベクトル索引を作る。

質問が来ると worker は次の順で動く。まず計画器 `planner-jev.mjs` が JEV（社外LLM、TypeSafe）に質問とカタログと値の候補を渡し、`{sources:[...], filters:[...], semanticQuery, sort, limit, display}` という「検索計画」を得る。次に `executor.mjs` の `execute(plan, {records, lexicalCorpus, vector, ...})` が、計画の filters で記録を絞り、semanticQuery で語句一致（と任意でベクトル）順位をつけ、`relevance-jev.mjs` が上位候補の関連度を JEV に判定させて、最終結果 `results:[{sourceId, recordId, fields}]` を返す。worker の `formatRecords` がそれを「ラベル: 値」の行に整形して答えにする。

「カタログ」はソースごとの欄の宣言である。元データは `scripts/hermes-search/hermes-sources/nonconformity.json`（schema `hermes-source-definition/v1`）で、`scripts/hermes-search/hermes-source-definition.mjs` の `validateSourceDefinition` が検証して `nonconformityDefinition` として export する。`scripts/hermes-search/retrieval/catalog.mjs` の `deriveCatalog(definition)` がそれを `hermes-source-catalog/v1` のエントリ `{id, label, description, valueChoiceCap, fields:[{key,label,role,filterable,enumerated}]}` に変換する。`role` は `identifier`、`date`、`organization`、`facet`、`body` のどれかで、欄名とラベルの形から機械的に決まる（`traitsFor`）。`catalogEntries(catalog)` は1エントリでも配列でも受け付けて配列を返す。計画器と値索引（`value-index.mjs` の `buildValueIndex`）はこの配列を前提に書かれているが、呼び出し側（worker、corpus）は `loadNonconformityCatalog()` の1件固定である。

API 側で記録を読む経路は `apps/api/src/services/assembly/business-hermes-mcp.service.ts` の `readSourcePage(kind, offset)` で、`kind` は `nonconformity` か `work_instruction`、1ページ200行を返す。`HermesSearchTrialService.loadAuthorizedRecords()` はこれを `nonconformity` 固定で回し、`kind:'nonconformity'` の行だけ集める。worker 側の `corpus.mjs` は `recordFromAuthorizedRow(row)` で `row.kind === 'nonconformity'` の行を、直書きの `TEXT_FIELDS` 10個だけ写した記録 `{id, ...}` にする。`authorizedRecords(rows)` はその一括版で、`replaceCorpus` と合成質問の実行器 `flywheel-live.mjs` が使う。

「手順書」は Chat のナレッジ機能が作る文書で、Prisma モデル `KnowledgeProcedure`（`apps/api/prisma/schema.prisma`、`title`、`category`、`partNumber`、`drawingNumber`、`processName`、`publishedRevisionId` を持つ）と `KnowledgeProcedureRevision`（`content` JSON、`state`）からなる。公開済みの手順書は `publishedRevisionId` が非 null の行で、本文の形は `apps/api/src/services/knowledge/procedure-content.ts` の `procedureContentSchema`（`steps:[{id,title,body,cautions,needsReview,photos,sources}]`）に固定されている。読み出しは `apps/api/src/services/knowledge/knowledge-procedure.port.ts` の `KnowledgeProcedureRepositoryPort` の `listPublished()`（要約の一覧）と `getPublished(procedureId)`（1件の全文 `KnowledgeProcedureDocument`）で、実装は `prisma-knowledge-procedure.repository.ts` にある。

本番の切替は環境変数で行う。Pi5 の release 役 `infrastructure/ansible/roles/release_pi5/tasks/hermes-search-trial.yml` が `.env` に `HERMES_RETRIEVAL_V2_ENABLED` などを書き込む。渡されなかった変数は書き換えないので、新しい変数を足すときは同じファイルに書き込み処理を加え、`--print-plan` と実機の `.env` で確認する。

PostgreSQL は `infrastructure/docker/docker-compose.server.yml` のとおり `pgvector/pgvector:pg15` イメージで、`vector` 拡張が使える。日本語の全文検索には標準の `to_tsvector` は使えない（分かち書きしない）ので、文字3-gramの `pg_trgm` 拡張（contrib、同イメージに同梱）を使う。

## Plan of Work

### Milestone 1: ソース定義の複数化と2つ目のソース（公開済み手順書）

このマイルストーンが終わると、`HERMES_RETRIEVAL_SOURCES=nonconformity,knowledge_procedure` を設定したPi5で、Chatの「JEV記録」モードに「ブラケット溶接の手順書」と聞くと公開済み手順書が「手順書名: …」「手順: …」の形で返り、`recordIds` に `knowledge_procedure:<id>` が入る。設定を省いた端末では今までと完全に同じ動きをする。3つ目のソースを足す手順は「定義JSONを1枚置く、`hermes-source-definition.mjs` の登録表に1行足す、API側の読み出しを1本書く、ラベルを1行足す」の4点に限られる。

作業は次のとおり。

ソース定義。`scripts/hermes-search/hermes-sources/knowledge-procedure.json` を `hermes-source-definition/v1` で書く。`id` は `knowledge_procedure`、`description` は「Chatのナレッジ機能で公開された作業手順書」。`metadataFields` は `title`（手順書名）、`category`（分類）、`partNumber`（品番）、`drawingNumber`（図番）、`processName`（工程）、`publishedOn`（公開日）。`bodyFields` は `stepsText`（手順）と `cautionsText`（注意事項）。`recordNumberField` は `title`（手順書に業務番号はないので手順書名を識別子の役にする）。`contextAttributes` は metadata の全キー、`searchMetadataFields` は `title`、`partNumber`、`drawingNumber`、`processName`、`lexicalFields` は metadata と body の全キー。`organizedLabels` は `{step:"手順", caution:"注意事項"}`、`organizedContextClasses` は `["step"]`。`offlineExtraction` は付けない（構造化済みのため）。`hermes-source-definition.mjs` に `knowledgeProcedureDefinition` を同じ検証で export し、`sourceDefinitions`（id → definition の凍結オブジェクト）と `sourceIdsFromEnv(env)`（`HERMES_RETRIEVAL_SOURCES` をカンマで割り、空なら `['nonconformity']`、登録表にない id があれば `Error('unknown retrieval source: <id>')` を投げる）を足す。`retrieval/source-labels.json` に `"knowledge_procedure": "手順書"` を足す。

カタログ。`catalog.mjs` に `loadCatalog(sourceIds)` を足し、登録表から順に `deriveCatalog` した配列を返す。`loadNonconformityCatalog()` は `loadCatalog(['nonconformity'])[0]` を返す互換関数として残す。`traitsFor` の役決めは変えない（`title` は `recordNumberField` なので identifier になる。`publishedOn` は `On` で終わるので date になる）。

記録の変換。`corpus.mjs` の `recordFromAuthorizedRow(row, catalog = loadNonconformityCatalog())` は、`row.kind` と一致する id のカタログエントリを探し、無ければ null、有ればそのエントリの `fields` のキーだけを写し、`{id, sourceId: entry.id, ...}` を返す。`TEXT_FIELDS` の直書きは消す。`authorizedRecords(rows, catalog = loadNonconformityCatalog())` と `replaceCorpus(current, catalog, message)` は同じカタログを渡す。1引数で呼ばれたときの結果が今と同じ（`sourceId` が増える以外）であることをテストで固定する。

worker。`worker.mjs` の `loadRetrievalResources` と `main` は `loadCatalog(sourceIdsFromEnv(env))` を使う。記録に `sourceId` が付くので、`execute` に渡す `records` と `lexicalCorpus` は計画の `plan.sources` に含まれるソースの記録だけに絞る。`buildCorpusView` は `records` 全体に加えて `bySource`（sourceId → `{records, lexicalCorpus}`）を持ち、`valueIndex` は全記録から `buildValueIndex(records, catalog)` で作る（`buildValueIndex` はエントリごとに値を集めるので、`distinctValues` にソースの絞りを足して、他ソースの同名欄の値が混ざらないようにする）。計画の `sources` が2つ以上なら、ソースごとに `execute` を呼び、結果を `sourceId` を付けたまま連結する（順位の融合は Milestone 2 以降。ここでは計画の `sources` の順に並べる）。`formatRecords(results, catalog)` は結果ごとに `result.sourceId` のエントリの欄ラベルを使い、有効なソースが2つ以上のときだけ各記録の先頭に `【手順書】` のように出典ラベルを付ける。`OUT_OF_SCOPE_ANSWER` は有効ソースのラベルを並べた文（例「不適合・手順書の検索に関する質問として解釈できませんでした。」）に変える。`publicRecordId` はすでに `sourceId:recordId` を作るので、`catalogEntries(catalog)[0]?.id` への依存を結果側の `sourceId` に置き換える。DGX 埋め込み（`dense.schedule`、`openOptionalVector`）には不適合の記録だけを渡す。`createRetrievalAnswering(...).answer(question, session, { stageDump })` の引数と `candidateIds` の形は変えない。

API。`hermes-search-trial.service.ts` に、ソース id → 読み出し関数 の登録表を置く。`nonconformity` は今の `readSourcePage('nonconformity', offset)` のページ送り、`knowledge_procedure` は `KnowledgeProcedureRepositoryPort` の `listPublished()` で id を集めて `getPublished(id)` を順に読み、1件を `{kind:'knowledge_procedure', id, title, category, partNumber, drawingNumber, processName, publishedOn, stepsText, cautionsText}` の行にする。`stepsText` は手順を `1. <title>\n<body>` の形で改行2つ区切りに連結し、`cautionsText` は全手順の `cautions` を改行区切りに連結する（空なら空文字）。`publishedOn` は `publishedAt` を `Asia/Tokyo` の `YYYY-MM-DD` にする。この変換は純関数 `knowledgeProcedureRow(document)` として `apps/api/src/services/assembly/hermes-search-sources.ts`（新規）に置き、単体テストを書く。`loadAuthorizedRecords()` は `sourceIdsFromEnv` と同じ規則（API 側に TypeScript で同じ関数を書き、既定と未知 id のエラー文を揃える）で有効ソースを決め、各読み出しの行を連結して返す。未知の id は `start()` が reject し、ルートが 503 とそのメッセージを返す。`searchExactNonconformity` と V2 以外の経路は触らない。

リリース。`hermes-search-trial.yml` に `HERMES_RETRIEVAL_SOURCES` の書き込み（変数 `hermes_retrieval_sources` が渡されたときだけ）を、`HERMES_RETRIEVAL_V2_ENABLED` と同じ形で足す。無効化側（184行付近の `false` 書き込み群）には足さない（ソース一覧は機能の無効化とは独立）。

テスト。`scripts/hermes-search` で `node --test retrieval/` が通ること。追加するのは、`catalog.test.mjs`（新規。2ソースの `loadCatalog`、未知 id のエラー、`loadNonconformityCatalog` の互換）、`corpus.test.mjs`（混在行の変換、1引数呼び出しの互換）、`worker` 相当のテスト（`createRetrievalAnswering` に `evaluate` の偽物を渡し、計画が `sources:['knowledge_procedure']` を返したとき手順書の記録だけが答えに出ること、`sources` が2つのとき両方の記録が出典ラベル付きで出ること）。`apps/api` では `pnpm --filter @raspi-system/api test -- hermes-search` で `knowledgeProcedureRow` と `loadAuthorizedRecords` の2ソース連結（`KnowledgeProcedureRepositoryPort` の偽物を注入）が通ること。

受け入れ。上のテストに加え、PR の CI（`hermes-retrieval`、`ci-required`）が成功し、Pi5 に `HERMES_RETRIEVAL_SOURCES=nonconformity,knowledge_procedure` でデプロイした後、キオスクの Chat で手順書の質問に手順書が返り、不適合の質問は今までどおり返ること。設定を省いた状態では `node --test` の互換テストと、既存の合成質問の夜間実行がエラーなく回ることを翌朝の記録で確認する。

### Milestone 2: worker のメモリを測れるようにし、ソース別の見える範囲を付ける（改訂）

当初の案は索引を PostgreSQL（pg_trgm + pgvector）へ出すことだった。2026-10-04 の2つの試作でこの案は保留にした。第一に、`pg_trgm` の候補再現率は現行の文字2-gram と同等以上の傾向だがラベル付きデータでは同等と証明できず、閾値なしの `ORDER BY similarity` では GIN 索引が使われないため p95 が約2倍になった（`docs/plans/hermes-retrieval-accuracy-log.md` 2026-10-04 の項）。第二に、worker のメモリ内訳を測ったところ（`scripts/hermes-search/retrieval/prototypes/worker-memory-20261004.md`）、不適合 8,209 件で記録本文は 2.3MB、語句一致用の正規化済み本文は 4MB、値索引は 0.1MB しかなく、大きいのは DGX 埋め込みベクトル 32MB（ヒープ外の ArrayBuffer）と下ごしらえ（enrichment）ストア 24MB だった。生きているヒープは 50MB 弱で、Pi5 の RSS 371MB の大半は V8 が上限 384MB まで回収を遅らせている分と見られる。「本文を持たない」設計は 10 倍の件数でも 23MB しか減らないので採らない。

このマイルストーンが終わると、worker が自分のメモリ（heapUsed、rss、external、arrayBuffers、記録件数、ソース別件数）を起動時と記録更新ごとに API へ報告し、API がそれをログと `GET /assembly/hermes-search-trial/scope` の応答に載せる。これで「あと何倍まで入るか」を推測ではなく数字で判断できる。あわせて、ソース定義に `visibility`（そのソースを見てよい主体の一覧。値は `kiosk`、`viewer`、`manager`、`admin`）を持たせ、API が呼び出し主体の種類を worker に渡し、worker は見てよいソースだけを計画器に見せ、結果からも除く。不適合と手順書はどちらも全主体に見せるので今の挙動は変わらないが、ロールを限るソースを足す道ができる。

作業は次のとおり。

メモリ報告。`worker.mjs` の `readyPayload` と `replaceCorpus` の応答に `memory: { heapUsedMb, rssMb, externalMb, arrayBuffersMb, records, bySource: { <sourceId>: count } }` を足す（`process.memoryUsage()` を小数1桁の MB に丸める）。API の `HermesSearchTrialService` はこれを `runtime.memory` に保存し、更新ごとに `console.info('hermes retrieval memory ...')` を1行出す（数値だけ、本文なし）。`scope()` の応答に `memory` を足す。

見える範囲。`hermes-sources/*.json` に `visibility: ["kiosk","viewer","manager","admin"]` を足し、`validateSourceDefinition` で必須・既知の値だけに検証する。`deriveCatalog` はエントリに `visibility` を写す。API のルートは認可の結果から主体の種類を決め（キオスク鍵なら `kiosk`、JWT ならそのロールを小文字に）、worker への `request` に `principal: { kind }` を付ける。worker は `catalogEntries(catalog).filter(entry => entry.visibility.includes(principal.kind))` を計画器のカタログと実行対象に使い、見えないソースは `OUT_OF_SCOPE` の文言にも含めない。`principal` が無い要求（既存のテストや CLI）は全ソースを見る。`fixtures/` に `visibility: ["admin"]` の合成ソースを置き、`viewer` では結果に出ず `admin` では出るテストを書く。

メモリの衛生。複数ソースのとき `buildCorpusView` が全体の `lexicalCorpus` とソース別の `lexicalCorpus` を二重に持つのをやめ、全体用は作らない（実行はソース別に行うので不要）。`applyEnrichment` で下ごしらえが無効（`HERMES_RETRIEVAL_ENRICHMENT_ENABLED` が true でない）のときはストアを読み込まない（既にそうなっているか確認し、違えば直す）。

受け入れ。`node --test retrieval/` と API の vitest が通ること。Pi5 配布後に API ログに `hermes retrieval memory` の行が出て、`scope` の応答に `memory` があること。その数字を Outcomes に記録し、10 倍への外挿を書き直す。ベクトルの量子化（Float32 → Int8 で 32MB → 8MB）と下ごしらえストアの縮小は、数字を見てから別のマイルストーンとして判断する。

### Milestone 3: ページ文脈の受け渡し

このマイルストーンが終わると、組立の作業画面 `/kiosk/assembly/work-sessions/:sessionId` を開いたまま Chat に「この品番の不適合」と聞くと、画面の品番を使って答える。Chat の送信に `context: {path, entity: {kind:'partNumber', value:'...'}}` を付け、API は zod で `path`（200文字まで）と `entity`（`kind` は `partNumber`、`drawingNumber`、`nonconformityNo`、`procedureId` のいずれか、`value` は 200 文字まで）を厳密に検証し、worker の計画器に「現在の画面: 品番 ○○」という1行の補助情報として渡す。計画器は質問に「この」「現在の」「いまの」が含まれるときだけその値を filters に使う。文脈は答えの `receipt` に記録して、使われたかどうかを後から確かめられるようにする。ページ側は、作業画面がすでに持っている品番を `HermesFloatingChat` に渡すために、`apps/web/src/components/hermes/` に `HermesPageContextProvider`（React context、`setPageContext({path, entity})` と `clearPageContext()`）を足し、作業画面がマウント時に設定し、アンマウント時に消す。他の画面は何も渡さないので挙動は変わらない。

受け入れは、API のテスト（文脈つき質問が `filters` に品番を含む計画になること、「この」を含まない質問では文脈が無視されること、不正な `kind` が 400 になること）、Web のテスト（作業画面を開くと文脈が設定され、離れると消えること）、キオスクでの実機確認（作業画面で「この品番の不適合」→該当記録、ホーム画面で同じ質問→聞き返し）。

## Concrete Steps

作業ディレクトリは `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--hermes-cross-source-foundation`。

検索 worker のテスト:

    cd scripts/hermes-search && node --test retrieval/

API のテスト（対象を絞る）:

    pnpm --filter @raspi-system/api test -- hermes-search

型と lint:

    pnpm --filter @raspi-system/shared-types build && pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json && pnpm --filter @raspi-system/api lint

（worktree を新しく作った直後は `pnpm install --frozen-lockfile` と上の build/generate が要る。tsc は未ビルドの他パッケージ由来のエラーが残るので、変更ファイルにエラーが無いことを確認する。）

Pi5 への反映は `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan` で対象を確認してから、`--limit raspberrypi5` で行う。Milestone 1 ではソース一覧の変数を渡さない（既定のまま）デプロイを先に行い、動作が変わらないことを確かめてから `hermes_retrieval_sources=nonconformity,knowledge_procedure` を渡す2回目のデプロイで有効化する。

## Validation and Acceptance

各マイルストーンの受け入れは本文に書いた。全体としては、Milestone 1 完了時に「ソースを足す手順」を `docs/guides/` ではなく本計画の Outcomes に4点で書き、Milestone 2 完了時に RSS と p95 の数字を、Milestone 3 完了時にキオスクの確認結果を同じ節に残す。

## Idempotence and Recovery

すべての変更はフラグの既定値で無効（`HERMES_RETRIEVAL_SOURCES` 未設定＝不適合のみ、ページ文脈は送らなければ無視）なので、デプロイ後に問題が出たら Pi5 の `.env` から変数を外して API を再起動すれば前の挙動に戻る。Milestone 2 のテーブルは追加のみで、既存テーブルは変えない。失敗した取り込みは次回の差分更新で上書きされる。

## Artifacts and Notes

- 精度の測定結果は `docs/plans/hermes-retrieval-accuracy-log.md` に追記する（T10 の規則に従う）。
- 本計画の進捗の一行要約はタスクボード T50 に置く。

## Interfaces and Dependencies

`scripts/hermes-search/hermes-source-definition.mjs`: `export const sourceDefinitions`（id → 検証済み定義）、`export function sourceIdsFromEnv(env = process.env): string[]`。

`scripts/hermes-search/retrieval/catalog.mjs`: `export function loadCatalog(sourceIds): CatalogEntry[]`、既存の `loadNonconformityCatalog()`、`catalogEntries()`、`fieldsWithRole()` は互換を保つ。

`scripts/hermes-search/retrieval/corpus.mjs`: `recordFromAuthorizedRow(row, catalog?)`、`authorizedRecords(rows, catalog?)`、`buildCorpusView(records, catalog, dataAsOf)` は `bySource` を追加して返す。

`apps/api/src/services/assembly/hermes-search-sources.ts`（新規）: `export function knowledgeProcedureRow(document: KnowledgeProcedureDocument): Record<string, string>`、`export function retrievalSourceIdsFromEnv(env): string[]`、`export type RetrievalSourceReader = (deps) => Promise<Array<Record<string, unknown>>>`。

`HermesSearchTrialService` のコンストラクタ `overrides` に `procedures?: KnowledgeProcedureRepositoryPort` を足し、テストから偽物を注入できるようにする。
