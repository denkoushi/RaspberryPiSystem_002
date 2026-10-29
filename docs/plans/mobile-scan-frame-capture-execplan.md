# Mobile scan frame capture and placement photos (PR A)


This living ExecPlan follows `.agent/PLANS.md`. Scope is local implementation and validation in the supplied worktree; commit, push, PR creation, migration application and deployment are not authorized.

## Purpose / Big Picture


配膳スマホが遅い・失敗したバーコード読取のフレームを保存し、Wi-Fi 接続時に送信する。「ここに置く」で同じ番号のスキャン写真を配置記録に付け、ADMIN が「配膳写真」で番号・棚・日付から閲覧できるようにする。OCR や読取調整は含めない。

## Progress


- [x] (2026-10-29) 指定ルールと既存のスキャナー・同期・認証・ファイル保存を調査。開始時 worktree に WIP なし。
- [x] (2026-10-29) 任意 prop の取り込み、別 DB の保存・上限・sampling、既存同期へ runner を追加。
- [x] (2026-10-29) Prisma モデル・追加 migration・サービス・端末 POST・ADMIN GET を追加。
- [x] (2026-10-29) 管理画面と必須テストを追加。API 24件、web 43件の新しいケースを含む。
- [x] (2026-10-29) Prisma生成、API/web型チェック、API対象テスト402件、web対象テスト492件、最終runner21件が成功。
- [x] (2026-10-29) web全体lintが成功。API変更ファイルlintも成功し、差分チェック・28ファイルの範囲・一時ファイル除去を確認。
- [ ] DB結合テスト・実機カメラ性能・承認モックとの目視比較は環境/資料未提供のため未検証。

## Surprises & Discoveries


ZXing の一次元バーコードでは result points の高さが 0 の場合があるため、切り抜きの余白は最低 16px にする。crop 座標は元映像の座標を保存し、縮小 canvas から切り抜く際に映像サイズで変換する。

既存 OrderPlacementEvent には番号・枝・placedAt があり、管理画面はそれらを写真に関連付けて表示できる。管理画面は承認済みモック(列: 置いた時刻、票、枝、棚、端末、写真。拡大は切り抜きと全体の2枚)に合わせる。

## Decision Log


- Decision: 端末 DB を `mobile-scan-frames-v1` / `frames` に分離する。
  Rationale: 既存 `mobile-local-data-v1` と `haizen-offline-queue` のスキーマ・更新経路を保護する。
  Date/Author: 2026-10-29 / Codex
- Decision: 同期は既存 Wi-Fi 限定 scheduler のジョブの最後へ `scan-frames` を登録する。
  Rationale: 第二の送信経路やタイマーを増やさず、配置記録の送信を先行させる。
  Date/Author: 2026-10-29 / Codex
- Decision: サーバーの写真は自動削除しない。
  Rationale: ADR-20260731 と依頼に従う。依頼時の容量見積りは約 685GB 空き、1 日数 MB。閲覧は ADMIN に限り、既存 durable store の空き容量下限で受け取りを 507 として停止する。端末側の 300 件 / 60MB 制限は別である。
  Date/Author: 2026-10-29 / Codex
- Decision: サーバーの写真は新しい名前空間を作らず、既存の `photos` ボリュームの `photos/mobile-scan-frames/YYYY/MM/` に置く。
  Rationale: 名前空間ごとに Pi5 の専用ボリューム(compose、Dockerfile、Ansible の storage contract、DR 方針)が要り、名前空間だけ足すと起動時の初期化で API が止まった(CI の container-runtime-rehearsal)。`photos` は既にバックアップと DR の対象で、貸出写真の年次削除は `photos/YYYY/01` だけを見るためこの配下に触れない。
  Date/Author: 2026-10-29 / Claude
- Decision: 切り抜きだけでなく全体フレームを残す。
  Rationale: 暗さ・ぶれ・反射・距離と背景の後続分析に必要。元映像は長辺 1280px に縮小し JPEG 品質 0.7、crop は長辺 640px 以下。
  Date/Author: 2026-10-29 / Codex

- Decision: timeout フレームは作成後30秒以内を保留し、猶予後の既存 scheduler の実行で送信する。
  Rationale: 保存直後に送信・削除されると、直後の手入力を追記できない。保存は即座に idle へ回し、送信 runner で作成後30秒以内を保留する。保留中は hasPendingWork に数えず、新しいタイマー・同期経路は追加しない。この猶予を超えて送信済みになった写真へ、後から手入力を追記することは本APIの対象外。
  Date/Author: 2026-10-29 / Codex

## Outcomes & Retrospective


ローカル実装は完了。402件のAPIテストと492件のwebテストが成功し、その後のtimeout送信猶予の変更はrunner21件で確認した（web固有ケースは合計493件）。Prisma生成と両アプリの型チェックが成功。DB結合テストはローカル5432番への接続が実行環境に拒否されたため未実行。実機性能、承認モックの目視照合、migration適用、commit/push/PR/merge/deployは未実施。開始時WIPはなく、このworktree内の変更は本依頼のもの。

## Context and Orientation


`apps/web/src/features/barcode-scan/useBarcodeScanSession.ts` は共通読取処理で、`onFrameCaptured` がある場合だけ開始時のカメラ設定・能力の取得と再試行数の計測を行う。成功または時間切れ時に停止前の video を canvas へ一度描く。prop を渡すのは `features/mobile-placement/haizen/HaizenHub.tsx` だけである。

`features/mobile-placement/scan-frames/` は保存と送信を担う。sample は timeout、1500ms 以上、再試行15回以上なら必ず、それ以外は10%。超過時は scan-frame を先に古い順で消す。写真の JPEG 化と DB 書込は requestIdleCallback（timeout: 2000）、無ければ setTimeout(0) で行う。配置写真の clientRecordId は配置送信と共通で、票の欄ごとに保持した capture と番号が一致する場合だけ保存する。timeout 後の同じ入力欄の手入力は manualValue を同じレコードへ追加する。

`apps/api/src/services/mobile-placement/mobile-scan-frame.service.ts` は JSON の検証、JPEG のマジックバイト・サイズ検証、durable file store への integrity 付き保存、DB 関連付けを担当する。server UUID ごとのキーを使い、DB 保存に失敗した自分の未確定ファイルだけ回収する。履歴の期限削除はしない。

## Plan of Work


Milestone 1 は optional capture と端末保存である。無効時には canvas、設定取得、カウントが増えないこと、停止前に一回だけ drawImage することをテストする。

Milestone 2 は送信・保存・閲覧 API である。既存キューを読むだけで写真送信を待機し、1回20件・JSON実送信量2MBに制限する（先頭1件だけは2MB超過も送って後続の停止を防ぐ）。この runner の通信 timeout は30秒である。2xx/409は削除、400/413/422は警告して削除、507/5xx/通信失敗は保持する。APIは1.5MB bodyLimit、full 600KB、crop 300KBを上限とし、ADMINのみ閲覧できる。

Milestone 3 は管理画面と検証である。`/admin/placement-photos` に slate の表と認証付き blob 画像、拡大表示を追加する。番号・棚・東京日付を300msデバウンスで絞り込み、既定50件・最大100件を返す。一覧は長辺160pxのJPEGサムネイル（都度生成・保存なし・privateで86400秒キャッシュ）、拡大時だけ原寸を取得する。

## Concrete Steps


作業ディレクトリは supplied worktree root。依存関係は既存の React、idb、Axios、Fastify、Zod、Prisma を使う。次を順に実行する。

    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json
    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/api test mobile-placement file-storage
    pnpm --filter @raspi-system/web exec tsc --noEmit
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web test barcode-scan mobile-placement

秘密情報を読まないため API テストでは dotenv を無効化した一時設定を使う。DB が必要な既存テストを実行できない場合は独立して報告する。検証予算は DB 変更の既定45分で、関連修正後の再実行は1回までとする。

## Validation and Acceptance


上限と優先削除順、sample 境界、送信応答と記録待機、共通 hook の無効時・停止順を確認する。POST の成功・冪等409・不正JPEG400・サイズ413・履歴との関連付け、ADMIN以外の403を検証する。管理画面で「配膳写真」、3条件、6列、72×48の2サムネイル、拡大画像が表示されることを確認する。追加説明文は入れない。

## Idempotence and Recovery


migration は `20261029120000_mobile_scan_frames` の追加のみで、既存テーブルへは関連付け以外の変更をしない。適用は未実施。端末 id を clientFrameId として一意にし、再送は409で終了できる。保存失敗や容量不足は配置と読取を阻害しない。git の変更操作や既存WIPの消去を行わない。

## Artifacts and Notes


指定の `pnpm --filter @raspi-system/api prisma generate` は prisma script が無いため失敗し、`exec prisma generate` で成功（Prisma 7.10.1）。API型チェックは `tsconfig.build.json` で成功。API全体lintで追加コードの未使用変数を修正した後、一時テストconfigだけがtsconfig対象外として失敗した。その一時ファイルを除去し、変更したAPIの5つのTypeScriptファイルをeslintで再確認して成功した。

APIはdotenvをmockする一時setupと元設定をmergeした一時configを使用し、次を実行した。DB依存の1ファイルを除く30ファイル402件が10.12秒で成功。新しいAPIルートテストは24件。

    pnpm --filter @raspi-system/api exec vitest run --config vitest.scan-frames-local.config.ts mobile-placement file-storage --exclude '**/mobile-placement.integration.test.ts'

webは元Vite設定に空ディレクトリのenvDirを指定する一時configを使い、62ファイル492件が19.48秒で成功。timeoutの送信猶予を追加後、変更されたrunnerだけ再実行し21件が0.61秒で成功した。追加後の固有ケース数は493件（前回のrunner20件と重複）。一時設定はすべて除去する。

    pnpm --filter @raspi-system/web exec vitest run --config vitest.scan-frames-local.config.ts barcode-scan mobile-placement PlacementPhotosPage
    pnpm --filter @raspi-system/web exec vitest run --config vitest.scan-frames-local.config.ts src/features/mobile-placement/scan-frames/scanFrameUploadRunner.test.ts

web全体lintは追加importの順序13件を修正後の1回の再実行で成功した。API最終型チェック、変更5ファイルのeslint、web型チェック、`git diff --check` も成功。

変更のない依存データ `baseline-browser-mapping` の古さについて警告が出たが、本依頼の範囲外なので更新していない。

## Interfaces and Dependencies


`ScanFrameCapture` は outcome、decodedValue、decodeMs、retryCount、engine、camera、torchOn、zoom、cropBox、capturedAt、fullCanvas を持つ。camera に元映像の videoWidth/videoHeight も含め、crop 変換に使う。`MobileScanFrame` は `mobile_scan_frames` に対応し、端末・配置履歴への外部キーを持つ。配置履歴削除時の関連は SetNull。

## 次の段階


棚候補 AI は端末の小さなモデルで上位3つの棚を出し、1タップで確定する案。作る前に、サーバー側で「上位3つに正解の棚が入る割合」を、`MobileScanFrame` の `placement_photo`（写真と正解の棚の組）と既存 `MobilePlacementShelfPhoto`（見本）で測る。今回は作らない。

分析と調整（自動ライト、少しのズーム、フォーカス、デコーダ設定）は次の PR で行い、scan-bench で前後を測る。背景から棚を推定する案と票の傷みの統計は保留する。

Revision 2026-10-29: 依頼の設計と確認済みの既存境界に基づく初版。実装・検証の進捗で更新する。

Revision 2026-10-29: 端末/API/管理画面の実装と対象テストの結果を反映。timeout直後の手入力を取り込むため、既存同期の30秒の猶予を記録。

Revision 2026-10-29: web全体lint成功と最終差分確認を反映。未検証のDB/実機/モック照合と、未承認の統合・配備段階を明示。


Revision 2026-10-29 (PR A review): 8件のレビュー指摘を修正。票の欄ごとのcapture保持、同じ欄の再読取/手入力による無効化、取り消し済み配置の422、runner専用30秒timeout、送信可能レコードだけのpending判定、先頭の2MB超過送信、payload失敗時の警告・端末レコード削除、カメラ取得後からのdecodeMs計測、thumb/デバウンス/既定50件、idle期限、nullのaria-labelを反映した。照合タブで棚QRを読んでも照合側の棚へ反映されない既存の動き(useHaizenWorkflow)は、照合の担当範囲のため今回は変えず、別件として報告する。照合タブのテストは棚の候補を押して確定する流れで確かめる。

今回の追加修正で変更したファイル（開始時の既存WIPを引き継ぎ、下記以外の既存変更を保持）:

- API: `src/services/mobile-placement/mobile-scan-frame.service.ts`, `src/routes/mobile-placement/scan-frames.ts`, `src/routes/__tests__/mobile-placement-scan-frames.test.ts`
- web: `src/features/mobile-placement/haizen/{HaizenHub.tsx,HaizenHub.test.tsx}`
- web: `src/features/barcode-scan/{useBarcodeScanSession.ts,__tests__/useBarcodeScanSession.test.tsx}`
- web: `src/features/mobile-placement/scan-frames/{scanFrameStore.ts,scanFrameUploadRunner.ts,scanFrameUploadRunner.test.ts,saveScanFrame.ts,saveScanFrame.test.ts}`
- web: `src/api/domains/placement-photos.ts`, `src/pages/admin/{PlacementPhotosPage.tsx,PlacementPhotosPage.test.tsx}`
- 正本: このPlan

今回の検証では、dotenvを無効化した一時setup/configと空のenvDirを使用し、終了後に除去した。成功済みの対象テストは後続の対象スイートから除外して重複実行を避けた。

- API対象テスト: `vitest run --config vitest.scan-review.config.ts mobile-placement-scan-frames.test` — 27件成功（0.69秒）。
- web変更対象: `vitest run --config vitest.scan-review.config.ts HaizenHub.test useBarcodeScanSession.test scanFrameUploadRunner.test saveScanFrame.test PlacementPhotosPage.test` — 103件成功（3.78秒）。
- API既存: `vitest run --config vitest.scan-review.config.ts mobile-placement file-storage --exclude '**/mobile-placement-scan-frames.test.ts'` — 378件成功、DB結合56件失敗（34.51秒）。全失敗は `mobile-placement.integration.test.ts:70` のbeforeEachのDB操作で発生し、接続がEPERMで拒否された。今回の変更APIには到達しておらず、前回記録済みのDB接続制約と一致する。無関係な実装変更や再試行はしない。
- web既存: `vitest run --config vitest.scan-review.config.ts barcode-scan mobile-placement` に上記成功済み4ファイルの `--exclude` を指定 — 401件成功（15.15秒）。
- API型チェック: `pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json` — 成功。
- web型チェック: `pnpm --filter @raspi-system/web exec tsc --noEmit` — 成功。

ユニークな対象テストはAPI405件・web504件が成功（新規追加はAPI3件・web11件）。DB結合56件の成功と実機での読取性能は未確認。保存済みサーバー写真の自動削除や新しい同期経路は追加していない。commit/stash/reset/checkout/push/PR/merge/deployは未実施。

API全体lintの初回は、実行中に一時テストsetupを除去したためENOENTとなった。ソースのlint違反ではなく検証手順の競合であり、一時ファイル除去後の状態で1回だけ再実行し、成功した。

最終確認: `pnpm --filter @raspi-system/api lint` と `pnpm --filter @raspi-system/web lint` は全体で成功。型チェック・テスト・lintを含む検証は約10分以内。`git diff --check` が成功し、worktreeの既存WIPと今回17ファイルの変更、一時設定の除去を確認した。前回から存在するPrisma/migration、同期provider、ナビゲーション等の変更は保持した。
