# 要領書エディタの話し合い書き起こし(話者分離つき)

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

組立の要領書を作るとき、現場では数人で話し合って手順を決める。今の要領書エディタの音声入力は最大60秒の一人の口述向けで、話し合いは残せない。この変更の後は、キオスク(Pi4)の要領書エディタで文章を選び、右の欄の「話し合い」を押すと最大60分録音でき、止めると DGX Spark 上の NVIDIA Nemotron 3.5 Transcribe が話者を分けて書き起こし、選んでいた文章の後ろに「話者1: …」「話者2: …」の行で入る。話者名は文章欄でそのまま書き換えられる。書き起こしは発言そのままで、業務 LLM で議事録に整える処理はしない(2026-11-19 ユーザー決定)。

## Progress

- [x] (2026-11-19) 調査とモデル選定(Nemotron-3.5-Transcribe-30B-A4B、OpenMDW-1.1、日本語 Production-ready、話者タグを自分で出す、1 録音最大 1 時間)
- [x] (2026-11-19) 画面モックの承認と出力形式の決定(発言そのまま)
- [ ] DGXSparkControlPlane: 受け口 `POST /v1/audio/meeting-transcriptions` をフラグ off で追加(別 PR)
- [ ] この repo: ジョブの保存、ワーカー、ルート、画面(この PR、`PROCEDURE_MEETING_TRANSCRIBE_ENABLED` 既定 false)
- [x] (2026-11-19) 第三者レビュー対応（ワーカー再試行・リース更新、端末単位のジョブ所有、選択や保存をまたぐ録音・状態確認）
- [ ] Spark 1 で業務 LLM(GLM、2台 TP2)と同居できるかの試運転(業務時間外、ユーザー合意のうえ)
- [ ] 両方の反映後、DGX のフラグと API の env を有効化し、kensaku-stonebase01 で実機確認

## Surprises & Discoveries

- 今の音声認識(Whisper、DGX の業務プロキシ :38081 経由)は 2 MiB・120 秒・30 秒タイムアウトの同期 API で、1時間の録音は通らない。DGX 側に汎用の非同期ジョブ API は無い。

## Decision Log

- Decision: 短い口述は Whisper のまま、話し合いだけ新しい経路にする。Rationale: 口述の Whisper 継続は決定済み(Haas 置き換え見送り)。話し合いは長さも出力形も違う。Date: 2026-11-19
- Decision: 非同期にするのは API 側(DB のジョブ+ワーカー)。DGX 側は1要求を最大30分かけて同期で返す。Rationale: DGX に汎用ジョブ API が無く、受け口を増やすより、既存の KnowledgeIntake と knowledge-worker の型を使う方が小さい。Pi4 の画面は 5 秒ごとに状態を見る。Date: 2026-11-19
- Decision: DGX のモデルは常駐させず、要求時に起動し、使われなければ止める。起動前に空きメモリを見て足りなければ 503 で断る。Rationale: Spark 1 は業務 LLM と共有で、業務優先を崩さない。Date: 2026-11-19
- Decision: 話者タグ `<spk:N>` は DGX からそのまま返し、API で「話者{N+1}: 」の行に直す。Rationale: 表示の形は使う側の都合で、DGX を薄く保つ。Date: 2026-11-19

## Outcomes & Retrospective

(完了時に記入)

## Context and Orientation

画面は `apps/web/src/features/assembly/document-editor/ProcedureVoiceInput.tsx` と `useProcedureVoiceInput.ts`。録音は `apps/web/src/features/voice/voiceTranscription.ts`(MediaRecorder、webm/opus 64 kbps)。API 呼び出しは `apps/web/src/api/domains/assembly/dictation.ts`。API のルートは `apps/api/src/routes/assembly/procedure-document-revisions.ts` の dictation 系、DGX への送信は `apps/api/src/services/inference/adapters/http-speech-to-text.adapter.ts` と同じ baseUrl とトークンを使う。非同期ジョブの手本は Prisma の `KnowledgeIntake` と `apps/api/src/services/knowledge/knowledge-worker.ts`。用語ヒントは `apps/api/src/services/assembly/procedure-speech-hints.ts`。

DGX 側との約束: 業務プロキシに `POST /v1/audio/meeting-transcriptions`(multipart の `file`、任意の `prompt`、最大 64 MiB・3600 秒、`X-LLM-Token`)。応答は `{"text": "<spk:0> …", "model": "nemotron-3.5-transcribe"}`。失敗は 503 `meeting_transcribe_disabled` / `meeting_transcribe_insufficient_memory` / `meeting_transcribe_busy` / `meeting_transcribe_unavailable`、413 `meeting_transcribe_too_large`、400 `meeting_transcribe_too_long` / `meeting_transcribe_bad_request`、504 `meeting_transcribe_timeout`。使う側は1要求35分まで待つ。

## Plan of Work

DGX 側(別リポジトリ、別 PR)を先にフラグ off で入れる。この repo では、録音のアップロードを受けて DB にジョブを作るルートと、ジョブを1件ずつ DGX に送るワーカー、状態を返すルートを足し、画面に「話し合い」を足す。どちらも既定で無効なので、マージと反映だけでは何も変わらない。有効化は試運転の後。

## Concrete Steps

作業場所は `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--procedure-meeting-minutes`。型チェックは `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit` と web の tsc、テストは変えたテストファイルだけを vitest で回す。画面は verify-screen の手順でローカルの実画面を確かめる。

## Validation and Acceptance

env が無効のとき、文章欄に「話し合い」ボタンは出ず、今の音声入力は今のまま動く。有効にしてローカルで DGX の代わりのスタブを置くと、録音して止めると「書き起こし中…」になり、数秒後に文章の後ろに「話者1: …」の行が入り、「戻す」で元に戻る。テストで、話者タグの変換、無効時のルート、ジョブの受付と状態取得、ワーカーの成功・失敗・再試行・音声削除を確かめる。

## Idempotence and Recovery

ワーカーはリースで1件ずつ処理し、API の再起動で RUNNING のまま残ったジョブはリース切れで再び取られる。一時障害では最大8回試行し、2分、5分、10分、その後は15分待つ。保持期限の24時間に達する再試行は行わない。有効時のワーカーは処理後の音声と期限切れのジョブを削除する。env を無効にすると新規受付とワーカー登録が止まる。

## Artifacts and Notes

画面モック: https://claude.ai/artifact/5h9aNVVUWrTGm1mNCpEst2 (2026-11-19 承認)

## Interfaces and Dependencies

新しい env `PROCEDURE_MEETING_TRANSCRIBE_ENABLED`(既定 false)。新しいルート `POST /assembly/procedure-documents/dictation/meetings` と `GET /assembly/procedure-documents/dictation/meetings/:jobId`。DGX 側のフラグ `dgx_business_meeting_transcribe_enabled`(既定 false)。

## ライブ書き起こし（暫定）

録音後に送る方式とは別に、話しながら選択中の文章へ書き起こしを流し込むライブ方式を追加した。DGX 側のライブ受け口は暫定の試験用サーバーで、恒久版は `denkoushi/DGXSparkControlPlane` の責務とする（このリポジトリは取り込み側だけを持つ）。

- API: `GET /assembly/procedure-documents/meeting-live/availability`（`{ available }`、`Cache-Control: no-store`）と、WebSocket `GET /assembly/procedure-documents/meeting-live?clientKey=...`。キオスクの client key が無効なら 1008 で閉じ、上流は開かない。
- 上流の約束: 業務用 DGX の基底 URL に対する `/ws`。クライアントは Int16 little-endian・mono・16 kHz の PCM をバイナリで送り、終了時にテキスト `end` を送る。サーバーは `{"spk","text","t"}` を発話ごとに返し、混雑時は `{"error":"busy"}` で閉じる。1 セッションだけ受け付ける。
- 中継: ブラウザのバイナリと `end` を上流へ、上流のテキストをそのままブラウザへ流す。ブラウザが閉じたら上流もすぐ閉じる（上流の 1 枠を空けるため）。上流へ繋げないときは `{"error":"unavailable"}`。音声と本文はログに出さない。
- 利用可否: `PROCEDURE_SPEECH_TO_TEXT_ENABLED` が有効で、`GET ${baseUrl}/ws` がステータス 400（WebSocket 以外の要求を拒否する応答）を返すときだけ利用可。3 秒で打ち切り、エラーは利用不可。通常の業務用プロキシに戻れば `/ws` は無く、自動で従来の方式へ戻る。
- 画面: 利用可のとき「話し合い」ボタンがライブ方式になり、話者ごとに `話者N: ...` の行で選択中の文章の末尾へ追記する。同じ話者で 4 秒未満なら同じ行に続ける。選択の変更、編集不可、10,000 文字超過で止める。1 回の録音で取り消し履歴は 1 件にまとめる。

## ライブ書き起こし（API 側の方式・v2）

上流の `/ws` が無い（404）ときは、API 自身が話し合いのライブ書き起こしと整理を行う。DGX 側の変更は不要。上流の `/ws` が使えるときは従来どおり中継する。

- 利用可否: `PROCEDURE_SPEECH_TO_TEXT_ENABLED` が有効で、上流の `/ws` が 400 を返す、または業務用の音声認識（`/system/speech-to-text/health`）が正常なら `available: true`。どちらも 30 秒キャッシュする。
- 区切り: API が 16 kHz PCM を 30 ms ごとに音量で判定し、無音 700 ms か 15 秒で 1 発話を確定する（15 秒は直近で最も静かな所で切る）。話している時間が 300 ms 未満は捨てる。発話中は約 1 秒ごとに途中結果を出し、確定時に全体を書き起こす。1 セッションにつき書き起こしは同時に 1 件。プロンプトは画面から渡された用語（200 文字まで）と直前の確定文の末尾（200 文字まで）。無音時の定型の幻聴（「ご視聴ありがとうございました」など）は捨てる。
- 整理: 確定文が増えて約 20 秒たつごと、および終了時に、業務用 LLM（`business_hermes`、非ストリーム、低温度、60 秒で打ち切り、同時に 1 件）へ直近約 12,000 文字の記録と前回の整理を渡し、JSON（論点・決まったこと・未決・宿題・次に話すとよいこと）を受け取る。解析に失敗したら前回の結果を保つ。本文は【論点】【決まったこと】【未決】【宿題】の平文（空の節は省く）。`next` は別に送り、文書には入れない。
- プロトコル v2（`&v=2` を付けたときだけ）: ブラウザは最初に `{"type":"context","terms":"..."}` を送れる。サーバーは `{"type":"partial","id","text"}`、`{"type":"final","id","text"}`、`{"type":"doc","text","next"}`、`{"type":"done"}`（`end` の処理と最後の整理が終わるか時間切れのあと）、`{"type":"error","error":"busy"|"unavailable"}` を送る。`v=2` が無い古い画面には確定文だけを従来の `{"spk":0,"text","t"}` で送る。API プロセス全体で同時に 1 セッションだけで、2 つ目は busy。
- 話者の区別はこの方式では行わない（話者ラベルは付かない）。画面は整理済みの文書の下に【発言記録】として確定文を 1 行ずつ並べ、話している途中の文を最後の行に出す。
