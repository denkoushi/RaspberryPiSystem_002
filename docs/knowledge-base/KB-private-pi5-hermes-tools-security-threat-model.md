# KB-private-pi5-hermes-tools-security-threat-model: ツール有効化前の脅威モデル

- **Status**: reference（Phase D0）
- **Related**: [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md) · [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md)

## Context

Hermes 雑談プロファイルはツール無効で運用中。将来 web/browser/file/terminal を有効化する際の脅威と、Phase D0 で固定した対策をまとめる。

## 脅威と対策（D0 時点）

| 脅威 | 症状 | D0 対策 | D1+ で必要 |
|------|------|---------|------------|
| **SSRF / 内部スキャン** | web/browser が 100.x / LAN を探索 | `boundary-policy.tools.yaml` · deny RFC1918 | Hermes allowlist 連携・egress 制限 |
| **横移動（業務 Pi5）** | 私用 Pi5 から `tag:server` へ | Tailscale 草案（手動適用） | `tag:private-home` 本番化 |
| **トークン漏洩の影響拡大** | StackChan 漏洩で Hermes も利用可能 | DGX `LLM_SHARED_ADDITIONAL_TOKENS` · fragment 変数分離 | ローテーション Runbook |
| **docker 脱出** | terminal で host 相当権限 | chat/tools とも terminal 無効（D0） | rootless / 別ホスト検討 |
| **プロンプトインジェクション** | Discord 経由で危険ツール実行 | Tirith · manual 承認 · tools 無効 | ツール有効時も manual 維持 |
| **skills 供給鎖** | 悪意 SKILL.md 永続化 | skills 無効 · `allow_lazy_installs: false` | repo 管理 skill のみ |
| **ランサムウェア** | file/terminal で暗号化 | D0 はツール無効 | バックアップ・workspace 限定 |

## 境界ポリシー検証

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py \
  --policy scripts/private-pi5-hermes/config/boundary-policy.tools.yaml
```

期待: `{"ok": true, ...}`

## D1+ チェックリスト（未実施）

- [ ] `private_pi5_hermes_tools_profile_enabled: true` + 専用 DGX トークンを additional に登録
- [ ] Tailscale 草案を管理画面に反映
- [ ] `file` のみ · workspace 限定 · manual 承認
- [ ] web URL allowlist を `boundary-policy.tools.yaml` と同期
- [ ] browser 隔離 Docker · `AGENT_BROWSER_ARGS` 実機検証
- [ ] terminal は最後（または CLI のみ）

## References

- [`boundary_policy.py`](../../scripts/private-pi5-hermes/lib/boundary_policy.py)
- [tailscale-policy-hermes-private-pi5-draft.md](../security/tailscale-policy-hermes-private-pi5-draft.md)
