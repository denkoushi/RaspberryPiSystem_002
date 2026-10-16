# 配膳スマホメイン画面: 静的プレビューと本番Reactの整合メモ

**対象プレビュー**: [mobile-placement-main-page-detail-preview.html](../design-previews/mobile-placement-main-page-detail-preview.html)  
**本番ルート**: `/kiosk/mobile-placement`（`MobilePlacementPage` → `MobilePlacementVerifySection` / `MobilePlacementRegisterSection`）

## 意図一致（差分なしとみなす範囲）

| 項目 | プレビュー | 本番（実装後） |
|------|------------|----------------|
| 照合折りたたみ1行 | 濃い背景・太い下線・展開ボタンはスカイ枠の実色 | `MobilePlacementVerifySection` + `mpKioskTheme.verify*` |
| 部品名で棚を探す | スカイ枠・実色ボタン | `MobilePlacementPage` 上部ボタン |
| 棚パネル（amber） | 左太線・`#1c1300` 系・QRはアイコンのみ・棚番大・6軸・4列棚チップ・接頭辞/番号分割 | `MobilePlacementRegisterShelfPanel` + `mpKioskTheme.shelf*` + `splitShelfCodeForDisplay` |
| 非表示 | 「登録済みの棚番」「表示 n件」「選択中」ラベル・フッターヒント | 本番から削除済み |
| 製造order行 | 10桁優先幅・大フォント・スキャン `3rem` 角 | `mpKioskTheme.orderInput` + `IconScanButton` variant `order` |
| 意図＋確定 | 「新規配分」「既存配分」「確定」・幅は内容に追従 | `MobilePlacementRegisterOrderPanel` |
| 分配選択ラベル | 「分配を選択」 | 同上 |
| 分配チップ | 2行・大きめクランプ | `mpKioskTheme.branch*` |

## 許容差分（技術的に同一視）

- **スタック**: プレビューは生 CSS、本番は Tailwind ユーティリティ＋ [mobilePlacementKioskTheme.ts](../../apps/web/src/features/mobile-placement/ui/mobilePlacementKioskTheme.ts)。色・枠・寸法の**意図**が一致すればピクセル完全一致は求めない。
- **フォント**: プレビューは `system-ui`、本番はキオスクの実フォント依存。`clamp` による相対スケールは一致。
- **照合の展開UI**: プレビューは別 HTML（[mobile-placement-verify-collapsible-preview.html](../design-previews/mobile-placement-verify-collapsible-preview.html)）。本番は `MobilePlacementVerifyExpandedPanel` のまま（今回の高コントラストは**折りたたみ1行**と**下半**が主対象）。

## 本番のみ（プレビューに無いが仕様として維持）

- 登録結果・エラーメッセージ、読込中/エラー時の再試行、エリア未選択ガイド、「その他の登録棚」、新規配分時の「次に作成される分配」表示。
- 確定ボタンの `disabled`（棚・製造order・分配未選択など）は既存ロジックのまま。

## 検証コマンド（ローカル）

```bash
cd apps/web && pnpm exec tsc -b && pnpm lint && pnpm test
```

## 新デザイン（2026-10-16）

上記は旧プレビューの記録。配膳スマホのハブと5画面（部品を探す・購買照会・パレット・Zero2W 配膳・棚マスタ）は [mobile-placement-redesign-mock.html](../design-previews/mobile-placement-redesign-mock.html) の見た目に置き換えた。購買照会と棚マスタは `useIsPhoneViewport()`（幅767px以下）のときだけ新表示で、据え置き端末は従来のまま。

- 登録は照合が「一致」になってから。棚の欄は一致まで押せない。
- 棚マスタの「棚を移す」は登録済みの棚どうしだけ。既存の移動APIが空きセルへの移動を扱わないため。
- 部品検索の機種候補と Zero2W 一覧の端末名は、APIが返さないため出さない。
- 右下の Hermes ボタンと重ならないよう、スマホ画面の下端操作は右に 84px 空ける（`haizenPhoneTokens.ts` の `hermesGutter`）。
