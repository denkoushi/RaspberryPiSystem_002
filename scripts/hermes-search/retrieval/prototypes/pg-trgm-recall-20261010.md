# Hermes pg_trgm recall measurement — 2026-10-10 (flywheel questions, consensus labels)

2026-10-10 21:40 JST、Mac上のNode＋使い捨てPG15コンテナ（`pgvector/pgvector:pg15`、pg_trgm 1.6、lc_ctype en_US.utf8）で1巡。
入力は夜間 flywheel の合成質問 3 晩分（2026-10-07〜10-09、kept 179 問 = 開発用 134、held-out 45）と
合意ラベル `work/flywheel/labels.json`、snapshot は 2026-10-04 の 8,209 件。質問原文、カタログの body 欄、
フィルタ／enrichment なし。関連あり = 質問行の anchor と合意ラベル `g=3`（`--questions` 対応で追加）。

| 手法 | top30 | top200 | 未採点top200（延べ） | p50 ms | p95 ms |
| --- | --- | --- | ---: | ---: | ---: |
| 現行2-gram BM25 | 139/179 (77.7%) | 170/179 (95.0%) | 35,498 | 44.2 | 57.5 |
| pg_trgm similarity | 83/179 (46.4%) | 140/179 (78.2%) | 35,579 | 98.6 | 113.0 |
| pg_trgm word_similarity | 82/179 (45.8%) | 132/179 (73.7%) | 35,591 | 115.2 | 136.6 |

分割別 top30: 開発用 BM25 104/134、similarity 63/134、word_similarity 58/134。held-out BM25 35/45、similarity 20/45、word_similarity 24/45。
対応比較（top30）: similarity は BM25 から 13 問獲得・69 問喪失、word_similarity は 6 問獲得・63 問喪失。
実行計画は両方式とも `Aggregate > Limit > Sort > Seq Scan`（GIN は未使用、10/04 と同じ）。

読み方: 10/04 の手書き質問 67 問では両方式が BM25 と同程度だったが、合成質問は記録の語句の写しを避けるよう生成されている
（8 文字以上の連続一致なし、2-gram 重なり 0.5 以下）ので、文字 3-gram の集合類似度は不利になる。
実際の利用者の短い質問も同じ性質を持つため、pg_trgm を第一段候補に置く案は不採用。

再実行: [README.md](README.md) の `--questions` 例。詳細 JSON は Git 外 `runs/pg-trgm-recall-flywheel-20261010.json`。
