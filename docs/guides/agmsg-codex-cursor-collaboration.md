---
title: agmsg Codex/Cursor Collaboration Guide
tags: [ai, agmsg, codex, cursor, collaboration]
audience: [ai-agent, developer]
last-verified: 2026-06-22
related: [../../AGENTS.md, ../AI_START_HERE.md, ./ai-handoff.md]
category: guides
update-frequency: medium
---

# agmsg Codex/Cursor Collaboration Guide

This guide records the local collaboration setup where Codex coordinates work and Cursor performs bounded implementation tasks through agmsg.

agmsg is a local SQLite-backed message channel. It is not the project source of truth, not a deployment mechanism, and not a replacement for Git, tests, plans, runbooks, or KB entries.

## Current Local Setup

- Repository path: `/Users/tsudatakashi/RaspberryPiSystem_002`
- agmsg team: `codex-cursor`
- Codex identity: `codex-lead`
- Cursor identity: `cursor-impl`
- Delivery mode: `turn`
- Local agent config files:
  - `.codex/hooks.json`
  - `.cursor/rules/agmsg.mdc`

These config files are local working files until there is an explicit decision to make agmsg part of the committed project policy.

## Operating Model

1. The user gives the goal to Codex in the Codex thread.
2. Codex inspects the repository, branch, PR, tests, and relevant docs.
3. Codex sends Cursor small, bounded tasks through agmsg.
4. Cursor reports findings, diffs, test results, or blockers back through agmsg.
5. Codex reviews the result and decides the next action.

Codex is the coordinator. Cursor is an implementation worker. The handoff must stay explicit so two agents do not edit the same area blindly.

## Basic Commands

Check the team and recent messages:

```bash
~/.agents/skills/agmsg/scripts/team.sh codex-cursor
~/.agents/skills/agmsg/scripts/history.sh codex-cursor codex-lead 20
```

Codex sends work to Cursor:

```bash
~/.agents/skills/agmsg/scripts/send.sh codex-cursor codex-lead cursor-impl "<message>"
```

Codex reads replies:

```bash
~/.agents/skills/agmsg/scripts/inbox.sh codex-cursor codex-lead
```

Cursor sends status to Codex:

```bash
~/.agents/skills/agmsg/scripts/send.sh codex-cursor cursor-impl codex-lead "<message>"
```

Cursor reads tasks:

```bash
~/.agents/skills/agmsg/scripts/inbox.sh codex-cursor cursor-impl
```

## Task Handoff Rules

- Codex owns task breakdown, review, validation judgment, and final user reporting.
- Cursor should not edit until Codex assigns a specific task.
- Before asking Cursor to edit, Codex states the target files or area, goal, stop condition, and validation command.
- Only one agent should edit the same file area at a time.
- Do not paste long logs into agmsg. Put long details in a file or command output summary, then send the path or key result.
- Do not run production deploys, Raspberry Pi operations, Git push, or destructive commands without explicit user approval.
- Keep project facts in the correct source-of-truth document. agmsg history is coordination context only.

## Cursor GUI And CLI Notes

Cursor must open `/Users/tsudatakashi/RaspberryPiSystem_002` when it needs to apply repository-local Cursor rules such as `.cursor/rules/agmsg.mdc`.

The Cursor GUI can remain open. Opening the correct folder is needed before Cursor is expected to understand repo-local rules, file paths, and branch context. It is not required before Codex can inspect or edit files directly.

## Troubleshooting

Use these checks when messages are not moving:

```bash
cursor-agent status
~/.agents/skills/agmsg/scripts/delivery.sh status codex-cursor codex-lead
~/.agents/skills/agmsg/scripts/delivery.sh status codex-cursor cursor-impl
~/.agents/skills/agmsg/scripts/inbox.sh codex-cursor codex-lead
~/.agents/skills/agmsg/scripts/inbox.sh codex-cursor cursor-impl
```

If Cursor does not react, confirm that the Cursor agent is logged in, the repository folder is open, and both agents are using the same team and identity names.

## Active Feature Context

The first feature using this collaboration mode is `feat/production-schedule-split-orders`.

The implementation source of truth remains [production-schedule-split-orders.md](../plans/production-schedule-split-orders.md). Use this agmsg guide only for agent coordination.
