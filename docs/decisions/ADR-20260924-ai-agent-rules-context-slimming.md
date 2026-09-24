---
title: "ADR-20260924: Slim always-loaded AI agent rules"
status: accepted
date: 2026-09-24
deciders: [project owner, supervising agent]
tags: [ai-agent, cursor-rules, agents-md, context, token]
---

# ADR-20260924: Slim always-loaded AI agent rules

## Status

accepted

## Context

`AGENTS.md` plus the `alwaysApply: true` rules `00`, `01`, and `02` were injected into every Cursor session (about 12.3KB). `11-debugging-playbook.mdc` was glob-attached to every code file. The same facts (Git lifecycle, `EXEC_PLAN.md` legacy status, task routing) were repeated in 3–5 files, and `.agent/PLANS.md` told agents to proceed without asking and to "commit frequently", contradicting the approval boundary in `AGENTS.md`.

Anthropic guidance used as the reference:

- [Claude Code best practices](https://code.claude.com/docs/en/best-practices): cut lines whose removal would not cause mistakes; heavy emphasis makes nothing stand out.
- [Claude Code memory](https://code.claude.com/docs/en/memory): unscoped rules load unconditionally; contradictory rules are resolved arbitrarily.
- [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): keep the smallest set of high-signal tokens.

## Decision

- Only `AGENTS.md` and `00-core-safety.mdc` are always loaded (about 6.9KB).
- `01` loads with docs globs (same as `30`). `02` and `11` are agent-requested.
- One canonical location per fact: Git lifecycle in `20`, docs checks in `30`, task routing in `AGENTS.md`. Others link.
- KB/ADR templates moved to `docs/knowledge-base/_template.md` and `docs/decisions/_template.md`.
- `AGENTS.md` carries the safety prohibitions Codex needs (history rewrite, destructive operations, secrets) because Codex does not read `.mdc`. `20` no longer allows `--force` "with a reason".
- `.agent/PLANS.md` stops at the user-requested stage before commit/push/PR/merge/release/deploy.
- Emphasis is kept only on core safety prohibitions.
- `AGENTS.md` now lists known huge files/generated artifacts and output-narrowing behavior; PR/CI waiting and rerun pitfalls live in `20`.

## Alternatives

- Keep `01` always loaded: rejected; its templates and taxonomy apply only to doc work. The one-line canonical-doc rule stays in `AGENTS.md`.
- Enforce prohibitions with hooks now: deferred to a separate task; prose rules stay until a hook exists.

## Consequences

- Lower per-session context and fewer conflicting instructions.
- Code-only tasks no longer see detailed doc-writing rules automatically.

## Validation

- `rg -n 'alwaysApply|^globs' .cursor/rules/*.mdc` shows only `00` with `alwaysApply: true`.
- Safety terms (merge, deploy, `push --force`, `rm -rf`, WIP) remain in `AGENTS.md` and `00-core-safety.mdc`.
