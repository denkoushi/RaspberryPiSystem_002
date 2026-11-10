---
title: Pi4 キオスクの予備機差し替え手順
tags: [operations, recovery, Raspberry Pi 4, kiosk, M6]
audience: [operators, recovery operators]
last-verified: 2026-11-02
related: [./pi4-sd-card-backup.md, ../guides/deployment.md, ../plans/security-client-key-rotation-phase-b.md, ../plans/fleet-100-scale-gap-execplan.md]
category: runbooks
update-frequency: medium
---

# Pi4 キオスクの予備機差し替え手順

目標は、故障端末を予備へ替えて確認を終えるまで30分以内。以下の時間は作業枠の目安で、実測値ではない。超過したら原因と実際の時間を残す。共通 OS イメージはまだ使わない。
根拠: [fleet-100-scale-gap-execplan.md「5番 端末の使い捨て化」](../plans/fleet-100-scale-gap-execplan.md#5番-端末の使い捨て化照合項目2)。

## 先に守ること

旧カード・旧端末を、交換先と同じ識別で二度と動かさない。復元すると、アドレス、SSH 鍵、Tailscale ノード、client key も戻る。古いカードは破棄するか、使用禁止と明記して隔離する。別の稼働端末へ写しを流用しない。
根拠: [pi4-sd-card-backup.md:45–55](./pi4-sd-card-backup.md#L45)、[ADR-20260930-pi4-sd-card-backup.md:30](../decisions/ADR-20260930-pi4-sd-card-backup.md#L30)。

旧カードを回収できない、故障箇所が不明、旧機が戻る可能性がある場合は C とする。client key の交換だけでは、Tailscale や SSH の識別は変わらない。旧機を止めたことと、旧識別を使えなくしたことを別々に確認する。
根拠: [pi4-sd-card-backup.md:55](./pi4-sd-card-backup.md#L55)、[security-client-key-rotation-phase-b.md:119–125](../plans/security-client-key-rotation-phase-b.md#L119)。隔離を保証できない場合の作業は「足りないもの」を参照。

## 前もって用意するもの

- 予備の Pi4 を数台と、交換用 SD カードを用意する。カードは旧カードと同容量が安全。Pi5 の USB カードリーダーか、SSD 起動の Pi5 の空き SD スロットを使う。根拠: [fleet-100-scale-gap-execplan.md「5番 端末の使い捨て化」](../plans/fleet-100-scale-gap-execplan.md#5番-端末の使い捨て化照合項目2)、[pi4-sd-card-backup.md:43](./pi4-sd-card-backup.md#L43)。
- 予備機・空カード・使用禁止カードを分け、ラベルを用意する。予備の保管場所と担当者を事前に決め、下欄へ記入する。保管場所の既定はない。根拠: [pi4-sd-card-backup.md:45,60](./pi4-sd-card-backup.md#L45)、[fleet-100-scale-gap-execplan.md「5番 端末の使い捨て化」](../plans/fleet-100-scale-gap-execplan.md#5番-端末の使い捨て化照合項目2)。
- Pi5 SSD に対象ホストの最新の週次バックアップがあることを確認する。週次タイマーは導入だけでは有効にならない。バックアップ対象外の端末もある。確認・有効化は既存手順に従う。根拠: [pi4-sd-card-backup.md:24–39](./pi4-sd-card-backup.md#L24)。
- 対象の inventory ホスト名、設置場所、status-agent の clientId、接続先を控える。ホスト名と clientId は別の値。接続先はネットワーク設定から解決する。例は `raspi4-kensaku-02` と `raspi4-kensaku-02-kiosk1`。秘密値は記録しない。根拠: [infrastructure/ansible/inventory.yml:482–492](../../infrastructure/ansible/inventory.yml#L482)、[同:320–329](../../infrastructure/ansible/inventory.yml#L320)。
- C 用の鍵交換は管理者が準備する。対象 UUID、配布する新しい鍵、承認済みの release と成果物を揃える。鍵の値を現場の記録へ書かない。DB 交換前に1台分の配布が開始できることを確認する。根拠: [security-client-key-rotation-phase-b.md:99–110,143–158](../plans/security-client-key-rotation-phase-b.md#L99)。

```text
予備 Pi4 の保管場所：
空 SD カード・カードリーダーの保管場所：
使用禁止品の隔離場所：
現場担当者／Pi5・Tailscale 管理者：
対象ホスト名／status_agent_client_id／設置場所：
最新バックアップ日時：
```

## A: SD カードだけが故障した

同じ Pi4 本体を使う。目安は合計30分。旧カードを隔離できなければ C へ進む。
根拠: [pi4-sd-card-backup.md:41–56](./pi4-sd-card-backup.md#L41)。

1. **停止・隔離（3分）**。電源を切り、旧カードを外す。使用禁止ラベルを付ける。開始時刻と対象ホストを記録する。根拠: [pi4-sd-card-backup.md:45,60](./pi4-sd-card-backup.md#L45)。
2. **書き込み先の確認（2分）**。空の予備カードを Pi5 に挿す。容量と接続方式でディスクを確認する。下は既存例。例のデバイス名をそのまま使わない。自動マウントされていたら、既存手順のアンマウントを行う。根拠: [pi4-sd-card-backup.md:43–48](./pi4-sd-card-backup.md#L43)。

   ```bash
   lsblk -d -o NAME,SIZE,TRAN,RM,MODEL
   ```

3. **最新の写しを復元（10分）**。Pi5 で次の既存例を使う。2か所のホスト名を対象と一致させ、デバイス名を確認済みのカードへ置き換える。書き込み先の全データが消える。`restore_done` を確認する。`refused` なら理由を確認して止める。根拠: [pi4-sd-card-backup.md:50–54](./pi4-sd-card-backup.md#L50)。

   ```bash
   sudo sh -c 'set -a; . /etc/raspi-pi4-sd-backup/backup.env; cd /opt/raspi-pi4-sd-backup; python3 -m pi4_sd_backup.runner restore --host raspi4-kensaku-02 --device /dev/sdb --confirm-host raspi4-kensaku-02'
   ```

   Pi5 の写しが失われた場合だけ、参照元の Google Drive 復元へ切り替える。遅いため30分枠は保証できない。
4. **同じ本体へ戻す（3分）**。復元したカードを元の Pi4 へ挿し、起動する。旧カードは隔離したままにする。根拠: [pi4-sd-card-backup.md:45,55](./pi4-sd-card-backup.md#L55)。
5. **更新・成功確認（12分）**。後述の「共通の成功確認」を行い、終了時刻を記録する。根拠: [pi4-sd-card-backup.md:56–60](./pi4-sd-card-backup.md#L56)。

## B: 本体だけが故障し、カードは正常

カードを複製せず、予備の Pi4 へ移す。目安は合計30分。本体交換専用の検証済み手順はない。以下はカードを1枚だけ使う手動作業とする。
根拠: [ADR-20260930-pi4-sd-card-backup.md:30](../decisions/ADR-20260930-pi4-sd-card-backup.md#L30)、[pi4-sd-card-backup.md:55,60](./pi4-sd-card-backup.md#L55)。

1. **停止・回収（3分）**。旧本体の電源を外す。正常なカードを抜く。旧本体には使用禁止ラベルを付ける。開始時刻と対象ホストを記録する。根拠: [pi4-sd-card-backup.md:45,60](./pi4-sd-card-backup.md#L45)。
2. **カードと機器を移す（5分）**。同じカードを予備本体へ挿す。画面、NFC リーダー等の機器を移す。接続は手動。Bluetooth のトルクレンチ等は自動化の対象外。根拠: [pi4-sd-card-backup.md:55,60](./pi4-sd-card-backup.md#L55)、[fleet-100-scale-gap-execplan.md「5番 端末の使い捨て化」](../plans/fleet-100-scale-gap-execplan.md#5番-端末の使い捨て化照合項目2)。
3. **起動・識別確認（5分）**。予備本体を起動する。カード上の既存の識別で戻ることを確認する。旧本体を同じ識別のカードで再起動しない。カードも疑わしければ C へ切り替える。根拠: [pi4-sd-card-backup.md:45–55](./pi4-sd-card-backup.md#L45)。
4. **更新・成功確認（17分）**。「共通の成功確認」を行う。本体交換で変わった接続や周辺機器の問題も記録する。根拠: [pi4-sd-card-backup.md:56–60](./pi4-sd-card-backup.md#L56)。

## C: 両方が故障・不明、または旧機が戻る可能性がある

予備カードと予備本体を使う。目標は30分。鍵の配布準備と Tailscale の安全な切り替えが済まなければ、この枠には収まらない。旧機を回収・隔離できない場合、以下だけで安全な交換は完了できない。
根拠: [pi4-sd-card-backup.md:45–55](./pi4-sd-card-backup.md#L45)、[security-client-key-rotation-phase-b.md:104–110](../plans/security-client-key-rotation-phase-b.md#L104)。

1. **旧機を隔離（3分）**。旧機の電源とネットワークを外し、旧カードを使用禁止にする。回収不能なら、その事実を管理者へ伝える。隔離を保証できるまで、同じ識別を持つ復元先をネットワークへつながない。根拠: [ADR-20260930-pi4-sd-card-backup.md:30](../decisions/ADR-20260930-pi4-sd-card-backup.md#L30)。
2. **予備カードへ復元（12分）**。A の手順2・3を実施する。予備本体へ挿す。まだ旧識別のままである。根拠: [pi4-sd-card-backup.md:43–55](./pi4-sd-card-backup.md#L43)。
3. **Tailscale の旧ノードを扱う（手動、3分枠）**。管理者へ旧ノードの失効・削除と、交換先を新しいノードとして登録する作業を依頼する。復元先も旧 Tailscale 状態を持つため、旧ノードだけを消せば完了とはしない。この切り離しの具体手順は未文書化。保証できなければここで止め、隔離を保つ。既存の再認証例は下記だが、旧ノードの再参加を防ぐ手順ではない。根拠: [pi4-sd-card-backup.md:55](./pi4-sd-card-backup.md#L55)、[security.md:1005–1018](../knowledge-base/infrastructure/security.md#L1005)、[tailscale-policy.md:13–21](../security/tailscale-policy.md#L13)。

   ```bash
   sudo tailscale up --advertise-tags=tag:kiosk
   ```

   新ノードの接続先は管理者が inventory のネットワーク設定と照合する。名前だけで同一ノードと判断しない。接続先設定の既存注記: [infrastructure/ansible/inventory.yml:320–329](../../infrastructure/ansible/inventory.yml#L320)。SSH の旧識別も残るため「足りないもの」を参照。
4. **Pi5 で client key を交換（準備済みで3分枠）**。旧機の隔離と新ノードの到達を確認してから、管理者が実施する。新しい値は既存の鍵管理・レビュー・CI・配布の手順で用意する。DB バックアップを取る。旧値と新値を表示せず環境変数へ渡す。Pi5 で既存スクリプトのヘッダーに従い dry-run の件数を確認し、本実行する。対象はホスト名や clientId ではなく `ClientDevice` の UUID。DB が先、対象1台の標準更新が後。根拠: [rotate-client-key.sh:2–12](../../scripts/security/rotate-client-key.sh#L2)、[security-client-key-rotation-phase-b.md:99–110,143–158](../plans/security-client-key-rotation-phase-b.md#L99)。Phase A の調査だけでは鍵は変わらない: [phase-a.md:98–104](../plans/security-client-key-rotation-phase-a.md#L98)。
5. **新しい鍵を配布・確認（9分枠）**。「共通の成功確認」を行う。旧キーの kiosk API 要求が HTTP 401、新キーで通常操作が成功、管理画面の端末行が1件であることを管理者が確認する。値を記録しない。旧機は再起動しない。根拠: [security-client-key-rotation-phase-b.md:154–158](../plans/security-client-key-rotation-phase-b.md#L154)。失敗時に旧鍵へ戻す通常の復旧手順は、旧機の鍵も再び有効にする。隔離を保証できなければ適用せず停止する。通常の復旧手順の参照元: [同:162–164](../plans/security-client-key-rotation-phase-b.md#L162)。

## 共通イメージから新しい端末を用意する(試行前)

この経路は実機未検証。既存カードの復元とは分け、新しい空の端末で試す。旧機の識別や鍵を引き継がない。

1. [共通イメージの README](../../infrastructure/image/rpi-image-gen/README.md) に従い、arm64 ホストで Pi5 の SSH 公開鍵を渡してビルドし、新しい SD へ書き込む。
2. boot パーティション直下の `pi4-bootstrap.json` に hostname と一回限りの Tailscale auth key を入れる。鍵は `tag:kiosk` を許可し、非再利用・短い有効期限にする。Ethernet をつないで起動する（Wi-Fi 設定は対象外）。
3. 入力ファイルの削除、`/var/lib/pi4-first-boot/done`、Tailscale の Running と新しいノードの参加、hostname を確認する。Pi5 から公開鍵 SSH / sudo、Desktop Autologin と labwc の起動を確かめる。鍵の値は記録しない。
4. inventory に対象ホストと `ansible_user: kiosk`、接続先、必要な端末設定を追加する。管理者が既存の安全な手順で認証情報を用意し、Pi5 の Ansible ディレクトリで `REGISTER_CLIENT_HOST=HOST DRY_RUN=1 ../../scripts/register-clients.sh` を確認後、`REGISTER_CLIENT_HOST=HOST ../../scripts/register-clients.sh` で登録する（[初回導入](../guides/deployment.md#空のpi4キオスクへの初回導入)）。
5. 成功済み CI の配布対象を確定し、明示承認された対象1台だけ標準経路で初回導入する。`HOST` は exact ホスト名、`<branch>` は承認済みの配布対象へ置き換え、plan の対象と SHA を照合する。

   ```bash
   scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan --limit HOST --first-install
   scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit HOST --first-install
   ```

status-agent と業務用 unit はこの導入で Ansible が設置する。返された runId の status、recap、health、rollback 結果と、下記「共通の成功確認」の画面・NFC・heartbeat を確認し、実測時間を残す。

## 共通の成功確認

1. **対象1台の標準更新を行う**。管理者が成功済み CI の対象 SHA と成果物を確定する。以下は既存の書式。`PATTERN` は対象の exact ホスト名1つへ、`<branch>` は承認済みの配布対象へ置き換える。plan の対象・SHA・成果物を照合する。C では DB 交換前にも配布可能なことを確認する。鍵を含む Pi4 ファイルが配布対象外なら進めない。根拠: [deployment.md:93–113](../guides/deployment.md#L93)、[security-client-key-rotation-phase-b.md:104–106,131](../plans/security-client-key-rotation-phase-b.md#L104)。

   ```bash
   scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --print-plan --limit PATTERN
   scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit PATTERN --detach
   scripts/update-all-clients.sh --status RUN_ID --inventory infrastructure/ansible/inventory.yml
   ```

   返された runId だけを追う。除外されたホストは成功に数えない。status、recap、health、rollback の結果を確認する。根拠: [deployment.md:60–62,103–113](../guides/deployment.md#L60)。
2. **画面と NFC を確認する**。キオスク画面が表示され、NFC を1回読み取って通常の操作ができることを確認する。根拠: [pi4-sd-card-backup.md:60](./pi4-sd-card-backup.md#L60)。
3. **heartbeat を確認する**。`/admin/clients` で対象 clientId の最終受信時刻が進むことを確認する。C では同じ端末行が維持されていることも確認する。根拠: [pi4-sd-card-backup.md:55](./pi4-sd-card-backup.md#L55)、[security-client-key-rotation-phase-b.md:158](../plans/security-client-key-rotation-phase-b.md#L158)。
4. **終了を記録する**。旧カード・旧機の隔離、終了時刻、実測時間、deploy runId と確認結果を残す。根拠: [pi4-sd-card-backup.md:45,60](./pi4-sd-card-backup.md#L60)、[security-client-key-rotation-phase-b.md:154–158](../plans/security-client-key-rotation-phase-b.md#L154)。

復元した端末は既設扱い。初回導入を使わない。空の新規 Chromium キオスクだけが初回導入の対象。OS Desktop、Docker Compose、SSH/sudo、ネットワーク、登録、Desktop Autologin 等を先に整える。既存の初回登録と導入は [deployment.md:64–89](../guides/deployment.md#L64) に従う。これは共通イメージや自動登録の代わりにはならない。

## 訓練

1. **準備（5分、計測外）**。30分ほど止められるキオスクと予備カードを選ぶ。原本カードは変更せず別に保管する。旧機と交換先を同時に起動しない。根拠: [pi4-sd-card-backup.md:58–60](./pi4-sd-card-backup.md#L58)。
2. **実施（30分目標、ここから計測）**。開始時刻を書き、A・B・C の対象手順を実機で行う。共通の成功確認まで測る。C は鍵交換とノード切り替えの管理者作業も含める。未文書化の手順を推測して試さない。根拠: [pi4-sd-card-backup.md:60](./pi4-sd-card-backup.md#L60)、[fleet-100-scale-gap-execplan.md「5番 端末の使い捨て化」](../plans/fleet-100-scale-gap-execplan.md#5番-端末の使い捨て化照合項目2)。
3. **後片付け（5分目安、別記録）**。A の復元訓練では交換先を停止して原本カードへ戻し、復元カードは消去してから再利用する。消去コマンドは参照元にないため手動作業とする。B はカード1枚だけを扱う。C の鍵交換後は原本カードも旧鍵のままなので、そのまま戻さない。C の訓練後の復帰は未整備事項として記録する。根拠: [pi4-sd-card-backup.md:60](./pi4-sd-card-backup.md#L60)、[security-client-key-rotation-phase-b.md:162–164](../plans/security-client-key-rotation-phase-b.md#L162)。

記録を M6 の実機訓練の証拠として残す。秘密値は書かない。

```text
日付：
ホスト／clientId：
ケース（A / B / C）：
担当者：
開始時刻：
終了時刻：
経過時間（分）／30分以内か：
バックアップ日時／restore run id：
配布 SHA／deploy runId：
画面／NFC／heartbeat／標準更新の結果：
C: 旧鍵拒否／新鍵成功／旧ノード再参加防止の確認：
旧カード・旧本体の隔離場所／処置：
問題・待ち時間・未完了の作業：
後片付けの結果／所要時間：
```

## 足りないもの

- 本体交換専用の検証済み手順と実測がない。30分は目標。バックアップ対象外や最新の写しがない端末は、この復元経路を使えない。[fleet-100-scale-gap-execplan.md「5番 端末の使い捨て化」](../plans/fleet-100-scale-gap-execplan.md#5番-端末の使い捨て化照合項目2)、[pi4-sd-card-backup.md:24](./pi4-sd-card-backup.md#L24)。
- C の旧 Tailscale ノード失効・削除、復元状態の切り離し、新ノードの登録、旧機が再参加できないことの確認をまとめた手順がない。再認証例だけでは満たさない。SSH 鍵も復元される。回収不能な旧機について、同じ識別で動けないことを保証できない間は C を完了扱いにしない。[pi4-sd-card-backup.md:55](./pi4-sd-card-backup.md#L55)、[ADR:30](../decisions/ADR-20260930-pi4-sd-card-backup.md#L30)、[security.md:1005–1018](../knowledge-base/infrastructure/security.md#L1005)。
- 鍵の生成・安全な受け渡し・鍵管理の更新・レビュー・CI は現場だけでは終わらない。C の事前準備と管理者の作業枠が必要。旧鍵を復活させずに失敗から戻す手順と、C の訓練後の復帰手順も必要。[security-client-key-rotation-phase-b.md:143–164](../plans/security-client-key-rotation-phase-b.md#L143)。
- 予備の具体的な保管場所、必要台数、接続機器の現場別一覧は未確定。共通イメージ、初回起動の登録、実機の30分測定は M6 の残りとして扱う。[fleet-100-scale-gap-execplan.md「5番 端末の使い捨て化」](../plans/fleet-100-scale-gap-execplan.md#5番-端末の使い捨て化照合項目2)。
