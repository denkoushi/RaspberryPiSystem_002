# ADR-20261116: リファクタリングは「よく変わり、広く散らばる所」から、テストで固定してから小さく進める

- Status: accepted
- Scope: このリポジトリのすべてのリファクタリング(機能の区切り直し、ファイル分割、依存の付け替え、値の受け渡しの整理)。

## Context

目的は、現場に合わせて毎日変え続けても、壊れず遅くならないことである。そのための目標を「1回の修正が、AI の読める範囲で済むコードにする」とする。2026-11 に、AI が一度に読める範囲へ機能を区切り直す計画(`docs/plans/feature-reach-refactor-execplan.md`)を進める中で、海外の知見を調べ、このリポジトリの履歴を数えた。

分かったことは次のとおりである。この結果から、目標を「機能のつながり全体の量を縮める」から上の言い方に改めた。

- import でたどれる量が小さいほど AI の作業がうまくいく、と直接示した研究は見つからなかった。量は「どこを読むか」を探す目安にとどまる。
- AI はファイルをたどって読むので、1つの変更で触るファイルが近くにまとまっていること、どこを見るかの手がかりがあること、テストで今の動きが押さえられていることが効く。読む量が増えると出来が不安定になる。
- 量が大きい機能(サイネージ、業務 Hermes など)は、1か月にほとんど変わっていなかった。変更は製番ボードに集まり、1件の変更がページからガントの行まで広がっていた。
- 量を減らすためだけの作業は、良くならないか、かえって悪くなった。index の再輸出の付け替えは量が変わらず、テストの mock が増えただけだった。他社でも、違反を消すためだけの層が増えたという振り返りがある。

## Decision

リファクタリングは次の順と決まりで進める。

1. 対象は、量の大きさではなく、変更の多さと広さ、同じ型の不具合がくり返すかで選ぶ。月1回、`scripts/analysis/feature-reach/change-width.sh` で機能ごとのコミット数と、1件あたりのファイル数(中央値・75%点)を数え、多くて広い所を候補にする。このスクリプトは渡したパスしか数えないので、数えるパスの一覧は KB-453 の手順で保ち、新しい機能ができたら足す。量の道具(`reach.cjs` など)は、候補の中でどこを読むかを探すときに使う。手順と記録は KB-453。
2. 手を入れる前に、今の動きをテストで固定する。そのテストが CI で実際に流れていることを先に確かめる(製番ボードの結合テストは、環境変数が渡らず CI で一度も流れていなかった)。速さにかかわる所は、描き直しの回数などをテストで押さえる。
3. 1つの PR では、ファイルを移す、依存を1本付け替える、テストを足す、のどれか1つだけを行い、動きを変える PR と混ぜない。一斉に作り替えない。
4. 何もせずに中継するだけのファイルや層を作らない。読む範囲が本当に狭まるときだけ区切り直す。量の試算は上限にすぎないので、着手前に写しで測り直し、減らないものはやらない。
5. 量や件数を目標や合否にしない。効き目は、ふだんの変更が少ないファイルで済むようになったか、同じ型の不具合が再発しないかで見る。
6. 遅くなる変更は採らない。jsdom の数は実機の速さそのものではないので、描画の作りを変えた PR は、反映の後に Pi4 のキオスクで1回動きを見る。
7. 現場の要望の PR と同じファイルを触るときは、要望の PR を先に通す。
8. 区切り直しの計画(`docs/plans/feature-reach-refactor-execplan.md`)の PR は、1本ごとに、実装した者とは別のレビュー役(Fable。枠が足りないときは Codex)に差分とコードだけを渡して読んでもらう。それ以外のリファクタリングは、`.cursor/rules/10-quality-ci-and-tests.mdc` の「PRレビューの深さ」に従う。
9. めったに変わらない大きなファイルは、大きいというだけでは分けない。月1回の測定で変更が増えたときに、上の1から8に沿って対象にする。行数の上限も設けない(下の Alternatives の CI の量上限と同じ理由)。
10. 部品へ渡す値を束ねるときは、2026-09-01 以降など区切った期間の履歴で、どれかの値を変えた件のうち2つ以上を同時に変えた件の割合を数え、件数があって半分を超える組だけを1 PR に1組ずつ束ねる。件数の少ない組は、大きな1件に引っぱられるので外す。条件を満たす組が無くなったら止める。
11. この進め方が保つのは「直し続けられるコード」までである。長く止まらずに動かすことは、部品の更新期限、機械の故障、バックアップ、証明書の期限など、コードの外の予防(`docs/plans/ten-year-prevention-lifecycle-execplan.md`、PR #2831)とあわせて成り立つ。区切り直しだけで長期運用の安定を満たしたとはみなさない。

## Alternatives

- 量の大きい入口から減らす: 量の大きい機能はほとんど変わっておらず、読む作業が少ないので効き目が小さい。採らない。
- index の再輸出(barrel)をやめる: 道具が再輸出を定義のファイルまでたどって数えるので量が変わらず、テストの mock が増えただけだった。採らない。
- 依存の向きの検査を新しく足す: 層の向きは API と画面のリント(`import/no-restricted-paths`)に、機能の境目は API の routes どうしにすでにある。採らない。
- 機能ごとに長い説明の文書を置く: 効き目は小さく、AI に書かせた概要はかえって悪いという報告がある(このリポジトリでは検証していない)。採らない。
- 量に数値の上限を設けて CI で止める: 数値を満たすための中継が増える(Goodhart の法則)。採らない。

## Consequences

- 良い点: 実際によく直す所から整うので、ふだんの作業で効き目が出る。テストで固定してから小さく進めるので、壊しにくい。
- 費用: 月1回の測定と、各 PR の前のテスト追加が要る。
- 危険: 変更の多さは現場の要望の中身で上下するので、数だけで判断しない。数は判断の材料にとどめる。件数が少ない機能は、大きなコミット1件に引っぱられるので中央値を読まない。
- 守ること: 区切り直しでは本番データ、DB の形、画面の見た目を変えず、PR ごとに戻せるようにする。

## Validation

- 月1回の測定結果を KB-453 の表に記録し、区切り直した機能の、1件あたりのファイル数が下がったかを見る(合否にはしない)。
- 区切り直した機能で、同じ型の不具合が再発していないかを見る。

## Supersedes / Superseded By

- なし。

## References

- [区切り直しの計画書](../plans/feature-reach-refactor-execplan.md)(出典の一覧は Artifacts and Notes)
- [KB-453: 月1回の測定](../knowledge-base/KB-453-feature-reach-measurement.md)
- Anthropic「How Claude Code works in large codebases」: https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start
- Anthropic「Effective context engineering for AI agents」: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Chroma「Context Rot」: https://trychroma.com/research/context-rot
- Shopify「A Packwerk retrospective」: https://shopify.engineering/a-packwerk-retrospective
- Martin Fowler「StranglerFigApplication」: https://www.martinfowler.com/bliki/StranglerFigApplication.html
- Martin Fowler「ParallelChange」: https://martinfowler.com/bliki/ParallelChange.html
- CodeScene「Change coupling」: https://codescene.com/blog/change-coupling-visualize-the-cost-of-change
