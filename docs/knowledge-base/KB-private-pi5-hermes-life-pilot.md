# KB-private-pi5-hermes-life-pilot: Discord Life Pilot（D6-life 以降）

- **Status**: active（2026-06-06 · D12 Obsidian inbox deploy 完了 · D13 Discord shared inbox **`f782f59d` Pi5 deploy 完了** · 画像-only 実機 E2E **未完了**）
- **Scope**: 私用 Pi5 Hermes · Discord Life Pilot のみ（業務 Pi5 / Pi4 / `update-all-clients.sh` 対象外）
- **Branch / HEAD（再開用）**: `feat/hermes-life-pilot-discord-inbox` @ **`f782f59d`** — `fix(hermes): capture Discord media URLs in inbox`
- **Related**: [Runbook §D6-life](../runbooks/private-pi5-hermes-deploy.md#phase-d6-life--discord-life-pilot2026-06-06-repo-実装) · [Plan D6-life](../plans/private-pi5-hermes-life-pilot-execplan.md) · [daily pilot](./KB-private-pi5-hermes-daily-pilot.md) · [`life-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/life-pilot.policy.yaml)

## Context

Hermes を **生活メモの執事**として先に体感する最小実装。Codex/Cursor・本番 repo・terminal・git・deploy・秘密読取・外部 Web・HA/カメラは **意図的に未接続**。実行系ではなく **ローカル private log + 限定的 Discord 通知/返信** に閉じる。

## 仕様（現行 · D13 repo）

### Discord 入口

| 種類 | 内容 |
|------|------|
| slash | `/memo` `/digest` `/remind` `/recommend` |
| slash（補助） | `/life-reply` — button/modal が使えないときの fallback |
| 朝晩 check-in | `hermes-life-proactive-{morning,evening}.timer` が Discord へ送信 |
| follow-up | 朝 `夕方にもう一度` → `followups.jsonl` に pending · `hermes-life-followup.timer`（既定 5 分）が due 時に **1回だけ** 再確認 |
| button | 朝 `これをやる` / `夕方にもう一度` / `今日は外す`、follow-up `やる` / `明日に回す` / `外す`、夜 `終わった` / `明日に回す` / `メモだけ残す` + `自由入力` modal |
| Discord 共有 | Android 標準の共有メニューから Discord DM/専用チャンネルへ送ったリンク・添付名・明示メモを Life Pilot inbox に保存 |
| 応答 UX | 成功時は **本文テキスト先頭** · 診断は `-# debug:` 1行 subtext · `#` 見出しと `>` 引用は使わない |

### D10 朝候補ロジック

朝 check-in は pending reminder と最近 memo から **deterministic に1件** を選び `今日まず見るなら:` として表示する。D10時点の優先順は、今日までの日時つき reminder → 日時なし reminder → 次の日時つき reminder → 最近の memo。

`夕方にもう一度` は `proactive/followups.jsonl` に `status=pending` を保存。既定 due は当日 17:00（過ぎていれば now+2h）。送信後は `status=sent` とし `checkins.jsonl` に `mode=followup` の pending check-in を追加。返信は `resolve_proactive_reply()` 経由。

follow-up 本文は `今ならこれだけ見ますか:` + 候補1件。夜 check-in は候補があれば `朝に見ていたもの:` を表示。

### D11 文脈ブリーフィング

朝 check-in に `今日の見方:` を追加する。最近の memo に疲れ・眠い・しんどい等の低エネルギー signal があれば軽めに聞き、未処理が多い場合は責めずに1つだけ聞く。直近3日で `selectedOption=2` になった候補は `carried_forward` として翌朝もう一度出す（今日までの日時つき reminder がある場合はそちらを優先）。

送信済み check-in には `briefing` と `contextHints`（`lowEnergy` / `pendingCount` / `pressure`）を保存する。briefing 優先順: 低エネルギー+多め未処理 → 低エネルギーのみ → 多め未処理 → carried → 既定。

### D12 Obsidian inbox（repo）

Android Obsidian の `Documents/Obsidian/HermesLife` を Syncthing-Fork で Pi5 へ同期し、Pi5 側のローカルコピーだけを Life Pilot の入力として読む。既定パス:

```text
/home/hermes/.hermes-life/obsidian/HermesLife
```

Hermes は保管庫を **読むだけ**。Obsidian 側への書込・削除、Syncthing 設定変更、OCR/画像認識は行わない。Markdown の本文は短い snippet のみ、画像/PDF はファイル名と存在だけを扱う。`.obsidian` / `.stfolder` / `.stversions` / symlink は読まない。`token` / `secret` / `.env` などを含む行は Discord 表示から落とす。

朝 check-in に `Obsidian新着:` を追加する。Obsidian の新着メモに疲れ・眠い等の signal があれば D11 briefing の `lowEnergy` に反映する。

送信済み check-in の `contextHints` には `obsidianItems` / `obsidianAttachments` も保存する。本文やファイル名の詳細は check-in JSON には残さない。

### D13 Discord shared inbox（repo · `f782f59d`）

Obsidian/Syncthing が重い場合の入力経路として、Android 標準の共有メニューから Discord へ送ったリンク・画像・スクショを Life Pilot inbox に保存する。既定保存先:

```text
/home/hermes/.hermes-life/inbox/discord.jsonl
```

**capture 対象（Hermes 本体チャットへ渡さない）**:

| 入力形 | 処理 |
|--------|------|
| X/URL 本文 | `urls` + 短い `text` |
| Discord embed-only（本文空） | embed の `url` / `title` / `description` から抽出 |
| 添付プレースホルダ | 例: `クリックして添付ファイルを表示` → `attachments` にファイル名 |
| **gateway `media_urls`** | Hermes Discord adapter が渡す画像パス（例: `img_*.png`）を **添付として保存**（`f782f59d`） |
| 本文なし画像-only | `text` を `共有: Discord投稿（本文なし）` に正規化（`GATEWAY_EMPTY_MESSAGE_TEXT` 検出） |
| nested metadata | `message` / `raw` / `data` 等の入れ子から URL・添付名を抽出（`d5448a2a`） |

**応答**: 短く `受け取り箱に保存しました。` + `-# debug: ... boundary=local-only/no-tools`。長文チャット・`vision_analyze_tool` には流さない。

**保存レコード（主要フィールド）**: `source=discord` · `untrusted=true` · `messageId` · `attachments` · `urls` · `text` · `channelId` · `userId` · `createdAt` · `status=new`

Hermes は外部 Web を開かない。添付のダウンロード・OCR・画像認識は行わない。`token` / `secret` / `.env` などを含む本文は redacted。

朝 check-in に `共有メモ新着:` / `共有メモを見返す` を追加。候補優先順は、今日までの日時つき reminder → carried_forward → **Discord 共有メモ** → Obsidian 新着 → 日時なし reminder → 次の日時つき reminder → 最近の memo。

**二重経路**:

| 経路 | 役割 |
|------|------|
| `hermes-gateway` plugin `pre_gateway_dispatch` | slash 以外の通常 DM。`media_urls` / embed / プレースホルダを捕捉して `skip/life-discord-inbox` |
| `hermes-life-discord-ui.service` | discord.py sidecar。本文空+添付のみ等の保険。`on_message` で capture して ack |

通常会話をすべて保存したい場合のみ `private_pi5_hermes_life_discord_inbox_capture_all: true`。

### D12 Obsidian Syncthing（私用 Pi5 運用メモ）

Ansible は受け皿作成まで。pairing は手動。

| 項目 | 値 |
|------|-----|
| Android folder ID | `d5s97-8v6z5` |
| Pi5 path | `/home/hermes/.hermes-life/obsidian/HermesLife` |
| Pi5 type | receiveonly |
| Pi5 device / user | `syncthing@hermes` |
| Tailscale direct | `tcp://100.89.190.21:22000` |
| UFW | `22000/tcp on tailscale0 ALLOW`（未許可だと Android disconnected） |

### 保存先（正本）

```text
/home/hermes/.hermes-life/
  notes/YYYY-MM-DD.md
  reminders/reminders.jsonl
  proactive/checkins.jsonl
  proactive/replies.jsonl
  proactive/followups.jsonl
  obsidian/HermesLife/        # Syncthing receive-only copy; read-only input for Hermes
  inbox/discord.jsonl         # Discord shared inbox; untrusted local input
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
# 既定 true: private_pi5_hermes_life_discord_inbox_enabled
# 任意: private_pi5_hermes_life_discord_inbox_channel_ids
# 既定 false: private_pi5_hermes_life_discord_inbox_capture_all
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
| `life_obsidian_inbox.py` | Syncthing 済み Obsidian vault の read-only 要約 |
| `life_discord_inbox.py` | Discord shared message の local inbox 保存・要約 |
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

### Local（D12 · Obsidian inbox repo）

- `python3 -m unittest scripts/private-pi5-hermes/tests/test_life_proactive_loop.py`: **19 OK**
- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests`: **196 OK**
- `python3 -m py_compile`（Life Pilot / Obsidian inbox / scheduler / UI relay）: OK
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `deploy-private-pi5-hermes.sh --syntax-check`: OK
- `git diff --check`: OK
- Obsidian 新着 Markdown / 画像添付 / sensitive line 非表示を追加検証

### Local（D13 · Discord shared inbox · `f782f59d`）

- CI [27063786601](https://github.com/denkoushi/RaspberryPiSystem_002/actions/runs/27063786601): **success**（`headSha=f782f59d`）
- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests`: **203+ OK**（branch 累積）
- focused: `test_discord_task_bridge_plugin_register.py`（embed / attachment / `media_urls` / blank share）· `test_life_discord_ui_relay.py`（sidecar 添付）· `test_life_proactive_loop.py`（`共有メモ新着:`）
- `validate_boundary_policy.py --validate-life-pilot`: OK · `deploy-private-pi5-hermes.sh --syntax-check`: OK

**D13 修正チェーン（再開用 · 古い順）**:

| commit | 内容 |
|--------|------|
| `0c7497e1` | D13 初期: Discord shared inbox |
| `a595546e` | embed-only Android 共有 |
| `e134558e` | 添付を Life inbox へ（sidecar + プレースホルダ） |
| `e4719a9a` | 実 Discord 共有への ack 改善 |
| `2b30fc6b` | 空白 Discord 共有 |
| `d5448a2a` | nested metadata 共有 |
| `f782f59d` | **`media_urls` を添付として捕捉**（画像-only が vision に流れる問題の主修正） |

### 私用 Pi5 deploy（D12 · `539f007f`）

初回 `failed=1`（`checkins.jsonl` PermissionError）→ `chown -R hermes:hermes /home/hermes/.hermes-life` 後 **ok=177 failed=0**。Obsidian vault E2E・朝 `Obsidian新着:` 確認済み。

### 私用 Pi5 deploy（D13 · `f782f59d` · 2026-06-06）

```
PLAY RECAP: ok=177 changed=4 failed=0
life_discord_inbox_enabled=True
```

**Deploy 後の必須再起動**（plugin 配置だけでは sidecar が古い Python を保持し得る）:

```bash
sudo systemctl restart hermes-life-discord-ui.service
sudo systemctl restart hermes-gateway
```

**配置確認**:

```bash
grep -R "media_urls" -n /home/hermes/.hermes/plugins/private-pi5-discord-task-bridge
grep -R "GATEWAY_EMPTY_MESSAGE_TEXT" -n /home/hermes/.hermes/plugins/private-pi5-discord-task-bridge
```

**エージェント検証（Pi5 · plugin 直呼び · 再起動後）**: URL / embed-only / 添付プレースホルダ / sidecar 添付 → ack + `discord.jsonl` 追記 + 朝 `共有メモ新着:` 再送は OK。

**未完了の実機 E2E（ユーザー操作）**: Deploy 再起動後、Android から **画像-only / スクショ-only** を Hermes DM へ送り、以下を確認すること。

1. 短い `受け取り箱に保存しました。` のみ（長時間 typing なし）
2. `discord.jsonl` 新行の `attachments` に `img_*.png` 等（`media_urls` 由来）
3. `journalctl -u hermes-gateway` に `vision_analyze_tool` が出ないこと

```bash
tail -n 30 /home/hermes/.hermes-life/inbox/discord.jsonl
sudo journalctl -u hermes-gateway -n 180 --no-pager
sudo journalctl -u hermes-life-discord-ui.service -n 180 --no-pager
```

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
| Obsidian新着が出ない | Pi5 側に `HermesLife` が同期されていない、または mtime が7日より古い | Syncthing の folder path を `/home/hermes/.hermes-life/obsidian/HermesLife` にし、Pi5 側を receive-only にする |
| 画像の中身が読まれない | D12 は画像/OCR未接続 | まずはファイル名と存在だけ。OCR/画像認識は別フェーズ |
| Discord 共有が保存されない | URL/添付/prefix のない通常会話、または inbox disabled | X/URL を共有する、または `共有:` / `メモ:` prefix を付ける。専用チャンネル運用なら channel ID を fragment に入れる |
| URL を送ると通常チャット応答にならない | D13 は URL を「共有メモ」として capture して Hermes 本体へ渡さない | リンク相談ではなく、後で見る inbox 用の経路。通常相談は URL なしで送る |
| 画像共有後に長時間 typing / `vision_analyze_tool` | gateway が `MessageEvent.media_urls` を inbox 添付として扱わず、通常チャット+画像解析へ流した（`d5448a2a` 以前） | **`f782f59d` deploy + 両サービス再起動**。ログに `vision_tools.py` / `vision_analyze_tool` が出たら旧経路。`media_urls` grep で配置確認 |
| Deploy 後も画像共有が inbox に入らない | `hermes-life-discord-ui` が再起動されず古いモジュールを保持 | deploy 後に `restart hermes-life-discord-ui` と `restart hermes-gateway` をセットで実施 |
| Android Syncthing が Pi5 disconnected | UFW が Tailscale 経由 22000 を拒否 | `ufw allow in on tailscale0 to any port 22000 proto tcp`。Android Addresses に `tcp://<Pi5 Tailscale IP>:22000` |
| X URL 共有は OK だが画像-only が未保存 | `media_urls` 未対応版 | `f782f59d` 以降を確認。`attachments` に `img_*.png` が入るか実機確認 |

## Open Items

1. **D13 画像-only / スクショ-only 実機 E2E** — `f782f59d` deploy+再起動後。`media_urls` → `discord.jsonl.attachments` · 長時間 typing なし · `vision_analyze_tool` なし
2. **D12 Obsidian Syncthing 運用は任意化** — 手数が重い場合は Discord shared inbox を主経路にする（D13 が主経路候補）
3. **follow-up 自由入力 modal の目視 E2E** — button `やる` は確認済み。同一 check-in が `answered` 後は再試行不可のため別セッションで確認
4. **retention / export / delete** — `~/.hermes-life` の保持・削除ポリシー未設計
5. **Codex/Cursor worker** — 1 task = 1 worktree/branch · 別 HOME/token · 承認境界（D6+、Life Pilot から直接解放しない）
6. **LLM ベース推薦** — 現状は deterministic suggestion のみ
7. **数日運用の体感評価** — proactive 朝晩・reminder/follow-up 通知の頻度/文言調整

## References

- コード: `scripts/private-pi5-hermes/lib/` · `infrastructure/ansible/tasks/private-pi5-hermes/`
- 北極星: [butler vision](../plans/private-pi5-hermes-butler-vision-and-roadmap.md)
- 索引: [docs/INDEX.md](../INDEX.md) · [knowledge-base/index.md](./index.md)
