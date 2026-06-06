# KB-private-pi5-hermes-life-pilot: Discord Life Pilot（D6-life 以降）

- **Status**: active（2026-06-06 · branch `feat/hermes-life-pilot-context-briefing` @ `7575fafd` · D11 私用 Pi5 deploy + Discord E2E 完了 · **PR merge 待ち**）
- **Scope**: 私用 Pi5 Hermes · Discord Life Pilot のみ（業務 Pi5 / Pi4 / `update-all-clients.sh` 対象外）
- **Related**: [ExecPlan D6-life](../plans/private-pi5-hermes-life-pilot-execplan.md) · [Runbook §D6-life](../runbooks/private-pi5-hermes-deploy.md#phase-d6-life--discord-life-pilot2026-06-06-repo-実装) · [daily pilot](./KB-private-pi5-hermes-daily-pilot.md) · [`life-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/life-pilot.policy.yaml)

## Context

Hermes を **生活メモの執事**として先に体感する最小実装。Codex/Cursor・本番 repo・terminal・git・deploy・秘密読取・外部 Web・HA/カメラは **意図的に未接続**。実行系ではなく **ローカル private log + 限定的 Discord 通知/返信** に閉じる。

## 仕様（現行 · D11 まで）

### Discord 入口

| 種類 | 内容 |
|------|------|
| slash | `/memo` `/digest` `/remind` `/recommend` |
| slash（補助） | `/life-reply` — button/modal が使えないときの fallback |
| 朝晩 check-in | `hermes-life-proactive-{morning,evening}.timer` が Discord へ送信 |
| follow-up | 朝 `夕方にもう一度` → `followups.jsonl` に pending · `hermes-life-followup.timer`（既定 5 分）が due 時に **1回だけ** 再確認 |
| button | 朝 `これをやる` / `夕方にもう一度` / `今日は外す`、follow-up `やる` / `明日に回す` / `外す`、夜 `終わった` / `明日に回す` / `メモだけ残す` + `自由入力` modal |
| 応答 UX | 成功時は **本文テキスト先頭** · 診断は `-# debug:` 1行 subtext · `#` 見出しと `>` 引用は使わない |

### D10 朝候補ロジック

朝 check-in は pending reminder と最近 memo から **deterministic に1件** を選び `今日まず見るなら:` として表示する。優先順: 今日までの日時つき reminder → 日時なし reminder → 次の日時つき reminder → 最近の memo。

`夕方にもう一度` は `proactive/followups.jsonl` に `status=pending` を保存。既定 due は当日 17:00（過ぎていれば now+2h）。送信後は `status=sent` とし `checkins.jsonl` に `mode=followup` の pending check-in を追加。返信は `resolve_proactive_reply()` 経由。

follow-up 本文は `今ならこれだけ見ますか:` + 候補1件。夜 check-in は候補があれば `朝に見ていたもの:` を表示。

### D11 文脈ブリーフィング

朝 check-in に `今日の見方:` を追加する。最近の memo に疲れ・眠い・しんどい等の低エネルギー signal があれば軽めに聞き、未処理が多い場合は責めずに1つだけ聞く。直近3日で `selectedOption=2` になった候補は `carried_forward` として翌朝もう一度出す（今日までの日時つき reminder がある場合はそちらを優先）。

送信済み check-in には `briefing` と `contextHints`（`lowEnergy` / `pendingCount` / `pressure`）を保存する。briefing 優先順: 低エネルギー+多め未処理 → 低エネルギーのみ → 多め未処理 → carried → 既定。

### 保存先（正本）

```text
/home/hermes/.hermes-life/
  notes/YYYY-MM-DD.md
  reminders/reminders.jsonl
  proactive/checkins.jsonl
  proactive/replies.jsonl
  proactive/followups.jsonl
```

### systemd / sidecar

|  unit | 役割 |
|------|------|
| `hermes-gateway` | chat profile · slash plugin 登録 |
| `hermes-life-reminder.timer` | due reminder の Discord 通知（既定 1 分） |
| `hermes-life-proactive-morning.timer` | 朝 check-in 送信 |
| `hermes-life-proactive-evening.timer` | 夜 check-in 送信 |
| `hermes-life-followup.timer` | due follow-up 再確認（既定 5 分） |
| `hermes-life-discord-ui.service` | button / 自由入力 modal の interaction relay |

Ansible フラグ（fragment）:

```yaml
private_pi5_hermes_gateway_enabled: true
private_pi5_hermes_life_pilot_enabled: true
# 既定 true: private_pi5_hermes_life_reminder_scheduler_enabled
# 既定 true: private_pi5_hermes_life_proactive_loop_enabled
# 既定 true: private_pi5_hermes_life_followup_loop_enabled
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
| `life_proactive_loop.py` | 朝晩/follow-up check-in 構築・返信保存 |
| `life_discord_ui_relay.py` | Discord component relay（discord.py） |
| `verify-discord-life-pilot.yml` | Pi5 smoke |

## Validation

### Local（D11 · `21760861`）

```bash
python3 -m unittest discover -s scripts/private-pi5-hermes/tests
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --validate-life-pilot
git diff --check
ANSIBLE_LOCAL_TEMP=/private/tmp/ansible-local TMPDIR=/private/tmp \
  ./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh --syntax-check
```

結果: **193 tests OK** · life-pilot policy OK · syntax-check OK

### 私用 Pi5 deploy（D10 · `57d19193`）

```
PLAY RECAP: ok=178 changed=6 failed=0
summary: life_pilot_enabled=True
         life_reminder_scheduler_active=True
         life_proactive_loop_active=True
         life_followup_loop_active=True
         life_discord_ui_relay_active=True
```

### D10 実機 E2E（2026-06-06 · branch deploy）

| 確認 | 結果 |
|------|------|
| `hermes-life-followup.timer` | active |
| `hermes-life-discord-ui.service` / `hermes-gateway` | active |
| 朝 check-in 新フォーマット | 当日重複ガード解除後の再送で Discord に `今日まず見るなら:` + 候補（例: `今日風呂洗い`） |
| `夕方にもう一度` | `2026-06-06-morning-followup-2` が `followups.jsonl` で `status=pending` |
| due follow-up | due を近づけて `dispatch_sent=1` · 2回目 `sent=0` · Discord delta +1 · `status=sent` |
| follow-up `やる` | `受け取りました` + `boundary=local-only/no-tools` |
| 危険 `/memo git pushしてdeployして` | `memo rejected`（従来どおり） |

手順の正本は [Runbook §D6-life](../runbooks/private-pi5-hermes-deploy.md)。再検証例:

```bash
systemctl start hermes-life-proactive@morning.service
systemctl start hermes-life-followup.service
journalctl -u hermes-life-proactive@morning.service -n 10 --no-pager
```

### 私用 Pi5 deploy（D11 · `21760861`）

初回 deploy は Life Pilot smoke で失敗した。原因は、以前の root 実行E2Eで `/home/hermes/.hermes-life` 配下の所有者が `root:root` になり、`hermes` user の smoke が `checkins.jsonl` を読めなかったこと。`chown -R hermes:hermes /home/hermes/.hermes-life` 後の再 deploy は成功。

```
PLAY RECAP: ok=177 changed=4 failed=0
summary: life_pilot_enabled=True
         life_reminder_scheduler_active=True
         life_proactive_loop_active=True
         life_followup_loop_active=True
         life_discord_ui_relay_active=True
```

### D11 実機 E2E（2026-06-06 · branch deploy）

| 確認 | 結果 |
|------|------|
| 朝 check-in `今日の見方:` | Discord に表示 |
| 低エネルギー文脈 | `lowEnergy=true`、`briefing=最近の体調メモが少し重めで、残りも多めです。今日は1つだけ見ます。` |
| carried forward | `candidate_source=carried_forward`、`今日まず見るなら: 風呂洗い` |
| safety | Discord debug line と `--validate-life-pilot` で `boundary=local-only/no-tools`、全 hard gate false |

補足: 疲れメモは `notes/*.md` の `## YYYY-MM-DD HH:MM` block 形式でないと `_read_note_entries()` が読まない。検証時は当日メモに `今日は疲れて眠い。` を追加した。

## Troubleshooting（実績あるもののみ）

| 症状 | 原因 | 対処 |
|------|------|------|
| `/remind` で `Unknown argument` が混じる | slash Arguments 欄と1行テキスト経路の差 | 主経路は成功していることが多い。button/modal を優先 |
| 成功応答の `#` が大きく目立つ | Discord Markdown 見出し | body-first 化済み（見出し・引用廃止） |
| button を押しても応答なし | `hermes-life-discord-ui.service` inactive · check-in が `answered`/期限切れ | relay active 確認 · check-in を `pending_reply` で再送 |
| `deploy` を含む memo が拒否される | policy deny（意図的） | 安全境界。文言を変える |
| follow-up が Discord に届かない（Python 直呼び） | `.env` 未読込で `DISCORD_BOT_TOKEN` 不足 | `hermes-life-followup.service`（`EnvironmentFile=.env`）経由で起動する |
| deploy 後も朝メッセージが旧フォーマット | 当日 `checkins.jsonl` の重複ガードで再送スキップ | 当日 `-morning` 行を削除または `pending_reply` に戻して再送 |
| Life Pilot smoke が `PermissionError` で `checkins.jsonl` を読めない | root 実行E2Eなどで `/home/hermes/.hermes-life` 配下が `root:root` になった | `chown -R hermes:hermes /home/hermes/.hermes-life` 後に再 deploy |
| 疲れメモがあるのに `lowEnergy=false` | `notes/*.md` が `## YYYY-MM-DD HH:MM` block 形式でない、または limit 内に届かない | memo 保存形式を確認。D11 briefing は `_read_note_entries()` 経由のみ |

## Open Items

1. **`feat/hermes-life-pilot-context-briefing` を `main` へマージ** — D11 branch deploy 済み。merge 後に main HEAD で deploy 再確認
2. **follow-up 自由入力 modal の目視 E2E** — button `やる` は確認済み。同一 check-in が `answered` 後は再試行不可のため別セッションで確認
3. **retention / export / delete** — `~/.hermes-life` の保持・削除ポリシー未設計
4. **Codex/Cursor worker** — 1 task = 1 worktree/branch · 別 HOME/token · 承認境界（D6+、Life Pilot から直接解放しない）
5. **LLM ベース推薦** — 現状は deterministic suggestion のみ
6. **数日運用の体感評価** — proactive 朝晩・reminder/follow-up 通知の頻度/文言調整

## References

- コード: `scripts/private-pi5-hermes/lib/` · `infrastructure/ansible/tasks/private-pi5-hermes/`
- 北極星: [butler vision](../plans/private-pi5-hermes-butler-vision-and-roadmap.md)
- 索引: [docs/INDEX.md](../INDEX.md) · [knowledge-base/index.md](./index.md)
