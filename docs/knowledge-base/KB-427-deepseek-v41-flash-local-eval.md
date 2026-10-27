# KB-427: DeepSeek V4.1-Flash-1017（DGX 2台）を業務チャットとコーディングで評価した記録と、測り直しの手順

- Status: active
- Date: 2026-10-27
- Scope: DGX Spark 2 台（Spark 1 = gx10-5ef3 / 192.168.100.10、Spark 2 = gx10-f75b / 192.168.100.11）で動かした DeepSeek V4.1-Flash-1017。業務チャット（キオスク Chat）116 件の答え直しと、DeepSeek Harness（dsh）による過去 PR 3 件の解き直し。Pi と本番の業務 LLM（GLM）の設定は変えていない

ハーネスやモデルが良くなったときに同じ条件で測り直せるよう、設定、手順、結果、注意点を省略せずに残す。チャットの数字の要約は [`kiosk-operation-guide-accuracy-log.md`](../plans/kiosk-operation-guide-accuracy-log.md) の 2026-10-27 の 2 節にもある。

## Context

- 問い 1: DeepSeek V4.1-Flash-1017 は、業務 LLM（GLM-5.3-Flash、10/22 から本番）の代わりになるか。
- 問い 2: DeepSeek Harness + DeepSeek は、コーディング作業で Codex の代わり、または並行の作業役になるか（Claude が指示とレビュー、Fable が第三者レビューをする前提）。
- 2 回測った。
  - 1 回目（10/27 夜）: 温度 1.0、チャットは思考なし。dsh は既定の設定。
  - 2 回目（同夜）: DGX Spark フォーラムで点が最も高かった設定（温度 0.4、思考あり）。dsh は依頼文に「終える前の確認」を足し、出力を `--json` にした。
- 測ったのは検閲を外した重み（`ABLIT=1`）だけ。利用者の判断（10/27）: 「無検閲版にかちがあるから、検閲版は必要ないよ」。検閲ありの版は作らない。

## Symptoms Or Trigger

- 2026-10-27、DeepSeek V4.1-Flash-1017 の 2 台用キット（Mia-AiLab、TensorFold）が公開され、業務 LLM とコーディングの両方で試す価値があるか確かめることになった。

## Investigation

### 1. 動かした構成

| 項目 | 値 |
| --- | --- |
| 重み | `Mia-AiLab/DeepSeek-V4.1-Flash-1017-EXL3-EAQ-v1-2.9-bpw`（EXL3 2.9 bpw、検閲なし `ABLIT=1`、元は `drowzeys/keys-DeepSeek-V4.1-Flash-1017-Abliterated` 系） |
| エンジン | TensorFold、TP=2（RoCE/RDMA、2 本の線 `rocep1s0f0` / `roceP2p1s0f0`、MTU 9000） |
| キットの場所 | Spark 2 の `~/DeepSeek-v4.1-Flash-1017-2x-DGX-Sparks`（NFS で Spark 1 と共有） |
| コンテナ | `dsv41-1017-exl3-tf`（両機） |
| イメージ | `tensorfold-dsv41:exl3-tp2-928adbd0e57d` |
| モデルの大きさ | 104.96 GiB（rank cache: 95.1 GiB の expert を約 56 秒で読み込み、起動全体で約 76 秒） |
| 動作中の空き | 各機 約 7.4〜7.5 GiB（memguard の下限 2.5 GiB） |
| API | `http://192.168.100.11:8888/v1`、モデル名 `DeepSeek-V4.1-Flash-1017`、キーなし（`API_KEY=1` で必須にできる） |
| 窓 | 1048576 トークン、同時 4 本、drafts（投機デコード）オン、画像オン |
| サンプリング既定 | temperature 1.0、top_p 0.95、top_k 20（`scripts/config.sh`） |
| 思考 | チャットテンプレートの既定でオン。リクエストで `chat_template_kwargs: {"enable_thinking": false}` を送ると切れる。`max_tokens` は思考と答えの合計 |

起動と停止（Spark 2 で）:

```
cd ~/DeepSeek-v4.1-Flash-1017-2x-DGX-Sparks
TEMPERATURE=0.4 ./start.sh     # TOP_P / TOP_K / THINKING / REASONING_EFFORT も環境変数で変えられる
./stop.sh
```

- Spark 2 へは `ssh dgx-control-spark 'ssh 192.168.100.11 "..."'` で入る（`dgx-control-spark` は Spark 1）。
- `ABLIT=0`（検閲ありの重み）は、Spark 2 に Hugging Face CLI（`hf`）が無く `prepare.sh` が止まった。作る場合は `pip install -U huggingface_hub` と、変換用の空き容量（Spark 1 は不足）が要る。利用者の判断で作らない。
- 2 台のメモリをほぼ使い切るため、DeepSeek を動かす間は業務 GLM と画像生成（ComfyUI）を止める必要がある。

業務を止める・戻すコマンド（利用者が sudo で実行する。止める前に必ず利用者の承認を取る）:

```
# 止める
ssh -t dgx-control-spark 'sudo systemctl stop dgx-control-business-proxy dgx-control-keep-warm.timer && docker stop dgx-private-comfyui; ssh 192.168.100.11 docker stop dgx-private-comfyui; echo DONE'
# 戻す（GLM は proxy 経由の要求で自動起動する。約 5 分）
ssh -t dgx-control-spark 'sudo systemctl start dgx-control-business-proxy dgx-control-keep-warm.timer && docker start dgx-private-comfyui; ssh 192.168.100.11 docker start dgx-private-comfyui; echo DONE'
```

- GLM のコンテナ（`system-prod-trtllm` / `-rank1`）が残っている場合は、利用者に `docker stop` してもらう（gateway の stop-force トークンは Claude には許可されていない）。

### 2. 業務チャットの測り方（116 件）

道具: Mac の `~/tools/llm-replay/`（業務の会話記録を含むため、リポジトリにも外部サービスにも出さない。Codex にも渡さない）。

| ファイル | 役割 |
| --- | --- |
| `build.py MODEL [--thinking]` | 10/22 の比較と同じ 116 件（Qwen の本番回答があり、比較対象とした件）を `data/messages.jsonl` から組み直し、`data/payloads.jsonl` と `data/cases.json` を書く。ツールなし、保存された根拠だけを渡す。思考なしは `max_tokens` 4000、`--thinking` は 16000 |
| `check_ids.py` | 番号が 10/22 の記録（#52、#69、#94、#157、#162）と一致するか確かめる |
| `run.py BASE_URL OUT.jsonl [--limit N]` | 1 件ずつ 2 秒おきに送り、答え・時間・トークン・`finish_reason`・思考の先頭 2000 字を記録する。途中から再開できる |
| `judgeprep.py RUN LABEL [N]` | Qwen の本番回答と A/B を伏せて並べた判定用ファイル `data/judge-LABEL/in-1..N.json` と `key.json` を作る（`Random(20261027)`、根拠は先頭 24 件、記録カードの表示も文字で示す） |
| `rubric2.md` | 判定の指示。正答 / 断り / 質問返し / 誤り の 4 つと、better（A / B / 同等）を JSON で返させる |
| `tally.py DIR LABEL` | `key.json` と `out-1..5.json` から集計し、誤りの id と理由を出す |
| `instr.ts` / `instructions.txt` | 本番の業務チャットのシステム指示（組み直しに使う） |

手順:

```
cd ~/tools/llm-replay
python3 -I build.py DeepSeek-V4.1-Flash-1017 --thinking      # 思考なしは --thinking を外す
ssh -f -N -L 127.0.0.1:18888:192.168.100.11:8888 dgx-control-spark
python3 -I run.py http://127.0.0.1:18888/v1 data/run-NAME.jsonl
python3 -I judgeprep.py data/run-NAME.jsonl LABEL 5
# in-1..5.json ごとに Claude サブエージェントを 1 つ立て、rubric2.md の指示で out-N.json を書かせる（ファイル以外を読ませない）
python3 -I tally.py data/judge-LABEL LABEL
```

- 誤りと判定された件は、Claude が自分で読み直して妥当か確かめる（1 回目は #38、#159、2 回目は #42 を確認し、いずれも妥当）。
- データの保存場所: 1 回目 `data/run-deepseek.jsonl` / `data/judge-DeepSeek/`、2 回目 `data/run-deepseek-t04-think.jsonl` / `data/run-t04-think.log` / `data/judge-DeepSeek-t04think/`。思考なしの payload は `data/payloads-nothink.jsonl` に退避してある（`payloads.jsonl` は今は思考ありの版）。

### 3. コーディングの測り方（過去 PR 3 件）

道具: Mac の `~/tools/coding-eval/`。

| 課題 | 元の PR | 親コミットから解かせる内容 |
| --- | --- | --- |
| t1 | 3dda851b（#2219） | `apps/api` 生産スケジュールの 1 年超過削除を、id 順から (occurredAt, id) のキーセットページングに変える |
| t2 | fddeb94c（#2211） | フローティング Chat のリセットで古い絞り込みが残る不具合を直す |
| t3 | 1ef7c81a（#2265） | 在庫一覧を在庫の少ない順に並べる |

- `setup.sh`: 作業用のクローン `codex/` と `dsh/` を作り、各課題の親コミットに合わせ、`pnpm install --frozen-lockfile --prefer-offline` する。
- `run_task.sh codex|dsh|dsh2 t1|t2|t3`: 親コミットに戻してから作業役に解かせ、`results/<作業役>-<課題>/` に `diff.patch`、`summary.txt`、ログを残し、その PR 自身のテストと型チェックを実行する。
  - `codex`: `codex exec`（`gpt-6-astra` / `high`、fast）。
  - `dsh`: `~/tools/dsh/dsh-local "$(cat prompts/tN.md)"`（1 回目）。
  - `dsh2`: `~/tools/dsh/dsh-local --json "$(cat prompts/tN.md prompts/verify.md)"`（2 回目。NDJSON を `worker.jsonl`、思考を含む標準エラーを `worker.err` に保存）。
- 依頼文 `prompts/t1..t3.md` には共通で「git 操作をしない」「関係するファイルだけを最小限に変える」「テストを足して vitest で通ることを確かめる」「3 行以内で報告」を書いてある。
- `prompts/verify.md`（2 回目に足した「終える前の確認」）:

```
## Before you finish
- Reuse existing shared helpers and refs as they are. Do not move, rename or delete shared code unless the task asks for it.
- Keep the change as small as the task allows; do not add guards for cases the code already handles.
- Run the touched package's type check (`pnpm exec tsc --noEmit -p .`) and the related test files (`npx vitest run <file>`), fix what you broke, and run them again until they pass.
- Comments must describe what the code actually does.
```

### 4. DeepSeek Harness（dsh）の設定

- 版: `0.2.1-rc.2`、場所 `~/tools/dsh`（npm でローカルに入れた）。
- `dsh-local`: 127.0.0.1:18888 → 192.168.100.11:8888 の SSH トンネルを張り、`dsh --profile headless --patch local-dgx.patch.yml` を書き込み範囲を作業フォルダに限って実行する（`DSH_PERMISSION_MODE=workspace-write`、`DSH_HOME=~/tools/dsh/home`）。
- `local-dgx.patch.yml` で外部への送信をすべて止めた。
  - `session-log-deepseek` は**既定でオン**で、会話ログを最大 8 MiB まで DeepSeek へ送る。必ず `disabled: true` にする。
  - ほかに止めたもの: `session-telemetry-otel`（`mode: DISABLED`）、`plugin-package-inventory-deepseek`、`remote-access`、`tool-web`、`web-search-deepseek`、`web-deepseek-api`、`llm-deepseek`、`llm-deepseek-account`、`typert-gateway`。
  - `dsh-experimental-cot-translation`（思考を外部で翻訳する）は使わない。
- モデルの設定: `contextWindow` 200000、`maxTokens` 32768、`thinkingFormat: deepseek`、`reasoningEffort` は `high`（選べるのは `off` / `high` / `max`）。
- 気づいた点:
  - dsh は temperature を送らない。サーバーの既定が効くので、温度はキットの `TEMPERATURE=` で変える。
  - headless の役割指示（persona）に「終える前に確かめる」指示が無い。依頼文に足す必要がある（`verify.md`）。
  - `--json` を付けると、実行の出来事が NDJSON で標準出力に出る。付けないと思考が標準エラーに出る。

## Root Cause

評価の結論（不具合ではないため、ここでは「なぜ採用しないか」を書く）:

### チャット（116 件）

| 実行 | 正答 | 断り | 質問返し | 誤り | 時間の中央値 |
| --- | --- | --- | --- | --- | --- |
| DeepSeek 1 回目（温度 1.0、思考なし、`max_tokens` 4000） | 110（94.8%） | 0 | 0 | 6（5.2%） | 3.5 秒 |
| DeepSeek 2 回目（温度 0.4、思考あり、`max_tokens` 16000） | 110（94.8%） | 0 | 1（#47） | 5（4.3%） | 12.1 秒 |
| （参考）GLM-5.3-Flash（10/22 の判定） | 110（94.8%） | 4（3.4%） | 0 | 2（1.7%） | 9.0 秒（gateway 経由、別の夜） |
| （比較の基準）Qwen3.8 の本番回答 | 1 回目の判定 101 / 2 回目の判定 99 | 2 / 1 | 1 / 1 | 12 / 15 | — |

1 回目の詳細:

- 1 問ずつの比較: DeepSeek が良い 28、同等 71、Qwen が良い 17。
- 誤り 6 件（判定者のメモ）:
  - #38: 存在しない症状に別の記録を当てた。
  - #81: 該当記録が無いのに原因を断定した。
  - #84: 該当記録が無いのに無関係な溶接の記録を出した。
  - #91: 該当する 00007711 が無いのに別の記録を該当と断定した。
  - #159: 機構設計課の記録を機械課として「はい」と誤って肯定した。
  - #162: 機械課でない記録を挙げた。
- 速さ: 中央値 3.5 秒、p90 8.3 秒、最大 14.7 秒。出力の中央値 230 トークン、100 トークン以上の件で中央値 62.5 tok/s。
- 出力: JSON が壊れた答え 0、思考文の漏れ 0、すべて `finish=stop`。
- 判定は会話と同じモデルの Claude サブエージェント。

2 回目の詳細:

- 1 問ずつの比較: DeepSeek が良い 26、同等 83、Qwen が良い 7。
- 誤り 5 件:
  - #42: 根拠なく「引ける」と断定した（Claude が読み直し、妥当）。
  - #81: 思考が長すぎて 16000 トークンで切れ、答えが空だった（`finish=length`、160.5 秒）。
  - #84: 無関係な 00008208 を該当と断定した（1 回目と同じ問・同じ形）。
  - #91: 質問の事例とずれた答え（1 回目と同じ問）。
  - #162: 機械課の絞り込みを外した（1 回目と同じ問）。
- 1 回目の誤りのうち #38 と #159 は正しくなった。
- 速さ: 中央値 12.1 秒、p90 30.0 秒、最大 160.5 秒（#81 の打ち切り）、次いで 88.2 秒、75.5 秒。出力の中央値 834 トークン、100 トークン以上の件で中央値 72.3 tok/s。`finish` は stop 115 / length 1、JSON の壊れ 0。
  - 精度記録（#2344）の「最長 40 秒前後」は誤りで、正しくは上のとおり（この PR で直した）。
- 判定は Sonnet のサブエージェント。同じ Qwen の答えが 1 回目 101 → 2 回目 99 正答で、判定者の違いによる揺れがある。

まとめ:

- 誤りの形は 2 回とも同じ「合う記録が無いのに、別の記録を合うものとして出す（または根拠なく言い切る）」。GLM なら断る問で、DeepSeek は断らない。設定を変えても #84、#91、#162 は同じ形で残った。
- この記録の方針は「誤った答えより断りを良しとする」。正答の数は同じでも、誤りが GLM（2 件）より多いため採用しない。思考ありは 3 倍以上遅くなる。

### コーディング（3 件）

| 作業役 | t1 | t2 | t3 | 中身 |
| --- | --- | --- | --- | --- |
| Codex（`gpt-6-astra` / `high`、fast） | 53 秒 | 74 秒 | 59 秒 | 最小の変更。テストで境界の場合を押さえる |
| dsh 1 回目（温度 1.0、確認指示なし） | 192 秒 | 153 秒 | 95 秒 | t2 で他の呼び出し元が使う `recordPilotSessionIdRef` のリセットを消す後退。t1 で中身と合わない index のコメント、不要な防御コード。t3 は Codex と同等 |
| dsh 2 回目（温度 0.4、`verify.md`、`--json`） | 227 秒 | 137 秒 | 101 秒 | 後退なし。t1 は (occurredAt, id) の OR 条件のキーセットと 2 キーの orderBy、t2 はリセットに `recordPilotSessionIdRef.current = crypto.randomUUID();` の 1 行とテスト、t3 は在庫数を先に比べる `sortByLowStock` |

- PR 自身のテスト: t1 は Codex も含めて全員 1 件失敗（PR のテストが問い合わせの形をそのまま固定しているため、別の正しい書き方でも落ちる）。t2 と t3 は全員通過。
- 型チェックのエラー数は当てにならない（作業前の基準のログで既に 5 / 16 / 21 件あり、dsh2 は 0 件と出た）。比較に使わない。
- 2 回目は「確認指示」「温度」「`--json`」を一度に変えたため、どれが効いたかは分けられていない。
- まとめ: 確認指示を足せば品質は Codex 並みになるが、2〜3 倍遅く、動かす間は業務 LLM を止める必要がある。Codex は ChatGPT のサブスクで動いており、置き換えても費用はほとんど減らない。

### 量子化と元の精度について

- 2.9 bpw による劣化は小さい（フォーラムでも Mia の 2.9 bpw 版は同じ大きさの他の版より速く、点も高いと評価されている）。
- 速さはメモリ帯域で決まり、元の精度では Spark 2 台に載らない。Flash は軽い方のモデルでもある。「元の精度なら Codex を超える」は、この環境では確かめられない。

## Fix

決定（2026-10-27）:

- 業務 LLM は GLM-5.3-Flash のまま。
- 業務のコーディング作業は Codex のまま。
- DeepSeek は、夜間のまとめ作業や、別の視点の意見（セカンドオピニオン）に向く。使う場合は業務 LLM を止める時間帯に限る。
- 重みは検閲なし版だけを使う（利用者の判断）。検閲ありの版は作らない。

## Prevention

測り直すときの注意:

- DeepSeek を動かす前に、必ず利用者の承認を取って業務 GLM と画像生成を止める。終わったら必ず戻し、GLM が応答することを確かめる。
- dsh は `local-dgx.patch.yml` を必ず使う。`session-log-deepseek` は既定でオンなので、素の設定で動かさない。
- 業務の会話記録（`~/tools/llm-replay/data/`）は Mac の外に出さない。リポジトリ、Codex、外部サービスに渡さない。
- 思考ありで測るときは `max_tokens` を 16000 より大きくするか、打ち切り（`finish=length`）を別に数える。
- 判定者のモデルをそろえる（同じ Qwen の答えが判定者で 2 件ずれた）。比べるなら基準の Qwen の正答数も並べて書く。
- コーディングは、変える条件を 1 つずつにする。課題は 3 件では少ない。判断するなら 10 件程度に増やす。
- t1 の PR テストは問い合わせの形を固定しているので、失敗は差分を読んで判断する。型チェックのエラー数は使わない。

## Validation

- チャット: 2 回とも 116 件すべて 200 で返り、判定は 116 件すべて埋まった（`tally.py` の出力で確認）。
- 誤りの判定は Claude が抜き出して読み直した（#38、#159、#42）。
- コーディング: 9 通り（3 作業役 × 3 課題）の `diff.patch` を Claude が読み、PR のテスト結果を `summary.txt` で確認した。
- 測定の後、業務 GLM と画像生成を戻した（利用者が戻すコマンドを実行）。

## Open Items

ハーネスやモデルが良くなったときに測り直すこと:

- **新しい重み・新しい版**: 同じ 116 件を `build.py`（思考なし・ありの両方）→ `run.py` → `judgeprep.py` → 判定 → `tally.py` で測る。見るのは誤りの数、特に #81、#84、#91、#162 の「別の記録を出す」形が消えるか。断りが増えるのは良い変化として扱う。
- **dsh の新しい版**: 既定の persona に確認の指示が入ったか、temperature を送れるようになったか、外部送信の既定（`session-log-deepseek`）が変わったかを確かめ、`verify.md` なしでも後退が出ないかを t2 で見る。
- **一覧にないツールを呼ぶ問題**: フォーラムで報告がある。ツールを使う形で業務チャットに載せるなら、一覧にないツールの呼び出しを差し戻すガードが要る。
- **課題を 10 件程度に増やす**: 過去の PR から、テストが形を固定していないものを選ぶ。
- **条件を 1 つずつ変える**: 温度 1.0 + `verify.md`、温度 0.4 だけ、`reasoningEffort: max` を分けて測る。
- 速さ: 同時 4 本の性能（キットは 4 本同時に対応）を測っていない。
- GLM との比較は判定の夜が違う。厳密に比べるなら、同じ判定者で GLM の答えも判定し直す。

## References

- 精度記録: [`docs/plans/kiosk-operation-guide-accuracy-log.md`](../plans/kiosk-operation-guide-accuracy-log.md)（2026-10-27 の 2 節、#2343 と #2344）
- 業務 GLM の構成: [KB-426](./KB-426-glm-tp2-crash-and-startup-hang.md)
- 重み: <https://huggingface.co/Mia-AiLab/DeepSeek-V4.1-Flash-1017-EXL3-EAQ-v1-2.9-bpw>、元のモデル <https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017>
- DeepSeek Harness: <https://github.com/deepseek-ai/deepseek-harness>
- DGX Spark フォーラム（主に読んだもの）:
  - キットの紹介と速さ（57 tok/s 文章、92 tok/s コード）: <https://forums.developer.nvidia.com/t/deepseek-v4-1-flash-1017-exl3-2-9bpw-on-2x-dgx-spark-with-tensorfold-57-tok-s-text-92-tok-s-code-2-1-2-3x-the-vllm-kit/386125>
  - 2 台向けの調整: <https://forums.developer.nvidia.com/t/let-s-optimize-deepseek-v4-1-flash-1017-for-2x-dgx-spark/386574>
  - V4.1-Flash 全般（tool-eval-bench の点、温度 0.4 + reasoning high で 87 → 93〜94、TC-89「未払いの請求書を支払い済みと答える」と TC-92「別の利用者のデータを見せる」がどの設定でも残る、一覧にないツールを呼ぶ報告、Mia の 2.9 bpw 版の評価）: <https://forums.developer.nvidia.com/t/deepseek-v4-1-flash/382725?page=2>、<https://forums.developer.nvidia.com/t/deepseek-v4-1-flash/382725?page=3>
  - TensorFold / vLLM のレシピ: <https://forums.developer.nvidia.com/t/deepseek-v4-1-flash-1017-tensorfold-vllm-recipe/386121>
  - vLLM 版（2.75 bpw）: <https://forums.developer.nvidia.com/t/deepseek-v4-1-flash-1017-exl3-2-75-bpw-experts-on-2x-spark-with-vllm-kld-0-0201-320k-ctx-vision-tools-weights-ready-image/386295>
  - 2 台構成で GLM と DeepSeek のどちらを選ぶか: <https://forums.developer.nvidia.com/t/so-for-dual-spark-what-is-the-choice-now-glm5-3-flash-or-deepseek-v4-flash/382628?page=3>
  - 本番向けに固めたエンジン: <https://forums.developer.nvidia.com/t/spark-dsv41-production-hardened-deepseek-v4-1-flash-1017-engine-go-control-plane-for-2x-dgx-spark/387041>
  - DeepSeek Harness の紹介: <https://forums.developer.nvidia.com/t/deepseek-harness-preview-link/380502>
- 検閲を外すことの一般的な代償（正直さの試験で点が下がる傾向。業務の根拠づけへの影響の報告は無い）: <https://www.lesswrong.com/posts/PhNWBFjbdsaq2HAeW/what-abliteration-actually-costs-and-why-kl-won-t-tell-you>
- 道具（Mac のみ、リポジトリ外）: `~/tools/llm-replay/`、`~/tools/coding-eval/`、`~/tools/dsh/`
