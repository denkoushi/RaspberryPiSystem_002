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
