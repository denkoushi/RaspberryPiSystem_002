Title: ADR-20260403: LocalLLM オンデマンド起動（Pi5 制御・VRAM 共有）
Status: accepted
Context:
  - Ubuntu の `llama-server` が常駐すると VRAM を専有し、同一 GPU で ComfyUI 等と競合する（4060 8GB では顕著）。
  - 写真持出ラベルは撮影直後の処理が望ましい。要領書テキスト要約は深夜バッチで十分な遅延が許容される。
  - Pi5 を基幹とし、Ubuntu は補助計算資源とする方針を維持する。
Decision:
  - 既定は従来どおり `LOCAL_LLM_RUNTIME_MODE=always_on`（制御 API は no-op）。
  - `on_demand` 時は Pi5 API が HTTP で Ubuntu 側の起動・停止エンドポイントを呼び、`/healthz` が OK になるまで待ってから推論する。
  - 参照カウントで `photo_label` と `document_summary` が重なっても、最後の `release` まで `llama-server` を落とさない。
  - 写真登録完了後に `PhotoToolLabelScheduler.runOnce()` を非同期キックし、cron は保険として残す。`runOnce` は連続呼び出しを直列化する。
  - 要領書 OCR 深夜バッチは、`KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED` かつ推論設定が有効なときだけバッチ前後で ensure/release する。
Alternatives:
  - Ubuntu 側のみでアイドル監視: Pi5 からの可観測性・一貫した責務分離が弱いため不採用。
  - 常駐のままモデル縮小: 品質・用途とのトレードオフが大きく、ComfyUI との根本解決にならない場合がある。
Consequences:
  - 良い: VRAM を他用途に明け渡しやすい。業務は推論失敗時も従来どおり劣化運転可能。
  - 悪い: 初回推論まで起動待ちが乗る。Ubuntu に制御 HTTP 層（本リポジトリの補助スクリプト＋nginx 等）の配線が必要。
## Verification（2026-03-30）

- **デプロイ**: ブランチ `feat/on-demand-llm-runtime-control` を [deployment.md](../guides/deployment.md) に従い Pi5 → Pi4×4 のみ順次（Pi3 除外）。各 PLAY `failed=0`（Pi5 Detach Run ID 例: `20260330-183834-3704`）。
- **Phase12**: Mac / Tailscale から `./scripts/deploy/verify-phase12-real.sh` → **PASS 37 / WARN 0 / FAIL 0**（実行時間の目安: 約 100s）。API ヘルス・deploy-status・納期管理 API・要領書・部品測定・Pi4 サービス・Pi3 サイネージまでを含む回帰。
- **トラブルシューティング**: 本番が既定 **`LOCAL_LLM_RUNTIME_MODE=always_on`** のままなら、制御アダプタは **no-op**（従来と同じ常駐前提）。**`on_demand`** と Ubuntu 側 `control-server.mjs`（＋nginx・ACL）を揃えた後は、推論前後の **`component: localLlmRuntimeControl`** と Ubuntu での **`nvidia-smi`**（`/app/llama-server` の有無）で起停を確認する。ComfyUI OOM は VRAM 専有の切り分けに [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md) を参照。

References:
  - [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)
  - [ADR-20260328](./ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md)
  - [ADR-20260402](./ADR-20260402-inference-foundation-phase1.md)
  - `scripts/ubuntu-local-llm-runtime/control-server.mjs`
