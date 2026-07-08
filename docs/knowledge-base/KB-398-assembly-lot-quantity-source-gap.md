---
title: KB-398 Assembly lot quantity source gap on kiosk home
tags: [kiosk, assembly, lot-quantity, production-schedule, seiban]
audience: [開発者, 運用者]
last-verified: 2026-07-08
category: knowledge-base
---

# KB-398: Assembly lot quantity source gap on kiosk home

## Status

active

## Scope

キオスク組立トップ画面（`/kiosk/assembly`）の製番選択・ロット数取得・シリアル入力・ロット登録フロー。順番ボード（リーダー順番ボード）との数量表示差異の切り分け。

## Context

- 発生日: 2026-07-08（ユーザー報告）
- 対象製番例: `BA1S7317`
- 組立トップでは機種名は表示されるがロット数が取得できず、シリアル入力・ロット登録が完全にブロックされた
- 同一製番は順番ボードで指示数 `5` が表示されていた
- ロット数のデータソース分離は [ADR-20260707](../decisions/ADR-20260707-assembly-procedure-order-library-scope.md) で意図的に選択済み
- 修正はフロントのみ（API 変更なし）。コミット `63427ad7`、main マージ `6401d6a3`、ブランチ `fix/assembly-lot-quantity-manual-fallback`

## Symptoms Or Trigger

1. `/kiosk/assembly` で製番（例: `BA1S7317`）を入力
2. 機種名は表示される
3. ロット数が取得できず、警告「ロット数が正の整数で取得できる製番を選択してください。」が表示される
4. シリアル入力・ロット登録が完全にブロックされる
5. 順番ボード（リーダー順番ボード）では同じ製番に指示数 `5` が表示されている

## Investigation

### H1: 組立トップと順番ボードでロット数のデータソースが異なる

- **Result**: CONFIRMED
- 順番ボードの数量: `ProductionScheduleOrderSupplement.plannedQuantity`（部品納期個数 CSV「指示数/FKOJUNSIJISU」由来。キーは `ProductNo` + `FSIGENCD` + `FKOJUN`）
- 組立トップのロット数: `GET /api/assembly/seiban-lot-quantities` → `ProductionScheduleActualHoursRaw`（生産実績 CSV、月次 Gmail 取込、`FSEZOSIJISU` → `lotQty`）の `DISTINCT (fseiban, lotNo, lotQty)` を製番単位で SUM
- 実装: [`assembly-seiban-lot-quantity.service.ts`](../../apps/api/src/services/assembly/assembly-seiban-lot-quantity.service.ts)

### H2: 生産実績 Raw に該当製番の行が無い

- **Result**: CONFIRMED（設計上の想定ケース）
- 生産実績にまだ行が無い製番（実績未発生・月次取込ラグ・`isExcluded=true`・`fseiban` 欠損）ではロット数 API が該当キーを返さない
- フロントでは `null` → 警告＋入力ブロック
- **本番確認（2026-07-08）**: Pi5 `docker-db-1` read-only SQL で `BA1S7317` は `ProductionScheduleActualHoursRaw` **0行**、`CsvDashboardRow` **232行**、supplement `plannedQuantity` distinct **{5, 10}** — CONFIRMED（本番実データで確定）
- 切り分け SQL（read-only、再診断用）:

```sql
SELECT "fseiban", "lotNo", "lotQty", "isExcluded", "workDate"
FROM "ProductionScheduleActualHoursRaw"
WHERE UPPER(TRIM(COALESCE("fseiban", ''))) = 'BA1S7317'
ORDER BY "workDate" DESC;
```

### H3: フロントのルックアップキーが API 正規化と不一致

- **Result**: CONFIRMED（副次バグ）
- `lotQtyByProductNo` の格納・ルックアップキーが API 正規化（`UPPER` / `TRIM` / 半角化）と揃っておらず、製番の大文字小文字・空白差で取りこぼす可能性があった

## Root Cause

1. **設計上のデータソース差**: 組立トップは生産実績 Raw 由来、順番ボードは部品納期個数 supplement 由来。実績未発生製番では組立 API がロット数を返せない（ADR 意図どおり）。
2. **UX ギャップ**: 自動取得失敗時の手入力フォールバックが無く、ロット登録が完全ブロックされていた。
3. **副次バグ**: フロントの製番キー正規化が API と不一致で、取得できた場合でもルックアップ失敗しうる。

## Fix

フロントのみ（API 変更なし）。コミット `63427ad7`、main マージ `6401d6a3`。

### 1. ロット数手入力フォールバック

- [`KioskAssemblyHomePage.tsx`](../../apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx): `manualLotQtyDraft` / `autoLotQty` / `expectedLotQuantity = autoLotQty ?? manual`
- [`AssemblyStartPane.tsx`](../../apps/web/src/features/assembly/AssemblyStartPane.tsx): 「ロット数（手入力）」欄＋案内文言「生産実績からロット数を取得できませんでした。順番ボード等で数量を確認し、ロット数を手入力してください。」
- 自動取得できた場合は従来どおり自動値のみ使用（手入力欄非表示）

### 2. 取得中表示

- ロット数 API 取得中は「ロット数を取得中…」表示（`lotQtyLoading`）

### 3. キー正規化の統一

- `normalizeAssemblyUpperIdentifier` を [`assemblyUiHelpers.ts`](../../apps/web/src/features/assembly/assemblyUiHelpers.ts) に追加（API の [`assembly-identifiers.ts`](../../apps/api/src/services/assembly/assembly-identifiers.ts) と同等）
- `lotQtyByProductNo` の格納・ルックアップ両方で使用
- `AssemblyCompletedPane.formatLotQty` も同様に正規化

## Prevention

- 組立ロット数は生産実績 Raw 由来であることを KB / ADR で明示し、順番ボードの `plannedQuantity` とは別ソースであることを運用・開発で共有する
- 境界を跨ぐ製番キーは `normalizeAssemblyUpperIdentifier` で統一する（API とフロントで同等ロジック）
- 自動取得失敗時は手入力フォールバックで現場作業を止めない。回帰テストで以下を固定:
  - 手入力 → ロット登録成功
  - 自動取得時は手入力欄非表示
  - 正規化キーのルックアップ
  - 手入力 `0` / 空のとき登録不可
- 順番ボード `plannedQuantity` を組立へ自動フォールバックする案は、supplement が部品×工順単位（員数>1 の部品では台数と不一致）のため見送り。将来必要なら別 ADR

## Validation

2026-07-08、Mac ローカル:

| Check | Result |
|-------|--------|
| `pnpm --filter @raspi-system/web test` | PASS — 265 files / 1337 tests |
| `apps/web` eslint | PASS |
| `apps/web` build | PASS |

追加テスト（手入力フォールバック・正規化ルックアップ・自動取得時 UI）を含む。

### 本番デプロイ（2026-07-08）

| Check | Result |
|-------|--------|
| main push CI **`28930061845`** | success |
| Run ID **`20260708-180942-18680`** | 全7ホスト `failed=0 / unreachable=0` |
| `./scripts/deploy/verify-phase12-real.sh` | **PASS 45 / WARN 0 / FAIL 0** |
| 配信バンドル新文言 | `/assets/index-DxYaeHkM.js` に「生産実績からロット数を取得できませんでした」「ロット数（手入力）」確認 |
| デプロイ記録 | [deployment.md §組立トップ ロット数手入力フォールバック](../guides/deployment.md#kiosk-assembly-lot-quantity-manual-fallback-2026-07-08) |

## Open Items

- **実機（目視・タッチ）での手入力フロー確認**: 未実施（次回現場確認時: BA1S7317 等の実績未登録製番で「ロット数（手入力）」欄表示→手入力→シリアル入力→ロット登録まで進めること）
- **plannedQuantity フォールバック**: 部品×工順単位の supplement を台数へ流用する案は見送り（将来必要なら別 ADR）

## Local Notes JA

- 現場で見えた警告文言はそのまま記録: 「ロット数が正の整数で取得できる製番を選択してください。」
- 手入力案内文言: 「生産実績からロット数を取得できませんでした。順番ボード等で数量を確認し、ロット数を手入力してください。」
- 順番ボードで確認した指示数 `5` と、組立トップで欠落したロット数は、ソースが異なるため矛盾ではない（実績未発生製番では想定どおり）

## References

- [ADR-20260707: Assembly procedure order scoped to assembly library documents](../decisions/ADR-20260707-assembly-procedure-order-library-scope.md)
- [`apps/api/src/services/assembly/assembly-seiban-lot-quantity.service.ts`](../../apps/api/src/services/assembly/assembly-seiban-lot-quantity.service.ts)
- [`apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx`](../../apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx)
- [`apps/web/src/features/assembly/AssemblyStartPane.tsx`](../../apps/web/src/features/assembly/AssemblyStartPane.tsx)
- [KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）](./KB-297-kiosk-due-management-workflow.md) — `ProductionScheduleOrderSupplement.plannedQuantity` の補助反映
- Fix commit: `63427ad7`（branch `fix/assembly-lot-quantity-manual-fallback`）
- Main merge: `6401d6a3`
