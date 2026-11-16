# KB-453: 機能ごとに AI が読む量の月1回の測定記録

- Status: active
- Scope: `scripts/analysis/feature-reach/` による画面・API・定期処理の測定。以後の測定記録の正本はこの KB。

## Context

目的は、現場に合わせて毎日変え続けても、壊れず遅くならないことである。量は手を入れる場所を探す材料であり、目標値にはしない。
10年で変わり続けるものは、現場の要望、端末の数、土台の入れ替え、データの蓄積の4つである。
計画書の Context and Orientation と Concrete Steps から、基準の数値と測定手順をここに引き継ぐ。

## Symptoms Or Trigger

月1回、機能の入口から読む範囲を測り直す。fix の件数や割合は危険の指標にしない。
保存の流れの区切り直しの効き目は、保存の消失・上書きという同じ型の不具合が再発するかで見る。

## Investigation

数え方の注意:

- トークンは粗い目安。行数も出るが、換算は計画書・実装どおり文字数÷3.5であり、行数からの換算ではない。`k` は千トークンの目安を表す。
- テストの量は、届いたファイルを直接 import するテスト全体を含む上限であり、毎回読む必要量ではない。
- 静的な import のつながりだけを数える。実際の呼び出し・データの流れをすべて表すものではない。
- `RUNTIME=1` は型だけの import / export を除き、実行時のつながりだけを数える。
- `cycles.cjs` の最後の「輪の数 N」行も `^輪` に当たる。`grep -c '^輪'` では1多くなるため、数は最後の行で読む。

2026-11-16 の大きい入口:

| 種類 | 対象と量 |
| --- | --- |
| API | 組立の手順資料 602k、サイネージ 587〜600k、CSV の取り込み 582k、業務 Hermes 521k |
| 定期処理 | 起動するだけのファイル 約1170k、CSV の取り込み 574k、サイネージ描画 572k、業務 Hermes の夜間処理 416k |

起動するだけのファイルの約1170kは、全部の定期処理を読み込むことによる見かけの量である。
API で窓口を登録しないため入口にしないファイルは34本ある。

依存を丸ごと外した場合の試算(基準 b4ae9625 時点。実際に減る量ではなく上限):

| 外す依存 | 減る入口と例 |
| --- | --- |
| `work-instruction-service.factory.ts` | 12入口で減る(業務 Hermes 52万→38万) |
| `leaderboard-decoration.ts` | 8入口で減る(27万→19万) |
| サイネージ→生産日程 | 5入口で約7万減る |

## Root Cause

AI が一度に読み切れない範囲を直すと、見ていない所との食い違いが残り得るため測る。量だけでは不具合の原因や危険度を説明できない。

## Fix

`scripts/analysis/feature-reach/` に測る道具を置いた。基準と測り直した結果をこの KB に記録し、月1回の測定を続ける。

## Prevention

月1回、リポジトリ直下で以下を実行し、Validation の表に1行足す。出力先は一時フォルダでよい。CI には組み込まない。
事前に `/tmp/fr` を用意する。測定はメモリ約1.8GB、1回1分前後を見込む。

入口の一覧(計画書のコマンドをそのまま使用):

```sh
node scripts/analysis/feature-reach/entries.cjs web /tmp/fr/e-web.json
node scripts/analysis/feature-reach/entries.cjs api /tmp/fr/e-api.json
node scripts/analysis/feature-reach/entries.cjs sched /tmp/fr/e-sched.json
```

実行時のつながりを測る。定期処理も API のプログラムで測る:

```sh
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs web /tmp/fr/e-web.json /tmp/fr/r-web.json
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-api.json /tmp/fr/r-api.json
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-sched.json /tmp/fr/r-sched.json
```

保存の流れは入口の一覧を groups の定義に替える:

```sh
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs web scripts/analysis/feature-reach/groups/save-flow-web.json /tmp/fr/r-save-web.json
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs api scripts/analysis/feature-reach/groups/save-flow-api.json /tmp/fr/r-save-api.json
```

輪は型も含めるため `RUNTIME` を付けず、DUMP→cycles の順で出す:

```sh
DUMP=/tmp/fr/adj-api.json node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-api.json /tmp/fr/rt-api.json
TOP=20 node scripts/analysis/feature-reach/cycles.cjs /tmp/fr/adj-api.json
```

## Validation

1行目は計画書の Context and Orientation から写した基準。2行目以降は上の手順で測った結果。
画面・API の区分の順は **5万未満 / 5〜10万 / 10〜20万 / 20万以上**。

| 測った日 | SHA | 画面の入口数と量の区分 | API の入口数と区分 | 製番ボード画面 | 保存の流れ(画面 一覧/待ち行列だけ) | 保存の流れ(API/自動分割を除く) | API の輪の数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-16(基準) | `b4ae9625` | 115件、74/28/12/1 | 168件、93/33/25/17 | 312k(174ファイル 20246行) | 旧定義 73k / 約20k | 約200k / 約155k | 12(最大 `輪 9 files 34k`) |
| 2026-11-16 | `95b44853`(main `8cffcefb` を取り込んだ計画の枝) | 115件、74/28/12/1 | 168件、93/32/27/16 | 310k(176ファイル 20037行) | 一覧 60k(31ファイル) / 22k | 197k / 152k | 11(最大 `輪 4 files 2k`) |

- 定期処理の入口: 基準 `b4ae9625` は28件、`95b44853` は29件。
- 保存の流れ(画面)は、基準の旧定義「待ち行列+offline+API hooks」73kと、段階2で作った新しい一覧60kで数え方が違う。単純な前後比較には使わない。

## Open Items

- 担当: 進捗追跡の会話(調整中)
- 次の測定は 2026-12-16 頃。
- 段階2〜4の残りは計画書を正本とし、ここに複製しない。

## References

- [区切り直しの計画書](../plans/feature-reach-refactor-execplan.md)
- [測る道具 scripts/analysis/feature-reach/](../../scripts/analysis/feature-reach/)
- [PR #2839: 計画と道具](https://github.com/denkoushi/RaspberryPiSystem_002/pull/2839)
- [PR #2854: 輪を1つ減らした](https://github.com/denkoushi/RaspberryPiSystem_002/pull/2854)
