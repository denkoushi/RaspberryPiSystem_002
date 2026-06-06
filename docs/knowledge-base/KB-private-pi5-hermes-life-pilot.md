# KB-private-pi5-hermes-life-pilot: Discord Life Pilot（D6-life 以降）

- **Status**: active（2026-06-06 · repo `feat/hermes-life-proactive-loop` @ `30296697` · 私用 Pi5 deploy + Discord E2E 完了）
- **Scope**: 私用 Pi5 Hermes · Discord Life Pilot のみ（業務 Pi5 / Pi4 / `update-all-clients.sh` 対象外）
- **Related**: [ExecPlan D6-life](../plans/private-pi5-hermes-life-pilot-execplan.md) · [Runbook §D6-life](../runbooks/private-pi5-hermes-deploy.md#phase-d6-life--discord-life-pilot2026-06-06-repo-実装) · [daily pilot](./KB-private-pi5-hermes-daily-pilot.md) · [`life-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/life-pilot.policy.yaml)

## Context

Hermes を **生活メモの執事**として先に体感する最小実装。Codex/Cursor・本番 repo・terminal・git・deploy・秘密読取・外部 Web・HA/カメラは **意図的に未接続**。実行系ではなく **ローカル private log + 限定的 Discord 通知/返信** に閉じる。

## 仕様（現行）

### Discord 入口

| 種類 | 内容 |
|------|------|
| slash | `/memo` `/digest` `/remind` `/recommend` |
| slash（補助） | `/life-reply` — button/modal が使えないときの fallback |
| 朝晩 check-in | `hermes-life-proactive-{morning,evening}.timer` が Discord へ送信 |
| button | `まず1つやる` / `あとで見る` / `今日は外す` + `自由入力` modal |
| 応答 UX | 成功時は **本文テキスト先頭** · 診断は `-# debug:` 1行 subtext · `#` 見出しと `>` 引用は使わない |

### 保存先（正本）

```text
/home/hermes/.hermes-life/
  notes/YYYY-MM-DD.md
  reminders/reminders.jsonl
  proactive/checkins.jsonl
  proactive/replies.jsonl
```

### systemd / sidecar

|  unit | 役割 |
|------|------|
| `hermes-gateway` | chat profile · slash plugin 登録 |
| `hermes-life-reminder.timer` | due reminder の Discord 通知（既定 1 分） |
| `hermes-life-proactive-morning.timer` | 朝 check-in 送信 |
| `hermes-life-proactive-evening.timer` | 夜 check-in 送信 |
| `hermes-life-discord-ui.service` | button / 自由入力 modal の interaction relay |

Ansible フラグ（fragment）:

```yaml
private_pi5_hermes_gateway_enabled: true
private_pi5_hermes_life_pilot_enabled: true
# 既定 true: private_pi5_hermes_life_reminder_scheduler_enabled
# 既定 true: private_pi5_hermes_life_proactive_loop_enabled
# 既定 true: private_pi5_hermes_life_discord_ui_relay_enabled
```

### 安全境界（緩めていない）

`life-pilot.policy.yaml` hard gate はすべて `false`。`deny_prompt_substrings` / `deny_prompt_patterns` で Codex/Cursor・git・deploy・terminal・秘密・web・HA を拒否。chat profile の `disabled_toolsets` は従来どおり。

## 実装マップ

| ファイル | 役割 |
|----------|------|
| `life-pilot.policy.yaml` | safety contract |
| `life_pilot_policy.py` | prompt 検証 |
| `discord_life_pilot_bridge.py` | slash 4種 + 日時パース + body-first 応答 |
| `life_reminder_scheduler.py` | due reminder Discord 送信 |
| `life_proactive_loop.py` | 朝晩 check-in 構築・返信保存 |
| `life_discord_ui_relay.py` | Discord component relay（discord.py） |
| `verify-discord-life-pilot.yml` | Pi5 smoke |

## Validation

### Local（`30296697` 時点）

```bash
python3 -m unittest discover -s scripts/private-pi5-hermes/tests
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --validate-life-pilot
git diff --check
ANSIBLE_LOCAL_TEMP=/private/tmp/ansible-local TMPDIR=/private/tmp \
  ./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh --syntax-check
```

結果: **184 tests OK** · life-pilot policy OK · syntax-check OK

### 私用 Pi5 deploy（`30296697`）

```
PLAY RECAP: ok=175 changed=7 failed=0 skipped=17
summary: life_pilot_enabled=True
         life_reminder_scheduler_active=True
         life_proactive_loop_active=True
         life_discord_ui_relay_active=True
```

### Discord / 実機 E2E（2026-06-06）

| 確認 | 結果 |
|------|------|
| `hermes-gateway` | active |
| `hermes-life-discord-ui.service` | active · `life_discord_ui_relay ready` |
| 朝 check-in 再送 | `sent: 1` · `status: pending_reply` |
| Discord API ボタンラベル | `まず1つやる` `あとで見る` `今日は外す` `自由入力` |
| button 返信経路（relay 同一） | `受け取りました` を含む |
| 自由入力返信経路（relay 同一） | `受け取りました` を含む |
| 危険 `/memo git pushしてdeployして` | `memo rejected` |

手順の正本は [Runbook §D6-life](../runbooks/private-pi5-hermes-deploy.md)。再検証例:

```bash
systemctl start hermes-life-proactive@morning.service
journalctl -u hermes-life-proactive@morning.service -n 10 --no-pager
```

## Troubleshooting（実績あるもののみ）

| 症状 | 原因 | 対処 |
|------|------|------|
| `/remind` で `Unknown argument` が混じる | slash Arguments 欄と1行テキスト経路の差 | 主経路は成功していることが多い。button 正本化後は modal を優先 |
| 成功応答の `#` が大きく目立つ | Discord Markdown 見出し | body-first 化済み（見出し・引用廃止） |
| button を押しても応答なし | `hermes-life-discord-ui.service` inactive · check-in が `answered`/期限切れ | relay active 確認 · 朝/夜 check-in を `pending_reply` で再送 |
| `deploy` を含む memo が拒否される | policy deny（意図的） | 安全境界。文言を変える |

## Open Items

1. **`feat/hermes-life-proactive-loop` を `main` へマージ** — 本 KB 更新と同時に PR 化予定
2. **retention / export / delete** — `~/.hermes-life` の保持・削除ポリシー未設計
3. **Codex/Cursor worker** — 1 task = 1 worktree/branch · 別 HOME/token · 承認境界（D6+、Life Pilot から直接解放しない）
4. **LLM ベース推薦** — 現状は deterministic suggestion のみ
5. **数日運用の体感評価** — proactive 朝晩・reminder 通知の頻度/文言調整

## References

- コード: `scripts/private-pi5-hermes/lib/` · `infrastructure/ansible/tasks/private-pi5-hermes/`
- 北極星: [butler vision](../plans/private-pi5-hermes-butler-vision-and-roadmap.md)
- 索引: [docs/INDEX.md](../INDEX.md) · [knowledge-base/index.md](./index.md)
