---
title: "KB-458: 製番ボードの＋(差し込み)が「保存できませんでした」になる(DB の鍵の上限あふれ)"
tags: [生産スケジュール, 製番ボード, ガント, テスト加工, PostgreSQL, ロック]
audience: [開発者, 運用者]
last-verified: 2026-11-27
related: [KB-440]
category: knowledge-base
---

# KB-458: 製番ボードの＋(差し込み)が「保存できませんでした」になる

- Status: 修正済み(このKBと同じ PR)
- Date: 2026-11-27
- Data: Pi5 の API ログと、本番 DB の読み取りのみ(`statement_timeout` 付き)

## Symptom

研削メイン(4K モニターの Pi4)の製番ボードのガントで、＋ボタンから品物を差し込むと、上に赤い帯「保存できませんでした。時間をおいて再試行してください。」が出て保存されない。

## Evidence

- API ログ: `POST /api/kiosk/production-schedule/grinding-planning-board/test-bars` が 500。Prisma `P2010`、PostgreSQL `53200 out of shared memory`(`$executeRaw`)。
- 鍵の上限: `max_locks_per_transaction=64`、`max_connections=100`、`max_prepared_transactions=0` → 共有の鍵表はおよそ 6,400 件分。
- 第2工場のボード: 製番 252、元の行 13,491、論理キー(製番・品番・資源CD・工順)で約 10,700。

## Cause

＋の保存(`createPlanningTestBar`)、差し込みの削除・戻し、差し込みのある資源CDの並べ替え(`reorderPlanningTestBarLane`)は、共通の `withBoard` で **ボードの全製番の勝ち行すべて** に `pg_advisory_xact_lock` を1行ずつかけていた(#2755 で導入)。勧告ロックは1件ずつ共有の鍵表を使うため、ボードの行が 1 万を超えた時点で上限(約 6,400)を超えて失敗する。画面の大きさ(4K)とは関係しない。

## Fix

- 全行への鍵をやめ、実際に順位を書き直す資源CDの列(`saveLane` に渡す列)の元行だけに、勧告ロック → `FOR UPDATE` の順で鍵をかける。消えていた行があれば 409(`STALE_PLANNING_BOARD_ITEM`)。
- 上書き(override)の読み書きは、これまでどおり盤の状態行の `FOR UPDATE`(`lockState`)で直列化される。資源CDの並べ替え(`write.ts` の resource order)と同じ鍵のかけ方。
- 1列の件数に上限は無い(`GRINDING_PLANNING_BOARD_RESOURCE_ORDER_ITEM_LIMIT` は並べ替えの要求の件数だけを縛る)。鍵がかかるのは＋で差し込める資源CD(研削 `STATIC_GRINDING_RESOURCE_CDS` と、除外されていない切削)の列だけで、2026-11-27 の第2工場では最大が 587 の約770行。切削の部品の論理ロック(最大 約3,300)と足しても約4,100で、上限(約6,400)の内に収まる。
- 行の多い 10(約4,700行)と MSZ(約2,800行)は切削の除外(`cuttingExcludedResourceCds`)なので＋で差し込めず、この経路では鍵がかからない。除外を外すとあふれる恐れがあるので、そのときは列の鍵を見直す。
- 差し込みの無い列の並べ替え(`write.ts` の資源CDの並べ替え)も列の全行に鍵をかける。除外の資源CDが製番ボードに出る場合は同じあふれが起こりうる(この PR では触らない)。

## Not changed / watch

- `max_locks_per_transaction` は上げていない(DB の再起動が要り、行の増加で再発するため)。
- 製番の分割の論理ロック(`acquireSessakuPieceLogicalLocks`)は盤全体の分割キーに今もかかる(2026-11-27 時点で分割セット 935、関係する行 2,340)。分割が大きく増えたら同じ上限に近づくので、件数を見る。
