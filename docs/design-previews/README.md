# デザインプレビュー（静的 HTML）

本番アプリに接続していない **モック画面** です。UI コンセプトの共有・見た目確認用。

| ファイル | 説明 |
|----------|------|
| [manual-order-leader-overview-preview.html](./manual-order-leader-overview-preview.html) | 手動順番プレビュー：上部＝**閲覧（高密度グリッド）**、下部＝**編集モード**（太い行・つかみ・↑↓並べ替えデモ・保存はアラートのみ） |
| [manual-order-peek-accordion-schedule-preview.html](./manual-order-peek-accordion-schedule-preview.html) | **検討用・静的のみ** — 上＝全端末横カード＋鉛筆の**配置イメージ**、下＝生産スケジュール風（中央カードと下を対応させた**見本の1状態**）。クリック・保存・API なし。 |
| [manual-order-edit-focus-gray-preview.html](./manual-order-edit-focus-gray-preview.html) | **検討用・静的のみ** — 編集中に**他カードをグレーアウト**し、背面に**大きな「編集中」＋端末名**を重ねる例。下はスケジュール風＋順位ドロップダウン見本。 |
| [manual-order-schedule-to-overview-flow-preview.html](./manual-order-schedule-to-overview-flow-preview.html) | **全体把握 → 生産スケジュール（一時）→ 反映後の全体把握** の縦フロー（静的モック） |
| [manual-order-overview-pane-row-detail-preview.html](./manual-order-overview-pane-row-detail-preview.html) | **上ペイン（全体把握）カード内の行明細（高密度）** — 製番·品番·工順を1行、機種名·品名を2行目。**項目ラベルなし**。手動vs自動順の差分等は**算出式改善用に保存する想定だがキオスクには出さない**方針を注記。実装ターゲット用静的モック（API は現状資源 CD 集計のみ） |
| [manual-order-device-card-location-machine-preview.html](./manual-order-device-card-location-machine-preview.html) | **上ペイン端末カード** — Location **1行**。行ブロックは **1行目 製番·品番**、**2行目 工順·部品名**（`partName`）、**3行目 機種名**（`machineName`）。**フォントは生産スケジュール一覧（`ProductionScheduleTable` の `text-xs`）と同サイズ**。`ManualOrderDeviceCard` 実装と同趣旨の静的モック |
| [manual-order-band-to-operator-rank-preview.html](./manual-order-band-to-operator-rank-preview.html) | **帯分け → 帯内調整 → 資源CDごとの連番確定 → オペレーター提示** を1画面で表した静的モック。上ペインで編集対象選択、中央で帯編集、右で最終順位の受け渡しイメージを表示 |
| [leader-due-rank-board-preview.html](./leader-due-rank-board-preview.html) | **リーダー順位ボード**（納期ベース・カードグリッド・本番ルート `/kiosk/production-schedule/leader-order-board` の UI 参考） |
| [signage-leader-order-cards-preview.html](./signage-leader-order-cards-preview.html) | **サイネージ FULL: 順位ボード資源CDカード**（`kiosk_leader_order_cards` の見た目改善プレビュー。4列×2段・最大8カード相当・余白詰め） |
| [kiosk-part-measurement-header-strip.html](./kiosk-part-measurement-header-strip.html) | **部品測定・編集画面上部帯**（メタ `<dl>` + 中央寄せ折返しスロット・本番 `KioskPartMeasurementEditTopStrip` のレイアウト参考） |
| [kiosk-part-measurement-template-picker.html](./kiosk-part-measurement-template-picker.html) | **部品測定・テンプレート選択（提案）**（日程固定コンテキスト・候補一覧・図面アイコン＋ホバープレビュー・新規作成導線） |
| [kiosk-rank-board-card-single-preview.html](./kiosk-rank-board-card-single-preview.html) | **キオスク順位ボード・カード1件**（本番 `LeaderOrderResourceCard` 相当の静的モック。CDN なし） |
| [kiosk-analytics-bi-dashboard-preview.html](./kiosk-analytics-bi-dashboard-preview.html) | **キオスク集計（`/kiosk/rigging-analytics`）BI レイアウト改善案** — KPI 帯・Top N・当日コンパクト／スクロール不要の静的モック |
| [loan-report-supply-hero-actions-preview.html](./loan-report-supply-hero-actions-preview.html) | **貸出レポート・過不足ペイン** — 帯＋5緊張度バー＋チップ（**説明文なし**）、文章は**所見のみ**（本番 `loan-report-html-renderer` と同方針） |
| [loan-report-gap-bottleneck-preview.html](./loan-report-gap-bottleneck-preview.html) | **過不足ペイン案** — 余力vs需要圧の二段＋**アイテム単位ボトルネック5件**（同一ペイン・静的モック） |
| [loan-report-group-timeseries-preview.html](./loan-report-group-timeseries-preview.html) | **過不足ペイン内・グループ経時** — A4 1枚想定、本番と同スケールのカード幅に<strong>薄型経時SVG＋ボトルネック2行</strong>を収めたモック |
| [loan-report-item-surplus-preview.html](./loan-report-item-surplus-preview.html) | **貸出レポート・アイテム軸パネル** — 需要バー＋即時在庫ラインに **機械的な短文** を右列に足す案（本番と同面積想定） |
| [mobile-placement-shelf-register-layout-preview.html](./mobile-placement-shelf-register-layout-preview.html) | **配膳スマホ・棚番登録** — 現状 vs 改善案（**確定をヘッダー「棚番を登録」**・選択中を右・見出し省略・番号拡大）。**実装は未反映** |
| [mobile-placement-register-section-stack-preview.html](./mobile-placement-register-section-stack-preview.html) | **配膳スマホ・下半（登録済み棚番 + 製造order）** — エリア／列ボタンと製造order行の**重なり問題** vs **縦積み修正案**（`flex-1` 見直しのイメージ） |
| [mobile-placement-verify-collapsible-preview.html](./mobile-placement-verify-collapsible-preview.html) | **配膳スマホ・照合の折りたたみ** — **既定は閉じる**・「展開」で移動票/現品票・閉じるで下半を広く。下半は棚6・QR・＋・製造order・**新規/既存/登録を1行**（登録は既存の右・見出し・ヒント文なし） |
| [mobile-placement-main-page-detail-preview.html](./mobile-placement-main-page-detail-preview.html) | **配膳スマホ・メイン画面** — `MobilePlacementVerifySection`（折りたたみ）＋ `MobilePlacementRegisterSection` の**本番レイアウトに準拠**した静的プレビュー（一例状態）。照合の展開UIは `mobile-placement-verify-collapsible-preview.html`。本番Reactとの差分・許容範囲は [mobile-placement-main-page-preview-parity.md](../plans/mobile-placement-main-page-preview-parity.md) |
| [mobile-placement-placement-board-all-cases-preview.html](./mobile-placement-placement-board-all-cases-preview.html) | **配膳スマホ・棚一覧・俯瞰（全案）** — **案A** 棚俯瞰カード / **案B** 9ゾーン色分けマップ＋ゾーン内棚 / **案C** 棚で見る・部品で探すタブ / **案D** 注意バッジ。**実装前の静的モック** |
| [mobile-placement-part-find-min-steps-preview.html](./mobile-placement-part-find-min-steps-preview.html) | **配膳スマホ・目的部品の棚を最少手数で探す** — 1画面検索 / スキャン主導 / 履歴1タップ / 候補リストタップ / ミニマル1CTA / 手数比較表。**実装前の静的モック** |
| [mobile-placement-part-name-incremental-search-preview.html](./mobile-placement-part-name-incremental-search-preview.html) | **配膳スマホ・部品名の段階的絞り込み（口頭照会）** — 「テ」→「テー」→確定の状態例、**ソースX/Y 混在リスト**、候補過多ガード。**実装前の静的モック** |
| [mobile-placement-gojuon-prune-nav-preview.html](./mobile-placement-gojuon-prune-nav-preview.html) | **配膳スマホ・五十音＋A–Z カーナビ風** — **よく使う語プリセット**／**アルファベットグリッド**（剪定例あり）／プレフィックスで<strong>使えない文字を消す／薄くする</strong>。**実装前の静的モック** |
| [mobile-placement-part-keyword-and-search-preview.html](./mobile-placement-part-keyword-and-search-preview.html) | **配膳スマホ・登録済み部品を探す最終案** — **五十音・ABC・プリセットの文字ボタンを押した瞬間に条件採用**／**空白区切り AND**（API と同じ前提）／**登録済み候補をリアルタイム絞り込み**／**不要ボタンは非表示**。補助候補なしの静的モック |
| [purchase-order-lookup-fkobaino-preview.html](./purchase-order-lookup-fkobaino-preview.html) | **購買照会（FKOBAINO）** — **「配膳に戻る」常設**／**スキャンで注文番号を入れて照会**（別途「照会」ボタンなし。入力欄は表示のみ）。**結果: 項目ラベルなし・値のみを縦に（順序は 機種名→製番→品名→品番→個数・本文約2倍）**／配色は配膳メイン（`mpKioskTheme`）に合わせた静的モック |

プレビュー HTML は **外部 CDN やネットワークに依存しません**（macOS のシステムフォントのみ）。`file://` のまま Safari で表示できる想定です。

## Safari で開く（macOS）

1. **Safari を先に起動**する。
2. **Finder** で `manual-order-leader-overview-preview.html` を **Safari のウィンドウにドラッグ＆ドロップ**する。  
   （いちばん確実な方法です。）
3. または Safari メニュー **ファイル → 開く…**（⌘O）で `.html` を選ぶ。

ターミナルから:

```bash
open -a Safari "/Users/tsudatakashi/RaspberryPiSystem_002/docs/design-previews/manual-order-leader-overview-preview.html"
open -a Safari "/Users/tsudatakashi/RaspberryPiSystem_002/docs/design-previews/manual-order-schedule-to-overview-flow-preview.html"
open -a Safari "/Users/tsudatakashi/RaspberryPiSystem_002/docs/design-previews/manual-order-peek-accordion-schedule-preview.html"
open -a Safari "/Users/tsudatakashi/RaspberryPiSystem_002/docs/design-previews/manual-order-edit-focus-gray-preview.html"
open -a Safari "/Users/tsudatakashi/RaspberryPiSystem_002/docs/design-previews/manual-order-overview-pane-row-detail-preview.html"
open -a Safari "/Users/tsudatakashi/RaspberryPiSystem_002/docs/design-previews/manual-order-device-card-location-machine-preview.html"
open -a Safari "/Users/tsudatakashi/RaspberryPiSystem_002/docs/design-previews/manual-order-band-to-operator-rank-preview.html"
```

※ **ダブルクリックだけ**だと、既定ブラウザが Chrome 等の場合 Safari で開きません。

## それでも開けない・真っ白な場合

**ローカルサーバ経由**（`http://localhost`）ならブラウザのローカルファイル制限を避けられます。

```bash
cd /Users/tsudatakashi/RaspberryPiSystem_002/docs/design-previews
python3 -m http.server 8765
```

ブラウザで `http://127.0.0.1:8765/manual-order-leader-overview-preview.html` を開く。終了はターミナルで `Ctrl+C`。

（リポジトリが別のパスにある場合は、`cd` をその `docs/design-previews` に合わせてください。）

## Cursor / SSH リモートで編集している場合

HTML は **リモート側のディスク**にあることが多く、そのままでは **手元の Mac の Safari からはパスが通りません**。次のいずれかでください。

- 該当 `.html` を Mac にコピー（ダウンロード）してから上記手順で開く。
- 同じリポジトリを **Mac 上にクローン**して、ローカルパスで開く。

## 索引

- プロジェクト全体のドキュメント入口: [docs/INDEX.md](../INDEX.md)
