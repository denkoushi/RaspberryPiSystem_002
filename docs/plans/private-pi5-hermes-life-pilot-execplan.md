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
/remind <when and reminder>
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
- reminder request の記録と、日時を読めた reminder の Discord 通知
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
- `discord_life_pilot_bridge.py`: memo/reminder 保存、日時解析、digest/recommend
- `life_reminder_scheduler.py`: due reminder を Discord へ送信し `status=notified` に更新
- `life_proactive_loop.py`: 朝晩の proactive check-in 送信、ボタン/番号/自由入力返信の保存
- `life_discord_ui_relay.py`: Discord button と自由入力 modal を Life Pilot 返信として処理
- `life_discord_inbox.py`: Android 共有メニュー等から Discord に届いたリンク/添付名を Life Pilot inbox として保存
- `discord_task_bridge_plugin.py`: `life-pilot.policy.yaml` 配備時のみ `/memo` `/digest` `/remind` `/recommend` 登録、Life Pilot 単体でも送信先 context を取得
- `discord_command_sync.py` / `sync-discord-commands.py`: Discord global slash を `present`/`absent` 管理
- Ansible: policy/module 配備、`~/.hermes-life` 作成、`hermes-life-reminder.timer` / proactive timers / button relay 配備、smoke verify

## D7-life reminder scheduler（2026-06-06 · repo）

`/remind` は common Japanese/ISO forms を deterministic に読む。対応範囲は `今日` `明日` `明後日` `来週月曜日`、`YYYY-MM-DD HH:MM`、`M/D HH:MM`、`朝` `昼` `夕方` `夜` など。時刻がない日付は 09:00、`朝` は 08:00。

保存する JSONL は後方互換のまま、日時を読めた行だけ `dueAt`、Discord 送信先を取れた行だけ `notifyChannelId` を追加する。timer は `dueAt <= now` かつ `status=pending` かつ `notifyChannelId` ありの行だけ送信し、成功後に `status=notified` と `notifiedAt` を書く。日時を読めない行は `pending without time` として digest/recommend に残す。

`/digest` は scheduled reminders と pending without time を分けて表示する。`/recommend` は期限到来、次の予定、日時未指定 reminder、最新memoの順に小さな次アクションを出す。

`hermes-life-reminder.timer` は Life Pilot 有効、Discord token 設定済み、`private_pi5_hermes_life_reminder_scheduler_enabled` 未無効化のときだけ active。既定は 1 分間隔。journal には件数 JSON のみを出し、個人メモ本文や token は出さない。

## D8-life proactive loop（2026-06-06 · repo）

AI執事らしさを出すため、ユーザーの slash 入力待ちだけでなく Hermes 側から朝晩に Discord へ問いかける。

初期実装は slash command で確実に動く **`/life-reply 1` などの番号返信 + `/life-reply <文章>` の自由入力** とした。朝/夜 check-in は `hermes-life-proactive-morning.timer` と `hermes-life-proactive-evening.timer` で送信する。返信は直近の未回答 check-in に紐づけ、`proactive/replies.jsonl` と通常 memo へ保存する。

既定時刻は朝 07:30、夜 21:30。固定 channel は `private_pi5_hermes_life_proactive_channel_id` で指定できる。未指定時は Life Pilot slash command で保存した最新 channel context、または日時つき reminder の `notifyChannelId` を使う。

安全境界は D6/D7 と同じで、返信保存とローカル Life Pilot 記録だけを行う。Codex/Cursor worker、terminal、git、deploy、外部Web、Home Assistant 操作は引き続き保留。

## D9-life Discord button UI（2026-06-06 · repo）

`/life-reply` は長くて日常利用に向かないため、proactive check-in の Discord message に native button を付ける。表示は `[1] まず1つやる` などのテキスト fallback を残しつつ、通常操作は **button click** と **自由入力 modal** を正本にする。

button relay は `hermes-life-discord-ui.service` として Hermes agent の venv で動かす。Hermes 本体の plugin hook は component interaction を受け取れないため、Discord interaction だけを見る小さな sidecar に分離する。`custom_id` は `life:reply:<checkin_id>:<option>` と `life:free:<checkin_id>` に限定し、対象 check-in を明示して誤返信を避ける。

許可する処理は `resolve_proactive_reply()` 経由の Life Pilot 返信保存だけ。通常メッセージの `1` は Hermes 本体の pre-dispatch 条件に依存するため補助扱い、`/life-reply` は button が出ない場合の fallback とする。

## D10-life follow-up loop（2026-06-06 · repo）

D10 は「button を押して終わり」ではなく、Hermes が生活上の候補を1つだけ前面に出し、必要なら後で1回だけ聞き直す最小実装。

朝 check-in は pending reminder と最近の memo から deterministic に1件を選び、`今日まず見るなら:` として表示する。候補の優先順は「今日までの日時つき reminder」「日時なし reminder」「次の日時つき reminder」「最近の memo」。button label は `これをやる` / `夕方にもう一度` / `今日は外す` + `自由入力`。

朝の `夕方にもう一度` は `proactive/followups.jsonl` に `status=pending` の follow-up を保存する。既定 due は当日 17:00、すでに過ぎていれば現在時刻 +2時間。`hermes-life-followup.timer` は既定 5分間隔で `life_proactive_loop.py --mode followup` を起動し、due follow-up だけを Discord に1回送る。送信後は follow-up を `status=sent` にし、通常の pending check-in として `proactive/checkins.jsonl` に `mode=followup` を追加するため、button/modal 返信は従来どおり `resolve_proactive_reply()` で処理される。

follow-up message は `今ならこれだけ見ますか:` と候補1件だけを表示し、button label は `やる` / `明日に回す` / `外す` + `自由入力`。夜 check-in は当日の候補が残っていれば `朝に見ていたもの:` を表示し、button label は `終わった` / `明日に回す` / `メモだけ残す`。

保存先:

```text
/home/hermes/.hermes-life/
  proactive/checkins.jsonl
  proactive/replies.jsonl
  proactive/followups.jsonl
```

D10 では reminder 本体の `status` / `dueAt` は変更しない。返信と follow-up の状態だけを Life Pilot private log に残す。Codex/Cursor worker、terminal、git、deploy、外部Web、Home Assistant 操作は引き続き未接続。

## D11-life context briefing（2026-06-06 · repo）

D11 は「覚えて気を利かせる」方向の最小実装。外部連携や強い権限は増やさず、Life Pilot の既存 private log だけを見る。

朝 check-in に `今日の見方:` を追加する。最近3日程度の memo に疲れ・眠い・しんどい等の低エネルギー signal があれば、`今日は軽く1つだけ見ます` のように聞き方を弱める。今日までの reminder と日時なし reminder が多い場合は、`責めずに1つだけ見ます` として未処理の多さを責めない文言にする。

前日など直近3日で `selectedOption=2` になった check-in に `candidateText` が残っていれば、今日の候補として `carried_forward` を優先する。ただし今日までの日時つき reminder がある場合はそちらを優先する。

送信した morning check-in には `briefing` と `contextHints` を保存する。これは後で「なぜその聞き方をしたか」を見返すための軽い記録であり、reminder 本体や外部システムは変更しない。

## D12-life Obsidian inbox（2026-06-06 · repo）

D12 は、手入力を減らすための入力源として Obsidian vault を追加する。Android 側の `Documents/Obsidian/HermesLife` は Syncthing-Fork で Pi5 側の `/home/hermes/.hermes-life/obsidian/HermesLife` へ同期する。

Hermes は Pi5 側のローカルコピーを読むだけ。Obsidian vault への書込・削除、Syncthing 操作、スマホ内の他フォルダ読取、OCR/画像認識は行わない。`.obsidian` / Syncthing 内部フォルダ / symlink は読まない。

朝 check-in に `Obsidian新着:` を追加し、最近7日の Markdown snippet と画像/PDF の存在だけを表示する。候補優先順は、今日までの日時つき reminder → carried_forward → Obsidian 新着 → 日時なし reminder → 次の日時つき reminder → 最近の memo。Obsidian 新着に低エネルギー signal があれば D11 briefing に反映する。

送信した morning check-in の `contextHints` には `obsidianItems` / `obsidianAttachments` を加える。本文詳細は check-in JSON に増やさない。

## D13-life Discord shared inbox（2026-06-06 · repo）

D13 は、Obsidian/Syncthing が日常入力として重い場合の主経路として、Android 標準の共有メニューから Discord に送ったリンクや添付を Life Pilot の入力にする。

Discord 通常メッセージのうち、URL・添付・Discord embed・添付プレースホルダ・`共有:` / `メモ:` / `inbox:` / `memo:` prefix のあるものだけを `inbox/discord.jsonl` に保存する。保存後は短く `受け取り箱に保存しました。` と返し、通常の Hermes chat には渡さない。`hermes-life-discord-ui.service` も添付/画像共有を拾う保険として動く。`private_pi5_hermes_life_discord_inbox_capture_all` は既定 false。

Hermes は URL を開かず、添付もダウンロードしない。X/URL はリンクと短い本文、画像/PDF等はファイル名だけを `untrusted` 入力として保存する。画像解析やOCRは行わない。秘密らしい本文は redacted とする。朝 check-in は `共有メモ新着:` を表示し、候補優先順は、今日までの日時つき reminder → carried_forward → Discord 共有メモ → Obsidian 新着 → 日時なし reminder → 次の日時つき reminder → 最近の memo。

## 検証（2026-06-06 · local）

- `python3 -m unittest ...` focused: **39 OK**
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `validate_boundary_policy.py --validate-daily-pilot --validate-life-pilot`: OK
- `python3 -m compileall`: OK
- `git diff --check`: OK
- `ansible-playbook --syntax-check`: OK（`ANSIBLE_LOCAL_TEMP=/private/tmp/ansible-local` を指定）

2026-06-06 D7-life reminder scheduler 追加後:

- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests`: **170 OK**
- `python3 -m py_compile`（Life Pilot / scheduler / plugin / command sync）: OK
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `deploy-private-pi5-hermes.sh --syntax-check`: OK

2026-06-06 D8-life proactive loop 追加後:

- `python3 -m unittest`（Life Pilot proactive / bridge / plugin register focused）: OK
- `python3 -m py_compile`（`life_proactive_loop.py` / plugin）: OK

2026-06-06 D9-life Discord button UI 追加後:

- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests`: **184 OK**
- `python3 -m py_compile`（`life_discord_ui_relay.py` / proactive / scheduler）: OK
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `deploy-private-pi5-hermes.sh --syntax-check`: OK

2026-06-06 D10-life follow-up loop 追加後:

- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests`: **190 OK**
- `python3 -m py_compile`（`life_proactive_loop.py` / `life_discord_ui_relay.py` / `life_reminder_scheduler.py`）: OK
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `deploy-private-pi5-hermes.sh --syntax-check`: OK
- `git diff --check`: OK

2026-06-06 D10-life follow-up loop 実機E2E: branch deploy + Discord E2E 完了。詳細は [KB Life Pilot](../knowledge-base/KB-private-pi5-hermes-life-pilot.md)。

2026-06-06 D11-life context briefing 追加後:

- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests`: **193 OK**
- `python3 -m py_compile`（`life_proactive_loop.py` / `life_discord_ui_relay.py` / `life_reminder_scheduler.py`）: OK
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `deploy-private-pi5-hermes.sh --syntax-check`: OK
- `git diff --check`: OK

2026-06-06 D11-life context briefing 実機E2E: branch deploy + Discord E2E 完了。初回 deploy は `.hermes-life` 配下の root ownership により smoke が `PermissionError` で失敗したが、`chown -R hermes:hermes /home/hermes/.hermes-life` 後の再 deploy は `PLAY RECAP failed=0`。詳細は [KB Life Pilot](../knowledge-base/KB-private-pi5-hermes-life-pilot.md)。

2026-06-06 D12-life Obsidian inbox 追加後:

- `python3 -m unittest scripts/private-pi5-hermes/tests/test_life_proactive_loop.py`: **19 OK**
- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests`: **196 OK**
- `python3 -m py_compile`（Life Pilot / Obsidian inbox / scheduler / UI relay）: OK
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `deploy-private-pi5-hermes.sh --syntax-check`: OK
- `git diff --check`: OK
- Obsidian Markdown / 画像添付 / sensitive line 非表示の focused test を追加

2026-06-06 D13-life Discord shared inbox 追加後:

- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests -p 'test_discord_task_bridge_plugin_register.py'`: **15 OK**
- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests -p 'test_life_proactive_loop.py'`: **20 OK**
- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests -p 'test_life_discord_ui_relay.py'`: **4 OK**
- `python3 -m unittest discover -s scripts/private-pi5-hermes/tests`: **203 OK**
- `python3 -m py_compile`（Life Pilot / Discord inbox / proactive / scheduler / UI relay）: OK
- `validate_boundary_policy.py --validate-life-pilot`: OK
- `deploy-private-pi5-hermes.sh --syntax-check`: OK
- `git diff --check`: OK

## 私用 Pi5 実機検証（2026-06-06 完了）

- `hermes-gateway`: active / running
- plugin commands: `daily,memo,digest,remind,recommend,novel,task,task-approve,task-deny`
- Discord global slash: `/daily` `/memo` `/digest` `/remind` `/recommend` all match
- `/memo` safe life note → **Memo Saved**
- `/digest` → **Life Digest**
- `/remind` safe reminder → **Reminder Recorded**
- `/memo git pushしてdeployして` → **memo rejected**

個人メモ本文はこの計画書に残さない。

## D7-life reminder scheduler 実機通知E2E（2026-06-06 完了）

PR #405 反映後の標準 deploy は `PLAY RECAP failed=0`。Discord で日時つき `/remind` が `notification=scheduled` になり、指定時刻に `hermes-life-reminder.timer` 経由の通知が届くことを確認済み。

詳細記録は [private-pi5-hermes-deploy.md](../runbooks/private-pi5-hermes-deploy.md) に置く。

## 有効化

inventory fragment（非コミット）:

```yaml
private_pi5_hermes_gateway_enabled: true
private_pi5_hermes_life_pilot_enabled: true
```

Discord global slash command を同期するには `private_pi5_hermes_discord_bot_token` が必要。

## 未完了

- export/delete/retention の運用設計
- 通知済み reminder の一覧/削除 UX
- follow-up 自由入力 modal の追加目視E2E（button `やる` は確認済み）
- select UI の採用可否判断（button は採用済み）

## 次の判断

D6-life を Pi5 に入れて数日使い、以下を見る。

- メモが自然に残せるか
- digest/recommend が役に立つか
- 自動通知が想定チャンネルへ届くか
- 朝晩の問いかけに自然に返信できるか
- 保存・削除・見返しの運用が明確か

ここで体感を得てから、D6 memory/retention、通知済み reminder UX、D6+ Codex/Cursor worker 境界へ進む。
