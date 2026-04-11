---
title: トラブルシューティングナレッジベース - 索引
tags: [トラブルシューティング, ナレッジベース, 索引]
audience: [開発者, 運用者]
last-verified: 2026-04-11
related: [api.md, database.md, ci-cd.md, frontend.md, infrastructure.md]
category: knowledge-base
update-frequency: high
---

# トラブルシューティングナレッジベース - 索引

このドキュメントは、トラブルシューティングナレッジの索引です。各課題はカテゴリ別に分割されたファイルに記録されています。

**EXEC_PLAN.mdとの連携**: 各課題はEXEC_PLAN.mdの「課題」セクションまたは「Surprises & Discoveries」セクションと対応しています。課題ID（KB-XXX）で参照してください。

---

## 📁 カテゴリ別ファイル

| カテゴリ | ファイル | 件数 | 説明 |
|---------|---------|------|------|
| キオスク貸出（調査報告） | [kb-kiosk-rigging-return-cancel-investigation.md](./kb-kiosk-rigging-return-cancel-investigation.md) | 1件 | 吊具持出し・返却の仕様と「使用中」判定／取消混在調査／**`Loan.clientId` 手動補正 API**（`PUT /api/tools/loans/:id/client`）・本番デプロイ・Phase12 検証・TS（2026-03-25 追記） |
| キオスクIME・電源（電源はSOLIDリファクタ完了・遅延原因特定・連打防止オーバーレイ実装完了） | [KB-investigation-kiosk-ime-and-power-regression.md](./KB-investigation-kiosk-ime-and-power-regression.md), [KB-288-power-actions-bind-mount-deleted-inode.md](./KB-288-power-actions-bind-mount-deleted-inode.md), [KB-investigation-kiosk-schedule-regression-20260301.md](./KB-investigation-kiosk-schedule-regression-20260301.md), [ansible-deployment.md#KB-285](./infrastructure/ansible-deployment.md#kb-285-電源操作再起動シャットダウンのボタン押下から発動まで約20秒かかる), [frontend.md#KB-286](./frontend.md#kb-286-電源操作の連打防止オーバーレイ実装react-portal-による表示失敗の解決), [frontend.md#KB-287](./frontend.md#kb-287-キオスク備考欄の日本語入力不具合ibus-ui-ウィンドウ出現で入力不安定) | 6件 | 備考欄の日本語入力: **KB-287 解決済み**（IBus 単一オーナー化で im-launch 競合を抑止）。電源ボタン: **SOLIDリファクタ完了**。電源操作遅延: **原因特定**。**連打防止オーバーレイ**: 実装完了（KB-286）。**電源・連打防止不具合**: KB-288 で根本原因特定済み。恒久対策（notify: restart api）実装済み（2026-03-01）。**IME は Firefox で正常動作**。 |
| API関連 | [api.md](./api.md) | 62件 | APIエラー、レート制限、認証、履歴、サイネージ、キオスクサポート、温度表示、環境変数バリデーション、WebRTCシグナリング、WebRTC通話IDの統一、CSVインポートエラーハンドリング、CSVインポートスケジュール間隔設定、FSEIBANバリデーション修正、生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側）、生産スケジュールAPI拡張（資源CDフィルタ・加工順序割当・検索状態同期・AND検索・工程カテゴリフィルタ）、生産スケジュール検索状態の全キオスク間共有化、生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正、生産スケジュール検索登録製番の削除・追加が巻き戻る競合問題（CAS導入）、Gmail認証切れ時のSlack通知機能追加、Gmail認証切れの実機調査と回復、生産スケジュール登録製番上限の拡張（8件→20件）とサイネージアイテム高さの最適化、history-progressエンドポイント追加と製番進捗集計サービス、Gmailゴミ箱自動削除機能（深夜バッチ）、生産スケジュール資源CDボタン表示の遅延問題（式インデックス追加による高速化）、未点検加工機サイネージ可視化データソースの追加、`kiosk`/`clients` ルート分割とサービス層抽出、加工機点検状況サイネージの集計一致と2列表示最適化（未点検は終端）、`backup`/`imports`ルート分割とサービス層移設、コード品質改善フェーズ2（Ratchet）〜フェーズ4第五弾（5本実装）、加工機点検状況サイネージのカードレイアウト変更と背景色改善、Gmail APIレート制限エラー（429）の対処方法、生産スケジュールprogress別テーブル化（CSV取り込み時の上書きリスク回避）、生産スケジュールデータ削除ルール（重複loser即時削除・1年超過は保存しない）、Gmail csvDashboards取得を10分30件運用へ最適化、CSVダッシュボード重複削除共通化とエラーメール廃棄ポリシー統一、生産スケジュールhistory-progressエンドポイントにmachineName追加、生産スケジュールhistory-progressエンドポイントのmachineName取得にSH追加、**実績工数CSV手動投入で413 Payload Too Large（KB-301）** |
| API関連（Gmail 429調査） | [KB-217-gmail-api-429-early-retry.md](./KB-217-gmail-api-429-early-retry.md) | 1件 | Gmail API 429エラー - クールダウン解除直後の再発 |
| 生産スケジュール納期管理 | [KB-297-kiosk-due-management-workflow.md](./KB-297-kiosk-due-management-workflow.md) | 1件 | 製番納期・部品優先・トリアージ・日次計画・全体ランキング（B3）、手動順番 device-scope v2（Mac 登録端末の代理・Pi4 範囲・Phase12 `siteKey` 検証）、**手動順番と全体ランキングの `siteKey` 正本同期（2026-03-23）**、**生産スケジュール 登録製番・資源CDドロップダウン Portal 配置（overflow クリップ解消・CI TS2322 知見・2026-03-23）**、**手動順番上ペイン 端末カード2行ヘッダー・全体把握行ホバー格納（2026-03-23）**、**進捗一覧 納期列コンパクト・重なり防止オプションA（MM/DD_曜・PR #33/#35・2026-03-23）**、**手動順番 工順 FKOJUN のみ（PR #33・2026-03-23）**、**手動順番専用ページ**（`/kiosk/production-schedule/manual-order`・**`manual-order-overview` の `resources[].rows[]`（行明細）**・**上ペイン資源CD割り当て**（`manual-order-resource-assignments`・DB `ProductionScheduleManualOrderResourceAssignment`・モーダル「資源」）・上ペイン **SOLID リファクタ**（`manualOrderRowPresentation` 等）・**overview UI**（`useKioskTopEdgeHeaderReveal`・カードヘッダー編集中・`md:grid-cols-4`/`xl:grid-cols-6`・2026-03-21）・**下ペイン鉛筆・工場変更時フィルタリセット**（`manualOrderLowerPaneSearch`・鉛筆時は登録製番チップ `activeQueries` を維持・`mergeManualOrderPencilPreservedSearchFields`・`hasResourceCategoryResourceSelection`）・**下ペイン帯**（`ManualOrderLowerPaneCollapsibleToolbar`・右端ホバー展開・開閉と `hasScheduleFilterQuery` 分離）・**通常生産スケジュール本体の検索・資源フィルタ帯**（`ProductionSchedulePage`・同コンポーネント再利用・Playwright API `NODE_ENV=development` 知見・2026-03-21）・**進捗一覧 5列・ラベル削除**（`progressOverviewPresentation`・**main** で Pi5+Pi4×2 順次デプロイ・Phase12 PASS 27/1/0・`verify-phase12-real.sh` の ICMP 再試行）・**沉浸式 allowlist 拡張・手動順番行（品名を工順直後・2026-03-21）**（[KB-311](./KB-311-kiosk-immersive-header-allowlist.md) 連携）・**リーダー順位ボード**（`/kiosk/production-schedule/leader-order-board`・納期表示整列・既存 order API 2段反映・`leaderOrderBoard`・2026-04-01 本番5台順次・Phase12 PASS 40・**2026-04-02: 子行製番優先レイアウト・左ホーバー登録製番の縦余白活用**）・デプロイ/実機検証・**登録製番履歴は search-state＋共有キーで通常画面と整合**）、Location Scope Phase0-12（命名規約・Runbook自動化・横展開監査）を含む運用フロー |
| キオスク沉浸式ヘッダー allowlist | [KB-311-kiosk-immersive-header-allowlist.md](./KB-311-kiosk-immersive-header-allowlist.md) | 1件 | `usesKioskImmersiveLayout`・上端リビール対象 URL の単一情報源（拡張時はポリシー＋Vitest）・デプロイ/実機検証/Troubleshooting（2026-03-21 追記） |
| キオスク部品測定記録 | [KB-320-kiosk-part-measurement.md](./KB-320-kiosk-part-measurement.md) | 複数節 | `/kiosk/part-measurement`（子パス含む沉浸式・**ハブ「測定値入力中」3列一覧**）・**テンプレ候補選択** `/template/pick`（[ADR-20260404](../decisions/ADR-20260404-part-measurement-template-pick-kiosk.md)・**`FHINMEI_ONLY` は正規化後 `includes` 部分一致**）・**複数記録表（`PartMeasurementSession`・編集画面上部カード・別テンプレ追加・CSV `sessionId`）**・**管理** `/admin/tools/part-measurement-templates`（**`POST …/templates/:id/revise`** 版上げ・**`FHINMEI_ONLY` のみ `candidateFhinmei` 編集**・**`POST …/templates/:id/retire`** 論理削除）・`part-measurement` API（`templates/candidates`・`clone-for-schedule-key`・レガシー `allowAlternateResourceTemplate`）・`resourceCd` キー（[ADR-20260401](../decisions/ADR-20260401-part-measurement-phase2-resource-cd.md)）・**visual template / 図面**（[ADR-20260330](../decisions/ADR-20260330-part-measurement-visual-template.md)）・Phase12 自動検証（`verify-phase12-real.sh`）・テンプレ未一致・候補複数・工程 `cutting`/`grinding`（[ADR-20260329](../decisions/ADR-20260329-part-measurement-kiosk-record.md)） |
| キオスク要領書（PDF） | [KB-313-kiosk-documents.md](./KB-313-kiosk-documents.md) | 1件 | `/kiosk/documents`・手動/Gmail 取り込み・OCR・**フリーワードは ILIKE 部分一致**（[ADR-20260326](../decisions/ADR-20260326-kiosk-document-free-text-substring-search.md)）・**詳細クエリキャッシュ共有**（[ADR-20260327](../decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md)）・**バーコードスキャン検索**（`@zxing/library`・[ADR-20260329](../decisions/ADR-20260329-kiosk-document-barcode-scan-zxing.md)・一次元 preset・セッション時のみカメラ）/候補+確定メタ編集・**文書番号・要約候補3・確定要約**（`20260327120000_add_kiosk_document_number_summary`・確定は自動非更新）・`kioskDocumentGmailIngest`・`KIOSK_DOCUMENT_*`・ビューア UI（`ghostOnDark`・**一覧/幅モードアイコン**・**検索時 `extractedText` 抜粋**・**イマーシブ時ツールバー折りたたみ（`HoverRevealCollapsibleToolbar`・`useTimedHoverReveal`）**・**一覧要約 `title` 全文**・近傍 lazy・**一覧プリフェッチ（pointer のみ・2026-03-27）** / IO rAF / `pdf-pages` ETag・Cache-Control）・左一覧の文書番号/要約表示・文書切替時スクロール/インデックスリセット・ページ画像表示・Phase12 実機検証（**PASS 30/0/0** または Pi3 未到達時 **PASS 29/1/0** 例・2026-03-27）・`ndlocr-lite` ONNX WARN の切り分け |
| 吊具マスタ idNum（旧番号） | [KB-312-rigging-idnum-deploy-verification.md](./KB-312-rigging-idnum-deploy-verification.md) | 1件 | `RiggingGear.idNum`（NULL 可・UNIQUE）・管理UI/キオスク吊具持出/CSV・Pi5+raspberrypi4 デプロイ済・`raspi4-robodrill01` は別日再挑戦（SSH timeout） |
| 持出一覧・サイネージ表記 | [KB-314-kiosk-loan-card-display-labels.md](./KB-314-kiosk-loan-card-display-labels.md) | 1件 | 写真持出 **撮影mode**・端末場所ラベル削除・`PHOTO_LOAN_CARD_PRIMARY_LABEL`・順次デプロイ（Pi5→Pi4×2→`server:signage`）・実機検証（2026-03-26） |
| キオスク持出一覧カード（モダン面・shared-types） | [KB-332-kiosk-active-loan-card-modern-surface.md](./KB-332-kiosk-active-loan-card-modern-surface.md) | 1件 | サイネージ loan chrome 系トークン・Pi5→Pi4×4 順次（Pi3 除外）・Pi5 hop systemd・多段 ssh の TS（2026-04-06） |
| サイネージ compact フッタ／キオスク取消視認性 | [KB-333-signage-compact24-footer-kiosk-cancel-readability.md](./KB-333-signage-compact24-footer-kiosk-cancel-readability.md) | 1件 | `splitCompact24` 高さ164+HTML pad10・`ghostOnDark` 取消・Pi5→Pi4×4→Pi3 順次・Phase12 PASS 43・未追跡ファイルと deploy プリフライト（2026-04-07） |
| キオスク「集計」: DADS・吊具・写真 VLM `loan-analytics` | [KB-334-kiosk-rigging-loan-analytics-deploy.md](./KB-334-kiosk-rigging-loan-analytics-deploy.md) | 1件 | **写真持出は VLM/人レビュー表示名集計**（`3a722c8d`）・Pi5 Detach **`20260409-222053-14442`**・Phase12 **43/0/0**；DADS 初回 **`20260409-213409-15007`**；初回吊具 2026-04-07 Pi5→Pi4×4 |
| 配膳スマホ V1/V2/V3（バーコード・照合・配置登録） | [KB-339-mobile-placement-barcode-survey.md](./KB-339-mobile-placement-barcode-survey.md) | 1件 | V7（実装・未デプロイ）: 現品票 OCR 用途別パイプライン・`ocrPreviewSafe`・V6: 現品票 OCR UI/観測ログ/パーサ・V3: `/kiosk/mobile-placement/shelf-register` 棚番3段階・V2: 移動票/現品票照合・現品票画像OCR・FSEIBAN解決・`OrderPlacementEvent`・V1: `Item`・`MobilePlacementEvent`・[Runbook](../runbooks/mobile-placement-smartphone.md)・[API](../api/mobile-placement.md)（2026-04-11） |
| API OCR/VLM 境界整理（リファクタ・本番検証） | [KB-340-api-ocr-vlm-boundary-refactor-deploy.md](./KB-340-api-ocr-vlm-boundary-refactor-deploy.md) | 1件 | `services/ocr`・`inference/ports/vision-completion.port.ts`・`RoutedVisionCompletionAdapter` の `useCase`・kiosk 互換再エクスポート・**Pi5→Pi4×4→Pi3 順次**・Phase12 **43/0/0**・Detach Run ID 列挙（2026-04-11） |
| キオスク持出一覧カードレイアウト | [KB-323-kiosk-return-card-button-layout.md](./KB-323-kiosk-return-card-button-layout.md) | 1件 | 返却・取消をカード**下段**へ・`KioskActiveLoanCard` 分離・画像モーダル Blob `revoke`・検証・デプロイ参照（2026-04-01） |
| Gmail・生産日程（部品納期個数補助同期） | [KB-324-gmail-order-supplement-prisma-transaction.md](./KB-324-gmail-order-supplement-prisma-transaction.md), [KB-326-manual-upload-order-supplement-sync.md](./KB-326-manual-upload-order-supplement-sync.md), [KB-328-production-schedule-supplement-key-mismatch-investigation.md](./KB-328-production-schedule-supplement-key-mismatch-investigation.md) | 3件 | KB-324: Prisma tx・KB-326: 手動 upload 後の補助同期。**KB-328（2026-04-04）: 本体winnerと補助3キーのずれ・上流工程変更・FHINCD失敗・管理UI二重ファイル入力・判断候補の記録** |
| 写真持出 VLM ラベル | [KB-319-photo-loan-vlm-tool-label.md](./KB-319-photo-loan-vlm-tool-label.md) | 1件 | VLM 初版 + **フェーズ1** + **類似候補ギャラリー（pgvector）** + **管理コンソール `photo-gallery-seed`（手動教師・2026-04-01）** + **シャドー補助（条件付き GOOD 類似・`PHOTO_TOOL_LABEL_ASSIST_*`）** + **アクティブ保存ゲート（ギャラリー行数・Pi5のみデプロイ・Phase12 PASS 40・2026-04-02）** + **Ansible: `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_*` の inventory 配線（vault→docker `.env`・2026-04-07・Phase12 PASS 43）** + **2026-04-09: 本番 active ON（候補良好でも active OFF では直採用されない実測・vault/.env・API force-recreate）** + **VLM ラベル出自（`photoToolVlmLabelProvenance`・管理レビュー API/UI・Phase12 PASS 41・2026-04-03）** + **埋め込み Ansible 配線・GOOD バックフィル・シャドー観測** + **2026-03-30: 人レビュー／GOOD ギャラリー運用・類似候補 vs シャドー閾値**（[photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md)）・**オンデマンド llama-server / ComfyUI VRAM / 本番有効化と 38081 共有制御の実測トラブルシュート**（[ADR-20260403](../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md)・[local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)）・[ADR-20260330](../decisions/ADR-20260330-photo-tool-similarity-gallery-pgvector.md) / [ADR-20260331](../decisions/ADR-20260331-photo-tool-label-good-assist-shadow.md) / [ADR-20260404](../decisions/ADR-20260404-photo-tool-label-assist-active-gate.md) |
| フロントエンド関連 | [frontend.md](./frontend.md) | 58件 | キオスク接続、XState、UI、カメラ連携、サイネージ、NFCスコープ分離、CSVインポートUI統一、スケジュール表示改善（分のリスト形式対応）、WebRTC通話、通話IDの表示統一、バックアップ履歴用途列追加、WebRTCビデオ通話機能のclientKey/clientId未設定問題、サイネージプレビュー機能、CSVインポートスケジュール実行ボタンの競合防止、生産スケジュール画面のパフォーマンス最適化と検索機能改善（フロントエンド側）、生産スケジュールUI改善（チェック配色/OR検索/ソフトキーボード）、生産スケジュールUI改良（資源CDフィルタ・加工順序割当・検索状態同期・AND検索）、生産スケジュール備考のモーダル編集化と処理列追加、キオスク入力フィールド保護ルールの実装と実機検証、キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決（React Portal導入）、モーダル共通化・アクセシビリティ標準化・E2Eテスト安定化、WebRTCビデオ通話の常時接続と着信自動切り替え機能、生産スケジュール登録製番削除ボタンの進捗連動UI改善、Pi4キオスクの備考欄に日本語入力状態インジケーターを追加、生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化、カメラ明るさ閾値チェックの削除（雨天・照明なし環境での撮影対応）、未点検加工機サイネージ設定導線の実装、吊具持出画面に吊具情報表示を追加、Pi4キオスクの日本語入力モード切替問題とIBus設定改善、生産スケジュール登録製番ボタンの3段表示と機種名表示（全角半角大文字化）、生産スケジュール検索条件の端末別localStorage保存、生産スケジュールアイテム一覧からMHアイテムを除外、電源操作の連打防止オーバーレイ実装（React Portalによる表示失敗の解決）、生産スケジュール資源CDボタン優先並び（KB-294）、登録製番ボタン並び替えUI（KB-295）、進捗一覧製番フィルタ（KB-306）、生産スケジュールUI統一（登録製番・資源CDドロップダウン併設、KB-307）、生産スケジュールUIが古いのに戻った事象（ブランチ分岐、KB-308） |
| データベース関連 | [database.md](./database.md) | 3件 | P2002エラー、削除機能、シードデータ |
| CI/CD関連 | [ci-cd.md](./ci-cd.md) | 14件 | CIテスト失敗、E2Eテスト、バックアップ/リストア、依存監査（pnpm audit）、test-excludeとminimatchの非互換エラー、Trivy脆弱性スキャンでminimatchのCVE-2026-27903/27904が検出される、ユニットテストでPrismaモデル未モック（KB-298）、Prisma JSONカラムへのRecord/null代入でCIビルド失敗（KB-299）、location-scope-resolverブランド型CIビルド失敗・verify-phase12 ping失敗（KB-302）、Caddy依存CVEsでTrivy image web失敗（KB-307）、trivy-action タグ参照解決失敗（KB-310） |
| インフラ関連 | [infrastructure.md](./infrastructure.md) | 77件（サブカテゴリ別に分割） | Docker、Caddy、HTTPS設定、オフライン耐性、バックアップ、Ansible、NFCリーダー、Tailscale、IPアドレス管理、ファイアウォール、マルウェア対策、監視、サイネージSVGレンダラー、Dropbox OAuth 2.0、CI必須化、SSH接続、DropboxリストアUI改善、デプロイ標準手順、APIエンドポイントHTTPS化、サイネージ温度表示、WebSocketプロキシ、Slack通知チャンネル分離、Pi4デプロイ時のメンテナンス画面表示、デプロイ検証強化（DBゲート追加・fail-fast化）、デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能、Tailscale経由でのVNC接続問題（ACL設定不足）、クライアント端末管理の重複登録（inventory未解決テンプレキー混入）、Pi4追加時のkiosk-browser.service起動エラー（chromium-browserコマンド未検出）、Pi4 kiosk-browser対策のAnsible恒久化と実機デプロイ検証（到達不可端末の切り分け含む）、Ubuntu LocalLLM の Tailscale sidecar 分離公開（KB-317） |
| ├─ Docker/Caddy関連 | [infrastructure/docker-caddy.md](./infrastructure/docker-caddy.md) | 9件 | Docker ComposeとCaddyリバースプロキシ、WebSocketプロキシ設定 |
| ├─ バックアップ・リストア関連 | [infrastructure/backup-restore.md](./infrastructure/backup-restore.md) | 32件 | バックアップとリストア機能、Gmail連携、client-directory追加、Gmail/Dropboxトークン分離、provider別名前空間化、衝突・ドリフト検出の自動化、**推奨対象カタログと `coverage_gap` 健全性警告（[KB-338](./infrastructure/backup-restore.md#kb-338-backup-recommended-catalog-coverage-gap)）**、Dropbox basePath分離、git clean削除問題、backup.json復元方法、Gmail OAuth設定復元、旧キーと新構造の衝突解決、Dropbox証明書ピニング問題、バックアップ対象の追加、UI表示問題の修正、Dropbox 409 Conflictエラー（labelサニタイズ未実施によるパス不正）、旧キー自動削除機能の実装（backup.json保存時の自動クリーンアップ）、Dropbox選択削除（purge-selective）のパス正規化不整合、retention.maxBackupsがdays無しで効かない（仕様/実装差）、証明書ディレクトリのバックアップターゲット追加スクリプト作成とDockerコンテナ内実行時の注意点 |
| ├─ Ansible/デプロイ関連 | [infrastructure/ansible-deployment.md](./infrastructure/ansible-deployment.md) | 48件 | Ansibleとデプロイメント、APIエンドポイントHTTPS化、環境変数管理、Dropbox設定管理、backup.json保護、Gmail設定健全性チェック、status-agent.timer無効化、マルチサイト対応、inventory引数必須化、inventory/playbookパス相対パス修正、デプロイ安定化機能、Alerts Platform Phase2のDB取り込み実装と空ファイル処理の改善、Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了、Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了、Slack通知チャンネル分離デプロイトラブルシューティング、Pi4デプロイ検証結果、Pi4デプロイ時のメンテナンス画面表示機能、デプロイ検証強化（DBゲート追加・fail-fast化）、デプロイ標準手順のタイムアウト・コンテナ未起動問題の調査と改善実装（down後回し、中断時復旧、ログ永続化）、デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能、Pi3デプロイ時のpost_tasksでunreachable=1が発生するがサービスは正常動作している、デプロイプロセスのコード変更検知とDocker再ビルド確実化、Docker build時のtsbuildinfo問題、SSH接続失敗の原因（fail2banによるIP Ban）、Pi5のGit権限問題（.gitディレクトリがroot所有）、NodeSourceリポジトリのGPG署名キー問題（SHA1が2026-02-01以降拒否される）、デプロイ時のinventory混同問題（inventory-talkplaza.ymlとinventory.ymlの混同）、デプロイ時のマイグレーション未適用問題、デプロイ方針の見直し（Pi5+Pi4以上は`--detach --follow`必須）、Web bundleデプロイ修正（コード更新時のDocker再ビルド確実化）、Docker build最適化（変更ファイルに基づくbuild判定）、Pi4キオスクの再起動/シャットダウンボタンが機能しない問題（Jinja2テンプレート展開・systemd実行ユーザー・ディレクトリ所有権の問題）、update-all-clients.shでraspberrypi5対象時にRASPI_SERVER_HOST必須チェックを追加、Ansibleテンプレート内の`&#123;&#123;`混入によるSyntax error in template、Pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とIBus設定の永続化、Pi5のみデプロイ時にメンテナンスフラグが残存する問題、**Pi4 3台目（FJV60/80・`raspi4-fjv60-80`）追加（KB-315）**、**Pi4 4台目（StoneBase01・`raspi4-kensaku-stonebase01`）追加時の Docker 未導入失敗と復旧（KB-316）**、**Pi5 LocalLLM: API コンテナへは `docker.env` 経由（KB-318）**、**`docs/` 配置: Pi5 保持・Pi4/Pi3 削除（KB-319・2026-03-28 実機検証）**、**LocalLLM 管理 UI: Web デプロイは Pi5→Pi4 を `--limit` 順次（Pi3 除外・Runbook 実機検証メモ 2026-03-28）** |
| ├─ Ansible/デプロイ性能（調査） | [infrastructure/ansible-deployment-performance.md](./infrastructure/ansible-deployment-performance.md) | 1件 | デプロイ性能の調査（段階展開: カナリア→ロールアウト、Pi4並行/Pi3単独、重複タスク排除、Tailscale/pnpmの実態差分の是正、計測導線） |
| ├─ セキュリティ関連 | [infrastructure/security.md](./infrastructure/security.md) | 21件 | セキュリティ対策と監視、Tailscale ACL grants形式でのポート指定エラー、Tailscaleハードニング段階導入完了（横移動面削減）、NFCストリーム端末分離の実装完了（ACL維持・横漏れ防止）、Tailscale経由でのVNC接続問題（ACL設定不足）、クライアント端末管理の重複登録（inventory未解決テンプレキー混入）、Pi4追加時のkiosk-browser.service起動エラー（chromium-browserコマンド未検出）、Pi4 kiosk-browser対策のAnsible恒久化と実機デプロイ検証（到達不可端末の切り分け含む）、**GitHub メンテナ衛生（ForceMemo/GlassWorm 対策手順・KB-309）**、**Ubuntu LocalLLM の Tailscale sidecar 分離公開（KB-317）** |
| ├─ サイネージ関連 | [infrastructure/signage.md](./infrastructure/signage.md) | 29件 | デジタルサイネージ機能、温度表示、デザイン変更、CSVダッシュボード可視化、複数スケジュール順番切り替え、生産スケジュールサイネージデザイン修正、生産スケジュールサイネージアイテム高さの最適化（20件表示対応）、計測機器持出状況サイネージコンテンツの実装とCSVイベント連携、加工機点検状況サイネージのレイアウト調整、**SPLITレイアウトloans=0件時のvisualization崩れ修正（KB-292）**、**キオスク進捗一覧フルスロット `kiosk_progress_overview`・JPEG 4列×2段・`seibanPerPage` 1〜8（KB-321・初回 2026-04-01・レイアウト刷新 2026-03-31）**、**管理コンソール スケジュール一覧の無効レコード再編集（`GET …/schedules/management`・KB-322・2026-04-01）**、**SPLIT・貸出カード `splitCompact24`（4×6・Pi5 デプロイ・ワークツリー root 権限・KB-325・2026-04-03）**、**貸出グリッド Playwright / `SIGNAGE_LOAN_GRID_ENGINE` とデプロイ env ずれ（KB-327・2026-04-03）**、**キオスク compact 表記（計測・吊具）本番順次デプロイ（KB-330・2026-04-06）**、**貸出グリッド HTML モダン外皮・StoneBase のみ先行デプロイ（KB-331・2026-04-06）**、**compact フッタ欠落（Playwright）／キオスク取消視認性（KB-333・2026-04-07）**、**順位ボード資源CDカード `kiosk_leader_order_cards`（KB-335）** |
| ├─ NFC/ハードウェア関連 | [infrastructure/hardware-nfc.md](./infrastructure/hardware-nfc.md), [KB-291](./infrastructure/KB-291-robodrill01-nfc-scan-not-responding-investigation.md) | 4件 | NFCリーダーとハードウェア、RoboDrill01 NFC恒久対策 |
| └─ その他 | [infrastructure/miscellaneous.md](./infrastructure/miscellaneous.md) | 23件 | その他のインフラ関連（ストレージ管理、macOS対応、Wi-Fi認証ダイアログ抑制、Chromium警告メッセージ抑制、Cursorチャットログ削除、**Pi4 Firefox移行・Super+Shift+Pキーボードショートカット**、**Firefox userChrome 最小化（KB-336）**、**labwc rc.xml 再読み込み（SIGHUP）**含む） |

---

## 📋 課題一覧（ID順）

### API関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-001](./api.md#kb-001-429エラーレート制限エラーが発生する) | 429エラー（レート制限エラー）が発生する | ✅ 解決済み |
| [KB-002](./api.md#kb-002-404エラーが発生する) | 404エラーが発生する | ✅ 解決済み |
| [KB-007](./api.md#kb-007-ログインが失敗する) | ログインが失敗する | ✅ 解決済み |
| [KB-008](./api.md#kb-008-履歴の精度が低い) | 履歴の精度が低い | ✅ 解決済み |
| [KB-010](./api.md#kb-010-client-key未設定で401エラーが発生する) | client-key未設定で401エラーが発生する | ✅ 解決済み |
| [KB-011](./api.md#kb-011-同じアイテムが未返却のまま再借用できない) | 同じアイテムが未返却のまま再借用できない | ✅ 解決済み |
| [KB-012](./api.md#kb-012-管理uiの履歴画面に日付フィルタcsvエクスポートがない) | 管理UIの履歴画面に日付フィルタ/CSVエクスポートがない | ✅ 解決済み |
| [KB-017](./api.md#kb-017-fastify-swaggerが存在しない) | fastify-swaggerが存在しない | ✅ 解決済み |
| [KB-044](./api.md#kb-044-pdfアップロード時のmultipart処理エラーpart-is-not-async-iterable) | PDFアップロード時のmultipart処理エラー（part is not async iterable） | ✅ 解決済み |
| [KB-045](./api.md#kb-045-サイネージが常に工具表示になる問題タイムゾーン問題) | サイネージが常に工具表示になる問題（タイムゾーン問題） | ✅ 解決済み |
| [KB-046](./api.md#kb-046-サイネージで工具管理がダミーデータのみ表示される問題) | サイネージで工具管理がダミーデータのみ表示される問題 | ✅ 解決済み |
| [KB-051](./api.md#kb-051-サイネージのpdfスライドショーが切り替わらない) | サイネージのPDFスライドショーが切り替わらない | ✅ 解決済み |
| [KB-052](./api.md#kb-052-sharpのcompositeエラーimage-to-composite-must-have-same-dimensions-or-smaller) | sharpのcompositeエラー（Image to composite must have same dimensions or smaller） | ✅ 解決済み |
| [KB-054](./api.md#kb-054-サイネージ工具表示で日本語が文字化けする問題) | サイネージ工具表示で日本語が文字化けする問題 | ✅ 解決済み |
| [KB-055](./api.md#kb-055-サイネージpdfがトリミングされて表示される) | サイネージPDFがトリミングされて表示される | ✅ 解決済み |
| [KB-090](./api.md#kb-090-キオスクから計測機器一覧を取得できない問題client-key認証追加) | キオスクから計測機器一覧を取得できない問題（client-key認証追加） | ✅ 解決済み |
| [KB-090](./api.md#kb-090-キオスクから計測機器一覧を取得できない問題client-key認証追加) | キオスクから計測機器一覧を取得できない問題（client-key認証追加） | ✅ 解決済み |
| [KB-094](./api.md#kb-094-サイネージ左ペインで計測機器と工具を視覚的に識別できない) | サイネージ左ペインで計測機器と工具を視覚的に識別できない | ✅ 解決済み |
| [KB-114](./api.md#kb-114-csvインポート構造改善レジストリファクトリパターン) | CSVインポート構造改善（レジストリ・ファクトリパターン） | ✅ 解決済み |
| [KB-115](./api.md#kb-115-gmail件名パターンの設定ファイル管理) | Gmail件名パターンの設定ファイル管理 | ✅ 解決済み |
| [KB-116](./api.md#kb-116-csvインポート手動実行時のリトライスキップ機能) | CSVインポート手動実行時のリトライスキップ機能 | ✅ 解決済み |
| [KB-117](./api.md#kb-117-csvインポートapiの単一データタイプ対応エンドポイント追加) | CSVインポートAPIの単一データタイプ対応エンドポイント追加 | ✅ 解決済み |
| [KB-118](./api.md#kb-118-計測機器uid編集時の複数タグ問題の修正) | 計測機器UID編集時の複数タグ問題の修正 | ✅ 解決済み |
| [KB-121](./api.md#kb-121-部署一覧取得エンドポイント追加とprisma-where句の重複プロパティエラー修正) | 部署一覧取得エンドポイント追加とPrisma where句の重複プロパティエラー修正 | ✅ 解決済み |
| [KB-123](./api.md#kb-123-gmail経由csv取り込み手動実行の実機検証完了) | Gmail経由CSV取り込み（手動実行）の実機検証完了 | ✅ 解決済み |
| [KB-124](./api.md#kb-124-キオスクslackサポート機能の実装と実機検証完了) | キオスクSlackサポート機能の実装と実機検証完了 | ✅ 解決済み |
| [KB-125](./api.md#kb-125-キオスク専用従業員リスト取得エンドポイント追加) | キオスク専用従業員リスト取得エンドポイント追加 | ✅ 解決済み |
| [KB-126](./api.md#kb-126-キオスクuiで自端末の温度表示機能追加) | キオスクUIで自端末の温度表示機能追加 | ✅ 解決済み |
| [KB-132](./api.md#kb-132-webrtcシグナリングルートのダブルプレフィックス問題) | WebRTCシグナリングルートのダブルプレフィックス問題 | ✅ 解決済み |
| [KB-133](./api.md#kb-133-fastifywebsocketのconnectionsocketがundefinedになる問題) | @fastify/websocketのconnection.socketがundefinedになる問題 | ✅ 解決済み |
| [KB-134](./api.md#kb-134-websocket接続の5分タイムアウト問題とkeepalive対策) | WebSocket接続の5分タイムアウト問題とkeepalive対策 | ✅ 解決済み |
| [KB-135](./api.md#kb-135-キオスク通話候補取得用apiエンドポイント追加) | キオスク通話候補取得用APIエンドポイント追加 | ✅ 解決済み |
| [KB-185](./api.md#kb-185-csvダッシュボードのgmailsubjectpattern設定ui改善) | CSVダッシュボードのgmailSubjectPattern設定UI改善 | ✅ 解決済み |
| [KB-186](./api.md#kb-186-csvimportsubjectpatternモデル追加による設計統一マスターデータインポートの件名パターンdb化) | CsvImportSubjectPatternモデル追加による設計統一（マスターデータインポートの件名パターンDB化） | ✅ 解決済み |
| [KB-187](./api.md#kb-187-csvインポートスケジュール作成時のid自動生成とnomatchingmessageerrorハンドリング改善) | CSVインポートスケジュール作成時のID自動生成とNoMatchingMessageErrorハンドリング改善 | ✅ 解決済み |
| [KB-188](./api.md#kb-188-csvインポート実行エンドポイントでのapierror-statuscode尊重) | CSVインポート実行エンドポイントでのApiError statusCode尊重 | ✅ 解決済み |
| [KB-189](./api.md#kb-189-gmailに同件名メールが溜まる場合のcsvダッシュボード取り込み仕様どの添付を取るか) | Gmailに同件名メールが溜まる場合のCSVダッシュボード取り込み仕様（どの添付を取るか） | ✅ 解決済み |
| [KB-190](./api.md#kb-190-gmail-oauthのinvalid_grantでcsv取り込みが500になる) | Gmail OAuthのinvalid_grantでCSV取り込みが500になる | ✅ 解決済み |
| [KB-191](./api.md#kb-191-csvインポートスケジュールの間隔設定機能実装10分ごと等の細かい頻度設定) | CSVインポートスケジュールの間隔設定機能実装（10分ごと等の細かい頻度設定） | ✅ 解決済み |
| [KB-201](./api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加) | 生産スケジュールCSVダッシュボードの差分ロジック改善とバリデーション追加 | ✅ 解決済み |
| [KB-204](./frontend.md#kb-204-csvインポートスケジュール実行ボタンの競合防止と409エラーハンドリング) | CSVインポートスケジュール実行ボタンの競合防止と409エラーハンドリング | ✅ 解決済み |
| [KB-205](./api.md#kb-205-生産スケジュール画面のパフォーマンス最適化と検索機能改善api側) | 生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側） | ✅ 解決済み |
| [KB-208](./api.md#kb-208-生産スケジュールapi拡張資源cdfilter加工順序割当検索状態同期and検索) | 生産スケジュールAPI拡張（資源CDフィルタ・加工順序割当・検索状態同期・AND検索・工程カテゴリフィルタ） | ✅ 解決済み |
| [KB-209](./api.md#kb-209-生産スケジュール検索状態の全キオスク間共有化) | 生産スケジュール検索状態の全キオスク間共有化 | ✅ 解決済み |
| [KB-210](./api.md#kb-210-生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正) | 生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正 | ✅ 解決済み |
| [KB-211](./api.md#kb-211-生産スケジュール検索登録製番の削除追加が巻き戻る競合問題cas導入) | 生産スケジュール検索登録製番の削除・追加が巻き戻る競合問題（CAS導入） | ✅ 解決済み |
| [KB-212](./api.md#kb-212-生産スケジュール行ごとの備考欄追加機能) | 生産スケジュール行ごとの備考欄追加機能 | ✅ 解決済み |
| [KB-215](./api.md#kb-215-gmail-oauthリフレッシュトークンの7日間制限問題未検証アプリ) | Gmail OAuthリフレッシュトークンの7日間制限問題（未検証アプリ） | 🔄 検証リクエスト中 |
| [KB-216](./api.md#kb-216-gmail-apiレート制限エラー429の対処方法) | Gmail APIレート制限エラー（429）の対処方法 | ✅ 解決済み・復旧完了 |
| [KB-217](./KB-217-gmail-api-429-early-retry.md) | Gmail API 429エラー - クールダウン解除直後の再発 | 🔄 調査中 |
| [KB-221](./frontend.md#kb-221-生産スケジュール納期日機能のui改善カスタムカレンダーui実装) | 生産スケジュール納期日機能のUI改善（カスタムカレンダーUI実装） | ✅ 解決済み |
| [KB-229](./api.md#kb-229-gmail認証切れ時のslack通知機能追加) | Gmail認証切れ時のSlack通知機能追加 | ✅ 解決済み |
| [KB-230](./api.md#kb-230-gmail認証切れの実機調査と回復) | Gmail認証切れの実機調査と回復 | ✅ 解決済み |
| [KB-231](./api.md#kb-231-生産スケジュール登録製番上限の拡張8件20件とサイネージアイテム高さの最適化) | 生産スケジュール登録製番上限（8→20→**50**件・2026-03-31）とサイネージアイテム高さの最適化 | ✅ 解決済み |
| [KB-246](./api.md#kb-246-gmailゴミ箱自動削除機能深夜バッチ) | Gmailゴミ箱自動削除機能（深夜バッチ） | ✅ 解決済み |
| [KB-248](./api.md#kb-248-生産スケジュール資源cdボタン表示の遅延問題式インデックス追加による高速化) | 生産スケジュール資源CDボタン表示の遅延問題（式インデックス追加による高速化） | ✅ 解決済み |
| [KB-249](./api.md#kb-249-csvダッシュボードの日付パースでタイムゾーン変換の二重適用問題) | CSVダッシュボードの日付パースでタイムゾーン変換の二重適用問題 | ✅ 解決済み |
| [KB-250](./frontend.md#kb-249-加工機マスターデータのcsvインポートと未点検加工機抽出機能の実装) | 加工機マスターデータのCSVインポートと未点検加工機抽出機能の実装 | ✅ 実装完了・実機検証完了 |
| [KB-251](./api.md#kb-251-未点検加工機サイネージ可視化データソースの追加) | 未点検加工機サイネージ可視化データソースの追加 | ✅ 解決済み |
| [KB-253](./api.md#kb-253-加工機csvインポートのデフォルト列定義とdb設定不整合問題) | 加工機CSVインポートのデフォルト列定義とDB設定不整合問題 | ✅ 解決済み |
| [KB-255](./api.md#kb-255-apikiosk-と-apiclients-のルート分割サービス層抽出互換維持での実機検証) | `/api/kiosk` と `/api/clients` のルート分割・サービス層抽出（互換維持での実機検証） | ✅ 解決済み |
| [KB-256](./api.md#kb-256-加工機点検状況サイネージの集計一致と2列表示最適化未点検は終端) | 加工機点検状況サイネージの集計一致と2列表示最適化（未点検は終端） | ✅ 解決済み |
| [KB-257](./api.md#kb-257-backupimportsルート分割と実行ロジックのサービス層移設) | backup/importsルート分割と実行ロジックのサービス層移設 | ✅ 解決済み |
| [KB-258](./api.md#kb-258-コード品質改善フェーズ2ratchet-型安全化lint抑制削減契約型拡張) | コード品質改善フェーズ2（Ratchet）〜フェーズ4第五弾（5本実装）+ B対応（coverage安定化と`test-exclude>glob`維持判断） | ✅ 解決済み |
| [KB-262](./api.md#kb-262-加工機点検状況サイネージのカードレイアウト変更と背景色改善) | 加工機点検状況サイネージのカードレイアウト変更と背景色改善 | ✅ 解決済み |
| [KB-282](./api.md#kb-282-生産スケジュールhistory-progressエンドポイントにmachinename追加) | 生産スケジュールhistory-progressエンドポイントにmachineName追加 | ✅ 解決済み |
| [KB-285](./api.md#kb-285-生産スケジュールhistory-progressエンドポイントのmachinename取得にsh追加) | 生産スケジュールhistory-progressエンドポイントのmachineName取得にSH追加 | ✅ 解決済み |

### データベース関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-003](./database.md#kb-003-p2002エラーnfctaguidの重複が発生する) | P2002エラー（nfcTagUidの重複）が発生する | ✅ 解決済み |
| [KB-004](./database.md#kb-004-削除機能が動作しない) | 削除機能が動作しない | ✅ 解決済み |
| [KB-013](./database.md#kb-013-実機uidとseedデータが不一致) | 実機UIDとseedデータが不一致 | ✅ 解決済み |

### CI/CD関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-005](./ci-cd.md#kb-005-ciテストが失敗する) | CIテストが失敗する | 🔄 進行中 |
| [KB-227](./ci-cd.md#kb-227-pnpm-audit-のhighでciが失敗するfastify脆弱性--fastify-v5移行の影響範囲調査) | `pnpm audit` のhighでCIが失敗する（fastify脆弱性 / Fastify v5移行の影響範囲調査） | 🔄 進行中 |
| [KB-009](./ci-cd.md#kb-009-e2eテストのログイン成功後のリダイレクトがci環境で失敗する) | E2Eテストのログイン成功後のリダイレクトがCI環境で失敗する | ✅ 解決済み |
| [KB-023](./ci-cd.md#kb-023-ciでバックアップリストアテストが失敗する) | CIでバックアップ・リストアテストが失敗する | 🔄 進行中 |
| [KB-024](./ci-cd.md#kb-024-ciテストアーキテクチャの設計不足) | CI/テストアーキテクチャの設計不足 | 🔄 進行中 |
| [KB-025](./ci-cd.md#kb-025-e2eスモークkioskがナビゲーション不可視で失敗する) | E2Eスモーク（kiosk）がナビゲーション不可視で失敗する | ✅ 解決済み |
| [KB-026](./ci-cd.md#kb-026-cursor内の編集ツールが大きなyamlファイルで失敗する) | Cursor内の編集ツールが大きなYAMLファイルで失敗する | ✅ 解決済み |
| [KB-270](./ci-cd.md#kb-270-ciのvitest-coverageでtest-excludeとminimatchの非互換エラー) | CIのvitest coverageでtest-excludeとminimatchの非互換エラー | ✅ 解決済み |
| [KB-279](./ci-cd.md#kb-279-trivy脆弱性スキャンでminimatchのcve-2026-2790327904が検出される) | Trivy脆弱性スキャンでminimatchのCVE-2026-27903/27904が検出される | ✅ 解決済み |
| [KB-298](./ci-cd.md#kb-298-ユニットテストでprismaモデル未モックtyperror-cannot-read-properties-of-undefined-reading-findmany) | ユニットテストでPrismaモデル未モック（TypeError: findMany） | ✅ 解決済み |
| [KB-299](./ci-cd.md#kb-299-prisma-jsonカラムへのrecordstring-unknown-やnullの代入でciビルド失敗) | Prisma JSONカラムへの Record/null 代入でCIビルド失敗 | ✅ 解決済み |
| [KB-302](./ci-cd.md#kb-302-location-scope-resolverのブランド型ciビルド失敗とverify-phase12-realのping失敗) | location-scope-resolver ブランド型CIビルド失敗・verify-phase12 ping失敗 | ✅ 解決済み |
| [KB-307](./ci-cd.md#kb-307-trivy-image-web-が-usrbincaddy-の-cve-を検出して-ci-が失敗する) | Trivy image web が `usr/bin/caddy` の CVE を検出して CI が失敗する | ✅ 解決済み |
| [KB-310](./ci-cd.md#kb-310-trivy-action-の-github-actions-参照解決失敗unable-to-resolve-action) | trivy-action の GitHub Actions 参照解決失敗（Unable to resolve action） | ✅ 解決済み |

### フロントエンド関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-006](./frontend.md#kb-006-キオスクの接続が不安定) | キオスクの接続が不安定 | ✅ 解決済み |
| [KB-016](./frontend.md#kb-016-xstate-v5のassignの誤用) | XState v5のassignの誤用 | ✅ 解決済み |
| [KB-022](./frontend.md#kb-022-キオスクがラズパイ5に接続できない) | キオスクがラズパイ5に接続できない | ✅ 解決済み |
| [KB-026](./frontend.md#kb-026-キオスク画面のリダイレクトが設定変更時に反映されない) | キオスク画面のリダイレクトが設定変更時に反映されない | ✅ 解決済み |
| [KB-027](./frontend.md#kb-027-nfcイベントが重複発火して持出一覧に自動追加が止まらない) | NFCイベントが重複発火して持出一覧に自動追加が止まらない | ✅ 解決済み |
| [KB-028](./frontend.md#kb-028-デバッグログの環境変数制御) | デバッグログの環境変数制御 | ✅ 解決済み |
| [KB-029](./frontend.md#kb-029-従業員編集画面でバリデーションエラーメッセージが表示されない) | 従業員編集画面でバリデーションエラーメッセージが表示されない | ✅ 解決済み |
| [KB-035](./frontend.md#kb-035-useeffectの依存配列にiscapturingを含めていた問題重複処理) | useEffectの依存配列にisCapturingを含めていた問題（重複処理） | ✅ 解決済み |
| [KB-036](./frontend.md#kb-036-履歴画面の画像表示で認証エラーwindowopenでの新しいタブ) | 履歴画面の画像表示で認証エラー（window.openでの新しいタブ） | ✅ 解決済み |
| [KB-037](./frontend.md#kb-037-カメラプレビューのcpu負荷問題常時プレビュー削除) | カメラプレビューのCPU負荷問題（常時プレビュー削除） | ✅ 解決済み |
| [KB-038](./frontend.md#kb-038-カメラ撮影時のcpu100問題video要素のクリーンアップ) | カメラ撮影時のCPU100%問題（video要素のクリーンアップ） | ✅ 解決済み |
| [KB-040](./frontend.md#kb-040-返却一覧の自動更新が不要だった問題cpu負荷軽減) | 返却一覧の自動更新が不要だった問題（CPU負荷軽減） | ✅ 解決済み |
| [KB-043](./frontend.md#kb-043-kioskredirectがadminパスでも動作してしまい管理画面にアクセスできない問題) | KioskRedirectが/adminパスでも動作してしまい、管理画面にアクセスできない問題 | ✅ 解決済み |
| [KB-045](./frontend.md#kb-045-分割表示でpdfがスライドしない問題) | 分割表示でPDFがスライドしない問題 | ✅ 解決済み |
| [KB-046](./frontend.md#kb-046-サイネージのサムネイルアスペクト比がおかしい問題) | サイネージのサムネイルアスペクト比がおかしい問題 | ✅ 解決済み |
| [KB-091](./frontend.md#kb-091-キオスク持出フローの改善選択-or-タグuid点検項目なしでも送信) | キオスク持出フローの改善（選択 or タグUID、点検項目なしでも送信） | ✅ 解決済み |
| [KB-091](./frontend.md#kb-091-キオスク持出フローの改善選択-or-タグuid点検項目なしでも送信) | キオスク持出フローの改善（選択 or タグUID、点検項目なしでも送信） | ✅ 解決済み |
| [KB-095](./frontend.md#kb-095-計測機器タグスキャン時の自動遷移機能) | 計測機器タグスキャン時の自動遷移機能 | ✅ 解決済み |
| [KB-096](./frontend.md#kb-096-クライアントログ取得のベストプラクティスpostclientlogsへの統一) | クライアントログ取得のベストプラクティス（postClientLogsへの統一） | ✅ 解決済み |
| [KB-109](./frontend.md#kb-109-csvインポートスケジュールページのui統一バックアップペインと同じui) | CSVインポートスケジュールページのUI統一（バックアップペインと同じUI） | ✅ 解決済み |
| [KB-111](./frontend.md#kb-111-csvインポートスケジュールの表示を人間が読みやすい形式に変更) | CSVインポートスケジュールの表示を人間が読みやすい形式に変更 | ✅ 解決済み |
| [KB-125](./frontend.md#kb-125-キオスクお問い合わせフォームのデザイン変更) | キオスクお問い合わせフォームのデザイン変更 | ✅ 解決済み |
| [KB-136](./frontend.md#kb-136-webrtc-usewebrtcフックのcleanup関数が早期実行される問題) | WebRTC useWebRTCフックのcleanup関数が早期実行される問題 | ✅ 解決済み |
| [KB-137](./frontend.md#kb-137-マイク未接続端末でのrecvonlyフォールバック実装) | マイク未接続端末でのrecvonlyフォールバック実装 | ✅ 解決済み |
| [KB-138](./frontend.md#kb-138-ビデオ通話時のdom要素へのsrcobjectバインディング問題) | ビデオ通話時のDOM要素へのsrcObjectバインディング問題 | ✅ 解決済み |
| [KB-139](./frontend.md#kb-139-webrtcシグナリングのwebsocket接続管理重複接続防止) | WebRTCシグナリングのWebSocket接続管理（重複接続防止） | ✅ 解決済み |
| [KB-140](./frontend.md#kb-140-uselocalstorageとの互換性のためのjsonstringify対応) | useLocalStorageとの互換性のためのJSON.stringify対応 | ✅ 解決済み |
| [KB-149](./frontend.md#kb-149-バックアップ履歴ページに用途列を追加ui改善) | バックアップ履歴ページに用途列を追加（UI改善） | ✅ 解決済み |
| [KB-171](./frontend.md#kb-171-webrtcビデオ通話機能が動作しないkioskcallpageでのclientkeyclientid未設定) | WebRTCビデオ通話機能が動作しない（KioskCallPageでのclientKey/clientId未設定、着信自動切替・Pi3除外の追記） | ✅ 解決済み |
| [KB-184](./frontend.md#kb-184-生産スケジュールキオスクページ実装と完了ボタンのグレーアウトトグル機能) | 生産スケジュールキオスクページ実装と完了ボタンのグレーアウト・トグル機能 | ✅ 解決済み |
| [KB-192](./frontend.md#kb-192-管理コンソールのサイネージプレビュー機能実装とjwt認証問題) | 管理コンソールのサイネージプレビュー機能実装とJWT認証問題 | ✅ 解決済み |
| [KB-202](./frontend.md#kb-202-生産スケジュールキオスクページの列名変更とfseiban全文表示) | 生産スケジュールキオスクページの列名変更とFSEIBAN全文表示 | ✅ 解決済み |
| [KB-204](./frontend.md#kb-204-csvインポートスケジュール実行ボタンの競合防止と409エラーハンドリング) | CSVインポートスケジュール実行ボタンの競合防止と409エラーハンドリング | ✅ 解決済み |
| [KB-206](./frontend.md#kb-206-生産スケジュール画面のパフォーマンス最適化と検索機能改善フロントエンド側) | 生産スケジュール画面のパフォーマンス最適化と検索機能改善（フロントエンド側） | ✅ 解決済み |
| [KB-207](./frontend.md#kb-207-生産スケジュールui改善チェック配色or検索ソフトキーボード) | 生産スケジュールUI改善（チェック配色/OR検索/ソフトキーボード） | ✅ 解決済み |
| [KB-208](./frontend.md#kb-208-生産スケジュールui改良資源cdfilter加工順序割当検索状態同期and検索) | 生産スケジュールUI改良（資源CDフィルタ・加工順序割当・検索状態同期・AND検索） | ✅ 解決済み |
| [KB-212](./frontend.md#kb-212-生産スケジュール行ごとの備考欄追加機能) | 生産スケジュール行ごとの備考欄追加機能 | ✅ 解決済み |
| [KB-211](./frontend.md#kb-211-キオスク持出タブの持出中アイテムが端末間で共有されない問題) | キオスク持出タブの持出中アイテムが端末間で共有されない問題 | ✅ 解決済み |
| [KB-221](./frontend.md#kb-221-生産スケジュール納期日機能のui改善カスタムカレンダーui実装) | 生産スケジュール納期日機能のUI改善（カスタムカレンダーUI実装） | ✅ 解決済み |
| [KB-223](./frontend.md#kb-223-生産スケジュール備考のモーダル編集化と処理列追加) | 生産スケジュール備考のモーダル編集化と処理列追加 | ✅ 解決済み |
| [KB-225](./frontend.md#kb-225-キオスク入力フィールド保護ルールの実装と実機検証) | キオスク入力フィールド保護ルールの実装と実機検証 | ✅ 実装完了・実機検証完了 |
| [KB-239](./frontend.md#kb-239-キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決react-portal導入) | キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決（React Portal導入） | ✅ 解決済み |
| [KB-240](./frontend.md#kb-240-モーダル共通化アクセシビリティ標準化e2eテスト安定化) | モーダル共通化・アクセシビリティ標準化・E2Eテスト安定化 | ✅ 解決済み |
| [KB-241](./frontend.md#kb-241-webrtcビデオ通話の常時接続と着信自動切り替え機能実装) | WebRTCビデオ通話の常時接続と着信自動切り替え機能実装 | ✅ 解決済み |
| [KB-242](./frontend.md#kb-242-生産スケジュール登録製番削除ボタンの進捗連動ui改善) | 生産スケジュール登録製番削除ボタンの進捗連動UI改善 | ✅ 解決済み |
| [KB-243](./frontend.md#kb-243-webrtcビデオ通話の映像不安定問題とエラーダイアログ改善) | WebRTCビデオ通話の映像不安定問題とエラーダイアログ改善 | ✅ 解決済み |
| [KB-244](./frontend.md#kb-244-pi4キオスクの備考欄に日本語入力状態インジケーターを追加) | Pi4キオスクの備考欄に日本語入力状態インジケーターを追加 | ✅ 解決済み |
| [KB-245](./infrastructure/ansible-deployment.md#kb-245-pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とibus設定の永続化) | Pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とIBus設定の永続化 | ✅ 解決済み |
| [KB-247](./frontend.md#kb-247-生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化) | 生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化 | ✅ 解決済み |
| [KB-268](./frontend.md#kb-268-生産スケジュールキオスク操作で間欠的に数秒待つ継続観察) | 生産スケジュールキオスク操作で間欠的に数秒待つ（継続観察） | 🔄 継続観察 |
| [KB-269](./api.md#kb-269-生産スケジュールprogress別テーブル化csv取り込み時の上書きリスク回避) | 生産スケジュールprogress別テーブル化（CSV取り込み時の上書きリスク回避） | ✅ 解決済み |
| [KB-271](./api.md#kb-271-生産スケジュールデータ削除ルール重複loser即時削除1年超過は保存しない) | 生産スケジュールデータ削除ルール（重複loser即時削除・1年超過は保存しない） | ✅ 解決済み |
| [KB-296](./api.md#kb-296-eventloop-health-評価で起動直後テスト時に-503degraded-になる) | eventLoop health 評価で起動直後・テスト時に 503/degraded になる | ✅ 解決済み |
| [KB-301](./api.md#kb-301-実績工数csv手動投入で-413-payload-too-large-になる) | 実績工数CSV手動投入で 413 Payload Too Large になる | ✅ 解決済み |
| [KB-272](./api.md#kb-272-gmail-csvdashboards取得を10分30件運用へ最適化) | Gmail csvDashboards取得を10分30件運用へ最適化 | ✅ 解決済み |
| [KB-273](./KB-273-csv-dashboard-dedup-and-error-disposition-commonization.md) | CSVダッシュボードの重複削除共通化とエラーメール廃棄ポリシー統一 | ✅ 実装中 |
| [KB-274](./infrastructure/signage.md#kb-274-signage-render-workerの高メモリ化断続と安定化対応) | signage-render-workerの高メモリ化（断続）と安定化対応 | 🔄 継続観察 |
| [KB-275](./infrastructure/signage.md#kb-275-加工機点検状況サイネージのレイアウト調整) | 加工機点検状況サイネージのレイアウト調整 | ✅ 解決済み |
| [KB-248](./frontend.md#kb-248-カメラ明るさ閾値チェックの削除雨天照明なし環境での撮影対応) | カメラ明るさ閾値チェックの削除（雨天・照明なし環境での撮影対応） | ✅ 解決済み |
| [KB-252](./frontend.md#kb-252-未点検加工機サイネージ設定導線可視化ダッシュボード経由の実装) | 未点検加工機サイネージ設定導線（可視化ダッシュボード経由）の実装 | ✅ 解決済み |
| [KB-254](./frontend.md#kb-254-加工機マスタのメンテナンスページ追加crud機能) | 加工機マスタのメンテナンスページ追加（CRUD機能） | ✅ 解決済み |
| [KB-267](./frontend.md#kb-267-吊具持出画面に吊具情報表示を追加) | 吊具持出画面に吊具情報表示を追加 | ✅ 解決済み |
| [KB-312](./KB-312-rigging-idnum-deploy-verification.md) | 吊具マスタ idNum（旧番号）追加・デプロイ・実機検証記録 | ✅ 記録済み（2026-03-24、Pi4×2 デプロイ済・RoboDrill01 は別日） |
| [KB-276](./frontend.md#kb-276-pi4キオスクの日本語入力モード切替問題とibus設定改善) | Pi4キオスクの日本語入力モード切替問題とIBus設定改善 | ✅ 解決済み |
| [KB-282](./frontend.md#kb-282-生産スケジュール登録製番ボタンの3段表示と機種名表示全角半角大文字化) | 生産スケジュール登録製番ボタンの3段表示と機種名表示（全角半角大文字化） | ✅ 解決済み |
| [KB-283](./frontend.md#kb-283-生産スケジュール検索条件の端末別localstorage保存) | 生産スケジュール検索条件の端末別localStorage保存 | ✅ 解決済み |
| [KB-284](./frontend.md#kb-284-生産スケジュールアイテム一覧からmhアイテムを除外) | 生産スケジュールアイテム一覧からMHアイテムを除外 | ✅ 解決済み |
| [KB-285](./frontend.md#kb-285-生産スケジュールアイテム一覧からshアイテムも除外し機種名表示にsh追加) | 生産スケジュールアイテム一覧からSHアイテムも除外し機種名表示にSH追加 | ✅ 解決済み |
| [KB-286](./frontend.md#kb-286-電源操作の連打防止オーバーレイ実装react-portal-による表示失敗の解決) | 電源操作の連打防止オーバーレイ実装（React Portalによる表示失敗の解決） | ✅ 解決済み |
| [KB-287](./frontend.md#kb-287-キオスク備考欄の日本語入力不具合ibus-ui-ウィンドウ出現で入力不安定) | キオスク備考欄の日本語入力不具合（ibus-ui ウィンドウ出現で入力不安定） | ✅ 解決済み |
| [KB-288](./KB-288-power-actions-bind-mount-deleted-inode.md) | 電源操作・連打防止オーバーレイ不具合（power-actions バインドマウントの削除済み inode 参照） | ✅ 恒久対策実装済み |
| [KB-289](./infrastructure/miscellaneous.md#kb-289-pi4-kensakumain-の-firefox-移行と-supershiftp-キーボードショートカット上辺メニューバー表示) | Pi4 kensakuMain Firefox移行・Super+Shift+Pキーボードショートカット（上辺メニューバー表示） | ✅ 実装完了 |
| [KB-336](./infrastructure/miscellaneous.md) | Pi4 キオスク Firefox ブラウザ枠最小化（専用プロファイル・userChrome・Ansible） | ✅ 第2工場 Pi4×4 デプロイ・リモート検証済（2026-04-08） |
| [KB-290](./infrastructure/backup-restore.md#kb-290-dropbox容量不足の恒久対策チャンクアップロード自動削除再試行) | Dropbox容量不足の恒久対策（チャンクアップロード・自動削除・再試行） | ✅ 解決済み |
| [KB-291](./infrastructure/KB-291-robodrill01-nfc-scan-not-responding-investigation.md) | ロボドリル01（raspi4-robodrill01）NFCスキャンが反応しない調査・恒久対策 | ✅ 解決済み（2026-03-05） |
| [KB-294](./frontend.md#kb-294-生産スケジュール資源cdボタン優先並び) | 生産スケジュール資源CDボタン優先並び | ✅ 解決済み（2026-03-06） |
| [KB-295](./frontend.md#kb-295-生産スケジュール登録製番ボタン並び替えui) | 生産スケジュール登録製番ボタン並び替えUI | ✅ 実装完了（2026-03-06） |
| [KB-303](./frontend.md#kb-303-納期管理右ペイン-資源cdfilterドロップダウンのみ研削切削ボタン削除) | 納期管理右ペイン 資源CDフィルタ（ドロップダウンのみ・研削/切削ボタン削除） | ✅ 実装完了（2026-03-17） |
| [KB-304](./frontend.md#kb-304-生産スケジュール-機種名部品名検索a条件全角半角正規化ドロップダウン空対策) | 生産スケジュール 機種名・部品名検索（A条件・全角半角正規化・ドロップダウン空対策） | ✅ 実装完了（2026-03-17） |
| [KB-305](./frontend.md#kb-305-生産スケジュール-製造order番号ポップアップ検索5桁候補部品選択チェック確定) | 生産スケジュール 製造order番号ポップアップ検索（5桁候補・部品選択・チェック確定） | ✅ 実装・デプロイ・実機検証完了（2026-03-17） |
| [KB-306](./frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) | キオスク進捗一覧 製番フィルタ（ドロップダウン・端末別保存） | ✅ 実装・デプロイ・実機検証完了（2026-03-18） |
| [KB-307](./frontend.md#kb-307-生産スケジュールui統一登録製番資源cdドロップダウン併設) | 生産スケジュールUI統一（登録製番・資源CDドロップダウン併設） | ✅ デプロイ・実機検証完了（2026-03-18） |
| [KB-308](./frontend.md#kb-308-生産スケジュールuiが古いのに戻った事象ブランチ分岐によるデプロイ内容ずれ) | 生産スケジュールUIが古いのに戻った事象（ブランチ分岐によるデプロイ内容ずれ） | ✅ 解決済み（2026-03-19） |

### インフラ関連

| ID | 課題名 | 状態 |
|----|--------|------|
| [KB-014](./infrastructure/docker-caddy.md#kb-014-caddyのリバースプロキシ設定が不適切) | Caddyのリバースプロキシ設定が不適切 | ✅ 解決済み |
| [KB-015](./infrastructure/docker-caddy.md#kb-015-docker-composeのポート設定が不適切) | Docker Composeのポート設定が不適切 | ✅ 解決済み |
| [KB-018](./infrastructure/miscellaneous.md#kb-018-オフライン耐性の実装) | オフライン耐性の実装 | ✅ 解決済み |
| [KB-019](./infrastructure/miscellaneous.md#kb-019-usb一括登録機能の実装) | USB一括登録機能の実装 | ✅ 解決済み |
| [KB-020](./infrastructure/backup-restore.md#kb-020-バックアップリストア機能の実装) | バックアップ・リストア機能の実装 | ✅ 実装完了 |
| [KB-021](./infrastructure/miscellaneous.md#kb-021-監視アラート機能の実装) | 監視・アラート機能の実装 | ✅ 実装完了 |
| [KB-030](./infrastructure/docker-caddy.md#kb-030-カメラapiがhttp環境で動作しないhttps必須) | カメラAPIがHTTP環境で動作しない（HTTPS必須） | ✅ 解決済み |
| [KB-031](./infrastructure/docker-caddy.md#kb-031-websocket-mixed-content-エラーhttpsページからwsへの接続) | WebSocket Mixed Content エラー（HTTPSページからws://への接続） | ✅ 解決済み |
| [KB-032](./infrastructure/docker-caddy.md#kb-032-caddyfilelocal-のhttpバージョン指定エラー) | Caddyfile.local のHTTPバージョン指定エラー | ✅ 解決済み |
| [KB-033](./infrastructure/docker-caddy.md#kb-033-docker-composeserveryml-のyaml構文エラー手動編集による破壊) | docker-compose.server.yml のYAML構文エラー（手動編集による破壊） | ✅ 解決済み |
| [KB-034](./infrastructure/miscellaneous.md#kb-034-ラズパイのロケール設定euc-jpによる文字化け) | ラズパイのロケール設定（EUC-JP）による文字化け | ✅ 解決済み |
| [KB-039](./infrastructure/miscellaneous.md#kb-039-cpu温度取得のdocker対応sysclassthermalマウント) | CPU温度取得のDocker対応（/sys/class/thermalマウント） | ✅ 解決済み |
| [KB-041](./infrastructure/miscellaneous.md#kb-041-wi-fi変更時のipアドレス設定が手動で再ビルドが必要だった問題環境変数化) | Wi-Fi変更時のIPアドレス設定が手動で再ビルドが必要だった問題（環境変数化） | ✅ 解決済み |
| [KB-042](./infrastructure/miscellaneous.md#kb-042-pdf-popplerがlinuxarm64をサポートしていない問題) | pdf-popplerがLinux（ARM64）をサポートしていない問題 | ✅ 解決済み |
| [KB-050](./infrastructure/miscellaneous.md#kb-050-軽量サイネージクライアントが自己署名証明書で画像を取得できない) | 軽量サイネージクライアントが自己署名証明書で画像を取得できない | ✅ 解決済み |
| [KB-053](./infrastructure/miscellaneous.md#kb-053-サイネージの自動レンダリング画像が更新されないsignage_render_dirのパス不一致) | サイネージの自動レンダリング画像が更新されない（SIGNAGE_RENDER_DIRのパス不一致） | ✅ 解決済み |
| [KB-056](./infrastructure/hardware-nfc.md#kb-056-工具スキャンが二重登録される問題nfcエージェントのキュー処理改善) | 工具スキャンが二重登録される問題（NFCエージェントのキュー処理改善） | ✅ 解決済み |
| [KB-057](./infrastructure/miscellaneous.md#kb-057-ssh接続でホスト名解決が失敗しパスワード認証が通らない問題) | SSH接続でホスト名解決が失敗しパスワード認証が通らない問題 | ✅ 解決済み |
| [KB-058](./infrastructure/ansible-deployment.md#kb-058-ansible接続設定でraspberry-pi-34への接続に失敗する問題ユーザー名ssh鍵サービス存在確認) | Ansible接続設定でRaspberry Pi 3/4への接続に失敗する問題（ユーザー名・SSH鍵・サービス存在確認） | ✅ 解決済み |
| [KB-059](./infrastructure/miscellaneous.md#kb-059-ローカルアラートシステムのdockerコンテナ内からのファイルアクセス問題) | ローカルアラートシステムのDockerコンテナ内からのファイルアクセス問題 | ✅ 解決済み |
| [KB-060](./infrastructure/hardware-nfc.md#kb-060-dockerコンテナ内からnfcリーダーpcscdにアクセスできない問題) | Dockerコンテナ内からNFCリーダー（pcscd）にアクセスできない問題 | ✅ 解決済み |
| [KB-061](./infrastructure/ansible-deployment.md#kb-061-ansible実装後の設定ファイル削除問題と堅牢化対策) | Ansible実装後の設定ファイル削除問題と堅牢化対策 | ✅ 解決済み |
| [KB-062](./infrastructure/ansible-deployment.md#kb-062-ansible設定ファイル管理化の実装systemdサービスアプリケーション設定) | Ansible設定ファイル管理化の実装（systemdサービス・アプリケーション設定） | ✅ 解決済み |
| [KB-063](./infrastructure/docker-caddy.md#kb-063-websocket接続エラー502-caddyの環境変数置換が機能しない) | WebSocket接続エラー（502）: Caddyの環境変数置換が機能しない | ✅ 解決済み |
| [KB-064](./frontend.md#kb-064-pi4キオスクでカメラが起動しない-facingmodeの指定方法の問題) | Pi4キオスクでカメラが起動しない: facingModeの指定方法の問題 | ✅ 解決済み |
| [KB-065](./frontend.md#kb-065-カメラエラーメッセージが表示されない-デバッグログの出力条件が厳しすぎる) | カメラエラーメッセージが表示されない: デバッグログの出力条件が厳しすぎる | ✅ 解決済み |
| [KB-091](./frontend.md#kb-091-nfcカメラ入力のスコープ分離-別ページからのイベント横漏れ防止) | NFC/カメラ入力のスコープ分離: 別ページからのイベント横漏れ防止 | ✅ 解決済み |
| [KB-066](./infrastructure/ansible-deployment.md#kb-066-ラズパイ3でのansibleデプロイ失敗サイネージ稼働中のリソース不足自動再起動401エラー) | ラズパイ3でのAnsibleデプロイ失敗（サイネージ稼働中のリソース不足・自動再起動・401エラー） | ✅ 解決済み |
| [KB-067](./infrastructure/hardware-nfc.md#kb-067-工具スキャンが重複登録される問題nfcエージェントのeventid永続化対策) | 工具スキャンが重複登録される問題（NFCエージェントのeventId永続化対策） | ✅ 解決済み |
| [KB-068](./frontend.md#kb-068-写真撮影持出のサムネイルが真っ黒になる問題輝度チェック対策) | 写真撮影持出のサムネイルが真っ黒になる問題（輝度チェック対策） | ✅ 解決済み |
| [KB-072](./infrastructure/security.md#kb-072-pi5のufw適用とhttpsリダイレクト強化) | Pi5のUFW適用とHTTPSリダイレクト強化 | ✅ 解決済み |
| [KB-073](./infrastructure/security.md#kb-073-caddyアクセスログとfail2bansshhttpの連携) | Caddyアクセスログとfail2ban（SSH/HTTP）の連携 | ✅ 解決済み |
| [KB-074](./infrastructure/security.md#kb-074-pi5のマルウェアスキャン自動化clamavtrivyrkhunter) | Pi5のマルウェアスキャン自動化（ClamAV/Trivy/rkhunter） | ✅ 解決済み |
| [KB-075](./infrastructure/security.md#kb-075-pi4キオスクの軽量マルウェア対策) | Pi4キオスクの軽量マルウェア対策 | ✅ 解決済み |
| [KB-076](./infrastructure/security.md#kb-076-fail2ban連携のセキュリティ監視タイマー) | fail2ban連携のセキュリティ監視タイマー | ✅ 解決済み |
| [KB-077](./infrastructure/security.md#kb-077-マルウェアスキャン結果の自動アラート化) | マルウェアスキャン結果の自動アラート化 | ✅ 解決済み |
| [KB-069](./infrastructure/ansible-deployment.md#kb-069-ipアドレス管理の変数化ansible-group_varsallyml) | IPアドレス管理の変数化（Ansible group_vars/all.yml） | ✅ 解決済み |
| [KB-070](./infrastructure/miscellaneous.md#kb-070-運用モード可視化ネットワークモード自動検出api) | 運用モード可視化（ネットワークモード自動検出API） | ✅ 解決済み |
| [KB-071](./infrastructure/security.md#kb-071-tailscale導入とssh接続設定) | Tailscale導入とSSH接続設定 | ✅ 解決済み |
| [KB-078](./infrastructure/security.md#kb-078-複数ローカルネットワーク環境でのvnc接続設定) | 複数ローカルネットワーク環境でのVNC接続設定 | ✅ 解決済み |
| [KB-079](./infrastructure/security.md#kb-079-phase7セキュリティテストの実施結果と検証ポイント) | Phase7セキュリティテストの実施結果と検証ポイント | ✅ 解決済み |
| [KB-178](./infrastructure/security.md#kb-178-ログの機密情報保護実装x-client-keyのredacted置換) | ログの機密情報保護実装（x-client-keyの[REDACTED]置換） | ✅ 解決済み（2026-01-18） |
| [KB-259](./infrastructure/security.md#kb-259-本番jwt秘密鍵のfail-fast化とkioskレート制限のredis共有化) | 本番JWT秘密鍵のFail-fast化とkioskレート制限のRedis共有化 | ✅ 解決済み（2026-02-13） |
| [KB-260](./infrastructure/ansible-deployment.md#kb-260-デプロイ後にapiが再起動ループするjwt秘密鍵が弱い値で上書きされる) | デプロイ後にAPIが再起動ループする（JWT秘密鍵が弱い値で上書きされる） | ✅ 解決済み（2026-02-14） |
| [KB-261](./infrastructure/ansible-deployment.md#kb-261-デプロイ時の環境変数検証エラー一時的な失敗だが最終的には成功) | デプロイ時の環境変数検証エラー（一時的な失敗だが最終的には成功） | ✅ 解決済み（2026-02-14） |
| [KB-263](./infrastructure/ansible-deployment.md#kb-263-pi5のみデプロイ時にメンテナンスフラグが残存する問題) | Pi5のみデプロイ時にメンテナンスフラグが残存する問題 | ✅ 解決済み（2026-02-14） |
| [KB-264](./infrastructure/security.md#kb-264-tailscale-acl-grants形式でのポート指定エラーtagserver22形式が無効) | Tailscale ACL grants形式でのポート指定エラー（tag:server:22形式が無効） | ✅ 解決済み（2026-02-17） |
| [KB-265](./infrastructure/security.md#kb-265-tailscaleハードニング段階導入完了横移動面削減) | Tailscaleハードニング段階導入完了（横移動面削減） | ✅ 解決済み（2026-02-17） |
| [KB-266](./infrastructure/security.md#kb-266-nfcストリーム端末分離の実装完了acl維持横漏れ防止) | NFCストリーム端末分離の実装完了（ACL維持・横漏れ防止） | ✅ 解決済み（2026-02-18） |
| [KB-277](./infrastructure/security.md#kb-277-tailscale経由でのvnc接続問題acl設定不足) | Tailscale経由でのVNC接続問題（ACL設定不足） | ✅ 解決済み（2026-02-28） |
| [KB-278](./infrastructure/security.md#kb-278-クライアント端末管理の重複登録inventory未解決テンプレキー混入) | クライアント端末管理の重複登録（inventory未解決テンプレキー混入） | ✅ 解決済み（2026-02-28） |
| [KB-293](./infrastructure/security.md#kb-293-pi4pi3のrealvnc接続復旧pi5経由sshトンネル方式) | Pi4/Pi3のRealVNC接続復旧（Pi5経由SSHトンネル方式） | ✅ 解決済み（2026-03-06） |
| [KB-309](./infrastructure/security.md) | GitHub メンテナ衛生（ForceMemo / GlassWorm 系サプライチェーン対策手順とトラブルシュート） | ✅ 記録（2026-03-20） |
| [KB-317](./infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する) | Ubuntu LocalLLM を Tailscale sidecar + `tag:llm` で分離公開する | ✅ 手順確立済み（2026-03-28） |
| [KB-318](./infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env) | Pi5 LocalLLM: API コンテナへは `docker.env` 経由（`apps/api/.env` のみでは届かない） | ✅ 解決済み（2026-03-28） |
| [KB-319](./infrastructure/ansible-deployment.md#kb-319-docs-placement-policy-by-host-role) | `docs/` 配置: Pi5（server）保持・Pi4/Pi3 削除・`git status` の `D docs/...` はクライアントで仕様 | ✅ 解決済み（2026-03-28） |
| [KB-280](./infrastructure/security.md#kb-280-pi4追加時のkiosk-browserservice起動エラーchromium-browserコマンド未検出) | Pi4追加時のkiosk-browser.service起動エラー（chromium-browserコマンド未検出） | ✅ 解決済み（2026-02-28） |
| [KB-281](./infrastructure/security.md#kb-281-pi4-kiosk-browser対策のansible恒久化と実機デプロイ検証到達不可端末の切り分け含む) | Pi4 kiosk-browser対策のAnsible恒久化と実機デプロイ検証（到達不可端末の切り分け含む） | ✅ 解決済み（2026-02-28） |
| [KB-080](./infrastructure/signage.md#kb-080-pi4キオスクがtailscale-url固定でレイアウトが旧状態のままになる) | Pi4キオスクがTailscale URL固定で旧レイアウトのままになる | 🔄 進行中 |
| [KB-081](./infrastructure/signage.md#kb-081-pi3サイネージのpdftools画面が新デザインへ更新されない) | Pi3サイネージが新デザインへ更新されない | 🔄 進行中 |
| [KB-082](./infrastructure/signage.md#kb-082-管理コンソールでsplitを指定してもサイネージapiが常にtoolsを返す) | SPLIT指定でもサイネージAPIがTOOLSを返す | ✅ 解決済み |
| [KB-083](./infrastructure/signage.md#kb-083-サイネージカードレイアウトが崩れる2カラム固定サムネ比率) | サイネージカードレイアウトが崩れる（2カラム固定・サムネ比率） | ✅ 解決済み |
| [KB-084](./infrastructure/signage.md#kb-084-サイネージsvgレンダラーでカード内テキストが正しい位置に表示されない) | サイネージSVGレンダラーでカード内テキストが正しい位置に表示されない | ✅ 解決済み |
| [KB-085](./infrastructure/signage.md#kb-085-サイネージtools左ペインを3列化右ペインの更新文言削除) | サイネージTOOLS左ペインを3列化・右ペインの更新文言削除 | ✅ 解決済み |
| [KB-086](./infrastructure/signage.md#kb-086-pi3サイネージデプロイ時のsystemdタスクハング問題) | Pi3サイネージデプロイ時のsystemdタスクハング問題 | ✅ 解決済み |
| [KB-087](./infrastructure/signage.md#kb-087-pi3-status-agenttimer-再起動時のsudoタイムアウト) | Pi3 status-agent.timer 再起動時のsudoタイムアウト | ✅ 解決済み |
| [KB-088](./infrastructure/signage.md#kb-088-prisma-p3009-signage-migrations-既存型が残存し-migrate-deploy-失敗) | Prisma P3009 (Signage migrations) 既存型が残存し migrate deploy 失敗 | ✅ 解決済み |
| [KB-089](./infrastructure/signage.md#kb-089-pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング) | Pi3デプロイ時のサイネージサービス自動再起動によるメモリ不足ハング | ✅ 解決済み |
| [KB-092](./infrastructure/miscellaneous.md#kb-092-pi4キオスクのgpuクラッシュ問題) | Pi4キオスクのGPUクラッシュ問題 | 🔄 一時的解決 |
| [KB-127](./infrastructure/signage.md#kb-127-サイネージuiで自端末の温度表示機能追加とデザイン変更) | サイネージUIで自端末の温度表示機能追加とデザイン変更 | ✅ 解決済み |
| [KB-150](./infrastructure/signage.md#kb-150-サイネージレイアウトとコンテンツの疎結合化実装完了) | サイネージレイアウトとコンテンツの疎結合化実装完了 | ✅ 解決済み |
| [KB-152](./infrastructure/signage.md#kb-152-サイネージページ表示漏れ調査と修正) | サイネージページ表示漏れ調査と修正 | ✅ 解決済み |
| [KB-153](./infrastructure/signage.md#kb-153-pi3デプロイ失敗signageロールのテンプレートディレクトリ不足) | Pi3デプロイ失敗（signageロールのテンプレートディレクトリ不足） | ✅ 解決済み |
| [KB-154](./infrastructure/signage.md#kb-154-splitモードで左右別pdf表示に対応) | SPLITモードで左右別PDF表示に対応 | ✅ 解決済み |
| [KB-155](./infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了) | CSVダッシュボード可視化機能実装完了 | ✅ 解決済み |
| [KB-156](./infrastructure/signage.md#kb-156-複数スケジュールの順番切り替え機能実装) | 複数スケジュールの順番切り替え機能実装 | ✅ 解決済み |
| [KB-193](./infrastructure/signage.md#kb-193-csvダッシュボードの列幅計算改善フォントサイズ反映全行考慮列名考慮) | CSVダッシュボードの列幅計算改善（フォントサイズ反映・全行考慮・列名考慮） | ✅ 解決済み |
| [KB-228](./infrastructure/signage.md#kb-228-生産スケジュールサイネージデザイン修正タイトルkpi配置パディング統一) | 生産スケジュールサイネージデザイン修正（タイトル・KPI配置・パディング統一） | ✅ 解決済み |
| [KB-231](./infrastructure/signage.md#kb-231-生産スケジュールサイネージアイテム高さの最適化20件表示対応) | 生産スケジュールサイネージアイテム高さの最適化（20件表示対応・履歴上限50件は2026-03-31追記） | ✅ 解決済み |
| [KB-321](./infrastructure/signage.md#kb-321-キオスク進捗一覧スロットkiosk_progress_overviewのサイネージ表示デプロイ実機検証) | キオスク進捗一覧フルスロット（`kiosk_progress_overview`）のサイネージ表示・デプロイ・Phase12 実機検証・4列×2段レイアウト | ✅ 解決済み（2026-04-01 初回・2026-03-31 2段化本番反映） |
| [KB-335](./infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) | キオスク順位ボード・資源CDカード（`kiosk_leader_order_cards`）JPEG・工場視認性（タイポ/1行ヘッダ/トークン分割）・`cardsPerPage` 1〜8 | ✅ 解決済み（2026-04-08・Pi5 のみ・readability 本番・Phase12 PASS 43/0/0） |
| [KB-337](./infrastructure/signage.md#kb-337-android-signage-lite-401-chrome) | Android 軽量 `/signage-lite`・`current-image` **401**（未登録 `apiKey`・`heartbeat`）と **Chrome サイトデータ／キャッシュ** によるページのみ不整合 | ✅ 解決手順確定（2026-04-08・実機） |
| [KB-339](./KB-339-mobile-placement-barcode-survey.md) | 配膳スマホ V1/V2/V3/V5/V6/V7 — 現場バーコードの意味確定・V2 照合/部品配膳（`OrderPlacementEvent`）・V3 棚番登録専用ページ・**V5 現品票画像 OCR**・**V6 OCR 可観測性/UI/パーサ本番**・**V7 OCR 用途別パイプライン本番** | ✅ KB・API・Web・Runbook 整合（2026-04-11 本番 V7/V6/V5/V3/V2・2026-04-10 V1・**AQUOS 実機は Runbook 手順で確認**） |
| [KB-322](./infrastructure/signage.md#kb-322-管理コンソールサイネージスケジュール一覧無効レコードの再編集api分離) | 管理コンソール サイネージスケジュール一覧（無効レコードの再編集・`GET /api/signage/schedules/management`） | ✅ 解決済み（2026-04-01） |
| [KB-325](./infrastructure/signage.md#kb-325-split-compact24-loan-cards-pi5-git) | SPLIT・貸出カード `splitCompact24`（4×6・layoutConfig・Pi5 正本・デプロイ検証・ワークツリー `root` 権限） | ✅ 解決済み（2026-04-03・`main` マージ後 CI 確認） |
| [KB-331](./infrastructure/signage.md#kb-331-signage-loan-grid-html-modern-chrome-stonebase-only) | 貸出グリッド HTML モダン外皮（契約不変）・StoneBase01 のみ本番デプロイ・Pi5 正本との切り分け | ✅ 解決済み（2026-04-06） |
| [KB-232](./infrastructure/signage.md#kb-232-サイネージ未完部品表示ロジック改善表示制御正規化動的レイアウト) | サイネージ未完部品表示ロジック改善（表示制御・正規化・動的レイアウト） | ✅ 解決済み |
| [KB-269](./infrastructure/signage.md#kb-269-サイネージ自動レンダリングをworker化してapiイベントループ詰まりを隔離) | サイネージ自動レンダリングをworker化してAPIイベントループ詰まりを隔離 | 🔄 継続観察 |
| [KB-233](./infrastructure/ansible-deployment.md#kb-233-デプロイ時のsudoパスワード問題ansible_connection-localでもmac側から実行される場合) | デプロイ時のsudoパスワード問題（ansible_connection: localでもMac側から実行される場合） | ✅ 解決済み |
| [KB-234](./infrastructure/ansible-deployment-performance.md#kb-234-ansibleデプロイが遅い段階展開重複タスク計測欠如の整理と暫定対策) | Ansibleデプロイが遅い（段階展開/重複タスク/計測欠如の整理と暫定対策） | 🔄 進行中 |
| [KB-235](./infrastructure/ansible-deployment.md#kb-235-docker-build最適化変更ファイルに基づくbuild判定) | Docker build最適化（変更ファイルに基づくbuild判定） | ✅ 解決済み |
| [KB-237](./infrastructure/ansible-deployment.md#kb-237-pi4キオスクの再起動シャットダウンボタンが機能しない問題) | Pi4キオスクの再起動/シャットダウンボタンが機能しない問題 | ✅ 解決済み |
| [KB-285](./infrastructure/ansible-deployment.md#kb-285-電源操作再起動シャットダウンのボタン押下から発動まで約20秒かかる) | 電源操作（再起動/シャットダウン）のボタン押下から発動まで約20秒かかる | ✅ 原因特定済み（2026-03-01） |
| [KB-300](./infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時) | Pi4デプロイ時のキオスクフェーズハング（server:kiosk 並列実行時） | ✅ 解決済み（2026-03-09） |
| [KB-238](./infrastructure/ansible-deployment.md#kb-238-update-all-clientsshでraspberrypi5対象時にraspi_server_host必須チェックを追加) | update-all-clients.shでraspberrypi5対象時にRASPI_SERVER_HOST必須チェックを追加 | ✅ 解決済み |
| [KB-099](./infrastructure/backup-restore.md#kb-099-dropbox-oauth-20実装時のdocker-compose設定ファイルボリュームの読み書き権限問題) | Dropbox OAuth 2.0実装時のDocker Compose設定ファイルボリュームの読み書き権限問題 | ✅ 解決済み |
| [KB-100](./infrastructure/ansible-deployment.md#kb-100-ciテストが失敗してもマージが進んでしまう問題再発) | CIテストが失敗してもマージが進んでしまう問題（再発） | ⚠️ 部分解決 |
| [KB-101](./infrastructure/ansible-deployment.md#kb-101-pi5へのssh接続不可問題の原因と解決) | Pi5へのSSH接続不可問題の原因と解決 | ✅ 解決済み |
| [KB-102](./infrastructure/backup-restore.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) | Ansibleによるクライアント端末バックアップ機能実装時のAnsibleとTailscale連携問題 | ✅ 解決済み |
| [KB-103](./infrastructure/backup-restore.md#kb-103-バックアップ対象ごとのストレージプロバイダー指定機能実装-phase-1-2) | バックアップ対象ごとのストレージプロバイダー指定機能実装（Phase 1-2） | ✅ 解決済み |
| [KB-104](./infrastructure/backup-restore.md#kb-104-バックアップ対象ごとの保持期間設定と自動削除機能実装-phase-3) | バックアップ対象ごとの保持期間設定と自動削除機能実装（Phase 3） | ✅ 解決済み |
| [KB-105](./infrastructure/backup-restore.md#kb-105-dropboxリストアui改善バックアップパス手動入力からドロップダウン選択へ) | DropboxリストアUI改善（バックアップパス手動入力からドロップダウン選択へ） | ✅ 解決済み |
| [KB-106](./infrastructure/backup-restore.md#kb-106-バックアップスクリプトとの整合性確認) | バックアップスクリプトとの整合性確認 | ✅ 解決済み |
| [KB-107](./infrastructure/backup-restore.md#kb-107-dropboxストレージプロバイダーのエラーハンドリング改善) | Dropboxストレージプロバイダーのエラーハンドリング改善 | ✅ 解決済み |
| [KB-108](./infrastructure/backup-restore.md#kb-108-gmail-oauth認証時のtailscale-dns解決問題とetchosts設定) | Gmail OAuth認証時のTailscale DNS解決問題と`/etc/hosts`設定 | ✅ 解決済み |
| [KB-290](./infrastructure/backup-restore.md#kb-290-dropbox容量不足の恒久対策チャンクアップロード自動削除再試行) | Dropbox容量不足の恒久対策（チャンクアップロード・自動削除・再試行） | ✅ 解決済み |
| [KB-109](./frontend.md#kb-109-csvインポートスケジュールページのui統一バックアップペインと同じui) | CSVインポートスケジュールページのUI統一（バックアップペインと同じUI） | ✅ 解決済み |
| [KB-110](./infrastructure/ansible-deployment.md#kb-110-デプロイ時の問題リモートにプッシュしていなかった標準手順を無視していた) | デプロイ時の問題（リモートにプッシュしていなかった、標準手順を無視していた） | ✅ 解決済み |
| [KB-128](./infrastructure/ansible-deployment.md#kb-128-apiエンドポイントのhttps化caddy経由) | APIエンドポイントのHTTPS化（Caddy経由） | ✅ 解決済み |
| [KB-129](./infrastructure/ansible-deployment.md#kb-129-pi5サーバー側のstatus-agent設定ファイルが古い設定のまま) | Pi5サーバー側のstatus-agent設定ファイルが古い設定のまま | ✅ 解決済み |
| [KB-142](./infrastructure/ansible-deployment.md#kb-142-ansibleでenv再生成時に環境変数が消失する問題slack-webhook-url) | Ansibleで`.env`再生成時に環境変数が消失する問題（Slack Webhook URL） | ✅ 解決済み |
| [KB-143](./infrastructure/ansible-deployment.md#kb-143-ansibleでenv再生成時にdropbox設定が消失する問題と恒久対策) | Ansibleで`.env`再生成時にDropbox設定が消失する問題と恒久対策 | ✅ 解決済み |
| [KB-145](./infrastructure/ansible-deployment.md#kb-145-backupjson新規作成時にgmail設定が消失する問題と健全性チェック追加) | backup.json新規作成時にGmail設定が消失する問題と健全性チェック追加 | ✅ 解決済み |
| [KB-157](./infrastructure/ansible-deployment.md#kb-157-pi3のstatus-agenttimerが無効化されていた問題) | Pi3のstatus-agent.timerが無効化されていた問題 | ✅ 解決済み |
| [KB-158](./infrastructure/miscellaneous.md#kb-158-macのstatus-agent未設定問題とmacos対応) | Macのstatus-agent未設定問題とmacOS対応 | ✅ 解決済み |
| [KB-159](./infrastructure/ansible-deployment.md#kb-159-トークプラザ工場へのマルチサイト対応実装inventory分離プレフィックス命名規則) | トークプラザ工場へのマルチサイト対応実装（inventory分離・プレフィックス命名規則） | ✅ 解決済み |
| [KB-160](./infrastructure/ansible-deployment.md#kb-160-デプロイスクリプトのinventory引数必須化誤デプロイ防止) | デプロイスクリプトのinventory引数必須化（誤デプロイ防止） | ✅ 解決済み |
| [KB-161](./infrastructure/backup-restore.md#kb-161-dropbox-basepathの分離対応拠点別フォルダ分離) | Dropbox basePathの分離対応（拠点別フォルダ分離） | ✅ 解決済み |
| [KB-162](./infrastructure/ansible-deployment.md#kb-162-デプロイスクリプトのinventoryplaybookパス相対パス修正pi5上での実行時) | デプロイスクリプトのinventory/playbookパス相対パス修正（Pi5上での実行時） | ✅ 解決済み |
| [KB-172](./infrastructure/ansible-deployment.md#kb-172-デプロイ安定化機能の実装プリフライトロックリソースガードリトライタイムアウト) | デプロイ安定化機能の実装（プリフライト・ロック・リソースガード・リトライ・タイムアウト） | ✅ 解決済み |
| [KB-173](./infrastructure/ansible-deployment.md#kb-173-alerts-platform-phase2のdb取り込み実装と空ファイル処理の改善) | Alerts Platform Phase2のDB取り込み実装と空ファイル処理の改善 | ✅ 解決済み |
| [KB-174](./infrastructure/ansible-deployment.md#kb-174-alerts-platform-phase2後続実装db版dispatcher-dedupe-retrybackoffの実機検証完了) | Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了 | ✅ 解決済み |
| [KB-175](./infrastructure/ansible-deployment.md#kb-175-alerts-platform-phase2完全移行db中心運用の実機検証完了) | Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了 | ✅ 解決済み |
| [KB-176](./infrastructure/ansible-deployment.md#kb-176-slack通知チャンネル分離のデプロイトラブルシューティング環境変数反映問題) | Slack通知チャンネル分離のデプロイトラブルシューティング（環境変数反映問題） | ✅ 解決済み |
| [KB-179](./infrastructure/backup-restore.md#kb-179-dropbox証明書ピニング問題api-dropboxapi-comの新しい証明書フィンガープリント追加) | Dropbox証明書ピニング問題（api.dropboxapi.comの新しい証明書フィンガープリント追加） | ✅ 解決済み |
| [KB-180](./infrastructure/backup-restore.md#kb-180-バックアップ対象の追加pi5pi4pi3の環境設定ファイル) | バックアップ対象の追加（Pi5/Pi4/Pi3の環境設定ファイル） | ✅ 解決済み |
| [KB-181](./infrastructure/backup-restore.md#kb-181-ui表示問題の修正dropbox設定の新構造対応) | UI表示問題の修正（Dropbox設定の新構造対応） | ✅ 解決済み |
| [KB-182](./infrastructure/ansible-deployment.md#kb-182-pi4デプロイ検証結果デプロイ安定化機能の動作確認) | Pi4デプロイ検証結果（デプロイ安定化機能の動作確認） | ✅ 検証完了 |
| [KB-183](./infrastructure/ansible-deployment.md#kb-183-pi4デプロイ時のキオスクメンテナンス画面表示機能の実装) | Pi4デプロイ時のキオスクメンテナンス画面表示機能の実装 | ✅ 実装完了 |
| [KB-191](./infrastructure/ansible-deployment.md#kb-191-デプロイは成功したのにdbが古いテーブル不存在) | デプロイは成功したのにDBが古い（テーブル不存在） | ✅ 解決済み |
| [KB-192](./infrastructure/ansible-deployment.md#kb-192-node_modulesがroot所有になりdeployshのpnpm-installが失敗する) | node_modulesがroot所有になり、deploy.shのpnpm installが失敗する | ✅ 解決済み |
| [KB-193](./infrastructure/ansible-deployment.md#kb-193-デプロイ標準手順のタイムアウトコンテナ未起動問題の徹底調査結果) | デプロイ標準手順のタイムアウト・コンテナ未起動問題の徹底調査結果 | ✅ 解決済み |
| [KB-200](./infrastructure/ansible-deployment.md#kb-200-デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能) | デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能 | ✅ 解決済み |
| [KB-203](./infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新) | 本番環境でのprisma db seed失敗と直接SQL更新 | ✅ 解決済み |
| [KB-210](./infrastructure/miscellaneous.md#kb-210-pi3pi4でwi-fi認証ダイアログが時々表示される問題) | Pi3/Pi4でWi-Fi認証ダイアログが時々表示される問題 | ✅ 解決済み |
| [KB-211](./infrastructure/miscellaneous.md#kb-211-pi4キオスクでchromiumのサポートされていないコマンドラインフラグ警告メッセージが表示される問題) | Pi4キオスクでChromiumの「サポートされていないコマンドラインフラグ」警告メッセージが表示される問題 | ✅ 解決済み |
| [KB-212](./infrastructure/miscellaneous.md#kb-212-cursorチャットログの安全な削除手順1週間より前のログ削除) | Cursorチャットログの安全な削除手順（1週間より前のログ削除） | ✅ 手順確立済み |
| [KB-216](./infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) | Pi3デプロイ時のpost_tasksでunreachable=1が発生するがサービスは正常動作している | ✅ 調査完了・対応不要 |
| [KB-217](./infrastructure/ansible-deployment.md#kb-217-デプロイプロセスのコード変更検知とdocker再ビルド確実化) | デプロイプロセスのコード変更検知とDocker再ビルド確実化 | ✅ 解決済み |
| [KB-218](./infrastructure/ansible-deployment.md#kb-218-ssh接続失敗の原因fail2banによるip-ban存在しないユーザーでの認証試行) | SSH接続失敗の原因: fail2banによるIP Ban（存在しないユーザーでの認証試行） | ✅ 解決済み |
| [KB-219](./infrastructure/ansible-deployment.md#kb-219-pi5のgit権限問題gitディレクトリがroot所有でデタッチ実行が失敗) | Pi5のGit権限問題: `.git`ディレクトリがroot所有でデタッチ実行が失敗 | ✅ 解決済み |
| [KB-220](./infrastructure/ansible-deployment.md#kb-220-nodesourceリポジトリのgpg署名キー問題sha1が2026-02-01以降拒否される) | NodeSourceリポジトリのGPG署名キー問題: SHA1が2026-02-01以降拒否される | ✅ 解決済み |
| [KB-222](./infrastructure/ansible-deployment.md#kb-222-デプロイ時のinventory混同問題inventory-talkplazaymlとinventoryymlの混同) | デプロイ時のinventory混同問題: inventory-talkplaza.ymlとinventory.ymlの混同 | ✅ 解決済み |
| [KB-224](./infrastructure/ansible-deployment.md#kb-224-デプロイ時のマイグレーション未適用問題) | デプロイ時のマイグレーション未適用問題 | ✅ 解決済み |
| [KB-226](./infrastructure/ansible-deployment.md#kb-226-デプロイ方針の見直しpi5pi4以上はdetach-follow必須) | デプロイ方針の見直し（Pi5+Pi4以上は`--detach --follow`必須） | ✅ 解決済み |
| [KB-227](./infrastructure/ansible-deployment.md#kb-227-web-bundleデプロイ修正コード更新時のdocker再ビルド確実化) | Web bundleデプロイ修正: コード更新時のDocker再ビルド確実化 | ✅ 解決済み |
| [KB-141](./infrastructure/docker-caddy.md#kb-141-caddyがすべてのapi要求にwebsocketアップグレードヘッダーを強制する問題) | CaddyがすべてのAPI要求にWebSocketアップグレードヘッダーを強制する問題 | ✅ 解決済み |

---

## 📝 記録フォーマット

各課題は以下のフォーマットで記録します：

```markdown
### [課題ID] 課題名

**EXEC_PLAN.md参照**: Phase X / Surprises & Discoveries (行番号)
**事象**: 
- 何が起きたか（エラーメッセージ、症状など）

**要因**: 
- なぜ起きたか（根本原因）

**試行した対策**: 
- [試行1] 対策内容 → 結果（成功/失敗）
- [試行2] 対策内容 → 結果（成功/失敗）
- ...

**有効だった対策**: 
- 最終的に有効だった対策

**学んだこと**: 
- この経験から学んだこと、今後同じ問題を避けるための知見

**関連ファイル**: 
- 関連するファイルのパス
```

---

## 📊 統計

| 状態 | 件数 |
|------|------|
| ✅ 解決済み | 152件 |
| ✅ 手順確立済み | 2件 |
| ✅ 実装完了・実機検証完了 | 3件 |
| ✅ 検証完了 | 2件 |
| ✅ 調査完了・対応不要 | 1件 |
| 🔄 進行中 | 6件 |
| 🔄 調査中 | 1件 |
| **合計** | **171件** |

---

## 📅 更新履歴

- 2025-11-18: 初版作成（KB-001〜KB-004）
- 2025-11-19: KB-005〜KB-017を追加
- 2025-11-20: KB-018〜KB-019を追加
- 2025-11-24: KB-020〜KB-021を追加
- 2025-11-25: EXEC_PLAN.mdのSurprises & Discoveriesから解決済み課題を追加
- 2025-11-26: KB-023〜KB-024を追加
- 2025-11-27: カテゴリ別にファイルを分割（リファクタリング）
- 2025-11-28: KB-030〜KB-036を追加（HTTPS設定、WebSocket Mixed Content、YAML構文エラー、ロケール設定、useEffect重複処理、履歴画面画像表示）
- 2025-11-28: KB-037〜KB-039を追加（カメラプレビューCPU負荷、カメラ撮影CPU100%、CPU温度取得Docker対応）
- 2025-11-28: KB-040を追加（返却一覧の自動更新が不要だった問題）
- 2025-11-28: KB-041を追加（Wi-Fi変更時のIPアドレス設定が手動で再ビルドが必要だった問題）
- 2025-11-28: KB-042を追加（pdf-popplerがLinux（ARM64）をサポートしていない問題）
- 2025-11-28: KB-043を追加（KioskRedirectが/adminパスでも動作してしまい、管理画面にアクセスできない問題）
- 2025-11-28: KB-044を追加（PDFアップロード時のmultipart処理エラー）
- 2025-11-29: KB-045〜KB-046を追加（サイネージのタイムゾーン問題、工具データ表示問題、PDFスライド問題、サムネイルアスペクト比問題）
- 2025-11-29: KB-047を追加（履歴画面のサムネイル拡大表示で401エラーが発生する問題）
- 2025-11-29: KB-048〜KB-049を追加（NFCエージェントのDockerビルドでuvicorn/gccが見つからない問題）
- 2025-11-30: KB-050を追加（軽量サイネージクライアントが自己署名証明書で画像を取得できない問題）
- 2025-11-30: KB-051〜KB-053を追加（サイネージPDFスライドショー、sharp合成エラー、SIGNAGE_RENDER_DIR不一致）
- 2025-11-30: KB-054を追加（サイネージ工具表示で日本語が文字化けする問題）
- 2025-11-30: KB-055を追加（サイネージPDFがトリミングされて表示される問題）
- 2025-11-30: KB-056を追加（工具スキャンが二重登録される問題、NFCエージェントのキュー処理改善）
- 2025-12-01: KB-057を追加（SSH接続でホスト名解決が失敗しパスワード認証が通らない問題）
- 2025-12-01: KB-058を追加（Ansible接続設定でRaspberry Pi 3/4への接続に失敗する問題）
- 2025-12-01: KB-059を追加（ローカルアラートシステムのDockerコンテナ内からのファイルアクセス問題）
- 2025-12-01: KB-060を追加（Dockerコンテナ内からNFCリーダー（pcscd）にアクセスできない問題）
- 2025-12-01: KB-061を追加（Ansible実装後の設定ファイル削除問題と堅牢化対策）
- 2025-12-01: KB-062を追加（Ansible設定ファイル管理化の実装）
- 2025-12-02: KB-063を追加（WebSocket接続エラー502: Caddyの環境変数置換が機能しない）
- 2025-12-02: KB-064を追加（Pi4キオスクでカメラが起動しない: facingModeの指定方法の問題）
- 2025-12-02: KB-065を追加（カメラエラーメッセージが表示されない: デバッグログの出力条件が厳しすぎる）
- 2025-12-02: KB-066を追加（ラズパイ3でのAnsibleデプロイ失敗: サイネージ稼働中のリソース不足・自動再起動・401エラー）
- 2025-12-04: KB-067を追加（工具スキャンが重複登録される問題: NFCエージェントのeventId永続化対策）
- 2025-12-04: KB-068を追加（写真撮影持出のサムネイルが真っ黒になる問題: 輝度チェック対策）
- 2025-12-04: KB-069を追加（IPアドレス管理の変数化: Ansible group_vars/all.yml）
- 2025-12-04: KB-070を追加（運用モード可視化: ネットワークモード自動検出API）
- 2025-12-04: KB-071を追加（Tailscale導入とSSH接続設定）
- 2025-12-05: KB-072を追加（Pi5のUFW適用とHTTPSリダイレクト強化）
- 2025-12-05: KB-073を追加（Caddyアクセスログとfail2banの連携）
- 2025-12-05: KB-074を追加（Pi5のマルウェアスキャン自動化）
- 2025-12-05: KB-075を追加（Pi4キオスクの軽量マルウェア対策）
- 2025-12-05: KB-076を追加（fail2ban連携のセキュリティ監視タイマー）
- 2025-12-05: KB-077を追加（マルウェアスキャン結果の自動アラート化）
- 2025-12-06: KB-084を追加（サイネージSVGレンダラーでカード内テキストが正しい位置に表示されない）、KB-083を解決済みに更新
- 2025-12-11: KB-091を追加（NFC/カメラ入力のスコープ分離: 別ページからのイベント横漏れ防止）
- 2025-12-11: KB-094を追加（サイネージ左ペインで計測機器と工具を視覚的に識別できない）
- 2025-12-16: KB-101を追加（Pi5へのSSH接続不可問題の原因と解決）
- 2025-12-29: KB-109を追加（CSVインポートスケジュールページのUI統一: バックアップペインと同じUI）
- 2025-12-29: KB-110を追加（デプロイ時の問題: リモートにプッシュしていなかった、標準手順を無視していた）
- 2025-12-29: KB-111を追加（CSVインポートスケジュールの表示を人間が読みやすい形式に変更）
- 2026-01-03: KB-124を追加（キオスクSlackサポート機能の実装と実機検証完了）
- 2026-01-03: KB-125を追加（キオスク専用従業員リスト取得エンドポイント追加、キオスクお問い合わせフォームのデザイン変更）
- 2026-01-03: KB-126を追加（キオスクUIで自端末の温度表示機能追加）
- 2026-01-03: KB-127を追加（サイネージUIで自端末の温度表示機能追加とデザイン変更）
- 2026-01-03: KB-128を追加（APIエンドポイントのHTTPS化（Caddy経由））
- 2026-01-04: KB-129を更新（Pi5サーバー側のstatus-agent設定のAnsible管理化実装完了を反映）
- 2026-01-04: KB-130を追加（Pi5のストレージ使用量が異常に高い問題（Docker Build Cacheとsignage-rendered履歴画像の削除））
- 2026-01-04: KB-131を追加（APIコンテナがSLACK_KIOSK_SUPPORT_WEBHOOK_URL環境変数の空文字で再起動ループする問題）
- 2026-01-05: KB-132〜KB-141を追加（WebRTCビデオ通話機能の実装過程で発生した問題と解決策: シグナリングルート問題、@fastify/websocket問題、keepalive対策、cleanup早期実行、recvonlyフォールバック、srcObjectバインディング、WebSocket接続管理、localStorage互換性、CaddyのWebSocketヘッダー問題）
- 2026-01-08: KB-150、KB-152、KB-153、KB-154、KB-155を追加（サイネージレイアウトとコンテンツの疎結合化実装完了、サイネージページ表示漏れ調査と修正、Pi3デプロイ失敗（signageロールのテンプレートディレクトリ不足）、SPLITモードで左右別PDF表示に対応、CSVダッシュボード可視化機能実装完了）
- 2026-01-09: KB-157、KB-158を追加（Pi3のstatus-agent.timerが無効化されていた問題、Macのstatus-agent未設定問題とmacOS対応）
- 2026-01-14: KB-159、KB-160、KB-161、KB-162を追加（トークプラザ工場へのマルチサイト対応実装、デプロイスクリプトのinventory引数必須化、Dropbox basePathの分離対応、デプロイスクリプトのinventory/playbookパス相対パス修正）
- 2026-01-15: KB-163、KB-164、KB-165、KB-166、KB-167、KB-168を追加（git cleanによるbackup.json削除問題と根本的改善、Dropboxからのbackup.json復元方法、Gmail OAuth設定の復元方法、Gmail OAuthルートの新構造対応修正、旧キーと新構造の衝突問題と解決方法）
- 2026-01-18: KB-172を追加（デプロイ安定化機能の実装（プリフライト・ロック・リソースガード・リトライ・タイムアウト））
- 2026-01-18: KB-173を追加（Alerts Platform Phase2のDB取り込み実装と空ファイル処理の改善）
- 2026-01-18: KB-174を追加（Alerts Platform Phase2後続実装（DB版Dispatcher + dedupe + retry/backoff）の実機検証完了）
- 2026-01-18: KB-175を追加（Alerts Platform Phase2完全移行（DB中心運用）の実機検証完了）
- 2026-01-19: KB-179、KB-180、KB-181を追加（Dropbox証明書ピニング問題の解決、バックアップ対象の追加、UI表示問題の修正）
- 2026-01-19: KB-182を追加（Pi4デプロイ検証結果：デプロイ安定化機能の動作確認）
- 2026-01-19: KB-183を追加（Pi4デプロイ時のキオスクメンテナンス画面表示機能の実装）
- 2026-01-09: KB-156を追加（複数スケジュールの順番切り替え機能実装）
- 2026-01-23: KB-193を追加（CSVダッシュボードの列幅計算改善：フォントサイズ反映・全行考慮・列名考慮）
- 2026-01-23: KB-194を追加（スケジュール自動実行時にバックアップ履歴が記録されない問題）
- 2026-01-23: KB-195を追加（Dropbox 409 Conflictエラー：labelサニタイズ未実施によるパス不正）
- 2026-01-24: KB-196を追加（旧キー自動削除機能の実装：backup.json保存時の自動クリーンアップ）
- 2026-01-24: KB-197、KB-198を追加（Dropbox選択削除のパス正規化不整合、retention.maxBackupsの仕様/実装差）
- 2026-01-28: KB-199を追加（Dropbox証明書ピニング検証失敗によるバックアップ500エラー）→ 2026-01-28に解決完了・実機検証完了（content.dropboxapi.comの新しい証明書フィンガープリント追加、手動バックアップ成功を確認）
- 2026-02-16: KB-199を更新（Dropbox証明書ピニング検証失敗の再発事例）→ 2026-02-16に解決完了・CI成功・デプロイ完了・実機検証完了（api/content/notify.dropboxapi.comの新しい証明書フィンガープリント追加、2/10以降失敗していたDropboxバックアップが復旧）
- 2026-01-28: KB-210を追加（Pi3/Pi4でWi-Fi認証ダイアログが時々表示される問題）→ 2026-01-28に解決完了（NetworkManager設定追加、キオスクブラウザ環境変数追加）、KB-211を追加（Pi4キオスクでChromiumの「サポートされていないコマンドラインフラグ」警告メッセージが表示される問題）→ 2026-01-28に解決完了（`--test-type`フラグ追加）
- 2026-01-05: KB-142を追加（Ansibleで`.env`再生成時に環境変数が消失する問題（Slack Webhook URL）と恒久対策）
- 2026-01-06: KB-143を追加（Ansibleで`.env`再生成時にDropbox設定が消失する問題と恒久対策、`backup.json`の存在保証と健全性チェック、実機検証完了）、KB-145を追加（backup.json新規作成時にGmail設定が消失する問題と健全性チェック追加）、KB-149を追加（バックアップ履歴ページに用途列を追加（UI改善）、実機検証完了）
- 2026-01-16: KB-171を追加（WebRTCビデオ通話機能が動作しない（KioskCallPageでのclientKey/clientId未設定）問題と解決策）
- 2026-01-XX: KB-184、KB-185、KB-186を追加（生産スケジュールキオスクページ実装、CSVダッシュボードのgmailSubjectPattern設定UI改善、CsvImportSubjectPatternモデル追加による設計統一）
- 2026-01-20: KB-187を追加（CSVインポートスケジュール作成時のID自動生成とNoMatchingMessageErrorハンドリング改善）
- 2026-01-21: KB-188を追加（CSVインポート実行エンドポイントでのApiError statusCode尊重）
- 2026-01-22: KB-189を追加（Gmailに同件名メールが溜まる場合のCSVダッシュボード取り込み仕様）
- 2026-01-22: KB-190を追加（Gmail OAuthのinvalid_grantでCSV取り込みが500になる）
- 2026-01-22: KB-191を追加（デプロイは成功したのにDBが古い（テーブル不存在）・デプロイ検証強化）
- 2026-01-23: KB-192を追加（node_modulesがroot所有になりdeploy.shのpnpm installが失敗する）
- 2026-01-24: KB-193を追加（デプロイ標準手順のタイムアウト・コンテナ未起動問題の徹底調査結果）→ 2026-01-24に改善実装完了（down後回し、中断時復旧、ログ永続化）
- 2026-01-25: KB-200を追加（デプロイ標準手順のfail-fastチェック追加とデタッチ実行ログ追尾機能）→ 2026-01-25に実装完了・実機検証完了（Pi5/Pi4/Pi3へのデプロイ成功）
- 2026-01-26: KB-201、KB-202、KB-203を追加（生産スケジュールCSVダッシュボードの差分ロジック改善とバリデーション追加、生産スケジュールキオスクページの列名変更とFSEIBAN全文表示、本番環境でのprisma db seed失敗と直接SQL更新）→ 2026-01-26に実装完了・実機検証完了
- 2026-01-27: KB-201を更新（FSEIBANバリデーション修正: `********`（8個のアスタリスク）を明示的に許可）、KB-204を追加（CSVインポートスケジュール実行ボタンの競合防止と409エラーハンドリング）→ 2026-01-27に実装完了・実機検証完了（Gmail経由CSV取り込み成功、`********`も正常に取得）
- 2026-01-26: KB-205、KB-206を追加（生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側・フロントエンド側））→ 2026-01-26に実装完了・CI成功・Mac実機検証完了（Pi4での実機検証は明日実施予定）
- 2026-01-27: KB-207を追加（生産スケジュールUI改善（チェック配色/OR検索/ソフトキーボード））→ 2026-01-27に実装完了・CI成功・デプロイ成功・実機検証完了（Mac・Pi4）
- 2026-01-27: KB-208を追加（生産スケジュールUI改良・API拡張（資源CDフィルタ・加工順序割当・検索状態同期・AND検索））→ 2026-01-27に実装完了・CI成功・デプロイ成功・実機検証完了（Mac・Pi4）
- 2026-01-29: KB-212を追加（生産スケジュール行ごとの備考欄追加機能）→ 2026-01-29に実装完了・CI成功・デプロイ成功・実機検証完了（Pi5/Pi4/Pi3）
- 2026-01-28: KB-209を追加（生産スケジュール検索状態の全キオスク間共有化）→ 2026-01-28に実装完了・CI成功・デプロイ成功・実機検証完了（複数キオスク間での検索状態共有が正常に動作）
- 2026-01-28: KB-205を更新（資源CD単独検索の無効化・Pi4の動作速度改善）→ 2026-01-28に実装完了・CI成功・デプロイ成功・実機検証完了（Pi4で正常に動作、動作速度が改善）
- 2026-01-28: KB-210を追加（生産スケジュール検索登録製番の端末間共有ができなくなっていた問題の修正）→ 2026-01-28に実装完了・CI成功・デプロイ成功・実機検証完了（端末間共有が正常に動作）
- 2026-01-28: KB-212を追加（Cursorチャットログの安全な削除手順（1週間より前のログ削除））→ 2026-01-28に手順確立済み（バックアップ手順、削除方法、トラブルシューティングを含む完全な手順書を作成）
- 2026-01-28: KB-213を追加（セキュリティ評価の実機検証（2026-01-28））→ 2026-01-28に検証完了（ポート露出・fail2ban・security-monitorは正常動作を確認、バックアップ/復元・USBオフライン運用は再実施が必要）
- 2026-01-28: KB-214を追加（ルーターのデフォルト設定によるポート露出評価の誤解解消）→ 2026-01-28に評価修正完了（IODATA UD-LTA/UEのデフォルト設定を確認し、「外部露出」ではなく「ローカルネットワーク内での待受」と表現を修正）
- 2026-01-29: KB-215を追加（Gmail OAuthリフレッシュトークンの7日間制限問題）→ Google Cloud Consoleでアプリが未検証状態のため7日でトークン失効。GitHub Pagesでプライバシーポリシーを公開し、Googleへ検証リクエスト中
- 2026-01-31: KB-217を追加（デプロイプロセスのコード変更検知とDocker再ビルド確実化）→ 2026-01-31に実装完了・CI成功・デプロイ成功・実機検証完了（コード変更検知とDocker再ビルドが正常に動作、サイネージ可視化ダッシュボード機能も統合）
- 2026-01-31: KB-218を追加（Docker build時のtsbuildinfo問題）→ 2026-01-31に解決完了・CI成功・デプロイ成功・実機検証完了（`.dockerignore`に`tsbuildinfo`除外を追加し、Docker内で常に新しいビルドが実行されるように修正）
- 2026-01-31: KB-218を追加（SSH接続失敗の原因: fail2banによるIP Ban（存在しないユーザーでの認証試行））→ 2026-01-31に解決完了（誤ったユーザー名`tsudatakashi`での認証試行によりfail2banがBan、RealVNC経由でBan解除）、KB-219を追加（Pi5のGit権限問題: `.git`ディレクトリがroot所有でデタッチ実行が失敗）→ 2026-01-31に解決完了（Ansibleの`become: true`により`.git`がroot所有に、所有権を`denkon5sd02`に修正）、KB-183を更新（Pi4メンテナンス画面の修正: `--limit raspberrypi4`以外でも表示されるように改善）
- 2026-02-01: KB-226を更新（デプロイ方針の見直し: リモート実行のデフォルトデタッチ化実装）→ 2026-02-01に実装完了・デプロイ成功・実機検証完了（リモート実行時に自動的にデタッチモードで実行されること、`--foreground`オプションで前景実行可能なこと、`--attach`/`--status`でログ追尾・状態確認が正常に動作することを確認）
- 2026-02-01: KB-220を追加（NodeSourceリポジトリのGPG署名キー問題: SHA1が2026-02-01以降拒否される）→ 2026-02-01に解決完了（Debianセキュリティポリシーの変更によりSHA1が拒否され、NodeSourceリポジトリを削除してデプロイ成功）
- 2026-02-01: KB-221を追加（生産スケジュール納期日機能のUI改善（カスタムカレンダーUI実装））→ 2026-02-01に実装完了・CI成功・デプロイ成功・実機検証完了（カスタムカレンダーUI、今日/明日/明後日ボタン、自動確定、月ナビゲーション、React Hooksルール違反修正）
- 2026-02-01: KB-222を追加（デプロイ時のinventory混同問題: inventory-talkplaza.ymlとinventory.ymlの混同）→ 2026-02-01に解決完了（inventory混同によりDNS名でデプロイ試行→失敗、標準手順（Tailscale IP経由）に戻してデプロイ成功）
- 2026-02-01: KB-223を追加（生産スケジュール備考のモーダル編集化と処理列追加）→ 2026-02-01に実装完了・CI成功・デプロイ成功・実機検証完了（備考モーダル編集化、備考2行表示、処理列追加、品番/製造order番号折り返し対応、データ整合性考慮）
- 2026-02-01: KB-224を追加（デプロイ時のマイグレーション未適用問題）→ 2026-02-01に解決完了（デプロイ完了後にマイグレーションが未適用だったため、手動で`pnpm prisma migrate deploy`を実行して適用、デプロイ後チェックリストの徹底を確認）
- 2026-02-02: KB-225を追加（キオスク入力フィールド保護ルールの実装と実機検証）→ 2026-02-02に実装完了・実機検証完了（入力フィールド削除・localStorage無効化・起動時防御・自動復旧機能を実装、IDとAPIキーが編集不可に改善、生産スケジュールの値が表示されることを確認）
- 2026-02-03: KB-211を追加（生産スケジュール検索登録製番の削除・追加が巻き戻る競合問題（CAS導入））→ 2026-02-03に実装完了・CI成功・デプロイ成功・実機検証完了（ETag/If-Matchによる楽観的ロック実装、409 Conflict時の自動再試行、登録製番同期・登録・削除がすべて正常動作、サイネージへの反映も正常動作）
- 2026-02-03: KB-227を追加（Web bundleデプロイ修正: コード更新時のDocker再ビルド確実化）→ 2026-02-03に実装完了・デプロイ成功・実機検証完了（`force_docker_rebuild`フラグ導入、`git pull`前後でHEAD比較、Ansibleへの変数渡し、Docker再ビルドタスクの`when`条件修正、Web bundleが確実に再ビルドされることを確認）
- 2026-02-03: KB-228を追加（生産スケジュールサイネージデザイン修正: タイトル・KPI配置・パディング統一）→ 2026-02-03に実装完了・CI成功・デプロイ成功・実機検証完了（タイトル「生産進捗」に変更、KPIチップ右端配置で重なり防止、サブタイトル削除、カード左右パディング16px統一、視認性向上を確認）
- 2026-02-06: KB-229、KB-230を追加（Gmail認証切れ時のSlack通知機能追加、Gmail認証切れの実機調査と回復）→ 2026-02-06に実装完了・CI成功・デプロイ成功（CSVインポート定期実行時にGmail認証切れを検知してSlack通知、opsチャンネルにルーティング、dedupeで連続通知を抑制、手動実行時は通知しない）
- 2026-02-06: KB-231を追加（生産スケジュール登録製番上限の拡張（8件→20件）とサイネージアイテム高さの最適化）→ 2026-02-06に実装完了・CI成功・デプロイ成功・動作確認完了（API側・フロントエンド側・サイネージ側の上限を20件に統一、サイネージカード高さを半分に最適化、20件表示が正常に動作することを確認）
- 2026-02-06: KB-232を追加（サイネージ未完部品表示ロジック改善）→ 2026-02-06に実装完了・CI成功・デプロイ成功・実機検証完了（データソース側で未完部品を正規化・ソート・制限、レンダラー側で動的行数計算と表示制御、共通ユーティリティ追加、未完部品名が適切に表示され右端で切れないことを確認）
- 2026-02-06: KB-233を追加（デプロイ時のsudoパスワード問題）→ 2026-02-06に解決完了（`ansible_connection: local`でもMac側から実行するとMac側のsudoパスワードが求められる問題を、`RASPI_SERVER_HOST`設定でPi5上でリモート実行することで解決、デプロイ成功を確認）
- 2026-02-07: KB-236を追加（Pi3 signage-lite.serviceのxsetエラーによる起動失敗と再起動ループ）→ 2026-02-07に実装完了・CI成功・デプロイ完了（`signage-display.sh`の`xset`コマンドに`|| true`を追加してエラーで終了しないように変更、エラーが発生した場合は警告ログを出力するが処理は続行、`set -euo pipefail`を使用する場合の必須でないコマンドのエラーハンドリングを改善）
- 2026-02-08: KB-236を更新（Pi3デプロイ時のサービス再起動成功を確認）→ 2026-02-08に実機検証完了（Pi3標準手順に従って`--limit "server:signage"`でデプロイを実行、preflightチェックが正しく実行され、サービス再起動が`Result=success`で完了、xsetエラーが発生しても警告ログが出力されサービスが継続することを確認、runId: `20260208-082138-11782`）
- 2026-02-08: KB-237を追加（Pi4キオスクの再起動/シャットダウンボタンが機能しない問題）→ 2026-02-08に調査・修正・デプロイ完了・実機検証完了（3つの原因を発見・修正: Jinja2テンプレート展開の問題、systemd serviceの実行ユーザー問題、ディレクトリ所有権の問題。`pi5-power-dispatcher.sh.j2`にテンプレート展開ロジック追加、`pi5-power-dispatcher.service.j2`に`User=denkon5sd02`・`WorkingDirectory`・`StandardOutput/StandardError=journal`追加。CI成功、デプロイ成功、Pi4キオスクの再起動ボタンが正常動作することを確認）
- 2026-02-08: KB-238を追加（update-all-clients.shでraspberrypi5対象時にRASPI_SERVER_HOST必須チェックを追加）→ 2026-02-08に実装完了・CI成功（`RASPI_SERVER_HOST`未設定で`raspberrypi5`を対象にした場合、Mac側でローカル実行になりsudoパスワードエラーが発生する問題を解決。`require_remote_host_for_pi5()`関数を追加し、`raspberrypi5`または`server`が対象の場合、`REMOTE_HOST`が必須であることをチェック。未設定時はエラーで停止するように修正。CI全ジョブ成功、修正後の動作確認完了）
- 2026-02-08: KB-239を追加（キオスクヘッダーのデザイン変更とモーダル表示位置問題の解決（React Portal導入））→ 2026-02-08に実装完了・CI成功・デプロイ成功・実機検証完了（管理コンソールボタンを歯車アイコンに変更、サイネージプレビューボタン追加、再起動/シャットダウンボタンを電源アイコン1つに統合。CSS `filter`プロパティが`position: fixed`に与える影響をReact Portalで回避。E2Eテストの安定化（`scrollIntoViewIfNeeded`とEscキー操作）も実装）
- 2026-02-08: KB-240を追加（モーダル共通化・アクセシビリティ標準化・E2Eテスト安定化）→ 2026-02-08に実装完了・CI成功・デプロイ成功（共通Dialogコンポーネント作成、キオスク全モーダル統一、サイネージプレビューのFullscreen API対応、ConfirmDialogとuseConfirm実装、管理コンソールのwindow.confirm置換、アクセシビリティ標準化、E2Eテスト安定化。CI修正（import順序、Trivy脆弱性、E2Eテストstrict mode violation）も完了）
- 2026-02-09: KB-241を追加（WebRTCビデオ通話の常時接続と着信自動切り替え機能実装）→ 2026-02-09に実装完了・CI成功・デプロイ成功（`WebRTCCallProvider`と`CallAutoSwitchLayout`を実装し、`/kiosk/*`と`/signage`の全ルートでシグナリング接続を常時維持。着信時に`/kiosk/call`へ自動遷移、通話終了後に元のパスへ自動復帰。Pi3の通話対象除外機能を実装。APIレベルでの動作確認完了、実機検証待ち）
- 2026-02-10: KB-242を追加（生産スケジュール登録製番削除ボタンの進捗連動UI改善）→ 2026-02-10に実装完了・CI成功・デプロイ成功・キオスク動作検証OK（`SeibanProgressService`を新設、`GET /kiosk/production-schedule/history-progress`を追加、`ProductionScheduleDataSource`を共通サービス利用へ切替、`useProductionScheduleHistoryProgress`フックと削除ボタン進捗連動スタイルを実装。Pi5＋Pi4でデプロイ成功、登録製番の進捗表示と削除ボタンの色切替が正常に動作）
- 2026-02-10: KB-243を追加（WebRTCビデオ通話の映像不安定問題とエラーダイアログ改善）→ 2026-02-10に実装完了・CI成功・デプロイ成功・実機検証完了（`useWebRTC`で`localStream`/`remoteStream`をstateで保持し、`ontrack`更新時にUI再描画を確実化。`pc.ontrack`で受信トラックを単一MediaStreamに集約。`disableVideo()`でtrackをstop/removeせず`enabled=false`に変更。`enableVideo()`で既存trackがあれば再有効化、新規は`replaceTrack`使用。`connectionState`/`iceConnectionState`の`disconnected/failed`検知時にICE restartで復旧。`KioskCallPage`で`alert()`を`Dialog`に置換し、`Callee is not connected`等をユーザー向け説明に変換。Pi5＋Pi4でデプロイ成功、通話開始直後に相手映像が表示されること、ビデオON/OFF時の相手側フリーズ回避、無操作時の接続維持、エラーダイアログの改善を確認）
- 2026-02-10: KB-244を追加（Pi4キオスクの備考欄に日本語入力状態インジケーターを追加）→ 2026-02-10に実装完了・デプロイ成功・実機検証完了（`KioskNoteModal.tsx`に`isComposing` stateを追加し、`compositionstart`/`compositionend`イベントで入力モードを検出。インジケーターを追加（日本語入力中: 「あ 日本語」、英字入力中: 「A 英字」）。切り替え方法（Ctrl+Space または Alt+`）を画面下部に表示。IBus設定の永続化も実装（`engines-order`を`['xkb:jp::jpn', 'mozc-jp']`に設定、`hotkey triggers`を`['<Control>space']`に設定）。Pi4再起動ボタンのエラーハンドリング改善も実施。Pi4でデプロイ成功（Run ID: 20260210-123251-3565, 20260210-124817-3570）、インジケーター表示とIBus設定を確認）
- 2026-02-10: KB-245を追加（Pi4のみのデプロイ時もメンテナンスフラグを自動クリアする修正とIBus設定の永続化）→ 2026-02-10に実装完了・デプロイ成功・実機検証完了（`deploy-staged.yml`の`post_tasks`を修正し、サーバーデプロイ完了フラグが存在しない場合でも、デプロイが成功していればメンテナンスフラグをクリア。IBus設定の永続化も実装（`kiosk/tasks/main.yml`にIBus設定タスクを追加）。Pi4のみのデプロイ（Run ID: 20260210-124817-3570）で、メンテナンスフラグが自動的にクリアされ、IBus設定が正しく適用されることを確認）
- 2026-02-10: KB-201を更新（製造order番号繰り上がりルールの実機検証完了・トラブルシューティング追加）→ 2026-02-10に実装完了・CI成功・デプロイ成功・実機検証完了（同一キーで`ProductNo`が複数ある場合、数字が大きい方のみを有効とするルールを実装。取り込み時と表示時の両方で適用。テスト失敗・SQL正規表現エラー・TypeScriptビルドエラーのトラブルシューティングを実施。実機検証で重複除去機能が正常動作することを確認）
- 2026-02-10: KB-247を追加（生産スケジュール登録製番削除ボタンの応答性問題とポーリング間隔最適化）→ 2026-02-10に調査・修正・デプロイ完了（×ボタンの応答性が若干落ちた気がするという報告を受け、KB-242で実装した完未完判定機能の4秒ポーリングが原因と特定。`useKioskProductionScheduleHistoryProgress()`の`refetchInterval`を`4000`→`30000`（30秒）に変更。`useKioskProductionScheduleSearchState()`と`useKioskProductionScheduleSearchHistory()`は4秒のまま維持。CI全ジョブ成功、Pi4キオスクにデプロイ成功（Run ID: 20260210-175259-15669, ok=91, changed=9, failed=0））
- 2026-02-11: KB-248を追加（カメラ明るさ閾値チェックの削除（雨天・照明なし環境での撮影対応））→ 2026-02-11に実装完了・CI成功・デプロイ成功・実機検証完了（雨天・照明なし環境で閾値0.1でも「写真が暗すぎます」エラーが発生する問題を調査。ストリーム保持によるPi4の負荷問題を回避するため、フロントエンド・バックエンドの両方で閾値チェックを削除。500ms待機＋5フレーム選択ロジックは維持。どんな明るさでも撮影可能にし、ユーザー体験を向上。Pi5＋Pi4でデプロイ成功、実機検証で正常動作を確認）
- 2026-02-11: KB-255を追加（`/api/kiosk` と `/api/clients` のルート分割・サービス層抽出（互換維持での実機検証））→ 2026-02-11に実装完了・CI成功・デプロイ成功・実機検証完了（`kiosk`/`clients` のモジュール分割とサービス層抽出、GitHub CI全ジョブ通過、Pi5限定デプロイ成功（runId: `20260211-220347-19394`）、主要導線の実機API検証で200系と認可ガードを確認）
- 2026-02-18: KB-267を追加（吊具持出画面に吊具情報表示を追加）→ 2026-02-18に実装完了・CI成功・デプロイ完了・実機検証完了（吊具持出画面に遷移したとき、吊具タグのUIDだけが表示されていた問題を解決し、吊具マスタから取得した詳細情報（名称、管理番号、保管場所、荷重、寸法）を点検見本の右側余白に表示する機能を実装。`riggingTagUid`が設定された時点で`getRiggingGearByTagUid()`を呼び出し、吊具情報をstateに保持。貸出登録時の存在チェックで、既に取得済みの`riggingGear`をref経由で再利用し、API二重呼び出しを回避。CI成功（Run ID `22126971043`）、Pi5とPi4でデプロイ成功（runId `20260218-140619-15371`）、実機検証で正常動作を確認）
- 2026-02-19: KB-270を追加（CIのvitest coverageでtest-excludeとminimatchの非互換エラー）→ 2026-02-19に解決完了・CI成功・デプロイ完了・実機検証完了（`test-exclude@6.0.0`が`minimatch@10.x`と非互換でCIが失敗する問題を、`test-exclude@7.0.1`へのoverride追加で解決。`.gitignore`に`.cursor/debug-*.log`と`.cursor/tmp/`を追加。CI成功（Run ID `22163832946`）、Pi5でデプロイ成功、実機検証で正常表示を確認）
- 2026-02-25: KB-274を追加（計測機器持出状況サイネージコンテンツの実装とCSVイベント連携）→ 2026-02-25に実装完了・CI成功・デプロイ完了・実機検証完了（計測機器の持出状況をサイネージで可視化する機能を実装。「加工担当部署」の従業員ごとに、本日使用中の計測機器数と名称を表示。`Employee`テーブルに`section`フィールドを追加し、CSVインポートと従業員編集画面に`section`フィールドを統合。データソースを`Loan`テーブルから`MeasuringInstrumentLoanEvent`テーブル（CSV由来イベント）へ修正。名前正規化とアクティブローン判定ロジックを実装。実機検証で従業員カード表示・計測機器数表示・計測機器名称表示が正常動作することを確認）
- 2026-02-25: KB-275を追加（加工機点検状況サイネージのレイアウト調整）→ 2026-02-25に実装完了・CI成功・デプロイ完了・実機検証完了（タイトルから「（日時集約）」を削除する処理を強化（正規表現で全角・半角・スペースのバリエーションに対応）、加工機名称の表示幅を拡大（左側60%→70%、パディング8px→4px）、KPIパネルの日付以外のタイトルフォントサイズを30%縮小、デザインプレビュー用タイトルから「(pane)」を削除。実機検証でタイトル表示・加工機名称表示・KPIパネル表示が正常動作することを確認）
- 2026-02-26: KB-276を追加（Pi4キオスクの日本語入力モード切替問題とIBus設定改善）→ 2026-02-26に実装完了・CI成功・デプロイ成功・実機検証完了（IBusパネルUIの二重起動を防止（`--replace --single`追加）、IBusエンジン設定のリトライロジック追加、IBus切替トリガーに全角/半角キーを追加。キー入力ごとに出現する「ibus-...」ウィンドウを完全に抑制し、全角/半角キーとCtrl+Spaceの両方で日本語入力モードに切り替わることを確認。Pi4でデプロイ成功（Run ID: 20260226-171548-20196）、スムーズな日本語入力が可能になったことを確認）
- 2026-02-28: KB-277を追加（Tailscale経由でのVNC接続問題（ACL設定不足））→ 2026-02-28に解決完了・実機検証完了（MacからPi5のVNCポート（5900）に接続できない問題を解決。原因はTailscaleのACLで`tag:admin` → `tag:server`の`tcp:5900`が許可されていなかったこと。Tailscale管理画面の「Access controls」で`grants`配列に`tcp:5900`を追加。wayvnc設定を`address=0.0.0.0`に変更（IPv4/IPv6両方で待ち受け）。`nc -zv 100.106.158.2 5900`が成功し、RealVNC Viewerで接続可能になったことを確認。mac-ssh-access.mdにTailscale ACL設定の説明を追加、port-security-audit.mdにTailscale経由のVNC接続について追記）
- 2026-02-28: KB-278を追加（クライアント端末管理の重複登録（inventory未解決テンプレキー混入））→ 2026-02-28に解決完了（`register-clients.sh`に未解決テンプレキー検知ガードと`DRY_RUN`モードを追加。`{{ ... }}` / `vault_` を含むキーをスキップするよう修正。既存の誤登録3件は`Loan`/`Transaction`参照0件を確認し、`ClientDevice_backup_20260228_dupfix`へバックアップ後に削除。実行後、クライアント件数は実機相当の5件に是正され、再実行しても増殖しないことを確認）
- 2026-02-28: KB-280を追加（Pi4追加時のkiosk-browser.service起動エラー（chromium-browserコマンド未検出））→ 2026-02-28に解決完了・実機検証完了（raspi4-robodrill01で`kiosk-browser.service`起動時に`chromium-browser: not found`エラーが発生。原因はDebian Trixieでは`chromium-browser`パッケージが存在せず`chromium`のみが利用可能なこと。`/usr/bin/chromium-browser` → `/usr/bin/chromium`のシンボリックリンクを作成して解決。`systemctl enable kiosk-browser.service`で自動起動を有効化し、`systemctl start kiosk-browser.service`でサービスを起動。実機検証でキオスクが正常動作することを確認。client-initial-setup.mdにkiosk-browser起動手順とchromium-browserシンボリックリンク作成手順を追加）
- 2026-02-28: KB-281を追加（Pi4 kiosk-browser対策のAnsible恒久化と実機デプロイ検証（到達不可端末の切り分け含む））→ 2026-02-28に解決完了・CI成功・デプロイ完了・実機検証完了（KB-280で手動復旧していた`chromium-browser: not found`対策を、Ansibleロールに恒久化。`infrastructure/ansible/roles/kiosk/tasks/main.yml`に`chromium`存在確認・未存在時fail-fast・シンボリックリンク自動作成タスクを追加。ローカル検証でAnsible構文チェック成功。CI成功（Run ID: `22513820001`）。標準デプロイスクリプトで実運用検証時、全台実行で`raspberrypi4`がSSH到達不可（`tailscale status`で`offline, last seen 19h ago`）を検出し、到達可能ホストへ`--limit`で継続デプロイ成功（Run ID: `20260228-141511-7945`）。実機検証で`raspi4-robodrill01`のシンボリックリンク・サービス状態・APIヘルスを確認）
- 2026-02-28: KB-282を追加（生産スケジュール登録製番ボタンの3段表示と機種名表示（全角半角大文字化））→ 2026-02-28に実装完了・CI成功・デプロイ成功・実機検証OK（登録製番ボタンを3段表示に変更し、機種名（FHINCDがMHで始まるアイテムのFHINMEI）を下2段に表示。`SeibanHistoryButton`コンポーネントを新設し、機種名は全角→半角変換＋大文字化。APIに`machineName`フィールドを追加。Pi5＋Pi4でデプロイ成功（Run ID: `20260228-170617-12957`）、実機検証で3段表示と機種名表示を確認）
- 2026-02-28: KB-283を追加（生産スケジュール検索条件の端末別localStorage保存）→ 2026-02-28に実装完了・CI成功・デプロイ成功・実機検証OK（検索条件を端末ごとにlocalStorageに保存し、画面遷移後も復元する機能を実装。`useProductionScheduleSearchConditions`フックを新設し、`schemaVersion`でバージョン管理。変更時は300ms debounceして保存。Pi5＋Pi4でデプロイ成功、実機検証で検索条件の復元を確認）
- 2026-02-28: KB-284を追加（生産スケジュールアイテム一覧からMHアイテムを除外）→ 2026-02-28に実装完了・CI成功・デプロイ成功・実機検証OK（FHINCDが"MH"で始まるアイテム（機種名を持つアイテム）を一覧から除外。`normalizedRows` useMemo内でフィルタリング。検索用製番ボタンにのみ表示。Pi5＋Pi4でデプロイ成功（Run ID: `20260228-184500-20184`）、実機検証で一覧除外を確認）
- 2026-03-01: KB-285を追加（電源操作（再起動/シャットダウン）のボタン押下から発動まで約20秒かかる）→ 2026-03-01に原因特定済み（電源機能SOLIDリファクタ実装後、実機検証で「ボタン押して20秒後に発動」と報告。多段構成（Pi4→Pi5 API→dispatcher→Ansible SSH→Pi4）に起因。poweroffで約21秒、rebootで約85秒。ロジックは正常。連打防止画面の追加をNext Stepsで検討。power-function-solid-refactor-execplan.mdを新設、KB調査ドキュメントを更新）
- 2026-03-02: KB-285を追加（生産スケジュールアイテム一覧からSHアイテムも除外し機種名表示にSH追加）→ 2026-03-02に実装完了・CI成功・デプロイ成功・実機検証OK（FHINCDが"SH"で始まるアイテムも一覧から除外。`normalizedRows` useMemo内でフィルタリング条件を拡張（MHまたはSH）。API側のSQL集約で`FHINCD LIKE 'MH%' OR FHINCD LIKE 'SH%'`の条件で機種名を取得。Pi5＋Pi4（raspberrypi4研削メイン）でデプロイ成功（Run ID: `20260302-140800-7286`）、実機検証でSH除外と機種名表示を確認）
- 2026-03-01: KB-286を追加（電源操作の連打防止オーバーレイ実装（React Portalによる表示失敗の解決））→ 2026-03-01に実装完了・CI成功・デプロイ成功・実機検証完了（API受理直後に黒画面オーバーレイを表示し、応答遅延中の連打を防止。FullScreenOverlay（createPortalでdocument.bodyにレンダリング）、PowerDebounceOverlay、KioskHeader統合。前回失敗（bae3802）の原因（backdrop-blur親の影響でposition: fixedがビューポート基準にならず）をReact Portalで解決。Pi5でデプロイ成功（Run ID: 20260301-133729-17849）、実機検証でオーバーレイ正常表示を確認）
- 2026-03-01: KB-287を追加（キオスク備考欄の日本語入力不具合（ibus-ui ウィンドウ出現で入力不安定））→ 2026-03-01に診断基盤を実装（scripts/kiosk/diagnose-ime.sh、infrastructure/ansible/roles/kiosk/tasks/diagnose-ime.yml）。デプロイ時にIBus状態がログに記録される。実機診断後の原因分析と対策は未実施。kiosk-ime-remark-field-execplan.md、runbooks/kiosk-ime-diagnosis.mdを新設
- 2026-03-02: KB-287を解決（研削メイン日本語入力スムーズ化）→ 2026-03-02に真因確定・対策実施・実機検証完了。inventory.yml の差異（kensakuMain に ibus_owner_mode/ibus_disable_competing_autostart 未設定）が原因。im-launch 由来の競合起動で ibus-ui-gtk3 がフォーカスを奪う。inventory に ibus_owner_mode: "single-owner" と ibus_disable_competing_autostart: true を追加。デプロイ（Run ID: 20260302-192312-6532）で反映。研削メインで日本語入力がスムーズにできることを実機確認
- 2026-03-01: KB-288を追加（電源操作・連打防止オーバーレイ不具合（power-actions バインドマウントの削除済み inode 参照））→ 2026-03-01に根本原因特定。APIコンテナの power-actions バインドマウントが削除・再作成された古い inode を参照。`mountinfo` で `//deleted` を確認。即時対処は API 再起動。KB-investigation-kiosk-ime-and-power-regression.md を更新
- 2026-03-02: KB-289を追加（Pi4 kensakuMain Firefox移行・Super+Shift+Pキーボードショートカット（上辺メニューバー表示））→ 2026-03-02に実装完了・デプロイ成功・実機検証OK。研削メイン（raspberrypi4）をChromiumからFirefoxに切り替え、labwc keybindでSuper+Shift+P押下時にwf-panel-piを表示。inventory.ymlにkiosk_browser_engine: "firefox"追加。show-kiosk-panel.sh.j2とlabwc rc.xmlのkeybindをAnsibleで配置。Pi5＋Pi4でデプロイ成功（Run ID: 20260302-152520-15777）。runbooks/kiosk-wifi-panel-shortcut.mdにSuperキー説明・トラブルシュート追記
- 2026-03-05: Pi4電源・連打防止実機検証完了 → 研削メイン（raspberrypi4）・raspi4-robodrill01 とも電源操作（再起動/シャットダウン）・連打防止オーバーレイが正常動作することを確認。KB-288、Runbook（kiosk-power-operation-recovery.md）、power-function-solid-refactor-execplan.md を更新
- 2026-03-05: KB-291を追加（ロボドリル01 NFCスキャンが反応しない調査・恒久対策）→ 2026-03-05に解決完了・デプロイ完了・実機検証OK。pcscd未導入/非稼働・Docker未導入が根因。nfc-agent-lifecycle.ymlでpcscd導入・起動・nfc-agent起動保証を実装。吊具・計測機器のNFCタグで画面遷移を実機確認。
- 2026-03-06: KB-294を追加（生産スケジュール資源CDボタン優先並び）→ 2026-03-06に実装完了・デプロイ完了・実機検証OK。登録製番検索時、検索結果に含まれる資源CDを左側に優先表示。`prioritizeResourceCdsByPresence` 純粋関数（resourcePriority.ts）、ProductionSchedulePage で prioritizedVisibleResourceCds を導出。Run ID `20260306-184128-18022`、約19分（Pi5+Pi4×2+Pi3）。
- 2026-03-06: KB-295を追加（生産スケジュール登録製番ボタン並び替えUI）→ 案3（カード下辺左右矢印）で実装。`moveHistoryItemLeft`/`moveHistoryItemRight` 純粋関数（historyOrder.ts）、SeibanHistoryButton に矢印追加、search-state で全端末同期。409 競合時は rebase して再試行。lint・ユニットテスト成功。
- 2026-03-24: KB-312を追加（吊具マスタ `idNum`（旧番号）・DB/API/管理UI/キオスク/CSV・デプロイ Pi5+raspberrypi4 成功・`raspi4-robodrill01` は preflight SSH timeout で別日再挑戦・`update-all-clients` 前の未コミット変更は stash 等で退避）。[KB-267](./frontend.md#kb-267-吊具持出画面に吊具情報表示を追加) に旧番号表示の拡張を追記。verification-checklist.md（6.4/6.6.3）・deploy-status-recovery.md・docs/INDEX.md・EXEC_PLAN.md を整合更新。
- 2026-03-23: KB-297 に「進捗一覧 納期・資源CDチップ重なり防止（オプションA）」節を追加（PR #35・`w-[78px]` / 資源 `pl-1`・Run ID `20260323-173508-8385` / `20260323-174036-12818` / `20260323-174600-1356`）。`verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**。deploy-status-recovery.md / EXEC_PLAN.md / docs/INDEX.md を整合更新。
- 2026-03-23: KB-297 に「実績基準時間 推定式見直し（`p75優先`→`縮小中央値`）」節を追加。実DB holdout 結果（2024評価）を記録し、採用式 `w=n/(n+3)` の縮小中央値へ変更。`actual-hours` 共通読取コンテキスト導入、query/scoring 経路統一、lookback 365日化を反映。ADR-20260323-actual-hours-baseline-estimation / EXEC_PLAN.md / docs/INDEX.md を整合更新。
- 2026-03-23: KB-297 に「進捗一覧 納期列コンパクト（`formatDueDateForProgressOverview`・`progressOverviewPresentation`）」節を追加。`verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（本番反映後の再検証）。deploy-status-recovery.md / EXEC_PLAN.md / docs/INDEX.md を整合更新（PR #33・Detach Run ID `20260323-161714-15600` / `20260323-162116-16052` / `20260323-162542-3008`）。
- 2026-03-23: KB-297 に「手動順番・全体ランキングの工場共有同期（`siteKey` 正本）」節を追加。`feat/sitekey-shared-manual-rank-sync` を Pi5+raspberrypi4+raspi4-robodrill01 へ順次デプロイ（Pi3 除外）、Phase12 **PASS 28 / WARN 0 / FAIL 0**。API 実測で手動順番と global-rank の端末間同期を確認。ADR-20260323 / deploy-status-recovery.md / EXEC_PLAN.md / docs/INDEX.md を整合更新。
- 2026-03-23: KB-297 に手動順番 Pi4 下ペイン「取得に失敗」節を追加（キオスクで `targetDeviceScopeKey` を送っていた Web 不具合を `macManualOrderV2` で修正・`ProductionSchedulePage` と整合）。Pi5+raspberrypi4+raspi4-robodrill01 順次デプロイ（Pi3 除外）・Phase12 **PASS 28 / WARN 0 / FAIL 0**。deploy-status-recovery.md / EXEC_PLAN.md / docs/INDEX.md を整合更新。
- 2026-03-22: KB-297 進捗一覧5列節を更新（`main` で Pi5+raspberrypi4+raspi4-robodrill01 順次デプロイ・Phase12 **PASS 27 / WARN 1 / FAIL 0**・`verify-phase12-real.sh` / `verify-services-real.sh` の Pi5 到達判定を **ICMP 再試行 + `-W 5`** に変更）→ Tailscale 高遅延で `ping -c 1 -W 2` が偶発失敗し Phase12 だけ落ちる事象の再発防止。deploy-status-recovery.md / EXEC_PLAN.md / docs/INDEX.md を整合更新。
- 2026-03-18: KB-306を追加（キオスク進捗一覧 製番フィルタ（ドロップダウン・端末別保存））→ 進捗一覧ヘッダーに製番フィルタを追加。候補は `scheduled` のみ、初期全ON、全OFF時は「フィルタで非表示にしています」を表示。状態は `localStorage`（schemaVersion付き）で端末別保存。`useProgressOverviewSeibanFilter` と `ProgressOverviewSeibanFilterDropdown` を新設し、ページ本体の責務を表示合成に限定。web lint/build 成功。**実機検証完了**: Phase12 全24項目PASS（progress-overview API を verify-phase12-real.sh に追加）、実機UIで製番フィルタ・永続化を確認。deploy-status-recovery.md にチェックリスト追加。知見: Mac から Tailscale 経由でブラウザアクセスすると自己署名証明書で chrome-error になるため、UI検証は実機/VNC での確認が必要。
- 2026-03-19: KB-308を追加（生産スケジュールUIが古いのに戻った事象（ブランチ分岐によるデプロイ内容ずれ））→ デプロイ後にUIが古いバージョンに戻った事象を調査。原因はデプロイブランチにUI統一が含まれていなかったこと。統合ブランチ `feat/production-schedule-ui-unify-caddy-secfix` を作成し、cherry-pick で Caddy 自前ビルドを統合。Dockerfile.web 衝突時は自前ビルド側を採用。デプロイ・実機検証完了、main マージ予定。
- 2026-03-20: KB-309を追加（GitHub メンテナ衛生・ForceMemo/GlassWorm 系を背景にしたチェックリスト）→ 2FA 有効化、期限切れ PAT 削除、セッション/SSH 確認、Cursor 拡張最小化、ローカルで `lzcdrtfxyqiplpd` 検索と `git push --dry-run` による認証確認を記録。外部調査（StepSecurity / Truesec / GitHub Blog）へのリンクとトラブルシュート表を `infrastructure/security.md` に集約。
- 2026-03-28（2回目）: 管理コンソール **`/admin/local-llm`**（`feat/admin-local-llm-ui-and-runbook`）・Runbook 実機検証メモ・Pi5→Pi4×4 順次デプロイ（Pi3 除外）・Tailscale 経由の health/401/upstream/admin URL 確認を EXEC_PLAN / Surprises / Next Steps / runbook / INDEX / ansible-deployment 索引説明に反映。[PR #53](https://github.com/denkoushi/RaspberryPiSystem_002/pull/53) で `main` へ統合。
- 2026-04-01: [KB-321](./infrastructure/signage.md#kb-321-キオスク進捗一覧スロットkiosk_progress_overviewのサイネージ表示デプロイ実機検証) を追加（キオスク進捗一覧フルスロット `kiosk_progress_overview`・本番順次デプロイ・Phase12 **PASS 38/0/0**・`verify-phase12-real.sh` に `current-image` スモーク追加）。サイネージ索引 **21件**。`docs/INDEX.md`・[verification-checklist.md](../guides/verification-checklist.md) 6.6.13・EXEC_PLAN を整合。**ブランチ** `feature/signage-kiosk-progress-overview` を **`main` へマージ**（2026-04-01）。
- 2026-04-01（LocalLLM）: [KB-318](./infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env) に **管理コンソール LocalLLM Chat・`503` + `LOCAL_LLM_RUNTIME_CONTROL_NOT_CONFIGURED`**（`on_demand` だが `LOCAL_LLM_RUNTIME_CONTROL_*` が `docker.env` 側で揃わず noop になるケース）のトラブルシュートを追記。ブランチ `fix/admin-local-llm-chat-on-demand`・Pi5 のみデプロイ・`verify-phase12-real.sh` **PASS 38/0/0**。ADR-20260403 / runbook / verification-checklist 6.6.12 / EXEC_PLAN / `docs/INDEX.md` を整合。**`main` へマージ**（PR 経由・CI 確認）。
- 2026-04-01（サイネージ管理 UI）: [KB-322](./infrastructure/signage.md#kb-322-管理コンソールサイネージスケジュール一覧無効レコードの再編集api分離) を追記・確定（管理コンソール **`GET /api/signage/schedules/management`**・公開 **`/schedules` は有効のみ**）。ブランチ `feat/signage-schedules-admin-list`・Pi5 のみデプロイ（Detach **`20260401-134910-13950`**）・`verify-phase12-real.sh` **PASS 39/0/0**。`docs/INDEX.md`・verification-checklist **6.6.15**・EXEC_PLAN Progress/Next Steps を整合。**`main` へマージ**: [PR #70](https://github.com/denkoushi/RaspberryPiSystem_002/pull/70)（CI **success**）。
- 2026-04-01（生産日程・部品納期個数補助）: [KB-297](./KB-297-kiosk-due-management-workflow.md#部品納期個数csvの補助反映2026-04-01) に **本番5台順次デプロイ**（Detach `20421618819` / `20421640357` / `20421660164` / `20421674891` / `20421685489`・各 `failed=0`）・**Phase12 `verify-phase12-real.sh` PASS 40/0/0**（`plannedQuantity` 応答含有の grep 追加）・ローカル統合テスト `localhost:5432` TS を追記。[csv-import-export.md](../guides/csv-import-export.md)・[verification-checklist.md](../guides/verification-checklist.md) **§6.6.16**・`docs/INDEX.md`・EXEC_PLAN Progress を整合。ブランチ **`feat/production-schedule-planned-supplement`** を **`main` へマージ**。
- 2026-04-01（追記）: [csv-import-export.md](../guides/csv-import-export.md#production-runbook-gmail-csv-dashboard-import-via-ssh-and-api) に **Gmail→`csvDashboards` 本番登録の SSH/API/Prisma Runbook**（管理コンソール代替・固定 ID ダッシュボード・`POST /api/imports/schedule`・手動 run の `{}`・分刻み衝突回避・トラブルシュート）を追加。[KB-297](./KB-297-kiosk-due-management-workflow.md)・`docs/INDEX.md`・§6.6.16・EXEC_PLAN Progress を整合。
- 2026-04-01（表示用納期 effectiveDueDate・計画列 UI）: [KB-297](./KB-297-kiosk-due-management-workflow.md#表示用納期-effectiveduedate計画列-ui2026-04-01) に **API `effectiveDueDate` / `effectiveDueDateSource`**・**Web 指示数・着手日・手動納期強調**・本番5台 Detach Run ID（`20260401-201019-17368` … `20260401-202901-20217`）・**Phase12 PASS 40/0/0**・**seiban 手動スモーク**・ローカル DB/マイグレ TS を追記。`verification-checklist.md` **§6.6.17**・`docs/INDEX.md`・EXEC_PLAN（Progress・Decision Log・Next Steps）を整合。**`main` へマージ**: [PR #71](https://github.com/denkoushi/RaspberryPiSystem_002/pull/71)（merge `abb425b5`）。
- 2026-04-02（Gmail・部品納期個数・補助同期）: [KB-324](./KB-324-gmail-order-supplement-prisma-transaction.md) — 上記修正を本番反映（Pi5→Pi4×4 を `--limit` 1 台ずつ・Pi3 除外・各 PLAY `failed=0`）。`csv-import-export.md` TS 表・`verification-checklist.md` §6.6.16・`EXEC_PLAN.md` Progress 追記。**`main` へマージ済**（マージ後 CI 確認推奨）。
- 2026-04-02（リーダー順位ボード・UX polish）: [KB-297](./KB-297-kiosk-due-management-workflow.md#ux-polish-leader-order-board-2026-04-02) に **子行「n個」**・**機種名 `normalizeMachineName`（`machineName` のみ）**・**`kioskRevealUi`（transition / ホバー閉じ遅延）**・本番5台・**Phase12 PASS 40/0/0** を追記。`verification-checklist.md` **§6.6.18**・`docs/INDEX.md`・EXEC_PLAN を整合。ブランチ **`feat/kiosk-leader-order-board-ux-polish`** を **`main` へマージ**。
- 2026-04-02（リーダー順位ボード・順位変更 fast path）: [KB-297](./KB-297-kiosk-due-management-workflow.md#順位変更キャッシュ高速化leaderboardfastpath2026-04-02) に **`cachePolicy: leaderBoardFastPath`**（楽観パッチ・ロールバック・成功後 invalidate 省略・一覧に行が無いときは usage パッチ抑制）・本番5台順次・**Phase12 PASS 40/0/0** を追記。`verification-checklist.md` **§6.6.18**・`docs/INDEX.md`・EXEC_PLAN Progress / Next Steps を整合。ブランチ **`feat/kiosk-leader-order-board-order-cache-fast-path`** を **`main` へマージ**。
- 2026-04-02（リーダー順位ボード 行アクション）: [KB-297](./KB-297-kiosk-due-management-workflow.md#行アクション機種名フォールバック2026-04-02) に **完了トグル・順位ドロップダウン即時保存・左ペイン完了フィルタ・`history-progress` 機種名補完・bulk 納期反映削除**・**Phase12 PASS 40/0/0**（2026-04-02）を追記。`verification-checklist.md` **§6.6.18**・`docs/INDEX.md`・EXEC_PLAN Progress を整合。ブランチ **`feat/kiosk-leader-order-board-row-actions`** を **`main` へマージ**（PR マージ後に本行へ PR リンクを追記可）。
- 2026-04-02（リーダー順位ボード・納期アシスト・左2段スタック）: [KB-297](./KB-297-kiosk-due-management-workflow.md) に **左2段（ホットゾーン＋操作パネル＋詳細）・メインのみディム・Dialog `overlayZIndex`**・本番5台順次（各 `PLAY RECAP failed=0`）・**Phase12 PASS 40/0/0**（約 60s・Mac / Tailscale）を追記。`verification-checklist.md` **§6.6.19**・`docs/INDEX.md`・EXEC_PLAN Progress/Next Steps を整合。ブランチ **`feat/leaderboard-due-assist-left-stack`** を **`main` へマージ**（初期機能は `feat/leaderboard-due-assist`）。
- 2026-04-02（リーダー順位ボード・納期アシスト・初版）: [KB-297](./KB-297-kiosk-due-management-workflow.md) に **左・製番検索／共有履歴、右・部品一覧＋納期（製番／処理別）・既存 API のみ**・本番5台 Detach（`20260402-193759-29957` / `20260402-194158-24725` / `20260402-194636-6723` / `20260402-195000-30215` / `20260402-195451-6422`・各 `failed=0`）・**Phase12 PASS 40/0/0**（約 55s）を追記。`verification-checklist.md` **§6.6.19**・`docs/INDEX.md`・EXEC_PLAN Progress/Next Steps を整合。ブランチ **`feat/leaderboard-due-assist`** を **`main` へマージ**。
- 2026-04-03（リーダー順位ボード・子行レイアウト・左ホーバー登録製番パネル）: [KB-297](./KB-297-kiosk-due-management-workflow.md#leader-order-board-child-row-layout--registered-seiban-panel-2026-04-02) に **本番5台順次デプロイ**（Detach `20260403-073232-5264` / `20260403-073742-21502` / `20260403-074155-24422` / `20260403-074502-2900` / `20260403-074901-19118`・各 `failed=0`・**Pi3 除外**）・**Phase12 `verify-phase12-real.sh` PASS 40/0/0**（約 **25s**）・**排他ロック・Pi5先行の知見**・**TS** を追記。`verification-checklist.md` **§6.6.21**・`docs/INDEX.md`・EXEC_PLAN Progress を整合。ブランチ **`feat/leaderboard-card-and-hover-layout`** を **`main` へマージ**（マージ後 CI・PR リンク追記可）。
- 2026-04-09（キオスク要領書・ビューアスクロール安定化・本番反映）: [KB-313](./KB-313-kiosk-documents.md)（§実機検証）— ブランチ **`fix/kiosk-documents-viewer-scroll-stability`**・**Pi5 のみ** `--limit raspberrypi5`・Detach **`20260409-185355-5342`**（`failed=0`）・**Phase12 `verify-phase12-real.sh` PASS 43/0/0**（約 120s）。Trivy **CVE-2026-39883** は `.trivyignore`（CI 暫定）。Pi4 Ansible 未実施（SPA は Pi5 配信）。`docs/INDEX.md`・[kiosk-documents.md](../runbooks/kiosk-documents.md)・`EXEC_PLAN.md` を整合。**`main` へマージ**（PR 経由・CI 確認）。
- 2026-04-09（キオスク要領書・Gmail HTML・論理キー upsert 本番実測）: [KB-313](./KB-313-kiosk-documents.md)（§実機検証・**本番データ**）— **同一 HTML を別メール**で再送し、Pi5 **`KioskDocument`** で **`gmailLogicalKey` 維持・`gmailMessageId` / `gmailInternalDateMs` 更新・旧行 `enabled=false`**、**`pdf-pages`** で **JPEG 1490×2108** 再生成を確認。[kiosk-documents.md](../runbooks/kiosk-documents.md)・[kiosk-html-gmail-ingest-verification.md](../plans/kiosk-html-gmail-ingest-verification.md)・`EXEC_PLAN.md` Progress（Gmail 論理キー項）を整合。
- 2026-04-10（配膳スマホ V1）: [KB-339](./KB-339-mobile-placement-barcode-survey.md) — **現場バーコード採取ゲート**・`GET/POST /api/mobile-placement/*`・Prisma **`MobilePlacementEvent`**・Web **`/kiosk/mobile-placement`**（ZXing セッション再利用）。**本番**: [deployment.md](../guides/deployment.md)・Pi5→Pi4×4 **`--limit` 順次**・`verify-phase12-real.sh` **43/0/0**・**Pi3 対象外**（KB-339 追記・`main` **`8e1d0e3f`**）。**関連**: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)・[mobile-placement.md](../api/mobile-placement.md)・`docs/INDEX.md`。統合テストは **DB 起動環境**で実行（ローカル `localhost:5432` 未起動時は失敗し得る）。
- 2026-04-08（Android 軽量 `/signage-lite`・実機 401 / Chrome サイトデータ）: [KB-337](./infrastructure/signage.md#kb-337-android-signage-lite-401-chrome) — **`current-image` 401** は **`POST /api/clients/heartbeat`** で `ClientDevice` upsert。**`/signage-lite` のみ不調**時は **Chrome 閲覧データ削除**（Cookie・サイトデータ・キャッシュ）の実例。**関連**: [signage-client-setup.md](../guides/signage-client-setup.md#android-signage-lite)・`docs/INDEX.md`・`EXEC_PLAN.md` Progress / Surprises / Next Steps。**コード変更なし**（ドキュメント・`main` へ PR マージ想定）。
- 2026-04-08（サイネージ・順位ボード資源CDカード `kiosk_leader_order_cards`・readability / SOLID 分割）: [KB-335](./infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) — ブランチ **`feat/signage-leader-order-readability-solid`**・**Pi5 のみ** `--limit raspberrypi5`・Detach **`20260408-083856-28270`**（**`failed=0`**）・**Phase12 PASS 43/0/0**（約 **29s**・Mac / Tailscale）・**Pi3 は必須デプロイ対象外**。**`main` へマージ**: [PR #98](https://github.com/denkoushi/RaspberryPiSystem_002/pull/98)（マージ後 CI 確認推奨）。
- 2026-04-08（サイネージ・順位ボード資源CDカード `kiosk_leader_order_cards`・max 8 / SVG 分割）: [KB-335](./infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) — ブランチ **`feat/signage-leader-order-4x8-grid-solid`**・**Pi5 のみ** `--limit raspberrypi5`・Detach **`20260408-073202-31994`**（**`failed=0`**）・**Phase12 PASS 43/0/0**（約 **32s**・Mac / Tailscale）・**Pi3 は必須デプロイ対象外**。**`main` へマージ**: [PR #95](https://github.com/denkoushi/RaspberryPiSystem_002/pull/95)（マージ後 CI 確認推奨）。
- 2026-04-07（サイネージ・順位ボード資源CDカード `kiosk_leader_order_cards`）: [KB-335](./infrastructure/signage.md#kb-335-キオスク順位ボード資源cdカードkiosk_leader_order_cardsサイネージ-jpeg) — ブランチ **`feat/signage-leader-order-resource-cards`**・**Pi5 のみ** `--limit raspberrypi5`・Detach **`20260407-213958-2534`**（**`failed=0`**）・**Phase12 PASS 43/0/0**（約 **55s**・Mac / Tailscale）・**Pi3 は必須デプロイ対象外**（JPEG 正本は Pi5 API）。索引表・`docs/INDEX.md`・EXEC_PLAN Progress を整合。**`main` へマージ**: PR マージ後に本行へ PR リンクを追記可。
- 2026-04-07（サイネージ compact フッタ／キオスク取消視認性）: [KB-333](./KB-333-signage-compact24-footer-kiosk-cancel-readability.md) — **`fix/signage-compact24-footer-kiosk-readability`**。Pi5→Pi4×4→Pi3 **`--limit` 順次**・Detach `20260407-123124-27600` … `20260407-125547-7409`・**Phase12 PASS 43/0/0**。未追跡ファイルは deploy 前 **`git stash push -u`**。`docs/INDEX.md`・EXEC_PLAN Progress/Next Steps を整合。**`main` へマージ**（PR 経由・CI 確認）。
- 2026-04-06（貸出グリッド HTML モダン外皮・StoneBase のみ）: [KB-331](./infrastructure/signage.md#kb-331-signage-loan-grid-html-modern-chrome-stonebase-only) を追加 — ブランチ **`feat/signage-loan-grid-html-modern-chrome`**・**`--limit raspi4-kensaku-stonebase01` のみ**・Detach **`20260406-194743-26315`**・Pi5 hop 実機で **`kiosk-browser` / `status-agent.timer` active**。**知見**: サイネージ JPEG の見た目は **Pi5 API 正本**（StoneBase のみでは `current-image` が変わらない場合あり）。`docs/INDEX.md`・EXEC_PLAN Progress を整合。**`main` へマージ**（PR 経由・CI 確認）。
- 2026-04-03（Playwright 貸出グリッド・HTML トークン分離・順次デプロイ・Phase12）: [KB-327](./infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ) 追記 — **`loan-card-chrome` / `grid-card-html-tokens`** への整理（**エンジン切替・契約は不変**）。本番 **6 台**を `update-all-clients.sh` **`--limit` 1 台ずつ**・**`--foreground`**。Mac 側 **未追跡ファイル**は `git stash push -u` で退避可（`ensure_local_repo_ready_for_deploy`）。**`verify-phase12-real.sh` PASS 41/0/0**（約 59s）。`verification-checklist.md` **§6.6.22**・`docs/INDEX.md`・EXEC_PLAN Progress。ドキュメントコミットは **`main` へマージ**（PR 経由・CI 確認）。
- 2026-04-03（SPLIT・貸出グリッド Playwright / `SIGNAGE_LOAN_GRID_ENGINE`）: [KB-327](./infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ) — **`playwright_html` / `svg_legacy` 切替**・Ansible `docker.env.j2` / Pi5 `inventory` 恒久化・**API Docker コンテナへ env 未到達時はコードが新しくても `svg_legacy` のまま**の切り分け。[ADR-20260405](../decisions/ADR-20260405-signage-loan-grid-render-engine.md)。`docs/INDEX.md`・EXEC_PLAN Progress を整合。ブランチ **`feat/signage-loan-grid-html`** + env 恒久化を **`main` へマージ**（merge 例 `d98664ae`、マージ後 CI 確認）。
- 2026-04-04（生産日程・部品納期個数・調査ナレッジのみ）: [KB-328](./KB-328-production-schedule-supplement-key-mismatch-investigation.md) — **本体 winner 論理キーと補助3キーの関係**、`unmatched`・本体 `FHINCD` 取込失敗・上流の工程／資源変更・切削クエリで `FSIGENCD` 欠落の知見・**管理画面プレビュー／アップロード二重入力**・無効フラグ／非表示案の**判断材料（未採用決定）**を整理。[KB-297](./KB-297-kiosk-due-management-workflow.md)・[csv-import-export.md](../guides/csv-import-export.md) TS 表・`docs/INDEX.md` を整合。**コード変更なし**（ドキュメントコミット→`main` マージ想定）。
- 2026-04-03（SPLIT・貸出カード `splitCompact24`）: [KB-325](./infrastructure/signage.md#kb-325-split-compact24-loan-cards-pi5-git) — **`layoutConfig: SPLIT`** の loans ペインで 4×6・`loan-card-contracts.ts`・HTML プレビュー・Pi5 デプロイ正本・**リモート lock**／**ワークツリー `root` 所有**による `git reset` 失敗の TS。`deployment.md` 事前チェック・[KB-219](./infrastructure/ansible-deployment.md#kb-219-pi5のgit権限問題gitディレクトリがroot所有でデタッチ実行が失敗) 再発防止にリンク。`docs/INDEX.md`・EXEC_PLAN Progress / Next Steps を整合。ブランチ **`feat/signage-split-loans-4col-24`** を **`main` へマージ**（マージ後 CI 確認）。
- 2026-04-02（リーダー順位ボード・共有履歴・子行備考・機種名 POST）: [KB-297](./KB-297-kiosk-due-management-workflow.md) に **search-state 統一**・**`POST /kiosk/production-schedule/seiban-machine-names`**（最大100製番・trim/重複除去）・**子行備考（鉛筆・モーダル）**・本番5台順次（各 `PLAY RECAP failed=0`）・**Phase12 PASS 40/0/0**（約 54s・Mac / Tailscale）・TS を追記。`verification-checklist.md` **§6.6.20**・EXEC_PLAN・`docs/INDEX.md` を整合。ブランチ **`feat/kiosk-leader-board-shared-history-notes-machine-names`** を **`main` へマージ**（PR マージ後に URL 追記可）。
- 2026-04-01（キオスク持出一覧）: [KB-323](./KB-323-kiosk-return-card-button-layout.md) を追加（返却・取消ボタン**下段**・`KioskActiveLoanCard.tsx`・モーダル Blob URL `revoke`）。`verification-checklist.md` §6.6.4・`docs/INDEX.md`・`deployment-modules.md`・EXEC_PLAN Progress を整合。ブランチ `fix/kiosk-return-card-button-layout` を **`main` へマージ**: [PR #72](https://github.com/denkoushi/RaspberryPiSystem_002/pull/72)（マージ後 CI 確認）。
- 2026-03-31（3回目）: [KB-321](./infrastructure/signage.md#kb-321-キオスク進捗一覧スロットkiosk_progress_overviewのサイネージ表示デプロイ実機検証) に **JPEG 4列×2段**（`kiosk-progress-overview-layout.ts` / `kiosk-progress-overview-svg.ts`）、`seibanPerPage` 1〜8、本番 Detach Run ID、**ローカル pgvector** 注記を追記。`./scripts/deploy/verify-phase12-real.sh` **PASS 38/0/0**（刷新直後）。`docs/INDEX.md`・verification-checklist 6.6.13・EXEC_PLAN Progress/Next Steps・本索引を整合。**ブランチ** `feature/kiosk-progress-overview-two-row-grid` を **`main` へマージ**。
- 2026-03-31（2回目）: [KB-231](./api.md#kb-231-生産スケジュール登録製番上限の拡張8件20件とサイネージアイテム高さの最適化) に **登録製番上限 20→50**（`@raspi-system/shared-types` 集約）・製番ドロップダウン縦拡大・Trivy **CVE-2026-30836** の `.trivyignore` 対応・Pi5+Pi4×4 順次デプロイ（Pi3 除外）・`verify-phase12-real.sh` **PASS 37/0/0** を追記。[KB-297](./KB-297-kiosk-due-management-workflow.md)・[signage.md](./infrastructure/signage.md)・`docs/INDEX.md`・EXEC_PLAN を整合。**ブランチ** `feat/kiosk-production-schedule-registered-seiban-50` を **`main` へマージ**（2026-03-31）。
- 2026-03-31: **LocalLLM on_demand** の本番切り分け（**`upstream_http_403`**＝`LOCAL_LLM_SHARED_TOKEN` 不一致、**`runtime_ready` 直後の chat 503**）を [KB-313](./KB-313-kiosk-documents.md) / [KB-319](./KB-319-photo-loan-vlm-tool-label.md) / [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md) / [ADR-20260403](../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md) / [kiosk-documents.md](../runbooks/kiosk-documents.md) / EXEC_PLAN（Progress・Surprises・Next Steps）/ `docs/INDEX.md` に反映。API: **chat completions ベース readiness**（`http-on-demand-local-llm-runtime.controller.ts` ほか）。
- 2026-03-30: KB-319 に **運用知見（人レビューと GOOD ギャラリー・類似候補 vs シャドー閾値・VLM は再学習しない）**、`photo-loan.md` / [photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md) §3.0 / `docs/INDEX.md` / EXEC_PLAN（Progress・Surprises・Next Steps）を整合（コード変更なし）。
- 2026-03-29: KB-319 に **写真持出 埋め込み Ansible 配線・GOOD バックフィル・Pi5 のみデプロイ・Phase12 実機検証（PASS 34/0/0）・ローカル `run-tests.sh` の POSTGRES ポート切り分け**を追記。[photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md) に実機検証メモを追加。EXEC_PLAN Progress / Surprises / Next Steps を整合（`feat/photo-tool-embedding-rollout-shadow-eval` → `main` マージ後の運用タスクへ更新）。
- 2026-03-28（追記）: LocalLLM 可観測性・ADR-20260329・Pi5 単体デプロイ・**実機スモーク**（401 境界・api コンテナ→upstream `/healthz` 200・health degraded+DB ok）を EXEC_PLAN / Surprises / Next Steps / [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md) / docs/INDEX に反映。`main` は PR マージで統合。
- 2026-03-28: KB-318を追加（Pi5 LocalLLM: `LOCAL_LLM_*` は `docker.env.j2` / `infrastructure/docker/.env` 経由で API コンテナへ。`apps/api/.env` のみでは compose が読まない）→ Progress / Surprises / Next Steps / docs/INDEX / security KB-317 関連 / runbook / deployment 注記を整合。ansible-deployment 件数 47。
- 2026-03-28: KB-317を追加（Ubuntu LocalLLM を Tailscale sidecar + `tag:llm` で分離公開）→ Ubuntu ホスト全体ではなく、`localllm` 専用ディレクトリ配下の `tailscale`/`nginx`/`llama-server` スタックのみを tailnet に参加。入口は `38081`、内部推論は `127.0.0.1:38082`、ACL は `tag:server -> tag:llm: tcp:38081` のみ。`docker compose config` や `tailscale` 起動ログに `TS_AUTHKEY` が表示されうるため、参加後に revoke + ローカル削除する運用を記録。
- 2026-03-18: KB-307を追加（生産スケジュールUI統一（登録製番・資源CDドロップダウン併設））→ 生産スケジュールで登録製番をドロップダウン化（複数選択ON/OFF維持、削除/左右移動は非表示）、資源CDは横スクロールUIを維持しつつドロップダウン併設（通常/割当の両トグル）。資源名はドロップダウン内に併記し、ホバー表示を廃止。`ProductionScheduleResourceFilters` に `rightActions` を追加して右端縦ボタンレイアウトへ変更。`ProductionScheduleHistoryStrip` / `SeibanHistoryButton` / `historyOrder.ts` は未使用化に伴い削除。web lint/build 成功。**デプロイ・実機検証完了を反映**: ブランチ `feat/production-schedule-dropdown-ui-unify`、Pi5→raspberrypi4→raspi4-robodrill01 の順に1台ずつデプロイ。Phase12 24項目PASS、実機検証OK。CI Trivy（web イメージ）で Caddy/Go 由来 CVE 検出時は `.trivyignore` に該当 CVE を追記する運用を KB-307 に記載。
- 2026-03-05: KB-290を追加（Dropbox容量不足の恒久対策（チャンクアップロード・自動削除・再試行））→ 2026-03-05に解決完了・デプロイ完了・実機検証OK。Upload Session（チャンクアップロード）、`insufficient_space`検知時の最古優先削除＋再試行、DatabaseBackupTargetの一時ファイル経路改善、手動・スケジュールの救済ポリシー統一を実装。Pi5のみデプロイ（Run ID: 20260305-085419-3769）。手動CSVバックアップ（employees）成功、Dropboxアップロード成功、履歴に`dropbox`・`COMPLETED`で記録を確認。同日、同一ターゲット内削除限定（67c4de1）をデプロイ（Run ID: 20260305-093035-20970）。`listBackups({ prefix })`＋`matchesSource`でDB失敗時にCSVが消える種類偏りを防止。`POST /api/backup/internal`で実機検証成功