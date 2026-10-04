# Hermes pg_trgm recall prototype

Milestone 2 前の候補取得のみの比較。Node と接続可能な `psql` が必要。
既存 retrieval、JEV、DGX、planner は変更・呼び出ししない。

リポジトリルートで実行（出力先は存在するディレクトリ内の新規ファイル）:

```sh
node scripts/hermes-search/retrieval/prototypes/pg-trgm-recall.mjs \
  --gold "$HOME/Documents/hermes-retrieval-private/gold/stage-v1.json" \
  --gold "$HOME/Documents/hermes-retrieval-private/gold/stage-aspect-v1.json" \
  --labels "$HOME/Documents/hermes-retrieval-private/labels/graded-v1.json" \
  --snapshot "$HOME/Documents/hermes-retrieval-private/snapshots/nonconformity-snapshot-pi5-20261004.json" \
  --pg 'postgres://postgres:proto@127.0.0.1:55432/postgres' \
  --out /tmp/hermes-pg-trgm-recall-20261004.json
```

- 質問文をそのまま両方式へ入力。gold の `expect` / `judge` は
  `readGold` の形式検証以外には使わない。body はカタログ指定欄を改行で連結。
  BM25 の既存の正規化・token化は維持し、pg_trgm は原文を使用。
  フィルタ・enrichment・スコア閾値なし、最大200件。
- BM25 は `buildLexicalIndex` を使用。非公開の `scoreDocument` と同じ
  計算を試作内で再現する。PostgreSQL は一時テーブル＋GINを作り、
  `similarity(body, question)` / `word_similarity(question, body)` で降順取得。
  接続終了で一時テーブルと索引は消える。extension はDBに残る。
- `cases` の top30/top200 は「既知の `g=3` が1件以上ある」の真偽。
  false は不適合判定ではない。未採点は別計数し、関連あり／なしに加算しない。
  `summary` は全入力質問、`bySet` はセット別、`knownRelevantOnly` は
  `g=3` ラベルがある質問のみ。`unlabeled200` は質問×候補の延べ件数。
- `ms` は1巡の計測。BM25 は索引構築・採点・整列、PG はサーバー内の
  計画・採点・整列・ID集約を含む。PGの接続・COPY・索引構築は別計測。
  p50/p95 は nearest-rank。ウォームアップ・反復なしで、本番の応答時間ではない。
- `betterTrgm` は全問の top30、top200、p95 の順で選ぶ単一方式。
  `paired` はBM25からの獲得／喪失質問。質問ごとに良い方式を混ぜない。
  指定の全件 `ORDER BY` はGINで高速化されないため、`postgres.planNodes`
  で実行計画を確認する（[PG15公式資料](https://www.postgresql.org/docs/15/pgtrgm.html)）。
  未採点を多く含む既存poolでの結果は、方式の同等性や真のrecallを証明しない。

入力は読み取りのみ。heldout gold と private ディレクトリへの出力は拒否する。
JSON に質問文・記録本文・接続文字列は含めない。
今回の結果下書き: [pg-trgm-recall-20261004.md](pg-trgm-recall-20261004.md)。

## Worker memory 計測

リポジトリルートで実行（`--dense` / `--enrichment` / `--out` は任意）:

```sh
node --expose-gc --max-old-space-size=384 scripts/hermes-search/retrieval/prototypes/worker-memory.mjs \
  --snapshot "$HOME/Documents/hermes-retrieval-private/snapshots/nonconformity-snapshot-pi5-20261004.json" \
  --dense "$HOME/Documents/hermes-retrieval-private/stores/dense-pi5-20261004.bin" \
  --enrichment "$HOME/Documents/hermes-retrieval-private/stores/enrichment-pi5-20261004.jsonl" \
  --out /tmp/hermes-worker-memory-new.json
```

入力は読み取りのみ。出力は Markdown と集計 JSON（新規ファイル、private 外、本文なし）。
各段階の GC 前後ではなく、各段階の前後に GC して保持量を比較する。
子 worker は dense / vector を無効化し検索要求を送らず、`workerReady` 直後の RSS を読む。
Mac の `ps` が EPERM / EACCES なら RSS は `null` として他の計測を保存する。
結果と外挿・制約: [worker-memory-20261004.md](worker-memory-20261004.md)。
