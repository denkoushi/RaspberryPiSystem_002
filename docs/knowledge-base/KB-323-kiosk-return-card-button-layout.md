# KB-323: キオスク持出一覧カードの返却・取消ボタン下段配置とコンポーネント分離

## Context

- **いつ**: 2026-04-01
- **どこ**: キオスク `/kiosk/tag` 右ペイン「持出一覧」（`KioskBorrowPage` 内の `KioskReturnPage`）、および単独ルートで同コンポーネントを利用する画面

## Symptoms

- アイテム名などが長いとき、**返却・取消ボタンと同じ行**で幅を奪い合い、`truncate` により **早期に `...` 省略**されやすい
- 中幅以上で `md:flex-row` により「左: テキスト / 右: ボタン」になっていたことが主因（`grid-cols-5` でカード幅が狭い場合はさらに顕著）

## Root cause

- カードルートが `flex-col` と `md:flex-row` の併用で、ブレークポイント以上ではテキスト領域とボタン領域が **主軸横並び**となり、テキスト側に `min-w-0` + `truncate` が効いて幅が押しつぶされた

## Fix（実装概要）

- **レイアウト**: カードは **常に縦積み**（`flex flex-col gap-3` のみ）。**返却・取消**は **カード下部の `w-full` 行**に `flex-row flex-wrap gap-2 justify-end` で配置
- **構造**: 表示専用ロジックを `apps/web/src/components/kiosk/KioskActiveLoanCard.tsx` に切り出し、`KioskReturnPage` はデータ取得・ミューテーション・モーダルに専念（API 呼び出しはカードに持たせない）
- **保守性**: 画像モーダル用 `createObjectURL` の Blob URL を、**新しい URL 発行時に旧 URL を `revoke`**、**コンポーネントアンマウント時にも `revoke`**（取りこぼしによるメモリリーク予防）

## ローカル検証（開発機）

- `cd apps/web && npm run lint && npm run test && npm run build`
- リポジトリルートの pre-commit 相当: `pnpm -r lint --max-warnings=0`（コミットフック経由で実施済みの場合あり）

## デプロイ・実機確認

- **方針**: [deployment.md](../guides/deployment.md) の標準手順に従う（本変更は **Web バンドル**）。影響は **Pi4 キオスク**（および同 Web を載せる手順上のホスト）が中心。[deployment-modules.md](../architecture/deployment-modules.md) の「フロントエンドコンポーネント変更」と整合
- **確認**: `/kiosk/tag` の持出一覧で、長い名称でも **ボタンが明細の下**にあり、横方向の詰まりが緩むこと。反映後はキャッシュや `kiosk-browser` 再起動が必要な場合あり（[verification-checklist.md](../guides/verification-checklist.md) 6.6.4）

## トラブルシューティング

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| まだボタンが横に付く（旧 UI） | 未デプロイ・ブラウザキャッシュ | 対象ホストでデプロイログ確認、キオスクで強制リロードまたは `kiosk-browser` 再起動 |
| 極端に長い名称が依然 `...` | `truncate` は1行省略のまま | 今回の修正は **ボタンとの幅競合**の緩和。複数行表示が必要なら別要件（`line-clamp` 等） |
| 画像モーダル操作後にメモリが伸びる | Blob URL 未解放（旧版） | 本 KB 対応版では `revoke` を挟む。古いビルドなら再デプロイ |

## References

- 実装コミット例: `22a24626`（ブランチ `fix/kiosk-return-card-button-layout`）
- `apps/web/src/pages/kiosk/KioskReturnPage.tsx`
- `apps/web/src/components/kiosk/KioskActiveLoanCard.tsx`
- [KB-314](./KB-314-kiosk-loan-card-display-labels.md)（同一画面の表記・ラベル）
- [KB-312](./KB-312-rigging-idnum-deploy-verification.md)（持出一覧カード行レイアウトの別改修）
- [guides/verification-checklist.md](../guides/verification-checklist.md) §6.6.4
- [architecture/deployment-modules.md](../architecture/deployment-modules.md)
