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
