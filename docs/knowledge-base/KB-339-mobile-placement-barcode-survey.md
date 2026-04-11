# KB-339: 配膳スマホ版 V1 — 現場バーコードの意味確定（調査ゲート）

最終更新: 2026-04-11

## Context

配膳スマホで **アイテム／現物のバーコード**を読み取り、既存の `Item` または生産スケジュール行と突き合わせる前に、**ラベル上のコードが何を表すか**を固定する必要がある。

## Symptoms

- スキャン値は取れるが、マスタやスケジュールと一致しない
- 同一現物で複数ラベル（製番・品番・社内コード）があり、どれを正とするか不明

## Investigation

現場で **3〜5 件**について次を記録する。

1. **スキャン文字列**（そのまま。前後空白は除去してもよい）
2. **同じ現物に貼られた別ラベル**があればその値も
3. 管理画面または CSV 上の **`Item.itemCode`**（工具マスタ）
4. 生産スケジュール行の **`ProductNo` / `FSEIBAN` / `FHINCD`**（当該行が分かる場合）

### 判定（CONFIRMED の例）

- スキャン値が **`Item.itemCode` と一致**（大文字小文字のみ差）  
  → **V1 の主キーは itemCode として実装する**

- スキャン値が **`FHINCD` や `ProductNo` と一致**し、`Item` に無い  
  → **Item 側に itemCode を揃えるか、別テーブルでコード変換が必要**（V1 では手運用またはマスタ整備を優先）

## Root cause

バーコードが **どのマスタキーをエンコードしているか**が運用定義されていないと、自動突合が成立しない。

## Fix（最小）

1. 上記サンプルでパターンを CONFIRMED にする。
2. CONFIRMED になったキーを、API `resolve-item` と `register` の突合ロジックに反映する（コード側コメントに根拠を残す）。

## Prevention

- 新ラベル導入時は **サンプル1件＋ KB 追記**
- ラベル印刷システムと **`Item.itemCode` の単一ソース**を揃える

## 本番反映・検証（2026-04-10）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・`--foreground`（**Pi3 は対象外**）。実装ベースコミット **`8e1d0e3f`**（`main`）。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **突合の正本（コード）**: `csvDashboardRowId` 付き `register` は、スキャン値が行の **`ProductNo` / `FSEIBAN` / `FHINCD`** のいずれかと一致するか、**解決された `Item.itemCode` がそのいずれかと一致**すること。**欠陥対策**: 以前は「スキャンで解決した `itemCode` が行のどのフィールドとも違っても、別工具の `itemCode` とスキャンが一致すれば通過」し得たため、`Item.itemCode` 側の一致は **行キーとの一致**に限定した（`MOBILE_PLACEMENT_SCHEDULE_MISMATCH`）。

## V2（部品配膳・移動票/現品票照合）

- **UI**: `/kiosk/mobile-placement` 単一画面。上半分は移動票・現品票の **ProductNo + FHINMEI** スキャンと **OK/NG**、下半分は仮棚（TEMP-A〜D または QR）+ 製造orderスキャン + **登録**（`OrderPlacementEvent`。**`Item` は更新しない**）。
- **API**: `POST /api/mobile-placement/verify-slip-match`・`POST /api/mobile-placement/register-order-placement`（[api/mobile-placement.md](../api/mobile-placement.md)）。
- **照合**: 各票の **製造order番号**でスケジュール行を解決し、スキャンした **FHINMEI** が行と一致したうえで、両票の **`FSEIBAN` + `FHINMEI`** ペアが一致するか判定。

### 本番反映・検証（2026-04-11）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-order-based-flow`**・`--foreground`（**Pi3 は対象外**）。実装ベースコミット **`da613487`**（**`main` へ PR マージ**）。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **DB**: `OrderPlacementEvent`（マイグレーション `20260411120000_add_order_placement_event`）。

## References

- 実装（工具配置）: `apps/api/src/services/mobile-placement/mobile-placement.service.ts`
- 実装（部品配膳・照合）: `apps/api/src/services/mobile-placement/mobile-placement-slip-match.ts` ほか
- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
