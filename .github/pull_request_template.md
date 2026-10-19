## Deploy impact declaration

PR本文の変更後、次の9行を実際の影響に合わせて記入してください。自動分類より安全側のrisk、対象機、surfaceの追加は許可されますが、少なく申告することはできません。`N/A`、`none`、`no`を使う場合は理由を添え、秘密値そのものは書かないでください。

<!-- deploy-impact:start -->
| Item | Declaration |
| --- | --- |
| Risk | <docs, ui-logic, api-agent-config, db-auth-systemd-deploy, or unknown> |
| Target machines | <none, pi3, pi4, pi5, or comma-separated devices> |
| Changed surfaces | <web, api, agent, systemd, config, db, auth, deploy, docs, ci, or unknown> |
| Required files/artifacts | <list required files/artifacts, or N/A: reason> |
| Database | <yes: describe migration/query evidence, or no: reason> |
| Secrets/config delivery | <yes: describe delivery method without values, or no: reason> |
| Success evidence | <tests, health check, screen/action, or N/A: reason> |
| Rollback/cleanup | <rollback and cleanup evidence, or N/A: reason> |
| Production verification | <production screen/action, or N/A: reason> |
<!-- deploy-impact:end -->

## Test plan

- Commands and environments:
- Evidence:
- Not run / reason:
