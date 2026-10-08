# 機種×工程ごとの要領書を、組立手順書を正本にして閲覧・作成できるようにする

This ExecPlan is a living document and must be maintained according to `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current while work proceeds.

## Purpose / Big Picture

現場では、機種(型番。例 `DFD6362XYZ-3943173`)ごと、工程(組立工程、検査工程)ごとに「要領書」を見たい。いまは組立キオスクの手順書(`AssemblyProcedureDocument`。画像ページに丸数字・チェック・締付トルクを重ねる文書)が、締付テンプレートの中からしか引けない。閲覧だけしたい人が、作業セッションやテンプレートを作らずに「機種を選ぶ → 工程を選ぶ → 要領書が開く」だけで済むようにしたい。あわせて、これから作る要領書を、素材(文・写真・のちに動画)をメールで送って取り込み、自由に配置して作り込めるようにし、フローティング Chat のナレッジ機能が集めた素材や承認済み手順も同じ要領書に取り込めるようにする。

この計画は、新しい文書エンジンを作らない。文書の正本は既存の `AssemblyProcedureDocument` 系(ページ画像、`AssemblyProcedureOverlayElement` による自由配置、改版 `AssemblyProcedureDocumentRevision`、DRAFT/PUBLISHED)のままとし、その上に「機種×工程の分類」「素材棚」「専用件名の Gmail 取込」を薄く足す。こうすると、ここで作った要領書を締付テンプレートの表示ステップ(`AssemblyTemplateProcedureItem`/`AssemblyTemplateProcedureStep`)にそのまま置けるため、「要領書と締付・チェックの組み合わせ」が変換なしで成立する。ナレッジ(`KnowledgeProcedure` 系)は素材と承認済み手順の供給元として片方向で連携し、文書モデルは統合しない。

利用者から見える完成の証拠は次のとおりである。キオスクの組立ホームに「要領書」の入口があり、開くと機種の一覧(型番、半角大文字で正規化)が出る。機種を選ぶと「組立工程 > 組立工程」「組立工程 > 検査工程」のような工程が出て、工程を選ぶと、その機種×工程に割り当てた要領書が並び順どおりに表示される。要領書は既存の組立手順書ビューア(ページ送り、丸数字などの注記表示)で開く。同じ要領書を複数の機種に割り当てられ、共通作業の文書を 1 つに集めて複数機種から参照できる。割り当てられている要領書は、既存の手順書管理から誤って削除・公開取消できない。

## Progress

- [x] (2026-10-08) 部品単位の要領書をローカル実装: 切削・研削の `subjectKind=PART`、手書きSQL、工程別キー正規化、公開文書だけの by-part API、両画面の部品候補・初回品番・一回スキャン・`part=`リンク、自主検査のチップ統合・件数・資料タブ・正式品番解決・取得失敗表示。PIN gateは維持。承認モック: `docs/design-previews/procedure-manuals-part-unit-mock.html`。
- [x] (2026-10-08) 部品単位のfocused検証: API 50件（Prisma mock、DB不要）、Web 143件を対象単位で確認。API/Webのtscとpackage lint成功、修正後の対象lintも成功。Prismaは通常生成がcache権限で失敗し、既存engine指定の `generate --no-engine` で型を生成。取説画面は変更なし、source digestのみrefresh。Gitの状態変更・秘密ファイル参照・DB migrationは行っていない。
- [x] (2026-10-08) 部品単位の要領書を main 統合・Pi5 配布: #1866 を main `4693d2c7` に統合(main CI 成功)し、run `20261008-094245-17c4c7`(18:42→18:47 JST、success、failed=0)で Pi5 に配布。api/web の image は `4693d2c7`、`/`・`/admin`・`/kiosk`・`/api/system/health` は 200。PR の CI で自主検査の e2e が 1 度失敗した(新しい by-part API が未モックで 404 になり、エラー表示が撮影対象チップの幅を奪った)ため、エラー表示を固定の小さい幅にし、e2e 2 本に by-part のモックを足した。migration `20261008120000_procedure_manual_part_subject` を含むので、前の image へ戻しても `subjectKind` 列と enum は DB に残る(追加のみ)。
- [ ] (2026-10-08) 部品単位の実機確認は未実施: 自主検査の品番スキャンから手順書のチップとタブが出ること、「見る」「作る・直す」で切削・研削を選ぶと部品一覧になること、切削・研削に機種名で登録済みの行が残っていないか(本番 DB の件数は未確認。残っていれば部品一覧に機種名のまま並ぶ)。migration の適用は release の成功と API の health 200 からの推定で、DB を直接は確認していない。

- [x] (2026-10-08) 素材棚の検索を広げる(本文・品名・メモ・PDF チップ): (1) メール本文で探す(#1843、merge ee73ab8e、Pi5 run 20261008-074019-080a55 成功)。本文の言葉で、その本文の素材と同じメールで届いた写真が一致する。(2) 品名・メモで探す(#1861、merge 0e0651f4、Pi5 run 20261008-084039-a4101a 成功)。生産日程の品番→品名(FHINCD→FHINMEI)から品番を引き、その品番を持つ加工の写真の素材と、件名・ファイル名に品番が単語として入っている素材を一致させ、カードに品名を 1 行出す。「加工の写真」タブはメモでも一致し、メモだけで一致したグループは一致した手順の写真だけを出す。「PDF」チップにメールで届いた PDF のページ画像(ファイル名が `… pN.jpg`)を含める。検索語は NFKC にそろえ、2 文字未満では品名の逆引きをしない。逆引きは新しい順に上限 2000 件で、品名で一致した素材に出す品番は一致した中の 1 つ。DB の変更は無い。実 DB の統合テスト 8 件を足した(手元は pgvector 入りの Postgres が必要)。戻す先の main は 4f9dc05a。Pi 上の応答時間と実機確認は未実施。残り: PDF の文字の既存分への付け直し(#1847 の後追い適用)、「意味で探す」の有効化とボタン(裏側は #1846)。
- [x] (2026-10-08) 素材棚の誤破棄と再発防止: 10/08 14:25 JST の 12 秒間に、未配置の素材 30 件が画面の「捨てる」1 回で捨てられた(削除は 0 件、総数 73 のまま)。利用者の指示で、その時刻に捨てられ文書にも置かれていない 30 件だけを `discardedAt = NULL` に戻した(件数が 30 でなければ中止する条件付き。結果は未配置 30 / 配置済み 42 / 捨てた 1、利用者が画面で確認)。原因は特定できていない。#1837 で選択が検索や絞り込みをまたいで残るようになり、見えていない選択まで捨てる対象だったことが有力。再発防止(#1856、merge 49127dc1、Pi5 run 20261008-071756-6afbb6 成功): 「捨てる」の対象を一覧に出ている選択だけにし、確認の件数もその数にした。表示外の選択は帯に「(表示外 N)」と出す。「捨てる」を主操作の隣から「選択を外す」の横へ移し標準の大きさにした。捨てた直後に「N 件を捨てました」と「元に戻す」を出す(次の選択、タブ切替、検索や絞り込みの変更、閉じるで消える)。検索語の反映待ちと読込中は捨てられない。閉じた束の中の選択は「束を全部選ぶ」の通常操作なので対象のまま。戻す先の main は 26e890c7。実機確認は未実施。
- [x] (2026-10-08) 左ペインのテンキーを縦 1 列に、「見る」ダイアログの枠をページの形に: #1844 の実機確認の指摘 2 点を直した。(1) 左ペインのテンキーを 3 列(幅 200px)から縦 1 列(1〜9、0、⌫、幅 64px、キー高さ 48px)にし、機種候補の幅を約 215px から約 350px に広げた(`KioskDigitTenkey` に並び順を渡す `digits` を追加。「白紙から作る」ダイアログは 3 列のまま)。(2) `AssemblyProcedurePreviewDialog` の画像の枠が「列の幅いっぱい・高さ 62vh まで」の箱で、重ねた要素が箱全体を基準に置かれてページとずれていたため、枠を画像の大きさに合わせた(組立の手順書一覧から開く同じダイアログにも効く)。検証: web vitest 244 files / 1796 件、tsc、lint、kiosk-sop source-check 成功(取説は digest の更新のみ)。PR #1850(merge `06acd313`)。Pi5 配布 run `20261008-060423-19b573`(15:04→15:08 成功、api / web とも `06acd313`、health 200)。戻し先はイメージ `4bfe6945`。ブラウザでの見た目は配布前に確認していない。**実機確認済み**(2026-10-08、所有者が 1920×1080 のキオスクで OK: 機種名が 1 行に収まる、「見る」の表示がつぶれず欠けない)。
- [x] (2026-10-08) 工程だけでの絞り込みと行の「見る」: 共通の左ペイン `ProcedureManualFilterPane` を「作る・直す」「見る」の両方で使い、機種未選択でも一覧を出す(工程ボタンは「全て・組立・検査・切削・研削」)。「作る・直す」の行の先頭に、編集操作のないダイアログで開く「見る」を足した(PIN の再確認なし)。「見る」画面は片方だけ選んだとき公開済みの一覧を出し(`GET /assembly/procedure-manuals/overview?published=true`。下書きの情報は返さない)、行を押すとその文書から開く(`AssemblyProcedureSequenceViewer` の `initialDocumentId`)。検証: web vitest 940 件、api 対象 39 件、両方の tsc と lint、kiosk-sop source-check 成功。Codex の読み取り専用レビューの指摘 3 件のうち 2 件(PIN なしの画面へ下書き情報が返る、押した文書と違う文書が開く)を修正し、1 件(機種をまたぐ一覧が全件取得で、件数が大きく増えると重くなる)は見送った。PR #1844(merge `95f884ff`)。Pi5 配布 run `20261008-052753-e352cd`(14:27→14:32 成功、api / web とも `95f884ff`、health 200)。戻し先はイメージ `d163baf6`。配布後の検証は新しい画面と overview の経路そのものを叩いていない。**実機確認**(2026-10-08、所有者が 1920×1080 のキオスクで確認): 工程での絞り込みと行の「見る」は動いたが、指摘 2 点(テンキーが幅を取り機種名が折り返す、「見る」の表示がつぶれて一部欠ける)があり、#1850 で修正した。「見る」画面で押した文書から開く点も、#1850 の配布後に所有者が OK と確認した。

- [x] (2026-10-08) 編集画面の認証切れをテンキーに揃える: 要領書の編集画面で認証が切れたとき(8 時間の期限、またはサーバーの 401/403)に出ていた古いパスワード入力欄の画面を、工房と同じ 4 桁の暗証番号テンキー(`KioskPinDialog`)に置き換えた。期限切れなどの通知はダイアログ内に 1 行で出し、再認証後も編集内容と元に戻す履歴を引き継ぐ(既存の動作)。取説の撮影スクリプト、操作ガイド、取説定義、E2E をテンキー入力に合わせ、取説を再生成した(Web のみ)。検証: web vitest 全件 3202 件成功、tsc、lint、kiosk-sop generate / source-check 成功。PR #1841(merge `d163baf6`)。Pi5 配布 run `20261008-051140-25d9e6`(14:11→14:16 成功、api / web とも `d163baf6`、health 200)。戻し先はイメージ `1fdcd392`。PR の CI は 1 回目、フローティングチャットの操作ガイドのテストが古い見出し「管理パスワードを入力」を待っていて 1 件失敗し、期待値を直して通した(ローカルの 1 回目は対象ディレクトリを絞っていて、このテストが入っていなかった)。オーナーの実機確認は 2026-10-08 に OK(認証が切れた編集画面でテンキーが出て、4 桁入力で編集に戻れる)。
- [x] (2026-10-08) 「外す」と「削除」を整理する: 工房の行に出す操作を 1 つにし(下書きの初版で割り当てがこの機種×工程だけなら「削除」、それ以外は「外す」)、「他の使用先」を行と確認ダイアログに出す。手順書一覧に「使用先」列と「未使用」の絞り込みを足し、割り当て中の文書は削除を押せなくする。両画面の行内アイコンにエディタと同じ用途表示(ホバー / フォーカス / 長押し)を付ける。PR #1839(merge `1fdcd392`)。Pi5 配布 run `20261008-034209-800553`(12:42→12:47 成功、api / web とも `1fdcd392`、health 200)。戻し先は main `4d9d4f27` / イメージ `c7d3e617`。PR の CI は 1 回目、新フィールドを返さない E2E のモック応答で一覧が落ちて 2 件失敗し、API クライアントで既定値を空配列にして通した(取説生成のモック応答も同じ原因で一度失敗)。**実機確認済み**(2026-10-08、所有者が 1920×1080 のキオスクで 4 点とも OK: 行のボタンが 1 つ、他の使用先とダイアログ文言、一覧の使用先・未使用・使用中の削除不可、アイコンの用途表示)。
- [x] (2026-10-08) 素材棚の検索を作り直す: 検索欄を全タブ共通の 1 つにし、検索語または絞り込みが有効な間は 4 タブの一致件数を出す(一覧は(タブ, 検索語)ごとにダイアログが開いている間は再利用、失敗したタブは再訪で取り直す)。絞り込みチップ(出どころ / 種類 / 期間。選べる値が 1 つのグループは出さない)、検索中は束ねず平らに並べる、一致箇所の強調、検索語を変えても選んだ素材が残る下部の帯(主操作ボタンは帯へ移動)。API は未配置・配置済みの `q` を `subjectHint` と `originalFileName` の部分一致にし、全角半角は元の語と NFKC の両方で当てる。承認済みモックの「投稿者」の絞り込みは不要と決定し、「意味で探す」は別 PR(未着手)。検証: api 対象 98 件、web 対象 145 件、両方の型チェック、全体 lint、見本データでの 1600x900 画面確認。Codex の読み取り専用レビューの指摘 4 件(部分成功時の他タブのキャッシュ、失敗タブの再取得、片側だけの NFKC、強調位置のずれ)を修正。PR #1837(merge `c7d3e617`)。Pi5 配布 run `20261008-030538-f197dd`(12:05→12:11 成功、api / web とも `c7d3e617`、health 200)。戻し先は main `d962af13`。PR の CI は 1 回目、Deploy impact 表の禁止語(「選択」)で change-classification が落ち、本文だけ直して通した。**実機確認は未実施**(タブ件数、チップ、選んだまま検索語を変えて配置)。
- [x] (2026-10-08) 素材棚の表示を速くする: カードは長辺 640px の縮小画像を新しい 3 経路(棚の素材 / ナレッジ / 加工の写真)から取り、原寸は ⤢ を押したときだけ取得する。縮小結果は API のメモリに上限付きで持ち、画面側は取得済みの縮小画像をダイアログが開いている間は再利用する(同時取得は上限付き)。検索欄は 300ms の入力待ち。「加工の写真」一覧はグループ読み取りを順序と limit を変えずに並行化した。PR #1836(merge `d962af13`)。Pi5 配布 run `20261008-023902-a6a181`(11:39→11:44 成功、health 200)。戻し先は main `77d3e639` / イメージ `50810dc2`。配布後の検証は縮小画像の経路そのものを叩いていない。**実機確認は未実施**(4 タブの写真、⤢ の原寸、「加工の写真」一覧、体感の速さ)。
- [x] (2026-10-08) 部品をほかのページで使う: 部品ペインに「このページ / ほか」の切替を追加し、ほかのページの部品を現在ページへ複製して置けるようにした(Web のみ、undo 1 回で取り消し、読み取り専用・処理中は置けない)。検証: `vitest run src/features/assembly` 617 件成功、web lint、`tsc -b` 成功。PR #1832(merge `50810dc2`)。E2E は CI で確認(ボタンの accessible name は実ブラウザで「このページ0」と空白なしになるため、ロケーターは正規表現にした)。2026-10-08 に Pi5 へ反映(run ID `20261008-005300-2a4a86`、failed=0、api・web とも `50810dc2`、health 200)。オーナーの実機確認は 2026-10-08 に OK(「ほか」から別ページの部品を置ける、元に戻す 1 回で消える、複製を変えても元は変わらない)。
- [x] (2026-10-07) 本番反映の記録 9: #1808(矢印の反転・線幅 0.5・重なり順の振り直し)を merge b938e2dd(15:40、追跡 04 不在のためユーザー許可でこのセッションが merge)、Pi5 release run 20261007-064737-e5225d(15:47→15:52 success、failed=0)。#1809(素材棚の分類と加工候補の上限 1000)を merge b9465e24(16:44)、run 20261007-075604-af7d5b(16:56→17:02 success)。#1810(矢印の 8 方向「向き」と線・矢印の実寸描画)を merge 9792ae8f(17:39)、run 20261007-084633-3c25d5(17:46→17:52 success)。いずれも稼働イメージ api/web が merge SHA、/・/admin・/kiosk・/api/system/health 200、API エラーログ 0 件、Pi4/Pi3 対象外。実機確認はユーザー待ち(素材棚の束、矢印の向き)。
- [x] (2026-10-07) 実機指摘(#1808 反映後): 矢印を右上・左下へ向けられない。始点・終点が範囲の左上→右下の対角で作られ、反転しても逆対角にしかならないため、右ペインに「向き」の 8 方向ボタン(斜めは対角、上下左右は辺の中点同士)を追加。レビューで、線・矢印の描画が正方形前提(viewBox 0 0 1 1)で細長い範囲では線が中央に縮む既存不具合が判明し、範囲の実寸(px)で描き矢じりは線幅比例にする修正も同梱。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-07) 実機指摘: 素材棚の「加工」写真が 60 件までで全件出ず、全件出すと分類が無いと見渡せない(未配置も同様)。承認済みモック `docs/design-previews/material-shelf-grouping-mock.html` のとおり、カードを折りたためる束にする(加工は品番ごと、未配置/配置済みはヒントごと、ヒントなしは最後。見出しに件数と「束を全部選ぶ」。最初は先頭だけ開き、検索時は該当する束だけを開く)。加工の上限は Web 1000 件(API の丸め上限も 1000)。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-07) 実機確認(全項目 OK)後の指摘 3 件: 矢印の向きを変えられない → 右ペインに「向きを反転」(始点・終点を入れ替え)。線幅の刻み 0.1% が細かい → 0.5%。前面へ/背面へで最前面に出せない要素がある → 隣と zIndex を交換する方式では同値の要素が動かないため、同一ページの要素を並び順で 0..n-1 に振り直す方式にし「最前面へ/最背面へ」を追加。4 件目(素材棚の「加工」写真が 60 件までで分類が無い)は分類案のモックを提示、承認待ち。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-07) 本番反映の記録 8: #1800(「範囲」ツールを貼った素材に: 合成切り出し + OCR 候補)を merge 1d2a37bc(13:48)、Pi5 release run 20261007-050224-5c4fd8(14:02→14:07 success、#1784 と同じ回、recap ok=272 changed=31 failed=0)。#1801(PDF 素材から要領書を直接作る)を merge 77b69278(14:38)、Pi5 release run 20261007-055217-a56965(14:52→14:57 success、同 recap)。migration 20261007150000_add_procedure_material_pdf_kind は 14:53:55 JST に適用(rolled_back なし、enum ProcedureMaterialKind = TEXT/PHOTO/PDF)。稼働イメージ api/web 77b69278、health 200、API エラーログ 0 件。実機確認はユーザー待ち(取り込み、範囲ツール、PDF カードの「要領書を作る」)。
- [x] (2026-10-07) 要望と本番反映: 加工要領書の写真を素材棚から選べるようにした(#1790)。素材棚に「加工の写真」タブを足し、公開中の加工要領書の手順写真(ACTIVE のみ、公開版 ID のない移行前データは対象外)を品番・対象で探して「棚に取り込む」。「ナレッジから」と同じ型で、選んだ写真だけを `procedure-materials/<sha256>/original` へコピーして `origin=WORK_INSTRUCTION` の写真素材を作る(写真だけ。注釈は持っていかない)。品番・対象・手順番号・表示メモは nullable 列 `workInstructionRef` に取込時点の値を写し、カードに「加工」バッジと一緒に出す。取込 API は候補キーを公開中データでサーバー側再解決し、クライアントの品番・対象は探す場所の手がかりにだけ使う。migration `20261007000000_add_procedure_material_work_instruction_origin` は expand-only。配布時の検証が `ALTER TYPE ... ADD VALUE` を拒否するため、この 1 文だけを完全一致で許可した。merge b09ee343(14:18)、Pi5 release run 20261007-053213-60e2b9(14:32→14:36 success、recap ok=272 changed=31 failed=0 unreachable=0)、稼働イメージ api/web b09ee343、/・/admin・/kiosk・/api/system/health は 200。migration は 14:33:58 に適用済みで、enum 値 WORK_INSTRUCTION と jsonb 列を確認。戻すときの注意: 加工の写真を 1 件でも取り込んだ後は、旧 Prisma Client が新しい enum 値を読めないため、この PR より前へ戻さず前進修正する。実機確認は未実施。
- [x] (2026-10-07) 要望(案 1): 素材として届いた PDF から要領書を直接作る。取込で元 PDF を kind PDF の素材として保存(expand-only migration で enum 追加)し、素材棚の「要領書を作る」で組立手順書の取込と同じ `importDraft` を使って文書化(ページ画像 + 元 PDF を保持、範囲ツールの文章候補が文字層から効く)。作成後は素材を配置済み扱い。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-07) 本番反映の記録 7: #1794(写真は 25 MiB 受付・保存 1 MiB に段階縮小、PDF 25 ページ、画素数上限)を Pi5 へ反映。merge 63791e00(13:03)、Pi5 release run 20261007-041311-2e4a75(13:13→13:18 success、recap ok=272 changed=31 failed=0 unreachable=0)、稼働イメージ api/web 63791e00、health 200、API エラーログ 0 件。実機確認はユーザー待ち(未読で残る PNG/PDF メールが「今すぐ取り込む」で入るか)。
- [x] (2026-10-07) 要望: 「範囲」ツールを貼った素材にも効かせる(案 2)。範囲ツールはページの元画像だけを切り出し、文章候補は元 PDF の文字層からだけ拾うため、白紙 + 素材の要領書では効かなかった。Web が範囲と重なる画像要素(assetId/bbox/zIndex/objectFit/opacity)を送り、API がページと素材を合成して切り出す。文章候補は PDF 文字層を優先し、無ければ合成した範囲だけを既存の画像 OCR(tesseract.js 日英、位置付き)に掛けて行ごとの候補にする。案 1(PDF から要領書を直接作り文字層を保持)は続けて実施。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-07) 実機指摘(#1789 反映後に理由が見えた): PNG が「10 MB超過」、PDF が「20 ページまで」で除外。オーナー指定: 写真は受け付け 25 MB、保存は 1 枚 1 MiB 以内(長辺 2000→1600→1200px の順に縮小・元形式で再エンコード、PNG は量子化まで試し、収まらなければ理由付きで除外。EXIF 向き反映)。PDF のページ上限は 25(Poppler アダプタに maxPages を追加、Hermes 側の既定 20 は不変)。添付数の上限は設けない(Gmail の 1 通 25 MB が実質の上限)。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-07) 本番反映の記録 6: #1789(非標準 MIME の拡張子判定 + 添付ごとの除外理由表示)を Pi5 へ反映。merge 983722d4(12:09)、Pi5 release run 20261007-032350-30ac43(12:23→12:29 success、recap ok=268 changed=31 failed=0 unreachable=0、#1787/#1786 と同じ回)、稼働イメージ api/web 983722d4、health 200、API エラーログ 0 件。実機確認はユーザー待ち(未読で残る PNG/PDF メールが「今すぐ取り込む」で入るか、入らなければ種類付きの理由が出るか)。
- [x] (2026-10-07) 本番反映の記録 5: #1783(「今すぐ取り込む」の見える化 + Outlook の汎用 MIME 添付)を merge 38c5dfa4(11:10)、Pi5 release run 20261007-021825-efa054(11:18→11:23 success、recap ok=268 changed=31 failed=0)。#1785(PDF を各ページの写真素材に)を merge 7c8905c3(11:24)、Pi5 release run 20261007-023303-ecc84b(11:33→11:38 success、同 recap)。稼働イメージ api/web 7c8905c3、health 200、API エラーログは配布直後の「premature close」1 件のみ(無関係)。反映後の実機で PNG 添付がまだ「対応外」のため、添付ごとの除外理由(MIME 付き)の表示と、image/*・application/* の非標準 MIME でも拡張子で判定する修正を続けて実施。
- [x] (2026-10-07) 実機確認と指摘: オーナーが #1815/#1816/#1818 の 3 点(素材棚の束、長押しの動詞、部品ペイン)を実機で確認し問題なし。追加指摘「右の属性パネルがページに重なる、ドキュメントを左に寄せれば足りる」。属性パネル(右端から 420px、キャンバス列へ 356px 食い込む)が開いている間だけキャンバス列の右に 372px の余白を取り、キャンバスの ResizeObserver でページ画像を左へ収め直す(`AssemblyProcedureDocumentEditorScreen.tsx`)。下部の通知帯も同じ条件で幅を抑える。取説(kiosk-sop)を再生成(属性 3 画面と競合画面)。vitest 39 件成功(新規 1 件)、eslint、tsc --noEmit。main 統合・本番反映は追跡セッション待ち。
- [x] (2026-10-07) 本番反映の記録 6: #1822(属性パネルの重なり修正、取説再生成)を merge d3136510 で 20:31 に、Pi5 へ 20:44 に反映(run 20261007-113836-6f0c98、success、failed=0、changed=31、api/web とも d3136510、health 200、API エラー 0)。Pi4・Pi3 は対象外。オーナーが実機確認済み(2026-10-07 夜、「重なってない」)。要領書 T51 の実機指摘はすべて解消。
- [x] (2026-10-07) 要望: PDF も素材として取り込む。`application/pdf`(汎用 MIME + .pdf を含む、10 MB 以下)の添付を、既存の Poppler ページ描画(1〜20 ページ、暗号化は不可)で各ページ JPEG にし、ページごとに写真素材として保存(題名「ヒント (p1/3)」、ファイル名「名前 p1.jpg」、ページ単位の重複キー)。描画失敗は除外理由として表示。Excel は要望取り下げ(取込は非対応のまま)。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-07) 本番反映の記録 5: #1815 + #1816(素材棚の束ねルール)を merge 8304abaa で 19:00 に、#1818(記号の動詞チップ、部品ペイン、新規要素の zIndex、取説再生成)を merge c6542dd0 で 19:49 に、それぞれ Pi5 へ反映(run 20261007-095428-a98bf3、20261007-104343-c7689b、ともに success、health 200、API エラー 0)。Pi4・Pi3 は対象外。#1818 の CI では操作ガイドのテストのターゲット検出、取説生成の画像待ち(2 枚決め打ち)、E2E の記号ボタン名の 3 点を直した。実機確認(束、長押しの動詞、部品ペイン)はオーナー待ち。
- [x] (2026-10-07) 実機要望: エディタ右端の記号の働きが分からない、重なった文字・図形・画像が見分けられない。承認済みモック `docs/design-previews/editor-rail-tips-and-overlap-mock.html` のとおり、記号は記号のままで乗せたとき(キオスクは長押し 0.5 秒)に動詞 1 語のチップを出す(`EditorIconButton.tsx`、`title` は廃止)。ページ一覧の右隣に「部品」ペイン(`AssemblyProcedureDocumentEditorPartsPane.tsx`、幅 280px、つまみで開閉し端末ごとに記憶)を置き、そのページの要素の縮小版(`AssemblyProcedureOverlayLayer` + `crop`)を前から順に並べる。押すと選択、前へ出す/後ろへ下げる/隠す(編集中だけの一時非表示)。記号ペインと範囲から置いた新規要素の zIndex を同一ページの最大 + 1 に(下に潜る不具合の修正)。Codex(`gpt-6.1-sol`/`high`)が実装、Claude が差分を確認。Web のみ、Pi5 配布。
- [x] (2026-10-07) 実機指摘: 素材棚の「未配置」で PDF のページ写真が束にならない(#1785 がページごとに「<ヒント> (pN/M)」を付けるため #1809 の束がページごとに分かれ、ヒントなしの PDF は全ページが「ヒントなし」に入る)。オーナー承認の束ねルール(Decision Log 参照)を `procedure-material-grouping.ts` の `groupMaterials` に実装。Codex(`gpt-6.1-sol`/`high`)が実装、Claude が束の並びを「束内で最も新しい受信日時」に直した。Web の単体テスト 8 件追加(束ね 50 件、procedure-manuals 配下 123 件成功)、eslint、tsc、kiosk-sop の source digest 更新。Web のみ、Pi5 配布。
- [x] (2026-10-07) 実機指摘: Gmail に対象メールが 2 通あるのに「今すぐ取り込む」が全部 0 件・理由なしで原因が分からなかった。手動実行は 5 分の再試行待ちに当たると黙って飛ばし、見つけた件数も表示せず、定期実行の結果もログに出ないため。手動実行は再試行待ちを無視し、結果に「見つけた N 通・再試行待ち N 通」と理由を表示、定期実行の結果(件数と各メールの status/reason)を構造化ログに出す。取込履歴 DB で判明した原因は、Outlook が添付 PNG を汎用 MIME で送り「対応外の添付」になっていたこと(もう 1 通は PDF で仕様どおり対象外)。MIME が汎用なら拡張子で写真/動画の種類を決め、中身は従来どおり検証する。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-07) 本番反映の記録 4: #1779(inline 写真の取り込みと「今すぐ取り込む」の修正)を Pi5 へ反映。merge a7f85ceb(10:08)、Pi5 release run 20261007-011642-ba6c16(10:16→10:21 success、recap ok=268 changed=31 failed=0 unreachable=0)、稼働イメージ api/web a7f85ceb、/・/admin・/kiosk・/api/system/health 200、API エラーログ 0 件。実機確認はユーザー待ち(Outlook からの写真が棚に入ること、「今すぐ取り込む」が動くこと)。
- [x] (2026-10-07) 実機指摘: PC の Outlook から送った写真が素材棚に入らず、文章の素材に「[cid:…]」だけが残った。Outlook や iPhone メールは写真を Content-ID 付きの inline パートで送るが、resolver は inline 画像を署名ロゴ扱いで捨てていたため。inline でも画像は写真として取り込み(16 KiB 未満の inline 画像だけ除外)、本文から [cid:…] の目印を除き、残りが空なら文章の素材を作らない。Codex(gpt-6.1-sol/high)実装。あわせて、素材棚の「今すぐ取り込む」が「Cannot read properties of undefined (reading 'configPath')」で落ちる不具合(#1696 以来。手動取込ルートが BackupConfigLoader.load を切り離して呼び this を失う)を修正し、回帰テストを追加。
- [x] (2026-10-07) 本番反映の記録 3: #1771(配置済み素材の再利用)を Pi5 へ反映。merge 0a5dd86a(08:11、追跡セッション不在のためユーザー許可でこのセッションが merge)。main の release-api-image が sharp 0.35.4 の新勧告(GHSA-wq5f-xc86-pv6w)で赤になったため、#1774 で sharp 0.35.5 に更新(merge 7c6a67be、08:38)。Pi5 release run 20261006-234729-189aef(08:47→08:55 success、recap ok=268 changed=31 failed=0 unreachable=0)、稼働イメージ api/web 7c6a67be、/・/admin・/kiosk・/api/system/health 200、API エラーログ 0 件。実機確認はユーザー待ち(素材棚の「配置済み」タブから別の要領書に貼れること)。
- [x] (2026-10-07) 実機要望: 配置済みの素材も選べるように。API は配置の前提を「捨てていない」だけにし、配置のたびに documentId/placedAt を最後の配置先で上書き(画像は毎回新しい asset をコピー、捨てた素材は 409)。エディタから開く素材棚にも「配置済み」タブを出して配置・差し替えに使え、配置済みタブでは「配置を取り消す」を出さない。未配置の件数(貼り忘れの目安)の意味は維持。Codex(gpt-6.1-sol/high)実装。
- [x] (2026-10-06) 夜 本番反映の記録 2: #1768(画像の「素材から差し替え」とハンドルの重なり修正)を Pi5 へ反映。merge 19ce5861(22:27)、run 20261006-133541-8aa713(22:35→22:41 success、recap ok=268 changed=31 failed=0 unreachable=0)、稼働イメージ api/web 19ce5861、/・/admin・/kiosk・/api/system/health 200、API エラーログ 0 件。実機確認はユーザー待ち(画像の差し替え、ダイアログ上にハンドルが透けないこと)。
- [x] (2026-10-06) 夜 実機指摘 2: 右ペイン「画像」の asset ID 入力とファイル選択(タッチ端末では使えない)を外し、「素材から差し替え」1 ボタンに(素材棚を差し替えモードで開き、選択中の画像要素の assetId だけを更新、位置・大きさ・重なり順・マスク維持、undo 対応、画像素材のみ・単一選択)。選択中要素のリサイズハンドル(z-index 1,000,000)が素材ダイアログの上に透けていたのを、OverlayLayer の根元に isolate を足して閉じ込め。Codex(gpt-6.1-sol/high)実装、読み取り専用レビュー 3 件(非画像素材の配置済み化、複数選択、無言の失敗)を反映。取説の「画像」手順を差し替えに更新し再生成。
- [x] (2026-10-06) 夜 本番反映の記録: 追加要望 4 本と右ペイン修正をすべて Pi5 へ反映。#1759 fa6ac722(run 20261006-110604-c1c17f)、#1760 473df6f5(#1764 と同じ run 20261006-113032-20d958、releaseSha 4c9e0df5)、#1762 0c2d2331(run 20261006-115306-10a989、20:58 success)、#1763 42d78881(run 20261006-121854-706567、21:24 success)、#1766 c4dfbbdc(run 20261006-124604-64ebfc、21:51 success、recap ok=268 changed=31 failed=0)。いずれも /・/admin・/kiosk・/api/system/health 200、API エラーログ 0 件。#1763 の最初の head は CI の kiosk-sop で視覚差 10.7%(ローカル撮影の描画不足)となり、該当 1 枚を撮り直して通過。実機確認(5 項目)はユーザー待ち。
- [x] (2026-10-06) 夜 実機指摘: 直す・下書き画面の右ペイン(属性)の入力欄が白地に白文字で見えない(共通Inputの既定色をTailwindの定義順で上書きできていなかった)、文字が小さい、比率の桁数が多い、を修正。白背景・濃い文字に統一、入力18px・ラベル14px、比率は小数1桁の%表示(内部は比率のまま)。Codex(gpt-6.1-sol/medium)実装、Web lint / 指定vitest 35ファイル387件 / build成功。取説の説明文を%に更新し再生成。
- [x] (2026-10-06) (B) テンプレート新規/改版の全高配置・左の段階/工程/ページ・64px記号列・重なる設定をWebのみ実装し、取説撮影手順を更新。Web lint / 77ファイル526件(ワーカー2) / build、capture adapter 1件成功。目視確認はlisten EPERMで未実施。既存WIPを保持し、commit等は未実施。 レビュー 4 件と e2e を反映（Web 78ファイル531件・build、adapter 1件、e2e構文33件成功。e2e実行はClaude担当、生成済み取説は未更新）。 左ペインの切替方式に変更（工程・文書・手順、文書ライブラリを1段にし、手順の高さを有界化）。 指定検証: Web lint / Vitest 78ファイル531件 / build、adapter 1件、Playwright一覧取得33件成功。e2e実行はClaude担当。
- [x] (2026-10-06) 夕 (A): Webの記号列の戻るを最下段へ移動し、工房を460pxの機種列＋一覧の2列、テンキー200px＋工程一覧の横並びへ変更。Web lint / 指定vitest 17ファイル219件 / build成功。Git操作・取説digest更新・本番反映は未実施。
- [x] (2026-10-06) ブラッシュアップ(D): 記録確認の56px上辺・460px一覧/即時検索・並列実績表・承認札をWebのみ実装（NFC承認処理維持）。Web lint / 指定vitest 76ファイル526件（対象15件、ワーカー2）/ build成功。目視はChromium起動失敗で未実施。 レビュー 3 件を反映（再読込・一覧内の再試行、トルク列見出し、承認札横のNFC照合通知）。 修正後の指定検証: Web lint / `vitest run KioskAssemblyRecordApproval` 1ファイル20件（5件追加）/ build成功。
- [x] (2026-10-06) 夕 (C): Webの手順書/テンプレート切替、56px表・44px記号操作・可視サムネイルを実装。絞り込みを切替後も保持し、再読込/解除は上辺に配置。取説は改版撮影だけテンプレート側へ切替。Web lint / vitest 77ファイル525件（ワーカー2）/ build、capture adapter 1件成功（最終検証約6分）。目視はlisten EPERM、Git変更操作・本番反映は未実施。 レビュー 3 件を反映（可視ペインのみ描画して撮影見出しを1つに統一、テンプレート上辺の可変幅・折り返し、範囲退出とペイン切替でサムネイル参照を解放）。単体5件追加、Web lint / 指定vitest 77ファイル530件（ワーカー2）/ build、capture adapter 1件成功。
- [x] (2026-10-06) 実機確認午後 (a): 共通テンキー・8時間アクセス、エディタ全高配置・記号列・浮遊属性・通知をWebのみ実装。Web lint / 255ファイル1569件(ワーカー2、最終対象79件再確認) / build、capture adapter 1件成功。取説生成はClaude担当、実画面確認はlisten EPERMで未実施。レビュー 8 件を反映(Web lint、255 ファイル 1599 件、build、capture adapter 1 件成功)。
- [x] (2026-10-06) 実機確認 (b) 3・4: 工房を56pxの表形式・状態/名前の即時絞り込み・44px記号操作へ変更し、組立ホーム上辺を文字だけの6項目へ整理。レビュー 3 件を反映（サムネイルの可視範囲での遅延取得、概要APIの公開版承認情報の一括取得と表示、sr-only列見出しとページ数の読み上げ）。Web lint / 指定vitest 76ファイル478件 / build成功、件数バッジ追加確認はホーム17件成功。目視確認は環境の起動権限制限で未実施。Git操作・本番反映は未実施。 レビュー修正後の指定検証: API lint / vitest 4ファイル42件 / tsc、Web lint / vitest 76ファイル482件 / buildすべて成功。
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
- [x] (2026-10-05) Phase 2c: 使い捨て PostgreSQL で migration 適用を確認。Codex レビューの 2 指摘(ロック待ち中に別要求が公開した場合の 409 維持、アーム中の NFC 読み取りが在庫分類の URL に社員タグ UID を残す点)を修正。CI では e2e(公開ダイアログの既定がタグ承認に変わった)と kiosk-sop(ダイアログの見た目変更)が失敗し、e2e のパスワード経路選択と取説の再生成で解消。
- [x] (2026-10-05) PR #1702 を main へ squash merge(merge `e0ee5fca83b0ce93d2c2e202b764e922befdefd6`)、main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261005-060455-41a4ce`、`Result=success`、recap `ok=268 changed=31 unreachable=0 failed=0`)、`/api/system/health` 200。
- [ ] 実機確認(オーナー): エディタの「公開」で「社員タグで承認して公開」が既定で出る、班長以上のタグで承認者名が表示され公開できる、一般職のタグは拒否される、要領書ページに承認の 1 行が出る。
- [x] (2026-10-05) 素材 Gmail の許可送信元ドメインをローカル実装。`allowedSenderDomains` は既定 `thkintechs.co.jp`、正規化・重複除去・形式検証を行い、空配列は全拒否。管理カードで追加・削除を即時保存し、最後の1件の削除は確認する。取込のドメイン完全一致と既存 `fromEmail` の併用、未読・5分待機を維持。commit / push / PR / merge / deploy は未実施。
- [x] (2026-10-05) 許可送信元ドメインの指定検証: API lint / `vitest run procedure-material backup-config` 6ファイル86件 / build用tsc、Web lint / `vitest run procedure-manuals-gmail CsvImport` 5ファイル33件 / build が全て成功。依存がないworktreeのため既存checkoutから独立コピーし、共有パッケージbuildとPrisma Client生成を実施。WebテストのReact Queryコンテキスト引数に合わせた検証修正、およびlockfileと同じフォント依存のローカル補完後に成功。統合・本番反映は未実施。
- [x] (2026-10-05) Phase 3 ローカル実装: 由来・出典のexpand-only追加、整理済みChat素材と公開ステップの候補一覧・画像配信・明示選択取込、素材棚のナレッジタブと由来表示を追加。ナレッジ側は読み取り専用。
- [x] (2026-10-05) Phase 3 指定検証: API lint / 6ファイル96件 / build用tsc、Web lint / 3ファイル29件 / buildが成功。Prisma Client生成と差分の空白確認も成功。
- [x] (2026-10-05) 送信元ドメイン制限(既定 `thkintechs.co.jp`、管理画面で追加・削除)と Phase 3 を 1 つの PR にまとめた(オーナー指示)。使い捨て PostgreSQL で migration 適用を確認。Codex レビューの 3 指摘(原本と表示画像の取り違え、10,000 字超の本文分割、候補の再計算)を修正。管理カードの設定競合は在庫カードと同じ既知の制約として残す。
- [x] (2026-10-05) PR #1704 を main へ squash merge(merge `1f54ba22bb5172868a7b4ad9bc9a68b504638908`)、main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261005-070906-5007dd`、`Result=success`、recap `ok=268 changed=31 unreachable=0 failed=0`)、`/api/system/health` 200。
- [ ] 実機確認(オーナー): 管理画面のカードに許可ドメイン `thkintechs.co.jp` が出る、他ドメインからの `[Procedure-material]` メールが取り込まれない、素材棚の「ナレッジから」に候補が出て取り込める。
- [x] (2026-10-05) 動画 V1のローカル実装: メール動画取込、Pi5変換Port/adapter/排他worker、Range配信・棚・再試行・破棄復元、DRAFTページ紐づけと改版継承、READYサムネイル閲覧を追加。
- [x] (2026-10-05) 動画 V1指定検証: API lint / 16ファイル186件成功・実DB1件skip / build用tsc、Web lint / 12ファイル75件 / build成功。スケジューラー登録7件・要領書サービス回帰7件も成功。Prisma Client生成と手書きDDLのschema一致を確認。
- [x] (2026-10-05) 動画 V1: 使い捨て PostgreSQL で migration 適用を確認。Codex レビューの 3 指摘(READY commit 前の原本削除、1 フレーム動画のポスター、ffmpeg の強制終了)と長いトランザクション保持を修正。CI では「追加のみ」検証が `ALTER TABLE ... ADD CONSTRAINT` を拒否したため外部キーを `CREATE TABLE` 内に移し、エディタの取説を再生成。
- [x] (2026-10-05) PR #1706 を main へ squash merge(merge `b8cafa6b5660324d7ae77944e07c1724397d6e30`、追跡セッションが実施)。main の push CI で API イメージが圧縮上限 1.0 GB を超過(1,063,981,159 バイト。Debian の ffmpeg が約 88 MB)。配布を通すため #1708(merge `e93b28ac`)で ffmpeg を一時的に外し、オーナー判断で #1709(merge `a25fe544a7c6bcc40400a20141da17fb67daad41`)で上限を 1.1 GB に引き上げて ffmpeg を戻した(静的ビルドは arm64 で約 113 MB 圧縮と Debian 版より大きく不採用)。
- [x] (2026-10-05) Pi5 へ標準ローリング更新(run `20261005-093506-d09ffd`、releaseSha `a25fe544`、`Result=success`、recap `ok=269 changed=33 unreachable=0 failed=0`、約 14 分)。health 200、API コンテナで `ffmpeg version 5.1.9-0+deb12u1`、`/app/storage/procedure-videos` あり、migration `20261006000000_add_procedure_videos` 適用済み。追跡セッションの報告による。
- [ ] 実機確認(オーナー): 動画付きの `[Procedure-material]` メールを送ると「動画」一覧に出て数十秒で完了になり再生できる、縦動画の向きが正しい、エディタでページに紐づけると閲覧ページにサムネイルが出る。
- [x] (2026-10-05) UX 改善(1 回目) A/C ローカル実装: モックの左600px・操作2行・全高ビューア、閲覧専用layoutと縦横比による表示サイズ、左側の手順/承認/動画、1760×980相当の素材棚・6/4/3列・複数選択・順次配置・原寸表示を追加。APIのgetAssignmentsは承認とページ別動画を既に返すため変更不要。
- [x] (2026-10-05) UX 改善(1 回目) 検証: Web lint、対象範囲とKioskLayoutの72ファイル384件(既存作業セッション回帰を含む)、build、API lint・要領書3ファイル28件・build用tscが成功。Safariで実コンポーネントとダミーデータを1920×1080に描画し、全体/幅表示と素材棚4列を目視確認。commit/push/PR/merge/deployと取説再生成は未実施。

- [x] (2026-10-05) UX 改善(2 回目) B/D ローカル実装: 加工・切削・研削の初期行、モックBの1180px・3列の名前組み立て・直接入力・重複採番、作成時の末尾自動割り当てと失敗表示、端末/ユーザー単位の5分編集予約・引き継ぎ・30秒生存確認・離脱時keepalive解放を追加。A/Cの表示・素材棚の挙動は維持。
- [x] (2026-10-05) UX 改善(2 回目) 指定検証: API lint / vitest 10ファイル81件成功・既存実DB1件skip / build用tsc、Web lint / vitest 14ファイル94件 / build成功。Prisma Client生成、差分の空白・禁止パス変更なしを確認。開始時WIPはなく、今回の34ファイルのみ変更。commit / push / PR / merge / deploy、実DB migration適用・実端末確認は未実施。
- [x] (2026-10-05) UX 改善の PR #1713 を main へ squash merge(merge `f9e27a01f7295338b74741d4d100c70e6ff425e0`、追跡セッションが実施)。main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261005-122626-54f495`、`Result=success`、recap `ok=268 changed=31 unreachable=0 failed=0`)、health 200、migration `20261006040000_add_procedure_document_edit_leases` 適用済み。
- [ ] 実機確認(オーナー): 全高ビューアと「全体 | 幅いっぱい」、名前の組み立てと自動割り当て、「加工 › 切削/研削」、大きな素材棚、2 台目で「(保持者)が編集中」。
- [x] (2026-10-05) 動画 V2実装: SD動画からの不可逆トリミング要求・再試行・元動画保持、コメント全置換とトリミング時刻補正、紐づけ時10.5秒上限、共通字幕プレイヤー・範囲バー・コメント編集・長さ/要トリミング表示を追加。
- [x] (2026-10-05) 動画 V2指定検証: API lint / procedure-video 5ファイル87件 / build用tsc、Web lint / procedure-manuals 4ファイル39件 / build成功。組立transaction回帰4件も成功(合わせて6ファイル91件)。expand-only SQLの5文成功、Prisma差分と手書きDDLの列/表/索引/FK一致を確認。依存準備を含め約10分。
- [x] (2026-10-05) 動画 V2レビュー修正: UX改善側の左ペイン・サムネイル構成とV2の長さ/要トリミング表示を統合。長さ未確定/非READYの新規紐づけを409で拒否し既存リンクの読み出しを保持、取得時updatedAtによるclaimと行の再取得、44×44pxのつまみと重なり時の前面選択・キーボード操作を追加。claim前の要求差し替えとaria-valuenowの回帰テストを追加。マージで重複したtransaction importも除去。
- [x] (2026-10-05) 動画 V2競合解消・レビュー修正の指定検証: API lint / vitest 9ファイル127件 / build用tsc、Web lint / vitest 15ファイル122件 / buildがすべて成功(環境準備と関連修正の再確認を含め約4分)。main取り込み後のPrisma Clientをローカル再生成し、競合マーカー0件、Web buildのCSSでWebKit/Firefox両方のつまみ44px相当を確認。git操作と禁止パスの編集は行っていない。
- [x] (2026-10-05) 動画 V2: Codex レビューの 3 指摘(長さ未確定の動画の紐づけ拒否、claim の `updatedAt` 条件付き更新、つまみの 44px)を修正。`origin/main`(UX 改善 #1713)を取り込み、4 ファイルの競合を両立で解消。使い捨て PostgreSQL で migration 適用を確認。
- [x] (2026-10-05) PR #1714 を main へ squash merge(merge `66355f8f191590053544cf6f4dd21e092ddb20ad`)。件名を指定しなかったため main のコミット名が作業用の「wip: video V2 (to be squashed) (#1714)」になった(履歴は直さない。次回から `--subject` を指定する)。main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261005-131419-00281b`、`Result=success`、recap `ok=268 changed=31 unreachable=0 failed=0`、追跡セッションが実施)、health 200、migration `20261006100000_add_procedure_video_trim_and_comments` 適用済み。
- [ ] 実機確認(オーナー): 動画一覧で 10.5 秒超に「要トリミング」が出てトリミングすると新しい長さになる、10 秒以内の動画だけページに紐づく、コメントを付けると再生中に字幕として出る。
- [x] (2026-10-05) 動画 V3ローカル実装: nullable concatRequest/originの追加、2〜5本(重複可)から独立したPENDING動画を作る接続API、向き/寸法の統一とconcat demuxer再エンコード、先頭poster、開始オフセット付きコメント複製(先頭5件)、元動画再確認、失敗/再試行、棚のチェック選択/並べ替え/合計/題名/接続バッジを追加。
- [x] (2026-10-05) 動画 V3指定検証: API lint / procedure-video 5ファイル119件 / build用tsc、Web lint / procedure-manuals 4ファイル47件 / build成功。expand-only SQLの2文も成功。環境準備を含め約11分。共有型の禁止パスへ出力しないため、一時領域へ共有型をビルドし、Web buildは同一ソース/設定の隔離コピーで実行した。Prisma Clientとエンジンはworktreeのnode_modules内に準備した。
- [x] (2026-10-05) 動画 V3: Codex レビューの 3 指摘(長い処理の回収競合 → claim トークンと各ステップ後の生存更新、非正方形ピクセル → SAR を考慮した正規化、検索をまたぐ選択の保持)を修正。使い捨て PostgreSQL で migration 適用を確認。
- [x] (2026-10-05) PR #1718 を main へ squash merge(merge `481f0af86b69a75fdb339ee5c4bbf253eef5645c`、件名は PR 題名を指定)。main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261005-142032-01dac9`、`Result=success`、recap `ok=268 changed=31 unreachable=0 failed=0`、追跡セッションが実施。Hermes の #1716/#1717 も同じ配布に乗った)、health 200、migration `20261006120000_add_procedure_video_concat` 適用済み。
- [x] (2026-10-06) UX 改善(実機確認 6 件): 右端 64px の記号列(一覧の開閉、2 ページ表示、全手順、全体、幅いっぱい、前手順、ページ番号、次手順)、左の一覧は既定で閉じ端末ごとに localStorage で記憶(開くと 760px、機種列 440px、型番は等幅 20px で折り返し)、一覧を閉じたときだけ手動の 2 ページ表示(2 手順送り)、機種検索は読み込み済み一覧の即時絞り込み + テンキー + 一致の強調(要領書ページと白紙から作る)、工程/細分チップは状態ごとに配色を明示、「外す(紐づけ解除)」、エディタに DRAFT 初版だけの「削除」(確認 1 回、割り当て中は「先に割り当てを外してください」、他の 409 は API の理由を表示)。「このページ」の手順 n/N と進捗は削除し、承認と動画を残す。API は変更なし。Codex(gpt-6.1-sol / high)が実装。
- [x] (2026-10-06) 検証: Web lint、`vitest run procedure-manuals document-editor AssemblyProcedureSequenceViewer assembly` 74 ファイル 427 件、build。API lint、tsc。Codex read-only レビューの 4 件(一覧を閉じるとビューアが幅 0 の列に落ちる、改版 DRAFT に削除が出る、409 を全部割り当て扱い、ページ番号の読み上げ)を修正。
- [x] (2026-10-06) PR #1732 を main へ squash merge(merge `239fe2fbc5f90a083eed923c48b3e626b5f4c2fb`、件名は PR 題名を指定)。main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261006-012031-abf178`、`Result=success`、recap `ok=268 changed=31 failed=0 unreachable=0`、追跡セッションが実施。#1736 も同じ配布に乗った)、`/`・`/admin`・`/kiosk`・`/api/system/health` が 200。実機での 6 件の確認はオーナーが行う。
- [x] (2026-10-06) 実機確認の追加 2 件: 「白紙から作る」の機種候補を、要領書がある機種の一覧ではなく機種マスタ検索(`/assembly/machine-name-candidates`、テンキーの数字は digitQuery、手入力は q、即時検索、古い応答は破棄、入力文字列は候補にしない)に切り替え。下辺の帯(名前のプレビュー、名前を直接入力、閉じる)の文字色を明示。Codex(gpt-6.1-sol / high)が実装、読み取り専用レビューの低 3 件のうち 120 文字上限と重複排除テストを反映。Web lint、`vitest run procedure-manuals` 59 件、build。スタブ API のブラウザで候補と帯の配色を確認。
- [x] (2026-10-06) #1744 を main へ squash merge(`324d87cd`)。main CI は Trivy の新 CVE(`@simple-git/argv-parser`)で一度失敗し、別セッションの #1745 で解消。main `69c8ff8d` を Pi5 へ標準ローリング更新(run `20261006-031518-336a91`、`Result=success`、recap `ok=268 changed=31 unreachable=0 failed=0`、このセッションが実施)。
- [x] (2026-10-06) 構造の整理(見る / 作る・直す / 使う): PR #1746 を main へ squash merge(`f37d4bdf`)。main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261006-040231-5bbd67`、`Result=success`、recap `ok=268 changed=31 unreachable=0 failed=0`)。実機確認はオーナーが行う。
- [x] (2026-10-06) 実機確認午後 (b) PR #1753 を main へ(`f5750fad`、#1752 と同じ配布)。Pi5 へ標準ローリング更新(run `20261006-053956-68e484`、`Result=success`、recap `ok=268 changed=31 failed=0 unreachable=0`、health 200、追跡セッションが実施)。
- [x] (2026-10-06) 実機確認午後 (a) PR #1754 を main へ(`3ade5f8e`、CodeQL #113 は暗証番号のメモリ保持と端末鍵の指紋化で解消、e2e の選択子を記号列に合わせて更新)。Pi5 へ標準ローリング更新(run `20261006-062211-bd7126`、`Result=success`、recap `ok=268 changed=31 failed=0 unreachable=0`、health 200、追跡セッションが実施)。実機確認はオーナーが行う。
- [ ] 実機確認(オーナー): 動画一覧で 2 本を選んで接続すると由来「接続」の動画が処理中として現れ、数十秒〜数分で完了して再生できる、向きの違う動画を混ぜても黒帯で揃う、コメントが引き継がれる、元の動画は残る。
- [ ] (2026-10-06) 構造整理をローカル実装(閲覧から作成操作を除去、3列の工房・概要API・検索・割り当て解除・エディタの文脈/戻り先・ホーム2入口)。レビュー 7 件を反映(無効PDFの保持、ID変更検知、戻り先/context検証、初版下書きの解除後削除と409表示、札の文言、確認ボタン44px)。指定検証: API lint/tsc・114件成功/実DB1件skip、Web lint/build・254ファイル1544件成功。PDFの「使う」(既存初期選択は文書のみ)は仕様確認事項として非表示。ブラウザ実画面確認はツールの承認拒否で未実施。Gitの変更操作・禁止対象の編集なし。
- [x] (2026-10-07) 「見る」の左列を「作る・直す」と同じ寸法へ(左列 760px → 460px、テンキー 約412px → 200px、検索欄 48px)。機種名の横の件数(工程を押すまで「—」で選ぶ判断に使えなかった)をやめ、機種を押した時点で工程ごとの冊数を既存の overview API で表示。要領書がある工程が 1 つだけの機種は自動で開く(URL での初期選択時は自動で開かない)。承認・動画は左列の下端に固定。承認済みモックは Artifact。Web のみ。PR #1814 を main へ squash merge(`3ede702a`)。main の 4 ワークフロー success。Pi5 へ標準ローリング更新(run `20261007-091702-6e9dce`、`Result=success`、failed=0 unreachable=0、稼働イメージ api/web とも `3ede702a`、health 200)。Pi4・Pi3 は対象外。ロールバック下限は `9792ae8f`。オーナーが実機で確認済み(2026-10-07)。

## Surprises & Discoveries

- Observation: UX 改善(2 回目)の自動割り当ては、従来の置換 API の公開版チェックをそのまま呼ぶと新規 DRAFT が拒否される。
  Evidence: `ProcedureManualService.replaceAssignments` の `resolvePublished` 検証。新規作成専用の末尾追加は同じ工程行ロックを取得し、既存行を変更せず DRAFT の正本 ID を参照する。
- Observation: UX 改善(2 回目)の heartbeat テストでは、仮想タイマー中の認証 `waitFor` が停滞していた。
  Evidence: controller 新テストの timeout を、認証ロード・コマンド完了を `act` で待つ手順へ変更して解消。timeout 延長やテスト除外は行っていない。

- Observation: 管理カードの設定は在庫カードと同じく GET と PUT の間の別更新と競合し得る既知の制約があり、Phase 3 の限定修正では対応しない。

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

- Decision (2026-10-08): 組立・検査はMODEL（機種）、切削・研削はPART（部品）。工程にenum/default MODELを追加し、migrationと参照データで加工の子工程をPARTとする。割り当ての新しい列は追加せず、PARTでは既存 `modelCode/modelCodeKey` に品番/正規化キーを格納する（schema注記）。
  Rationale: 工程が対象の種類を決めるため、既存の一意制約・文書参照・割り当てrouteを保った最小変更で済む。正規化はserviceに集約し、MODELの既存ルールを維持、PARTは加工要領書と同じNFKC/trim/uppercase関数を再利用。PUTも工程の種類で照合する。
- Decision (2026-10-08): 新規read契約は `GET /assembly/procedure-manuals/by-part?partNumber=`（allowView）。`partNumber/partNumberKey` と、公開済みで利用可能な文書があるPART工程の `processId/processName/sequence` を返す。既存sequence serializerを使い、下書きは出さない。候補取得には機種一覧と同じ形の `/assembly/procedure-manuals/parts`（allowView、`parts: [{partNumber, partNumberKey}]`）も追加し、初版下書きの割り当て先品番だけを取得できるようにする。「見る」で非公開overviewを取る必要をなくす。
- Decision (2026-10-08): 共有フィルタはPART工程で部品/品番表示、全てでは機種｜部品切替。候補はPART割り当て済みのキー＋未割り当て入力品番、検索/数字はcontains、一回スキャンで選択。種類変更はキーと検索をクリア。作成・割り当ても部品表記、混在一覧は機種・部品。リンクはMODELの `model=` を維持しPARTに `part=` を使う。PIN gateは変更しない。
- Decision (2026-10-08): 自主検査は正式品番で両資料を取得し、従来の工程順でチップを統合。件数は原本1＋公開手順書の文書数、2件以上だけ表示。両資料がある場合だけ「加工要領書」（既定）/「手順書」のタブ、単独資料は直接表示。手順書だけの完全一致は別名/類似候補より先に成立させ、別名・類似のamber表示を維持。by-part失敗時は原本のチップを残し近くにエラー表示。モック `docs/design-previews/procedure-manuals-part-unit-mock.html` を参照し、DGX・deploy・インフラは変更しない。

- Decision (2026-10-08): 「作る・直す」と「見る」は、機種と工程をそれぞれ単独で絞り込めるようにする(オーナー承認、モック `docs/design-previews/procedure-manual-view-and-process-filter-mock.html`)。工程ボタン(全て＋子工程)を左ペインの最上部に置き、親工程(組立・加工)は表示から省く。「作る・直す」の行の先頭に、編集操作のない「見る」を置く(重ねて開くダイアログ)。
  Rationale: 機種を先に決めないと要領書に届かず、検査や研削の担当者が自分の工程の要領書を横断して探せなかった。
  Interfaces: `GET /assembly/procedure-manuals/overview?processId=`(任意)を追加。行ごとに `modelCode`・`modelCodeKey`・`processId` と既存の overview item を返す。既存 API と DB は変更なし。「作る」と割り当ては機種と工程の両方を選んだときだけ有効。

- Decision (2026-10-08): 部品を別のページで使う手段は、同じ手順書内の「独立した複製」にする(オーナー承認、モック `docs/design-previews/editor-parts-reuse-mock.html`)。部品ペインの見出しに「このページ / ほか」の切替を置き、「ほか」の部品を押すと現在ページの同じ位置へ複製を置いて選択する。元の部品とは連動しない。別の手順書への持ち出しは対象外。
  Rationale: 要素は文書全体の配列で持っており、同一文書内で 1 つの asset を複数要素が参照することは保存と GC が既に許しているため、API・DB を変えずに済む。未配置の切り抜きを持ち続ける共通ライブラリや文書間の再利用は、asset のリースと GC に手が入るため見送った。ページ寸法をエディタが持たないので bbox はそのまま複製し、縦横比の違うページでは画像の比率が変わりうる。

- Decision (2026-10-06): サーバー発行トークンが無いため、暗証番号はタブのメモリにだけ持ち(最長 8 時間)、保存領域(sessionStorage)には期限と端末鍵の短い指紋(FNV-1a、復元不可)だけを置く(CodeQL js/clear-text-storage-of-sensitive-data #113 への対応。再読み込みすると再入力)。将来は用途限定トークンへ。
  Rationale: 暗証番号の永続保存を避け、端末認証の変更と期限到達時に破棄する。

- Decision: 動画 V3は元動画の行・ファイルを更新せず、新しいorigin=CONCAT行と独立したsha256出力を作る。既存origin=nullはAPIでGMAILへ正規化し、Gmail新規取込はGMAILを明示する。
  Rationale: 接続後も元動画を独立して捨てる/戻すことができ、既存データのUPDATEや列DEFAULTをmigrationに含めずに由来を表示できる。
  Date/Author: 2026-10-05 / Codex。
- Decision: 各接続元を先頭動画の縦横比に沿った偶数寸法・長辺640の枠へscale/pad(黒帯)/setsarで正規化し、30fpsとtime baseを揃えてからconcat demuxerで再エンコードする。posterは接続結果の0秒フレームとする。
  Rationale: [FFmpeg concat demuxerの契約](https://www.ffmpeg.org/ffmpeg-all.html)は同じストリーム条件を要求する。向き/寸法が違うSD動画を安全に扱うため、接続前の正規化を追加した。ffmpeg起動の上限時間とthreads 2はV1と同じにし、V1/V2の変換引数やposter時刻は維持する。
  Date/Author: 2026-10-05 / Codex。
- Decision: 接続の要求時とREADY commit前に元動画をID順の行ロックで再確認し、処理前後のstorageKeyも比較する。一般失敗はV1同様3回までPENDINGへ戻し4回目でFAILED(CONCAT_FAILED)、元動画消失/破棄/差し替えは即FAILED。要求は最終失敗後も手動再試行用に保持する。
  Rationale: エンコード中のdiscardやtrimが古いSD動画と新しいコメントを混在させない。コメント複製とREADY/concatRequest消去は同じrunAssemblyTransactionで確定し、途中失敗の二重複製を防ぐ。重複IDの順序はそのまま保持し、コメントは元動画内の時刻順・接続順で先頭5件を引き継ぐ。
  Date/Author: 2026-10-05 / Codex。

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
- Decision (2026-10-07): エディタの記号ペインは記号だけにし、説明は「乗せる(キオスクは長押し)と動詞 1 語」に限る。重なりの見分けはキャンバス上の札やチップではなく、ページ一覧の隣の「部品」ペインに要素の縮小版そのものを前から順に並べて行う。文字での説明は置かない。隠すは編集中だけの一時非表示で、データモデルに可視属性は追加しない。
  Rationale: オーナー指示(2026-10-07): 「マウスオーバー説明までいらない、動詞で短く」「重なったものはだめ。ページペインの右側にペインを作って並べれば」「文字で説明するのは UIUX の敗北・手抜き。使ってるものの縮小版をそのまま並べる」。可視属性は保存データと API に波及するため、Web だけで完結する一時状態にした。
  Date/Author: 2026-10-07 / Claude(オーナー承認)。
- Decision (2026-10-07): 素材棚の束のキーは「ヒントの末尾の (pN/M) または (N/M) を除いた文字列」。ヒントが無い素材は元ファイル名の基底(拡張子と末尾の「 p<N>」を除く)で束ね、どちらも無いものだけ「ヒントなし」。束の中は `gmailDedupeKey` の「<親>:p<N>」「<親>:<N>」で連番の単位(PDF 本体 → p1 → p2 …、ナレッジ分割は番号順)を作り、単位同士とそれ以外の素材は受信日時の新しい順。カードの表示ヒント(ページ番号付き)は変えない。
  Rationale: オーナーの実機確認(2026-10-07)でページごとの束は意味がなく「ルールを決めないとだめ」との指摘。API のヒント形式は変えず Web の束ね処理だけで解決できる。
  Date/Author: 2026-10-07 / Claude(オーナー承認)。
- Decision (2026-10-07): 素材は配置済みでも何度でも配置・差し替えに使える。documentId / placedAt は「最後に配置した先・日時」を表し、配置のたびに上書きする。捨てた素材だけ配置を拒否する。
  Rationale: 同じ写真を複数の機種・工程の要領書で使い回す要望(オーナー、2026-10-07)。配置ごとに文書側へ asset をコピーするので素材と文書の結合はなく、未配置タブの件数は「一度も貼っていない素材」の目安として従来どおり使える。「配置を取り消す」は最後の配置の記録を消すだけで、文書の画像には影響しない。
  Date/Author: 2026-10-07 / Claude(オーナー要望)。
- Decision (2026-10-07): inline(Content-ID 付き)の画像も写真素材として取り込む。16 KiB 未満の inline 画像だけ署名ロゴとみなして捨てる。本文テキストの [cid:…] は除去し、空なら文章の素材を作らない。
  Rationale: PC の Outlook と iPhone メールは写真を inline で送るため、「inline は棚に入れない」だと主要な送り方が使えない(オーナー実機確認、2026-10-07)。重複キーと保存経路は従来どおり。
  Date/Author: 2026-10-07 / Claude(オーナー実機確認)。
- Decision (2026-10-07): #1801 以降の戻し先の下限。`ProcedureMaterialKind` に `PDF` を追加する migration は expand-only で旧イメージでも起動するが、PDF 素材の行(kind=PDF)が作られた後に #1801 より前のイメージへ戻すと、旧 API が素材一覧でその行を読めずエラーになる。PDF 行ができた後は #1801 より前へ戻さず前進修正する。
  Rationale: Prisma の enum は未知の値をデコードできない。PDF 行ができる前のロールバックは安全。追跡セッションの引き継ぎメモ「戻さない下限」と同じ内容。
  Date/Author: 2026-10-07 / Claude(追跡セッションの依頼)。
- Decision: 素材原本 GC は allowWriteKiosk の手動 POST /assembly/procedure-materials/gc のみとする。
  Rationale: 既存 assembly-procedure-asset-gc は保存・破棄・削除後の呼び出しだけで定期スケジューラーはない。新しいスケジューラーは今回追加しない。sha256/original だけを走査し、24時間より古く storageKey 一致の参照が0件の場合だけ integrity:true で削除する。配置済み・破棄済みを含む全素材の参照と共有原本を保持する。
  Date/Author: 2026-10-05 / Codex。

- Decision (2026-10-07): 属性パネルは右端の重ね表示のまま、開いている間だけキャンバス列に右余白(372px)を足してページ画像を左へ寄せる。パネルを列として分けない。
  Rationale: オーナー指示「ドキュメントを左に寄せるだけでいけそう」。キャンバスは領域の大きさに追従して全体表示するので、余白だけで重なりが解消し、パネルの開閉でレイアウト列が変わらない。
  Date/Author: 2026-10-07 / Claude(オーナー指示)。

- Decision: Phase 2c の公開条件・expectedEditVersion 検証・文書行ロックは `publishInTransaction` に共通化し、パスワード検証は `publish`、承認者照合と同一transactionでの承認記録作成は `approvePublish` に置く。PUBLISHED済みへの再実行は文書を返し、承認行を追加しない。
  Rationale: パスワード公開の条件と認証を保持し、承認行の作成失敗・競合では公開と記録を一緒に取り消す。旧形式文書の公開取消と割り当ても同じ文書行をロックし、既知の競合を防ぐ。
  Date/Author: 2026-10-05 / Codex。
- Decision: ナレッジと同じ `useArmedNfcRead` を公開ダイアログに使用し、読取後に専用 `POST /assembly/procedure-documents/approval-reviewer` で氏名・職位を確認する。実際の公開APIでも `PrismaKnowledgeReviewerRepository.resolve(tagUid, true)` を再実行する。
  Rationale: 古いNFCイベントを採用せず、確認と実行の間の職位・在籍変更を再検証する。確認のためにナレッジの承認待ち一覧を取得せず、Hermes機能の有効化にも依存しない。
  Date/Author: 2026-10-05 / Codex。
- Decision: 未登録タグは Phase 2c の明示受入条件どおり404、在籍外・承認職位未満は403、タグ重複は既存同様409とする。認証なしは401。ナレッジ側の未登録タグ400の契約は変更しない。
  Rationale: 「ナレッジと同じ」と「未登録404」の差は、具体的な受入条件を優先して解消した。エラーコードは既存ナレッジのものを再利用する。
  Date/Author: 2026-10-05 / Codex。

- Decision: 許可ドメインは DNS ラベルの英数字と内部ハイフン、ドット区切り2ラベル以上を許可し、大文字・前後空白・先頭 `@` を正規化する。サブドメインの暗黙許可は行わず、空配列と送信元不明は拒否する。
  Rationale: 送信元の範囲を明示的に管理し、既存設定には `thkintechs.co.jp` の既定を適用する。`fromEmail` とスケジュール metadata の上書きは追加の完全一致条件として保持する。
  Date/Author: 2026-10-05 / Codex。
- Decision: 管理カードのドメイン追加・削除は即時保存とし、既存 `PUT /backup/config` と設定更新hookを使う。保存直前に最新設定を取得し、`allowedSenderDomains` だけを変えて送信する。スケジュール・設定・health のキャッシュを無効化する。
  Rationale: 既存PUTは設定全体の置換であるため、他の設定とスケジュールの編集を保持する。自動取込ON/OFFは既存のスケジュール部分更新を継続する。
  Date/Author: 2026-10-05 / Codex。

- Decision: Phase 3 のChat文候補は整理タイトル・要約と元本文の冒頭を表示し、取込本文は元の `source.text` を保持する。手順ステップはtitle/body/cautionsを改行で連結し、公開版の番号を安定キーと出典へ入れる。
  Rationale: 整理した説明を見て選びつつ、Chat原文と承認済み版の出典を失わず、別版の明示取込を区別できる。
  Date/Author: 2026-10-05 / Codex。
- Decision: sourceの関連品番・工程・targetはKnowledgeProcedureMaterialから関連ヘッダーを読み、公開手順のtargetはKnowledgeProcedureを読み取り専用で補う。取込と画像配信にも機能フラグと現在の候補参照を適用し、原本欠落(ENOENT)だけdisplayへフォールバックする。
  Rationale: runtime DTOにはtargetと素材の関連先がない。未公開・無関係画像の配信を避け、整合性エラーを代替画像で隠さない。
  Date/Author: 2026-10-05 / Codex。
- Decision: UIは棚閲覧と配置モードの両方からナレッジタブを開ける。最大50件を選び、全件成功なら検索をクリアして未配置へ移動する。一部失敗では結果と理由を表示し、候補を再取得する。
  Rationale: 新しく取り込んだ素材を元の棚検索で隠さず、失敗を確認して再選択できる。配置・Gmailの保存経路は変えない。
  Date/Author: 2026-10-05 / Codex。

- Decision: 動画は独立した存在として保存し、必要な文書ページへ順序付きで紐づける。音声を落とし、25 MB・60秒まで受け付け、長辺640・縦横比維持・H.264 MP4へ変換する。元動画は変換成功後に捨てる。
  Rationale: オーナー決定(動画 V1依頼)。ページoverlay型を拡張せず、単独再生と複数ページからの参照を両立する。
- Decision: 動画 V1レビュー修正ではffmpegに `-threads 2` を指定し、Pi5のAPI応答への負荷を抑える(2026-10-05 / Codex)。
- Decision: V1はPi5のffmpeg/ffprobeを用い、probe/transcodeのPortだけを差し替え口として置く。DGXは使わない。
  Rationale: オーナー決定。将来の変換先変更を現行の取込・保存・紐づけから分離する。
- Decision: Webは既存AxiosのBearer/端末キーヘッダーでMP4をBlob取得し、再生終了でObject URLを解放する。APIは単一bytes Rangeの206/416を提供する。
  Rationale: ネイティブvideoのsrcは認証ヘッダーを送れない。V1の短いSD動画ではBlob取得が既存の保護画像と同じ認証を保ち、シークは取得済みBlob内で動作する。
- Decision: 原本を共有する全取込・削除を保存キーのPostgreSQL advisory lockで直列化し、最後の原本参照がなくなってから削除する。READYを先にcommitし、原本後処理の失敗では利用可能な動画を再試行へ戻さない。
  Rationale: 同じ動画を複数メールで受け取ったときの欠落を防ぐ。変換全体にも共通排他を置き、リーダースケジューラーと取込直後の起動を含め同時1件にする。
- Decision: 改版下書きへページ動画リンクを複製し、下書き破棄ではその下書きのリンクだけを同じ文書transactionで除去する。1秒以下の動画のposterは中間フレームを使う。
  Rationale: 公開版のリンクを保持しつつ従来の改版・破棄を継続する。短い動画でもposter生成が空出力にならないようにする。
  Date/Author: 2026-10-05 / Codex。
- Decision: UX 改善(1 回目) のビューアはlayout="manuals"だけで浮遊操作と幅表示を有効にし、画像のnaturalWidth/naturalHeightで既定を決める。切抜きでは従来の表示を維持し、ページ送り時に幅表示のスクロールを先頭へ戻す。
  Rationale: PDFを含む実際のページ画像の形に従い、共用ビューアの作業セッション側を維持するため。手順情報と未公開通知は左側へ置き、右側の全高を確保する。
- Decision: UX 改善(1 回目) の素材棚はモックどおり操作/選択行/カードの順に置く。既存の捨てた素材の復元と配置済みの取り消しを残し、エディタ文脈では既存どおり未配置とナレッジを扱う。
  Rationale: モックの寸法と配置を守りながら、既存の復元経路とPhase 3の明示取込を維持するため。
- Decision: UX 改善(1 回目) の配置はチェックした順に既存APIへ送る。成功分は棚と選択から外し、失敗時は残りだけ再試行できるようにする。エディタでは連続配置時の重なり順も保持する。原寸表示は取得済みBlobを再利用し、表示サイズはlocalStorageが使えなくても切り替えられる。
  Rationale: 部分成功の二重配置、画像の再取得、端末の保存制限による操作停止を避けるため。
- Decision: UX 改善(1 回目) の素材一覧/未配置件数は既存APIの上限500件を使い、上限に達した場合は500+と表示する。
  Rationale: 件数APIの新設を今回の小さなAPI確認へ混ぜず、取得上限を総件数として断定しないため。


- Decision: 工程「加工 › 切削/研削」の初期データは、追加のみ検証が INSERT を許可しないため、ナレッジと同じ起動時の冪等な投入にした。

- Decision: UX 改善(2 回目)では予約取得・解放の Promise を effect 間で直列化し、離脱後の遅い取得応答の解放を、再認証後の新しい取得より先に完了させる。通信失敗時は読み取り専用とし、予約の再取得を表示する。
  Rationale: 遅い解放が新しい自分の予約を削除する競合を防ぎ、保持者不明の間に変更しない。BFCache からの復帰も再取得する。
  Date/Author: 2026-10-05 / Codex

- Decision: UX 改善(2 回目)では白紙作成の名前採番を文書作成トランザクション内の advisory lock で直列化し、既存名と重なる場合だけ `-2`、`-3` を付ける。200文字上限に合わせ、接尾辞分を元の名前から短縮する。
  Rationale: 複数端末の同時作成でも同名を避け、改版の同名使用を制約で妨げない。
  Date/Author: 2026-10-05 / Codex
- Decision: UX 改善(2 回目)の自動割り当ては既存 `ProcedureManualService` に DRAFT の末尾追加を設け、工程行のロックを割り当て置換と共用する。作成と割り当ては別トランザクションで、失敗は成功応答の `assignmentError` とエディタ上の短い表示にする。
  Rationale: 既存の置換 API は公開版を要求する。既存の割り当てには公開版なしの DRAFT も含まれるため、読み取り後の全置換で消失・競合させず、既存行を保持して追加する必要がある。文書作成後の再試行で重複文書を増やさず、作成した文書を編集できる。
  Date/Author: 2026-10-05 / Codex
- Decision: UX 改善(2 回目)の自由入力は組み立て状態を保持して切り替え、機種と細分が選択済みなら自由入力した名前にも自動割り当てする。機種未選択の自由入力は従来どおり文書のみ作成する。
  Rationale: 既存の自由入力の操作を維持し、選択済みの分類を失わない。
  Date/Author: 2026-10-05 / Codex
- Decision: UX 改善(2 回目)の予約保持者は `user:<id>` / `client:<id>`。ユーザーの表示用列は `username`、端末は `ClientDevice.name` を使う。認証で編集対象の DRAFT 改版が確定した直後にその ID の予約を取得する。
  Rationale: 既存認可とユーザーモデルに合わせ、予約前は読み取り専用とし、引き継がれた側の未保存要素は既存の端末復旧記録に保持する。
  Date/Author: 2026-10-05 / Codex

- Decision: 動画 V2は現存するSD MP4だけを入力に再エンコードし、トリミング要求でattemptsを0へ戻す。V1と同じ3回の再試行後(4回目)、またはffmpeg無しで元のMP4をREADYへ復帰させ、TRIM_FAILEDと理由を残す。元に戻す操作は提供しない。
  Rationale: 捨てた原本に依存せず、変換失敗によって使用可能な動画が消えることを防ぐ。再試行中はPENDINGのまま要求を保持する。
  Date/Author: 2026-10-05 / Codex
- Decision: 動画行のFOR UPDATEをトリミング要求・コメント全置換・ページ紐づけで共有する。トリミング要求のある動画は紐づけを409で拒否し、コメント編集はREADYだけとする。
  Rationale: 棚の古い状態からの紐づけやコメント上書きが、トリミング時の排他と時刻補正を破ることを防ぐ。新規紐づけはREADYかつ長さ確定済みの10.5秒以内だけ許可し、既存リンクの読み出しは維持する。
  Date/Author: 2026-10-05 / Codex
- Decision: 出力ハッシュの保存・READY更新と旧出力削除は同じ保存キーのadvisory lockを共有し、再エンコードはtransaction外で行う。READYをcommitした後に旧キーの参照数を確認し、削除完了まで短いロックを保持する。
  Rationale: 同一ハッシュを別行が再保存する瞬間の参照チェックと削除の競合を防ぐ。削除失敗はREADYを巻き戻さずログに残す。
  Date/Author: 2026-10-05 / Codex
- Decision: コメントは開始・終了境界を含めて保持し、開始秒を引いて時刻とsortOrderを補正する。最終コメントの字幕は4秒未満の区間まで表示する。範囲バーの初期選択は先頭10秒(短い動画は全長)、0.1秒刻みとする。
  Rationale: APIの0〜durationSecondsの範囲と整合させ、現場で短い動画と字幕を作る初期操作を減らす。トリミング自体は10秒超も受け付けるが、赤で警告し、紐づけ時は10.5秒を超えると拒否する。
  Date/Author: 2026-10-05 / Codex

- Observation: 実機確認 6 件(2026-10-06)の工程/細分チップが真っ黒だった原因は、未選択時に文字色を指定しておらず Dialog 既定の `text-slate-900` を継承していたこと(生成 CSS では Dialog の `text-[#eef3f6]` より後に定義される)。`aria-pressed:` バリアントの不動作は未再現。
  Evidence: 旧 chip クラス文字列と `Dialog.tsx` の既定クラス、build 後 CSS の定義順。チップ自身に状態ごとの枠/背景/文字色を全指定して解消。
- Decision: 実機確認 6 件の記号列はモックどおり 7 つの操作ボタンと 2 行のページ番号表示(`aria-live` で読み上げ)。機種一覧の件数は取得済みの選択機種×工程の割り当て件数だけ表示し、未取得は「—」(一覧 DTO に件数がなく、API は変更しない)。
  Rationale: 無意味なボタンを増やさない。API 境界を守る。
- Decision: 「削除」は DRAFT の初版(`supersedesDocumentId` なし)だけに出す。改版 DRAFT は既存の「改版を破棄」、PUBLISHED は紐づけ解除のみ。参照判定はサーバーの既存 DELETE(409)を正とする。
  Rationale: 既存 API は改版 DRAFT の削除を拒むため、押せても失敗するボタンを出さない。
- Decision: 工房の行に出す操作は「外す」か「削除」のどちらか 1 つにする(2026-10-08、承認済みモックあり)。「削除」は上の条件に加えて、その文書の割り当てがこの機種×工程だけのとき。公開済み、または他の機種×工程でも割り当て中の文書は「外す」だけ。手順書一覧には「使用先」列と「未使用」の絞り込みを足し、割り当て中の文書は削除を押せなくする。
  Rationale: 同じ行に 2 つ並ぶと利用者が違いを判断できず、外しただけの下書きが一覧に残る理由も分からなかった。
  Interfaces: 機種オーバービューの item に `otherAssignments`、手順書一覧サマリに `manualAssignments` を追加(どちらも `{ modelCode, modelCodeKey, processId, processName }[]`、追加のみ)。行内アイコンの用途表示は `components/ui/IconActionTooltip.tsx` に切り出し、エディタの `EditorIconButton` と共有する。

- Decision: 構造の整理(2026-10-06)で、組立ホームに「見る/作る・直す/使う」の札の画面を新設せず、ホーム上部の入口を 2 つに整理してホームの作業一覧を「使う」とする。
  Rationale: ホームの一覧がすでに「使う」の本体で、札の画面を挟むと 1 段増える(1 画面完結の方針に反する)。モックの意図(3 つの仕事を分ける)は、閲覧から作成・編集を取り除き工房へ移すことで満たす。

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

### 動画: V1 / V2 / V3

V1は専用素材メールからMP4/MOV/3GP/M4V(非inline、25 MB以下)を取り込み、独立したProcedureVideoとしてPENDINGへ保存する。既存素材と同じ添付名・part IDのハッシュによる重複キー、送信元ドメイン、未読再試行を維持する。動画だけ保存できたメールもゴミ箱へ移す。原本はprocedure-videos/incoming/<sha256>/originalを共有する。

Pi5のffprobeで60秒以下を確認し、音声なし・長辺640・縦横比維持・H.264 MP4(30fps、CRF28、faststart)とJPEG posterへ変換する。既定autorotationを維持する。procedure-video-transcoder.port.tsのprobe/transcodeを将来の差し替え口にするが、DGX接続は実装しない。1分間隔の共通リーダースケジューラーと取込直後の起動から最古のPENDINGを1件処理する。条件付きclaimと全worker排他で同時1件、停止したPROCESSINGは排他取得後に回復する。一般失敗は3回までPENDINGへ戻し、4回目にFAILED。TOO_LONGとFFMPEG_UNAVAILABLEは即FAILED、手動retryはattemptsを0へ戻す。出力とposterは変換MP4のsha256ディレクトリへ保存し、最後の参照を終えた原本を削除する。

動画APIはactive/discarded/allの棚、READYのMP4配信(単一Range、206/416、private/no-store、rateLimit)、poster、retry/discard/restoreを提供する。紐づけ済み動画のdiscardは409。ページ動画のGET/PUTを追加し、PUTは既存overlayと同じ編集パスワード、文書行ロック、activeな最新版DRAFTの検証を行う。改版取得・通常文書取得と要領書sequenceのページにはREADYだけ含める。ProcedureVideoLinkの文書FKはRestrict、deleteIfUnusedでは動画が紐づいている旨の409を返す。migration 20261006000000_add_procedure_videosは新enum/テーブル/索引/FKだけのexpand-only SQL。

Webは上部の「動画」棚、可視範囲だけのposter取得、タイトル・長さ・状態・再試行・確認付きdiscard・restore、認証Blobによる再生を提供する。エディタの現在ページから選択・並び替え・PUT保存し、閲覧では現在ページのREADYサムネイル列から再生する。ボタンはmin-h-11、再生はcontrols/playsInline/muted/preload=metadata、終了時にObject URLを解放する。

V2は`POST /assembly/procedure-videos/:id/trim`でREADYかつ未紐づけの動画の0.5秒以上の範囲を受け付ける。nullableのtrimRequest/trimmedAt/sourceDurationSecondsとProcedureVideoCommentをexpand-only migration `20261006100000_add_procedure_video_trim_and_comments`で追加する。処理workerはSD MP4から音声なし・H.264・30fps・threads 2で再エンコードし、新しいsha256のMP4とposterを保存、コメント補正とREADYを同じrunAssemblyTransactionでcommitしてから未参照の旧出力を削除する。初回の長さはsourceDurationSecondsへ保存し、既存READY行のnullは変更しない。コメントのGET/PUTは閲覧/書込権限を使い、PUTは5件・trim後1〜80文字・0〜durationSecondsに制限して時刻順に全置換する。紐づけPUTはREADYでない動画または長さ未確定の動画を409「変換が終わってから紐づけてください」、10.5秒超を400で拒否し、既存リンクの読み出しは維持する。claimはid・PENDING・取得時updatedAtで条件付き更新し、成功後の行をtrimRequestごと再取得して処理する。範囲バーの開始/終了つまみは44×44pxの操作領域と前面切替を持ち、← →の0.1秒・Shiftの1秒操作を維持する。

Webの棚からプレビュー付き二つのハンドルで範囲を指定し、不可逆の確認後に要求する。← →で0.1秒、Shiftで1秒、現在位置ボタンにも対応する。棚は処理中に5秒間隔で更新し、READYのトリミング失敗には元動画を保持した旨を表示する。コメント編集は時刻/文/削除と現在位置での追加、PUT保存を提供する。共通ProcedureVideoPlayerで字幕とコメントへのシークを全ての再生画面へ適用する。棚と閲覧サムネイルは0:08形式の長さと10.5秒超の「要トリミング」を表示する。infrastructure/CIのffmpeg導入とprocedure-videos永続マウントはClaudeの担当で、Codexは変更しない。

V3はmigration `20261006120000_add_procedure_video_concat`でProcedureVideoへnullableなconcatRequest JSONBとorigin TEXTだけを追加する。`POST /assembly/procedure-videos/concat`はallowWriteKioskで2〜5本のUUID配列(重複可)と任意の題名(前後空白除去、200文字まで)を受け、全てREADYかつ未破棄でなければ409「完了した動画だけ接続できます」を返す。新規行はPENDING、origin=CONCAT、gmailDedupeKey=concat:<uuid>、gmailMessageId=null、receivedAt=作成時刻、sourceFileName=concat.mp4、sourceContentType=video/mp4、sourceByteSize=0とする。未指定/空欄の題名は「<先頭の題名> ほか N 本」。合計の長さは制限せず、紐づけの10.5秒ルールはV2を維持する。

workerはclaim後のconcatRequestからSD MP4を順に一時領域へ読み出す。transcoder portのconcat(inputs, output, poster)は上記Decisionの正規化後、`-f concat -safe 0 -i list.txt`で音声なし・H.264・threads 2・veryfast・CRF28・yuv420p・faststart・30fpsへ再エンコードし、先頭フレームのposterを作る。出力とposterのsha256キー/衝突処理はV1を再利用し、READY時にdurationSeconds等を更新してconcatRequestを消す。元動画コメントの時刻へ各SD動画のprobeで得た開始オフセットを加え、時刻順・接続順で先頭5件だけ新しいIDで複製する。元動画の破棄/削除/差し替えをcommit前に検出した場合はCONCAT_FAILEDと理由を記録する。接続結果は通常の動画と同じ再生・捨てる/戻す・トリミング・コメント・紐づけを利用する。

Webの動画棚は未破棄READY動画のチェック選択を5本まで受け、2本以上で「接続」を有効にする。ProcedureVideoConcatDialogでは↑↓による順序、各長さと合計、10秒超の赤字「紐づけにはトリミングが必要」、任意題名(先頭変更時に既定値も更新)を表示する。送信後は検索を解除してactive一覧を更新し、「処理中」とorigin=CONCATの「接続」バッジを表示する。処理中は既存の5秒ポーリングで更新する。

V3の指定検証は `cd apps/api && pnpm lint && pnpm exec vitest run procedure-video && pnpm exec tsc -p tsconfig.build.json --noEmit` と `cd apps/web && pnpm lint && pnpm exec vitest run procedure-manuals && pnpm build`。禁止パスpackages/shared-typesへbuild生成物を置かず検証する場合は、その出力とWeb build用の同一ソースコピーを一時領域に作る。ffmpegはモックで順序/正規化/先頭poster/後始末を確認する。APIは本数/READY/破棄/権限/重複/既定origin、処理は60秒超・コメントのオフセットと5件制限・元動画消失/処理中の変更・再試行を検証し、Webは選択→接続→並べ替え/長さ/題名→送信→処理中/由来を1本のテストで確認する。

指定検証:

    cd apps/api && pnpm lint && pnpm exec vitest run procedure-video procedure-material procedure-document && pnpm exec tsc -p tsconfig.build.json --noEmit
    cd apps/web && pnpm lint && pnpm exec vitest run procedure-manuals document-editor && pnpm build

実機受入: 許可ドメインから短い動画だけ送信し、棚で完了・再生できること。DRAFTのページへ紐づけ保存後、公開版閲覧で該当ページだけサムネイルが現れること。61秒の動画はTOO_LONG、非対応形式と25 MB超はスキップされること。ローカルテストはffmpegをモックし、実DB migration適用・実Gmail・Pi5速度と回転動画は統合段階で確認する。

## 構造の整理: 見る・作る・直す・使う(2026-10-06 承認)

オーナーの指摘: 「新規で作る」「既存を直す」「丸数字やチェックを付けて検査記録に使う」の 3 つの仕事が同じ画面と言葉に混ざっていて分かりにくい。入口ボタンを足すだけでは解決しない。モック `docs/design-previews/procedure-manuals-structure-mock.html`(承認済み)に沿って、閲覧ページから作成・編集の操作を取り除き、別画面(工房)へ移す。

- **見る**(`/kiosk/assembly/manuals`): 閲覧だけ。左の一覧の上部から「白紙から作る」「素材」「動画」「割り当て」を外す。右端の記号列は送りと表示だけ。上部に「作る・直す」への 1 リンク(同じ機種 × 工程を引き継ぐ)。
- **作る・直す**(`/kiosk/assembly/manuals/workshop`、新設): 左に機種(既定は要領書がある機種の一覧、テンキーや手入力で機種マスタを即時検索)、中に工程と件数、右にその機種 × 工程の要領書の札(サムネイル、名前、状態の札: 公開 第 n 版 / 下書き / 改版中・保持者、操作: 直す・使う・外す・削除)。上部に「作る」(白紙から作る、機種と工程を引き継ぐ)、「素材」「動画」、「既存の要領書を割り当てる」(割り当てダイアログ)。
- **使う**: 組立ホームの作業一覧(既存)と組立テンプレート(既存)。工房の公開済みの札の「使う」は既存の `kioskAssemblyTemplateNewPath({ procedureDocumentId })` へ。
- **組立ホーム**: 上部の入口を「見る(要領書)」「作る・直す(要領書)」に整理。ホームの一覧が「使う」。モックの 3 枚の札の画面は、ホームの一覧がすでに「使う」であり画面を 1 段増やすため採用しない(Decision Log 参照)。
- **エディタ**: 入口が工房なら、見出しに「機種 › 工程 › 文書名」と「作る/直す」の札を出し、「戻る」「公開」「改版を破棄」「削除」の後は工房の同じ機種 × 工程へ戻る(`location.state.returnTo`)。既存の手順書一覧から入った場合は従来どおり。編集機能そのものは変えない。
- **API**: 工房の札に必要な状態をまとめて返す `GET /assembly/procedure-manuals/models/:modelCodeKey/overview`(工程ごとの割り当て件数と、各割り当ての文書状態: 公開版の版数、改版の下書きの有無、編集の予約の保持者名と開始時刻、キオスク PDF か文書か、無効理由)を追加。既存 API は変えない。


## 実機確認 6 件(2026-10-06 午後、承認済みモック `docs/design-previews/procedure-editor-mock.html`)

1. 暗証番号は「作る・直す」(工房)に入る時点で 1 回だけテンキーで聞き、この端末で 8 時間有効。エディタでは聞き直さない。見る側は不要。
2. エディタは上辺の帯をなくし、紙を画面上端まで。操作は右端 64px の記号列(戻る、保存、公開、素材、動画、文字、図形、範囲、元に戻す、やり直す、削除/改版を破棄)。左は 120px のページ列。機種 › 工程 › 文書名と「作る/直す」の札は紙の左上に重ねる 1 行。要素を選ぶと浮遊パネル(340px)で属性を編集し、閉じると紙だけ。結果の通知は左下に小さく出して消える。
3. 工房の右ペインは 1 行 56px の表形式(小さなサムネイル、名前、状態、担当/承認、ページ数、記号ボタン)。上に状態の絞り込み(全て/公開/下書き/改版中)と名前の絞り込み。数百件でも一覧できる。
4. 組立ホーム上辺はアイコンなしの文字だけ。「手順書」は工房と、「手順を作る」は「使う」と重複するので、並びを「見る | 作る・直す | 使う | 記録確認 | 製品構成 | 訓練」に整理。
5. 記録確認のブラウザ標準の入力窓(`window.prompt`)を 1 と同じテンキー式に置き換える。キャンセルは同じページに留まり「組立へ戻る」を出す。

PR は 2 本: (a) エディタの全高レイアウト + 工房入口の暗証番号 + 記録確認のテンキー化、(b) 工房の高密度一覧 + 組立ホーム上辺の整理。


## 組立画面のブラッシュアップ(2026-10-06 夕、承認済みモック `docs/design-previews/assembly-screens-mock.html`)

オーナーの実機確認で出た追加要望。PR は 4 本: (A) エディタの記号列の「戻る」を最下段へ + 工房のテンキー半幅(工程一覧を横に置き 2 列化)、(B) 組立テンプレート新規の全高レイアウト(上辺の帯を無くし、左ペインに段階・名前・工程・ページ、右端の記号列、紙は全高)、(C) 手順書/テンプレート管理の切替表示と高密度の表、(D) 記録確認の一覧 + 詳細 + 小さな承認札。いずれも機能は変えず配置だけ変える。


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

## Concrete Steps and Validation (Phase 3)

既存worktree `feat--procedure-material-sender-domains` でローカル実装だけを行った。`ProcedureMaterial` に既定GMAILのoriginとnullableなknowledgeRefを追加し、gmailMessageIdだけNOT NULLを解除する手書きmigration `20261005210000_add_procedure_material_knowledge_origin` を置いた。既存行のUPDATE/DELETEやKnowledge/WorkInstructionの変更はない。Prisma Clientは通常の `pnpm exec prisma generate` で生成できた。

新サービス `apps/api/src/services/assembly/procedure-material-knowledge.service.ts` はruntimeのreadySources/listPublished/getPublishedとassetsの読み取りだけを使用する。候補一覧はqで絞ってから既定100件(最大500件)へ制限し、棚のgmailDedupeKeyで取込済みを判定する。取込は1〜50件のキーだけを受け、サーバーが現在の候補を再解決する。写真はSHA256キー・整合性検証・衝突確認・GC後の原本復旧を既存Gmail方式に合わせる。取込後の配置は既存2bの経路を使用する。

指定検証を実行し、すべて成功した(約2分)。

    cd apps/api && pnpm lint && pnpm exec vitest run procedure-material && pnpm exec tsc -p tsconfig.build.json --noEmit
    cd apps/web && pnpm lint && pnpm exec vitest run procedure-manuals && pnpm build

APIは6ファイル96件成功(新規20件)、Webは3ファイル29件成功(追加3件)。APIはPrismaとknowledge runtimeをモックし、無効フラグ・検索・limit・取込済み・原文/ステップ/写真の保存・原本欠落fallback・衝突・GC競合・重複・消えた公開候補・画像404・認可・ナレッジ書込なしを確認した。Webは一覧/検索/複数選択/取込/未配置への移動/由来/配置モードと、無効表示、可視範囲だけの画像取得/URL解放を確認した。既存Gmail・素材棚・スケジュール・設定の対象回帰も成功した。

実DBのmigration適用・実端末受入・統合以降は未実施。画面が変わるためkiosk-sopの鮮度確認と生成物更新をpush前の統合段階に残す。変更禁止のgeneratedは触っていない。既存のbaseline-browser-mapping / Browserslist鮮度・Vite chunkサイズの警告は別スコープとして残る。開始時点のworktreeはcleanで、終了時には今回の10ファイルだけが変更・追加されている。

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

動画 V3(2026-10-05)はローカル実装と指定検証まで完了。API5ファイル119件、Web4ファイル47件、両lint、API build用tsc、隔離コピーでのWeb build、expand-only SQL2文が成功した。最初の環境不足(未ビルドのworkspace package、Prismaキャッシュ権限/エンジン)をローカル依存と一時領域で解消した。実DB・実ffmpeg・Pi5確認とmain統合・deployは未実施でintegrationPending。ブラウザ互換データの鮮度と大きいbundleの既存警告は別スコープとする。

動画 V2(2026-10-05)はローカル実装と指定検証まで完了した。範囲の検証、紐づけ済み409、10.5秒超の紐づけ拒否、コメント全置換の件数/文字数/時刻/順序、変換成功時の新キーとコメント補正、共有旧ファイルの保持、最終失敗時のREADY+TRIM_FAILED、範囲バー/確認/コメント編集/字幕シークをモックで確認した。実DBへのmigration適用、実ffmpeg/Pi5の切り出し、実機受入は未実施。commit・push・PR・main統合・deployは今回の依頼の範囲外で、integrationPendingを維持する。Web buildのブラウザ互換データ鮮度とbundleサイズの警告は別スコープとして変更しない。

Phase 1 のローカル実装と指定の検証を完了した。文書は改版ルートで保存し、閲覧時には最新の active PUBLISHED 版へ解決する。公開版のない項目は個別に「公開版なし」と表示し、正常な項目は既存ビューアで閲覧できる。機種が 0 件でも編集入口から割り当てを作成できる。

実行結果: `apps/api` の `pnpm lint`、`pnpm exec vitest run procedure-manual`（2 ファイル・12 件）、`pnpm exec tsc -p tsconfig.build.json --noEmit` は成功。`apps/web` の `pnpm lint`、`pnpm exec vitest run procedure-manuals`（1 ファイル・4 件）、`pnpm build` は成功。変更境界の既存回帰テストは API 3 ファイル・4 件、Web ビューア 1 ファイル・4 件が成功した。必要な生成物の準備に `packages/shared-types`、`shelf-layout-core`、`part-search-core`、`kiosk-sop-core` の build を実行した。検証の実行・準備は約 7 分（待機・並列実行を含む）。

(上の段落は Codex のローカル実装時点の記録。)その後、使い捨て PostgreSQL で全 migration の適用と CHECK 制約を確認し、Codex の読み取り専用レビューがキオスク PDF 削除経路の抜けを捕まえたので修正した。PR #1693 は CI 全通過後に squash merge(`c5ed099d`)し、Pi5 へ run `20261005-015725-1df4cb` で反映、health 200 を確認した。Phase 1 は本番反映まで完了。Phase 1のオーナー実機確認は今回の依頼で完了報告を受けた。後続は Phase 2(素材取込・白紙ページ・NFC 承認)、Phase 3(ナレッジ連携)、動画。実装は Codex、レビューも Codex(read-only)、検証と統合は Claude という分担で進めた。

範囲外の観測: Web 検証で baseline-browser-mapping / Browserslist のデータ更新警告と Vite の大きな chunk の警告が出た。今回の依頼では依存更新や既存 bundle の分割を行っていない。

Phase 2a の変更記録(2026-10-05): 上記 Plan of Work を2a/2b/2cへ分割し、素材取込・棚・管理カード・組込みスケジュールのローカル実装を追加した。指定検証は API 80件・Web 13件、lint / tsc / build がすべて成功し、既存境界の回帰71件も成功した。検証と環境準備は約7分。本番用の永続マウント、実 DB migration、実メール・端末確認、commit以降の統合段階は未実施。

Phase 2c の変更記録(2026-10-05): NFC承認公開と承認履歴の直近1件表示、公開方法選択、割り当ての文言・候補選択、閲覧専用の丸数字移動非表示をローカル実装した。指定検証はAPI55件成功・実DB1件skip、Web62件成功、両lint / API tsc / Web build成功。開始時点に既存WIPはなく、今回の24ファイルの変更だけを残した。実DB・実端末、commit / push / PR / merge / deployは未実施。kiosk-sop鮮度チェックと生成物更新はpush前の統合段階に残し、変更禁止の `apps/web/src/generated/**` は変更していない。

Phase 3 の変更記録(2026-10-05): 指定された片方向コピーを既存素材棚と原本保存方式に追加し、全指定検証(API96件・Web29件、両lint / API tsc / Web build)を完了した。ナレッジ・共有型・generated・infrastructureは変更していない。実DB・実端末と統合以降を残した。


動画 V1の変更記録(2026-10-05): 指定のAPI/Web検証は上記Progressの件数で成功した(環境準備とfocused checkを含め約10分)。追加の動画テストはAPI47件・Web6件で、添付MIME/容量/重複、状態遷移/共有原本/失敗後のREADY維持、ffmpeg引数と回転寸法、Range/権限/紐づけ、改版継承/破棄、READYだけの閲覧、Blob解放/可視poster取得を確認した。通常の1秒超のposterは1秒時点、1秒以下は中間フレームとする。Prismaの生成DDLと手書きmigrationの10文が一致することも確認した。実DB integration 1件はTEST_DATABASE_URL未設定によりskipで、migrationの実適用は未確認。

依存の準備はmain checkoutのnode_modulesをこのworktreeへ独立コピーし、workspace4パッケージをbuildしてPrisma Clientを生成した。Web buildの初回は既存Fontsourceが不足したため停止し、宣言済みSans5.2.8/Mono5.2.7を別worktreeのキャッシュからローカルnode_modulesへ補い、buildだけ再実行して成功した。package.json/lockfile/コピー元は変更していない。Browserslist/baseline-browser-mapping鮮度とViteの大きなchunk警告は既存の範囲外の問題として残る。kiosk-sopの確認・生成物更新はpush前の統合担当へ残し、変更禁止のgeneratedは触っていない。

今回の変更ファイル(既存WIPのinfrastructure/CI関連9ファイルを除外):

- DB: apps/api/prisma/schema.prisma、apps/api/prisma/migrations/20261006000000_add_procedure_videos/migration.sql。
- API取込・保存: services/assembly/procedure-material-gmail-ingestion.service.ts、procedure-material-gmail-packet-resolver.ts、procedure-video.service.ts、services/file-storage/file-storage-config.ts(いずれもapps/api/src配下)。
- API変換・定期実行: services/assembly/procedure-video-transcoder.port.ts、ffmpeg-procedure-video-transcoder.adapter.ts、procedure-video-processing.service.ts、procedure-video.scheduler.ts、bootstrap/start-post-listen-schedulers.ts。
- API配信・文書: routes/assembly/procedure-videos.ts、index.ts、procedure-documents.ts、services/assembly/assembly-procedure-document.service.ts、assembly-procedure-document-revision.service.ts、assembly-procedure-document-revision.serializer.ts、assembly-procedure-sequence.service.ts、procedure-manual.service.ts。
- APIテスト: routes/assembly/__tests__/procedure-videos.routes.test.ts、services/assembly/__tests__/ffmpeg-procedure-video-transcoder.test.ts、procedure-video-gmail.test.ts、procedure-video-processing.service.test.ts、procedure-video-view.test.ts、procedure-material-gmail.test.ts、procedure-manual.service.test.ts、bootstrap/__tests__/start-post-listen-schedulers.test.ts。
- Web入口・型: apps/web/src/api/domains/assembly.ts、features/assembly/types.ts、features/assembly/document-editor/AssemblyProcedureDocumentEditorPageList.tsx、AssemblyProcedureDocumentEditorScreen.tsx。
- Web棚・閲覧(すべてapps/web/src/features/assembly/procedure-manuals): ProcedureManualBrowser.tsx、ProcedureVideoShelfDialog.tsx、ProcedureVideoPlaybackDialog.tsx、ProcedureVideoThumbnail.tsx、ProcedurePageVideoStrip.tsx、procedure-video-types.ts、procedure-manuals-videos.test.tsx。
- 正本: docs/plans/procedure-manuals-execplan.md。


UX 改善(2 回目)の変更記録(2026-10-05): B/Dを既存の文書・割り当て・端末復旧機構に追加した。検証は `apps/api` で `pnpm lint && pnpm exec vitest run procedure-manual procedure-document assembly-procedure-document && pnpm exec tsc -p tsconfig.build.json --noEmit`、`apps/web` で `pnpm lint`、`pnpm exec vitest run procedure-manuals document-editor && pnpm build` が成功した(静的検査・対象検証と関連失敗の修正を含め約5分)。Web lint初回のimport区切りを修正し、heartbeat追加テストの仮想タイマー待ちを修正して対象テストだけ1回再実行した。最終確認で、advisory lock の戻り値 void を読み取らない既存パターンに合わせて `$executeRaw` に修正し、対象APIテスト・lint・tscを再確認した。APIの実DB1件はTEST_DATABASE_URL未設定でskip。migrationの初期固定ID・ON CONFLICTと追加DDLのテストは成功したが、実DBへの適用は未確認。buildのBrowserslist/baseline-browser-mapping鮮度と大きなchunk警告は既存範囲外。kiosk-sop生成物の更新はpush前の統合段階に残し、指定禁止のgenerated/共有型/lockfile/infrastructure/CIには変更を加えていない。既存WIPはなく、34ファイルすべて今回の変更である。

UX 改善(2 回目)の変更・追加ファイル一覧(34ファイル。各migrationは`migration.sql`):

- DB: `apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/20261006030000_add_machining_process_rows/migration.sql`、`apps/api/prisma/migrations/20261006040000_add_procedure_document_edit_leases/migration.sql`。
- API routes (`apps/api/src/routes/assembly/`): `index.ts`、`procedure-document-revisions.ts`、`procedure-documents.ts`、`procedure-document-edit-leases.ts`。
- API services (`apps/api/src/services/assembly/`): `assembly-procedure-document-blank.service.ts`、`assembly-procedure-document.service.ts`、`procedure-manual.service.ts`、`assembly-procedure-document-edit-lease.service.ts`。
- API route tests (`apps/api/src/routes/assembly/__tests__/`): `procedure-document-revisions.routes.test.ts`、`procedure-document-edit-leases.routes.test.ts`。
- API service tests (`apps/api/src/services/assembly/__tests__/`): `procedure-document-placement.service.test.ts`、`procedure-manual-approval.test.ts`、`procedure-manual.service.test.ts`、`assembly-procedure-document-edit-lease.service.test.ts`。
- Web API (`apps/web/src/api/domains/`): `assembly.ts`、`assembly-edit-lease.ts`、`assembly-document-editor-edit-lease.test.ts`。
- Web B (`apps/web/src/features/assembly/procedure-manuals/`): `ProcedureManualBrowser.tsx`、`ProcedureManualBlankDialog.tsx`、`procedure-manuals.test.tsx`。
- Web D (`apps/web/src/features/assembly/document-editor/`): `AssemblyProcedureDocumentEditorFeature.tsx`、`AssemblyProcedureDocumentEditorScreen.tsx`、`documentEditorConflict.ts`、`useAssemblyProcedureDocumentEditorController.ts`、`useAssemblyProcedureDocumentOverlayCommands.ts`、`useAssemblyProcedureDocumentRevisionCommands.ts`、`useAssemblyProcedureDocumentEditLease.ts`。
- Web D tests (同directory): `AssemblyProcedureDocumentEditorScreen.test.tsx`、`useAssemblyProcedureDocumentEditorController.test.ts`、`useAssemblyProcedureDocumentEditLease.test.ts`。
- 正本: `docs/plans/procedure-manuals-execplan.md`。

動画 V2追記(2026-10-05): 今回の正本はこのPlanに集約し、Progress/Decision Log/動画節/OutcomesをV2のローカル実装と検証結果へ更新した。main統合・本番反映は別段階として未実施を維持する。

動画 V3追記(2026-10-05): 接続を独立した動画として扱う実装と検証の正本をこのPlanへ追加した。Progress/Decision Log/動画節/Outcomesへ、入力正規化の理由、元動画の競合防止、コメントの先頭5件、隔離buildの証拠とintegrationPendingを記録した。gitの変更操作・禁止パスの編集・本番反映は行っていない。

動画取込の排他ロック修正(2026-10-08、#1860、main `4f9dc05a`): 実機で「今すぐ取り込む」が `Failed to deserialize column of type 'void'` で毎回「再試行」になった。動画の `pg_advisory_xact_lock` 4か所(取込、READY公開、元ファイル掃除、旧出力掃除)を `$queryRaw` で呼んでおり、void 列を読めずに失敗していた。`$executeRaw` へ変更し、Pi5 へ配布した(run `20261008-082550-b754c6`、success)。配布後に利用者が実機で動画メールの取込成功を確認した。単体テストは DB をモックしていて検出できなかったため、取込テストにロックの呼び方の確認を追加した。同日の実機確認で、トリミングのつまみを動かしても映像が動かず切り取り位置を判断できないとの指摘があり、つまみの移動時に動画を一時停止してその位置の画面を表示するようにした。

### 手順書エディタ「整える」(2026-10-08)

- 現在ページの未保存要素を受け取り、2案を返す。提案APIは保存せず、確定だけ履歴に1操作として積む。保存は手動。
- 業務LLMの既存 `business_hermes` はTEXT/IMAGEの構造判定のみ。文章は先頭200文字、座標は小数2桁で渡し、未知id・重複・種別違い・漏れは補完せず拒否する。
- 座標は純粋関数で計算。題名→手順→注意書き、写真は常に左、左右交互にしない。標準37%／写真大きめ50%の写真列、均等な行間、共通の手順文字サイズ。
- ページ画像の実寸とassetのwidth/heightで写真の縦横比を保つ。文章高さは1文字約1em・行高1.5の保守的概算で確保する。
- 必ず1ページに収めるため、写真を先に縮める。文章だけで収まらない場合は422。写真枠に中心があるSHAPEは線端点を含め同じ変換で追従し、付属図形のはみ出し分も確保する。
- 待機・プレビュー中は編集とページ／ツール切替をロック。取消は下書きを変えず、待機中の取消と接続切断はAbortSignalで推論を中断する。
- 推論失敗・後回し・構造不合格・配置不合格は個別エラーコード。認証・編集リースは素材placeと共通、レート制限は4回/分。
- ローカルの構造／配置・共有契約・ルート（推論/DBモック）・エディタ履歴を検証。本番LLMでの実測、実機確認、main統合・本番反映は未実施（integrationPending）。
- 本番反映(2026-10-08、#1862、main `a6234415`、run `20261008-091739-90c3eb`)後の実機確認で、押すたびに「いまは提案できません」になった。APIログは3回とも422 `ASSEMBLY_PROCEDURE_LAYOUT_DIMENSIONS_UNAVAILABLE`(写真の寸法)。通常の写真アップロードは `AssemblyProcedureAsset.width/height` を記録せず(記録するのは切り抜きだけ)、「古い写真だけの制限」という見立ては誤りだった。寸法が無い写真は保存済みの画像から測る(EXIFの向きを反映)ように修正した。画像を読めない場合だけ422のまま。
- 作り直し(2026-10-08): #1870 反映後の実機確認で案は出たが、オーナーの判定は「採用できない」。原因は、今の配置を見ずに題名→手順→注意書きの型へ並べ直し、写真を縮めていたこと。次の方針に替えた。
  - 今の配置から始める。写真が縦 1 列のページだけ、写真の端・文章の位置・行間をそろえる。写真の幅と高さは変えない。縦 1 列でないページは配置を動かさない。
  - 収まらないときは、行間を詰める→文字を 80% まで小さくする→それでも無理なら 422 `ASSEMBLY_PROCEDURE_LAYOUT_DOES_NOT_FIT`。
  - 業務LLMは文章を読みやすく書き直す(品名は 1 行 1 品、作業は番号付き 1 行 1 動作)。要素ごとに検査し、元の数値がすべて残り、新しい数値が増えていないものだけ採用する。LLM が応答しなくても配置だけの案を返す。
  - 写真の読み取りは、文章が無い行と見出しだけの行に限り、1 行だけ足す(最大 6 枚)。足した行は `addedElementIds` で返し、プレビューで色を付ける。確定後は普通の文章なので、人が消せる。
  - 返すのは最終案 1 つ(`elements`、`addedElementIds`、`changes`)。指摘の一覧や複数案は出さない。画面は直した点の一覧、前/後の切替、やめる/これにする。
- 工場LLMの実測(2026-10-08、本番の 3 ページ・写真 11 枚): 写真 1 枚 1〜3.3 秒、文章の書き直し 1 ページ 2.4〜5.5 秒。文章の整形は 3 ページとも数値の欠落なし。写真の読み取りは文脈なしだと誤り(「バイスに固定」など)が文章へ混ざったため、上の対象の限定と検査を入れた。限定後も写真の 1 行は一般的な表現が多く、5 行中 1 行は誤り(作業台を電磁チャックと記述)。オーナー判断で、色付きで載せて人が消す運用にした。
- 作り直しの検証: 本番 3 ページの実データで、写真の大きさが不変、紙の内側(下端 0.96 以内)に収まることを確認。shared-types 70 件、API の配置とルート 45 件、Web の document-editor 263 件、API/Web の型検査と lint が成功。
- 作り直しの本番反映(2026-10-08): #1879 を main `4a18365f` へ統合(head `be98dfc4`、23:20)、Pi5 へ配布(run `20261008-142826-97b275`、success、failed=0、unreachable=0)。api と web は同じ release で入れ替え、`/`・`/admin`・`/kiosk`・`/api/system/health` は 200。戻し先は `9e97ce2e`(#1878)。本番LLMを通した実測とオーナーの実機確認は未実施。


### 動画の場面(非破壊の範囲指定) (2026-10-08)

- [x] (2026-10-08) 動画の場面(非破壊の範囲指定): 場面CRUD、ページ紐づけ、改版への複製、棚の場面選択、つまみ移動時の実動画シーク、範囲ループ再生、名前変更、削除と1段階の「元に戻す」をローカル実装した。場面は動画ごとに20件、0.1秒単位・最短0.5秒、長さの上限なし。
- [x] (2026-10-08) 場面サムネイル: 場面作成・範囲変更のコミット後に、保存済みMP4の開始位置のフレームをbest-effortで生成する。失敗はログへ記録し、リクエストは成功を維持して動画ポスターへフォールバックする。
- [x] (2026-10-08) main統合・本番反映: #1869 を main `44bff513` へ統合(head `e3108db4`、20:37)、Pi5 へ配布(run `20261008-114807-7a62a5`、success、failed=0、エラーログ0、`/`・`/admin`・`/kiosk`・`/api/system/health` が200、20:53)。戻し先は `5f691d4d`。migrationは main の在庫migration(`20261008130000`/`20261008130100`)の後ろに並ぶよう `20261008140000_add_procedure_video_scenes` へ改名し、既存表 `ProcedureVideoLink` への `sceneId` 外部キー追加1文だけを `scripts/deploy/validate-expand-only-migrations.py` の個別許可に加えた。本番DBでの適用はreleaseの成功とAPI起動からの判断で、DBを直接は読んでいない。
- [ ] オーナー実機確認: 21.5インチ1920×1080で画面内に収まり、タッチ操作・場面作成/紐づけ・範囲再生・削除/復元と開始位置のサムネイル表示が期待どおり動くことを確認する。

- Decision: 動画ファイル1本と複数の開始/終了範囲を保存し、破壊的なトリミングを場面編集へ置き換える。ページ紐づけの10.5秒制限を廃止する。紐づいた場面の範囲変更/削除は409で拒否し、名前変更だけ許可する。`sceneId=null`は動画全体を表し、既存リンクのデータ移行は不要。新規テーブル、nullable列、index、FKだけのexpand-only migrationを使う。
  Rationale: 範囲を選ぶ操作自体をガードとして、元動画と公開済み文書の再生範囲を保持する。元の10秒制限の理由は記録されていない。動画の行ロックを場面・紐づけ・discard・trimで共有し、場面のある動画のtrimを拒否する。DBを戻さずアプリだけ戻せる追加変更に留める。
  Date/Author: 2026-10-08 / Codex。

- Decision: 場面のnullable `posterStorageKey`に開始位置の画像を保存し、棚・場面エディタ・ページ動画一覧は`hasScenePoster`が真なら場面ポスター、偽なら動画ポスターを使う。範囲変更で旧画像の参照を外し、生成後は場面が同じ開始位置かつポスター未設定のときだけ公開する。差し替え・削除・競合で不要になったファイルと一時ファイルはbest-effortで掃除する。
  Rationale: ffmpeg実行中は行ロックを保持せず、生成失敗や同時編集で範囲操作を失敗させない。画像は既存の`procedure-videos/`配下に保存してGoogle Drive DRの保護対象を維持する。
  Date/Author: 2026-10-08 / Codex。

検証: Prisma generate、API/Web lint、Web tsc、Web指定テスト465件が成功。API全体の`pnpm exec tsc --noEmit`は既存tsconfigのrootDir外ファイル5件(TS6059)で失敗し、対象外の設定は変更していない。API指定テストは333件成功・1件skip、Gmail取込の実DB統合4件はlocalhost:5432へ接続できず失敗(場面service/routes/summaryのテストは成功)。実DBへのmigration適用と実機確認は未実施。commit/push/PR/merge/deployは未実施でintegrationPending。変更禁止のgenerated配下とtrim/concat workerは変更していない。

場面サムネイル追記の検証(2026-10-08): Prisma generate、API/Web lint、Web `pnpm exec tsc --noEmit`が成功。APIの`pnpm exec vitest run procedure-video ffmpeg-procedure-video backup-recommended`は7ファイル189件成功。Webの`pnpm exec vitest run procedure-manuals document-editor`は23ファイル469件成功、追加のposter URLテスト2件も成功。作成/範囲変更後の生成、失敗時の成功応答、競合時の公開抑止と掃除、配信200/404、DTOの存在フラグ、動画ポスターへのフォールバック、範囲更新後の画像再取得を確認した。実Postgresへのmigration適用・実機目視は未実施。既存WIPを保持し、gitの変更操作・生成ソース変更・本番反映は行っていない。

追加のブラウザ目視確認は未完了: ローカルChromiumはsandboxのMachPort権限で起動できず、Browser Useのローカルfile URLもURLポリシーで拒否された。回避操作は行わず、1920×1080の目視/タッチ確認は上のオーナー実機確認に残す。
