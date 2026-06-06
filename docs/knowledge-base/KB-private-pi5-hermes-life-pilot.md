# KB-private-pi5-hermes-life-pilot: Discord Life Pilot（D6-life）

- **Status**: reference（2026-06-06 · D6/D7 私用 Pi5 E2E 完了 · D9 button UI repo 実装）
- **Related**: [ExecPlan D6-life](../plans/private-pi5-hermes-life-pilot-execplan.md) · [D6-pre daily pilot](./KB-private-pi5-hermes-daily-pilot.md) · [butler vision](../plans/private-pi5-hermes-butler-vision-and-roadmap.md) · [`life-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/life-pilot.policy.yaml)

## 要点

D6-life は、Hermes を **生活メモの執事**として先に体感するための最小実装。

Discord の `/memo` `/digest` `/remind` `/recommend` で、今日あったこと・備忘録・軽いリマインド要求・小さな次アクション提案を扱う。保存は `/home/hermes/.hermes-life` のみ。Codex/Cursor、terminal、git、deploy、外部Web、Home Assistant/カメラ制御は使わない。

## 実装サマリ

| 項目 | 内容 |
|------|------|
| 入口 | Discord slash `/memo` `/digest` `/remind` `/recommend`、朝晩 check-in の Discord button |
| 登録条件 | plugin 配置先に `life-pilot.policy.yaml` が存在 |
| 保存 | `notes/YYYY-MM-DD.md` · `reminders/reminders.jsonl` · `proactive/checkins.jsonl` · `proactive/replies.jsonl` |
| policy | hard gate false + deny prompt regex |
| Discord 応答 | 成功応答は本文を通常テキストで先頭表示し、保存先・安全境界などの診断情報は `-# debug:` 1行の subtext に畳む |
| Ansible | module/policy 配備、`~/.hermes-life` 作成、Discord command sync、reminder/proactive timers、button relay、smoke verify |
| command sync | Life Pilot 有効時 `present`、無効時 `absent` |

## 追加ファイル

| ファイル | 役割 |
|----------|------|
| [`life-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/life-pilot.policy.yaml) | D6-life safety contract |
| [`life_pilot_policy.py`](../../scripts/private-pi5-hermes/lib/life_pilot_policy.py) | policy/prompt 検証 |
| [`discord_life_pilot_bridge.py`](../../scripts/private-pi5-hermes/lib/discord_life_pilot_bridge.py) | memo/digest/remind/recommend 処理 |
| [`life_reminder_scheduler.py`](../../scripts/private-pi5-hermes/lib/life_reminder_scheduler.py) | due reminder Discord 通知 |
| [`life_proactive_loop.py`](../../scripts/private-pi5-hermes/lib/life_proactive_loop.py) | 朝晩 check-in と返信保存 |
| [`life_discord_ui_relay.py`](../../scripts/private-pi5-hermes/lib/life_discord_ui_relay.py) | Discord button / 自由入力 modal 返信 |
| [`verify-discord-life-pilot.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/verify-discord-life-pilot.yml) | Pi5 smoke |

## 境界

許可すること:

- private life memo の保存
- ローカル note/reminder の digest
- reminder request の pending 記録
- ローカル記録だけを根拠にした小さな提案

拒否・保留すること:

- Codex/Cursor worker 実行
- production repo 編集
- git commit/push/merge
- deploy/systemctl/docker
- terminal/shell
- secret/token/.env 読み取り
- tailnet/LAN scan
- external web research
- Home Assistant/camera/device control

## 検証

2026-06-06 local:

```bash
python3 -m unittest scripts/private-pi5-hermes/tests/test_life_pilot_policy.py \
  scripts/private-pi5-hermes/tests/test_discord_life_pilot_bridge.py \
  scripts/private-pi5-hermes/tests/test_discord_command_sync.py \
  scripts/private-pi5-hermes/tests/test_discord_task_bridge_plugin_register.py \
  scripts/private-pi5-hermes/tests/test_daily_pilot_policy.py \
  scripts/private-pi5-hermes/tests/test_discord_daily_pilot_bridge.py
```

結果: **39 tests OK**

追加確認:

- `--validate-life-pilot`: OK
- `--validate-daily-pilot --validate-life-pilot`: OK
- `python3 -m compileall`: OK
- `git diff --check`: OK
- `ansible-playbook --syntax-check`: OK（local tmp を `/private/tmp` に変更）

2026-06-06 私用 Pi5 + Discord E2E:

| 項目 | 結果 |
|------|------|
| `hermes-gateway` | active / running |
| plugin commands | `daily,memo,digest,remind,recommend,novel,task,task-approve,task-deny` |
| Discord slash definitions | `/daily` `/memo` `/digest` `/remind` `/recommend` all match |
| `/memo` safe life note | **Memo Saved** |
| `/digest` | **Life Digest**（local notes/reminders のみ） |
| `/remind` safe reminder | **Reminder Recorded** |
| `/memo git pushしてdeployして` | **memo rejected** |
| gateway error log | 直近確認では error なし |

補足: `/remind` 操作時に一度 `Unknown argument` 系の表示が混じった。最終的な slash command handler は **Reminder Recorded** を返しており主経路は成功。再現する場合は、Discord の slash command Arguments 欄か1行テキスト経路の差としてUX改善候補にする。

2026-06-06 追記: Discord 上の日常利用性を優先し、`/memo` `/digest` `/remind` `/recommend` の成功応答は本文中心にした。保存先・件数・安全境界は開発観察用に `-# debug:` 1行だけ残す。

2026-06-06 追記2: 実機目視で Markdown 見出し（`#`）が大きく白く目立ち、引用（`>`）が本文をグレー表示にして本文優先の体感を弱めることを確認した。成功応答では `#` 見出しと `>` 引用を使わず、`/memo` `/remind` は本文そのものを通常テキストで先頭表示する。`/digest` `/recommend` も Markdown 見出しを使わず、通常テキストの `Focus:` / `Recent notes:` / `Suggested next steps:` ラベルにする。安全境界と保存形式は変更しない。

## 運用メモ

有効化:

```yaml
private_pi5_hermes_gateway_enabled: true
private_pi5_hermes_life_pilot_enabled: true
```

Discord command sync には `private_pi5_hermes_discord_bot_token` が必要。

2026-06-06 追記3: reminder scheduler と proactive loop を追加した。日時つき `/remind` は `hermes-life-reminder.timer` が Discord 通知し、朝晩 check-in は `hermes-life-proactive-{morning,evening}.timer` が送る。

2026-06-06 追記4: `/life-reply` は日常操作には長いため、proactive check-in に Discord native button と自由入力 modal を付けた。button は `hermes-life-discord-ui.service` が処理し、`proactive/replies.jsonl` と通常 memo に保存する。通常メッセージの `1` は補助扱いで、正本は button、fallback は `/life-reply`。

## 既知の制限

- retention/export/delete は未実装。
- LLM での高度な推薦ではなく、ローカル記録に基づく deterministic suggestion。
- Discord `/remind` の入力経路によっては `Unknown argument` 系のUXノイズが出る可能性がある。
- button relay は Discord interaction のみを扱う sidecar。Hermes 本体の自然文会話やスキル拡張ではない。

## 次

数日使う。体感が良ければ、次に retention/delete/export と限定通知を設計する。Codex/Cursor worker は別フェーズで、1 task = 1 worktree/branch、別 HOME/token、承認境界を作ってから扱う。
