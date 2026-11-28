# 要領書の「読んだ感想」の精度記録

- Status: 記録を足していく文書。測った変更1つにつき1項目
- Scope: 毎晩 2:50 に業務 AI が要領書を読んで返す感想(`apps/api/src/services/assembly/procedure-document-feedback.service.ts`)

採用しなかった変更も、数字と理由を残す。同じ案を二度試さないため。

## 輪の回し方

1. **測る**: 要領書エディタの「読んだ感想」欄で、感想1つずつに「役に立った」「外れ」を付ける。感想1つにつき評価は1つで、週1回の話し合いの場でみんなで付ける前提。評価は `AssemblyProcedureDocumentFeedbackRating` に入る。
2. **回帰の例として残す**: 感想の行には、AI に渡した中身(名前を伏せた後の文書名・ページの文字・写真の読み取り結果)が `modelInput` に、指示文と専門知識の版が `promptVersion` に残る。評価の付いた感想と `modelInput` の組が、そのまま比べるための例になる。
3. **直して比べる**: 指示文や専門知識(`procedure-document-feedback.reference.ts`)を直すときは、評価の付いた行の `modelInput` で直す前と後の両方を流し、外れと同じ趣旨の感想が減ったか、役に立った感想が消えていないかを並べて見る。結果はここに書く。
4. **採用のルール**: 評価がたまってから決める。

画面に出るのは系列の最新の感想だけなので、要領書を直すと翌晩からは新しい感想が評価の対象になる(前の感想の評価は残る)。`promptVersion` は指示文と専門知識だけの版で、業務 AI のモデルを替えたときは、その日付をここに書いて区別する。

最初のうちは件数が少ないので、割合ではなく件数で書く。評価で分かるのは AI が書いたことの当たり外れだけで、見落としは測れない。外れの理由を条件にして感想を決め打ちで弾くことはしない。

## 数え方

本番 DB は読むだけ。Pi5 の DB コンテナで `statement_timeout` を付けて流す。

    SET statement_timeout = '5s';
    SELECT f."promptVersion", r."section", r."verdict", COUNT(*)
    FROM "AssemblyProcedureDocumentFeedbackRating" r
    JOIN "AssemblyProcedureDocumentFeedback" f ON f."id" = r."feedbackId"
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

`modelInput` と感想の本文には人の作業内容が入るので、外部のサービスへ送らない。

## 記録

### 2026-11-28 測る仕組みを入れた

- 評価のボタンと、`modelInput`・`promptVersion` の保存を追加した。AI への指示文と専門知識は変えていない。
- これより前に作られた感想(11/28 朝の1件)は `modelInput` と `promptVersion` が空で、比べる例には使えない。評価は付けられる。
