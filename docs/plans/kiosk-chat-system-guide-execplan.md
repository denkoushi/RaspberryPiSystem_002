# キオスクの Chat をシステム全体の案内役にする(操作の問い合わせと不具合の受付)

This ExecPlan is a living document and must be maintained according to `.agent/PLANS.md` at the repository root. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

## Purpose / Big Picture

キオスク画面の右下にある丸ボタンから開く「フローティング Chat」は、現場の人がシステムに話しかける唯一の窓口である。2026-10-13 に現場から初めて実利用の文「タグをかざしても反応しない」が入ったが、Chat はそれを不適合記録の検索として処理し、「検索対象 N 件の中に、一致する記録は見つかりませんでした。これは不存在の証明ではありません。」で終わった。現場の人が欲しかったのは、記録ではなく「どうすればよいか」か「誰かに直してもらうこと」である。

この計画の完成形は次のとおりである。現場の人が Chat の入力欄に何を書いても、案内役(業務 Pi5 上で動く業務 Hermes という AI)がまず意図を見分け、(1) 業務記録の検索、(2) システム操作の説明、(3) 不具合の受付、(4) 人への引き継ぎ、のどれかとして扱う。操作の説明は、リポジトリに置く現場向けの文書を正本にして答える。不具合の報告は、その端末の既知の不調(システム通知)と照合し、未知なら「お問い合わせ」のスレッドを自動で起こして「担当者に伝えました」と返し、その場でできる対処を添える。利用の件数は朝の集計に出て、答えられなかった操作の質問は文書に追記する候補として一覧になる。

利用者から見える完成の証拠は、Chat の入力欄が一つになり(「検索」「JEV記録」のボタンが無くなり)、「タグをかざしても反応しない」と書くと、端末名を含む受付の返事とその場の対処が返り、受け取る端末の受信箱に「システム」の印の付いたスレッドが現れること、「自主検査の始め方」と書くと該当画面の手順が短く返ること、「NC-1234 の是正」と書くと今までどおり不適合記録の検索結果が返ることである。

## Progress

- [x] (2026-10-14) 要件を利用者と合意した。知識の正本はリポジトリの文書、不具合は照合して自動起票、入口は一つに統合して裏で振り分け、計測は朝の集計に件数と知識不足の一覧、最初の知識範囲はキオスク全画面の基本操作とよくある困りごと。
- [x] (2026-10-14) 現状の構造を調査した(下記 Context and Orientation)。
- [x] (2026-10-14) Milestone 1 を実装(branch `feat/kiosk-chat-guide-m1-operation-docs`): `docs/kiosk-operation-guide/` に画面別の文書と `common/` の共通編、`scripts/docs/check-kiosk-operation-guide.mjs` と単体テスト、CI の `repo-policy` ジョブへの組み込み。文書の下書きは Codex に書かせ、画面の文字列と照合して直した。
- [x] (2026-10-14) Milestone 2 を実装(branch `feat/kiosk-chat-guide-m2-hermes-source`): API イメージへ `docs/kiosk-operation-guide/` を複製、`KIOSK_OPERATION_GUIDE_DIR` で読み込む節の索引、`business_hermes_search` / `business_hermes_get_detail` の `kind=system_operation_guide`、最初の目的確認に「操作の方法を調べる」の選択肢、SKILL.md.j2 0.5.0 の「システム操作の問い合わせ」。API 実装は Codex に書かせ、Claude が差分とテストを確認した。
- [x] (2026-10-14) Milestone 2 を main に統合し業務 Pi5 へ配布(#2002、main f59dee7c、run 20261014-021724-3dc455)。実機で「チップの登録手順」に正しい手順が返った。回答まで数十秒かかり、表示も読みにくいと利用者から指摘を受けた。
- [x] (2026-10-14) Milestone 2b を main に統合し業務 Pi5 へ配布(#2008、main 670a9d8e、run 20261014-044056-3281e1)。実機確認は配布後に依頼。内容: 「操作の方法を調べる」を選んだときは LLM を通さず、該当する画面の節をそのまま返す(先読みも省く)。回答に `guide`(画面名と節)の表示データを付け、Web は番号付きの手順として描く。
- [ ] Milestone 3(branch `feat/kiosk-chat-guide-m3-trouble-intake`): 不具合の受付(システム通知の照合とお問い合わせの自動起票)。MCP の道具ではなく、選択式の型「不具合を知らせる」をサーバー側で確定的に処理する(Decision 参照)。
- [ ] Milestone 4: 入口の一本化(「検索」「JEV記録」の統合と、記録検索への橋渡し)。
- [ ] Milestone 5: 計測(受領ログの振り分け先と朝の集計)。 操作説明で知識が無かった質問(`guideMiss`)の文面を朝の集計に一覧で出し、文書へ追記する候補にする(利用者が 2026-10-14 に「使うほど賢くなる」仕組みとして要望)。
- [ ] 各 Milestone の PR、main 統合、Pi5 配布、実機確認。配布と確認は本計画の対象だが、依頼された段階を越えて進めない。

## Surprises & Discoveries

- Observation: 「人へ引き継ぐ」経路はすでに本番にある。Chat の「お問い合わせ」→「＋ 新規」は受け取る端末と Slack に届き、端末の不調(社員証リーダー、バーコードリーダー、電源、SD カード、空き容量、温度)は「システム通知」として同じ受信箱に自動で出る(`docs/runbooks/kiosk-inquiry-inbox.md`)。足りないのは通知経路ではなく、入力欄に入った文をそこへ回す判断である。
- Observation: 10/13 の発話は「JEV記録」(AI を使わない決まった手順の検索)に入り、その経路の「記録外」判定(`scripts/hermes-search/retrieval/planner-jev.mjs` の out_of_scope)も働かなかった。決まった手順の判定だけに頼る振り分けでは同じ事例を取りこぼす。
- Observation: 既存の「操作ガイド」(`apps/web/src/features/operation-guide/`)は「手順書の作り方」など決まった言い回しだけに反応するブラウザ内の仕組みで、一般の操作の質問には何も起きない。
- Observation: Milestone 2 で、`.dockerignore` は `docs/**` を除外しているため、API イメージへ文書を入れるには `!docs/kiosk-operation-guide/**` の例外と Dockerfile の COPY が要る(小さな build context で複製されることを確認した)。環境変数は Ansible の変数ではなく `docker-compose.phase3.yml` の api 環境に固定値で置いた(イメージ内の経路で秘密ではない)。
- Observation: Milestone 1 の文書は、ルート 57 件(転送 4 件を除き 53 件)を画面単位の文書約 40 件にまとめると書けた。編集・印刷・セッション詳細などパラメータ付きのルートは親画面の文書に含める方が現場の人の問いに合う。
- Observation: 要領書(`docs/plans/procedure-manuals-execplan.md`)は「この機種をどう組むか」という製品の作業知識であり、「タグが反応しない」「ログインの仕方」というシステム操作の知識ではない。現場向けのシステム操作の文書は、組立と検査図面の 2 画面分の操作手順(`scripts/kiosk-sop/` の生成物)と管理者向けの `docs/guides/operation-manual.md`(最終確認 2025-12)しか無く、ほぼ新しく書くことになる。

## Decision Log

- Decision: 操作知識の正本はリポジトリの文書とし、開発側が画面変更の PR ごとに更新する。Rationale: コードと同じ履歴で管理でき、画面と文書のずれを CI で検査できる。管理画面で書く FAQ は、ずれに人が気づくしかなく実装も大きい。利用者が 2026-10-14 に選択。
- Decision: 不具合と見分けた文は、その端末の未復旧のシステム通知と照合し、既知なら「把握しています」と返し、未知ならお問い合わせを送信者なし(端末名だけ)で自動起票して「担当者に伝えました」と返す。どちらもその場の対処を添える。Rationale: 現場の人に起票の操作をさせない。誤判定で起票されても受信箱で閉じられる。利用者が 2026-10-14 に選択。
- Decision: 入口は一つにし、案内役が「記録の検索」と判断した文だけを今までの JEV 記録の検索(決まった手順)へ渡す。Rationale: T10 で積み上げた検索精度の仕組みをそのまま活かし、それ以外の文を案内役が受ける。利用者が 2026-10-14 に選択。
- Decision: 計測は、朝の集計に振り分け先ごとの件数と、操作説明で知識が無かった質問の文面を出す。誰が言ったかは記録しない。Rationale: 文書に追記する候補を人が拾えるようにする。利用者が 2026-10-14 に選択。
- Decision: 入力欄は一つにするが、「ナレッジ」(手順書の知識機能)と「お問い合わせ」のボタンは当面残す。Rationale: 「ナレッジ」は素材の投入と承認という別の作業の入口で、文の意図判定では置き換えられない。利用者の合意は「検索」「JEV記録」の統合までであり、「ナレッジ」も統合するかは別途判断する(暫定)。
- Decision: 私用 Pi5(Hermes/Discord)の情報・設定・経路は一切使わない。案内役は業務 Pi5 の `business-hermes-chat` コンテナだけで動かす。Rationale: 業務系と私用系の分離は長期不変の境界。
- Decision: 実装は T10(検索精度)とは別の branch と PR で行い、Milestone ごとに 1 つの PR にする。Rationale: 検索精度の計測と切り分けるため。
- Decision (Milestone 2): `business_hermes_search` / `business_hermes_get_detail` は計画どおり `kind=system_operation_guide` を受けるが、内部は既存の 2 情報源の仕組み(カーソル、根拠キー、`kind=both`、夜間の書き出し)に通さず、関数の先頭で操作ガイドの索引へ分岐する。情報源の定義も `businessHermesSourceDefinitions` には足さず、`describe_sources` と相談の `sourceDefinitions` の 2 か所で、索引が読めたときだけ追加する。Rationale: 定義一覧は検索条件の解決(`requestedKinds`)や夜間の書き出しにも使われており、第 3 の種類を混ぜると不適合・要領書の経路に影響する。
- Decision (Milestone 2): 新しい相談の最初の「知りたい内容を選んでください」はサーバーが選択肢を組み立てているため、SKILL の変更だけでは操作の質問が記録の選択肢へ流れる。操作ガイドの索引が画面名か keywords で当たる質問にだけ、「操作の方法を調べる：…」の選択肢(型 `operation-guide`)を足す。画面名が当たるときは先頭に置いて先読みもその型で行い、keywords だけが当たるときは末尾に置く(keywords には 品番 などの一般語が含まれ、記録の質問も当たるため)。Rationale: 当たらない質問の選択肢は今までと変えず、記録の相談の先読みを奪わない。
- Decision (Milestone 2): 応答の `routeDecision` と `guideMiss` は応答の解析で受け取り、回答メッセージの `searchDiagnostics` に `business-hermes-route-v1` として保存する。受領ログや朝の集計への反映は Milestone 5 で行う。
- Decision (Milestone 2): ブラウザ内の既存の「操作ガイド」(`isOperationGuideQuestion`)は「手順書の作り方」などの決まった言い回しだけを横取りするので、「自主検査の始め方」はサーバーへ届く。両者の統合は Milestone 4 で「検索」モードを外すときに扱う。

- Decision (Milestone 2b): 操作ガイドの答えは LLM に 3 行へ要約させず、該当する節(「基本の手順」を必ず含め最大 2 節)を原文のまま返し、構造化した表示データで描く。Rationale: 操作ガイドは固定の文書で、要約のために DGX を 2 往復させると実機で 15〜30 秒かかった。節をそのまま返せば 1〜2 秒で、文言も文書と一致する。不適合記録のような夜間の回答蓄積は不要で、代わりに `guideMiss` の質問を文書追記の候補として集める(Milestone 5)。SKILL.md.j2 の「システム操作の問い合わせ」は、確認後の自由入力が LLM に届く場合のために残す。利用者が 2026-10-14 に承認。

- Decision (Milestone 3): 不具合の受付は MCP の道具 `business_hermes_report_trouble` と SKILL の文面ではなく、質問の型「不具合を知らせる：…」としてサーバーが LLM を通さず処理する。理由は 2 つ。(1) Milestone 2b で操作の質問は LLM を通らなくなり、「タグをかざしても反応しない」は操作ガイドの型が先頭に出て選ばれるため、SKILL に書いた道具呼び出しは本来の受け入れ試験で一度も動かない。(2) MCP 経路は MCP キーだけで認証され相談や端末の文脈を持たないので、道具の実行時に端末を特定できない。処理は、`POST /assembly/business-hermes/chat` が `x-client-key` で呼ばれたとき端末 id を相談に渡し、質問に不調の語(反応しない・動かない・エラー・固まる・つながらない・印刷できない等)があり端末が分かるときだけ型を先頭に出す。選択後は、操作ガイドの該当する節(主に `common/troubleshooting.md`)を Milestone 2b と同じ表示で返し、端末の `statusClientId` に対する未復旧のシステム通知(`status:<clientId>:…` と telemetry の JSON 配列キー)があれば「既に把握しています」、なければ `createKioskInquiryThread` をその端末を送信者として呼び(本文「Chat から自動受付: <質問>」、`page` は `chat-trouble:<category>`、同じ端末・同じ category は 24 時間以内なら既存スレッドへ追記)、既存の Slack 通知関数で配送して「担当者に伝えました」と添える。JWT だけの呼び出しには型を出さない。`business-hermes-route-v1` には `route: 'trouble_report', direct: true, known` を記録する。SKILL/CONTEXT と MCP は変えないので Chat コンテナの再作成は不要。

## Outcomes & Retrospective

- 2026-10-14 Milestone 3 ローカル実装(PR 作成時点): Decision (Milestone 3) に従い、端末からの不調の質問に「不具合を知らせる」を先頭に出し、LLM を通さず操作ガイドの提示・既知通知の照合・24 時間以内の問い合わせ追記・Slack 通知を実装。配布と実機確認は未実施。

- 2026-10-14 Milestone 2 配布後: キオスクの Chat「検索」で「チップの登録手順」と入れると、「操作の方法を調べる：…」の選択肢が出て、タグ管理の手順が返った(内容は妥当)。回答まで数十秒。表示は段落が詰まって読みにくい。原因は LLM 経由の 2 往復と素朴な整形で、Milestone 2b で直す。

## Context and Orientation

用語を先に定める。「フローティング Chat」は `apps/web/src/components/hermes/HermesFloatingChat.tsx` が全画面に常駐させるパネルで、`/kiosk` 配下の画面では「お問い合わせ」も同じパネルに出る。「業務 Hermes」は業務 Pi5 上の `business-hermes-chat` コンテナ(公式 hermes-agent イメージ)で、`docs/runbooks/business-hermes.md` にあるとおり私用 Pi5 と何も共有しない。推論は DGX か OpenAI のどちらかを設定で選ぶ。業務 Hermes の人格と振る舞いは、このリポジトリの `infrastructure/ansible/templates/business-hermes-chat/`(設定と `skills/business-consultation/SKILL.md.j2`)から Ansible で配布する。「MCP の道具」は、業務 Hermes が API を呼ぶための関数群で、`apps/api/src/services/assembly/business-hermes-mcp.service.ts` に `business_hermes_describe_sources`、`business_hermes_search`、`business_hermes_get_detail` などとして定義されている。「情報源」は業務 Hermes が検索できる業務記録の種類で、`apps/api/src/services/assembly/business-hermes-source-adapters.ts` の `businessHermesSourceDefinitionList()` が項目の意味と制約を Hermes に説明する。

Chat の裏側は現在 4 つの経路に分かれている。パネル上部のボタン「検索」は業務 Hermes との相談(`POST /assembly/business-hermes/chat`、`apps/api/src/services/assembly/business-hermes-consultation.service.ts`)で、情報源を道具として検索して答える。「ナレッジ」は手順書の知識機能。「JEV記録」は AI を使わない決まった手順の検索(`POST /assembly/hermes-search-trial/answer`、実体は `scripts/hermes-search/retrieval/worker.mjs`)で、結果が無いときの文言は `noResultAnswer` にある。「お問い合わせ」は `apps/api/src/services/kiosk-inquiry/kiosk-inquiry.service.ts` の `createKioskInquiryThread` でスレッドを作り、受け取る端末と Slack に届く。端末の不調は `apps/api/src/services/kiosk-inquiry/system-notice.service.ts` の `deliverSystemNotice` が同じ受信箱に「システム」の印を付けて出す。

実利用の記録は `apps/api/src/services/assembly/hermes-search-receipt-log.ts` が業務 Pi5 の永続ボリューム(`/app/storage/hermes-search/runtime/receipts/receipts-YYYY-MM-DD.jsonl`)に 1 日 1 ファイルで追記する。質問の文面と結果の種別、表示した記録 id は書くが、記録の本文は書かない。夜間ランナー(`scripts/hermes-search/retrieval/flywheel-runner.mjs`)がこれを `flywheel-real.mjs` で読み、`real-YYYY-MM-DD.jsonl` と朝の集計に反映する。

キオスクの画面は `apps/web/src/pages/kiosk/` にあり、持出返却、組立(ホーム、作業、記録確認、要領書、訓練、トレーサビリティ)、自主検査、検査図面、計測器、写真、治具、品目在庫、タグ机、生産日程、可動棚、発注照会などがある。ルート一覧は `apps/web/src/App.tsx` のルーター定義から取る。

## Plan of Work

### Milestone 1: 現場向けの操作知識の文書

`docs/kiosk-operation-guide/` を新設し、現場の人が読む短い日本語で書く。共通編として「社員証(タグ)をかざす」「ログインと解錠」「バーコードの読み取り」「お問い合わせの送り方」「困ったとき(タグが反応しない、印刷できない、画面が固まった、通知が消えない)」を置く。画面編として `/kiosk` 配下の画面ごとに 1 ファイルを置き、frontmatter に `routes`(例 `[/kiosk/part-measurement/self-inspection, /kiosk/part-measurement/self-inspection/start]`。編集・印刷などの関連ルートは同じ文書にまとめる)、`title`、`keywords`(現場の言い回し。例 「タグ」「カード」「かざす」)、`last-verified` を持たせる。本文は「この画面でできること」「基本の手順」「よくある困りごととその場の対処」「それでも直らないとき(お問い合わせへ)」の 4 見出しに固定する。管理コンソールとサーバー操作は対象外。

ずれの検査として `scripts/docs/check-kiosk-operation-guide.mjs` を追加し、ルーター定義の `/kiosk` 配下の全ルート(`Navigate` や `KioskRedirect` で転送するだけのルートを除く)に対応する文書があること、frontmatter の必須項目があること、文書の `routes` が実在すること、4 見出しが順にあることを確かめる。CI では毎回動く `repo-policy` ジョブに置く(文書だけの変更でも画面だけの変更でも走るため)。既存の文書監査(`node scripts/docs/audit-docs.mjs --check`)に通るよう、新しい文書にも frontmatter を付ける。この Milestone の終わりには、文書一式と検査スクリプトが存在し、検査が成功する。

### Milestone 2: 操作知識を業務 Hermes の情報源として公開

API が文書を読めるようにする。`apps/api` のイメージ作成時に `docs/kiosk-operation-guide/` をイメージ内へ複製し、環境変数 `KIOSK_OPERATION_GUIDE_DIR` でその場所を指す(未設定なら読み込まず、情報源の一覧にも出さない)。起動時に一度読み、見出しごとの節(画面、見出し、本文、keywords)に分けてメモリに持つ。新しい情報源 `system_operation_guide` を `business-hermes-source-adapters.ts` に追加し、`businessHermesSourceDefinitionList()` に「システムの操作説明。製品の要領書ではない」と項目の意味を書く。`business_hermes_search` はこの情報源に対して、画面名・見出し・keywords・本文への部分一致で節を返す。`business_hermes_get_detail` は節の全文を返す。

業務 Hermes の `SKILL.md.j2` に「システム操作の問い合わせ」の節を加え、操作の質問には `system_operation_guide` だけを検索し、該当する節の手順を 3 行程度に要約して画面名を添えて答えること、該当が無いときは推測せず「この操作の説明はまだありません。『お問い合わせ』から聞いてください」と返し、応答の `routeDecision` を `operation_guide`、`guideMiss` を true とすることを定める。この Milestone の終わりには、「検索」モードで「自主検査の始め方」と書くと手順が返る。

### Milestone 3: 不具合の受付道具

MCP の道具 `business_hermes_report_trouble` を追加する。入力は `symptom`(利用者の文をそのまま 200 文字まで)と `category`(`card_reader`、`barcode_reader`、`printer`、`screen`、`network`、`other` のいずれか)で、端末は Hermes に渡させず、サーバーが相談(consultation)に結び付けた端末から特定する。現在の相談の記録は端末 id を持たないので、`POST /assembly/business-hermes/chat` が `x-client-key` で認証されたときに端末 id を相談の実行文脈へ渡し、道具の実行時に参照できるようにする。管理コンソールなど JWT だけで呼ばれた相談には端末が無いため自動起票はせず、「お問い合わせ」から送るよう案内する。処理は、まずその端末(`ClientDevice`)の未復旧のシステム通知スレッドを探し、あれば `{ known: true, title }` を返す。なければ `createKioskInquiryThread` を送信者なしで呼び、本文を「Chat から自動受付: <symptom>」とし、`{ known: false, threadId }` を返す。同じ端末・同じ `category` の自動起票スレッドが 24 時間以内にあれば新しく作らずそこへ追記する。Slack 配送は既存の起票経路のままにし、新しい配送先は作らない。

`SKILL.md.j2` に「不具合の報告」の節を加え、「反応しない」「動かない」「エラー」「固まる」など不調を述べる文は、まず `system_operation_guide` の「困ったとき」からその場の対処を 1 つか 2 つ引き、続けて `business_hermes_report_trouble` を呼び、`known` なら「この端末の〇〇の不調は既に把握しています」、そうでなければ「担当者に伝えました」と返すことを定める。応答の `routeDecision` は `trouble_report`。この Milestone の終わりには、「タグをかざしても反応しない」と書くと受付の返事が返り、受け取る端末の受信箱に新しいスレッドが出る。

### Milestone 4: 入口の一本化

Web の `HermesChatPanel.tsx` から「検索」「JEV記録」のモード切替を外し、入力欄を一つにする(「ナレッジ」と「お問い合わせ」はそのまま)。送信はすべて業務 Hermes の相談へ送る。MCP の道具 `business_hermes_record_search` を追加し、入力 `question` をそのまま `hermes-search-trial/answer` と同じ関数(`scripts/hermes-search/retrieval/worker.mjs` の経路)に渡し、`answer` と `recordIds` を返す。`SKILL.md.j2` に、不適合番号・品番・工程・不具合の現象など記録を探す文は、自分で検索せず `business_hermes_record_search` を 1 回呼び、その `answer` を変えずに返すことを定める。これで T10 の検索精度の仕組みはそのまま使われる。応答の `routeDecision` は `record_search`。

業務 Hermes が使えないとき(`unavailable`)は、Web が今までの JEV 記録の検索へそのまま送る。その際の「結果なし」の文言は `noResultAnswer` を「一致する記録はありませんでした。操作の説明や不具合の連絡は『お問い合わせ』から送ってください。」に改める。この変更は T10 の作業ファイルに触るため、T10 のセッションに事前に伝えてから別 PR で行う。この Milestone の終わりには、ボタンが無くなり、3 種類の文がそれぞれ正しく扱われる。

### Milestone 5: 計測

受領ログ(`hermes-search-receipt-log.ts`)に `route`(`record_search` / `operation_guide` / `trouble_report` / `handoff`)と `guideMiss` を加え、相談経路の応答からも 1 行書く(質問の文面と種別だけ。記録の本文と利用者の特定は書かない)。`flywheel-real.mjs` と `receipt-report.mjs`(受領ログの集計)と `flywheel-report.mjs`(朝の集計)を、振り分け先ごとの件数と、`guideMiss` の質問の文面の一覧を朝の集計に出すよう広げる。この Milestone の終わりには、朝の集計に「操作説明 3 件(知識なし 1 件: 『印刷の紙が出ない』)」のような行が出る。

## Concrete Steps

作業ディレクトリは、この計画専用の feature branch の linked worktree とする。`python3 -m scripts.git_lifecycle.cli` を `.cursor/rules/20-git-workflow.mdc` に従って使い、T10 の branch とは分ける。

Milestone 1 では `docs/kiosk-operation-guide/` を書き、次を実行して成功を確かめる。

    node scripts/docs/check-kiosk-operation-guide.mjs
    node scripts/docs/audit-docs.mjs --check

Milestone 2 と 3 と 4 では API と Web の対象テストを指定して実行する。

    pnpm --filter @raspi-system/api exec vitest run src/services/assembly/business-hermes-mcp.service
    pnpm --filter @raspi-system/api exec vitest run src/services/kiosk-inquiry
    pnpm --filter @raspi-system/web exec vitest run src/components/hermes
    pnpm --filter @raspi-system/api typecheck && pnpm --filter @raspi-system/web typecheck

Ansible のテンプレート変更は、既存の業務 Hermes 設定検証(`docs/runbooks/business-hermes.md` の Compose 検証)を使う。配布は `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan` で対象を確かめてから、業務 Pi5 だけに限定して行う。業務 Hermes の設定(SKILL)の反映には `business-hermes-chat` の再起動が要るので、Runbook の手順に従う。

## Validation and Acceptance

Milestone ごとに、上記のテストと型検査が成功し、CI(deploy impact 表を含む)が通ること。配布後の実機では、キオスクの Chat に次の 3 文を入れて確かめる。「タグをかざしても反応しない」で端末名を含む受付の返事とその場の対処が返り、受け取る端末の受信箱にスレッドが出ること。「自主検査の始め方」で該当画面の手順が返ること。「NC-1234 の是正」で今までどおり記録の検索結果が返ること。翌朝の集計に振り分け先ごとの件数が出ること。

## Idempotence and Recovery

文書と検査スクリプトは何度実行しても同じ結果になる。情報源の追加は `KIOSK_OPERATION_GUIDE_DIR` を外せば無効になり、他の情報源に影響しない。自動起票は 24 時間の重複抑止があるので、同じ不調で受信箱があふれない。入口の一本化は Web と API を前の版へ戻せば元のボタンが戻る。受領ログの新しい項目は既存の読み手が無視する。

## Interfaces and Dependencies

`apps/api/src/services/assembly/business-hermes-source-adapters.ts` に `kind: 'system_operation_guide'` の定義を追加し、`businessHermesSourceDefinitionList()` が返す。`apps/api/src/services/assembly/business-hermes-mcp.service.ts` に `business_hermes_report_trouble` と `business_hermes_record_search` の 2 つの道具を追加し、`TOOLS` 配列と `BUSINESS_HERMES_MCP_TOOL_NAMES` に加える。`apps/api/src/services/kiosk-inquiry/kiosk-inquiry.service.ts` の `createKioskInquiryThread` を送信者なしで呼べることを確認し、必要なら自動受付用の呼び口を追加する。`apps/api/src/services/assembly/hermes-search-receipt-log.ts` の追記項目に `route` と `guideMiss` を加える。`infrastructure/ansible/templates/business-hermes-chat/skills/business-consultation/SKILL.md.j2` に「システム操作の問い合わせ」「不具合の報告」「記録の検索は道具へ」の 3 節を加える。Web は `apps/web/src/components/hermes/HermesChatPanel.tsx` と `HermesFloatingChat.tsx` のモード切替を変更する。

依存する正本は、`docs/runbooks/kiosk-inquiry-inbox.md`(受信箱)、`docs/runbooks/business-hermes.md`(業務 Hermes の配布と境界)、`docs/plans/hermes-operation-guide-execplan.md`(既存の操作ガイド)、`docs/plans/hermes-synthetic-question-flywheel-execplan.md`(夜間ランナーと集計)。

## Artifacts and Notes

2026-10-13 の実利用 1 件は業務 Pi5 の `/app/storage/hermes-search/runtime/flywheel/real-2026-10-13.jsonl` にあり、`dayOutcome=no_result`、計画は filters なし、`semanticQuery` が質問全文、30 件の候補がすべて却下された。画面に出た文は記録されていないが、経路から `noResultAnswer` の文であったとみなす。
