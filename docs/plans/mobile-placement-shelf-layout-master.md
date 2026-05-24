# ExecPlan: 配膳棚レイアウトマスタ（shelf-master）

**ADR**: [ADR-20260523](../decisions/ADR-20260523-mobile-placement-shelf-layout-master.md)  
**ブランチ**: `feat/kiosk-shelf-layout-master`

## 目的

キオスク `/kiosk/mobile-placement/shelf-master` で工場 9 区画のレイアウト編集・再割当・Zero2W 割当を一括運用し、サイネージに表示名を載せる。

## フェーズ

### Phase 1 — 基盤

- [x] ADR / 本 ExecPlan
- [ ] `packages/shelf-layout-core` + Vitest
- [ ] Prisma 拡張 + migration + backfill

### Phase 2 — API

- [ ] `GET /client-capabilities`
- [ ] `GET /machine-masters`
- [ ] `GET/PUT /shelf-layout` + zone detail
- [ ] `POST /shelves/:shelfCodeRaw/relocate`
- [ ] `registered-shelves` 拡張、`shelfLayoutEditEnabled` on clients API
- [ ] API tests

### Phase 3 — Web

- [ ] `KioskMobileShelfMasterPage` + feature components
- [ ] hooks + client.ts
- [ ] redirect `/shelf-register`, `/zero2w-assignment`
- [ ] `ClientsPage` フラグ列

### Phase 4 — サイネージ + ドキュメント

- [ ] `parts-shelf-*` displayLabel
- [ ] `docs/api/mobile-placement.md`, INDEX

## 検証

```bash
pnpm --filter @raspi-system/shelf-layout-core test
pnpm --filter api test -- shelf-layout
pnpm --filter web lint
```

## 停止条件

実装・検証完了後、**コミット/プッシュせず**ユーザーへ報告。

## フォローアップ（2026-05-23 · 記録）

- **区画 Dialog コンパクト化**（`fix/kiosk-shelf-master-zone-dialog-compact` · **`2e73aeed`**）: [`ShelfMasterZoneDialogFrame`](../../apps/web/src/features/mobile-placement/shelfMaster/components/ShelfMasterZoneDialogFrame.tsx) 導入。本番 **Pi5→Pi4×4** 完了。正本 [KB-382 §コンパクト](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--zone-dialog-compact-2026-05-23)。
- **未使用→確定で結合マス解放**（`fix/kiosk-shelf-master-release-cells-on-unused` · **`14e164d6`**）: [`layoutCellRelease.ts`](../../apps/web/src/features/mobile-placement/shelfMaster/model/layoutCellRelease.ts) — **`UNUSED` は `releaseLayoutCells` のみ**（明示 UNUSED entity を作らず **1マス空**）。本番 **Pi5→Pi4×4** 完了（2026-05-24）。正本 [KB-382 §未使用解放](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#production-deploy--unused-release-merged-cells-2026-05-24)。
- **本 ExecPlan の Phase チェックボックス**は実装完了と乖離しているため、別途 [x] 整合を推奨（`EXEC_PLAN.md` Next Steps §棚マスタ）。
