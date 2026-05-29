---
title: ADR-20260529 DGX model profile capabilities と Pi5 runtime start intent
status: accepted
---

# ADR-20260529: DGX model profile capabilities と Pi5 runtime start intent

## Status

accepted

## Context

- DGX の業務モデルは `modelProfileId`（green=GGUF / blue=vLLM）で管理 UI から切替可能だが、Pi5 業務推論は従来 `providerId + model`（`system-prod-primary`）のみ。
- `35B` は manifest 上 vision 宣言があっても、**green 起動で mmproj が付かないと VLM として使えない**。
- `stop` と `stop-force` で backend 解決が非対称だと、state と実プロセスがずれたとき誤停止・no-op が起きる。

## Decision

1. **宣言と実測を分離**
   - manifest / profile API: `declaredCapabilities`, `visionRequiresMmproj`, `launcherHints`（加算のみ）
   - active model state / overview: `runtimeReadyCapabilities`, `visionReadyReason`
2. **green の vision-ready**
   - 起動ログの `mmproj=` 検出を正本とし state に反映（軽量プローブは将来 opt-in）
3. **stop の backend 解決**
   - `/stop` も `/stop-force` と同様に **active model state を env より優先**
4. **profile-aware start（DGX 先行）**
   - `launcherHints` を optional で読み、起動時 env に変換（既存 env があれば尊重）
5. **Pi5 runtime start intent（段階導入）**
   - `runtimeStartProfileId` を provider / 用途別 env で宣言
   - 既定 `INFERENCE_RUNTIME_START_PROFILE_ENABLED=false` → **shadow ログのみ**
   - opt-in 時のみ on-demand `/start` body に `modelProfileId` を付与

## Alternatives

- LiteLLM / llama-swap でマルチモデル常駐 → 単一アクティブ運用と衝突するため今回は見送り
- Pi5 から先に profile ID を本番ルーティングへ → DGX 未対応時の回帰リスクが高い

## Consequences

- **良い**: 運用 UI / KPI だけでなく API で「宣言 vision」と「今回 ready」を区別できる。将来の用途別 profile intent の安全な導入経路ができる。
- **悪い**: manifest・state・Pi5 env のフィールドが増える。opt-in 前は shadow ログが増える。

## Follow-up（コードレビュー 2026-05-29）

- **Pi5 opt-in**: 同一 provider で用途別 profile が異なると HttpOnDemand の refCount 共有で `/start` が抑止される → `buildOnDemandControllerCacheKey` と起動時 `assertConsistentRuntimeProfileIntentOnSharedProviders` で対処。
- **green vision ready**: ログ tail だけでは `mmproj=` が取れない → `start_env` / `launcherHints` 優先判定 + `start-llama-server.sh` が log に marker を書く。
- **command_runner**: `Callable[[str, dict|None], None]` に型を揃え、テスト runner も第2引数対応。

## References

- `scripts/dgx-local-llm-system/profile_capabilities.py`, `vision_readiness.py`, `profile_launcher.py`
- `apps/api/src/services/inference/config/inference-use-case-runtime-intent.ts`
- [Runbook dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)
- [KB-365](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md), [KB-366](../knowledge-base/KB-366-dgx-spark-operational-understanding.md)
