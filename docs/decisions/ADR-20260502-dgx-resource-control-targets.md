---
Title: ADR-20260502: DGX リソース管理に Control Target レジストリを導入する
Status: accepted
---

# ADR-20260502: DGX リソース管理に Control Target レジストリを導入する

## Context

DGX リソース画面は、Pi5 API 経由で LocalLLM gateway の疎通・任意プローブ・`SET_POLICY`・`/start` `/stop` を扱っていた。機能追加が単一サービスに集中し、**監視対象**と**書き込み可能な制御対象**の境界がコード上あいまいになりやすかった。

NVIDIA 標準基盤（Docker / NGC / DGX OS）を GUI で「束ねる」方向へ寄せるには、**標準的な監視・制御単位（ターゲット）**を名前と capability で固定し、将来 Docker Compose / systemd など別アダプタを追加できる境界が必要になる。

## Decision

1. **`overview.targets[]` を正規モデルとする**  
   各要素は `id`・`kind`（`gateway` / `http_probe` / `metrics_source`）・`capabilities`（`readStatus` / `start` / `stop`）・`status`・`metaLines` を持つ。

2. **書き込みは現フェーズで `system-prod-gateway` のみ**  
   `POST …/actions` に **`EXECUTE_TARGET_ACTION`**（`targetId` + `action`: `start` | `stop`）を追加する。実体は既存の DGX `/start` `/stop`（`executeGatewayRuntimeStartStop`）。

3. **後方互換**  
   - `overview.services[]` は従来どおり返す（同一判定根拠）。  
   - `LOCAL_LLM_START` / `LOCAL_LLM_STOP` は内部で `system-prod-gateway` の `EXECUTE` と同等に振る舞う。  
   - `SET_POLICY` は運用ヒント用として **制御ターゲットと別レイヤー**のまま維持する。

4. **実装境界**  
   - プローブ HTTP / メトリクス JSON: `dgx-resource.probes.ts`  
   - スナップショット組み立て: `dgx-resource.control-targets.builder.ts`  
   - gateway 起停 POST: `dgx-resource.gateway-runtime.executor.ts`  
   - オーケストレーション: `dgx-resource.service.ts`

## Alternatives

- **A: 既存のまま `LOCAL_LLM_*` だけで運用** — 変更最小だが、標準ターゲット追加のたびにサービス肥大化が続く。  
- **B: いきなり Docker / systemd を同一 API で全面制御** — 権限・運用境界・テストが重く、今回のスコープを超える。

## Consequences

### Good

- 監視と制御の契約が明示され、SOLID に沿った追加（新 Target アダプタ）がしやすい。  
- UI は「読取のみ」と「起動・停止可」を capability で表示できる。

### Bad / Risks

- API 応答に `targets[]` が増え、クライアントはフィールドをパースする必要がある（`services[]` は当面残す）。  
- `metrics-kpi` は厳密にはワークロードではなく KPI ソースであり、過度に「サービス」と同一視しない運用説明が必要。

## References

- Runbook: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)  
- 実装: `apps/api/src/services/system/dgx-resource/`、`apps/web/src/features/admin/dgx-resource/`  
- [EXEC_PLAN.md](../../EXEC_PLAN.md)
