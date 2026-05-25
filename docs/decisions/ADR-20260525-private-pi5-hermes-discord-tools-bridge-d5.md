# ADR-20260525: 私用 Pi5 Hermes Discord ↔ tools 橋（Phase D5）

- **Status**: accepted
- **Date**: 2026-05-25

## Context

- Phase D4 まで **chat（Discord 雑談）** と **tools（file+web+browser）** は分離済みだが、Discord から tools を使えない。
- 北極星は Discord から裏で tools を安全に動かすこと。ただし **chat に全 toolset を直結しない**（[執事ロードマップ](../plans/private-pi5-hermes-butler-vision-and-roadmap.md)）。
- Hermes には `delegation` / `delegate_task` があるが、chat で有効化すると workspace・HOME・プロンプトインジェクションの境界が曖昧になる。

## Decision

1. **ルーティング**: Discord **`/task`** + Hermes **plugin slash command**（`private-pi5-discord-task-bridge`）→ 自前ブリッジ実装。
2. **実行**: `hermes chat -q` を **tools isolated HOME**（`~/.hermes-tools/home`）と **tools `.env`**（専用 Bearer）で subprocess 実行。
3. **toolsets**: **`file,web,browser` 固定**（[`task-bridge.policy.yaml`](../../scripts/private-pi5-hermes/config/task-bridge.policy.yaml)）。
4. **chat config**: `disabled_toolsets` **不変** · `delegation` も **無効のまま**。
5. **承認**: `approvals.mode: manual` **維持**（非対話 run のタイムアウトは runner が短文で返す）。

## Alternatives

| 案 | 却下理由 |
|----|----------|
| chat で全 toolset 有効化 | 攻撃面・8K コンテキスト・北極星方針に反する |
| chat で `delegation` のみ有効 | 子エージェントの HOME/workspace が chat 側になり得る |
| 別 Discord Bot | 許可ユーザー・トークン管理が二重化 |

## Consequences

### 良い点

- 境界が repo の policy + config_contract でテスト可能。
- StackChan bridge と同様、**明示 API（/task）** で委譲が分離される。

### 悪い点

- ユーザーは `/task` を付ける必要がある。
- manual 承認の Discord UX は **D5.1** まで不完全。

## References

- [Phase D5 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d5-execplan.md)
- [KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md)
