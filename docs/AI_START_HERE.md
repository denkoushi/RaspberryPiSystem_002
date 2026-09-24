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

Task-to-rule routing is in [AGENTS.md](../AGENTS.md). Do not start by reading every large document or every plan.

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
- Do not create a new source document for a small change when the code, test, and concise work report are sufficient.
- Preserve Japanese UI labels, operator wording, logs, hostnames, and shop-floor terms when they are evidence.

For document structure and checks, follow `.cursor/rules/01-core-docs-and-knowledge.mdc` and `.cursor/rules/30-docs-maintenance.mdc` instead of copying those rules here.
