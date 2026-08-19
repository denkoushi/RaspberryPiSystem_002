# Private Hermes morning briefing cutover

Coordination note for `DGXSparkControlPlane` Phase 22
(`feat/ai-butler-morning-briefing`).

## Why this note exists

`DGXSparkControlPlane` now owns Private Hermes AI-butler source. The live
`hermes-life-proactive-morning.timer` unit on `raspi5-private` still originates
from this repository's frozen templates. Phase 22 introduces a generation-owned
`hermes-life-morning-briefing.timer` at 08:10 JST and leaves it disabled until
acceptance.

## Cutover sequence

1. Merge and deploy the DGXSparkControlPlane PR first.
2. Keep this repo's legacy morning timer enabled during preview/canary.
3. After supervised Discord acceptance of the new briefing:
   - enable `hermes-life-morning-briefing.timer`
   - disable `hermes-life-proactive-morning.timer`
   - disable the Hermes 08:10 `karakeep-short-digest` Cron
4. Record the host unit inventory change here only as operator documentation.
   Do not revive Private Hermes fleet deploys from this repository.

## Non-goals

- No business Pi inventory, playbook, or fleet deployment changes.
- No shared route, principal, workload, or Lease contract changes.
- No deletion of Karakeep SSD data or Life Pilot JSONL.

## Rollback

Re-enable the legacy 07:30 morning timer and Hermes 08:10 Cron, disable the
briefing timer, and point `/opt/dgx-control/current-private-hermes` to the
previous accepted generation.
