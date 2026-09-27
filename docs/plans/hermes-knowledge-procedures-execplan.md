# Chatに投げ込んだ素材をAIが手順書に仕立て、Chatで閲覧できるようにする

This ExecPlan is a living document and must be maintained according to `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current while work proceeds.

## Purpose / Big Picture

現在、要領書や組立手順書は、人が原本を取り込み、切り抜き・丸数字・チェック・コメントを手作業で付けて使っている。この作業は手間がかかり、続けることも資料を増やすことも難しい。この計画の目的は、人の役割を「作る」から「おかしい所だけ直す」へ変えることである。

最終形では、現場の誰もが業務用 Pi5 のフローティング Chat のナレッジボタンから、テキスト・写真・PDF・Excel を順番を気にせず投入できる。システムはそれらを主題（例: 技能検定の申し込み、部品 A の段取り、部品 A の切削）ごとに集め、手順・写真・注意点・出典に構造化した「手順書」に仕立てる。利用者は Chat から、テキストの回答として、または決まった型で整えられた手順書のページとして閲覧できる。「次へ」で 1 手順ずつ進めることもできる。

品質に直結する手順（切削、段取り、検査、組立）は、班長・管理者が承認してから公開する。一般的な知識（申し込み手順など）は自動で公開し、「AI作成」と表示して誤り報告ボタンを付ける。写真への丸数字・チェック・切り抜きの自動付与は、位置の精度を確かめてから段階的に加える。既存の手動編集機能は、AI が作ったものを直す道具として残す。

この計画は、ナレッジ機能の試作（[hermes-knowledge.md](./hermes-knowledge.md)、PR #1424/#1428）を拡張し、横断検索（[ADR-20260923](../decisions/ADR-20260923-hermes-cross-source-retrieval.md) と [その ExecPlan](./hermes-cross-source-retrieval-execplan.md)）に合流させる。手順書を「仕立てる」側は横断検索に依存しないので先に進められる。大量の手順書から「探す」側は、横断検索のフェーズ1完了後に行う。

利用者から見える完成の証拠は次のとおりである。作業者が Chat に、部品 A の段取りについてのメモ 2 件と写真 3 枚を別々のタイミングで投入すると、「部品 A の段取り」という主題の手順書下書きが 1 つにまとまって作られる。班長が承認すると公開され、別の作業者が Chat で「部品 A の段取りを教えて」と聞くと、手順 1 から順に写真と出典付きで表示される。申し込み手順のような一般知識は承認なしで公開され、「AI作成」の表示と誤り報告ボタンが付く。

## Progress

- [x] (2026-09-26) 現状調査。ナレッジ試作の範囲、JEV の役割、横断検索の進捗を確認した。
- [x] (2026-09-27) オーナー決定を記録した。本命は横断検索への合流、ナレッジ資料を TypeSafe/JEV（社外）へ送ってよい、DocJev と Hermes 標準機能の援用を評価する。
- [x] (2026-09-27) 既存の手順データ（作業要領、組立手順書、キオスク要領書 PDF、自主検査図面）と手動編集機能を調査し、Context に記録した。
- [x] (2026-09-27) 見本の用意。オーナーが自動モードに読み取り専用コピーの許可を追加し、`scripts/hermes-knowledge/pull-pi5-document-samples.sh` で `~/RaspiKnowledgeSamples`（Git 外）へ写した。PDF 19 件、図面 37 件（1 件は Pi5 側の権限で読めず）、組立手順書画像 3 件、作業要領の画像 3,474 件、メタデータ CSV 4 種。
- [x] (2026-09-27) DocJev を `c7abe276` で手元に導入し、34 件の分類と 51 頁の束の分割を測った。
- [x] (2026-09-27) オーナーと要件を決めた（確認は種類で分ける、写真への書き込みは段階的、手動編集は修正用に残す、投入は全員）。本計画を「AI が仕立てる」方針に書き直した。
- [x] (2026-09-27) オーナーが本計画と DocJev の採用範囲（文字のある PDF の分類・分割だけ）を承認し、PR #1514 で main へ統合した（merge `449725443fa27d2c8b586c8c242b946bd5dfdbd7`）。
- [x] (2026-09-27) マイルストーン1: 表示の静的デザイン案（`docs/design-previews/knowledge-procedure-view-preview.html`、架空データ）をオーナーが承認した。
- [x] (2026-09-27) マイルストーン1: 手順書のデータ形（`KnowledgeProcedure`/`KnowledgeProcedureRevision`、加算 migration `20260927100000_add_knowledge_procedures`、内容の検証 `procedure-content.ts`）、公開済みの一覧・詳細・写真の読み取り API、表示部品 `KnowledgeProcedureView`/`KnowledgeProcedureDialog` を実装した。承認が要る手順書は、この段階の仕組みでは公開できない（`publishAutomatic` が拒否する）。
- [x] (2026-09-27) マイルストーン1: PR #1515 を main へ統合し（merge `72bf05aa94523d6bf9d09768ba3ace18cbb61e05`）、Pi5 へ標準ローリング更新で反映した（run `20260927-010628-f0b65c`、`SubState=exited`/`Result=success`/`ExecMainStatus=0`、recap `ok=263 changed=31 unreachable=0 failed=0`）。反映後、API/Web が同 SHA のイメージで `healthy`、migration 適用済み、`/api/system/health` 200、`/api/hermes-knowledge/procedures` が未認証で 401 を確認した。Chat からの入口はマイルストーン4で付ける。
- [x] (2026-09-27) マイルストーン2a: 素材キュー（`KnowledgeProcedureMaterial`、migration `20260927140000_add_knowledge_procedure_materials`）、主題の振り分けと手順の組み立て（`procedure-builder.ts`、`procedure-inference.ts`、`procedure-worker.ts`）、試作の保存経路のキュー投入への切り替え、既存の保存済み素材の取り込みを実装した。
- [x] (2026-09-27) マイルストーン2a: PR #1516 を main へ統合し（merge `877a74bd8d4acb97c068c5b86d17196a4cfd5eb7`）、Pi5 へ反映した（run `20260927-021711-0af964`、`Result=success`、recap `failed=0`）。
- [x] (2026-09-27) マイルストーン2a: AI 出力の正規化の修正（PR #1517、merge `53a2d86117dbe5789fd085638ac7c17115822e11`）を Pi5 へ反映した（run `20260927-051544-198162`、`Result=success`、recap `failed=0`）。失敗扱いだったテスト投稿が起動時に再試行され、「技能検定の申し込み手順」（自動公開、5 手順、すべての出典が原文の逐語引用）として公開された。
- [x] (2026-09-27) オーナーと仕分けの要件を決めた（Decision Log 参照）。AI の単独振り分けをやめ、AI が候補を出して投稿者が決める形に変える。
- [x] (2026-09-27) マイルストーン2c: デザイン案（`docs/design-previews/knowledge-triage-chat-preview.html`、架空データ）をオーナーが承認した。Chat を広げる記号ボタンは既存の拡大（標準の 2 倍、380×560 → 最大 760×1120px）を使い、広げた状態を端末ごとに覚える変更だけを加える。
- [x] (2026-09-27) マイルストーン2c: 仕分けを実装した。投稿ごとの社員タグ（`posterTagUid` 必須、在籍中の社員に解決）、任意のバーコード品番、`KnowledgeTriage`（AI 候補 → 投稿者が決定）、3 部品タイトルと `KnowledgeWorkType` の一覧、決定時の素材の付け替えと案件ごとの作り直し要求、未仕分けの一覧（タグをかざしたときに表示）、Chat の仕分けカード・新規案件フォーム・案件検索。マイルストーン2a の AI による単独振り分けは廃止した。
- [ ] マイルストーン2c: PR、CI、main 統合、Pi5 反映、実際の投稿での確認。
- [ ] 素材の付け替えによる統合・分割の操作（仕分け済みの素材を別の案件へ移す）は、班長の画面（マイルストーン3）で行う。
- [ ] マイルストーン2b: 文字のある PDF の束を DocJev で分割・分類してから取り込む処理と、Excel の取り込み。
- [ ] マイルストーン3: 確認の区分（承認が要るもの／自動公開）と、承認・誤り報告・修正の流れ。
- [ ] マイルストーン4: Chat からの閲覧（主題名での直接表示）。
- [ ] マイルストーン5: 写真への丸数字・チェック・切り抜きの自動付与（精度評価の後）。
- [ ] マイルストーン6: 横断検索フェーズ1完了後、手順書を情報源として登録し、自然文の質問から探せるようにする。

## Surprises & Discoveries

- Observation: 手動編集機能は、切り抜き・丸数字・チェック・コメントを「ページ上の位置（割合）と種類」のデータとして持つ。
  Evidence: `apps/api/prisma/schema.prisma` の `AssemblyProcedureOverlayElement`（`xRatio`/`yRatio`/`widthRatio`/`heightRatio`、`kind`、`text`、`shapeKind`、画像 `assetId`）と、作業要領側の `WorkInstructionEditOverlay`。AI が同じ形のデータを出せば、表示と人による修正に既存の仕組みを使える。
- Observation: 作業要領は、部品番号と撮影対象ごとの番号付き手順文と画像として、すでに構造化されている。
  Evidence: `WorkInstructionRow`（`partNumber`、`shootingTarget`）と `WorkInstructionStep`（`step`、`text`、`assetId`）。本番には 3,847 手順、画像 3,474 件ある。
- Observation: 組立側にも、機種名ごとの閲覧順、テンプレート版の表示ステップ、改版と公開状態を持つ手順書構造がある。
  Evidence: `AssemblyProcedureOrderSet`/`AssemblyProcedureOrderItem`、`AssemblyTemplateProcedureStep`、`AssemblyProcedureDocument`/`AssemblyProcedureDocumentRevision`。
- Observation: キオスク要領書 PDF は OCR 済みの本文と、品番・図番・工程の推定値を持つ。
  Evidence: `KioskDocument.extractedText`、`candidateFhincd`、`candidateDrawingNumber`、`candidateProcessName`。本番の登録は 8 件で、うち 6 件が 21 頁の研削要領書、2 件が 1 頁の作業要領書。
- Observation: 文字情報を持つ日本語 PDF では、DocJev の分類は全問正解で速い。
  Evidence: 研削要領書 6、作業要領書 2、手戻り改善報告 2、その他 3 の計 13 件がすべて正解。1 件の判定は 0.3〜0.6 秒、費用は約 0.0001 USD。文字は OCR ではなく PDF の埋め込みテキストから取れていた。
- Observation: 写真とスキャン図面は DocJev では扱えない。
  Evidence: 作業要領の写真 4 件はすべて「読める文字がない」エラー。スキャン図面 8 件は英語 OCR の文字化けで 4 件正解、組立手順書画像 3 件は 0 件正解（1 件エラー）。画像頁を含むスライド資料 4 件もエラー。LiteParse の OCR 言語は `jev_docs/ocr/liteparse.py` に `en` で固定されており、`jpn` に差し替えても図面の文字は化けたままだった。
- Observation: 文字のある PDF の束の分割は正確だった。
  Evidence: 要領書 21 頁、作業要領書 1 頁、報告 7 頁、要領書 21 頁、作業要領書 1 頁を連結した 51 頁の PDF を、境界・分類とも正しく 5 つに分けた。判定 0.9 秒、全体 5 秒。

- Observation: 本番で最初の素材の手順書づくりが、AI の出力形式のずれで 4 回続けて失敗した。
  Evidence: 2026-09-27 の Pi5 ログで、主題の振り分け結果の `header.identifiers` が欠けて `ZodError`（`identifiers` Required）になった。品番などが無いメモで、AI は空の `identifiers` を丸ごと省いた。修正では、既知の 3 項目だけを取り出して空文字や余分な項目を捨て、欠けた確認区分は承認が要る側に倒す正規化を入れ、手順の出典欠落は組み立て側で捨てる扱いにした。あわせて、起動のたびに失敗扱いの素材へ再試行の回数を与え直す。
  Evidence: この失敗の前に、業務用 LLM が他の作業で止まっており、受付の用途判定と振り分けは LLM の復帰（準備に約 235 秒）まで待った。素材は失われず、自動で再開した。

- Observation: 本番 migration は「追加だけ」の検査（`scripts/deploy/validate-expand-only-migrations.py`）を通る必要があり、既存表への複数列の一括追加、初期値付き・NOT NULL の列、データの INSERT は禁止されている。マイルストーン2c の最初の migration が CI の `deploy-contract` で落ちた。
  Evidence: `disallowed statement ... ALTER TABLE "KnowledgeIntake" ADD COLUMN "posterEmployeeId" TEXT, ADD COLUMN ...`。列の追加を 1 列ずつの空欄可にし、`buildAttempts` を空欄可（空欄は 0 回）にし、作業の種類の初期登録と仕分け前の素材の補完は起動時の `ensureKnowledgeReferenceData` に移した。マイルストーン1と2a の migration（新規表への `ALTER TABLE ... ADD CONSTRAINT`）もこの検査に合わないが、当時の変更分類では `deploy-contract` が選ばれず検査されていなかった。両方とも本番適用済みで、以後は適用済みとして再検査されない。

## Decision Log

- Decision: 「探す」部分は、横断検索のフェーズ1完了後に、手順書を情報源として載せる形にする。
  Rationale: 「不適合情報と同じように取り出す」をそのまま満たし、試作の 20 件上限（質問ごとに全件を LLM へ渡す方式）を索引検索で解消できる。
  Date/Author: 2026-09-26 / オーナー
- Decision: ナレッジ資料（要領書、加工ノウハウ、日本語スキャン、図面入り PDF）を TypeSafe/JEV へ送ってよい。他の外部サービス（LlamaParse クラウド OCR、OpenAI など）は都度確認する。
  Rationale: DocJev と JEV planner はページ本文を社外へ送るため、評価の前提条件だった。
  Date/Author: 2026-09-27 / オーナー
- Decision: 手順書は AI とシステムが素材から仕立てる。人は作らず、確認と修正だけを行う。初版の「既存の構造化データを正本とし、LLM の手順生成はメモ類に限る」という案は取り下げる。
  Rationale: 手作業の編集は手間がかかり、長続きもスケールもしにくいとオーナーが判断した。既存の作業要領・組立手順書・要領書 PDF は、仕立ての素材として取り込む（人が整えた質の高い素材として優先する）。
  Date/Author: 2026-09-27 / オーナー
- Decision: 確認は種類で分ける。切削・段取り・検査・組立など品質に直結する手順は、班長相当以上の職位の人の承認後に公開する。一般知識は自動で公開し、「AI作成」と誤り報告ボタンを付ける。AI が区分に迷う場合は承認が要る側に倒す。
  Rationale: 投入は現場の全員が行うため、誤った手順がそのまま使われる危険を、品質に効く範囲だけ人が止める。すべてを承認制にすると承認待ちが溜まり、スケールしない。
  Date/Author: 2026-09-27 / オーナー（承認者の条件は次の決定で具体化した）
- Decision: 承認者は、キオスクで社員の NFC タグをスキャンした人のうち、在籍中で職位が「班長相当」以上の人とする（ユーザーのロール `MANAGER` ではない）。職位の段階は 一般 → 班長相当 → 係長相当 → 課長相当 の 4 つ。名簿には人事データの職位名（主事、主任など多数）をそのまま持ち、職位名から段階への対応表を管理画面で保守する。対応表にない職位名は「一般」として扱い（承認できない）、名簿の取り込み結果に未対応の職位名として一覧表示する。承認記録には、既存の NFC 承認と同じく社員コード・氏名・タグ・職位名・段階の写しを残す。
  Rationale: 現場の承認は既存機能（自主検査の記録承認、組立の承認）と同じく社員タグで行うのが自然である。職位名は社内に無数にあるため、名前ではなく段階で判定し、名前の増減は対応表の保守で吸収する。人事データに職位の列があるので、名簿 CSV に 1 列足せば取り込める。既存の自主検査・組立の承認に同じ条件を付けるかは本計画の範囲外とする。
  Date/Author: 2026-09-27 / オーナー（対応表と未対応時の扱いは Claude の提案）
- Decision: 写真への丸数字・チェック・切り抜きの自動付与は段階的に行う。最初は文章の構造化と写真の添付だけで公開し、位置の精度を評価してから加える。
  Rationale: DGX の画像モデルが座標を正しく指せるかは未検証で、これを必須にすると全体が遅れる。
  Date/Author: 2026-09-27 / オーナー
- Decision: 既存の手動編集機能は、AI が作った手順書を直す道具として残す。
  Rationale: AI の位置ずれや文言の誤りを、作業者が慣れた画面で直せる。表示用のデータ形も共通にできる。
  Date/Author: 2026-09-27 / オーナー
- Decision: 手順書の見た目は、LLM に HTML を書かせず、決まった型のページに構造化データを流し込んで作る。
  Rationale: 見た目がそろい、崩れず、安全である。ナレッジ試作のレポート画面（`apps/web/src/features/hermes-knowledge/KnowledgeReportView.tsx`）が同じ方式である。
  Date/Author: 2026-09-27 / Claude（オーナー確認待ち）
- Decision: DocJev は、文字情報を持つ PDF の分類と束の分割にだけ使う。写真・図面・組立手順書の画像には使わない。
  Rationale: 評価で文字のある PDF は 13/13、束の分割は 5/5 正解だった一方、写真は全件エラー、スキャン図面・画像は大半が誤りだった。画像の中身の理解は、試作で使っている DGX の画像説明で行う。
  Date/Author: 2026-09-27 / Claude（オーナー確認待ち）
- Decision: 説明の仕方（順に説明する、出典を必ず添える、不明は不明と言う）は Hermes 標準の Skills に置き、公開済み手順書の取得は読み取り専用 MCP ツールで渡す。手順書そのものを Hermes の自動生成 Skill や Memory に置かない。「次へ」は画面側で処理し、LLM を通さない。
  Rationale: 業務用 Hermes は Skills と `business_api` MCP を標準経路で有効にしている（[business-hermes-butler-phase1-execplan.md](./business-hermes-butler-phase1-execplan.md)）。自動生成 Skill は出典追跡と承認ができない。Hermes のネイティブループは 1 回答 20〜60 秒かかった記録があり、1 手順ごとに LLM を呼ぶと遅い。
  Date/Author: 2026-09-27 / Claude（オーナー確認待ち）

- Decision: マイルストーン2を、2a（素材キューと振り分け・組み立て）と 2b（DocJev と Excel の取り込み）に分ける。
  Rationale: 2a だけで既存の取り込み（メモ・写真・PDF の頁）から手順書が作られるようになり、振り分けと組み立ての品質を実際の素材で先に確かめられる。DocJev は Python の別サービスを足すため、配備の変更が大きく、別の PR にした方が安全である。
  Date/Author: 2026-09-27 / Claude
- Decision: 保存（save）の経路は、ナレッジ全体を 1 つの Git 文書へ公開する処理と 20 件上限をやめ、整理済みの各素材を `KnowledgeProcedureMaterial` に積むだけにする。既存の Git 文書は履歴として残し、更新しない。質問（ask/report）への回答は、新しい順に 40 件までの保存済み素材から行う。
  Rationale: 1 文書にまとめる方式は 20 件で保存自体が失敗し、スケールしない。手順書が主題ごとの成果物になるので、全体文書は不要になる。回答の件数上限は、索引検索（マイルストーン6）までの暫定である。
  Date/Author: 2026-09-27 / Claude
- Decision: 主題の振り分けで AI が確認区分を提案しても、コードが上書きする。自信度 0.8 未満、品番・図番を持つ、または題名・分類・工程に品質に直結する語（切削、段取、検査、測定、組立、加工、研削、トルク、治具、寸法など）を含む主題は、承認が要る区分にする。
  Rationale: 誤って自動公開される危険を、AI の判断だけに任せない。
  Date/Author: 2026-09-27 / Claude
- Decision: 手順の組み立ての結果は、コードで検証してから保存する。知らない素材の出典、原文にない引用、引用していない素材の写真は捨て、出典の残らない手順も捨てる。1 つも手順が残らなければ失敗として再試行する。出典の表示名は素材の記録（日時、PDF のファイル名と頁）からコードが作る。1 回の組み立てに使う素材は主題ごとに 40 件まで。
  Rationale: AI の出力をそのまま信じず、根拠のある手順だけを手順書にする。
  Date/Author: 2026-09-27 / Claude
- Decision: 試作の整理で使っていた固定の分類（申込み／実技準備／学科準備／その他）を、AI が付ける短い分類名に変える。保存済みの素材はそのまま読める。
  Rationale: 計画どおり、試作題材の名残を外す。
  Date/Author: 2026-09-27 / Claude

- Decision: 素材の振り分け先は、AI が候補を出し、人が必ず決める。AI が候補を出せないときは、人が既存の案件を検索して選ぶか新規に作る。画面の文脈（開いている部品など）は使わない。
  Rationale: 不特定多数が投稿するため、AI だけで案件を当て続けることはできない。一方で毎回の品番入力は続かない。画面の文脈は、投稿内容と無関係な画面で Chat を開くことがあり、手がかりとして乱暴すぎるとオーナーが判断した。
  Date/Author: 2026-09-27 / オーナー
- Decision: 投稿のたびに社員 NFC タグをスキャンし、投稿をその社員に結び付ける。仕分けできるのは自分の投稿だけ。仕分けが済むまで、その素材はどの手順書にも入れず保留にし、本人が次にタグをスキャンしたときに未仕分けがあることを知らせる。
  Rationale: 仕分けの責任を投稿者本人に置き、誰の投稿かを確実にする。1 回ごとのスキャンにして、共有端末での取り違えを防ぐ。
  Date/Author: 2026-09-27 / オーナー
- Decision: 投稿時に、移動票のバーコードを任意で読めるようにする。読んだ品番は、AI の候補づくりの確かな手がかりとして使う。
  Rationale: 入力の手間なしで品番が確実に取れる。
  Date/Author: 2026-09-27 / オーナー
- Decision: 案件（手順書の主題）は「対象 × 作業の種類」の小さな単位にし、誰でもどの案件にも素材を追加できる。タイトルは AI が「〈対象〉｜〈作業の種類〉｜〈補足（任意）〉」の 3 部品で提案し、作業の種類は管理された一覧から選ぶ（一覧にない種類は人が承認して加える）。部品ごとなどの大きなまとまりは作らず、同じ対象の案件を並べて見せる。統合・分割は素材の付け替えと手順書の作り直しで行う。
  Rationale: 最初に単位を決め切れないため、後から統合・分割できる形にする。素材が正本で手順書は素材から作り直せるので、付け替えだけで済む。タイトルの部品と種類の一覧で表記の揺れを抑え、検索と束ねて見る表示に使える。
  Date/Author: 2026-09-27 / オーナー（案の構成は Claude）

- Decision: 社員タグをかざした投稿は「記録として残す」ものとして扱い、AI による用途判定（保存・質問・レポート・別の相談）を行わない。
  Rationale: タグをかざして投稿する操作そのものが記録の意図を示す。用途判定をなくすと、業務用 LLM が止まっていても受付がすぐ終わり、「入力を受け付けています」のまま待たされることがなくなる。質問はマイルストーン4以降の閲覧・検索で扱う。
  Date/Author: 2026-09-27 / Claude
- Decision: 仕分けの単位は投稿（`KnowledgeIntake`）とし、PDF の複数頁も 1 回の決定でまとめて同じ案件に入れる。仕分け済みの素材は、その案件の作り直し要求（`buildRequestedAt`）で手順書に反映し、作り直し中に次の決定が来たらもう一度作り直す。仕分け前から残っていた投稿者のない素材は、班長の画面（マイルストーン3）で仕分ける。
  Rationale: 「投稿した単位で振り分け」というオーナーの要件に合わせる。作り直しの要求を時刻で比べることで、決定の取りこぼしを防ぐ。
  Date/Author: 2026-09-27 / Claude

## Outcomes & Retrospective

まだ実装していない。

## Context and Orientation

この節は、リポジトリを初めて読む人が計画を実行できるように、関係する既存部品を説明する。

業務用 Pi5 は工場内の主サーバで、Fastify の API（`apps/api`）と React の Web（`apps/web`）を Docker で動かす。キオスクはタッチ画面の端末で、自主検査（部品の寸法測定と記録）、組立（トルク管理と手順書閲覧）などの画面を持つ。画面右下のフローティング Chat は Hermes と呼ばれる AI 相談窓口で、`apps/web/src/components/hermes/HermesFloatingChat.tsx` が本体、`HermesChatPanel.tsx` に「検索／ナレッジ／JEV記録」のモード切替がある。ナレッジボタンは、検索用途と区別するために置かれている。

ナレッジ試作は `apps/api/src/services/knowledge/` にある。`/hermes-knowledge/intakes` でメモ・画像・PDF を受け取り、DGX（社内の GPU サーバ）の LLM で用途を判定し、1 件ずつタイトル・要約・分類・原文引用に整理して、専用の bare Git リポジトリへ Markdown とレポート JSON を公開する。原文にない引用は検証で弾く。分類は試作題材（金属塗装の実技準備）の名残で「申込み／実技準備／学科準備／その他」に固定され、ナレッジ全体が 20 件までに制限されている。質問への回答は全件を LLM へ渡して選ばせる方式である。受付・処理状態は PostgreSQL の `KnowledgeIntake`/`KnowledgeTopic` に保存され、バックグラウンドの worker が処理する。

手動編集機能は二つある。組立手順書（`AssemblyProcedureDocument` 系）は、取り込んだ原本の各頁に `AssemblyProcedureOverlayElement` として文字・図形・画像・マスクを重ね、改版（`AssemblyProcedureDocumentRevision`）と DRAFT/公開の状態を持つ。作業要領（`WorkInstructionRow`/`WorkInstructionStep`、サービスは `apps/api/src/services/work-instructions/`）は外部リストから取り込まれ、キオスクの編集画面（`apps/web/src/pages/kiosk/KioskWorkInstructionEditorPage.tsx`）で `WorkInstructionEditOverlay` やメモの上書きを付ける。どちらも原本は変えず、編集は別データとして重ねる。

その他の素材として、キオスク要領書 PDF（`KioskDocument`、`apps/api/src/services/kiosk-documents/`）は OCR 本文と品番・図番・工程の推定値を持ち、自主検査図面（`PartMeasurementVisualTemplate`）は図面画像と OCR 済みの数値トークンを持つ。

JEV は TypeSafe 社のホスト型判定サービスで、不適合記録の検索では質問を検索計画へ変換する役を担う。サーバ側の API キーは Vault の `vault_hermes_search_record_pilot_typesafe_api_key` から渡る。横断検索の設計では、情報源ごとにカタログ（項目、絞り込み可能な値、読み取りアダプタ）を宣言し、取り込み時に索引を作り、JEV が 1 回の呼び出しで検索計画を作り、コードが検証・実行する。

DocJev（https://github.com/jerryjliu/docjev 、Apache-2.0、Python 3.11+）は、PDF・Word・PowerPoint を YAML の分類ルールに従って JEV で分類し、複数資料の束をページ範囲に分割する OSS である。Excel と単独の写真は扱わない。公開から約 1 週間でリリース版はなく、保守は Codex が行うと README に書かれている。

社員名簿（`Employee`）は社員コード、氏名、NFC タグ UID、部署、セクション、在籍状態を持ち、職位の項目はまだない。名簿は CSV で取り込む。既存の自主検査の記録承認と組立の承認は、社員タグをスキャンして在籍中であることだけを確かめている。ロールは `ADMIN`、`MANAGER`、`VIEWER` があり、キオスク端末は端末キー（`x-client-key`）で認証される。ナレッジ試作の API は、ユーザー JWT と端末キーの両方を受け付ける（`apps/api/src/routes/hermes-knowledge.ts` の `knowledgeActor`）。

## Plan of Work

マイルストーン1では、手順書のデータ形と表示ページを作る。手順書は、主題（名前、品番・図番・工程などの識別子、確認区分）、版（下書き／承認待ち／公開／差し戻し、作成者、承認者、日時）、順序付きの手順（本文、注意、写真、出典）を持つ。出典は、素材の種類と ID、PDF の頁、作業要領の手順番号、メモの原文引用を指す。写真の書き込みは、既存の手動編集と同じ「位置（割合）と種類」の形で持てるようにしておく（中身はマイルストーン5まで空でよい）。表示は `KnowledgeReportView` と同じく、決まった型の React 部品に構造化データを流し込む。終わりには、手書きの見本データを入れると、キオスク画面で手順書ページが表示される。

マイルストーン2では、素材から下書きを作る。ナレッジボタンから入った素材は、既存の受付（`KnowledgeIntake`）を使って保存する。文字のある PDF は DocJev で分類・分割し、写真と画像は DGX の画像説明で中身を文章にする。Excel は `exceljs`（API に導入済み）でシートを表として読む。そのうえで LLM が素材を既存の主題に振り分けるか、新しい主題を提案し、主題ごとに時系列の手順へ並べ直す。各手順に出典を必須とし、出典のない手順は捨てる。素材どうしの食い違いと抜けは「要確認」として残す。新しい素材が同じ主題に入ると、下書きを作り直して前の版との差分を残す。試作の固定分類と 20 件上限は、主題単位の処理に置き換える。終わりには、見本の素材を順不同に投入すると、主題ごとの下書きが作られる。

マイルストーン3では、確認の流れを作る。LLM が主題の確認区分（承認が要る／自動公開）を判定し、迷う場合は承認が要る側にする。承認が要る下書きは承認待ち一覧に出て、キオスクで社員タグをスキャンした班長相当以上の人が、承認・差し戻し・修正できる。そのために、名簿（`Employee`）に人事データの職位名を足し、名簿 CSV の取り込み（`apps/api/src/services/imports/importers/employee.ts`）に職位の列を加え、職位名から段階（一般／班長相当／係長相当／課長相当）への対応表と、その管理画面を作る。対応表にない職位名は一般として扱い、取り込み結果に一覧表示する。承認の判定は、既存の自主検査の記録承認（`apps/api/src/services/part-measurement/self-inspection/use-cases/record-approval.ts`）と同じくタグの UID から在籍中の社員を引き、段階が班長相当以上かを確かめる。修正は既存の手動編集画面を使えるよう、手順書の写真と書き込みを既存の形へ受け渡す。自動公開の手順書には「AI作成」と誤り報告ボタンを付け、報告があれば承認待ちに戻す。

マイルストーン4では、Chat から見られるようにする。横断検索がまだないこの段階では、ナレッジモードで主題名や品番を言うと、公開済みの手順書を名前と識別子の一致で探し、テキストで要約して手順書ページへのリンクを出す。手順書ページには「次へ」で 1 手順ずつ進む表示を付ける。説明の仕方は Hermes の Skill に書く。

マイルストーン5では、写真への書き込みを自動化する。まず見本の写真と既存の人手の書き込み（組立手順書と作業要領の編集データ）を正解として、DGX の画像モデルに丸数字・チェック・切り抜きの位置を出させ、どれだけ一致するかを測る。基準を満たした種類から有効にし、AI の書き込みは既存の編集画面で直せる。

マイルストーン6では、横断検索フェーズ1の完了後に、手順書のカタログ項目（主題名、品番、図番、工程、確認区分、公開日）を登録し、自然文の質問から探せるようにする。取得は `business_api` の読み取り専用 MCP ツールとして公開する。

## Concrete Steps

見本の取り込みは、リポジトリのルートで次を実行する。本番 Pi5 は読むだけで、写し先はリポジトリの外である。2 回目以降は変わったファイルだけを取り込む。

    scripts/hermes-knowledge/pull-pi5-document-samples.sh

DocJev の評価は、セッションのスクラッチ領域で次のように行った。API キーは macOS キーチェーンから実行時に渡し、ファイルや会話に残さない。

    git clone https://github.com/jerryjliu/docjev.git
    git -C docjev checkout c7abe276a970605feb9cb8b27513365b6c10726e
    cd docjev && uv sync && uv run docjev doctor --smoke
    TYPESAFE_API_KEY="$(security find-generic-password -s typesafe-api-key -w)" uv run docjev classify <見本フォルダ> --rules <rules.yaml> --output <結果>.jsonl

マイルストーン1の検証は、ワークツリーのルートで依存を入れてから行った（`pnpm install --frozen-lockfile --offline`、`pnpm -r --filter "./packages/**" build`、`apps/api` で `pnpm exec prisma generate`）。

    cd apps/api && pnpm exec vitest run src/services/knowledge/__tests__/procedure-content.test.ts src/routes/__tests__/hermes-knowledge.test.ts
    cd apps/web && pnpm exec vitest run src/features/hermes-knowledge/
    scripts/ci/pnpm-exact.sh lint --max-warnings=0

データベースの検証は、使い捨ての PostgreSQL を 127.0.0.1:25433 に立て、全 migration を当ててから行い、終わったらコンテナを消す。本番の DATABASE_URL は使わない。

    docker run -d --rm --name knowledge-proc-test -e POSTGRES_PASSWORD=disposable-test -e POSTGRES_DB=knowledge_test -p 127.0.0.1:25433:5432 pgvector/pgvector:pg15
    cd apps/api && DATABASE_URL=postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test pnpm exec prisma migrate deploy
    KNOWLEDGE_DATABASE_TEST=1 pnpm exec vitest run src/services/knowledge/__tests__/knowledge-procedure-repository.local.test.ts
    docker stop knowledge-proc-test

2026-09-27 の結果は、API の集中テスト 12 件、Web 11 件、データベース 3 件がすべて成功し、全 migration が新しいデータベースに適用できた。

マイルストーン2a の検証も同じ手順で行った。API の集中テストは `src/services/knowledge`、`src/routes/__tests__/hermes-knowledge.test.ts`、`src/bootstrap/__tests__/start-post-listen-schedulers.test.ts` を対象にし、データベースのテストは `src/services/knowledge/__tests__/*.local.test.ts` をまとめて実行した。2026-09-27 の結果は、集中テスト 56 件と、データベースのテスト 11 件がすべて成功した（Poppler の実物テスト 1 件は環境変数を付けていないため対象外）。実際の DGX での振り分けと組み立ての品質は、Pi5 反映後に実際の素材で確かめる。

マイルストーン2b 以降の具体的なコマンドは、着手するときに追記する。

## Validation and Acceptance

マイルストーン1は、見本データを入れた手順書ページがキオスク幅で崩れずに表示され、各手順から出典を開けることで合格とする。マイルストーン2は、見本の素材（要領書 PDF、作業要領の写真と手順文、メモ）を順不同に投入して、主題ごとの下書きができ、すべての手順に出典があり、原文にない引用がないことで合格とする。マイルストーン3は、品質に直結する主題が承認なしに公開されないこと、一般・未対応の職位や退職者のタグでは承認できず班長相当以上のタグでは承認できること、誤り報告で承認待ちに戻ることを、自動テストで確かめる。マイルストーン4は、Chat で主題名を言うと手順書ページに届くことで合格とする。マイルストーン5の合格基準は、評価の結果を見てオーナーと決める。

最終形の合格条件は、Chat で主題を尋ねると公開済みの手順が順番どおりに出典付きで表示されること、公開済みがない主題ではそう伝えること、画面の応答が横断検索の目標（p95 5 秒以内）に収まることである。

## Idempotence and Recovery

見本の取り込みと DocJev の評価は手元だけで行い、本番のデータや設定を変えない。マイルストーン1以降で追加するテーブルは加算的な migration とし、既存の手順書・作業要領・ナレッジのデータは書き換えない。AI の下書き作成は同じ素材で再実行しても同じ主題・版を重複して作らないようにし、失敗した処理は試作の worker と同じく再試行できるようにする。本番への反映は標準のローリング更新で行い、ロールバックしても追加テーブルが残るだけで既存機能に影響しない。

## Artifacts and Notes

評価結果の要約（件数、正解率、時間）は本計画に記録する。業務本文を含む結果ファイルは Git に入れない。

2026-09-27 の評価は DocJev `c7abe276`、Jev モデル `jev-1.13.0`、LiteParse 2.14.6（手元 OCR、英語）で行った。見本は `scripts/hermes-knowledge/pull-pi5-document-samples.sh` で本番 Pi5 から写したもの。画像は Pillow で 1 枚 1 頁の PDF にした。分類ルールは 7 区分（研削要領書、作業要領書、検査図面、組立手順書、作業写真、改善報告、その他）。結果は、文字のある PDF 13/13 正解、スキャン図面 4/8、組立手順書画像 0/3、写真 0/4（すべてエラー）、画像頁を含む資料 4 件はエラー。51 頁の束の分割は 5/5 正解。

## Interfaces and Dependencies

既存の依存として、TypeSafe/JEV（社外、承認済み）、DGX の LLM と画像説明（ナレッジ試作の整理と回答）、`exceljs`、Poppler、既存の画像 OCR、既存の手動編集のデータ形（`AssemblyProcedureOverlayElement`、`WorkInstructionEditOverlay`）を使う。新規の依存は DocJev（Python、固定コミット、文字のある PDF の分類・分割だけ）である。DocJev は Node の API から直接呼べないため、既存の `services/hermes-answer-cache` と同じく Python の小さなサービスとして置くか、ナレッジ worker から呼ぶ CLI とするかを、マイルストーン2で決めて本節に追記する。手順書の型は `packages/shared-types/src/knowledge/index.ts` の `KnowledgeProcedureDocument`（版ごとの表示用文書）、`KnowledgeProcedureStep`（手順。出典 1 件以上が必須）、`KnowledgeProcedureSummary`（一覧用）である。保存形は `apps/api/src/services/knowledge/procedure-content.ts` の `procedureContentSchema`（順序付き手順）と `procedureHeaderSchema`（題名、分類、品番・図番・工程、確認区分）で検証し、未知の項目は拒否する。書き込みの窓口は `KnowledgeProcedureRepositoryPort`（`createDraft`、`publishAutomatic`、`listPublished`、`getPublished`）で、実装は `PrismaKnowledgeProcedureRepository`。読み取り API は `GET /hermes-knowledge/procedures`、`GET /hermes-knowledge/procedures/:procedureId`、`GET /hermes-knowledge/procedures/:procedureId/images/:imageId`（公開版が参照する写真だけ）で、既存のナレッジ API と同じくユーザー JWT か端末キーが必要。MCP ツールの形はマイルストーン6で決める。

Revision note (2026-09-27): 初版。オーナーの方針決定（横断検索への合流、社外送信承認、既製品の援用）と、既存の構造化手順データの発見を受けて作成した。
Revision note (2026-09-27): オーナーとの要件議論を受けて全面改訂した。手作業の編集は続かないという判断から、「AI とシステムが素材から手順書を仕立て、人は確認と修正だけ」に方針を変えた。確認は種類で分ける、写真への書き込みは段階的、手動編集は修正用に残す、投入は全員、という決定を反映し、マイルストーンを仕立て・確認・閲覧・書き込み・検索の順に組み直した。DocJev の評価結果から、採用範囲を文字のある PDF に絞る案を記録した。
Revision note (2026-09-27): 承認者を「社員タグをスキャンした、職位が班長相当以上の人」に決めた。職位の段階（一般／班長相当／係長相当／課長相当）と、職位名から段階への対応表、名簿 CSV への職位列の追加をマイルストーン3に加えた。
Revision note (2026-09-27): マイルストーン1の反映結果を記録し、マイルストーン2を 2a（素材キューと振り分け・組み立て）と 2b（DocJev と Excel）に分けた。保存経路の変更、確認区分の上書き、組み立て結果の検証、分類の自由化の決定を記録した。
Revision note (2026-09-27): 実運用を想定した議論から、AI の単独振り分けをやめて投稿者が仕分けを決める方針に変え、マイルストーン2c（仕分け）を 2b より先に置いた。投稿ごとの社員タグ、任意のバーコード、保留と通知、3 部品のタイトルと作業の種類の一覧、付け替えによる統合・分割を記録した。
Revision note (2026-09-27): マイルストーン2a の修正の反映結果と、マイルストーン2c（仕分け）の実装内容、タグ付き投稿で用途判定を省く決定、仕分けの単位と作り直しの決定を記録した。
