# 進捗一覧画面（閲覧専用）運用ガイド

## 目的

- 登録製番のみを対象に、部品の工程進捗と納期を1画面で確認する。
- 編集操作を排除し、キオスクでの進捗監視に特化する。

## 画面仕様（確定）

- 画面パス: `/kiosk/production-schedule/progress-overview`
- ヘッダーボタン: `生産スケジュール` と `納期管理` の間に `進捗一覧` を追加
- レイアウト: 3列カード（画面幅に応じて2列/1列へフォールバック）
- カードヘッダー: `製番` と `機種名`
- ヘッダー表示: `進捗一覧` + `最終更新` + `手動更新`（`登録製番` と `閲覧専用` 文言は非表示）
- 行表示: `品名` / `納期` / `工程進捗` のデータのみ（列見出しは非表示）
- 工程進捗: `資源CD` のみ表示（工順昇順、重複は工程数分表示、完了工程はグレーアウト）
- 納期未設定: 画面表示対象外（非表示）
- 空状態文言: `登録製番がありません。生産スケジュール画面で製番を登録してください。`

## データソースと並び順

- 登録製番の正: `search-state.history`（共有検索履歴）
- API: `GET /api/kiosk/production-schedule/progress-overview`
- 並び順:
  - 納期あり: 納期昇順
  - 同一納期: 登録順
  - 納期未設定: APIで保持するが画面では表示しない

## 更新方式

- 自動更新: 5分
- 手動更新: 画面上の `手動更新` ボタン

## Safari/デザインプレビュー

- モックプレビュー: `production-schedule-progress-preview.html`
- 実データプレビュー: `/kiosk/production-schedule/progress-overview`
- 記録ファイル:
  - `tmp/safari-progress-overview-mock.png`
  - `tmp/safari-progress-overview-real.png`

