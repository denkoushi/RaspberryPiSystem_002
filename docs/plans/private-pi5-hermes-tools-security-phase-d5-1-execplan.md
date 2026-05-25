---
title: 私用 Pi5 Hermes ツール向けセキュリティ Phase D5.1 ExecPlan
tags: [Hermes Agent, private Pi5, Discord, tools profile, Phase D5.1, approval relay]
audience: [開発者, 運用者]
last-verified: 2026-05-25
related:
  - private-pi5-hermes-tools-security-phase-d5-execplan.md
  - ../decisions/ADR-20260525-private-pi5-hermes-discord-approval-relay-d5-1.md
  - ../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md
  - ../runbooks/private-pi5-hermes-deploy.md
category: plans
update-frequency: medium
---

# Phase D5.1 ExecPlan — Discord 承認中継

## Purpose

Phase D5 の `/task` 橋は tools プロファイルを **subprocess `hermes chat -q`** で実行するため、Hermes 標準の gateway 承認通知が Discord に届かず、非対話経路では危険操作が **AUTO-APPROVE** され得る。**ファイル IPC 中継**で manual 承認を Discord 上で完結させる。

## Progress

- [x] `approval_relay/` モジュール（store · coordinator · runner · discord_relay）
- [x] `task-bridge.policy.yaml` — `approval_relay` セクション
- [x] `tools_profile_runner.py` — relay 有効時は in-process runner 経由
- [x] plugin — `/task-approve` · `/task-deny` · `pre_gateway_dispatch`（yes/no テキスト）
- [x] Ansible deploy/verify D5.1 · smoke 拡張
- [x] unittest + smoke **PASS**（ローカル）
- [ ] 実機デプロイ（私用 Pi5）
- [ ] Discord write タスク E2E（手動）

## 設計（確定）

| 項目 | 選択 |
|------|------|
| 実行方式 | **ファイル IPC 中継** — tools HOME 分離維持 |
| 承認 UX | テキスト（yes/no 等）+ `/task-approve` / `/task-deny` |
| subprocess | runner が **同一 Python プロセス**で `hermes_cli.main` を呼び、`register_gateway_notify` を保持 |

## 受け入れ基準

| 項目 | 期待 |
|------|------|
| read-only `/task` | 承認なし · 10〜60s · 雑談回帰なし |
| write `/task` | Discord に承認依頼 → yes または `/task-approve` → 完了 |
| deny | `/task-deny` または no → BLOCKED 短文 · タスク終了 |
| セキュリティ | `HERMES_EXEC_ASK=1` で auto-approve 経路を閉じる |
| 境界 | chat toolsets 不変 · tools HOME 分離維持 |
| CI | unittest + smoke PASS |

## 実機手動 E2E（デプロイ後）

1. Discord DM: `/task List files in workspace` — read-only · **承認なし**で応答
2. Discord DM: `/task Create hello-d51.txt in workspace with content test` — **承認依頼**が届く
3. `yes` または `/task-approve` — ファイル作成完了
4. 再試行で `/task-deny` または `no` — 拒否短文 · タスク終了
5. 通常雑談 1 通 — `/task` 待ちが無いときは **通常 chat** に流れる

## ロールバック

- `approval_relay.enabled: false` にして再デプロイ → D5 挙動（legacy subprocess）に戻る
- D5 フラグ off → plugin ごと無効

## References

- [ADR D5.1](../decisions/ADR-20260525-private-pi5-hermes-discord-approval-relay-d5-1.md)
- [ExecPlan D5](./private-pi5-hermes-tools-security-phase-d5-execplan.md)
- [KB Phase D5](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md)
