# 現場キオスクの画面を StoneBase から見る(遠隔画面表示)

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log and Outcomes & Retrospective must be kept up to date as work proceeds. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

StoneBase01 は机に置いた Pi4 キオスクで、現場の Pi4 キオスクからの問い合わせをフローティングChatの「お問い合わせ」で受けている。サポート担当が返信しながら現場の画面をそのまま見られれば、状況の説明を待たずに把握できる。

完成後の振る舞いは次のとおり。

1. 管理画面「お問い合わせの受信」の開ける人(社員番号)ごとに「画面を見る」チェックがある。
2. StoneBase で社員証をタッチして問い合わせスレッドを開くと、その人に「画面を見る」権限があればスレッドの見出しに「画面を見る」ボタンが出る。
3. 押すと、問い合わせを送った現場キオスクに「StoneBase01 が この画面を見ます」と「見せる/断る」が出る。60 秒で応答が無ければ取り消す。
4. 「見せる」を押すと現場の画面が StoneBase に常に全画面で映る。フローティングChatはその上に重なり、「－」で畳める。左下の札に「● 端末名」「遅れ」「指さし」「■ 止める」がある。
5. 現場側には「StoneBase01 が見ています / 止める」の札が出る。どちらの「止める」でも終わる。どちらかの接続が切れても終わる。
6. 「指さし」を有効にして StoneBase の映像をタップすると、現場の画面の同じ位置に赤い輪が出る。輪は現場の操作を邪魔しない。
7. 開始と終了はスレッドに「画面を見ています」「見るのを止めました」として残り、誰がどの端末をいつ見たかを DB に記録する。

見た目の案は https://claude.ai/artifact/2hGVeeGp87ZxFMLPYqvWHK(第2版)。

## Progress

- [x] (2026-10-19) 既存のお問い合わせ、WebRTC 通話、キオスクの Chromium 起動条件を調べた。
- [x] (2026-10-19) 手元の Chrome で、`--use-fake-ui-for-media-stream` だけでタブの自己キャプチャが選択画面なしで取れることを確かめた。
- [x] (2026-10-19) 段階1: 「画面を見る」権限(DB、設定API、管理画面のチェック、受信者判定)。API統合テスト 45 件、Web 70 件が通過(ローカル、未コミット)。
- [x] (2026-10-19) 段階2: HTTP要求・同意・停止・60秒期限・切断終了・SYSTEM監査・両側UIをローカル実装。映像は未接続のvideo要素、指さしは無効表示。Web 1,537件/API DB不要30件・両アプリ型チェック・変更TS/TSXのlint成功。DB統合9件とマイグレーション適用はPostgres未提供のため未検証。
- [x] (2026-10-19) 段階3: タブ取得・現場offer・閲覧answer・ICE待機・2秒ごとのRTT表示・終了時のトラック解放をローカル実装。APIレビュー修正3件も反映。Pi4実機は未検証。
- [x] (2026-10-19) 段階4: 指さし切替、contain余白を除く座標変換、100ms間隔制限、閲覧側の短い輪・現場側の2.5秒の輪をローカル実装。
- [ ] Pi4 実機でタブの自己キャプチャが動くことの確認。
- [x] (2026-10-19) オーケストレーターが検証: 空DBへの全マイグレーション適用成功・Kioskテーブルの差分なし、API統合を含む4ファイル103件、Web 189ファイル1,568件、両アプリ型チェック、変更TS/TSXのlintが成功。
- [x] (2026-10-19) `docs/runbooks/kiosk-inquiry-inbox.md` に「画面を見る」の仕様・実装の場所・うまくいかないときを追記。

## Surprises & Discoveries

- 手元の Chrome で `getDisplayMedia` に `displaySurface: "browser"` を付けないと、`--use-fake-ui-for-media-stream` は画面全体を選び、ヘッドレスでは `NotReadableError` になった。付けるとタブ(`web-contents-media-stream://...`)が約 12ms で返った。
- `--auto-select-tab-capture-source-by-title` を併用すると応答しなくなった。使わない。
- サーバーの信号路(`/api/webrtc/signaling`)は端末(clientId)ごとに WebSocket を 1 本しか持たない。2 本目を開くと 1 本目が `Replaced by new connection` で閉じられる。

- 同意のDB更新を待たずに信号を中継するため、`watch.accepted` よりoffer/ICEが先に届く可能性がある。閲覧側では同意前の信号を待機し、PeerConnectionではremote description設定前のICEを待機する。テストで順序を確認した。
- API再起動で消えるタイマー・ソケットと、残るREQUESTED/ACTIVE監査行の寿命が異なる。現プロセスのlive mapにない行は要求時または受信時にstale終了する。ACTIVEだった行だけ終了SYSTEM記録を残す。
- `degradationPreference` を拒否するブラウザ向けに、NotSupportedError/TypeError時はその指定を除いてfps/bitrate制限を再設定する。これはモック検証のみで、Pi4 Chromiumの対応状況は未確認。
- 今回の検証ではWeb型チェック初回にpointer入力型の不一致、lint初回にimport順と共有設定の不要なHook依存を検出し修正した。最終チェックは成功。Browserslist / baseline-browser-mappingの古いデータ警告は今回の対象外として更新していない。

## Decision Log

- Decision: 映像は現場キオスクの Chromium が自分のタブを `getDisplayMedia` で取り、WebRTC で StoneBase へ直接送る。Pi5 は信号の中継だけをする。
  Rationale: 新しい常駐プログラムが Pi4 に要らず、LAN 内の直結で遅れが小さい。frameRate を 5 程度に抑えて軽くする。VNC を Pi5 経由で中継する案は、StoneBase01 にすでに別の wayvnc があること、Pi4 への新規デーモン、コンテナから Pi4 への経路が未確認であることから退けた。
  未確認: Pi4 の Chromium(XWayland)で同じ指定が選択画面なしで通るかは確かめていない。失敗した場合(`NotAllowedError` / `NotReadableError`)は StoneBase の札に短く出して見る作業を終える作りにし、反映後に実機で確かめる。
  Date/Author: 2026-10-19 / Claude

- Decision: 見る要求の許可判定は HTTP で行い、信号路は届けるだけにする。
  Rationale: 信号路の WebSocket は端末の clientKey でしか認証されず、社員を区別できない。`POST /api/kiosk/inquiries/:threadId/watch` で社員証 UID と「画面を見る」権限を確かめ、監査行を作り、問い合わせ送信元の端末をサーバー側で引いて押し通知する。スレッドの表示データに送信元端末の ID は出さない。
  Date/Author: 2026-10-19 / Claude

- Decision: 押し通知は既存の信号路 WebSocket に新しいメッセージ種別を足して流す。別の WebSocket は開かない。`invite` は使わない。
  Rationale: 端末ごとに 1 本しか持てないため、2 本目は通話を壊す。`invite` は通話の画面切替を起こす。既存のクライアントは知らない種別を無視するので、一部の端末だけ更新された状態でも壊れない。
  Date/Author: 2026-10-19 / Claude

- Decision: 「見せる」を押した処理の中で、待ち合わせを挟まずに `getDisplayMedia` を呼ぶ。
  Rationale: ユーザー操作の有効期間内に呼ぶため。

- Decision: 設定の保存 API は従来の `employeeCodes[]`(権限なし扱い)と新しい `employees[{ employeeCode, canViewScreen }]` の両方を受ける。
  Rationale: 保存は全件削除して作り直す方式なので、社員ごとの権限を同じ要求で送る必要がある。古い画面からの保存も壊さない。

- Decision: 両方の保存形式がある場合は `employees` を優先し、重複社員番号は最後の指定を採用する。
  Rationale: 明示的な `false` による権限解除と、空の `employees` による全員解除を維持する。
  Date/Author: 2026-10-19 / Codex

## Outcomes & Retrospective

2026-10-19 段階1のローカル実装: `canViewScreen` をDB・設定保存/取得・社員証認可・一覧/表示のトップレベル応答・管理画面へ追加した。送信端末とADMIN/MANAGERのJWT経由は `false`。スレッド表示データへの端末ID追加、画面を見る操作、映像は未実装。

- Prisma Client生成成功。Webの指定テストは9件成功、変更したAPI/WebのTypeScriptファイルのlintとWeb型チェックも成功。
- APIの指定統合テストは `localhost:5432` に接続できず、1ファイル失敗・45件skip。Docker APIも権限拒否のため、マイグレーション適用とDB経由の動作は未検証。
- APIの `tsc --noEmit -p .` は既存の `rootDir: src` とinclude対象の不整合でTS6059が5件。`tsc --noEmit -p tsconfig.build.json` は成功。
- 次の確認はテストDBにマイグレーションを適用し、指定のAPI統合テストを再実行すること。git操作・commit・push・本番反映は行っていない。

2026-10-19 段階2のローカル実装:

- `KioskScreenWatchSession` と手書きマイグレーションを追加し、Prisma Clientを生成。対象端末ごとのREQUESTED/ACTIVE排他は部分UNIQUEインデックスでも保証する。認可には段階1の `authorizeReceiver()` を使用し、要求応答は `watchId` のみ。
- 信号路は既存ソケット1本を共用。認証で得た `ClientDevice.id` を明示登録して端末へ配送する。現コードの `validateClient()` は `clientId = client.id` を返すが、その同一性には依存しない。
- `watch.request/accept/accepted/deny/denied/stop/stopped/fail` と、段階3/4向けの転送専用 `watch.signal/pointer` を追加。当事者と状態を検証し、状態遷移とSYSTEM記録は同一トランザクションで保存。期限用の時計・タイマーは注入可能。
- Webは同意カード、現場の札、閲覧側の待機/全画面仮置き、短い終了・エラー表示を追加。HTTP応答より早い同意通知や応答待ちの取消も処理する。`startCapture()` は即時解決の仮実装で、映像取得・PeerConnection・指さし操作は未実装。
- 検証: 指定のWebテスト187ファイル/1,537件成功(約33秒)。API状態遷移26件と信号路・既存通話の回帰4件成功(合計約1秒)。指定のAPI/Web型チェック、変更TS/TSXのESLint、Prisma Client生成成功。初回Webテストのキャプチャ失敗名と返信テストfixtureの不備は修正済み。
- 未検証: Postgresが必要なHTTP・永続化統合テスト9件、マイグレーションの実DB適用、ブラウザ上の見た目と実機。Dockerは起動していない。既存段階1のWIPを維持し、編集前スナップショットとの比較で今回の変更だけを確認。ユーザー指示によりGit操作は一切行っていない。commit/push/PR/merge/deployも未実施。

2026-10-19 段階3・4とAPIレビュー修正のローカル実装:

- API: プロセス内live map、stale行の終了、閲覧端末のオンライン確認を追加。登録済みセッションのsignal/pointer中継はDB・状態遷移キューを通さない。未登録IDは当事者の検証とstale回収のためDBで確認する。JSON payloadはUTF-8で64 KiBまでとし、pointerは閲覧側だけが0〜1の有限座標を送れる。
- 映像: 「見せる」の最初のawaitで指定どおりの`getDisplayMedia`を呼び、detailヒントを付ける。現場から5fps・1.5Mbpsのoffer、閲覧側からanswer、双方のICEをwatch信号で交換。既存通話のRTC設定だけを共通関数へ移し、通話のメッセージ型・挙動は変更していない。
- 閲覧側はmuted/autoplay/playsInlineのvideoへstreamを接続し、選択されたcandidate-pairのRTTを2秒ごとに秒で表示する。停止・拒否・信号切断・アンマウント時にpeerと全トラックを解放し、ブラウザでのキャプチャ停止とpeer失敗もwatch.stopへつなぐ。
- 指さし: contain余白を除く正規化、毎秒最大約10送信、ローカルの輪、現場の64px・4px赤枠・操作非遮断・2.5秒自動消去を実装。低減モーション設定ではpulseを止める。
- 検証: `pnpm --filter @raspi-system/web exec vitest run src/features/kiosk src/features/webrtc` は189ファイル/1,568件成功(33.45秒)。先行したscreen-watch対象テストも43件成功し、その後に非対応degradationPreferenceのテスト1件を追加して指定範囲で検証した。
- 検証: `apps/api`で`pnpm exec vitest run src/routes/__tests__/kiosk-screen-watch.test.ts src/routes/__tests__/kiosk-screen-watch-signaling.test.ts` は2ファイル/46件成功(0.47秒)。Webの`tsc --noEmit -p .`、APIの`tsc --noEmit -p tsconfig.build.json`、変更TS/TSXのESLintも成功。ローカル検証は既定20分の予算内。
- 未検証: PostgreSQLが必要なHTTP・永続化統合テストは12件へ更新したが、DB/Dockerを利用できないため実行していない。実際のブラウザ映像・見た目、Pi4の自己キャプチャ、LAN上の遅延/負荷とマイグレーション適用も未検証。
- 既存の段階1・2のWIPを引き継ぎ、編集前のファイルスナップショットとの差分で今回の変更を確認した。ユーザー指示によりgitコマンドは一切実行していない。commit/push/PR/merge/deployも未実施。

## Context and Orientation

- お問い合わせの API: `apps/api/src/routes/kiosk/inquiries.ts`。受信者の判定は `apps/api/src/services/kiosk-inquiry/kiosk-inquiry.service.ts` の `authorizeReceiver()`。受信者設定は `kiosk-inquiry-settings.service.ts` と `apps/api/src/routes/kiosk-settings.ts` の `/kiosk-settings/inquiry-receivers`(ADMIN/MANAGER)。
- DB: `apps/api/prisma/schema.prisma` の `KioskInquiryReceiverEmployee`、`KioskInquiryThread`、`KioskInquiryMessage`、`ClientDevice`。マイグレーションは `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`。
- 画面: `apps/web/src/features/kiosk/inquiry/`(`KioskInquiryInbox.tsx`、`KioskInquiryReceiverSettings.tsx`)、フローティングChatは `apps/web/src/components/hermes/HermesFloatingChat.tsx`。問い合わせの取得は `apps/web/src/api/hooks/kiosk.ts`(30 秒ごと)。
- 信号路: `apps/api/src/routes/webrtc/signaling.ts`(clientId → socket の Map)、型は `routes/webrtc/types.ts`。画面側は `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts`(知らない種別は `default` で無視)と `context/WebRTCCallContext.tsx`(全キオスクで有効)。
- スレッドの `senderClientDeviceId` は `ClientDevice.id`。信号路の Map の鍵は `clientId` で、別物。サーバーで `ClientDevice` 行から引き直す。
- キオスクの Chromium 引数: `infrastructure/ansible/roles/kiosk/defaults/main.yml`、起動: `infrastructure/ansible/templates/kiosk-launch.sh.j2`。`--use-fake-ui-for-media-stream` はすでに付いている。

## Plan of Work

段階1 は権限だけを端から端まで通す。`KioskInquiryReceiverEmployee` に `canViewScreen Boolean @default(false)` を足し、設定の取得で返し、保存で両方の形を受ける。`authorizeReceiver()` の結果に `canViewScreen` を含め、受信者向けのスレッド一覧・表示の応答に「この人は画面を見られるか」を載せる。管理画面の開ける人ごとに「画面を見る」チェックを付ける。

段階2 は流れを作る。新しいテーブル(例: `KioskScreenWatchSession`: id、threadId、viewerEmployeeId、viewerClientDeviceId、targetClientDeviceId、status、requestedAt、acceptedAt、endedAt、endReason)。HTTP で要求を作り、信号路で現場に `watch.request` を押す。現場からは `watch.accept` / `watch.deny`、両側から `watch.stop`。サーバーは送り主が監査行の当事者かを毎回確かめ、60 秒の同意期限と接続切れで終わらせ、スレッドに SYSTEM メッセージを残す。画面は現場の同意ダイアログと札、StoneBase の全画面の枠と左下の札(映像は仮置き)。

段階3 は映像。現場は「見せる」の中で `getDisplayMedia({ video: { frameRate: 5, displaySurface: "browser" }, selfBrowserSurface: "include", audio: false, preferCurrentTab: true })` を呼び、片方向の RTCPeerConnection を作る。offer/answer/ICE は watchId 付きで信号路を通す。失敗は短い表示で終える。

段階4 は指さし。StoneBase の映像上のタップを 0〜1 に正規化して `watch.pointer` で送り、現場は `pointer-events: none` の赤い輪を数秒出す。

## Validation and Acceptance

- API: `pnpm --filter api exec vitest run src/routes/__tests__/kiosk-inquiries.integration.test.ts`(と段階2以降の新しいテスト)が通る。
- Web: 変更したコンポーネントの colocated テストが `pnpm --filter web exec vitest run <files>` で通る。
- 実機(反映後): StoneBase で「画面を見る」→ 現場で「見せる」→ 全画面に映る → 指さしの輪が出る → どちらの「止める」でも終わる。

## Idempotence and Recovery

マイグレーションは列とテーブルの追加だけで、既存行は `canViewScreen = false` になる。戻すときは機能のボタンが出なくなるだけで、問い合わせ本体には影響しない。
