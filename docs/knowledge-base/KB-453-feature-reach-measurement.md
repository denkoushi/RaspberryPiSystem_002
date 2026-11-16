# KB-453: 機能ごとに AI が読む量の月1回の測定記録

- Status: active
- Scope: `scripts/analysis/feature-reach/` による画面・API・定期処理の測定。以後の測定記録の正本はこの KB。

## Context

目的は、現場に合わせて毎日変え続けても、壊れず遅くならないことである。量は手を入れる場所を探す材料であり、目標値にはしない。
10年で変わり続けるものは、現場の要望、端末の数、土台の入れ替え、データの蓄積の4つである。
計画書の Context and Orientation と Concrete Steps から、基準の数値と測定手順をここに引き継ぐ。

## Symptoms Or Trigger

月1回、機能の入口から読む範囲を測り直す。fix の件数や割合は危険の指標にしない。
保存の流れの区切り直しの効き目は、計画書の段階2完了後90日の間に、下記12件と同じ型の保存の消失・上書きの不具合が再発するかで見て、件数や割合は比べない。

## Investigation

数え方の注意:

- トークンは粗い目安。行数も出るが、換算は計画書・実装どおり文字数÷3.5であり、行数からの換算ではない。`k` は千トークンの目安を表す。
- テストの量は、届いたファイルを直接 import するテスト全体を含む上限であり、毎回読む必要量ではない。
- 静的な import のつながりだけを数える。実際の呼び出し・データの流れをすべて表すものではない。
- `RUNTIME=1` は型だけの import / export を除き、実行時のつながりだけを数える。
- `cycles.cjs` の最後の「輪の数 N」行も `^輪` に当たる。`grep -c '^輪'` では1多くなるため、数は最後の行で読む。

2026-11-16 の大きい入口(測った SHA: `8cffcefb`):

| SHA | 種類 | 対象と量 |
| --- | --- | --- |
| `8cffcefb` | API | 組立の手順資料 602k、サイネージ 584〜600k、CSV の取り込み 582k、業務 Hermes 521k |
| `8cffcefb` | 定期処理 | 起動するだけのファイル 約1170k、CSV の取り込み 574k、サイネージ描画 572k、業務 Hermes の夜間処理 416k |

サイネージの内訳は management-overview 600k、render 587k、visualization-image 586k、canvas-preview と kiosk/signage-preview 各584k。

起動するだけのファイルの約1170kは、全部の定期処理を読み込むことによる見かけの量である。
API で窓口を登録しないため入口にしないファイルは34本ある。

依存を丸ごと外した場合の試算(基準 b4ae9625 時点。実際に減る量ではなく上限):

| 外す依存 | 減る入口と例 |
| --- | --- |
| `work-instruction-service.factory.ts` | 12入口の各入口で1万以上減る(業務 Hermes 52万→38万) |
| `leaderboard-decoration.ts` | 8入口で減る(`leaderboard-phased-read.ts` 約27万→約19万) |
| サイネージ→生産日程 | 5入口で約7万減るが、`signage-a2ui-data.service.ts` の先が約31万あるので51万台のまま残る |

直しの数え方(90日間の製番ボード・切削の片の直し38件を件名で分類):

- 約26件は表示や操作の要望対応(★、2台表示、凡例、半角など)、約12件は保存の消失・上書きという同じ型の不具合。12件は #2688〜#2788 の時期に集中した。
- 12件の内訳: `9b3f18df` 保存が消える、`6c9dd60e` 毎回409で保存できない、`9031af96` 待ち行列が止まる、`02768544` 他端末の変更を上書き、`f302a0f4` 消した1台が戻る、`e7318fa3` / `520d98e2` 古い版の送信、`c55f9e9a` / `611241d3` / `d1903d19` / `1b87230d` 読み直し、`78d41a3f` 他端末に届かない。
- 12件のうち5件は画面と API の両方を直した。サイネージ・assembly・imports・business-hermes は届く範囲が広くても、同じ90日の保存系の直しは0〜1件で、量だけでは説明できない。

## Root Cause

AI が一度に読み切れない範囲を直すと、見ていない所との食い違いが残り得るため測る。量だけでは不具合の原因や危険度を説明できない。

## Fix

`scripts/analysis/feature-reach/` に測る道具を置いた。基準と測り直した結果をこの KB に記録し、月1回の測定を続ける。

## Prevention

月1回、main の最新で測り、その SHA を Validation の表に書く。「大きい入口」の表も、reach の出力の上位を写して毎月更新する。CI には組み込まない。
前提: リポジトリ直下で `pnpm install --frozen-lockfile` 済みであること。道具は `apps/api/node_modules/typescript` を使う(別の場所は環境変数 `TSPATH` で指定できる)。以下はすべてリポジトリ直下で実行する。メモリ約1.8GB、1回1分前後を見込む。

測った SHA と入口の一覧を出す(件数は標準エラー):

```sh
git rev-parse HEAD
mkdir -p /tmp/fr
node scripts/analysis/feature-reach/entries.cjs web /tmp/fr/e-web.json 2>/tmp/fr/e-web.err
node scripts/analysis/feature-reach/entries.cjs api /tmp/fr/e-api.json 2>/tmp/fr/e-api.err
node scripts/analysis/feature-reach/entries.cjs sched /tmp/fr/e-sched.json 2>/tmp/fr/e-sched.err
```

実行時のつながりを測る。定期処理も API のプログラムで測る:

```sh
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs web /tmp/fr/e-web.json /tmp/fr/r-web.json > /tmp/fr/o-web.txt
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-api.json /tmp/fr/r-api.json > /tmp/fr/o-api.txt
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-sched.json /tmp/fr/r-sched.json > /tmp/fr/o-sched.txt
```

保存の流れは入口の一覧を groups の定義に替える:

```sh
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs web scripts/analysis/feature-reach/groups/save-flow-web.json /tmp/fr/r-save-web.json > /tmp/fr/o-save-web.txt
RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs api scripts/analysis/feature-reach/groups/save-flow-api.json /tmp/fr/r-save-api.json > /tmp/fr/o-save-api.txt
```

輪は型も含めるため `RUNTIME` を付けず、DUMP→cycles の順で出す:

```sh
DUMP=/tmp/fr/adj-api.json node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-api.json /tmp/fr/rt-api.json > /tmp/fr/o-type-api.txt
TOP=20 node scripts/analysis/feature-reach/cycles.cjs /tmp/fr/adj-api.json > /tmp/fr/o-cyc.txt
```

表の各列を埋める(区切りは実装の `join('\t')` によるタブ。区分は以後も丸めた4列目の表示値で数える):

```sh
# 画面/API: 総数と 5万未満 / 5〜10万 / 10〜20万 / 20万以上
awk -F'\t' '{v=$4; sub(/k$/,"",v); v+=0; if(v<50)a++; else if(v<100)b++; else if(v<200)c++; else d++} END{print NR, a"/"b"/"c"/"d}' /tmp/fr/o-web.txt
awk -F'\t' '{v=$4; sub(/k$/,"",v); v+=0; if(v<50)a++; else if(v<100)b++; else if(v<200)c++; else d++} END{print NR, a"/"b"/"c"/"d}' /tmp/fr/o-api.txt
cat /tmp/fr/e-web.err /tmp/fr/e-sched.err
tail -1 /tmp/fr/e-api.err
grep -c 入口にしない /tmp/fr/e-api.err
grep GrindingPlanningBoardPage /tmp/fr/o-web.txt
cat /tmp/fr/o-save-web.txt /tmp/fr/o-save-api.txt
head -1 /tmp/fr/o-cyc.txt
tail -1 /tmp/fr/o-cyc.txt
# 大きい入口の表: 上位を確認し、起動専用ファイルの見かけの量も区別して写す
head -10 /tmp/fr/o-api.txt /tmp/fr/o-sched.txt
```

cycles は輪のファイル数の降順であり、トークン量の順ではない。

あわせて、直前の1か月の変更の多さと広さを数える(2026-11-16 追加。読むだけで5秒前後)。起点は測る日の1か月前にし、その日の 00:00 から数える。`REV` に上で測った SHA を渡す(省くと手元の `origin/main` を数え、後で同じ数を再現できない)。結果は下の「変更の多さと広さ」の表に1行足す。

```sh
REV=$(git rev-parse HEAD) sh scripts/analysis/feature-reach/change-width.sh <1か月前の日付> apps/web/src/features/kiosk/grindingPlanningBoard apps/api/src/services/production-schedule/grinding-planning-board apps/web/src/features/assembly apps/api/src/services/assembly apps/api/src/services/imports apps/api/src/services/signage apps/api/src/services/business-hermes apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.tsx apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx
```

最後の2つ(ガントの画面とページ)は、計画書の段階2bの効き目を見るための列である。

コミットが多く、ファイル数の75%点が大きい機能が、区切り直しの次の候補になる。量の表は、その機能のどこを読むかを探すときに使う。

変更の多さと広さ(件数はコミット数、数字は1件あたりのファイル数の中央値・75%点):

| 測った日 | SHA | 起点 | ボード画面 | ボード API | 組立 画面/API | 取り込み | サイネージ | 業務 Hermes | ガントの画面 / ページ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-16 | `83678cbf` | 2026-10-17 | 102件、5・13 | 43件、8・21 | 26件 8・12 / 38件 11・21 | 24件、10.5・22 | 7件 | 9件 | 45件 6・18 / 42件 11・19 |

サイネージと業務 Hermes は件数が少なく、多くの区画をまたぐ大きなコミット(最大157ファイル)に引っぱられるので、中央値と75%点は書かない。

## Validation

1行目は計画書の Context and Orientation から写した基準。2行目以降は上の手順で測った結果。
画面・API の区分の順は **5万未満 / 5〜10万 / 10〜20万 / 20万以上**。 区分は reach.cjs の出力の4列目(千トークン単位に丸めた表示値)で分ける。

| 測った日 | SHA | 画面の入口数と量の区分 | API の入口数と区分 | 製番ボード画面 | 保存の流れ(画面 一覧/待ち行列だけ) | 保存の流れ(API/自動分割を除く) | API の輪の数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-16(基準) | `b4ae9625` | 115件、74/28/12/1 | 168件、93/33/25/17 | 312k(174ファイル 20246行) | 旧定義 73k / 約20k | 約200k / 約155k | 12(先頭行 `輪 9 files 34k`) |
| 2026-11-16 | `8cffcefb`(main) | 115件、74/28/12/1 | 168件、93/32/27/16 | 310k(176ファイル 20037行) | 一覧 60k(31ファイル) / 22k | 197k / 152k | 11(先頭行 `輪 4 files 2k`) |

- 計画の枝 95b44853 で測った。apps と packages は 8cffcefb と差分なし。
- 2026-11-16 の行は表示値(丸めた4列目)で集計。丸めない値では API は93/33/26/16になる(`backup/restore.ts` が約99.7kで境目)。基準 `b4ae9625` の行がどちらで数えたかは記録が無い。
- 定期処理の入口: 基準 `b4ae9625` は28件、`8cffcefb` は29件。
- 保存の流れ(画面)は、基準の旧定義「待ち行列+offline+API hooks」73kと、段階2で作った新しい一覧60kで数え方が違う。単純な前後比較には使わない。

## Open Items

- 担当: 進捗追跡の会話に依頼中(2026-11-16)。決まったらここに書く
- 次の測定は 2026-12-16 頃。
- 数えるパスの一覧は上の手順で保つ。新しい機能ができたら、その機能のパスを足す。
- 段階2〜4の残りは計画書を正本とし、ここに複製しない。

## References

- [区切り直しの計画書](../plans/feature-reach-refactor-execplan.md)
- [ADR-20261116: リファクタリングの対象選びと進め方](../decisions/ADR-20261116-refactoring-target-selection.md)
- [測る道具 scripts/analysis/feature-reach/](../../scripts/analysis/feature-reach/)
- [PR #2839: 計画と道具](https://github.com/denkoushi/RaspberryPiSystem_002/pull/2839)
- [PR #2854: 輪を1つ減らした](https://github.com/denkoushi/RaspberryPiSystem_002/pull/2854)
