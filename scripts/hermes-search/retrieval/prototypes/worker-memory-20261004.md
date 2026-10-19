# Hermes worker メモリ計測下書き — 2026-10-04

Mac / darwin arm64、Node v24.3.0、snapshot 8,209 件。単位 MB は MiB
（1,048,576 bytes）。既存 retrieval の関数を import して使い、各段階の前後に
`global.gc()` を実行。本文・ID・秘密値は出力しない。
入力3ファイルの SHA-256・サイズ・mtime は計測前後で一致した。

| 段階 | heapUsed MB | rss MB | external MB | arrayBuffers MB | Δheap MB | Δrss MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 起点（import 済み、入力未読） | 6.77 | 61.20 | 3.52 | 0.08 | 0.02 | 0.11 |
| 2 JSON.parse + authorizedRecords | 11.32 | 103.09 | 3.52 | 0.08 | 4.54 | 41.81 |
| 3 本文を除いた facet 記録のみ | 9.02 | 111.00 | 3.52 | 0.08 | -2.31 | 5.77 |
| 4 元の記録 + lexicalCorpus | 15.40 | 122.63 | 3.52 | 0.08 | 4.06 | 5.94 |
| 5 + valueIndex | 15.48 | 125.03 | 3.52 | 0.08 | 0.09 | 2.39 |
| 6 + buildCorpusView 全体 | 19.67 | 131.34 | 3.52 | 0.08 | 4.18 | 6.31 |
| 7 + dense store | 23.02 | 204.78 | 36.06 | 32.62 | 3.36 | 73.44 |
| 8 + enrichment store / attach | 47.16 | 242.28 | 36.06 | 32.62 | 24.14 | 37.48 |

Δ は各段階の GC 後の「後 − 前」。JSON に両方の値と4指標の差分を保存する。
段階3は比較分岐。facet 記録を解放して snapshot を読み直した後に段階4を開始する。
段階4・5の独立した索引も保持して段階6の view を追加するため、worker の起動時と同様に
lexicalCorpus / valueIndex がそれぞれ2個存在する。単一 source の view 内では
`bySource.nonconformity.lexicalCorpus` と `view.lexicalCorpus` は同じ参照。
段階8は worker と同様、store を保持して view の記録に attach し、lexicalCorpus は再構築しない。

## 文書あたりの概算と内訳

- カタログの body 欄は `condition`、`remarks`、`correctiveContent`、`disposition`。
  本文 UTF-8 合計 **2,411,788 bytes（2.30 MB）**、**294 bytes/文書**。
  UTF-16 payload は **1,737,902 bytes（1.66 MB）**。
  UTF-8 のファイル上の量と V8 の文字列保持量は異なる。
- `prepareLexicalCorpus` は `{documents, docCount, totalLength, avgLength}` を返す。
  documents は文書ごとの `{id, folded, length}` 配列。id は元記録の文字列を参照し、
  folded は本文を連結して NFKC・小文字化・空白除去した文字列、length は
  `max(0, folded.length - 1)`。永続的な posting / token 頻度 Map は持たない。
- lexicalCorpus 1個の GC 後増分は **4.06 MB、519 bytes/文書**。
  folded の1/2-byte文字列 payload 概算は **208 bytes/文書**。
  後者は object・配列・string header・rope 構造を含まず、前者にはそれらが含まれる。
  `Buffer.byteLength` は V8 の rope 文字列を flatten し得るため、文字列の詳細集計は
  全段階の計測が終わってから行う。
- valueIndex は source → field → distinct な元の値の配列。値の文字列は記録と共有する。
  フィールド別 distinct 値の延べ数は **8,389**。
- dense は store 全 **8,265 entries**、Float32 vector **33,853,440 bytes（32.29 MB）**。
  `.bin` の reader は `dense-index.mjs` ではなく `dense-dgx.mjs` の `readDenseStore`。
  段階7の arrayBuffers 増分は **32.54 MB**。external は arrayBuffers を含むので足さない。
- enrichment は store **8,261 entries**、attach **8,205 文書**。
  store の保持と attach 合計の heap 増分は **24.14 MB**。

## 本文を持たないと何 MB 減るか

記録の body 欄だけを除くと保持 heap は **2.31 MB 減る**。lexicalCorpus は別に残る。
同段階の RSS は **5.77 MB 増加**したため、RSS の削減量はこの逐次計測から保証できない。

## lexicalCorpus と valueIndex はそれぞれ何 MB か

独立に追加した1個の保持 heap は lexicalCorpus **4.06 MB**、valueIndex **0.09 MB**。
段階6はこれらを持つ view 全体をさらに追加し **4.18 MB** 増える（索引の二重計上を区別）。

## 10 倍（82,090 件）への外挿

単純線形では本文除去 **23.10 MB 減**、lexicalCorpus 1個 **40.60 MB**、valueIndex 1個 **0.89 MB**。
段階8の増分を10倍・起点を1回とすると heap **410.65 MB**、RSS **1,871.98 MB**（試作の概算）。

これは8万件を読み込んだ実測ではない。value の cardinality、文字列共有、store 件数比、
allocator / JIT / GC の挙動で変わる。とくに RSS は読み込み・解放の履歴に依存する。
`--max-old-space-size=384` は old-space の上限であり、RSS 上限ではない。
本番 Pi5 の既知の RSS 371 MB を Mac の測定値として扱わない。

## 現行 worker の実測と未達事項

実際の `worker.mjs` を子プロセスとして `--max-old-space-size=384` で起動し、
`workerReady` と count **8,209** を確認。enrichment は on、dense provider は未設定、
dense index / vector は off。環境は whitelist とし、検索要求は送信せず EOF で正常終了した。
JEV / DGX は呼ばない。

Mac の `ps -o rss= -p <pid>` が sandbox の **EPERM** で拒否され、
**現行 worker の RSS は取得できなかった**。JSON の `worker.rssBytes` は `null`。
段階8の 242.28 MB は試作プロセスの RSS であり、worker RSS の代替にしない。

検証:

- `node --check scripts/hermes-search/retrieval/prototypes/worker-memory.mjs`: 成功。
- 実データ3ファイルを指定した計測: 成功、JSON と標準出力の Markdown を生成。
- `cd scripts/hermes-search && node --test retrieval/`: 26成功・2失敗。
  `dense-dgx.test.mjs` のテスト用 localhost listen が **EPERM**。
  この環境では全体の成功を確認できず、既存コード・テストは修正していない。
- corpus / executor / value-index / worker の個別テスト: **48/48 成功**。
- 小さな fixture で任意引数省略時の6段階出力、GC 必須、新規・private 外の出力制約、
  不正 JSON の本文非表示を確認: 成功。

再現コマンドは [README.md](README.md) を参照。
今回の生計測 JSON は `/tmp/hermes-worker-memory-20261004-final.json`。
RSS 読み取りと localhost listen が許可された環境で、worker RSS と全テストの成功を確認する必要がある。
