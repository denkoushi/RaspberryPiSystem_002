# トルクレンチ設定登録の任意化・接続操作統一


本書は `.agent/PLANS.md` に従う実行記録である。Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を実装・検証に合わせて更新する。

## Purpose / Big Picture


現在の単方向通信レンチでは本体の設定をシステムから読み書きできない。ボルトの基準値とレンチ個体の管理は維持しつつ、型番ごとに登録設定の照合を省略できるようにする。省略時は設定がなくても、過去の設定が違っていても通常締結と訓練を行える。接続前に本体を表示値へ設定し、「レンチ本体を表示値に設定して接続」を一度押す。設定登録・過去履歴は削除しない。

当初の実装範囲は専用branchの変更、ローカル検証、文書、検証資源の清掃までだった。2026-08-27の追加承認により、commit、push、PR、merge、標準手順での実機deploy、および現在のレンチ型番だけの照合不要への切替まで進める。NFC／バーコードの脆弱性と既存deploy成功判定は別件。

## Progress


- [x] (2026-08-27 10:47Z) 関連仕様・コードを調査し、利用者が接続ごとの現物確認を選択。承認済み計画を受領。
- [x] (2026-08-27 10:47Z) lifecycle audit/startにより `feat/torque-wrench-optional-settings` と専用worktreeを作成。基点 `0a3f7d2220f247e6160a4ffda704a7870b781898`。
- [x] (2026-08-27 10:47Z) 共通DB／API契約を固定し、Backend・Web・DBをLuna Maxへ非重複分担。
- [x] (2026-08-27 10:54Z) 共通型のbuildと変更ファイルのeslintが成功（計約4秒）。
- [x] (2026-08-27 11:55Z) 両方式の業務policy、確認鮮度、API、設定なし記録を実装しレビュー完了。
- [x] (2026-08-27 11:57Z) 接続1操作、再試行、nullable表示、管理画面方式選択を実装しレビュー完了。
- [x] (2026-08-27 11:02Z) 一時Postgresでfresh162件／旧161件からの移行、確認FK・旧履歴・null記録を確認。migration validator29件成功。
- [x] (2026-08-27 11:17Z) EXPLAINで実在する確認・接続行のindex検索とセッション行ロックを確認。planner設定変更なし。
- [x] (2026-08-27 11:21Z) 追加33件を含むpolicy対象3ファイル55/55成功（1.328秒）、新規テストeslint成功（10.78秒）。
- [x] (2026-08-27 11:23Z) 必要なworkspace依存をbuild後、API build成功（約35秒）。後続変更の最終確認は別途行う。
- [x] (2026-08-27 11:28Z) kiosk-sop-core依存build後、Webの型検査・production build成功。既存のbrowserデータ鮮度と大きなchunkの警告のみ。
- [x] (2026-08-27 11:33Z) 既存の単位変換・接続権policy・訓練policy・PIN設定serviceの追加回帰18件成功。ログ設定の起動ミスを修正して該当suiteのみ再実行。
- [x] (2026-08-27 11:37Z) 新方式の実route4件成功（9.547秒）・eslint成功（14.958秒）。通常NG→OK→次箇所、設定追加後の継続、訓練5回＋再送、A→B→Aを検証。
- [x] (2026-08-27 11:46Z) Excel出力の追加3件成功（5.452秒）・eslint成功（37.726秒）。対象外表示、対象値保持、従来方式／旧nullの履歴値保持を確認。
- [x] (2026-08-27 11:55Z) 管理者例外入力・旧履歴・PIN／業務rollback・同時準備／測定の回帰を確認。最終API build／変更source eslint成功。
- [x] (2026-08-27 11:55Z) 単位表記差分をcanonical converterで修正後、組立API4/4（36.46秒）、訓練API15/15（17.04秒）成功。
- [x] (2026-08-27 11:57Z) 対象単体テスト・build・画面E2Eを確認し、ADR／操作文書へ反映。
- [x] (2026-08-27 11:55Z 確認) Web対象6ファイル47/47成功（11.87秒）。使用終了テストのmock heartbeatが接続直後にavailableへ戻っていたため、現実の接続継続を表すfixtureへ修正した。
- [x] (2026-08-27 11:55Z 確認) 訓練E2E3/3（20.9秒）、通常締結E2E2/2（8.572秒）成功。両画面サイズの画像をrootが確認。
- [x] (2026-08-27 11:57Z) 1366×768の右ペインに縦スクロールとselect幅制約を追加。対象DOMテスト1件・変更2ファイルeslint・最新Web build（Vite 11.00秒）成功。通常締結E2E2/2再成功（12.149秒）と画像で下部操作への到達を確認。
- [x] (2026-08-27 11:57Z) 一時資源と起動プロセスを清掃し、最終差分と未実施境界を整理。
- [x] (2026-08-27 11:55Z 確認) 最終SQL確認後、EXIT trapで専用Postgres container・volume・networkを削除。対象ラベルの残存は各0件。Viteは画面検証終了後に清掃する。
- [x] (2026-08-27 12:03Z) commit・push・PR・merge・実機deploy・現在型番の切替を利用者が追加承認。Luna MaxへGit確認、標準deploy／切替経路、既設agent互換性を分担。
- [x] (2026-08-27 12:10Z) 既設agentのpayload互換性を確認。型番方式の書込入力だけをenum／省略へ限定し、旧DB nullの解釈は保持。追加schema単体10件（414ms）と対象eslint成功。
- [ ] PRを作成し、対象SHAのrequired CIを確認してmerge、lifecycle finish／auditを完了する。
- [ ] merged mainのCI／artifact成功後、明示limitの標準planを確認し、nullable対応版を従来方式のまま実機へ反映する。
- [ ] 標準runの終端状態・recap・healthとnullable対応済み復旧先を確認し、現在レンチの実在する型番だけ照合不要へ変更する。
- [ ] production SHA、型番変更前後、未確認の物理操作、清掃・main統合結果を報告する。

## Context and Orientation


リポジトリはAPI（`apps/api`）、Web（`apps/web`）、共通型（`packages/shared-types`）で構成される。作業場所は `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--torque-wrench-optional-settings`。主worktreeや他作業の差分は変更しない。

`apps/api/src/services/torque-wrenches/torque-wrench-eligibility.policy.ts` は型番レンジ・校正・能力グループ・状態・登録設定を照合する。設定前判定は既に分離されている。通常締結の実処理は `assembly-torque-traceability.service.ts`、訓練は `torque-training.service.ts` と `torque-training-wrench-preparation.service.ts`。実測値の合否はボルト／訓練版の基準値で判定する。

接続権（同じレンチを同時に他作業で使用させない仕組み）は `torque-wrench-usage-lease.coordinator.ts` と `TorqueWrenchUsageLease` が管理する。世代番号は旧接続からの測定を拒否するための番号。採用済み確認IDは、その接続で現物確認した記録を特定する。同じ所有者の確認更新では世代が変わらないため、世代だけでは古い確認を排除できない。

Prismaスキーマは `apps/api/prisma/schema.prisma`。確認2表の設定履歴参照は現在必須だが、測定記録側は既にnullableである。Webの通常締結ページは `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx`、訓練準備hookは `apps/web/src/features/assembly/torque-training/useTorqueTrainingWrenchPreparation.ts`。agentへの通信は既存の確認ID・個体番号・接続tokenを使い、ハードウェア同期は追加しない。

## Interfaces and Dependencies


型番の `settingVerificationMode` は `REGISTERED_SETTING | BOLT_CONDITION_ONLY`。DBはnullable文字列で旧行を保全し、API出力は必ず正規化した方式を返す。未指定／nullは従来方式。API入力の未知値は拒否する。方式を通信形式や設定の有無から推測しない。

確認2表は `settingHistoryId` とrelationをnullable化し、`settingVerificationMode`、`observedLeaseGeneration`、`observedAdoptedConfirmationId` をnullable列として追加する。照合不要の新規確認は設定履歴をnullとし、レンチ行ロック下で現在の接続世代（行なしは0）と採用済み確認ID（なしはnull）を記録する。測定2表にも方式snapshotを追加し、過去の欠損値と照合対象外を区別する。

共通型は `packages/shared-types/src/torque-wrenches/index.ts` に置く。依存方向は共通型／純粋policy → サービス → route、WebはAPIクライアント → 操作hook → 表示部品／ページとし、純粋policyはDBやUIへ依存しない。既存サービスは処理の組合せを担当し、新しい照合・鮮度判断を小さい単体テスト可能なモジュールへ置く。

訓練準備URLと入力（uid、profileId、requestId、現物確認true）は変えない。従来方式は設定履歴・確認・接続権予約・既存再送管理記録を同一transactionで維持。照合不要方式は確認と既存再送管理記録のみ保存し、接続権はagent経由で取得する。表示用targetは設定履歴ではなく不変の訓練版から返す。新しい監査表や汎用準備基盤は作らない。

## Plan of Work


第1段階ではDB契約と共通型を追加する。migration検査の例外は確認2表の `settingHistoryId DROP NOT NULL` の完全一致だけとし、他の制約削除・ALTER許可は広げない。DB担当はschema／migration／検査と一時DB、Backend担当は `apps/api/src/**`、Web担当は `apps/web/**` と対象 `e2e/**`、rootは共通型・文書・契約レビューを担当する。

DB担当の移行完了後、同担当へ新規 `torque-wrench-optional-settings.policy.test.ts` と `routes/__tests__/torque-wrench-optional-settings.integration.test.ts` を移管した。Backendは既存API統合テストを担当し、ファイルを重複編集しない。実route正常系は別一時DB `torque_optional_routes`、Backend回帰テストは `torque_optional_api` を使い、fixture全削除の衝突を避ける。

DB検証完了後、同担当へ新規Excel出力テストと `e2e/assembly-torque-optional-settings.spec.ts`（通常締結）も移管した。Web担当は訓練E2EとWeb実装を保持する。rootが専用Viteを127.0.0.1:4173で起動し、両E2EがAPIをmockして利用する。APIサーバーや既存DBは起動・使用しない。Playwrightの出力先は担当ごとに分け、検証後にrootが専用Viteを終了する。

第2段階では設定照合を全経路へ適用する。候補、確認、接続取得、測定受付、管理者例外入力、訓練準備・5回測定のいずれも照合不要では設定に依存しない。設定追加後も作業を無効にしない。型番レンジ・校正・機器状態・割当・NFC・端末・個体識別・条件一致・所有権・世代検査は維持する。

接続取得は確認時の世代＋採用済みIDと現在値を比較する。まだ採用されていない確認は両値が一致するときだけ採用し、採用済み確認の再送は同じ有効接続・所有者・端末・セッションに限定する。終了・失効・別作業使用後は新しい確認が必要。確認方式と型番の現在方式が違う場合も再確認する。通信断からの同一token復帰や同一条件の次箇所への進行は追加操作なしとする。

第3段階ではWebの確認→接続を一度の押下へまとめる。接続だけ失敗した場合は同じ確認で再試行し、照合不要では「確認済み・接続を再試行」と表示する。二重押下を抑止し、終了後や新規接続で過去確認を自動選択しない。状態更新直後に古いReact bindingで接続しないよう操作hookの引数を明確にする。下限・目標・上限・製造番号は接続前に表示し、訓練では接続成功後に目標を隠す。過去履歴・管理者例外入力・Excelは設定欄のnullをボルト値で補わず、方式に応じ「設定照合対象外」と区別する。

第4段階では対象検証とレビューを完了し、ADRへ方式・確認再利用・移行境界を記録する。API／UI文書は公開契約と操作手順だけを更新する。既存巨大ファイルの差分が組合せに留まること、重複ルールや過剰な拒否条件を増やしていないことをrootが確認する。

追加承認の第5段階では、既存taskの差分だけをcommit・pushし、Deploy impactを明記したPRを作成する。対象SHAのrequired CI成功後にmergeし、主リポジトリから `python3 -m scripts.git_lifecycle.cli finish --worktree <上記task worktree> --pr <実際のPR番号>`、続けて `audit --json` を実行する。保護対象の主worktreeの差分を変更しない。実機接続はmerged mainのexact SHAに対するCI成功を確認した後に限る。

第6段階ではcleanなdeploy worktreeで標準credentialの既存pathを内容非参照で確認する。`scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --print-plan --limit raspberrypi5` でSHA・対象・imageを照合し、同じ引数の `--detach` を一度だけ起動する。API／Web／DBが変更対象でagentの配布は行わない。対象を広げる必要が見つかった場合は、その根拠を先に確認する。返されたrunIdだけを `--status` で監視し、systemdのSubState=exited、Result=success、ExecMainStatus=0、Ansible failed/unreachable=0とhealthを確認する。別runの重複起動、手動container切替、migration台帳の変更は行わない。

第7段階では反映済みnullable対応SHAを復旧先として記録する。既存APIで現在の製造番号702902Sと実在する型番を再確認し、その型番の `settingVerificationMode` だけを `BOLT_CONDITION_ONLY` に変更する。認証秘密は出力せず、他の型番属性と全履歴を保持し、変更前後を読み取り確認する。実機レンチでの締結を代行したとは報告しない。production結果はこのtaskの外部実行証跡にも保存し、deploy後の証跡追記だけを理由に同一applicationを再deployしない。

## Concrete Steps


既に主リポジトリで実行した開始コマンドは次のとおり。既存taskへ復帰する際は再実行して新worktreeを作らず、上記worktreeを使う。

    python3 -m scripts.git_lifecycle.cli audit --json
    python3 -m scripts.git_lifecycle.cli start --branch feat/torque-wrench-optional-settings

以降は専用worktreeで実行する。依存関係を確認し、必要時のみ `pnpm install --frozen-lockfile` を行う。schema確定後に `pnpm --filter @raspi-system/api exec prisma generate`、共通型は `pnpm --filter @raspi-system/shared-types build`。検査コマンドと結果は実行後この節へ追記する。DB統合テストは専用一時DB URLを明示し、暗黙のDATABASE_URLや既存環境を利用しない。

共通型に対して次の2コマンドがexit 0（計約4秒）。

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/shared-types exec eslint src/torque-wrenches/index.ts

APIの必要なworkspace依存にdistがなかったため、次をbuildしてからAPI buildを実行し、いずれもexit 0。

    pnpm --filter @raspi-system/part-search-core --filter @raspi-system/shelf-layout-core build
    pnpm --filter @raspi-system/api build

Webの依存 `pnpm --filter @raspi-system/kiosk-sop-core build` と `pnpm --filter @raspi-system/web build` も成功した。単体回帰は単位変換8件、接続権policy6件、訓練policy2件、キオスク設定service2件が成功。後者の初回起動だけ `LOG_LEVEL=silent` が環境schemaで拒否されたため、許可値 `LOG_LEVEL=error` へ変更して同suiteのみ再実行した（0.609秒）。製品コード変更は不要だった。

既存route回帰は専用 `torque_optional_api` で次を実行した（20.28秒、組立3/3、訓練12/13成功）。唯一の失敗は準備target.unitの `N·m` → `N-m` 差分。対象値の取得元を訓練版へ変更しても、既存 `TorqueUnitConverter.canonicalUnit` で表記互換を維持するよう修正する。権限・PIN・既存設定登録・接続排他・rollbackの既存ケースは通過した。

    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/torque_optional_api pnpm --filter @raspi-system/api exec vitest run src/routes/__tests__/torque-wrenches.integration.test.ts src/routes/__tests__/torque-training.integration.test.ts

DB担当がvalidator29件（12.6秒）、Prisma validate/generate、fresh162migration（4.06秒）、旧161件からの移行を確認した。rootの独立した読み取りSQLでも、適用済みmigration162件、変更対象11列（新規9列＋nullable化2列）がすべてnullableであることを確認した。確認2表それぞれに旧方式1行／設定IDあり、新方式1行／設定IDなしが残り、両設定履歴FKも存在する。対象DBは専用container `raspi-torque-optional-settings-postgres` の `torque_optional_legacy`。APIテストには別の一時DBを用意して履歴移行証跡を保全する。

一時証跡は `/tmp/torque-optional-settings-evidence/`。`explain-confirmation-acquire-matching-sql.log` にSQLと実行結果を保存した。組立確認の主キー／session-condition index、訓練確認のprofile-confirmed index、使用リース主キーで各実在行1件を取得し、組立セッションの主キー検索上に `LockRows` を確認した。plannerのseqscan／indexscan／bitmapscanは通常のonのまま。小さなfixtureによるクエリ成立性の証跡であり、本番規模の性能保証ではない。

新規routeテストは `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/torque_optional_routes LOG_LEVEL=error` を明示して `vitest run src/routes/__tests__/torque-wrench-optional-settings.integration.test.ts` を実行し4件成功。組立3測定／履歴0、管理APIで不一致設定を追加しても継続、訓練5測定・同request再送／履歴0、別端末への引継ぎと旧token拒否を確認した。訓練の測定表には設定値snapshot列自体がなく、既存の対象値snapshotとnull設定IDを検証する。suite終了後のSQLで履歴・測定・試行・接続行が0件であることも確認した。

最終API回帰は同じ専用DBの組立4/4・訓練15/15が成功し、変更API sourceのeslintとAPI buildも成功した。訓練の現物確認false／省略の拒否、同時準備と測定、管理者例外入力の設定履歴非依存・終了後の確認失効を追加した。既存PIN監査失敗時のrollbackテストも通過している。

Web対象6ファイル47件は `useAssemblyWrenchPreparation.test.ts`、`KioskAssemblyWorkSessionPage.test.tsx`、訓練準備panel／hook、訓練管理controller／formをまとめて実行した。既存接続hookと純粋準備policyの回帰はrootの先行runでも成功。Web lint／TypeScript確認と、rootの最終production build（Vite 7.04秒）も成功した。既存のbrowserデータ鮮度とchunkサイズ警告は本変更と別件である。

画面E2Eは `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm exec playwright test <対象spec> --reporter=line --workers=1` により実行した。訓練の最終出力は `/tmp/torque-training-e2e-final`、通常締結は `/tmp/torque-optional-assembly-e2e`。`e2e/`にはESLint設定がなく、同ディレクトリのlint試行は適用できなかったため設定追加は行わない。API／Webの規定lintとPlaywright実行は成功している。

削除前に3資源すべてのラベル `com.raspi-system.task=torque-wrench-optional-settings` を確認し、明示名 `raspi-torque-optional-settings-postgres`／`raspi-torque-optional-settings-pgdata`／`raspi-torque-optional-settings-net` だけをEXIT trapで削除した。削除後の `docker ps -aq`、`docker volume ls -q`、`docker network ls -q` の同ラベル検索はすべて空。テストデータは破棄し、`/tmp/torque-optional-settings-evidence/` のログは保全した。

最後の画像レビューで右ペインの下部クリップを検出し、通常締結ページのスクロールとselect幅だけを修正した。DOMテスト1件（2.50秒）・対象2ファイルのeslint・Web production build（Vite 11.00秒）が成功し、通常締結E2E2件を再実行して成功（12.149秒）。文書とペインの横はみ出しがなく、1366×768で「やり直し」「履歴」までスクロールして表示できることを要素座標でも確認した。更新画像は同じ通常締結出力先に保存した。

全E2E完了後、事前に起動コマンドを照合したVite PID 70134と親pnpm PID 70062だけへTERMを送り終了した。両PID・4173待受け・Playwright／headless browserの残存はない。別作業の4174サーバーは触れていない。

## Validation and Acceptance


設定なし・一致・不一致の各条件で両方式をテストする。照合不要ではすべて使用でき、従来方式の拒否は維持する。単体テストは方式解決・適合性・確認鮮度・UI状態を対象とする。実routeテストは通常締結OK／NGと次箇所進行、訓練5回完了、設定履歴件数不変、設定追加中の継続、管理者例外、既存ADMIN／PIN、requestId再送、rollbackを確認する。

A組立→B訓練→A復帰で古い確認が拒否され、新しい1操作で正常完遂することを確認する。引継ぎ、旧token拒否、同一token復帰、同条件の連続箇所も含む。Web E2Eは1366×768と1920×1080で対象値・1操作・再試行・終了後再確認・訓練値非表示を確認する。API／Web buildと対象lintで公開型の利用側も確認する。

専用ラベル付きPostgres15の一時container・volume・networkを作る。imageがなければpullしてよい。fresh DBへ全migrationを適用し、別の一時DBには変更前スキーマと履歴を作成してから新migrationを適用する。SQLで旧行・FK保全、新null記録、rollbackを確認する。確認検索と接続取得の実クエリへ EXPLAIN (ANALYZE, BUFFERS) を実行して行数・index／走査方式を記録する。小規模fixtureで逐次走査が選ばれること自体は不具合としない。

ローカル検証予算はDB変更の45分。成功済みコマンドを同一入力で繰り返さず、失敗は関連修正後にのみ再検証する。未検証項目や無関係な失敗を隠さず記録する。

## Idempotence and Recovery


ローカル検証では既存DB・既存containerのデータは変更しない。taskの明示名とラベルで一時資源だけを特定し、trapで削除する。APIテスト完了前にDBを消さないよう担当間で確認する。終了時に該当ラベルのcontainer・volume・networkが0件であることを確認する。追加承認された本番変更は標準migrationと、現在型番の方式切替だけとする。

今回承認された本番導入は2段階。まず全型番を従来方式のままnullable対応版を導入し、正常性とその版への復旧を確立する。その後、現在の型番だけを明示的に照合不要へ変更する。null記録作成後はnullable非対応の旧版へ直接戻さず、DBのdown migrationもしない。今回のmigrationやseedで既存型番を自動切替しない。

## Surprises & Discoveries


既存の同一所有者接続では確認IDが変わっても世代番号が増えない。このため世代だけでなく採用済み確認IDのsnapshotが必要である。既存の確認一覧はprofile単位で過去確認を自動採用しており、照合不要の新規接続ではその再利用を止める必要がある。

expand-only検査を読み取りで評価したところ、対象2表の DROP NOT NULL は現在ともに拒否され、nullable TEXT列の追加は許可された。例外を2列だけに限定する根拠となる。

実装レビューでは、従来方式まで新鮮度制約を適用する変更、照合不要で現物確認trueを任意にする変更、設定snapshotをボルト値で埋める変更を差し戻した。いずれも承認仕様を変えるためであり、従来方式の判定・両方式共通の1押下確認・設定欄nullを維持する。訓練のfingerprintは治具条件を含み、組立適合policyのfingerprintとは異なるため、訓練接続の照合には訓練セッションのfingerprintを使う。

## Decision Log


2026-08-27 / root: 方式は型番単位、旧nullはREGISTEREDとする。通信方式とは別の業務設定であり、既存挙動の暗黙変更を避けるため。

2026-08-27 / root: 確認の鮮度は接続世代＋採用済み確認IDを保存する。時間制限・新監査表を増やさず、別作業を挟む古い確認だけを識別するため。

2026-08-27 / root: 測定記録にもnullable方式snapshotを追加する。旧データの設定欠損と意図した照合対象外を表示・出力で区別し、ボルト基準値で設定履歴を偽装しないため。

2026-08-27 / root: 訓練の接続取得もsession→profileの順にロックする。確認・準備・測定・キャンセルと同じ順序にし、初回接続のsession外部キー確認が逆順の待合せを作らないようにする。共通coordinatorや再試行基盤は変更しない。

## Outcomes & Retrospective


実装・ローカル検証・文書・清掃まで完了した。差分は `feat/torque-wrench-optional-settings` に未commitで保持する。設定登録・旧履歴を残し、明示した型番だけ照合不要へ切替可能になった。両方式の現物確認は維持し、照合不要は設定履歴を書かず、ボルト条件で判定する。確認鮮度の判定・設定snapshot・シリアライズ・UI操作hook・表示カードを分離し、既存のwriter・transaction・接続coordinatorを再利用した。

確認済みはAPI実route23件、純粋policy等とExcel出力、Web対象47件、E2E5件、migration validator29件、fresh162migration／旧履歴入り移行、FK・SQL・EXPLAIN、API／Web build・lint。追加のレイアウト修正も対象テストと画像で再確認した。実機通信・本番規模の負荷はローカルmock／小規模DB検証の対象外であり、検証済みとはしない。

12:03Z時点では運用DB変更、対象型番の切替、commit、push、PR、merge、deployは未実施。追加承認によりリリース段階を開始したため、全体は進行中である。実機反映時にはnullable対応版を全型番従来方式で導入して復旧先を確立し、その後に対象型番を明示切替する。

改訂記録: 2026-08-27、承認済み計画と詳細調査を実行可能な契約・分担・検証境界へ整理して作成。

改訂記録: 2026-08-27 12:03Z、利用者の明示承認によりGit公開・標準deploy・現在型番の方式切替を追加。ローカル検証完了と本番反映完了を区別して記録する。
