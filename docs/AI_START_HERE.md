---
title: AI Start Here
tags: [ai, documentation, source-of-truth, handoff]
audience: [ai-agent]
last-verified: 2026-08-13
related: [../AGENTS.md, ../.cursor/rules/01-core-docs-and-knowledge.mdc, ./guides/ai-handoff.md]
category: guides
update-frequency: low
---

# AI Start Here

This is a stable routing map for AI agents. It does not duplicate active-task status, detailed procedures, or validation logs.

## Read Only What The Task Needs

After `AGENTS.md`, read `.cursor/rules/00-core-safety.mdc`. Read other rules
only when the task matches their route:

| Task | Rule and current source |
| --- | --- |
| Code, tests, or CI | `.cursor/rules/10-quality-ci-and-tests.mdc`; affected workspace documentation |
| Debugging | `.cursor/rules/11-debugging-playbook.mdc`; related KB and logs |
| Commit, push, PR, or merge | `.cursor/rules/20-git-workflow.mdc`; only the stage the user requested |
| Documentation | `.cursor/rules/01-core-docs-and-knowledge.mdc`; `.cursor/rules/30-docs-maintenance.mdc`; `docs/INDEX.md` |
| Public contract, module boundary, or large refactor | `.cursor/rules/02-core-architecture.mdc` |
| Frontend or UI | `.cursor/rules/33-frontend-ui-quality.mdc` |
| Production deploy or recovery | `docs/guides/deployment.md`; `docs/runbooks/deploy-status-recovery.md` |
| Codex/Cursor agmsg | `docs/guides/agmsg-codex-cursor-collaboration.md` |
| DGX cross-repository change | [`DGXSparkControlPlane` repository boundary](https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/repository-boundary.md) |

Do not start by reading every large document or every plan.

## Source Of Truth Map

- Incidents, investigations, root causes, and prevention: `docs/knowledge-base/`
- Operations, recovery, deployment, and validation procedures: `docs/runbooks/` and `docs/guides/`
- Design decisions and tradeoffs: `docs/decisions/`
- Planned or unfinished implementation work: `docs/plans/`
- Global navigation: `docs/INDEX.md`
- Knowledge-base navigation: `docs/knowledge-base/index.md`

Use task terms, paths, issue or PR numbers to search these locations. Determine current state from the relevant source plus Git, GitHub, CI, or the live system as appropriate; this file is not a current-work index.

## Documentation Boundaries

- Put each detailed fact in exactly one KB, ADR, Runbook, or Plan and link to it elsewhere.
- Keep index entries to status, title, and link; do not add narrative logs.
- `EXEC_PLAN.md` is a legacy historical log. Do not use it as current truth or append detailed progress.
- Do not create a new source document for a small change when the code, test, and concise work report are sufficient.
- Preserve Japanese UI labels, operator wording, logs, hostnames, and shop-floor terms when they are evidence.

For document structure and checks, follow `.cursor/rules/01-core-docs-and-knowledge.mdc` and `.cursor/rules/30-docs-maintenance.mdc` instead of copying those rules here.
