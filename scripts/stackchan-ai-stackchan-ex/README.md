# AI_StackChan_Ex（コミュニティ系）— 供給鎖固定と private Pi5 bridge 接続

**目的**: コミュニティ製ファームの取得元・依存を固定し、マルウェア混入・意図しない依存更新リスクを下げつつ、[private Pi5 bridge](../private-pi5-stackchan-bridge/README.md) へ接続する。

## 1) 上流の固定

- 正本: `https://github.com/ronron-gh/AI_StackChan_Ex.git`
- このリポジトリで記録したコミット: [`supply-chain-lock.json`](./supply-chain-lock.json) の `upstream_ai_stackchan_ex.pinned_commit`
- **運用**: 自分用に **フォーク** し、検証済みコミットに **タグ** を打ってビルドするのが安全。

```bash
git clone https://github.com/ronron-gh/AI_StackChan_Ex.git
cd AI_StackChan_Ex
git checkout d894859648d4323044761cd49615694027abeb25   # supply-chain-lock.json と一致させる
git apply /path/to/RaspberryPiSystem_002/scripts/private-pi5-stackchan-bridge/patches/ai_stackchan_ex_private_bridge.patch
```

## 2) PlatformIO の GitHub 依存をコミットにピン留め

`firmware/platformio.ini` には `https://github.com/...` 形式のライブラリ直参照がある。**ビルドのたびに先端が変わる**のを防ぐため、次を実行する。

```bash
python3 scripts/stackchan-ai-stackchan-ex/apply_platformio_github_pins.py AI_StackChan_Ex/firmware/platformio.ini
# 確認だけなら
python3 scripts/stackchan-ai-stackchan-ex/apply_platformio_github_pins.py --dry-run AI_StackChan_Ex/firmware/platformio.ini
```

置換ルールは [`supply-chain-lock.json`](./supply-chain-lock.json) の `github_lib_deps`。

## 3) private Pi5 bridge 向けビルドフラグ（CoreS3 例: `m5stack-cores3`）

LLM を OpenAI ではなく自宅の Pi5 bridge に向ける最小例（**機密は Pi5 の `.env` にだけ置く**）。

```text
PLATFORMIO_BUILD_FLAGS='-DCHATGPT_API_URL=\"http://<私用Pi5のLAN-IP>:18080/api/stackchan/chat\" -DCHATGPT_API_USE_AUTH_BEARER=0'
```

任意: bridge の `STACKCHAN_TOKEN` と突き合わせる（**DGX 共有トークンとは別物**）。

```text
-DCHATGPT_STACKCHAN_TOKEN=\"<STACKCHAN_TOKEN と同じ文字列>\"
```

ビルド例:

```bash
cd AI_StackChan_Ex/firmware
env PLATFORMIO_BUILD_FLAGS='-DCHATGPT_API_URL=\"http://192.168.128.112:18080/api/stackchan/chat\" -DCHATGPT_API_USE_AUTH_BEARER=0' \
  pio run -e m5stack-cores3
```

## 4) セキュリティ上の位置づけ（平易）

| 秘密 | 置き場所 | コメント |
|------|-----------|----------|
| `DGX_LLM_SHARED_TOKEN` | **私用 Pi5** bridge の `.env` のみ | ESP32 に載せない |
| `STACKCHAN_TOKEN` | 同上（bridge が検証） | 任意。載せるならビルドフラグ `CHATGPT_STACKCHAN_TOKEN` |
| OpenAI / 他クラウド API キー | 原則 **不要**（bridge 経由なら） | YAML/SPIFFS に残さない運用を推奨 |
| Wi-Fi パスワード | デバイス設定 | ゲスト SSID / セグメント分割を推奨 |

## 5) 音声（STT/TTS）最小方針 — 正本経路（2026-05-11）

private Pi5 bridge は **LLM 境界に加えて STT 境界（`POST /api/stackchan/stt`）**を担当する。TTS 音声合成/再生はデバイス側（VOICEVOX 利用）で運用する。

### 推奨アーキテクチャ

| 処理 | 担当 | 注記 |
|------|------|------|
| STT | StackChan 実機 -> Pi5 bridge | 生音声を bridge `POST /api/stackchan/stt` へ送り、`faster-whisper-local` で文字起こし |
| LLM | Pi5 bridge -> DGX Spark | `CHATGPT_API_URL` は `POST /api/stackchan/chat` / `/simple` を使用 |
| TTS | StackChan 実機（VOICEVOX） | 返答文字列をデバイス側で音声化・再生 |

### 最小手順（ビルドは text-only と同じ前提）

1. **text-only 正本**を先に満たす（`replyText` が聞こえるまで）。手順: [stackchan-community-text-only-e2e.md](../../docs/runbooks/stackchan-community-text-only-e2e.md#text-only-done-criteria)
2. **スピーカー単体**を `http://<StackChan-IP>/speech?say=テスト` で確認（runbook 参照）。
3. `app/AiStackChanEx/SC_ExConfig.yaml` で **`stt.type` / `tts.type` / `wakeword.type`** を、**AI_StackChan_Ex 本家ドキュメント**に従い有効化する。クラウド STT を使う場合のみ `apikey.stt` を設定（**DGX 共有トークンとは別**）。
4. SD に設定を反映して再起動し、**発話 → bridge ログに LLM 用 POST が増える**ことを確認する。増えない場合は **STT 結果が空**または **会話開始トリガが未発火**を疑う。

### 5.1) CoreS3 の WakeWord 操作（復旧仕様）

- 物理ボタンを使わない CoreS3 構成では、左タッチを `BtnA` 相当（WakeWord 有効/無効）、右タッチを `BtnB` 長押し相当（WakeWord 登録）として扱う。
- ファーム再書き込み後は mode 初期化で WakeWord が無効化されるため、**右タッチで登録 -> 左タッチで有効化**を再実施する。

### パッチとの関係

[`patches/ai_stackchan_ex_private_bridge.patch`](../private-pi5-stackchan-bridge/patches/ai_stackchan_ex_private_bridge.patch) は **HTTP(S) での JSON POST** と **`/simple` 応答のパース**を補強するものであり、**音声コーデックやマイク入力とは独立**。音声を足しても **bridge 側の追加差分は原則不要**。

## 6) 関連ドキュメント

- ナレッジ: [KB-stackchan-community-firmware-supply-chain.md](../../docs/knowledge-base/KB-stackchan-community-firmware-supply-chain.md)
- 実機 text-only / 音声 E2E: [stackchan-community-text-only-e2e.md](../../docs/runbooks/stackchan-community-text-only-e2e.md)
- Realtime 段階移行: [stackchan-community-realtime-api-migration.md](../../docs/runbooks/stackchan-community-realtime-api-migration.md)
- ブリッジ API: [../private-pi5-stackchan-bridge/README.md](../private-pi5-stackchan-bridge/README.md)

## 7) Realtime API 化を先に進めるときの注意（過去失敗の要点）

`AI_StackChan_Ex` 上流では Realtime API まわりで複数の不具合修正が入っている。  
代表例:

- `db27921`: Core2 で Realtime + TTS 時のヒープ不足
- `7362c03`: Realtime WebSocket イベント処理の優先度不足による音声途切れ
- `31fec2e`: Gemini Live 側の変更が OpenAI Realtime に影響（`delay(1)` 追加）

このため、導入順は次を推奨する。

1. `env:m5stack-cores3-realtime` で **Realtime本体のみ**有効化
2. 遅延・安定性を観測
3. 必要な場合のみ `REALTIME_API_WITH_TTS` を後段で追加

補足:

- 現在の private Pi5 bridge は HTTP text/STT 境界であり、Realtime の WebSocket 音声境界とは別系統。
- Spark（DGX）を Realtime 化するには gateway 側の WebSocket 対応が別途必要。

### 7.1) 段階移行の準備を自動化する

次のスクリプトは、Realtime 移行前の定型作業（依存ピン留め、YAML雛形、ビルド/ロールバック手順出力）をまとめて行う。

```bash
python3 scripts/stackchan-ai-stackchan-ex/prepare_realtime_migration.py /path/to/AI_StackChan_Ex
```

TTS拡張まで同時に試す場合のみ `--with-tts` を付ける（推奨は後段）。

```bash
python3 scripts/stackchan-ai-stackchan-ex/prepare_realtime_migration.py /path/to/AI_StackChan_Ex --with-tts
```

生成物（既定）:

- `.cursor/realtime-migration/SC_SecConfig.realtime.template.yaml`
- `.cursor/realtime-migration/SC_ExConfig.realtime.template.yaml`
- `.cursor/realtime-migration/build-realtime.sh`
- `.cursor/realtime-migration/upload-realtime.sh`
- `.cursor/realtime-migration/phase1-checklist.md`
- `.cursor/realtime-migration/rollback-realtime.md`

### 7.2) クローン取得から一気に実行する

上流の clone/checkout から準備、必要なら build まで一発で実行する。

```bash
python3 scripts/stackchan-ai-stackchan-ex/bootstrap_realtime_migration.py \
  --target-dir /path/to/AI_StackChan_Ex \
  --run-build
```

TTS を同時有効化する場合（非推奨・後段推奨）:

```bash
python3 scripts/stackchan-ai-stackchan-ex/bootstrap_realtime_migration.py \
  --target-dir /path/to/AI_StackChan_Ex \
  --with-tts \
  --run-build
```

実機へ書き込みまで自動で行う場合:

```bash
python3 scripts/stackchan-ai-stackchan-ex/bootstrap_realtime_migration.py \
  --target-dir /path/to/AI_StackChan_Ex \
  --run-build \
  --run-upload \
  --upload-port /dev/cu.usbmodem1101
```
