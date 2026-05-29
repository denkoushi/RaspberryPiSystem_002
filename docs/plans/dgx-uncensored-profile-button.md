# ExecPlan: DGX `qwen36_35b_uncensored` profile + 固定起動ボタン

## Status

- **Branch（実装）**: `feat/dgx-uncensored-profile-button`
- **Scope**: DGX registry 例 + Pi5 API `START_MODEL_PROFILE` + Web 固定ボタン
- **Out of scope**: Hermes 小説プロファイル（別タスク）、デプロイ、コミット、push

## Decisions

| 項目 | 決定 |
|------|------|
| `modelProfileId` | `qwen36_35b_uncensored` |
| UI ラベル | `qwen36_35b_uncensored`（ID と同一） |
| GGUF パス | `/srv/dgx/shared-models/llm/gguf/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf` |
| backend | green（text only、mmproj なし） |
| 起動経路 | 新 action `START_MODEL_PROFILE`（orchestration を通さない） |
| 業務復帰 | manifest `businessOrchestrationEligible: false` → ドロップダウン/API orchestration から除外 |
| 載せ先 | 職場 Pi5 管理 UI のみ（業務キオスク・`BusinessProfileIntent` 非対象） |

## DGX 反映（手動・Ansible 対象外）

**混在デプロイ注意**: `businessOrchestrationEligible` は DGX の **`model_profiles.py` が API に載せるフィールド**です。manifest だけ先に入れて bin を古いままにすると、Pi5/Web は「未送信 = eligible」扱いのため **業務復帰ドロップダウンに uncensored が出る**（前回 P1 が再発）。**② bin 更新と ③ manifest は同一メンテ枠でセット**にする。

1. **GGUF**（完了済みならスキップ）: `/srv/dgx/shared-models/llm/gguf/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf` — サイズ **43605014656** バイト
2. **registry manifest**: repo 例 → `/srv/dgx/shared-models/registry/qwen36_35b_uncensored/manifest.json`（`businessOrchestrationEligible: false` を含む）
3. **DGX bin（必須）**: repo から **`model_profiles.py`**（`businessOrchestrationEligible` 読込・API 出力）を **`scp`** → `/srv/dgx/system-prod/bin/model_profiles.py`。依存モジュールに変更がある場合は runbook 既存手順どおり **`control-server.py` / `gateway-server.py`** 等も同梱
4. **再起動**: `control-server` + `gateway-server` を PID kill → `start-control-server.sh` → `start-gateway-server.sh`（manifest のみ更新時は不要だが、**bin 更新時は必須**）
5. **検証（DGX 直）**:
   - `GET /system/model-profiles` で `qwen36_35b_uncensored` が `status: available`
   - 同 profile に **`"businessOrchestrationEligible": false`** が JSON に含まれること（無い・`true` なら bin 未反映）
6. **検証（Pi5 デプロイ後）**: overview の `businessReturnSelectable` に uncensored が **含まれない**こと

## Pi5 検証（コード反映後）

1. `./scripts/deploy/verify-phase12-real.sh`（Pi5 のみデプロイ後）
2. `/admin/tools/dgx-resource` にボタン `qwen36_35b_uncensored` が有効表示
3. 押下 → 確認 → `POST /api/system/dgx-resource/actions` body `{ type: "START_MODEL_PROFILE", modelProfileId: "qwen36_35b_uncensored" }`
4. DGX `activeProfileId` と `/v1/models` を確認（cold start は最大 ~900s 想定）

## References

- [dgx-system-prod-local-llm.md §model profiles](../runbooks/dgx-system-prod-local-llm.md#dgx-uncensored-profile-2026-05-29)
- [scripts/dgx-local-llm-system/README.md](../../scripts/dgx-local-llm-system/README.md)
