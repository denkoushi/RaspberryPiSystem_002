# ADR-20260827 トルクレンチ登録設定の任意照合

Status: Accepted (implemented and locally verified; rollout tracked in ExecPlan)

## Context

現在のレンチは、本体設定をシステムから読み書きする機能を持たない。ボルト／訓練版の基準値と、操作者が登録したレンチ設定値を二重に保持し、常に一致を要求することは、現物の同期を保証しない一方で操作を増やしている。将来の機種に備えて設定登録と履歴を残し、現在の運用では登録なしでも安全に締結・訓練を完遂できるようにする。

既存の現物確認は設定履歴IDを必須とし、その更新で古い確認を無効にしていた。また通常締結には、同一端末が採用した確認を別作業IDへ再利用する経路がある。設定照合だけを除くと、A組立→B訓練→A復帰で古いA確認が再利用されるため、接続ごとの現物確認を明示的に扱う必要がある。

本ADRは [従来の現物確認再利用](ADR-20260723-assembly-torque-cross-work-id-confirmation-reuse.md) と [訓練準備](ADR-20260826-torque-training-one-touch-wrench-preparation.md) のうち、以下の方式別動作を更新する。[機能横断の所有権](ADR-20260818-torque-wrench-global-ownership.md) の排他・token・引継ぎ境界は維持する。

## Decisions

### 型番ごとの照合方式

`TorqueWrenchModel.settingVerificationMode` を追加する。`REGISTERED_SETTING` は設定登録と一致照合を従来どおり使用し、`BOLT_CONDITION_ONLY` はボルト／訓練版の条件を正本とする。既存行のnull／未指定は従来方式。通信方式、設定の有無、個体番号から方式を推測しない。APIはenumを検証し、出力を正規化する。

照合不要では設定の欠落・不一致を理由に使用を拒否せず、途中で設定履歴が追加されても既存の作業を無効化しない。型番レンジ・適合グループ・状態・校正・割当・個体識別・NFC／権限・接続所有権・条件一致・締結進行・訓練5回は維持する。合否判定は従来どおりボルト／訓練版の基準値による。登録設定照合は実機同期ではなく、本体への送受信を追加しない。

### 設定履歴と現物確認を分ける

確認2表の `settingHistoryId` をnullable化し、照合不要の新規確認にはnullを保存する。ダミー設定履歴は作らない。既存行と外部キーは保持する。確認方式と接続状態のsnapshotを既存確認に追加し、新しい監査表は作らない。

測定記録にも方式snapshotを保存する。照合不要記録の設定IDはnullとし、組立測定が持つ設定値snapshotもすべてnullにする。訓練測定には設定値snapshot列を追加せず、既存の対象値snapshotを維持する。表示・Excelでは「設定照合対象外」と区別し、過去の登録値はそのまま表示する。設定欄をボルト基準値で埋めて、実機設定を取得したように見せない。対象条件は既存の不変テンプレート版・訓練版・測定snapshotで追跡する。

### 確認の鮮度と接続

照合不要の新規確認は、レンチ行ロック下でその時点の接続世代と採用済み確認IDを保存する。接続行がなければ世代0、採用IDなしとする。接続取得も同じレンチ行ロックに従い、このsnapshotと現在値を照合する。別作業がレンチを使用した確認は採用しない。

採用済みの同じ確認を再送できるのは、同一端末・作業の有効な同一接続への再試行に限る。使用終了・失効後や方式変更後には新しい確認を要求する。未採用の確認も、作成後に終了／失効した接続をまたいで新規接続へ持ち越さない。条件の一致だけでは確認を再利用しない。

同一の有効接続中に同じ条件の丸数字へ進む場合は追加操作しない。通信断からの同一token復帰、世代による旧端末排除、既存の二段階引継ぎを維持する。新しい確認時間制限や汎用接続基盤を追加しない。

### 1操作と再試行

接続前に製造番号と対象条件の下限・目標・上限を表示する。照合不要では通常の設定登録フォームを出さず、「レンチ本体を表示値に設定して接続」の1回で現物確認→agent接続を進める。追加checkboxやダイアログは設けない。確認成功後の接続失敗では同じ確認を使い「確認済み・接続を再試行」と案内する。使用終了後は過去確認を自動選択しない。

通常締結は既存確認APIを使い、Webが接続を続ける。訓練は既存準備APIのURL・NFC入力・requestIdを維持する。従来方式は設定追記・確認・接続権予約・再送管理を同一transactionで行う。照合不要は確認と既存再送管理記録のみを保存し、agentが既存経路で接続権を取得する。再送は元の確認を返すが、古い確認で接続取得を迂回できない。表示値は不変の対象条件から返し、nullable設定履歴から読み取らない。訓練接続後は目標を隠す。

管理者の設定APIとキオスク設定の共有4桁PIN認証・監査transactionは変更しない。

## Responsibilities and test boundaries

共通型は方式enumとnullable契約のみを定義する。APIの小さい純粋policyは方式解決・設定照合・確認鮮度を判断する。既存サービスはDB読取・ロック・transactionとpolicyを組み合わせ、routeは入力と認証を扱う。WebのAPIクライアント、接続操作hook、表示部品を分け、ページには組合せだけを残す。設定writerは従来方式と管理APIで再利用する。

追加モジュールの境界は次のとおり（APIは `apps/api/src/services/torque-wrenches/`、Webは `apps/web/src/features/assembly/`）。

| モジュール | 責務・再利用先 | テスト境界 |
|---|---|---|
| `torque-wrench-setting-mode.policy.ts` | 旧nullの方式解決・設定参照要否。組立、訓練、マスター、出力で共用 | DBなしの方式テスト |
| `torque-wrench-setting-evidence.policy.ts` | 設定snapshotを実登録値またはnullへ変換。通常入力、管理者入力、訓練で共用 | DBなしのnull／登録値テスト |
| `torque-wrench-confirmation-freshness.policy.ts` | 接続世代・採用ID・所有者・有効期限による確認鮮度 | DBなしの再試行／失効／別所有者テスト |
| `torque-wrench-serialization.ts` | 型付きDB値からAPIの方式・対象値・nullable設定IDを生成 | APIレスポンスと単位互換テスト |
| `useAssemblyWrenchPreparation.ts` | 候補選択、確認、接続への引渡し、再試行状態 | API／agent境界をmockしたhookテスト |
| `AssemblyBoltConditionPreparationCard.tsx` | 対象値と1操作ボタンの表示。DB・通信を持たない | 表示・操作・画面E2E |

依存は型／純粋policyをサービスが利用し、routeがサービスを呼ぶ向きに限定する。WebもAPI通信をhookが利用し、カードは値とイベントだけを受け取る。既存のロック・transaction・接続coordinatorは再利用し、新しい接続基盤へ作り替えない。Excelの短い表示変換はその出力専用なので同ファイルに置き、既存の大きい業務サービスは新policyの呼出しとI/Oの組合せだけを変更する。

純粋テストは両方式の設定なし／一致／不一致と接続鮮度を扱う。実DBのrouteテストで通常締結進行・訓練5回・履歴件数不変・引継ぎ・旧確認／旧token拒否・rollbackを確認する。Webテストは1押下・二重押下・接続のみ再試行・使用終了後の再確認・nullable表示を扱う。大きい既存サービス／ページは周辺責務をまとめて再編せず、新しい業務判断と操作状態だけを切り出す。

## Migration and rollout boundary

migrationはnullable列追加と、確認2表の `settingHistoryId DROP NOT NULL` のみ。expand-only検査の特例はこの2表・1列の操作に完全一致で限定し、その他の制約削除やALTERへ広げない。既存行の更新・削除・型番の自動切替は行わない。

本番導入時はまず全型番従来方式のままnullable対応版を導入し、正常性と復旧先を確立する。その後、対象型番だけを明示的に照合不要へ変更する。null記録を作り始めた後の復旧先はnullable対応版とし、旧版への直接復帰やdown migrationを行わない。ローカル実装とは別の明示承認を受けて本番反映を行い、実施状況はExecPlanへ記録する。

一時Postgresでfresh全migrationと旧履歴入りDBからの移行を検証する。FK・旧履歴・null記録・rollbackをSQL確認し、確認／接続検索をEXPLAINする。既存DBを使わず、検証後は専用container・volume・networkを清掃する。実行証拠と進捗は [ExecPlan](../plans/torque-wrench-optional-settings-execplan.md) を参照する。
