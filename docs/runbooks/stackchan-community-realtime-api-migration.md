---
title: Runbook — StackChan コミュニティファーム Realtime API 段階移行
audience: [開発者, 運用者]
last-verified: 2026-05-11
related:
  - ../knowledge-base/KB-stackchan-community-firmware-supply-chain.md
  - ./stackchan-community-text-only-e2e.md
  - ../../scripts/stackchan-ai-stackchan-ex/README.md
---

# Runbook — StackChan コミュニティファーム Realtime API 段階移行

## 目的

`AI_StackChan_Ex` の Realtime API を、過去の失敗要因を先に潰しながら段階的に有効化する。  
最初から一気に `Realtime + TTS + 既存音声構成` を同時投入しない。

## 先に確定した過去経緯（上流コミット根拠）

Realtime API まわりは、上流でも複数回の不具合修正が入っている。

- `db27921`: Core2 で **Realtime + TTS のヒープ不足**が発生し、録音バッファを静的配列化。
- `7362c03`: WebSocket イベント処理が loop task 側だと **音声途切れ**が出るため、高優先タスク化。
- `31fec2e`: Gemini Live 側の改善が OpenAI Realtime に影響し、**`delay(1)` 追加**で干渉を緩和。
- `f28b966`: Realtime を使わないビルド時に WebSocket 依存を外し、非Realtime経路への副作用を抑制。

運用判断:

- **失敗は「Realtimeそのもの」より、同時有効化とリソース競合で起きやすい**。
- したがって本番導入は、`Realtime本体` と `TTS拡張` を分離して行う。

## 境界の注意（現在構成との関係）

- 現在の private Pi5 bridge は `POST /api/stackchan/chat*` と `POST /api/stackchan/stt` の **HTTP境界**。
- `AI_StackChan_Ex` の Realtime API は OpenAI Realtime / Gemini Live 向けの **WebSocket 音声境界**。
- よって、**現行 Spark（DGX）経路をそのまま Realtime 化するには gateway 側の WebSocket 対応が別途必要**。
- この Runbook はまず **デバイス Realtime 単体の低遅延化検証**を目的にする。

### 2026-05-11 の運用判断（重要）

- 既存運用の正本は **`faster-whisper (private Pi5 bridge) -> Qwen3.6 on DGX Spark -> VOICEVOX`** である。
- Realtime API（OpenAI/Gemini WebSocket）をこの経路へ直接適用すると、境界不整合により `RealtimeAPIKeyError` を含む失敗を誘発し得る。
- そのため現時点では、**Spark 運用中の本番系に Realtime を直接導入しない**。導入する場合は検証系で閉じ、失敗時は必ず text/STT 正本へ戻す。

## 段階導入手順（安全順）

着手前の定型準備は、次の自動化スクリプトで行える。

```bash
python3 scripts/stackchan-ai-stackchan-ex/prepare_realtime_migration.py /path/to/AI_StackChan_Ex
```

clone/checkout から一気に進める場合は次を使う。

```bash
python3 scripts/stackchan-ai-stackchan-ex/bootstrap_realtime_migration.py \
  --target-dir /path/to/AI_StackChan_Ex \
  --run-build
```

### Phase 0: ロールバック可能状態を固定

1. 既存 text/audio E2E が再現できる状態を記録する。  
   参照: `stackchan-community-text-only-e2e.md`
2. 既存の private bridge 向けビルドフラグと SD 設定を退避する。
3. 旧経路へ戻せるよう、直前バイナリ（またはタグ）を保存する。

### Phase 1: Realtime API 本体のみ有効化（TTS 拡張なし）

1. `AI_StackChan_Ex` を上流推奨の realtime env でビルド:

```bash
cd AI_StackChan_Ex/firmware
pio run -e m5stack-cores3-realtime
```

2. `SC_ExConfig.yaml` は LLM を `ChatGPT` または `Gemini` に設定し、まず会話開始/停止だけ確認する。
3. SD 設定は `doc/realtime_api.md` の最小構成に合わせる（`aiservice` キー必須）。

完了条件:

- 「Please touch -> Listening...」遷移が安定する。
- 30秒アイドルで正常に終了する。
- 連続 10 回で再起動/フリーズがない。

### Phase 2: 低遅延指標を採取

1. 3パターン（短文質問）で応答遅延を計測し、中央値を取る。
2. 目標は **5秒以内（中央値）**。
3. ここで未達なら、先にモデル/応答長の調整を優先し、TTS拡張は後回しにする。

### Phase 3: 必要時のみ `REALTIME_API_WITH_TTS` を追加

1. まず Phase 1/2 が安定してから有効化する。
2. `platformio.ini` の realtime build flags に `-DREALTIME_API_WITH_TTS` を追加して再ビルド。
3. `VOICEVOX` 等を使う場合は、上流 `doc/realtime_api.md` の対応デバイス制約を厳守する。

注意:

- Core2 は上流でも Realtime+VOICEVOX の制約が明記されている。
- CoreS3 でも音声系はヒープ圧迫しやすいため、まず短時間の soak test を行う。

## 失敗時の戻し方

1. `m5stack-cores3-realtime` ではなく、従来の private bridge 向けビルドへ戻す。
2. `CHATGPT_API_URL=http://<Pi5>:18080/api/stackchan/chat/simple` の text境界に戻す。
3. `stackchan-community-text-only-e2e.md` の完了条件を再確認する。

## 次段（Spark Realtime化）で別途必要なもの

この Runbookの範囲外だが、Spark を Realtime 化する場合は次が必要。

- DGX gateway 側に WebSocket Realtime セッション境界を追加。
- 音声ストリームの認証・レート制御・切断回復を定義。
- private bridge と業務系 Pi5 API の混線防止ポリシーを再定義。

