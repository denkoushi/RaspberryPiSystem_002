---
id: kiosk-operation-guide-accuracy-log
title: キオスク操作案内の当たり率ログ
status: living log
last_verified: 2026-10-22
---

# キオスク操作案内の当たり率ログ

- 対象: キオスク Chat「検索」で「画面の操作方法を見る」を選んだときに返す操作ガイド(`docs/kiosk-operation-guide/`)の文書選び
- 方針: 不適合検索([Hermes retrieval accuracy log](./hermes-retrieval-accuracy-log.md))と同じ。測った変更だけを採用し、採用も不採用も数字と理由をここに残す。特定の質問や言葉だけを通す例外(同義語の追加など)は入れない。誤った画面を返すより「説明はまだありません」の方を良しとする。

## 測り方

評価セットは `scripts/hermes-search/operation-guide/gold/operation-guide-v1.json`(58 件。質問 → 正しい文書。`null` は操作案内では答えない質問、`previousScreen` は直前の操作ガイド画面)。秘密は含まないのでリポジトリに置く。

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

### 2026-10-22: 続きの質問と NFC タグ手順

前回保存した変更前の索引・evaluator・文書・50 件の評価セットを使って再測定。全段階で同じ見本 `master-names.sample.json` を使用し、本番データは使っていない。文書のみ段階は旧コードと更新文書・58 件、全変更段階は更新コードと更新文書・58 件。

| 段階 | 正解 | hit | correct_null | miss | wrong | false_answer | accuracy | wrong_rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 変更前 50 件 | 43/50 | 40 | 3 | 1 | 5 | 1 | 0.860 | 0.120 |
| 文書のみ 58 件 | 47/58 | 43 | 4 | 1 | 8 | 2 | 0.810 | 0.172 |
| 全変更 58 件 | 52/58 | 47 | 5 | 1 | 4 | 1 | 0.897 | 0.086 |

outcome が変わった既存ケースと、追加ケースの結果:

| ケース | 変更前 | 文書のみ | 全変更 |
| --- | --- | --- | --- |
| g29 在庫の補充 | hit | wrong | hit |
| g39 納期の変更 | wrong | wrong | hit |
| g51 タグの登録手順(在庫の続き) | — | wrong | hit |
| g52 タグの登録手順(単独) | — | hit | hit |
| g53 補充タグを追加したい | — | hit | hit |
| g54 数量タグの登録 | — | hit | hit |
| g55 タグの付け替え(在庫の続き) | — | wrong | hit |
| g56 タグの付け替え(単独) | — | hit | hit |
| g57 超硬チップの欠け(在庫の続き) | — | correct_null | correct_null |
| g58 関連の記録について知りたい(在庫の続き) | — | false_answer | correct_null |

- 初回の `matchStrength` は family 内に画面名・keyword の一致がなければ全体へ戻る。続きの `familyMatchStrength` は family 内だけを判定し、空の family も `none` とする。
- 続きは同系統の画面名・keyword 一致、または how-to と全体の画面名一致でガイド経路へ進む。それ以外は LLM 経路とし、subject resolver を呼ばない。evaluator も同じ条件とする。
- keyword は「質問文がその keyword を丸ごと含むか」で採点する(未知語判定も同じ)。分割語との部分一致をやめたので、g29 の「補充」が「補充タグ」に加点されなくなる。逆に「数が違う」のような複数語の keyword は分割語をまたいでも当たる(g28「在庫の数が違う」)。画面名・見出し・本文の部分一致は維持する。
- 旧 50 件に退行なし(43 件 → 44 件。g39 納期の変更 が改善)。途中で試した「分割語との完全一致」は g28 を落としたため採らなかった。
- 採用。残る誤り 6 件は前回と同じ種類: g03 切削油の在庫(在庫操作 vs 在庫の集計)、g05 ガイド面の加工が荒い(要領書の編集画面に誤って当たる)、g12 マイクロメータを借りたい(「〜を借りたい」の語尾)、g18 バーコードが読めない、g24 社員証の登録、g38 製番の検索(生産スケジュール系)。
- JSON は作業ディレクトリ外の `/private/tmp/kiosk-guide-followup-oy2zidit/` に保存(`01-baseline.json`、`02-docs-only.json`、`04-full-v2.json` が上の表の全変更。`03-full.json` は keyword を分割語との完全一致にした途中版で 51/58)。前回の全変更結果との差は g29: wrong → hit、g55: miss → hit、g58: false_answer → correct_null、g39: wrong → hit。
- 配布と実機確認(2026-10-22): PR #2226 を main 34d7087c として Pi5 に配布(run 20261022-063127-9905c5、health 4 か所 200、ロールバック下限 e5788b91)。実機のキオスク Chat(検索)で「チップの登録手順」→「画面の操作方法を見る」で 在庫の準備 の基本の手順が返り、続けて「タグの登録手順」と聞くと選択肢なしで 在庫の準備 の NFCタグ(数量タグ・補充タグ)の 5 手順が返った。利用者確認済み。
- 検証: guide / subject / consultation の指定 3 ファイルは 189 テスト成功(約 7 秒、g58 の LLM 経路と resolver 非呼出を含む)。API lint、`node scripts/docs/check-kiosk-operation-guide.mjs`、API build(`tsconfig.build.json`)も成功。テスト初回は Prisma の darwin-arm64 エンジン不足のため、既存の同版 5.22.0 エンジンを `PRISMA_QUERY_ENGINE_LIBRARY` で指定して再実行。build 初回は `part-search-core` / `shelf-layout-core` の生成物不足のため、両パッケージの build 後に再実行した。`.env` 自動読込は無効化。commit / push / PR / deploy は未実施。

### 2026-10-22: 業務LLMを GLM に替えた後の確認と、「説明はまだありません」の直後の質問

21:16 に業務LLMを Qwen3.8-Flash-Next から GLM-5.3-Flash-FP4 に替えた直後、キオスク Chat で次の 2 つが見えた。(1)「チップの検索手順」→「画面の操作方法を見る」で「この操作の説明はまだありません」。(2) 続けて自由入力した「チップの登録手順」に、GLM が手順を出さず「在庫の準備が最も近い」と書いて質問を返した。

切り分け:

- この表の指標は文書選びだけで、LLM を通らない。「画面の操作方法を見る」を選んだ後の答えも検索だけで決まる(`directGuide` → `answerOperationGuide`)。GLM への切替後に同じ見本 `master-names.sample.json` で測り直すと、58 件で 52/58(accuracy 0.897、wrong_rate 0.086)、旧 50 件で 44/50 と、切替前と同じ。モデルを替えてもこの値は動かない。
- (1) は GLM ではない。朝に Qwen で確かめた質問は「チップの**登録**手順」で、今回の「チップの**検索**手順」とは別の質問。検索だけで null になり、LLM は呼ばれていない。在庫の文書には品物を開く・探す手順(`item-inventory.md`)があるが「検索」という言葉が無い。同義語の追加はこのログの方針で入れないので、評価セットに g59(期待 `item-inventory.md`)として足し、残る誤りとして数える。
- (2) は経路の問題。続きの質問をガイドに回す条件は「直前の答えにガイドがある」ことで、直前が「説明はまだありません」だとガイドが無いため、次の質問は LLM(業務 Hermes)に回る。そこで GLM が操作ガイドを検索し、確認の質問を返した。Qwen のときは同じ流れを通っておらず、LLM の段階(手順を返す/断る/質問を返す)の Qwen の基準値は無い。本番の会話記録は読み取り許可が無く、受領ログ(`receipts-2026-10-22.jsonl`)にも経路の記録が無かったため、LLM の段階の件数は数えていない。
- system prompt の推測禁止の書き方、`reasoning_effort=low`、検索結果の渡し方は、今回の 2 件の原因ではない。「画面の操作方法を見る」の型の文(「該当が無いときは推測せず…」)は、ガイドの経路が LLM を通らないため LLM に届いていない。

変更: 直前の答えが操作ガイドの「説明はまだありません」で、今回の質問が手順の聞き方(`isOperationHowToQuestion`)のときだけ、登録データで系統を引き(`resolveFamilies`)、操作ガイドが当たれば(`matchStrength` が `none` でない)ガイドで答える。最初の質問で「画面の操作方法を見る」を先頭に出す条件と同じ考え方。手順の聞き方でない質問(「超硬チップの欠け」「関連の記録について知りたい」)は今までどおり LLM に回し、登録データも引かない。evaluator も同じ条件にし、評価セットに `afterGuideMiss` の 4 件(g60〜g63)を足した。

| 段階 | 正解 | hit | correct_null | miss | wrong | false_answer | accuracy | wrong_rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GLM 切替後・変更前 58 件 | 52/58 | 47 | 5 | 1 | 4 | 1 | 0.897 | 0.086 |
| 変更前 63 件(g60・g61 は LLM に回るので miss) | 54/63 | 47 | 7 | 4 | 4 | 1 | 0.857 | 0.079 |
| 変更後 63 件 | 56/63 | 49 | 7 | 2 | 4 | 1 | 0.889 | 0.079 |

- 採用。直った 2 件: g60「チップの登録手順」(直前が説明なし)→ 在庫の準備、g61「ノギスの持出の仕方」(直前が説明なし)→ 計測機器 持出。旧 50 件は 44/50 のまま、wrong_rate は上がらない。変更前 63 件の行は、変更前のコードでは g60・g61 がガイドを通らないことから数えた(旧 evaluator は `afterGuideMiss` を読まない)。
- 残る誤り 7 件: g59 チップの検索手順(言葉の違い)と、前回からの 6 件(g03、g05、g12、g18、g24、g38)。
- 未測定: LLM の段階の答え方(GLM で手順を返す/断る/質問を返す)。測るには本番の会話を実際に流すか、本番の会話記録を読む必要があり、今回は行っていない。
- 検証: guide / subject / consultation の 3 ファイルで 193 テスト成功(新しい 4 件を含む。変更を外すと「説明なしの直後の手順の質問」の 2 件が失敗することを確認)。
