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

## 5) 関連ドキュメント

- ナレッジ: [KB-stackchan-community-firmware-supply-chain.md](../../docs/knowledge-base/KB-stackchan-community-firmware-supply-chain.md)
- 実機 text-only 検証: [stackchan-community-text-only-e2e.md](../../docs/runbooks/stackchan-community-text-only-e2e.md)
- ブリッジ API: [../private-pi5-stackchan-bridge/README.md](../private-pi5-stackchan-bridge/README.md)
