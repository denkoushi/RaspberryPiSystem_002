# DGX system-prod LocalLLM 雛形

DGX Spark 上で `system-prod` 用 LocalLLM を **host build の `llama-server`** で動かしつつ、外部公開は `tailscale + nginx` 側へ閉じ込めるための雛形です。

## ねらい

- 推論本体は、すでに DGX / GB10 で実測済みの host binary を使う
- 外部入口は Ubuntu 現行構成に寄せて `38081`
- on-demand 起動制御は `39090` の control server で受ける
- 写真持出の `/embed` も同じ入口 `38081` に同居できるようにする

## 含まれるもの

- `control-server.py`
  - `LLM_RUNTIME_START_CMD` / `LLM_RUNTIME_STOP_CMD` を実行する最小 HTTP サーバ
- `gateway-server.py`
  - `/healthz` / `/start` / `/stop` / `/v1/*` / `/embed` を localhost 上で束ねる軽量 gateway
- `embedding-server.py`
  - `jpegBase64 -> embedding[]` を返す最小 image embedding server
- `control-server.mjs`
  - Node がある環境向けの同等実装
- `start-llama-server.sh`
  - `llama-server` を PID ファイル付きで起動
- `stop-llama-server.sh`
  - PID ファイルを使って停止
- `start-embedding-server.sh`
  - PyTorch container を使って embedding server を起動
- `stop-embedding-server.sh`
  - embedding server container を停止
- `start-control-server.sh`
  - token file を読み、`control-server.py` を常駐起動
- `start-gateway-server.sh`
  - token file を読み、`gateway-server.py` を常駐起動
- `probe-photo-label-vlm.py`
  - `photo_label` の current payload をそのまま `/v1/chat/completions` へ送る単体疎通スクリプト
- `compose.yaml.example`
  - `tailscale` と `nginx` だけを持つ sidecar 例
- `nginx.default.conf.template.example`
  - `/healthz`、`/v1/*`、`/start`、`/stop` の最小 reverse proxy 例

## 想定パス

- `llama-server` binary:
  `/srv/dgx/lab-experiments/data/llama-cpp/llama.cpp/build-sm121/bin/llama-server`
- model:
  `/srv/dgx/shared-models/llm/gguf/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf`
- mmproj (VLM 用。`start-llama-server.sh` は同じディレクトリの `mmproj-F16.gguf` などを自動検出):
  `/srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf`
- logs:
  `/srv/dgx/system-prod/logs/`
- Hugging Face cache:
  `/srv/dgx/system-prod/data/hf-cache/`

## 最小の使い方

```bash
export LLM_RUNTIME_CONTROL_TOKEN='...'
export LLM_RUNTIME_START_CMD='/srv/dgx/system-prod/bin/start-llama-server.sh'
export LLM_RUNTIME_STOP_CMD='/srv/dgx/system-prod/bin/stop-llama-server.sh'
export LLM_RUNTIME_LISTEN_HOST='0.0.0.0'
python3 ./control-server.py
```

gateway の起動例:

```bash
export LLM_SHARED_TOKEN='...'
export LLM_RUNTIME_CONTROL_TOKEN='...'
python3 ./gateway-server.py
```

再起動後の自動復帰を簡単に確保したい場合の起動例:

```bash
./start-control-server.sh
./start-gateway-server.sh
./start-embedding-server.sh
```

`sudo` や `loginctl enable-linger` を前提にしない最小構成として、DGX ユーザーの `crontab` に次を入れる運用を取れる:

```cron
@reboot /srv/dgx/system-prod/bin/start-control-server.sh
@reboot /srv/dgx/system-prod/bin/start-gateway-server.sh
@reboot /srv/dgx/system-prod/bin/start-embedding-server.sh
```

embedding server の起動例:

```bash
./start-embedding-server.sh
```

既定では次を使う:

- model id: `clip-ViT-B-32`
- Hugging Face model: `openai/clip-vit-base-patch32`
- listen: `127.0.0.1:38100`

この構成は、Pi5 API の `PHOTO_TOOL_EMBEDDING_*` 契約

- `POST /embed`
- body: `{ "jpegBase64": "...", "modelId": "clip-ViT-B-32" }`
- response: `{ "embedding": number[], "modelId": "clip-ViT-B-32" }`

と揃えるための最小構成です。

`photo_label` の単体疎通例:

```bash
export LLM_BASE_URL='http://127.0.0.1:38081'
export LLM_SHARED_TOKEN='...'
export LLM_MODEL='system-prod-primary'
export LLM_RUNTIME_CONTROL_TOKEN='...'
python3 ./probe-photo-label-vlm.py ./sample-tool.jpg --start-runtime --stop-runtime
```

このスクリプトは `RoutedVisionCompletionAdapter` と同じ shape の payload を送る:

- `messages[0].content = [{ type: "image_url", image_url: { url: data:...base64 } }, { type: "text", text: ... }]`
- `chat_template_kwargs.enable_thinking = false`
- 既定 prompt は `PhotoToolLabelingService` の `DEFAULT_PHOTO_TOOL_VISION_USER_PROMPT` と同文

`start-llama-server.sh` の主な環境変数:

- `LLAMA_SERVER_MODEL`
  - ローカル GGUF を使うときの model path
- `LLAMA_SERVER_MMPROJ`
  - 明示的に projector を指定したい場合の path。未指定時は model と同じディレクトリの `mmproj-F16.gguf` / `mmproj-BF16.gguf` / `mmproj-F32.gguf` などを探す
- `LLAMA_SERVER_HF_MODEL`
  - `llama-server -hf ...` を使いたい場合の Hugging Face model tag。指定時は `LLAMA_SERVER_MODEL` より優先
- `LLAMA_SERVER_EXTRA_ARGS`
  - `--chat-template-kwargs '{"enable_thinking":false}'` など、追加で渡したい引数

`start-embedding-server.sh` / `embedding-server.py` の主な環境変数:

- `EMBEDDING_SERVER_IMAGE`
  - 既定: `lmsysorg/sglang:latest`。DGX で既に取得済みなら初回起動が速い
- `EMBEDDING_MODEL_ID`
  - Pi5 API に返す `modelId`。既定: `clip-ViT-B-32`
- `EMBEDDING_HF_MODEL`
  - 実際にロードする Hugging Face model。既定: `openai/clip-vit-base-patch32`
- `EMBEDDING_SERVER_PORT`
  - host 側 bind port。既定: `38100`
- `EMBEDDING_DEVICE`
  - 既定は `cpu`。現状の `lmsysorg/sglang:latest` では GB10 の CUDA capability 警告を避けるため、まず CPU 動作を正とする
- `EMBEDDING_NORMALIZE`
  - 既定 `true`。cosine 距離を使う前提で画像特徴を L2 normalize する

## 優先順

- まずは **既存の `system-prod-primary` を単一 VLM endpoint として成立**させる
- 具体的には、現在の `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` に **`mmproj` を足して** `text + image` の両入力を同じ alias で受ける
- Pi5 側は alias `system-prod-primary` を固定し、モデル差し替えは DGX 側だけで閉じる
- その構造が安定したあとに、必要なら `Qwen3.6` 系へ **1 対 1 で置き換える**

## 注意

- DGX 実機では `node` が未導入だったため、まずは `python3 ./control-server.py` を正とする
- tailnet 参加前の localhost smoke では `python3 ./gateway-server.py` で `38081` を再現できる
- 実機確認では、**再起動後に `control-server.py` / `gateway-server.py` が自動復帰しない穴**があったため、現時点では **`start-control-server.sh` / `start-gateway-server.sh` / `start-embedding-server.sh` を `@reboot` で起動**する運用を正とする
- この雛形は **実値なし** のテンプレートです。秘密は別ファイルで注入してください
- `DOCKER_BRIDGE_GATEWAY` は tailscale sidecar から見た host gateway を実機で確認して設定してください
- `photo_label` の vision 互換は、まず **現行 `Qwen3.5-35B` + `mmproj` の単体疎通**で確認する
- `/embed` を Ubuntu から DGX へ移したら、既存 gallery は **同一 embedding 空間ではなくなる**可能性があるため、Pi5 側で `pnpm backfill:photo-tool-gallery:prod` を再実行する前提で扱う
- どうしても現行 `Qwen3.5-35B` の VLM 化で詰まる場合に限り、別 VLM や別 provider を中間到達点として検討する
