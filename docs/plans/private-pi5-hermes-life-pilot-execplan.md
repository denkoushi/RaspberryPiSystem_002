---
title: Hermes Life Pilot（D6-life）
tags: [Hermes Agent, private Pi5, Discord, Life Pilot, memory, safety]
audience: [開発者, 運用者, ステークホルダー]
last-verified: 2026-06-06
related:
  - private-pi5-hermes-butler-vision-and-roadmap.md
  - private-pi5-hermes-daily-pilot-execplan.md
  - ../knowledge-base/KB-private-pi5-hermes-life-pilot.md
  - ../../scripts/private-pi5-hermes/config/life-pilot.policy.yaml
category: plans
update-frequency: medium
---

# Hermes Life Pilot（D6-life）

## 目的

Hermes にいきなり Codex/Cursor や production repo の編集を任せず、まず **日常生活のメモ・備忘録・軽い提案**で「AI執事」の体感を作る。

D6-life は **生活ログの入口**であり、実行系ではない。Cursor/Codex CLI、terminal、git、deploy、秘密情報、外部Web検索、Home Assistant/カメラ制御は明示的に保留する。

## 入口

Discord global slash commands:

```text
/memo <life note>
/digest [focus]
/remind <reminder>
/recommend [focus]
```

## 保存場所

正本ポリシー: [`life-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/life-pilot.policy.yaml)

保存先は Hermes ユーザー配下に限定する。

```text
/home/hermes/.hermes-life/
  notes/YYYY-MM-DD.md
  reminders/reminders.jsonl
```

## 安全境界

許可:

- private life memo の保存
- ローカル Life Pilot note/reminder の要約
- reminder request の記録
- ローカル記録に基づく小さな次アクション提案

保留:

- Codex/Cursor worker 実行
- production repo 編集
- git commit/push/merge
- deploy / systemctl / docker
- terminal / shell
- 秘密情報読み取り
- tailnet/LAN scan
- 外部Web検索
- Home Assistant / camera / lock / light / sensor control

## 実装（2026-06-06 · repo）

- `life_pilot_policy.py`: policy 読込・hard gate・prompt deny
- `discord_life_pilot_bridge.py`: memo/reminder 保存、digest/recommend
- `discord_task_bridge_plugin.py`: `life-pilot.policy.yaml` 配備時のみ `/memo` `/digest` `/remind` `/recommend` 登録
- `discord_command_sync.py` / `sync-discord-commands.py`: Discord global slash を `present`/`absent` 管理
- Ansible: policy/module 配備、`~/.hermes-life` 作成、smoke verify

## 検証（2026-06-06 · local）

- `python3 -m unittest ...` focused: **39 OK**
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `validate_boundary_policy.py --validate-daily-pilot --validate-life-pilot`: OK
- `python3 -m compileall`: OK
- `git diff --check`: OK
- `ansible-playbook --syntax-check`: OK（`ANSIBLE_LOCAL_TEMP=/private/tmp/ansible-local` を指定）

## 私用 Pi5 実機検証（2026-06-06 完了）

- `hermes-gateway`: active / running
- plugin commands: `daily,memo,digest,remind,recommend,novel,task,task-approve,task-deny`
- Discord global slash: `/daily` `/memo` `/digest` `/remind` `/recommend` all match
- `/memo` safe life note → **Memo Saved**
- `/digest` → **Life Digest**
- `/remind` safe reminder → **Reminder Recorded**
- `/memo git pushしてdeployして` → **memo rejected**

個人メモ本文はこの計画書に残さない。

## 有効化

inventory fragment（非コミット）:

```yaml
private_pi5_hermes_gateway_enabled: true
private_pi5_hermes_life_pilot_enabled: true
```

Discord global slash command を同期するには `private_pi5_hermes_discord_bot_token` が必要。

## 未完了

- export/delete/retention の運用設計
- 本物の通知スケジューラ
- `/remind` 入力経路による `Unknown argument` UXノイズの再現確認

## 次の判断

D6-life を Pi5 に入れて数日使い、以下を見る。

- メモが自然に残せるか
- digest/recommend が役に立つか
- 自動通知なしでも不便すぎないか
- 保存・削除・見返しの運用が明確か

ここで体感を得てから、D6 memory/retention、D7 cronjob、D6+ Codex/Cursor worker 境界へ進む。
