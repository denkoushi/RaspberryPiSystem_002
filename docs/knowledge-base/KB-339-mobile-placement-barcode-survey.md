# KB-339: 配膳スマホ版 V1 — 現場バーコードの意味確定（調査ゲート）

最終更新: 2026-04-10

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

## References

- 実装: `apps/api/src/services/mobile-placement/mobile-placement.service.ts`
- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
