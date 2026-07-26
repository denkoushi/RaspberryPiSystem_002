# 組立画面 自動採番・作業者NFCゲート・論理無効化

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md`.

## Purpose / Big Picture

組立キオスクのロット登録では、選択した製番とロット数から作業用IDを
`製番-001` 形式で自動発行する。作業者はロット登録時ではなく、作業を開始・再開・
再読込するたびに有効な社員NFCをスキャンする。着手前・仕掛・完了／承認済みの
個体は、監査証跡を失わない論理無効化によって画面から削除できる。沉浸式キオスクの
タブバーは画面右下24×24pxだけで表示する。

利用者が確認できる結果は次のとおり。

- ロット数2なら作業用ID `製番-001`, `製番-002` が入力なしで表示・登録される。
- 「開始」「再開」または作業画面の再読込時に、NFCスキャン完了まで作業操作が始まらない。
- 3つの状態ペインで、管理パスワードと理由を入力すると対象が消えるが、履歴とIDは残る。
- 画面下辺中央ではタブバーが出ず、右下隅でのみ表示される。

## Progress

- [x] (2026-07-26) 現行ADR、KB、画面、API、Prisma schema、統合テスト、Docker試験経路を調査した。
- [x] (2026-07-26) `feat/assembly-auto-id-nfc-invalidation` ブランチを作成した。
- [x] (2026-07-26) 共有採番ポリシーと加算的DB migrationを追加した。
- [x] (2026-07-26) APIのNFCアクセス履歴、WorkUnit無効化、冪等性、競合制御を実装した。
- [x] (2026-07-26) Webの自動採番、NFCゲート、3ペイン共通削除ダイアログを実装した。
- [x] (2026-07-26) 右下24×24pxのヘッダーリビールとPlaywright境界テストへ変更した。
- [x] (2026-07-26) ADR・KB・索引を更新した。
- [x] (2026-07-26) 隔離PostgreSQLで全migration、関連統合37テスト、SQL、EXPLAINを検証した。
- [x] (2026-07-26) Node 22でlint、build、全Vitest、対象Playwright、CI smokeを最終再検証した。
- [x] (2026-07-26) ユーザーからpush、PR、merge、本番migration、標準deploy、実機操作検証の明示承認を得た。
- [x] (2026-07-26) featureブランチをpushし、ready PR #1091を作成した。
- [x] (2026-07-26) CIのExpand-only指摘に従い、Lot作業者列のNOT NULL互換を維持する安全修正を検証した。
- [x] (2026-07-26) npm Registryのgzip header障害をfail-openせず回避するbulk audit loopback proxyを追加・検証した。
- [ ] 必須CIとレビュー結果を確認し、mainへmergeする。
- [ ] merge SHAのCI成功後、標準ローリング更新のplanを確認して本番へ適用する。
- [ ] deploy status、同一SHAのno-op plan、実機の組立/NFC/右下ホットゾーンを確認する。

## Surprises & Discoveries

- Observation: `scripts/test/start-postgres.sh` は同名の既存コンテナ
  `postgres-test-local` を停止・削除する。
  Evidence: スクリプト冒頭の `docker stop` / `docker rm`。
  Consequence: 今回の検証ではこのスクリプトを使わず、固有名・tmpfs・`--rm`の
  一時コンテナを直接起動する。

- Observation: 現行の自主検査ゲートは保存済み入力がある再読込を許可するため、
  厳密な「都度スキャン」ではない。
  Evidence: `KioskSelfInspectionSessionPage.tsx` の
  `sessionEmployeeGateReady` は既存entryの`createdByEmployeeId`でもtrueになる。
  Consequence: UI表現だけを参考にし、組立用の独立したアクセス履歴とゲートを実装する。

- Observation: 作業画面は表示直後に手順書、レンチ確認、agent pollingを開始する。
  Evidence: `KioskAssemblyWorkSessionPage.tsx` の複数`useEffect`。
  Consequence: オーバーレイだけでなく、全副作用のenabled条件へNFC許可を加える。

- Observation: WorkUnit無効化が開始処理と競合すると、WorkUnitロック前に読んだ
  sessionIdは古い可能性がある。
  Evidence: 開始処理はWorkUnitロック後にセッションを作成する。
  Consequence: 無効化はWorkUnitロック後にsessionIdを再取得し、
  WorkUnitからSessionの順でロックする。

- Observation: 有効WorkUnitがfixtureの90%を占める正式ID候補クエリでは、
  PostgreSQLは索引走査より逐次走査を安価と判断した。
  Evidence: 20,000 WorkUnitの`EXPLAIN (ANALYZE, BUFFERS)`は約6msでSeq Scanを選択した。
  `enable_seqscan=off`ではstatus、構成、WorkUnitの各索引適用可能性を確認した。
  Consequence: 正常なplanner判断として索引を増やさず、実データ分布変化を将来監視する。

- Observation: 既存トルク統合テストの1経路が`AssemblyLotService.startSerial`を
  NFC/requestIdなしで直接呼んでいた。
  Evidence: 初回の隔離DB全関連テストでPrismaがundefined requestIdを拒否した。
  Consequence: 実装を緩めず、fixtureへACTIVE社員NFCとUUID requestIdを追加した。

- Observation: 無効化情報は直接照会APIへ含まれていたが、既存の製品構成画面には
  理由・日時を表示する欄がなかった。
  Evidence: `AssemblyTraceabilityWorkUnitDto.invalidation`は存在する一方、
  `KioskAssemblyTraceabilityPage`は参照していなかった。
  Consequence: 作業用ID直接照会の結果へ「削除済み（読み取り専用）」、削除日時、
  削除前状態、理由を追加し、Web回帰テストを追加した。

- Observation: 異なる対象で同じ`requestId`が同時に一意制約へ衝突した場合、
  共通PrismaエラーハンドラではP2002が汎用400になり得た。
  Evidence: START以外のRESUME/invalidateサービスにP2002の業務変換がなかった。
  Consequence: 組立ドメイン共通判定を追加し、START/RESUME/invalidateおよび既存の
  ロット・構成競合を明示的な業務409へ変換した。

- Observation: PR #1091の`deploy-contract`は既存列の
  `ALTER COLUMN "operatorNameSnapshot" DROP NOT NULL`をExpand-only違反として拒否した。
  Evidence: GitHub Actions run 30192377110 / deploy-contract job 89767892158。
  Consequence: 既存NOT NULL列は変更せず、未確定値は空文字で保存してAPI DTOで
  `null`へ正規化する。candidate migrationをローカル正本コマンドで再検証する。

- Observation: PR #1091の全選択CIは成功したが、`workspace-quality`のpnpm 11.4
  bulk auditだけが2回連続でgzip本文をJSONとして解析して失敗した。pnpm 11.17でも
  ローカル再現し、npm bulk endpointは`Accept-Encoding: identity`なら正常なJSONを返した。
  Evidence: GitHub Actions run 30192747172 attempts 1/2、およびローカルpnpm/curl probe。
  Consequence: loopback限定のaudit proxyで公式bulk endpointへidentity指定で転送し、
  advisory判定、critical fail-closed、high informational、3回retryは固定pnpmへ維持する。

## Decision Log

- Decision: 作業用IDはサーバー正本で`${normalizedProductNo}-${NNN}`を生成し、
  Webは同じ共有純関数でプレビューする。
  Rationale: API直呼びとUIの採番ずれを防ぎ、複数端末でも一意性を保証する。
  Date: 2026-07-26

- Decision: 同一製番の再ロット登録は、無効化済みを含めて拒否する。
  Rationale: 利用者選択。IDの再利用と「次の空き番号」解釈を排除する。
  Date: 2026-07-26

- Decision: 画面の「削除」は復元なしのWorkUnit論理無効化とし、作業用ID、
  トルク、検査、承認、構成履歴を物理削除しない。
  Rationale: 監査性と外部キー整合を守る。
  Date: 2026-07-26

- Decision: 有効な製品構成リンクまたは正式IDがあるWorkUnitの無効化は409で拒否する。
  Rationale: 削除操作が別製品の系譜を暗黙に変更しないようにする。
  Date: 2026-07-26

- Decision: NFCはSTART/RESUMEのappend-only履歴を作り、RESUME時はセッションの
  現在作業者スナップショットも更新する。
  Rationale: 現在のチェック入力者を正しく表示しつつ、過去担当者を失わない。
  Date: 2026-07-26

- Decision: 公開と本番反映はready PRの必須CI・レビューを通過したmainの不変SHAを
  対象に、`scripts/update-all-clients.sh`の標準ローリング更新だけで行う。
  Rationale: ユーザーの追加承認を監査可能にし、migration、Pi5、端末の順序と
  rollback証跡を既存オーケストレーターへ一元化する。
  Date: 2026-07-26

- Decision: `AssemblyLot.operatorNameSnapshot`の物理NOT NULL契約は維持し、
  自動採番ロットの未確定作業者を空文字の互換値として保存する。API/Web契約では
  空文字を`null`として公開する。
  Rationale: Blue/Green中の旧API互換とExpand-only migration契約を守りながら、
  ロット登録時に作業者を確定しない利用者向け意味を維持する。
  Date: 2026-07-26

## Outcomes & Retrospective

作業用IDの自動発行、START/RESUMEごとの社員NFC履歴、不可逆なWorkUnit論理無効化、
右下24×24pxヘッダーリビールを実装した。無効化済み個体は能動一覧から除外される一方、
直接照会とExcelでは理由・作業者アクセス履歴を確認できる。既存トルク、検査、承認、
構成、正式IDの物理行は変更しない。

使い捨て`pgvector/pgvector:pg15`へ155 migrationを適用し、statusはup to dateだった。
関連API統合テストは37件、APIユニットは60件、対象Webテストは58件、
LinuxキオスクUA＋WebSocket mockのPlaywrightは2件成功した。EXPLAINは有効仕掛・完了、
ロット内有効個体、アクセス履歴、無効化requestIdで想定索引を使用した。正式ID候補は
有効率90%では逐次走査が最適だったが、索引適用可能性も確認した。

Node 22の最終検証では、API全体465ファイル・2,450テスト、Web全体305ファイル・
1,516テストが成功した。追加監査修正後もAPI lint/build、組立統合29テスト、
Web lint/build、直接照会3テストが成功し、対象Playwright 2件とCI E2E smoke
3件も成功した。API全体7件とMFA smoke 2件は既存テスト条件によりskipされた。
本番DB migration、push、PR、merge、deploy、実機操作は追加承認済みであり、
以降のProgressへ結果を追記する。

PR初回CIのExpand-only指摘後、既存Lot作業者列のNOT NULLを維持する互換方式へ変更した。
修正版は一時PostgreSQLで全155 migration、status、組立統合29テストに成功し、
API DTOの`null`とDB互換値の空文字を同時に確認した。不変コミット`08792edb`の
candidate migration preflightと、ローカルdeploy-contract全体も成功した。
pnpm bulk audit proxyは固定pnpm 11.4のcritical gateをローカルで成功させ、critical 0件、
既存のhigh 3件は従来契約どおり情報警告として報告した。proxyのgzip自己テストと
CI workflow契約テストも成功した。

## Context and Orientation

主要な入口は次のとおり。

- `apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx`: ロット登録と3状態ペイン。
- `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx`: 組立作業画面。
- `apps/api/src/routes/assembly/index.ts`: 組立API境界。
- `apps/api/src/services/assembly/assembly-lot.service.ts`: ロット作成と一覧。
- `apps/api/src/services/assembly/assembly-work-session.service.ts`: 開始と作業状態更新。
- `apps/api/prisma/schema.prisma`: `AssemblyWorkUnit`は物理
  `AssemblySerialRegistry`へmapされ、作業用IDが全体一意。
- `apps/web/src/features/kiosk/kioskHeaderRevealHotZone.ts`: ヘッダー表示判定の純関数。

`AssemblyWorkUnitComposition`と`AssemblyFormalIdentifierAssignment`は履歴テーブルで、
WorkUnit削除は`RESTRICT`される。よって無効化状態をWorkUnitへ追加し、一覧と変更APIが
無効化済みを除外・拒否する。

## Plan of Work

1. 共有パッケージに識別子正規化とロット作業用ID生成を追加する。APIとWebの重複した
   正規化実装を共有関数へ寄せる。
2. PrismaへWorkUnit無効化日時、無効化監査、作業者アクセス履歴を追加する。
   既存Lot作業者列のNOT NULLは維持し、未確定値をAPI境界でnullableに正規化する
   加算的migrationを作る。
3. productNo advisory lock、社員NFC resolver、operator access repository/service、
   WorkUnit lifecycle repository/serviceを実装する。ロック順序はWorkUnit、session、
   active traceability rowsとする。
4. 組立routeへauto/manualロット契約、NFC必須開始、resume access、invalidateを追加する。
   一覧・承認・traceability・作業mutationへinvalidated guardを加える。
5. Webのロット登録をauto既定へ変更し、manual入力とkeypadを折りたたむ。共通NFC gateと
   無効化dialogを追加し、3ペインへ接続する。
6. 作業画面のNFC許可前副作用を停止し、開始直後だけrouter stateの一回許可を使う。
7. ヘッダーホットゾーンとE2E helperを右下24×24pxへ変更する。
8. ADR、関連ADR、KB-311、文書索引を更新する。

## Concrete Steps

リポジトリルート `/Users/tsudatakashi/RaspberryPiSystem_002` で実行する。

1. shared-types、Prisma schema、migration、APIサービスの順に編集する。
2. `pnpm --filter @raspi-system/shared-types build` とAPI/Webの対象Vitestを反復実行する。
3. 固有名の一時PostgreSQLを`--tmpfs /var/lib/postgresql/data --rm`で起動し、
   自動割当ポートを`DATABASE_URL`へ設定する。
4. `prisma generate`, `prisma migrate deploy`, `prisma migrate status`を実行する。
5. API統合テスト、Web全テスト、lint、build、Playwright対象テストを実行する。
6. `psql`でschema/index/FKを確認し、対象クエリへ
   `EXPLAIN (ANALYZE, BUFFERS)`を実行する。
7. 一時コンテナを停止し、container/volume/networkが残っていないことを確認する。

## Validation and Acceptance

- autoロット数2が`製番-001`, `製番-002`を生成し、同一製番の再登録が409になる。
- manualモードと旧`workIds`/`serialNos`境界は利用可能。
- NFCなし・不明・非ACTIVEでは開始/再開できず、有効NFCで履歴が1件だけ作られる。
- 開始、再開、再読込で期待どおりゲートが出て、NFC前のagent/レンチ副作用がない。
- 無効化はパスワードと理由を必須とし、3状態すべてで証跡を保持する。
- active composition/formal IDと無効化の競合は409となり、500や孤児行を作らない。
- 作業IDは無効化後も再利用できない。
- 下端中央ではヘッダーが出ず、右下24×24pxだけで出る。
- migrationには既存組立行を削除・再採番するSQLがない。

## Idempotence and Recovery

START、RESUME、invalidateはUUID requestIdで冪等化する。同じrequestIdの再送は既存結果を
返し、異なる内容への再利用は409とする。migrationはPrisma管理下で一度だけ適用し、
実データの破壊的backfillは行わない。検証DBは完全に使い捨てるため、失敗時もコンテナを
停止して再作成できる。

## Artifacts and Notes

主要な検証結果は次のとおり。

    Prisma migrate deploy: 155 migrations applied
    Prisma migrate status: Database schema is up to date
    API relevant integration: 3 files, 37 tests passed
    API assembly/torque unit: 9 files, 60 tests passed
    API full Node 22: 465 files, 2450 passed, 7 skipped
    API final audit Node 22: lint/build, 3 unit files/9 tests,
      assembly integration 1 file/29 tests passed
    Web relevant Vitest: 9 files, 58 tests passed
    Web full Node 22: 305 files, 1516 tests passed
    Web final audit Node 22: lint/build, traceability 1 file/3 tests passed
    Playwright NFC/hot-zone: 2 tests passed
    CI E2E smoke: 3 passed, 2 skipped by existing CI policy
    Expand-only compatibility fix: all 155 migrations and 29 assembly integration tests passed
    Candidate migration preflight: 08792edb passed
    Local deploy-contract: all checks passed
    Pinned pnpm 11.4 bulk audit through loopback proxy: critical gate passed
    EXPLAIN execution: WIP 0.240ms, completed 0.191ms,
      lot serials 2.275ms, access 0.274ms, invalidation requestId 0.008ms,
      formal candidates 5.986ms

Docker検証は毎回、固有名、ループバック自動割当ポート、tmpfs、`--rm`を使用した。
既存コンテナ、volume、networkは利用せず、各実行後に一時コンテナが残っていないことを
確認した。

## Interfaces and Dependencies

- Shared runtime:
  - `normalizeAssemblyUpperIdentifier(value)`
  - `buildAssemblyLotWorkIds(productNo, expectedQuantity)`
- API:
  - `POST /assembly/lots` with `workIdMode`
  - `POST /assembly/lots/:lotId/serials/:lotSerialId/start`
  - `POST /assembly/work-sessions/:id/operator-access`
  - `POST /assembly/work-units/:id/invalidate`
- PostgreSQL:
  - transaction advisory lock for normalized productNo
  - WorkUnit/session `FOR UPDATE` locks
  - unique requestId constraints for access/invalidation

Revision note (2026-07-26): implementation、競合監査修正、直接照会の読取専用表示、
隔離DB/EXPLAIN、Node 22全検証とCI smokeの完了結果を記録した。
同日のPR初回CI指摘によりLot作業者の物理NOT NULLを維持する互換方式へ変更し、
candidate migration preflightとローカルdeploy-contractの成功を追記した。
npm Registryのgzip header障害に対するfail-closed loopback proxyとローカルaudit成功も
追記した。
