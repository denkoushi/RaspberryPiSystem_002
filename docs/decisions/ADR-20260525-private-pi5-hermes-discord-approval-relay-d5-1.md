# ADR-20260525: 私用 Pi5 Hermes Discord 承認中継（Phase D5.1）

- **Status**: accepted
- **Date**: 2026-05-25

## Context

- Phase D5 は Discord `/task` から tools プロファイルへ **subprocess `hermes chat -q`** を実行する。
- Hermes upstream では gateway プロセス内 + `HERMES_EXEC_ASK=1` のみ manual 承認通知が有効。subprocess 非 gateway 経路では危険コマンドが **AUTO-APPROVE** され得る。
- D5 では `approvals.mode: manual` を維持したが、Discord UX は未完了だった。

## Decision

1. **ファイル IPC 中継**: `{store_dir}/{task_id}/request.json` + `response.json` で gateway plugin と tools runner を疎結合。
2. **runner 方式**: 別プロセス shell では notify 登録が消えるため、**Hermes venv Python が runner.py を実行し in-process で `hermes_cli.main`** を呼ぶ（tools HOME · `.env` は従来どおり）。
3. **環境変数**: `HERMES_EXEC_ASK=1` · `HERMES_GATEWAY_SESSION=task-bridge:{task_id}` を runner が設定。
4. **Discord UX**: `/task-approve` · `/task-deny` + テキスト yes/no（`pre_gateway_dispatch` で pending 時のみ intercept）。
5. **境界維持**: chat `disabled_toolsets` 不変 · toolsets 固定 · allowlist user のみ（D5 継承）。

## Alternatives

| 案 | 却下理由 |
|----|----------|
| chat gateway 内で tools を直接実行 | tools HOME 分離・Bearer 分離が崩れる |
| subprocess + shell `hermes chat -q` のまま | notify 登録が subprocess 境界で失われる |
| Discord Bot を二重化 | 許可ユーザー・トークン管理が二重化 |

## Consequences

### 良い点

- manual 承認が Discord 上で実効する。
- store / coordinator / runner が分離され、テスト可能。

### 悪い点

- ファイル IPC の TTL 掃除・競合（1 user 1 active task）の運用が必要。
- Hermes v0.14 の `tools.approval` API に pin 依存。

## References

- [Phase D5.1 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md)
- [ADR D5](./ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md)
- [task-bridge.policy.yaml](../../scripts/private-pi5-hermes/config/task-bridge.policy.yaml)
