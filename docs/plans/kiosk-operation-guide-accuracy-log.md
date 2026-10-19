---
id: kiosk-operation-guide-accuracy-log
title: キオスク操作案内の当たり率ログ
status: living log
last_verified: 2026-10-15
---

# キオスク操作案内の当たり率ログ

- 対象: キオスク Chat「検索」で「画面の操作方法を見る」を選んだときに返す操作ガイド(`docs/kiosk-operation-guide/`)の文書選び
- 方針: 不適合検索([Hermes retrieval accuracy log](./hermes-retrieval-accuracy-log.md))と同じ。測った変更だけを採用し、採用も不採用も数字と理由をここに残す。特定の質問や言葉だけを通す例外(同義語の追加など)は入れない。誤った画面を返すより「説明はまだありません」の方を良しとする。

## 測り方

評価セットは `scripts/hermes-search/operation-guide/gold/operation-guide-v1.json`(50 件。質問 → 正しい文書。`null` は操作案内では答えない質問)。秘密は含まないのでリポジトリに置く。

```
cd apps/api
pnpm exec tsx src/scripts/evaluate-kiosk-operation-guide.ts \
  --gold ../../scripts/hermes-search/operation-guide/gold/operation-guide-v1.json \
  [--master <names.json>] [--out <run.json>] [--baseline <run.json>]
```

- `--master` は登録データ(在庫の品物名、工具名、計測機器名、吊具名)の書き出し。形は `scripts/hermes-search/operation-guide/fixtures/master-names.sample.json`(見本。本番の名前ではない)。本番の名前での実測は、書き出しファイルを `~/Documents/hermes-retrieval-private/operation-guide/` に置いて渡す(コミットしない)。
- 指標: `accuracy` = (正しい文書 + 正しく答えない) / 件数、`wrong_rate` = (違う文書 + 答えるべきでないのに答えた) / 件数。`wrong_rate` が上がる変更は accuracy が上がっても採用しない。
- 本番で外した質問は、API の受領ログ(`/app/storage/hermes-search/runtime/receipts/receipts-YYYY-MM-DD.jsonl` の `consultationRoute`、`route: operation_guide`、`guideMiss`)から拾い、評価セットに足す。

## 記録

| 日付 | 変更 | accuracy | wrong_rate | 判断 |
| --- | --- | --- | --- | --- |
| 2026-10-15 | 基準(main c8bfb162 の検索。配布後に「チップ」をタグ管理の keywords に足した個別対応は撤回した状態) | 0.76 (38/50) | 0.16 (8/50) | 基準 |
| 2026-10-15 | 質問のうち文書が知らない言葉だけを登録データ(見本 `master-names.sample.json`)で引き、当たった系統(在庫・工具・計測機器・吊具)の文書に絞って検索 | 0.86 (43/50) | 0.12 (6/50) | 採用。直った 5 件: チップの登録手順、ハンマーを返す、ノギスの持出、シャックルの持出、ワイヤーロープの点検。残る誤り 7 件は登録データとは別で、同じ系統内の文書の順位付け(在庫操作 vs 在庫の準備、生産スケジュール系 3 画面、社員証の登録、バーコード)と「〜を借りたい」の語尾。本番の名前での再測定は未実施 |
