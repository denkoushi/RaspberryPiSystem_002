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
