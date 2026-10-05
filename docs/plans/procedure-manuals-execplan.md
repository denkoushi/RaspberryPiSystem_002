# 機種×工程ごとの要領書を、組立手順書を正本にして閲覧・作成できるようにする

This ExecPlan is a living document and must be maintained according to `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current while work proceeds.

## Purpose / Big Picture

現場では、機種(型番。例 `DFD6362XYZ-3943173`)ごと、工程(組立工程、検査工程)ごとに「要領書」を見たい。いまは組立キオスクの手順書(`AssemblyProcedureDocument`。画像ページに丸数字・チェック・締付トルクを重ねる文書)が、締付テンプレートの中からしか引けない。閲覧だけしたい人が、作業セッションやテンプレートを作らずに「機種を選ぶ → 工程を選ぶ → 要領書が開く」だけで済むようにしたい。あわせて、これから作る要領書を、素材(文・写真・のちに動画)をメールで送って取り込み、自由に配置して作り込めるようにし、フローティング Chat のナレッジ機能が集めた素材や承認済み手順も同じ要領書に取り込めるようにする。

この計画は、新しい文書エンジンを作らない。文書の正本は既存の `AssemblyProcedureDocument` 系(ページ画像、`AssemblyProcedureOverlayElement` による自由配置、改版 `AssemblyProcedureDocumentRevision`、DRAFT/PUBLISHED)のままとし、その上に「機種×工程の分類」「素材棚」「専用件名の Gmail 取込」を薄く足す。こうすると、ここで作った要領書を締付テンプレートの表示ステップ(`AssemblyTemplateProcedureItem`/`AssemblyTemplateProcedureStep`)にそのまま置けるため、「要領書と締付・チェックの組み合わせ」が変換なしで成立する。ナレッジ(`KnowledgeProcedure` 系)は素材と承認済み手順の供給元として片方向で連携し、文書モデルは統合しない。

利用者から見える完成の証拠は次のとおりである。キオスクの組立ホームに「要領書」の入口があり、開くと機種の一覧(型番、半角大文字で正規化)が出る。機種を選ぶと「組立工程 > 組立工程」「組立工程 > 検査工程」のような工程が出て、工程を選ぶと、その機種×工程に割り当てた要領書が並び順どおりに表示される。要領書は既存の組立手順書ビューア(ページ送り、丸数字などの注記表示)で開く。同じ要領書を複数の機種に割り当てられ、共通作業の文書を 1 つに集めて複数機種から参照できる。割り当てられている要領書は、既存の手順書管理から誤って削除・公開取消できない。

## Progress

- [x] (2026-10-05) 既存 5 系統(組立手順書、作業要領 `WorkInstruction`、キオスク文書 `KioskDocument`、ナレッジ `Knowledge`、kiosk-sop)を Codex(`gpt-6.1-sol`/`high`、read-only)で比較分析し、Claude が根拠行を確認した。結論は「組立手順書を正本に、分類を薄く追加」。
- [x] (2026-10-05) オーナーが設計判断 5 点を決めた(Decision Log 参照)。
- [x] (2026-10-05) feature branch `feat/procedure-manuals-phase1` と worktree を `scripts.git_lifecycle.cli start` で作成(起点 `origin/main` = `e001c7fa`)。
- [x] (2026-10-05) Phase 1 ローカル実装: 工程マスタと機種×工程の割り当てモデル、4 本の API、キオスク閲覧・編集、参照使用判定を実装。Prisma Client 生成成功。
- [x] (2026-10-05) Phase 1 指定検証: API lint / vitest 12 件 / build 用 tsc、Web lint / vitest 4 件 / build がすべて成功。既存 API 回帰 4 件とビューア回帰 4 件も成功。
- [x] (2026-10-05) 使い捨て PostgreSQL(pgvector pg15)で全 migration を適用し、`migrate status` 一致、工程の初期 3 行、文書二者択一の CHECK 制約の動作を確認した。
- [x] (2026-10-05) Phase 1 を PR #1693 として提出。Codex(`gpt-6.1-sol`/`high`、read-only)のレビューで、キオスク PDF の削除前チェック(`assembly-procedure-reference.service.ts`)に割り当てが入っていない抜けを見つけ、修正とテストを追加した。候補取得で 1 件の改版履歴取得が失敗しても他の候補を出すように直した。
- [x] (2026-10-05) PR #1693 を main へ squash merge(merge `c5ed099daea5db373f376a575e04327a90c74695`)。main の CI、CodeQL、Secret scan、Torque Release Composition が同 SHA で success。worktree は `git_lifecycle.cli finish` で削除し `main_sync=updated`。
- [x] (2026-10-05) Pi5 へ標準ローリング更新(`--limit raspberrypi5 --detach`、run `20261005-015725-1df4cb`、`Result=success`、`ExecMainStatus=0`、recap `ok=268 changed=31 unreachable=0 failed=0`)。反映後 `/api/system/health` が 200(database ok)。
- [x] (2026-10-05) Phase 1 実機確認(オーナー): 要領書の割り当てと閲覧が正常に動作することを確認した(今回の依頼で完了報告)。
- [x] (2026-10-05) Phase 2a ローカル実装: 専用件名の Gmail 本文・写真素材取込、素材棚、手動 API、管理カード、5分ごとの組込みスケジュールを追加。commit / push / PR / merge / deploy は未実施。
- [x] (2026-10-05) Phase 2a 指定検証: API lint / vitest 4ファイル80件 / build用 tsc、Web lint / vitest 4ファイル13件 / build が成功。追加の既存取込・スケジュール回帰は7ファイル71件が成功。Prisma Client 生成成功。
- [x] (2026-10-05) Phase 2a: `procedure-materials` の永続マウントを同じ PR で追加(Pi5 保存先契約、Compose server/phase3、API イメージ、ローカル override、リリース演習・volume materializer・Drive DR の各一覧)。使い捨て PostgreSQL で migration 適用を確認。Codex レビューの 3 指摘(管理カードの保存経路、スキップ再試行、写真の遅延取得)を修正。CodeQL の指摘でメール HTML のテキスト化を正規表現から前方走査に書き換えた。
- [x] (2026-10-05) PR #1696 を main へ squash merge(merge `424c848fddd71202880e17e46d4a42042f3425d7`)、main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261005-032317-829f58`、`Result=success`、recap `ok=269 changed=33 unreachable=0 failed=0`)、`/api/system/health` 200(fileStorage ok)。取込は既定 無効のまま。
- [ ] 実機確認(オーナー): 管理画面 CSV 取込の「要領書の素材(Gmail)」カードで有効化し、件名 `[Procedure-material]` のメール(本文と写真)を送って、要領書ページの「素材」に出ること。実 Gmail での取込は未確認。
- [x] (2026-10-05) Phase 2b ローカル実装: 白紙文書・末尾白紙ページ、PHOTO/TEXT の下書き配置、配置取消、配置済み棚、未参照原本の手動 GC とテストを追加。commit / push / PR / merge / deploy は未実施。
- [x] (2026-10-05) Phase 2b 指定検証: API lint / vitest 9成功ファイル69件(実DB1件skip) / build用tsc、Web lint / vitest 11ファイル49件 / build が成功。白紙追加後の未保存IMAGE資産保持の最終変更はcontroller7件・対象lint・Web tscで再確認した。
- [x] (2026-10-05) Phase 2b 限定レビュー修正3件: 原本GCと取込の競合、所有リース中PHOTOの復元、白紙追加成功直後の復旧記録更新を修正。最終指定検証はAPI 74件成功・実DB1件skip、Web 51件成功、両lint / API tsc / Web build成功。既存WIPを保持し、commit / push等は未実施。
- [x] (2026-10-05) Phase 2b: Codex レビューの 3 指摘(GC と取込の競合、未保存の配置写真の復元、白紙追加後の復旧記録)を修正。CodeQL の指摘で写真原本と GC のルートに rateLimit を追加。エディタ画面にボタンが増えたため `pnpm kiosk-sop:generate` で取説を再生成して commit。
- [x] (2026-10-05) PR #1698 を main へ squash merge(merge `0f60a906d233171c9098ce9a3d679725b09a4c01`)、main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261005-045743-a6c83b`、`Result=success`、recap `ok=268 changed=31 unreachable=0 failed=0`)、`/api/system/health` 200。
- [ ] 実機確認(オーナー): 要領書ページの「白紙から作る」で名前を入れてエディタが開く、「白紙ページを追加」で末尾に増える、「素材から配置」で写真・本文を現在ページに置いて保存・再読込できる、素材棚の「配置済み」から取り消せる。
- [x] (2026-10-05) Phase 2c ローカル実装: 社員NFCタグと職位による承認公開、承認スナップショット、直近承認の表示、公開方法選択と割り当てダイアログの小修正を追加。統合・本番反映は未実施。
- [x] (2026-10-05) Phase 2c 指定検証: API lint / 8ファイル55件成功・実DB1ファイル1件skip / build用tsc、Web lint / 12ファイル62件 / build成功。Prisma Client生成成功。
- [ ] Phase 2c 統合・受入: 実 PostgreSQL migration・実NFC端末確認、commit / push / PR / merge / deploy。
- [ ] Phase 3: ナレッジ素材・承認済み手順の片方向連携。
- [ ] 後日: 動画素材(形式未定)。

## Surprises & Discoveries

- Observation: 白紙追加の応答喪失時はサーバーの editVersion とローカル復旧記録がずれる可能性がある。今回の限定修正では成功応答直後の即時更新のみ対応し、応答喪失時の救済は未実装。
- Observation: 既存 `assembly-procedure-asset-gc.service.ts` の SQL は、所有文書が active DRAFT のアセットを経過時間にかかわらず保護する。未参照でも PHOTO 配置の所有リース中は削除されず、所有文書が非active・非DRAFT・不存在または所有解除後は、参照0と経過時間の条件を満たすと削除対象になる。

- Observation: 素材原本の保存後に DB 保存が失敗すると未参照ファイルが残るため、2b の GC で回収経路を設ける。

- Observation: 既存の「機種名ごとの閲覧順」(`AssemblyProcedureOrderSet`/`AssemblyProcedureOrderItem`)は、旧テンプレート向けの読み取り専用互換層で、公開 API から変更できない。
  Evidence: `apps/api/src/services/assembly/assembly-legacy-procedure-order.service.ts` 冒頭のコメント「Read-only compatibility adapter … No public API may mutate this data.」。ここに機種×工程を足さず、新モデルにする。
- Observation: 組立手順書の Gmail 取込は件名 `DocumentASM` の完全一致かつ添付 1 件(PDF または JPEG)という契約で、本文・複数写真・動画を受ける素材取込にはそのまま使えない。
  Evidence: `apps/api/src/services/assembly/assembly-procedure-gmail-import.service.ts` の `hasExactAssemblyProcedureGmailSubject` と `selectSingleAssemblyProcedureAttachment`。
- Observation: 在庫の Gmail 取込は `CsvImportSubjectPattern` ではなく、`backup-config.ts` の専用設定 `itemInventoryGmailIngest`(先頭トークン `[ItemlistRaspi-photo]`)で動く。件名の予約は `apps/api/src/services/gmail/gmail-subject-reservation.policy.ts` に集約されている。
- Observation: オーバーレイの共通型は TEXT/IMAGE/SHAPE のみで、保存できる MIME にも動画がない。共通型の変更は作業要領側にも波及する。
  Evidence: `packages/shared-types/src/overlay/normalized-overlay.ts` の `overlayElementSchema`、`apps/api/src/services/assembly-procedure-assets/local-assembly-procedure-asset-storage.adapter.ts` の `MIME_TO_EXTENSION`。
- Observation: 既存ビューア `AssemblyProcedureSequenceViewer` は締付・チェックのマーカーを省略でき、`KioskDocument`(PDF)と `AssemblyProcedureDocument`(画像)の混在列を表示できる。閲覧ページはこれを流用できる。

- Observation: 既存手順書 summary API は改版の先頭だけを返すため、先頭が DRAFT の系列では旧公開版が一覧に含まれない。
  Evidence: `AssemblyProcedureDocumentService.listSummary` の `isRevisionHead` 条件。編集候補は既存の GET revisions API で最新の active PUBLISHED 版を補完し、Web テストで確認した。
- Observation: Web の `api/client.ts` はドメイン API の再エクスポート専用 facade である。
  Evidence: `export * from './domains/assembly'`。新 API 関数は既存の `api/domains/assembly.ts` に追加し、client からそのまま利用できる。
- Observation: worktree には依存パッケージの dist がなく、初回 API tsc は shared-types / shelf-layout-core 等のモジュール解決で失敗した。また Prisma の通常生成はユーザーキャッシュの utime が EPERM となった。
  Evidence: ワークスペース 4 パッケージの build 後の tsc は成功。既存の Prisma query/schema engine を環境変数で明示した generate も成功。追跡対象の依存ファイルや .env は変更していない。

- Observation: キオスク PDF の削除は `AssemblyProcedureReferenceService.countKioskDocumentReferences` で参照を数えてから実体を消す。新しい参照元を足したときは、組立手順書側の `getReferenceUsage` だけでなくこちらにも加えないと、PDF の実体を消した後に外部キーで拒否されて DB 参照だけが残る。
  Evidence: Codex のレビュー指摘(2026-10-05)。`apps/api/src/routes/kiosk-documents.ts` の削除ルートが同サービスを呼ぶ。
- Observation: 旧形式(改版サイドカーなし)の文書では、公開取消の参照確認と割り当て保存が同じ行をロックしないため、理論上は「確認 → 保存 → 公開取消」の順で割り当て先の公開版が消え得る。実測していない競合で、Phase 1 では放置し、Phase 2 の公開経路を作るときに同じ文書行のロックで直す。
- Observation: `apps/web/src/features/assembly/**` と組立ホームはキオスク取説(kiosk-sop)の監視対象で、変更すると pre-commit が digest の更新を求める。画面が変わらない変更では `pnpm kiosk-sop:source-refresh` で manifest を更新して一緒に commit する。

- Observation: 本番 `docker-compose.server.yml` は namespace ごとの永続マウントで、`procedure-materials` は未定義。
  Evidence: `infrastructure/docker/docker-compose.server.yml` の API volumes と named volumes。今回の infrastructure 変更禁止により未修正。本番反映前に別依頼で永続マウントを追加する必要がある。

## Decision Log

- Decision: 文書の正本は `AssemblyProcedureDocument`。新しい文書モデルは作らない。
  Rationale: 自由配置、改版、公開、Gmail 取込、キオスク閲覧がそろっており、締付テンプレートが同じ ID を参照するので「1 と組み合わせる」が自動で満たされる。
- Decision: 機種キーは型番とし、`normalizeMachineNameForCompare`(全角→半角、前後空白除去、大文字化)で正規化した値を比較キーに持つ。表示用には入力時の文字列も保存する。
  Rationale: オーナー決定(2026-10-05)。既存の機種名比較と同じ規則にそろえる。
- Decision: 工程は 2 階層の管理リスト(工程マスタ)とし、初期値は「組立工程」の下に「組立工程」「検査工程」。資源 CD の割り当ては未定なので、任意の `resourceCd` 列を持たせるだけで、いまは使わない。
  Rationale: オーナー決定。資源 CD が決まったときに列を埋めるだけで済むようにする。
- Decision: 1 組の機種×工程に複数の要領書を並び順付きで置ける。同じ要領書(改版ルート)を複数の機種×工程に割り当てられる。
  Rationale: オーナー決定「どちらも必要」「共通作業は共通文書へ集合させたい」。
- Decision: 割り当ては文書の個別版ではなく「改版ルート」(`AssemblyProcedureDocumentRevision.revisionRootId`。改版履歴に属さない文書は自分自身がルート)を指し、閲覧時にそのルート系列の最新 PUBLISHED 版を解決する。
  Rationale: 改版しても割り当てを付け直さずに済み、下書き作成中も旧公開版を表示し続けられる。
- Decision: 新機能で作る要領書の公開は、ナレッジと同じ NFC 承認(社員タグ + 職位)で行う。これは Phase 2 で扱い、Phase 1 は既に PUBLISHED の文書を割り当てて閲覧するだけとする。
  Rationale: オーナー決定「後者(NFC 承認)」。Phase 1 では新しい公開経路を作らないので、既存のパスワード公開と衝突しない。
- Decision: 素材メールは保存成功後にゴミ箱へ移す。動画は形式未定のため後日。Phase 2 で動画を扱う場合も、ページに貼る要素ではなく素材棚からダイアログ再生する添付として扱い、共通オーバーレイ型を変えない。
  Rationale: オーナー決定。共通型の変更が作業要領側に波及するのを避ける。
- Decision: ナレッジ連携は「同じ機種×工程に関連する素材・承認済み手順を一覧し、明示選択で取り込む」片方向のみ。双方向同期はしない。
  Rationale: オーナー決定。AI 再構成と手動配置の衝突を避ける。
- Decision: 割り当てには `KioskDocument`(PDF 要領書)も `AssemblyProcedureDocument` と同じく置ける。
  Rationale: 既存の `AssemblyTemplateProcedureItem` と同じ 2 択の形にすれば、ビューアもそのまま使え、既存 PDF を「ただ見る」用途が Phase 1 で満たせる。

- Decision: 割り当て置換は新しい工程行を FOR UPDATE でロックしてから検証・deleteMany/createMany を同じトランザクション内で実行する。
  Rationale: 割り当てがまだない機種×工程でも置換同士が競合しない。工程単位の短い直列化とし、新たなロック用モデルは追加しない。
  Date/Author: 2026-10-05 / Codex。
- Decision: 参照使用判定は割り当て先ルートと、その系列で閲覧対象になる最新 active PUBLISHED 版を守る。より古い版には追加の割り当てガードを付けない。
  Rationale: 割り当て先と表示中の文書を守りつつ、既存の版履歴・旧版整理の規則を維持する。
  Date/Author: 2026-10-05 / Codex。
- Decision: 新ルートの sequence は既存 DTO の source 値 `primary_fallback` と `stepSource: document_expansion` を再利用する。分類の情報は新ルートの assignments が持つ。
  Rationale: 文書全体を展開する既存ビューア・直列化関数を流用し、既存の共有文書列契約やオーバーレイ型を変更しない。
  Date/Author: 2026-10-05 / Codex。

- Decision: Phase 2 を 2a(素材取込・素材棚)、2b(白紙ページ・配置)、2c(NFC 公開)に分割し、この worktree は2aだけを実装する。
  Rationale: ユーザー依頼の境界。先にメール素材を安全に蓄積できる入口を独立して検証する。
  Date/Author: 2026-10-05 / Codex。
- Decision: 素材取込は未読の受信箱を再試行元として残し、追加の履歴テーブルを作らない。保存済み素材は dedupe key で検出し、ゴミ箱移動失敗後も再取込で復旧する。
  Rationale: この段階で必要な永続状態は素材自身と Gmail が持つ。既読化しないことでプロセス再起動後にも検索される。保存途中の失敗では残りの対応素材が揃うまでメールを残す。
  Date/Author: 2026-10-05 / Codex。
- Decision: 添付の重複キーには添付名とパート ID(なければ MIME ツリー位置)のハッシュを使い、先頭トークンの直後にも任意のヒントを許可する。
  Rationale: 同名添付を落とさず、ユーザーの「後ろの任意文字列」の契約を満たす。在庫・作業要領のトークン境界規則は変更しない。
  Date/Author: 2026-10-05 / Codex。
- Decision: 5分ごとの組込みスケジュールを実装し、管理カードは専用設定と該当スケジュールの enabled を一緒に保存する。
  Rationale: 既存の execution 分岐を追加する小さい変更で対応できる。設定カードと実際の起動状態のずれを避ける。
  Date/Author: 2026-10-05 / Codex。

- Decision: Phase 2b の白紙 PNG は既存 `AssemblyProcedureImageStorage.saveImage` に保存し、SOURCE アセットは登録しない。
  Rationale: `AssemblyProcedureDocumentService.create` は SOURCE が任意で、未指定でも改版サイドカー・`sourceAssetId:null`・`editVersion:0` を作る。白紙には抽出元の原本がなく、同じ PNG の二重保存は不要。既存のページ画像から表示・切抜き・OCR・改版を行える。
  Date/Author: 2026-10-05 / Codex。
- Decision: 白紙追加は既存 overlay 保存と同じ文書行ロックと expectedEditVersion 検証を用い、最大 pageIndex + 1 だけ追加する。
  Rationale: 既存ページ番号と先頭の imageRelativePath 互換列を保ち、締結・切抜き・チェック参照を壊さない。Web は未保存 overlay と IMAGE 資産を保持してページと editVersion を更新する。
  Date/Author: 2026-10-05 / Codex。
- Decision: 素材配置は文書・素材をロックし、既存 IMAGE upload に同じ transaction client を渡して所有リースと配置フラグを一緒に確定する。overlay は直接保存せずエディタの addCreatedOverlay に返す。
  Rationale: 二重配置と公開・破棄との競合を防ぎ、失敗時は新しい資産ファイルを削除する。既存 upload に独立した派生物生成処理はないため、その検証・保存・リース契約をそのまま再利用する。TEXT は既存の10,000文字上限を超えると未消費のまま400、極端に縦長の PHOTO は縦横比を保ってページ内へ縮小する。
  Date/Author: 2026-10-05 / Codex。
- Decision: discardRevision は素材の配置状態を明示更新しない。配置済み棚の「配置を取り消す」で documentId / placedAt を null に戻す。
  Rationale: 配置要素は未保存の下書きにも存在し得て、改版破棄と素材の利用意図は一致しない。文書削除時の既存 FK SetNull により documentId が null になっても placedAt は残るため、配置済み棚から取り消せる。取消は overlay を削除しない。
  Date/Author: 2026-10-05 / Codex。
- Decision: 素材原本 GC は allowWriteKiosk の手動 POST /assembly/procedure-materials/gc のみとする。
  Rationale: 既存 assembly-procedure-asset-gc は保存・破棄・削除後の呼び出しだけで定期スケジューラーはない。新しいスケジューラーは今回追加しない。sha256/original だけを走査し、24時間より古く storageKey 一致の参照が0件の場合だけ integrity:true で削除する。配置済み・破棄済みを含む全素材の参照と共有原本を保持する。
  Date/Author: 2026-10-05 / Codex。

- Decision: Phase 2c の公開条件・expectedEditVersion 検証・文書行ロックは `publishInTransaction` に共通化し、パスワード検証は `publish`、承認者照合と同一transactionでの承認記録作成は `approvePublish` に置く。PUBLISHED済みへの再実行は文書を返し、承認行を追加しない。
  Rationale: パスワード公開の条件と認証を保持し、承認行の作成失敗・競合では公開と記録を一緒に取り消す。旧形式文書の公開取消と割り当ても同じ文書行をロックし、既知の競合を防ぐ。
  Date/Author: 2026-10-05 / Codex。
- Decision: ナレッジと同じ `useArmedNfcRead` を公開ダイアログに使用し、読取後に専用 `POST /assembly/procedure-documents/approval-reviewer` で氏名・職位を確認する。実際の公開APIでも `PrismaKnowledgeReviewerRepository.resolve(tagUid, true)` を再実行する。
  Rationale: 古いNFCイベントを採用せず、確認と実行の間の職位・在籍変更を再検証する。確認のためにナレッジの承認待ち一覧を取得せず、Hermes機能の有効化にも依存しない。
  Date/Author: 2026-10-05 / Codex。
- Decision: 未登録タグは Phase 2c の明示受入条件どおり404、在籍外・承認職位未満は403、タグ重複は既存同様409とする。認証なしは401。ナレッジ側の未登録タグ400の契約は変更しない。
  Rationale: 「ナレッジと同じ」と「未登録404」の差は、具体的な受入条件を優先して解消した。エラーコードは既存ナレッジのものを再利用する。
  Date/Author: 2026-10-05 / Codex。

## Context and Orientation

このリポジトリは pnpm ワークスペースで、`apps/api` が Fastify + Prisma(PostgreSQL)の API、`apps/web` が React(Vite)の Web、`packages/shared-types` が共有の型である。キオスク画面は `apps/web/src/pages/kiosk/` にあり、ルートは `apps/web/src/App.tsx` に列挙されている。組立キオスクのホームは `apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx` で、ナビゲーションのリンク群(`aria-label="組立メニュー"`)から各画面へ飛ぶ。

組立手順書の API は `apps/api/src/routes/assembly/` にあり、文書の一覧・取得・公開は `procedure-documents.ts`、改版は `procedure-document-revisions.ts`、本体のサービスは `apps/api/src/services/assembly/assembly-procedure-document.service.ts` である。閲覧順の解決は `assembly-procedure-sequence.service.ts` が行い、`KioskDocument` と `AssemblyProcedureDocument` を同じ形(`AssemblyProcedureSequenceItemSummary`)にそろえる関数が `assembly-procedure-sequence-item.ts` にある。文書の削除・公開取消の前に参照の有無を数える `getReferenceUsage` が `assembly-procedure-document.service.ts` にあり、新しい参照元はここに加えないと、使用中の文書が消せてしまう。

ルートの認可は `apps/api/src/routes/assembly/index.ts` で定義される `allowView`(閲覧。ユーザー JWT または端末キー)と `allowWriteKiosk`(書き込み。ユーザー JWT が通ればそれを使い、通らなければ端末キーの書き込み権限で判定)を使う。新しいルートも同じ 2 つを使う。

Web 側の API 呼び出しは `apps/web/src/api/client.ts` に関数として追加し、組立機能の型は `apps/web/src/features/assembly/types.ts` に置く。既存ビューアは `apps/web/src/features/assembly/AssemblyProcedureSequenceViewer.tsx` で、`sequence`(文書列と表示ステップ)を渡すと表示し、締付・チェックのマーカーは省略できる。

Prisma のスキーマは `apps/api/prisma/schema.prisma`、マイグレーションは `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` で、既存の運用方針により「追加のみ」(expand-only。既存テーブルの列削除や制約追加はしない)で書く。

## Plan of Work

### Phase 1: 分類と単独閲覧

Phase 1 が終わると、管理者が既存の公開済み手順書(画像)やキオスク PDF を「型番 × 工程」に並び順付きで割り当てられ、現場の誰もがキオスクの組立ホームから「要領書」→ 機種 → 工程 → 文書の順に開いて閲覧できる。割り当てられた文書は、既存の手順書管理から削除・公開取消できなくなる。

データモデルは 2 つ追加する。`ProcedureManualProcess` は工程マスタで、`id`、`parentId`(任意)、`name`、`sortOrder`、`active`、`resourceCd`(任意、いまは未使用)を持ち、マイグレーションで「組立工程」とその子「組立工程」「検査工程」を初期投入する。`ProcedureManualAssignment` は割り当てで、`id`、`modelCode`(入力どおりの型番)、`modelCodeKey`(正規化した比較キー)、`processId`、`kioskDocumentId`(任意)、`assemblyProcedureDocumentId`(任意。改版ルートの文書 ID を入れる)、`sortOrder`、`label`(任意)、`createdAt`、`updatedAt` を持つ。2 つの文書参照はどちらか一方だけが入る。`(modelCodeKey, processId, sortOrder)` を一意にし、文書への外部キーは `onDelete: Restrict` にする。

API は `/assembly/procedure-manuals` 配下に置く。工程マスタの一覧(閲覧)、機種一覧(割り当てが 1 件以上ある `modelCodeKey` を重複なく返す。閲覧)、機種×工程の割り当て一覧と解決済み文書列(閲覧。`assemblyProcedureDocumentId` は改版ルートとして扱い、そのルート系列で `status = PUBLISHED` かつ `isActive` の最新版を返す。見つからなければその項目は「公開版なし」として返し、他の項目の表示を止めない)、割り当ての置換(書き込み。1 つの機種×工程の並びをまとめて受け取り、トランザクションで差し替える)を用意する。文書列は既存の `AssemblyProcedureSequence` の形(`serializeProcedureSequence` が返す形)にそろえ、`stepSource` は文書展開(ページ全体を順に見せる既存の fallback 相当)にする。

`getReferenceUsage` と `isReferenced`、`buildInUseMessage` に `inProcedureManualAssignment` を加え、割り当てられた文書(改版ルートまたはその系列の文書)は削除・公開取消を拒否する。改版ルートで割り当てている以上、系列内の旧版 1 件の整理は妨げない範囲にとどめ、少なくとも「割り当て先の ID と一致する文書」は確実に守る。

Web は `/kiosk/assembly/manuals` に閲覧ページを追加し、`KioskAssemblyHomePage` のナビゲーションに「要領書」リンクを足す。ページは左に機種一覧(検索付き)、機種を選ぶと工程一覧、工程を選ぶと文書列が `AssemblyProcedureSequenceViewer` で表示される 3 段構成とする。管理者向けの割り当て編集は、同じページの「割り当てを編集」ボタンから開くダイアログとし、公開済み文書(`listAssemblyProcedureDocumentSummaries` 相当)とキオスク PDF から選んで並び替え、保存する。閲覧専用端末では編集ボタンを隠す必要はないが、保存時に 403 なら「権限がありません」と表示する。

テストは、API のルート/サービスに vitest を追加し、割り当て置換の一意制約、改版ルートの公開版解決(下書きが先頭でも旧公開版が返る、公開版なしの項目が他を止めない)、`getReferenceUsage` が割り当てを検出すること、Web の 3 段構成の表示と編集ダイアログの保存をテストする。

### Phase 2a: 専用 Gmail 素材取込と素材棚

件名の先頭トークン `[Procedure-material]` を `gmail-subject-reservation.policy.ts` に予約し、後続の任意文字列をヒントとして保存する。CSV 件名パターンの登録拒否と、CSV ダッシュボード・Gmail storage provider・キオスク文書のメール除外に追加する。設定 `procedureMaterialGmailIngest` は既定で無効、トークンはこの1種類、任意の `fromEmail` で送信元を制限する。管理画面の CSV 取込に「要領書の素材(Gmail)」カードを追加し、有効化と手動実行を行えるようにする。

`ProcedureMaterial` は TEXT / PHOTO、本文または原本の保存キー・sha256・MIME・サイズ・添付名・寸法、ヒント・送信元・メール ID・一意な `gmailDedupeKey`・受信日時、将来の配置先 `documentId`・`placedAt`、`discardedAt`、作成更新日時を持つ。新テーブルと enum だけを `20261005150000_add_procedure_materials` の expand-only SQL で追加する。文書への外部キーは `onDelete: SetNull` とし、既存文書モデルには Prisma が要求する逆参照だけを追加する。

`apps/api/src/services/assembly/procedure-material-gmail-ingestion.service.ts` の `runOnce({ config, allowWait, manual?, messageId?, forceRetry? })` は、在庫取込と同じ実行入口・単一実行ガード・20通のバッチ上限を持つ。検索は正規トークンの `subject:"…" in:inbox is:unread` とし、取得後に件名・送信元を検証する。resolver は text/plain を優先し、なければ HTML をテキスト化する。inline を除いた JPEG / PNG / WebP の10 MB以下の原本を DurableFileStorePort に `procedure-materials/<sha256>/original` として整合性検証付きで保存する。本文は `messageId:body`、添付は添付名と MIME パート識別子のハッシュを使う。同じ名前の複数写真も区別し、同じメールの再実行では増えない。PDF・動画・超過サイズ・不正画像は除外件数と理由へ入れる。

対応素材をすべて保存したメールだけ `trashMessage` を実行する。本文空・対応写真なしの場合と、取込・保存・ゴミ箱移動の失敗時は既読にせず受信箱に残す。未読受信箱を永続的な再試行元とし、同一プロセスでは失敗後5分待つ。特定 `messageId` の `forceRetry` は待機を解除する。保存済みの dedupe key は原本を再取得せず、ゴミ箱移動を再試行する。追加の取込履歴テーブルは作らない。

API `/assembly/procedure-materials` は Phase 1 と同じ `allowView` / `allowWriteKiosk` を使う。一覧は state / ヒント部分一致 / 既定100件で新しい順、PHOTO原本は private, no-store、TEXTや素材なしは404、手動取込は件数と各メールの状態を返す。discard / restore は配置済みを409で拒否し、未配置の `discardedAt` を設定・解除する。`procedure-material-gmail` の組込み行を5分ごと・既定無効で保証し、CSV execution から素材取込へ直接分岐する。

要領書ブラウザ上部の「素材」でダイアログを開き、本文冒頭2行・写真サムネイル・ヒント・受信日時・送信元を表示する。ヒント検索、「今すぐ取り込む」、未配置 / 捨てた素材の切替、「捨てる」 / 「戻す」を提供する。操作部は縮まない構造、ボタンは `min-h-11` とし、配置ボタンは置かない。原本は認証付き Blob で取得して object URL を解放する。テストは件名排他、resolver、保存・ゴミ箱移動の冪等性と失敗、API状態・404・403・破棄復元、スケジュールと管理設定、素材棚の一覧・手動取込を Prisma モックで確認する。

### Phase 2b: 白紙ページと素材の配置

既存の文書エディタ(`apps/web/src/features/assembly/document-editor/`)に「白紙ページを追加」と「素材棚から配置」を足す。写真は IMAGE、本文は TEXT オーバーレイとして置き、`documentId` / `placedAt` を更新する。配置先のライフサイクルと素材原本の保持を確認する。素材は組立文書の asset namespace とは独立して保存するため、配置後に文書資産へコピーする場合はその資産の GC 保持判定を既存規則に合わせる。公開経路・共通オーバーレイ型はこの段階で変更しない。

### Phase 2c: NFC 承認による公開

ナレッジの承認(`apps/api/src/services/knowledge/knowledge-position-rank.ts` の `canApprove`、社員タグ照合、`KnowledgeProcedureReview` 相当の記録)と同じ規則を、要領書向けの承認記録として実装する。既存のパスワード公開は締付テンプレート向けに残す。Phase 1 で観測した公開取消と割り当ての競合は、この公開経路の実装時に同じ文書行のロックで扱う。Phase 2a では公開・NFC・白紙ページ・配置を実装しない。

### Phase 3: ナレッジ連携

機種×工程の閲覧・編集画面から、同じ型番・工程名に関連するナレッジ素材(`KnowledgeProcedureMaterial`)と承認済み手順(`KnowledgeProcedure` の `publishedRevision`)を一覧し、利用者が明示的に選んだものだけを素材棚へコピーして配置できるようにする。出典(ナレッジ側の ID と版)を素材に保持する。ナレッジ側のデータは変更しない。

## Concrete Steps (Phase 1)

作業は worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--procedure-manuals-phase1`(branch `feat/procedure-manuals-phase1`)で行う。

1. `apps/api/prisma/schema.prisma` に `ProcedureManualProcess` と `ProcedureManualAssignment` を追加し、`AssemblyProcedureDocument` と `KioskDocument` に逆参照を足す。`apps/api/prisma/migrations/20261005120000_add_procedure_manual_assignments/migration.sql` を expand-only で書き、工程の初期行を `INSERT ... ON CONFLICT DO NOTHING` で入れる。
2. `apps/api/src/services/assembly/procedure-manual.service.ts`(新規)に、工程一覧、機種一覧、割り当て一覧、公開版解決、割り当て置換を実装する。公開版解決は `AssemblyProcedureDocumentRevision` を `revisionRootId` で引き、無ければ文書自身を対象にする。
3. `apps/api/src/routes/assembly/procedure-manuals.ts`(新規)にルートを置き、`apps/api/src/routes/assembly/index.ts` から既存ルートと同じ方法で登録する。
4. `assembly-procedure-document.service.ts` の `getReferenceUsage`/`isReferenced`/`buildInUseMessage` に割り当て参照を加える。
5. `apps/web/src/api/client.ts` に API 関数、`apps/web/src/features/assembly/types.ts` に DTO、`apps/web/src/features/assembly/procedure-manuals/`(新規)に 3 段構成と編集ダイアログ、`apps/web/src/pages/kiosk/KioskAssemblyManualsPage.tsx`(新規)にページ、`App.tsx` にルート、`KioskAssemblyHomePage.tsx` にリンクを追加する。
6. テストを追加して次を実行する。

       cd apps/api && pnpm lint && pnpm test -- procedure-manual
       cd apps/web && pnpm lint && pnpm test -- procedure-manuals && pnpm build

## Concrete Steps (Phase 2a)

既存タスクの worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--procedure-manuals-phase2a-materials` でローカル実装と検証だけを行う。Git の mutation と infrastructure 変更は今回の依頼外である。依存関係は `pnpm install --offline --frozen-lockfile`、ワークスペースの shared-types / shelf-layout-core / part-search-core / kiosk-sop-core の build、`apps/api` の `pnpm exec prisma generate` で準備した。Prisma の通常生成はユーザーキャッシュの utime が EPERM になったため、worktree内の既存 engine バイナリを `PRISMA_QUERY_ENGINE_LIBRARY` / `PRISMA_SCHEMA_ENGINE_BINARY` で指定して成功した。

指定検証は次のとおり。

    cd apps/api && pnpm lint && pnpm exec vitest run procedure-material gmail-subject-reservation && pnpm exec tsc -p tsconfig.build.json --noEmit
    cd apps/web && pnpm lint && pnpm exec vitest run procedure-manuals ItemInventoryGmailScheduleCard && pnpm build

API は4ファイル80件、Webは4ファイル13件の成功を確認した。追加回帰は `apps/api` で `pnpm exec vitest run item-inventory-gmail csv-import-execution.service import-schedule-admin.service gmail-storage.provider csv-dashboard-import.service.ingest-behavior kiosk-document-gmail-ingestion.query` を実行し、7ファイル71件が成功した。Webの import順序、スケジュールテストの行順の前提、素材棚の403表示を修正して対象検証を再実行した。最後の組込み行削除ガードと管理カードの表示状態変更には対象 lint / テスト / API tsc を追加して確認した。

実 DB migration と実メールの検証、本番永続マウントの準備、端末操作確認は次の統合段階で行う。commit / push / PR / merge / deploy は実行していない。kiosk-sop digest の更新はユーザー指示により Claude 側で行う。

## Concrete Steps and Validation (Phase 2b)

既存タスクの worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--procedure-manuals-phase2b-placement` でローカル実装だけを行った。Prisma スキーマ・migration・共有 overlay 型・Gmail 取込・公開・NFC・infrastructure は変更していない。白紙作成/追加/素材配置は既存の revision route module、unplace/GC は素材 route module に追加した。ページ追加と配置は既存編集パスワードも検証する。

指定検証を実行した。

    cd apps/api && pnpm lint && pnpm exec vitest run procedure-material procedure-document assembly-procedure-document && pnpm exec tsc -p tsconfig.build.json --noEmit
    cd apps/web && pnpm lint && pnpm exec vitest run procedure-manuals document-editor && pnpm build

API は9ファイル69件成功、既存の実 PostgreSQL integration 1件は `TEST_DATABASE_URL` 未設定によりskip。Webは11ファイル49件成功。lint / API tsc / Web build は成功し、最終的な白紙追加後の未保存資産保持はcontroller7件・対象lint・Web tscで再確認した。実 DB・実端末での受入、commit / push / PR / merge / deploy は未実施。検証と環境準備は約10分。

環境準備: worktreeに依存がなく、offline install はキャッシュ不足、通常 install は DNS 解決不可で失敗した。main worktree の既存 node_modules を今回のworktreeへコピーし、workspace4パッケージをbuild、ローカル engine を指定して Prisma Client を生成した。Web buildで不足した Fontsource Sans 5.2.8 / Mono 5.2.7 は同版の既存 worktree キャッシュからコピーして解決した。依存定義・lockfile・元worktreeは変更していない。初回テストの不足distとWebのimport順序、選択モードのエラー文言assertionを修正して再確認した。

範囲外の観測: baseline-browser-mapping / Browserslist の古いデータとViteの大きなchunk警告は既存同様に残る。kiosk-sop の鮮度チェックと生成物更新は push 前の統合段階で行う。今回の変更禁止対象 `apps/web/src/generated/**` は触っていない。

### Phase 2b limited review fixes (2026-10-05)

指摘3件だけを修正。素材取込は PHOTO 行 create 成功直後に stat し、原本が消えていれば手元の buffer を create モードで再保存する。GC は削除直前に参照数を再確認する。通常文書取得・改版取得は ownedAssets を取得し、既存参照アセットと同じ DTO で assets に追加する。白紙追加成功時は未保存 overlay の復旧記録を新しい editVersion / updatedAt で即時保存し、同じ画面には自分の即時保存の復元確認を表示しない。

今回の変更ファイル(開始時点の未コミット差分からの追加修正のみ):

- 原本競合: `apps/api/src/services/assembly/procedure-material-gc.service.ts`、`procedure-material-gmail-ingestion.service.ts`。
- 文書取得: `apps/api/src/services/assembly/assembly-procedure-document.service.ts`、`assembly-procedure-document-revision.service.ts`、`assembly-procedure-document-revision.serializer.ts`、`apps/api/src/routes/assembly/procedure-documents.ts`。
- API テスト: `apps/api/src/services/assembly/__tests__/procedure-material-gc.service.test.ts`、`procedure-material-gmail.test.ts`、`procedure-document-placement.service.test.ts`、`assembly-procedure-document-revision.serializer.test.ts`、`apps/api/src/routes/assembly/__tests__/procedure-documents.routes.test.ts`。
- Web: `apps/web/src/features/assembly/document-editor/useAssemblyProcedureDocumentEditorController.ts`、`useAssemblyDocumentEditorRecovery.ts`、`useAssemblyProcedureDocumentEditorController.test.ts`。
- 正本: 本計画 `docs/plans/procedure-manuals-execplan.md`。

回帰テストは「候補選択後に参照登録」「再利用/新規保存直後にGC削除」「PHOTO配置→未保存→再読込→復元の表示URL」「白紙追加成功直後(750ms待機なし)の新版復旧記録」を確認する。既存アセットGCは active DRAFT の所有リースを保護するため変更していない。

最終変更後に上記の指定2コマンドを実行し、API lint / 9成功ファイル74件・1ファイル1件skip / build用tsc、Web lint / 11ファイル51件 / build が成功。実DB integration は `TEST_DATABASE_URL` 未設定のためskip。別途、既存アセットGCの所有リース保護テスト3件も成功した。検証は約4分。初回の追加テストで不足した findFirst モックとWeb import順序を修正し、白紙追加直後に自分の下書きの復元確認を出さないことも最終controllerテストで確認した。既存のBrowserslist / baseline-browser-mapping / chunkサイズ警告は残る。

## Concrete Steps and Validation (Phase 2c)

既存 worktree `feat--procedure-manuals-phase2c-approval` でローカル実装を行う。追加するモデルは `ProcedureManualApproval` のみで、migration `20261005180000_add_procedure_manual_approvals` は新テーブル・document FK(Cascade)・documentId/createdAt索引を作るexpand-only SQLである。社員情報は承認時点のスナップショットとして保存し、既存Knowledge/WorkInstructionテーブルの定義・挙動は変更しない。

`approve-publish` は `allowWriteKiosk` の認可後に社員タグを照合し、在籍中かつleader以上の場合だけ既存公開条件で公開する。認証actorは `user:<id>` または `client:<id>`。公開と承認行の作成は同一transactionで、競合・記録失敗時はどちらも残らない。文書取得・summary・改版取得はcreatedAt降順の直近1件を `lastApproval` として返す。要領書のsequenceにも伝播し、閲覧中の文書だけ承認氏名・職位・日時を下部に表示する。

エディタは社員タグ方式を既定とし、氏名・職位を確認後、任意コメントとともに公開する。従来のパスワード公開も選択できる。型番入力前でも割り当て候補を選べるが、追加は型番・工程・既存割り当て取得が揃うまで無効。空状態と表示名placeholderを指定文言に変更した。丸数字への移動ボタンはviewerの既定を維持し、閲覧ページからだけ非表示にした。

指定検証:

    cd apps/api && pnpm lint && pnpm exec vitest run procedure-manual procedure-document assembly-procedure-document && pnpm exec tsc -p tsconfig.build.json --noEmit
    cd apps/web && pnpm lint && pnpm exec vitest run procedure-manuals document-editor AssemblyProcedureSequenceViewer && pnpm build

結果: API lint・8ファイル55件成功・build用tscは成功(実DBintegration 1ファイル1件は `TEST_DATABASE_URL` 未設定のためskip)。Web lint・12ファイル62件・buildは成功。初回Web buildの依存不足を補った後はbuildだけを再実行した。検証と環境準備は約6分。既存のbaseline-browser-mapping / Browserslistデータ鮮度、Vite chunkサイズの警告が残る。

実DB migration適用と実NFC端末での確認は統合段階に残す。ローカルAPIテストはPrismaモックで、承認可能な3職位・general/未対応職位・在籍外・未登録/重複タグ・版競合・公開済み再実行・承認行保存失敗・パスワード公開・serializerを確認する。Webはタグ読取から氏名/職位確認・公開まで、パスワード方式、承認表示、候補と追加条件、閲覧時の丸数字非表示、既存ビューアの既定表示を確認する。

環境準備: 既存main worktreeの依存を今回のworktree内へコピーし、shared-typesをbuild、`pnpm exec prisma generate`で新Clientを生成した。コピー元のshared-types distが古かったため再buildして解消した。初回APIテストはserializerテストの状態初期化漏れ、Webの対象lintは追加testのimport順を修正した。初回Web buildはFontsource不足で停止したため、既存worktreeからpackage.jsonで指定されたSans 5.2.8 / Mono 5.2.7のキャッシュをコピーした。依存定義・lockfile・コピー元は変更していない。

## Validation and Acceptance (Phase 2a)

Gmail利用可能な検証環境で件名 `[Procedure-material] DFD1 組立`、本文とJPEG/PNG/WebP写真を送信し、要領書の「素材」から手動取込を実行する。本文1件と各写真が新しい順に現れ、ヒント・日時・送信元が表示される。ヒントで絞り込み、捨てた素材から戻せる。素材の原本が保存されたメールだけゴミ箱へ移動し、同じメールを再取込しても素材は増えない。本文空・PDF/動画のみのメールは未読の受信箱に残り、スキップ理由が返る。送信元不一致も保存せず残す。閲覧専用端末の書込は403になる。自動取込を有効化すると組込み行が起動し、無効化すると停止する。これらのローカル契約は上記モックテストで確認済みで、実 Gmail・実端末での受入は未実施である。

## Validation and Acceptance (Phase 1)

ローカルで API と Web を起動し、管理者としてキオスクの組立ホームから「要領書」を開く。機種が 0 件なら空の案内が出る。「割り当てを編集」で型番 `dfd6362xyz-3943173` を全角や小文字混じりで入力しても、保存後の機種一覧には `DFD6362XYZ-3943173` が 1 件だけ出る。工程「組立工程 > 組立工程」に公開済み手順書 2 件を並べて保存すると、閲覧側で 2 件がその順で表示され、ページ送りできる。同じ文書を別の型番の同じ工程にも割り当てると、両方の機種から同じ文書が開く。割り当て中の文書を既存の手順書管理から削除しようとすると「要領書の割り当てで使用中」の趣旨のメッセージで拒否される。割り当て中の文書の改版下書きを作っても、閲覧側は旧公開版を表示し続ける。

## Idempotence and Recovery

マイグレーションは追加のみで、初期行の投入は再実行しても重複しない。割り当て置換は 1 つの機種×工程単位のトランザクションで、失敗時は元の並びが残る。Phase 1 は既存テーブルの行を変更しないので、ロールバックは新ルートを使わないだけでよい。

## Artifacts and Notes

- 分析の指示文と結果(2026-10-05、Codex read-only)はセッションのスクラッチに置き、要点は本計画の Surprises & Discoveries に転記した。
- タスクボード: T51「機種×工程ごとの要領書(閲覧特化)」。

## Interfaces and Dependencies

新しいルート `/assembly/procedure-manuals/processes`(GET)、`/assembly/procedure-manuals/models`(GET)、`/assembly/procedure-manuals/models/:modelCodeKey/processes/:processId`(GET。割り当てと解決済み文書列)、同パス(PUT。割り当て置換)。既存の `AssemblyProcedureSequence` の直列化形(`serializeProcedureSequence`)を閲覧側の契約として再利用する。既存の公開契約(`/assembly/procedure-documents/*`、テンプレート、作業セッション)は変更しない。

## Outcomes & Retrospective

Phase 1 のローカル実装と指定の検証を完了した。文書は改版ルートで保存し、閲覧時には最新の active PUBLISHED 版へ解決する。公開版のない項目は個別に「公開版なし」と表示し、正常な項目は既存ビューアで閲覧できる。機種が 0 件でも編集入口から割り当てを作成できる。

実行結果: `apps/api` の `pnpm lint`、`pnpm exec vitest run procedure-manual`（2 ファイル・12 件）、`pnpm exec tsc -p tsconfig.build.json --noEmit` は成功。`apps/web` の `pnpm lint`、`pnpm exec vitest run procedure-manuals`（1 ファイル・4 件）、`pnpm build` は成功。変更境界の既存回帰テストは API 3 ファイル・4 件、Web ビューア 1 ファイル・4 件が成功した。必要な生成物の準備に `packages/shared-types`、`shelf-layout-core`、`part-search-core`、`kiosk-sop-core` の build を実行した。検証の実行・準備は約 7 分（待機・並列実行を含む）。

(上の段落は Codex のローカル実装時点の記録。)その後、使い捨て PostgreSQL で全 migration の適用と CHECK 制約を確認し、Codex の読み取り専用レビューがキオスク PDF 削除経路の抜けを捕まえたので修正した。PR #1693 は CI 全通過後に squash merge(`c5ed099d`)し、Pi5 へ run `20261005-015725-1df4cb` で反映、health 200 を確認した。Phase 1 は本番反映まで完了。Phase 1のオーナー実機確認は今回の依頼で完了報告を受けた。後続は Phase 2(素材取込・白紙ページ・NFC 承認)、Phase 3(ナレッジ連携)、動画。実装は Codex、レビューも Codex(read-only)、検証と統合は Claude という分担で進めた。

範囲外の観測: Web 検証で baseline-browser-mapping / Browserslist のデータ更新警告と Vite の大きな chunk の警告が出た。今回の依頼では依存更新や既存 bundle の分割を行っていない。

Phase 2a の変更記録(2026-10-05): 上記 Plan of Work を2a/2b/2cへ分割し、素材取込・棚・管理カード・組込みスケジュールのローカル実装を追加した。指定検証は API 80件・Web 13件、lint / tsc / build がすべて成功し、既存境界の回帰71件も成功した。検証と環境準備は約7分。本番用の永続マウント、実 DB migration、実メール・端末確認、commit以降の統合段階は未実施。

Phase 2c の変更記録(2026-10-05): NFC承認公開と承認履歴の直近1件表示、公開方法選択、割り当ての文言・候補選択、閲覧専用の丸数字移動非表示をローカル実装した。指定検証はAPI55件成功・実DB1件skip、Web62件成功、両lint / API tsc / Web build成功。開始時点に既存WIPはなく、今回の24ファイルの変更だけを残した。実DB・実端末、commit / push / PR / merge / deployは未実施。kiosk-sop鮮度チェックと生成物更新はpush前の統合段階に残し、変更禁止の `apps/web/src/generated/**` は変更していない。
