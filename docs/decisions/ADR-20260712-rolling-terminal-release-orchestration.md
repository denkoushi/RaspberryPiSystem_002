# ADR-20260712: Rolling terminal release orchestration

Status: partially superseded

> 注記（2026-11-04）: 「端末を1台ずつ更新する」部分は、2026-08 の標準Ansible route（`deploy-release-standard.yml`）で Pi4 の波更新（`serial: [1, 5, '25%', '100%']`、torque cutover 時だけ1台ずつ）に置き換わった。ある波で失敗すると、その波の他hostは更新を終えてから止まる（現行: [デプロイメントガイド](../guides/deployment.md)）。それ以外の決定は維持する。

## Decision

The canonical deployment wrapper owns release ordering, maintenance state and
rollback decisions. It updates one terminal at a time after Pi5 Blue/Green has
completed its stability window. A terminal failure is restored to its recorded
revision and stops the remaining rollout.

`deploy-status.json` remains backward compatible through `kioskByClient`; the
field now represents any display terminal and may include `terminalType`.

## Consequences

Direct application playbook execution requires an explicit emergency override.
The previous all-target maintenance behavior is superseded because it exposed
terminals that were not being updated.
