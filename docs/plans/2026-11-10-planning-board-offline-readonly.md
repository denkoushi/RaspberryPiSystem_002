# 製番ボードを通信断でも開ける読み取り専用画面にする


この ExecPlan は `.agent/PLANS.md` に従う生きた文書である。実装中は Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を更新する。本文のパスはリポジトリルートからの相対パス、行番号は2026-11-10の調査時点を示す。

今回の承認範囲は、この計画文書1つの作成だけである。コード、索引、設定を変更せず、実機・サーバー接続、commit、push、PR作成、merge、release、deploy は実行しない。以下の実装・試験・PR分割は後続作業の仕様であり、実施済みではない。既存の関連計画にある過去のデプロイ承認は引き継がない。

## Purpose / Big Picture


工場の無線接続だけを使う Raspberry Pi4 で、Wi-Fi が切れても `/kiosk/production-schedule/planning-board` の製番ボードを見続けられるようにする。最後に表示していたデータと時間基準を固定し、スクロール、拡大縮小、一覧とガントの切り替え、手元のデータへの絞り込みは使える。サーバーへの書き込みと、ローカルだけの設備の並べ替えも止める。ボード全体を画像にする設計ではなく、固定した表示モデルから閲覧操作だけを再描画する。

圏外では上辺に常時「圏外」「操作できません」「HH:MM の表示」を出す。書き込みを押すと「圏外のため操作できません」を短く出す。復帰を確認して全件と表示用データを取り直してから、一度に最新表示へ置き換え、緑の帯「復帰 最新に更新しました」を3秒表示して消す。追加の説明文、補助ラベル、再接続ボタンは作らない。

事前にオンラインで一度読み込んだブラウザープロファイルでは、無線が切れたまま Pi4 を再起動しても、アプリの外枠と最後の保存済みボードを開ける。Service Worker はブラウザーが通信を仲介する仕組みで、HTML・JS・CSS等の外枠だけを保存する。IndexedDB はブラウザー内の永続データベースで、表示データを保存する。256GB SSD の容量制約を前提に縮退させないが、無制限の履歴やサーバー全体の複製は作らない。圏外で操作を溜めて後送する outbox は導入しない。

## Progress


- [x] (2026-11-10 JST) 作業開始時の `git status --short` と `git diff --stat` が空であることを確認した。
- [x] (2026-11-10 JST) 指定コード・既存計画・監視仕様を読み、設計と受入条件をこの1ファイルに記載した。実機記録は取得していない。
- [x] PR 1相当: 圏外状態機械と設定、時計、状態遷移の単体試験を実装した（2026-11-10: 45 tests passed、変更ファイルのESLint・tsc -b成功。画面・APIは未接続）。
- [ ] PR 2相当: 表示固定・共通gate・帯・全件復帰のローカル実装と対象379 tests（14ファイル）、web型検査・変更ファイルESLintを完了した（2026-11-10）。続いて端末フラグ `ClientDevice.planningBoardOfflineEnabled`（NOT NULL、既定false）を管理画面・API・ページへ接続した。実機確認は未実施。
- [ ] PR 3相当: IndexedDB の保存・復元と端末範囲の照合を統合する。
- [ ] PR 4相当: Service Worker とレイアウトの製番ボード限定起動を統合し、ビルド版で通信断・ブラウザー再起動を確認する。
- [ ] 別途承認後、実機の監視記録と断続試験で暫定設定を評価する。PR、CI、main統合、本番検証は未実施（integrationPending）。

## Surprises & Discoveries

2026-11-10 PR 2: 有効化は `procedureBoardEnabled` と同じ端末別の管理経路を採用する。新規migration `20261110100000_add_client_planning_board_offline_enabled` は `ADD COLUMN ... BOOLEAN NOT NULL DEFAULT false` の1文だけで、データ更新を行わない。管理画面の「製番ボード圏外表示」で保存し、キオスクは認証済み `GET /mobile-placement/client-capabilities` → `getClientCapabilities` → `ClientDevice` の経路で値を読む。ページのmount時に1回取得し、未取得・失敗・値欠落・falseは従来動作、trueのみ既定の数値設定で圏外対応を有効にする。取得後の変更はページを開き直して反映する。ビルド設定への接続案と未適用パッチは採用しない。

端末フラグ追加の対象検証: APIはルート・capabilities・既存手順づくりの2ファイル15 tests、webは管理画面・ページ・Providerの3ファイル30 testsを実行した。true/false・欠落・取得失敗・取得中を確認する。DBはモックを使い、実DBへのmigration適用・実機確認は含めない。

通常の本体取得は15秒より長い。`apps/web/src/api/hooks/production-schedule/grinding-planning-board.ts:120-134` は段階取得に300秒の方針を使う。既存取得だけの「15秒成功なし」は正常時にも成立するため、軽い定期確認が必要である。

既存 queue は永続 outbox ではない。`apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue.ts:105-189` はメモリ上で順次送信し、失敗時は依存する操作を取消して再取得する。他方、到着、完了、分割、設備稼働時間はこの queue を迂回する。queue だけへの条件追加では読み取り専用を保証できない。

外枠のキャッシュだけでは再起動時に表示できない。`apps/web/src/layouts/KioskLayout.tsx:241-251` は deploy-status が不明な Pi キオスクをメンテナンス画面で遮る。既存モバイルだけにある例外を、製番ボード専用の安全条件で追加する必要がある。

2026-11-10 に Pi5 の `ClientLog` を読み取り専用で集計した(直近14日、Pi4 キオスク8台)。network_health の5分窓の抜けは次の2種類だった。全台同時の抜けは Pi5 側の停止で、10/30 02:13 から約5.3時間、10/30 17:45 から約11〜17分、11/06 18:16 から約2〜5分、日曜 04:00 前後に約5分(11/01、11/08)。端末単独の抜けは1〜6分で、kensaku-stonebase01 が最も多い(業務時間中に14日で十数回、例: 11/01 12:05〜12:30 に3回)。assembly-02 は10/27〜28 に断続的な長い抜けが集中し、その後は少ない。status 送信の窓内最大時間は各台で約10秒(送信のタイムアウト)まで伸び、3秒を超えた窓は14日で17〜88窓(全窓の0.5〜2.4%)。製番ボード画面のAPI失敗(kiosk_net_stats)は要求数に対して0.1%未満。1分未満の途切れは5分窓の記録では見えない。以上から、数秒〜10秒の遅延は日常的にあり、実際の断は分単位なので、暫定15秒は両者を分ける値として妥当と判断する。ただし15〜60秒の断の頻度は記録から分からないため、試用端末 kensaku-stonebase01 で状態遷移の記録を取って最終確定する。Pi5 側の停止中も端末から見れば圏外であり、固定表示になるのが正しい。

`apps/web/public/sw.js:172-202,241-249` はキャッシュした HTML をオンラインでも先に返し、offline の meta を付ける。その印は「実際に無線が圏外」の証拠ではない。圏外判定と起動時の書き込み禁止を別に扱う。

## Decision Log

- Decision: 起動・復帰の全件読み直し上限をrefreshTimeoutMs（既定45秒）に分離し、probeを含む最後の成功から15秒の通信断判定は維持する。有効時もページ指定のrefetchIntervalMs: falseでボードの定期更新を停止する（2026-11-10 / 実装担当）。
- Decision: 起動中は表示を固定せず、probe成功1回と全件読取成功を独立した成功としてonlineへ進める。失敗した起動読取は後続の成功probeで間隔をあけて重複なく再試行し、起動から15秒を上限とする。offlineからの復帰は連続2回確認を維持する（2026-11-10 / 実装担当）。
- Decision: 端末の有効設定は端末内に最後の値を覚え、開いた瞬間からその値で動く。設定の返答で画面を作り直さず、圏外のまま開いても帯を出すため（2026-11-10 / レビュー指摘）。
- Decision: PR 2の有効時だけページ専用読取経路へ切り替え、世代・scope・端末を照合した応答を公開する。復帰時は旧送信の終結を待ち、本体・チップ・負荷・資源・加工時間・稼働時間・表示中の補助情報を仮領域に揃えて一括公開する。refreshing自体と取得処理の両方をlossAfterMsで打ち切る。
  Rationale: 共通QueryClient・API hooks・他画面を変えず、遅着応答・未送信queue・旧編集状態から固定表示が動く経路を閉じる。無効時は既存hooksと常時許可gateを使い、probeを作らない。
  Date/Author: 2026-11-10 / 実装担当。

- Decision: 判定はボード専用に持ち、既存 mobile connectivity を変更・共用しない。
  Rationale: モバイルはHTTPエラーも到達成功とし、onlineイベントで即復帰する。今回の15秒猶予、2回連続成功、Pi4の無線専用要件に合わない。
  Date/Author: 2026-11-10 / 設計担当。
- Decision: 既存 `GET /kiosk/production-schedule/grinding-planning-board/resource-capacity` を専用の定期確認として使い、既存のボード読み取り成功もオンライン時の成功時刻に反映する。確認の応答を表示データへ直接反映しない。
  Rationale: 一般の system health だけでは端末認証・サイト依存の読み取りを保証せず、本体全件を5秒ごとに読むのは重い。既存の小さい読み取りAPIを使えば新規APIは不要である。負荷は実機段階で確認する。
  Date/Author: 2026-11-10 / 設計担当。
- Decision: 全書き込みの可否はボード専用 gate（共通の可否判定）を正本にする。queue 入口と実送信直前の双方から同じ判定を使う。
  Rationale: ボタンの見た目だけでは既に開いているポップアップ、ドラッグ、非同期処理を止められない。
  Date/Author: 2026-11-10 / 設計担当。
- Decision: 圏外突入時の表示投影と、最後にサーバーから得た確定データを区別して保存する。未確認の変更内容を送信用データとして保存しない。
  Rationale: 現在の見た目を保つ要求と、未確認操作を再送しない要求を両立する。復帰後はサーバーの結果が正本になる。
  Date/Author: 2026-11-10 / 設計担当。
- Decision: 経過時間は `performance.now()`、表示用の日時はサーバー応答の HTTP Date を使う。端末の `Date.now()` で古さを判定しない。
  Rationale: Pi4にはRTCがなく、起動後の時刻補正や日付跨ぎで誤判定・ガント移動を起こさないため。
  Date/Author: 2026-11-10 / 設計担当。

## Outcomes & Retrospective


設計成果は本書だけである。コード変更、実装試験、実機観測、本番適用は未実施。暫定15秒を実測で正当化したとは扱わない。表示が止まらないこと、保存データだけで再起動できること、書き込みを後送しないことを別々の証拠で確認する計画とした。後続の実装担当は各段階の結果・未完了項目をここへ追記する。

## Context and Orientation


Reactページ `apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx:131-149` が本体、負荷、製番候補、資源マスター、納期詳細を読み、各書き込み hook を生成する。`:196-243` が表示データ、queue、完了操作を結ぶ。`:250-254` は工程チップを別取得する。`:182-185` の30秒時計更新と `apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardPageGantt.ts:85-88,183-185` の今日・現在時刻は、ネットワーク更新なしでもガントの表示を動かし得る。

`apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardQueryData.ts:3-11` は同一JSONの参照を保持するだけで、永続保存も表示固定もしない。段階取得 hook `apps/web/src/api/hooks/production-schedule/grinding-planning-board.ts:231-300` は同じ snapshotId と sourceRevision の続きを結合し、全件が揃うまで前の全件表示を保つ。snapshotId は取得中の一貫性、sourceRevision/itemRevision/version は更新競合検出の値であり、保存した値を最新とみなして書き込んではならない。

`apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue.ts:88-103` は確定応答の上に未完了操作を重ねて即時表示する。`:123-148` の成功処理、`:149-182` の取消・再取得が、圏外突入後に表示を動かさないようにする必要がある。`:193-203` の acceptRefreshedState は送信中には解除しない。

queue外の入口は `apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardArrival.ts:41-67`、`usePlanningBoardCompletion.ts:39`、ページ `:338` 以降の split/merge、`gantt/usePlanningBoardGantt.ts:25-29,78-86` の加工時間ソース・稼働時間・休憩、`gantt/PlanningBoardResourceMinutesSheet.tsx` の加工時間編集である。`usePlanningBoardPaneOrder.ts:55-64` の設備並びは端末内保存だが、今回の「並べ替えは全部止める」に含める。製番チェックは表示の絞り込みに見えてもサーバー共有の書き込みであり、ページ `:614` の更新を遮断する。

`apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardToolbar.tsx:75-135` は閲覧用と書き込み用のコールバックを一緒に受ける。scopeDisabled を丸ごと圏外に連動させず、各用途を分ける。元割当や完了済みの既存制限は維持する。

読み取りAPIの正本は `apps/api/src/routes/kiosk/production-schedule/grinding-planning-board.ts:169-262` である。GET本体、GET resource-minutes、GET resource-capacity、GET load、GET seiban/:fseiban/due-detail に加え、POST process-chips も読み取りである。HTTPメソッドだけで書き込みを判定してはいけない。GET seiban-candidates は別ファイル `apps/api/src/routes/kiosk/production-schedule/grinding-planning-board-seiban-candidates.ts:16`、GET resources は `apps/api/src/routes/kiosk/production-schedule/resources.ts:10` にある。クライアントの引数・URLは `apps/web/src/api/domains/production-schedule/grinding-planning-board.ts:37-124,181-203`、資源取得は `apps/web/src/api/domains/production-schedule/schedule.ts:180` で確認できる。通信URLの先頭には通常 `/api` が付く。

`apps/web/src/features/mobile-app-shell/registerMobileAppShell.ts:7-25` は対象パスを列挙し、登録scopeを既に `/kiosk/` としている。`apps/web/public/sw.js:13-32` はナビゲーションのパスに加えてasset要求元のclient URLも限定し、`:126-150` で全assetを保存してからHTMLを確定する。`apps/web/vite.config.ts:40` にビルドmanifestがある。`apps/web/src/App.tsx:273,311-312` が登録呼び出しと製番ボードのルートである。

既存例 `apps/web/src/features/mobile-placement/connectivity.ts:19-31,58-95` は3秒制限の通信と15秒の復帰確認、`local-data/MobileOfflineChip.tsx:3-7` は「圏外」と日付を表示する。帯の仕様が異なるのでその部品自体は流用しない。IndexedDB は既存依存 `idb` と `apps/web/src/features/kiosk/loan/offline/loanOfflineQueueStore.ts:20-27,48-60` の接続失敗時リトライ・transactionのパターンを使うが、貸出のDBや再送runnerは共有しない。

関連計画 [planning-board-background-writes.md](planning-board-background-writes.md) は曖昧な失敗の無条件再送を禁止する。[kiosk-grinding-planning-board.md](kiosk-grinding-planning-board.md) は本体の競合・段階取得・ガントの背景を持つ。[現場取説](../kiosk-operation-guide/production-schedule-planning-board.md) の閲覧と共有設定の区別を回帰確認に使う。本書を圏外対応の詳細正本とし、これらへ同じ設計を複製しない。今回の1ファイル限定指示に従い索引は変更しない。

## Plan of Work


### Milestone 1 / PR 1: 圏外状態と時計を独立して試験する


`apps/web/src/features/kiosk/grindingPlanningBoard/offline/` に `planningBoardConnectivity.ts` と `planningBoardOfflineConfig.ts` を追加する。状態機械とは、通信の結果を受けて状態を決まった規則で遷移させる小さい処理である。まず画面に未接続の処理として単体試験できる形にする。設定の初期値は lossAfterMs=15000、probeIntervalMs=5000、probeTimeoutMs=3000、recoverySuccesses=2、recoveredBannerMs=3000。読み取り専用の検証済み設定オブジェクトを起動時に注入し、ビルド設定は `VITE_PLANNING_BOARD_OFFLINE_*` の数値として既存ビルド設定の読み方に合わせて追加する。数値が不正・負数なら既定値、timeoutはinterval未満、lossAfterはinterval以上、成功回数は正整数に制限し、開発者用の設定画面は作らない。この作業で `.env` を読む必要はない。

定期確認はオンライン中も5秒おきに行う。本体の300秒間隔を変えない。既存 api クライアントを使って resource-capacity を `Cache-Control: no-cache`、3秒timeout、background telemetry指定で取得する。ブラウザーキャッシュからの成功を防ぐ設定も明示し、SWはAPIを一切キャッシュしない。新規専用APIは追加しない。要求は重複させず、intervalの時点で前回確認が未完了ならその回を飛ばす。ページ離脱でtimer・購読・要求を解除し、複数mountで増殖させない。

成功は現在の端末識別・判定世代に属する要求の、制限時間内の2xxかつ期待するJSON形状の応答だけである。HTTP 401/403/409/429/5xx、HTML、redirect、timeout、応答なし、取消、期限後応答、IndexedDB・Query cache・SWの読み出しは成功に数えない。online/offlineイベントは確認を促す参考情報で、状態を即変更しない。Pi4でnavigator.connection.typeが取れなくても確認を続ける。既存mobileの「HTTP応答なら成功」はコピーしない。

状態は bootstrapping（起動時の安全な読み取り専用）、online、offline、refreshing とする。起動時は保存データを出せても書き込めず、2回の確認成功と必要データの最新取得後にonlineへ入る。初回オンライン起動で緑の復帰帯は出さない。オンライン起動に失敗して15秒経過した場合はoffline、SWが外枠を返した起動やブラウザーが明示的にオフラインの起動は保存表示を即時読み取り専用で出し、圏外帯を出す。通常運転からは最後の成功完了から単調時計で15秒未満なら状態・UIを変えず、15秒以上でofflineへ入る。各イベント処理時にも経過時間を確認し、遅れたtimerに依存しない。

online時は、現在の端末で始まった許可済みのボード用読み取りAPI（process-chipsのPOSTを含む）の有効な成功もlastSuccessMonoを進める。共有HTTPクライアント全体の成功やdeploy-status、telemetry送信、書き込み成功は数えない。API hookのボード専用読み取りラッパーから通知し、networkReporterの集計を判定器にしない。

offlineでは定期確認の別々の2回が連続成功した時だけrefreshingへ進む。同時に返った本体・チップの2応答を2回とは数えない。確認失敗で連続数を0に戻す。refreshingは書き込み禁止と圏外帯を保ち、全件本体と描画必須の補助データを仮領域へ読み込む。必須取得が失敗すればofflineへ戻る。成功を一括公開した時だけonlineにし、緑帯を3秒出す。確認が通ってもAPIの機能障害・認証障害が残れば解除しない。圏外の表示は通信またはサービスを利用できない意味であり、Wi-Fiの物理的切断に原因を限定しない。

単調時計はプロセス内の経過専用で永続化しない。HTTP Dateが有効なら、表示データを取得完了したサーバーUTC時刻を保存し、JSTのHH:MMにする。確認だけの成功で「HH:MM の表示」を進めない。オンライン中の画面内時計もサーバー時刻と単調経過の組から算出する。圏外では最後の描画時間を固定し、todayJstの内部呼び出しもこの時間基準を引数で受ける。再起動後は保存した時間をそのまま使い、端末時計から経過を推測しない。HTTP Dateを取得できない場合は時刻を捏造せず `--:-- の表示` を使う例外とし、実機試験の必須確認に残す。

この段階は偽の単調時計と通信結果で試験し、14,999msで変化なし、15,000msでoffline、成功1回では解除なし、成功・失敗・成功では解除なし、2回成功後も最新取得前は書き込み禁止を証明する。端末時計を大きく動かしても結果が変わらないことを確認する。

### Milestone 2 / PR 2: 表示を固定し、書き込みを一か所の判定で止める


同ディレクトリに `PlanningBoardOfflineProvider.tsx`、`planningBoardWriteGate.ts`、`PlanningBoardConnectivityBanner.tsx` を追加し、ページ内にだけProviderを置く。ProviderはReactの子部品が同じ状態・操作判定を読む仕組みである。既存の共通QueryClientのonlineManagerや他画面の通信を変更しない。オンライン表示は従来の経路を使い、offline突入時にページで表示中のitems（queue投影・到着/完了の投影を含む）、登録順・共有チェック・補助データ・時間基準・閲覧条件を取得し、固定した表示モデルへ切り替える。段階取得中なら現在見えている部分だけを固定し、完全取得済みと偽らない。

gateは同期的なrefの状態を正本にし、Reactの次render前でも遮断する。すべての書き込みUIはローカル状態を変える前に `assertCanWrite()` を呼び、APIを呼ぶコールバックも実送信直前に同じ判定を呼ぶ。queueはenqueue前と次のsave前に必ず同じgateを使う。共有api全体へのURL推測のinterceptorは作らず、ボードのProvider/queue/書き込みhookへ明示的に渡す。ページ、createPlanningBoardSeibanActions、usePlanningBoardDueActions、usePlanningBoardCompletion、usePlanningBoardArrival、usePlanningBoardPageGantt、PlanningBoardPiecePopover、PlanningBoardResourceMinutesSheet、gantt/usePlanningBoardGantt、usePlanningBoardPaneOrder の全入口を調べ、保存関数の迂回がないことをテストで確認する。

遮断する対象は登録・解除・製番チェック、製番順位、行の順位・資源移動・納期ドラッグ、並べ替え提案と適用・納期順・戻す、設備pane順（ローカル保存を含む）、ピン、分割・結合、到着と取消・初工程到着、親行とpieceの完了/未完了、一括変更、納期スコープ・特別納期、加工時間とその取得元、設備稼働時間・休憩・分割設定である。提案だけの操作も画面を並べ替えるため止める。共有チェックでの表示製番選択は遮断するが、別のローカル絞り込み操作は許可する。

圏外時にボタンを単にdisabledにすると押しても通知できない。圏外理由だけではnative disabledにせず、aria-disabledと見た目を付け、押下・キーボード・保存でgateの短い通知を出す。既存の別理由のdisabledは維持する。ドラッグ開始/確定もgateを通し、突入時には継続中のgestureを取消す。閲覧のクリック、スクロール、キーボード移動を包括的に遮る透明overlayは作らない。通知は既存feedback領域を使い、2秒で消す専用経路にする（現在のnotifyは成功のみ自動消去するため、そのままerrorを渡さない）。

圏外突入を一つの同期処理として、gate閉鎖、表示モデル固定、世代番号更新、未送信queueの破棄、読取の自動更新停止の順で行う。既に送った書き込みはクライアント取消でサーバーの取消を保証できない。「未確認」と内部記録し、同じ要求を再送しない。未送信分は将来送るために残さず破棄する。固定表示を保つためqueueのonFailedや遅着成功、完了/到着overlay、refetch結果、タイマーが旧世代から画面・保存済みモデルを更新できないようにする。onSavedも次の書き込みや成功通知を発生させない。通信timeoutと取消の終結を確認するまで復帰時のgateは開けない。サーバー側で後から成立した結果は最新GETで確認し、競合制御は既存revision契約を維持する。

これにより画面上に未確認の楽観表示が残る場合があるが、それを確定結果とは扱わない。圏外帯の「HH:MM」は最後に取得したデータの時刻であり、未確認書き込みの成立時刻ではない。復帰後に不成立の変更が戻るのは正しい。回復処理は、旧送信の終了後に新しい全件・必要な補助応答を一括公開し、古い選択・順番履歴・編集snapshotを破棄してqueueの確認済み状態を再初期化する。旧revisionからの書き込み再開を禁止する。

閲覧は固定モデルから行う。ガント/一覧、ズーム、スクロール、資源フォーカス、品番探索、ローカル到着絞り込み・色分けは使える。API条件が変わるcategory/status/scheduleSource/dueSource/viewは、保存済みの一致する範囲があれば切り替え、なければ現在表示を保持する。部分データで未取得の完了行や他区分を作らない。既存の共有製番チェックをローカルフィルターとして書き換えない。見られるデータがない操作は既存の空表示または同じ短い通知だけとし、新しい補助ラベルを足さない。

帯はページの変形・70%ズームの外、KioskLayoutの上辺にある固定の専用slotへportalで出す。製番ボードのProviderがmount中だけ有効にし、離脱時に消す。header自動非表示や全画面でも帯が隠れず、画面高を差し引いて操作領域に重ならない構造にする。圏外色と緑色だけに頼らず指定文字を表示し、状態変化はrole=statusで一度読み上げる。表示時刻を毎秒読み上げない。PR 2の時点で帯、全書き込み遮断、復帰、短い途切れで変化なしをページ統合試験で確認できる。

### Milestone 3 / PR 3: 最後の表示をIndexedDBから復元する


`offline/planningBoardSnapshotStore.ts` に既存idbを使う新規DB `kiosk-planning-board-offline` version 1を作り、`snapshots` と `lastDisplayed` を同一transactionで更新する。queue DBと混ぜない。保存単位は単独API応答の無差別永続化でなく、ページが実際に採用した本体と補助応答を束ねた表示世代である。途中取得は別の `complete:false` と件数範囲を持ち、前の全件世代を壊さない。後続ページはsnapshotId/sourceRevision/site/category/viewを照合し、全件完了だけをcomplete:trueとして昇格する。sourceRevisionのない補助応答はその世代で最後に採用された値と各取得時刻を保存し、サーバー全体で同一transactionだったとは主張しない。

保存する本体はGET grinding-planning-boardの全ページを結合した応答（includePieces=true、itemsとpiece情報、siteKey、registeredFseibans、uncheckedFseibans、seibanOrder、resources、resourceCategories、machineNames、seibanProgress、boardVersion、sourceRevision、snapshotId）である。snapshotIdやcursorで再起動後の続きを取りに行かず、復帰時は新規snapshotを作る。GET loadの負荷と不明件数、GET resourcesの名前・選択肢、GET resource-minutesの設定、GET resource-capacityの稼働/休憩/分割設定、POST process-chipsの結合結果も保存する。チップはscheduleSourceとpartsの正規化集合を対応付け、複数バッチの途中失敗で完成と扱わない。GET seiban-candidatesとGET seiban/:fseiban/due-detailは取得済み分だけ保存し、未取得の候補・詳細を圏外で通信取得しない。

キーは `schemaVersion + origin + devicePartition + siteKey + normalizedScope` とする。normalizedScopeはscheduleSource（未指定を既存既定値に正規化）、category、completionFilter、dueSource、includePieces、view、fseibansの正規化集合を含む。cursor/pageSizeは範囲キーに入れず取得進捗の属性とする。補助応答はAPI種別と実際の全引数（loadのcategory/source、候補のcategory/filter、詳細のfseiban、チップのparts/source）で区別し、表示世代から参照する。最後の表示ポインターにはこれらに加えてガント/一覧、allocation、ズーム、表示モード、ローカル絞り込み、資源フォーカス、スクロール位置と固定描画時刻を保存する。

devicePartitionは実効client-keyからWeb CryptoのSHA-256で作る識別用digestとし、認証キーそのものはDBへ保存しない（digestを認証には使わない）。`apps/web/src/api/http.ts:35-36,156-166` の実際に送るキーに合わせる。既定キーを含め現在識別と一致する区画だけを開き、その区画の最後にオンラインで確認したsiteKeyを使う。キー変更、同じキーでサーバーから返るsiteKey変更時は別区画・別世代へ切り替え、旧応答と旧ポインターを再採用しない。圏外で端末のサーバー側所属変更までは知れないので、保存済み所属の閲覧だけを許し書き込みは常に禁止する。認証token、header、request body、送信待ち操作は保存しない。

通常はAPIから採用した応答と表示条件を更新する。圏外突入時は `frozenDisplay` に現在の投影と `hasUnconfirmedWrites` を別属性として保存し、確定応答を上書きしない。これは描画専用でsave関数・再送payloadを持たない。再起動後もその投影を表示できるが、gateは閉じ、復帰で全てサーバーデータへ置換する。保存は本体採用・補助データ採用・表示条件変更で短くまとめて実行し、突入時は即座にtransactionを開始する。電断がtransaction完了より早ければ最後にcommit済みの表示へ戻る限界を記録する。

保存日時とデータ日時はサーバー基準で保持し、圏外での有効期限による自動削除をしない。日付が古くても閲覧は可能で、復帰前の書き込みは禁止する。日時不正、未知のschema、型不整合、device/site不一致のレコードは採用しない。lastDisplayedが指す1世代と直前の正常世代を保護し、他のscopeは最新だけを保持する。SSD容量を理由に全履歴は溜めない。quota超過、DBが使えない、persist不許可でも現在メモリ表示とgateを維持し、古い正常世代は消さない。保存不能は既存のエラー収集へ内容やキーを含めず記録し、再起動での復元保証ができなかったことを試験結果へ残す。

復元データがない初回圏外起動では外枠と帯、既存の取得失敗表示だけを出し、空を正常な全件と扱わない。新しいオンディスクschemaへ変更する場合も旧世代を読めなくしてから消す設計にせず、無効レコードを無視してオンラインで再作成する。この段階はDBの部分保存・復元・破損・区画違いの試験と、ページ再mountで保存表示と時刻が戻る統合試験で検証する。

### Milestone 4 / PR 4: 外枠とレイアウトを製番ボードだけに広げる


既存登録関数を保ち、`registerMobileAppShell.ts` に製番ボード用の厳密な判定を追加する。対象は `/kiosk/production-schedule/planning-board` と末尾slashだけであり、production-schedule全体をprefixで許可しない。共通の「外枠対象」判定はモバイルの現対象とこのパスの和にするが、モバイル固有の圏外判定関数の意味を広げない。`sw.js` のナビゲーション判定とasset要求元clientの判定を同じ許可リストへ広げる。scopeは既に `/kiosk/` なので広げず、別の競合するSWを作らない。

キャッシュ対象は外枠とmanifestから辿るJS/CSS/font等だけとする。API、POST、PUT、DELETE、他origin、他のキオスクのナビゲーションは従来どおりnetworkへ通す。モバイルの経路・更新処理、全asset成功後のHTML保存、複数window時に古いassetを消さない条件を維持する。公開済みSWはロールバック後も残り得るので、後述の戻し方をこの段階で試験する。登録はproductionビルドかつsecure context限定を維持する。現在のmanifestが製番ボードの遅延chunkまで含むことをビルド版で検証する。

KioskLayoutは厳密な製番ボードパスに限り、キャッシュ外枠の起動、navigatorのoffline、またはdeploy-status取得エラー時にProviderまでmountできるようにする。その間gateはbootstrapping/offlineで閉じる。過去に得たdeploy-statusの「通常」を永続保存して最新の運用判断として使わない。オンラインで明示されたisMaintenanceは既存どおり優先し、release検証の強制リロード用 `__raspi_kiosk_web_release` / `__raspi_web_runtime_recovery` をSWで迂回しない。他のキオスク画面のfail-closedを維持する。帯slot以外の共通ヘッダー・自動リロード・maintenance通知を圏外状態で一律無効化しない。

本段階の証拠はdevelopmentサーバーでは作れない。productionビルドをlocalhostのsecure扱いで配信し、初回オンラインでSWの制御とDB保存が完了してから、ネットワークを切り、ページ再読込、タブを閉じて再作成、同じuserDataDirのブラウザープロセス再起動を試す。Service WorkerとIndexedDBを残した再起動で固定ボードと帯が戻り、書き込みHTTPが0、閲覧が可能であることを記録する。初回未準備、cache消去、DB障害も別試験にする。全キオスクを圏外対応したとは報告しない。

## Concrete Steps


後続実装ではまずAGENTS.md、`.cursor/rules/00-core-safety.mdc`、変更領域に必要な品質・UI・Gitルールを読む。作業ディレクトリはこのタスクworktreeであり、既存WIPを保護する。新タスクworktreeが必要な場合だけGit lifecycle CLIのaudit/startをルールに従って使う。本計画作成では既存worktreeを継続し、Gitの状態確認以外の変更操作をしていない。各段階はローカル実装までを別途依頼でき、PR作成・push等はその段階の明示承認を得た後に行う。

PR 1では次をリポジトリルートから実行する。以下の新規テストファイルは各段階で実装する名前で、現時点では存在しない。

    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/grindingPlanningBoard/offline/planningBoardConnectivity.test.ts

PR 2では新しいページ試験を別ファイルへ絞り、既存queue試験を回帰確認する。

    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue.test.ts src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.offline.test.tsx

PR 3ではDB実装と復元経路を直接確認する。新規依存を入れず、既存loan store試験が使うIndexedDB代替のパターンを使う。

    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/grindingPlanningBoard/offline/planningBoardSnapshotStore.test.ts src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.offline.test.tsx

PR 4では既存SWを直接動かす試験とレイアウトの限定例外を確認する。

    pnpm --filter @raspi-system/web exec vitest run src/features/mobile-app-shell/registerMobileAppShell.test.ts src/features/mobile-app-shell/serviceWorker.test.ts src/layouts/KioskLayout.offline-planning-board.test.tsx
    pnpm --filter @raspi-system/web build

変更段階では変更したソースだけへESLintを実行し、型境界を結んだ時点で `pnpm --filter @raspi-system/web exec tsc -b` を実行する。PR 4のbuildが型検査も含むため、同じ最終入力で重ねて実行しない。UI変更に必要な `pnpm kiosk-sop:source-check` も承認された実装段階で実施し、staleなら取説に影響する差分かを判定する。

PR 4に `e2e/planning-board-offline-readonly.spec.ts` を追加する。ビルド版を `pnpm --filter @raspi-system/web preview --host 127.0.0.1 --port 4173` で別プロセスから配信し、テスト内で本体・補助API・deploy-statusをHTTP fixtureで供給する。SWからの要求も制御できるlocalhostのHTTP応答を用い、Service Workerをblockする設定やページのroute mockだけで再起動を証明しない。実装時に試験用サーバーの起動・停止をこのspecに閉じ、既存API/DBを必要としない形にする。

    pnpm exec playwright test e2e/planning-board-offline-readonly.spec.ts --project=chromium --workers=1

Playwrightはbundled Chromiumだけを使い、必要なら `pnpm exec playwright install chromium` を行う。インストール済みGoogle Chromeやmsedge、/Applicationsの実行ファイルは起動しない。bundled browserが動かない場合は検証不能として残す。成功時は各focused testの全件成功、APIのwrite要求0件、再起動前後のitems/時刻一致、復帰後の新revision一致、緑帯の3秒後消去を短く本書へ記録する。件数は実行結果で埋め、事前に成功数を捏造しない。

ローカル検証は品質ルールの通常20分を上限とし、同じ入力で成功した試験を反復しない。失敗は原因に対応した修正後または一時的環境要因の根拠がある場合に1回だけ再実行する。無関係な失敗を直さず、必須証拠を妨げる場合は未完了として止める。広いsuiteは変更リスク・CI分類で選ばれたものをhosted CIの証拠にできる。実機試験はこのローカル予算へ無断追加せず、別途承認を受ける。

## Validation and Acceptance


通信断試験は少なくとも10秒の途切れと15秒以上の途切れを分ける。前者は帯・ロック・表示移動なし、後者は最後の成功から閾値に達したとき固定と常時帯が現れることを見る。offlineイベントだけ、HTTP 5xxだけ、無応答、3秒を超える遅い応答、複数要求の同時成功、401、古い世代の遅着、連続失敗後の単発成功を入力する。復帰2回の後も全件取得が失敗すれば圏外のままであり、完全な新表示を公開したときだけ書き込み可能になる。

全書き込み入口に対し、offline突入前に開いたdialog・popover、キーボード、ドラッグ、別コンポーネントのAPI hookを含め、表示投影が変わらずHTTP要求が0件で通知が短く出ることを検証する。並べ替え、移動、自動提案、分割/結合、ピン、到着/取消、完了/取消、納期/特別納期、共有チェック、設備pane順、加工時間/稼働設定を代表例で漏れなく覆う。閲覧は同じ固定itemsでズーム、一覧/ガント、絞り込み、スクロールでき、未取得範囲への切り替えで現在のボードを失わないことを確認する。

送信中A、未送信Bの状態でofflineへ遷移させ、Aの成功・失敗・応答消失をそれぞれ試す。Bは送信されず、Aの遅着で固定表示・保存世代・通知が変わらず、復帰GETでAが成立したかを反映する。オンライン中の15秒未満の障害でも既存の曖昧失敗を自動再送せず、通常の競合・保存失敗処理は維持する。圏外は全てのサーバー処理の取消を保証するものではない。

再起動試験では古い端末日付、日付の大幅な前後補正、JST日付跨ぎ、初回部分取得中の切断、snapshot期限切れ、DB transaction失敗、schema不一致、異なる端末キー、同一キーのサイト変更を扱う。保存済み時刻とガントの時間基準が維持され、別端末・別サイトのデータが混ざらず、古いデータから書き込めないことを合格条件とする。帯は通常と50インチ表示の双方で画面上端に常時見え、スクロール領域やボタンを覆わない。

他画面への影響確認ではmobile-placement、purchase-order-lookupの既存オフライン挙動を保ち、`/kiosk`、貸出、他のproduction-schedule、製番ボードと似たprefixのURLには新しいHTML fallbackを返さないことをSW試験で証明する。非対象clientのassetも従来どおりnetworkである。明示maintenanceとrelease検証リロードが維持されることをレイアウト・ビルド版双方で確認する。

### 実機記録から15秒を決める手順


この設計作業では実機にもログAPIにも接続しない。後続で承認を得た担当が [docs/guides/monitoring.md](../guides/monitoring.md) の「キオスクの通信品質と応答時間の調査」（285-322行）に従い、端末別・UTC期間指定で `GET /api/clients/logs?category=network_health&clientId=<対象端末>&since=<UTC時刻>` と category=kiosk_net_stats の記録を取得する。管理者認証の値は文書・試験成果へ書かない。通常/繁忙/ノイズが強い時間帯を含む複数稼働日を対象にし、JSTへの換算は解析時に統一する。

network_healthは `clients/status-agent/network_health.py:162-218` の毎分採取・通常5分窓で、windowStartはUNIX秒である。通常窓（windowSeconds>=300）と途中のWARNを分け、WARNを合計に重複加算しない。signalDbmMin/Avg/Max、carrierChangesDelta、rx/txErrorsDelta・DroppedDelta、statusPostOk、statusPostMsMin/Avg/Maxを端末別に見る。信号の弱さだけで閾値を決めず、API失敗と同じ時間帯かを照合する。

kiosk_net_statsは `apps/web/src/features/kiosk/errorTelemetry/networkReporter.ts:3-4,39-85` にある5分窓で、windowStartはISO UTC、分位点は最初の最大500件、失敗は応答なしと5xxである。p50/p95/maxとfailures/requestsを製番ボードroute・端末別に集計する。400番台やcancelは今回の判定成功と同義ではない。通常3秒を超える要求が多いなら、まずprobe endpoint固有の応答時間を分けて比較する。

この2種類の集計だけでは「通信成功が何秒途絶えたか」の連続分布も、15秒を超える回数も復元できない。通信断時は送信失敗でログが欠測し、network_healthは毎分なので短い途切れを見逃す。欠測を正常・圏外のどちらにも決めつけず、平均p95だけから15秒を確定しない。

不足分はPR 1の判定器に限定した記録を後続実機試験で取る。状態遷移、最後の成功からの単調経過、probe所要時間と成功/失敗種別、連続成功数、復帰全件更新の時間を小さい上限付きメモリ記録に保持し、回復後に既存telemetryへ集約する。切断中の記録が必要な試験では同じ上限付き観測記録だけをIndexedDBへ退避し、送信済み分を除去する。業務書き込みoutboxとは別で、入力値・製番・キー・bodyを含めない。観測失敗で画面を止めない。プロセス再起動を跨ぐ時間差はサーバー時刻が得られるまで不明とする。

許可された実機1台で暫定15秒/5秒/3秒/2回から始め、短い断続と継続断、ルーターに繋がるがAPIへ届かない障害を再現し、検出遅延・不要なロック回数・復帰待ち・Pi4描画負荷・Pi5への確認負荷を記録する。正常時の成功間隔、途切れ時間の分布、現場が許容する未検出時間を並べ、例えば10/15/20秒の候補を保存した観測列で比較する。probe timeoutと閾値を同時に無根拠で緩めない。設定値・根拠・未観測範囲・対象端末/期間を本書Decision Logへ記録し、現場の許容値を確認してから確定する。承認された実機試験は本番展開完了の代わりにならない。

## Idempotence and Recovery


DB更新は同一キーへのtransaction置換なので繰り返せる。保存途中で失敗したら最後の正常世代を使い、オンラインで取り直す。schema不整合時も他機能のDBやブラウザー全キャッシュを消さない。容量、persist権限、ストレージ消去、SSD破損、初回オンライン準備なしでは再起動復元を保証できない。Service Workerはブラウザー外やOSのハングを救済しない。RTCなしの起動ではTLS等のネットワーク前提も時刻同期後に別途確認し、ボード側の時刻差で上書きしない。

主な危険はゲート迂回、圏外後の旧応答による表示更新、違う端末の保存データ、時刻補正による再配置、古いSWと新しいデータschemaの組合せ、共通レイアウト変更による他画面・運用保守への影響である。それぞれ入口別試験、世代照合、キー照合、固定時計、ビルド版再起動試験、厳密なパス限定で抑える。小さいPRでも最終受入を満たすまで機能完成と扱わない。

戻す場合はまず対象端末の `ClientDevice.planningBoardOfflineEnabled` をfalseにし、オンラインでページを開き直して従来経路へ戻す。無効化で既に圏外の画面のロックを強制解除しない。保存DBは残して旧表示の調査を可能にし、無効な版では参照しない。SW拡張はサーバーのJSを戻すだけでは消えないため、同じ `/sw.js` を元のモバイル許可リストへ戻す更新を配信する手順を準備し、オンライン復帰後のworker更新・再起動で対象除外を確認する。モバイルと共有する登録やcacheを丸ごとunregister/deleteしない。キャッシュされた旧外枠が残るケースは既存release検証のリロード経路で回復を試験する。通信が戻るまでSW更新が届かない限界を明記し、圏外中に遠隔で必ず戻せるとは扱わない。

実装を戻しても、切断直前にサーバーで成立した書き込みを逆操作で取り消さない。最新GETで成立状態を確認する。デプロイを行う場合はその時点で対象SHAとCIを確認して別途明示承認を受け、標準ローリング手順と標準rollbackを使う。本書は本番コマンド実行の許可ではない。

## Artifacts and Notes


今回の観測はローカルソースの読取と差分確認だけであり、実機性能値、再起動成功、CI成功の成果物はまだない。後続では各PRの対象SHA、focused試験結果、画面の帯と保存日時、遮断中のwrite要求数、再起動前後の表示世代、復帰後のrevision、設定検討に使った観測期間をこの節へ残す。PR/merge/main CI/本番runの証拠はそれぞれ別に記録し、feature branchの成功を統合・本番成功として扱わない。

未決は実機記録による判定値の最終確定、HTTP Dateの実際の供給・可視性、確認APIのfleet負荷、現場が許容する検出/復帰時間である。計画上は上記暫定値とDate方式で実装を進められるが、最終受入前に確認する。Dateが取れない場合だけサーバー時刻を返す最小契約の追加を再設計し、API変更が必要なら品質ルールの重いレビューへ切り替える。圏外で保存範囲外まで見たい要求は別仕様であり、今回の手元データ閲覧から広げない。

範囲外として、現在のモバイル通信判定の変更、貸出等のoutbox統合、OSのネットワーク復旧・RTC増設、他画面の圏外化は行わない。将来のoutboxは操作ごとの冪等キー（同じ操作を重複成立させない識別子）、競合解決、端末識別、ユーザーに未送信/成立不明を示す仕様を別段階で決める必要があり、今回の表示用保存を再送queueへ転用しない。

## Interfaces and Dependencies


新規ランタイム依存は不要で、React、TanStack Query、axios、idb、Web Crypto、Service Worker、既存shared-typesを使う。ネットワークの状態はボード専用のProviderから読み、他機能のonline状態へ書き込まない。次の契約を上記offlineディレクトリに設け、具体的な応答型は既存shared-typesからimportする。表示モデルの型はページの全描画入力を明示的に列挙し、React要素や関数をDBへ保存しない。

    type BoardConnectivityPhase = 'bootstrapping' | 'online' | 'offline' | 'refreshing';
    type BoardOfflineConfig = {
      enabled: boolean; lossAfterMs: number; probeIntervalMs: number;
      probeTimeoutMs: number; recoverySuccesses: number; recoveredBannerMs: number;
    };
    interface BoardWriteGate {
      canWrite(): boolean;
      assertCanWrite(): void; // offline等では専用の拒否例外。通知はUI側で短く1回。
      generation(): number;
    }
    interface BoardSnapshotStore {
      readLast(devicePartition: string): Promise<PlanningBoardSnapshot | undefined>;
      commit(snapshot: PlanningBoardSnapshot): Promise<void>;
    }

`PlanningBoardSnapshot` はschemaVersion、origin、devicePartition、siteKey、正規化scope、complete、各応答と取得時刻、server表示日時、描画基準日時、表示条件、必要ならfrozenDisplay/hasUnconfirmedWritesを持つ。接続判定器は単調時計・probe関数を注入でき、成功観測とtimer入力で試験できる。全レスポンス/副作用の公開にはgenerationと端末範囲の一致を要求する。queueには同じgateと `enterReadOnly()` を渡し、未送信破棄と送信中の終結待ち、最新状態採用後の再初期化を明示的に扱う。`PlanningBoardConnectivityBanner` はphase、displayedAt、recoveredUntilを受け、表示専用で通信や状態遷移を行わない。

## Plan Revision Note


2026-11-10: 初版。既存の段階取得・queue迂回経路・SWの対象制限・deploy-statusの起動遮断を調べ、ユーザー指定の固定表示と書き込み禁止、RTCなしの時計、端末ごとの永続保存、実測での設定確定を実装可能な段階に分けた。変更ファイルは本書のみ。
