# 10年安定稼働に向けた「壊れない・古びない」ための計画

この ExecPlan は生きた文書である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は作業の進行に合わせて更新する。書き方は `.agent/PLANS.md` に従う。

## Purpose / Big Picture

このシステム（Pi5 サーバー1台、Pi4 キオスク8台、Pi3 サイネージ1台、Mac の外部見張り）を、これから10年、止めずに使い続けるための「予防」の計画である。

すでに `docs/plans/fleet-100-scale-gap-execplan.md`（以下「100台計画」）が、壊れたときに早く戻す仕組み（復旧訓練、予備の Pi5 と DB の複製、外からの見張り、端末側の送信待ち、段階的な更新、共通イメージと予備機の差し替え、ログの上限）を扱っている。この計画はそれと重ねず、次の6つの「時間がたつと必ず起きること」を先回りして防ぐ側を扱う。

1. ソフトウェアの保守期限切れと、更新の習慣
2. 機械（Pi、SD カード、読み取り機）の寿命と調達
3. データが増え続けること
4. 期限のあるもの（証明書、鍵、トークン、契約）
5. 端末100台になったときの性能の余裕
6. 担当者が替わっても回せること

この計画が終わると、利用者（運用担当）は次のことができるようになる。年に1回、決まった台帳を開くだけで「今年中に期限が来るもの」「寿命が近い機械」「容量の見込み」が分かる。期限の30日前には通知が来る。担当が替わっても、入口の1枚から必要な手順書へたどれる。

この文書は調査と方針の正本である。各項目の実装は、それぞれ別の小さな PR で行う。

## 用語

- EOL（保守期限切れ）: 作った側がセキュリティ修正を出さなくなる日。これを過ぎた部品は、穴が見つかっても直らない。
- 期限台帳: 期限のあるもの（証明書、鍵、契約、ソフトの EOL、機械の生産終了）を1か所に並べた表。この計画で新しく作る。
- 要実測: リポジトリと公開情報からは分からず、本番機で読み取り専用のコマンドを打って初めて分かること。この計画を書いた時点では本番機に触れていないので、まとめてユーザーの許可を得てから測る（後述の「要実測の一覧」）。
- 持ち主: その作業を誰がするか。「ユーザー」は人の判断・契約・購入・現場作業、「Claude/Codex」はリポジトリの変更と読み取り専用の確認。
- 書き込み量（TBW）: SD カードや SSD に書いた累計量。寿命の目安に使われるが、この現場では当てにならないことが分かっている（後述）。

## Progress

- [x] (2026-11-15) リポジトリと公開情報で6観点の現状を調べ、根拠の行を確かめた。
- [x] (2026-11-15) 公式の EOL と生産終了の日付を一次情報で確かめた。
- [x] (2026-11-15) この ExecPlan の初版を書き、`docs/INDEX.md` に登録した。
- [ ] 要実測の一覧をユーザーに見せ、まとめて許可を得て測る。
- [ ] 優先1: 写真の年次削除の不具合を直す（2027-01 より前）。
- [ ] 優先2: 期限台帳と期限前通知を作る。
- [ ] 優先3: データの保持方針と月次の容量記録を作る。
- [ ] 優先4: 機械の台帳と調達計画を作る。
- [ ] 優先5: 100台相当の負荷を隔離環境で測る。
- [ ] 優先6: 人向けの入口文書を作り、古い記述を直す。
- [ ] 年次点検を1回通して回し、この計画の振り返りを書く。

## Surprises & Discoveries

- 写真の年次削除は、意図と逆に「今年の1月の写真」を消す作りになっている。

  `apps/api/src/scripts/cleanup-photos.ts:30-36` は1月にだけ動き、`targetYear = currentYear - 2` を `PhotoStorage.deletePhotosByYear(targetYear)` に渡す。ところが `apps/api/src/lib/photo-storage.ts:160-180` の `deletePhotosByYear(year)` は中で `targetYear = year + 2`、`targetMonth = '01'` にしてから `photos/${targetYear}/01` と `thumbnails/${targetYear}/01` を消す。差し引きすると、2027年1月に動くと 2027/01 を消す。仮に意図どおり動いても、消すのは1か月分だけで1年分ではない。テスト `apps/api/src/lib/__tests__/photo-storage.test.ts:16-17` は `deletePhotosByYear(2024)` が `photos/2026/01` を見ることを期待しており、この挙動をそのまま固めている。

  起動役の `scripts/server/cleanup-photos.sh` には cron の書き方の例（10行目、13行目）があるだけで、Ansible や cron の設定でこれを入れている所はリポジトリに無い。本番の Pi5 に入っているかどうかは要実測。入っていれば、次の 2027-01 に、その月の写真が消える。

- SD カードの書き込み量は故障の予兆にならなかった。

  `docs/knowledge-base/KB-428-sessaku01-sd-card-failure.md` によると、2022-07 製の同型 32GB カードのうち、壊れたものは書き込み 141GB、まだ健全な2枚は 385GB と 408GB だった。書き込み量で交換時期を決める方法は使えない。年数で交換するか、SSD や産業用 SD に替える必要がある。

- Pi3 の型番が分からない。Raspberry Pi 3 Model B の生産保証は 2028-01 まで、3 Model B+ は 2030-01 までで、2年違う（2026-11-15 に公式の生産終了ページで確認）。`docs/runbooks/device-model-roles.md` は「Pi3」とだけ書いている。要実測。

- `README.md:72` は今も古い経路（RealVNC と git pull）で端末を更新する説明になっている。`docs/security/system-inventory.md:107,117` には、もう使っていない Ubuntu の LocalLLM 機が残っている。担当が替わったとき、最初に読む所が古い。

## Decision Log

- Decision: 100台計画が扱う「壊れた後に早く戻す」仕組みはこの計画に書かず、リンクだけにする。
  Rationale: 同じ事実を2か所に書くと片方が古くなる（`.cursor/rules/01-core-docs-and-knowledge.mdc`）。
  Date/Author: 2026-11-15 / Claude

- Decision: 2026-10 に終えた一度きりの EOL 更新（`docs/plans/software-support-upgrade-execplan.md`）は繰り返さず、この計画では「次の期限を毎年見直す習慣」と、そこで対象外にした OS のメジャー更新だけを扱う。
  Rationale: 更新そのものは済んでいる。足りないのは次の期限を誰がいつ見るかという仕組みである。
  Date/Author: 2026-11-15 / Claude

- Decision: 優先順位は「止まる・消えるまでの近さ × 気づかずに起きるか」で決める。写真の削除不具合を最優先にする。
  Rationale: 2027-01 という具体的な日にデータが消える可能性があり、直すのは小さい。
  Date/Author: 2026-11-15 / Claude

- Decision: 本番機での確認はこの計画を書く間に一切していない。要るものは「要実測の一覧」に読み取り専用のコマンドとしてまとめ、まとめて1回許可を得る。
  Rationale: 依頼の制約。何度も許可を求めるとユーザーの手間が増える。
  Date/Author: 2026-11-15 / Claude

- Decision: zero2w-* の試作端末はこの計画の対象から外す。
  Rationale: 本番の端末ではない。
  Date/Author: 2026-11-15 / Claude

## Outcomes & Retrospective

（初版の時点では未記入。優先1〜6のそれぞれが終わるたびに、何ができて何が残ったかを書く。）

## Context and Orientation

### 構成と関係する計画

本番の機械は、Pi5 サーバー1台（API、Web、PostgreSQL、Caddy を Docker で動かす）、Pi4 キオスク8台、Pi3 サイネージ1台である。Mac 1台が外から Pi5 を見張る（`docs/runbooks/mac-pi5-watchdog.md`）。端末の一覧は `infrastructure/ansible/inventory.yml`、機種ごとの役割は `docs/runbooks/device-model-roles.md` にある。

関係する計画は次の2つ。この計画はどちらとも中身を重ねない。

- `docs/plans/fleet-100-scale-gap-execplan.md`: 復旧訓練、予備の Pi5 と DB の複製、外からの見張り、端末側の送信待ち、段階的な更新、共通イメージと予備機の差し替え、ログの上限。
- `docs/plans/software-support-upgrade-execplan.md`: 2026-10 に終えた一度きりの EOL 更新。Node 24、Prisma 7.10.1、Debian trixie のベースイメージ、エージェントの Python 3.13、PostgreSQL 15 から 18.6（2026-10-30、DB は 5.7GB、230行目）、pnpm 12、React 19.3.1、Playwright 1.64.1。OS のメジャー更新は対象外（13行目）。

### 公式の期限（2026-11-15 に一次情報で確認）

- Raspberry Pi の生産保証: Pi5 は 2036-01 まで、Pi4 は 2034-01 まで、Pi3 Model B+ は 2030-01 まで、Pi3 Model B は 2028-01 まで（raspberrypi.com の製品ごとの生産終了の記載）。
- Node.js: 22 は 2027-04-30 まで。24 は 2026-10-20 から保守期に入り 2028-04-30 まで。26 は 2026-10-28 に Active LTS になり 2029-04-30 まで（nodejs.org のリリース表）。
- PostgreSQL 18: 2030-11-14 まで（postgresql.org の versioning ポリシー）。
- Python 3.13: 2029-10 まで（devguide.python.org）。
- Debian 13 trixie: 通常の保守は 2028-08-09 まで、LTS は 2030-06-30 まで。Debian 12 bookworm は通常の保守を 2026-07-11 に終え、LTS は 2028-06-30 まで（debian.org と wiki.debian.org/LTS）。
- Caddy: 保守期限の方針を公表していない。

これらは毎年変わりうるので、期限台帳（優先2）で毎年見直す。

## 6つの観点の現状と足りないもの

### 観点1: ソフトウェアの保守期限と更新の習慣

今あるもの。

- 依存の自動更新: `.github/dependabot.yml` が毎週、npm、GitHub Actions、Docker（`/infrastructure/docker`、node のメジャーと playwright のメジャー・マイナーは除外）、pip（`clients/torque-agent` だけ）の更新 PR を出す。
- OS のセキュリティ更新: `docs/knowledge-base/KB-438-os-security-weekly-update.md` の仕組みで、全機が毎週 trixie-security からセキュリティ修正を当てる（`infrastructure/ansible/group_vars/all.yml:413` の `os_security_update_mode: apply`、KB-438 の31行目）。
- コンテナの土台: `infrastructure/docker/Dockerfile.api:72` は `node:24-trixie-slim` を digest まで固定。`infrastructure/docker/Dockerfile.web:2` は `node:24-alpine` で digest は無い。Caddy は `Dockerfile.web:88` で v2.11.4 に固定。DB は `infrastructure/docker/docker-compose.server.yml:5` で `pgvector/pgvector:pg18`。

足りないもの。

- KB-438 の自動更新は Docker、Tailscale、カーネル、ファームウェアを除外している（KB-438 の34〜37行目）。除外は正しいが、これらを手で上げる時期が決まっていない。Pi の EEPROM（起動用のファームウェア）も同じ。
- Docker Engine と Compose の版は、どこにも固定も記録もされていない。
- ホスト OS のメジャー更新（trixie の次）を扱う計画が無い。trixie の通常保守は 2028-08 で終わる。
- Dependabot の pip は torque-agent だけで、nfc-agent、barcode-agent、haizen-agent、status-agent の Python 依存は見ていない。Renovate も無い。
- Node 24 の期限は 2028-04-30。26 への切り替えはまだ計画に無い。
- 本番のホスト OS が本当に trixie か、Docker と Tailscale とカーネルの版は要実測。

### 観点2: 機械の寿命

今あるもの。

- 機種ごとの役割とメモリの実測: `docs/runbooks/device-model-roles.md`（Pi4 は全体 3.7GB で空き 2.4〜3.0GB、Pi3 は全体 416MB で空き 123MB、スワップ 244MB 使用）。
- SD の摩耗の日次報告: `docs/guides/status-agent.md:113`。ただし INFO 扱いで、通知にはならない。
- 予備機の差し替え手順: `docs/runbooks/pi4-spare-swap.md`。
- SD 故障の記録と、残り2枚を USB SSD の試験と合わせて替える方針: KB-428。

足りないもの。

- 機械ごとの購入日、SD の製造時期、交換予定日をまとめた台帳が無い。
- 書き込み量は予兆にならない（KB-428）。年数での計画交換か、SSD・産業用 SD への切り替えの方針が要る。
- `docs/runbooks/pi4-spare-swap.md:26-36` の予備の保管場所と台数は空欄で、決まっていない。同じ文書の150〜160行目付近の手順に、古い端末の Tailscale ノードを無効にする手順が無い。
- Pi3 の型番が不明（Model B なら 2028-01 で生産終了）。要実測。
- 読み取り機の調達: NFC は Sony RC-S300/S1（`clients/nfc-agent/README.md:3`）、トルクレンチは CEM3-BTLA（`docs/runbooks/assembly-torque-agent.md`）。バーコード読み取り機の型番は記録が無い。どれも生産終了時の代わりが決まっていない。
- 更新中のメモリの使い方は測っていない。Pi3 は余裕が少ない。

予備機と複製サーバーそのものは100台計画の範囲なので、ここでは「台帳」と「いつ買うか」だけを扱う。

### 観点3: データの増え方

今あるもの。

- 端末ログの保持: `apps/api/src/services/clients/client-network-log-retention.ts:3,13` が毎日 03:20 に30日より古いものを消す。ただし対象は network_health、kiosk_net_stats、sessaku-pieces の3種類だけ。
- CSV の取込履歴は月単位、計測器の履歴は年単位で整理する仕組みがある。
- DB のバックアップは30日保持（`scripts/server/backup.sh:27`）。Google Drive への退避は日次7、週次5、月次12（`docs/runbooks/google-drive-disaster-recovery.md:95`）。
- ディスクの警告: Pi5 は 70/80/90% で警告（`docs/runbooks/pi5-local-file-storage.md:41`）。端末側は status-agent が80%で警告（`clients/status-agent/storage_health.py:21`）。過去に Docker の残骸で1日21GB 増えた記録がある（同 runbook の81行目）。
- 写真は `/opt/RaspberryPiSystem_002/storage/photos/YYYY/MM` に置かれる。

足りないもの。

- 上の3種類以外の端末ログ、警告（Alert）、実績工数の生データ（ActualHoursRaw）、各種のイベント記録には保持期限が無い。
- 写真の年次削除は不具合がある（「Surprises & Discoveries」参照）。そもそも写真を何年残すかが決まっていない。
- 上限の無い一覧 API がある。件数が増えると遅くなり、メモリも食う。2026-10-21 の監査で見つかったもの: 実績工数の集計（actual-hours-aggregate の78行目付近）、計測器（`measuring-instruments/index.ts` の294行目付近）、吊具（`rigging/index.ts` の150行目付近）、端末テレメトリ（client-telemetry の363行目付近）、トルク学習の元データ（torque-training-hermes-source の173行目付近）、貸出の分析（loan-analytics の175行目付近）、CSV ダッシュボード（csv-dashboard の326行目付近）、貸出イベント（loan-event の156行目付近）。行番号はその後の変更でずれている可能性があるので、直すときに改めて確かめる。
- 表ごと、フォルダごとの大きさを毎月記録する仕組みが無いので、10年後の容量を見積もれない。表の大きさ、`df -h`、`docker system df`、写真の年ごとの大きさは要実測。

### 観点4: 期限のあるもの

今あるもの。

- HTTPS 証明書: Caddy は自動取得を切り（`infrastructure/docker/Caddyfile.gateway.template:4` の `auto_https off`）、自前の cert.pem を使う。作る手順は `scripts/server/generate-ssl-cert-for-tailscale.sh`（49行目で `-days 3650`、10年の自己署名）。別に、社内 CA の証明書を入れる playbook がある（`infrastructure/ansible/playbooks/activate-pi5-local-ca-certificate.yml`）。56行目で、残りが30日以上あるかを反映のときだけ確かめる。本番でどちらが有効かは要実測。
- Mac の見張りは証明書の SHA-256 を固定している（`docs/runbooks/mac-pi5-watchdog.md:34-40`）。証明書を替えると、見張りの設定も替える必要がある。
- Tailscale: Pi3 が鍵の期限切れで一度止まった（`docs/security/tailscale-policy.md:325`）。人のいない機械は「鍵の期限を切る」方針（同333行目）。本番の各ノードで実際に切ってあるかは、管理画面で確かめる必要がある（要実測）。
- ログインのトークン: アクセストークン15分（`apps/api/src/config/env/core.ts:66`）、更新トークン7日。これは自動で回るので期限切れの心配は無い。
- 端末の鍵の差し替え手順: `scripts/security/rotate-client-key.sh`。
- Dropbox と Gmail の OAuth の更新: `docs/guides/external-integration-ledger.md:96`。

足りないもの。

- 期限を1か所に並べた台帳が無く、期限前の通知も無い。
- 台帳に載っていないもの: GitHub Container Registry（ghcr）から取得するための資格情報、Android の haizen アプリの署名鍵、ドメインや契約の更新日（あれば）。
- 自己署名証明書の終了日が記録されていない。2036年前後に一斉に切れる可能性があり、そのとき見張りの固定値も同時に替える必要がある。

### 観点5: 端末100台での性能の余裕

今あるもの。

- DB 接続の上限は既定で10（`apps/api/src/config/env/core.ts:44`）。
- 1端末あたりの要求の上限は1分120回（`apps/api/src/plugins/rate-limit.ts`）。
- 端末の生存報告は60秒ごと（`clients/status-agent/status-agent.timer:6`）。100台なら毎秒約1.7件。
- Ansible の同時実行数は5（`infrastructure/ansible/ansible.cfg:6`）。
- 応答時間の記録は1件だけ（`docs/knowledge-base/KB-369-leader-order-board-api-internal-latency.md:126`）。

足りないもの。

- 負荷試験の道具（k6、autocannon、artillery など）が無く、100台相当の負荷を一度も測っていない。
- DB 接続10本で、キオスクの画面更新と生存報告と取込処理が重なったときに足りるか分からない。
- 上限の無い一覧 API（観点3）は、件数と端末数の両方で重くなる。

更新の並列化と端末側の送信待ちは100台計画の範囲なので、ここでは「測る」ことだけを扱う。

### 観点6: 担当者が替わっても回せること

今あるもの。

- runbook は35本ある（zero2w を除く）。デプロイの正本は `docs/guides/deployment.md` と `docs/guides/quick-start-deployment.md`。
- AI 向けの入口は `docs/AI_START_HERE.md` と `AGENTS.md`。

足りないもの。

- 人向けの入口が無い。新しい担当者が「まず何を読み、毎週・毎月・毎年何をするか」を1枚で知る文書が無い。
- `README.md:72` が古い更新経路を説明している。`docs/security/system-inventory.md:107,117` に使っていない機械が残っている。
- 契約と管理者の台帳が無い（Tailscale、GitHub、Google、Dropbox、ドメインなど、誰の名義で、いつ更新で、誰が管理者か）。
- Mac の見張りが特定の1台の Mac に依存している（`docs/runbooks/mac-pi5-watchdog.md:9`）。その Mac を替えるときの手順が無い。外からの見張りを増やすこと自体は100台計画の範囲。

## Plan of Work

優先順位は、上から順に「止まる・消えるまでが近く、しかも気づかずに起きる」ものである。各項目は別々の小さな PR にする。

### 優先1: 写真の年次削除の不具合を直す（期限: 2027-01 より前）

持ち主: 修正は Claude/Codex。写真を何年残すかはユーザーが決める。

まず決めること: 本番の Pi5 にこの削除が cron で入っているか（要実測の一覧の項目1）。入っていれば、2027-01 より前に止めるか直す。

やること。`apps/api/src/lib/photo-storage.ts` の `deletePhotosByYear` を「渡された年の全月を消す」に直し、`apps/api/src/scripts/cleanup-photos.ts` の年の計算と矛盾が無いようにする。テスト `apps/api/src/lib/__tests__/photo-storage.test.ts` を「2024を渡すと 2024 の12か月分を見る」に書き直す。保持年数は設定値にし、既定はユーザーの決定に合わせる。cron に入れるなら Ansible で入れて、手で入れたものに頼らない。

### 優先2: 期限台帳と期限前の通知（観点1と4）

持ち主: 台帳と通知は Claude/Codex。見直しの頻度、契約の持ち主はユーザーが決める。

まず決めること: 年次点検をいつ（何月）するか、通知を誰に送るか。

やること。

1. `docs/runbooks/expiry-ledger.md`（新規）に期限台帳を作る。並べるのは、ソフトの EOL（Node、PostgreSQL、Python、Debian、Caddy の版）、機械の生産終了日、証明書の終了日、Tailscale の鍵の期限の設定、OAuth の更新日、ghcr の資格情報、Android の署名鍵、契約の更新日。各行に「次に見る日」「持ち主」「替え方の手順書」を書く。
2. 期限の近いものを機械で確かめられるもの（証明書の終了日など）は、API の定期処理か status-agent で確かめ、30日前に既存の通知（フローティングチャット）へ出す。
3. 年次で手で上げる対象を決める: Docker Engine と Compose、Tailscale、カーネル、ファームウェア、EEPROM。KB-438 の除外リストの横に「いつ誰が上げるか」を書き足す。
4. Dependabot の pip を nfc-agent、barcode-agent、haizen-agent、status-agent に広げる。
5. Node 24 から 26 への切り替えを 2027 年中に計画する（期限 2028-04-30）。
6. ホスト OS のメジャー更新の計画を、trixie の通常保守の終わり（2028-08-09）の1年前までに別の ExecPlan で立てる。
7. `Dockerfile.web:2` の `node:24-alpine` を digest で固定するか、固定しない理由を書く。

### 優先3: データの保持方針と月次の容量記録（観点3）

持ち主: 測定の仕組みと保持処理は Claude/Codex。データの種類ごとに何年残すかはユーザーが決める。

まず決めること: 写真、端末ログ、警告、実績工数の生データ、イベント記録を、それぞれ何年残すか。法令や社内規程で残す必要があるものがあるか。

やること。

1. 要実測の一覧の項目3で、表ごとの大きさと写真の年ごとの大きさを測る。
2. その結果から10年後の容量を見積もり、この計画の「Artifacts and Notes」に書く。
3. 決まった保持期限で消す処理を、端末ログの保持処理（`client-network-log-retention.ts`）と同じ形で足す。
4. 毎月1回、表とフォルダの大きさを記録する仕組みを作る（読み取りだけの集計）。
5. 上限の無い一覧 API に件数の上限かページ分けを入れる（1本ずつ別 PR）。

### 優先4: 機械の台帳と調達計画（観点2）

持ち主: 台帳の雛形は Claude/Codex。予算、予備の台数と保管場所、SD から SSD への切り替えはユーザーが決める。

まず決めること: 予備を何台どこに置くか、SD を何年で替えるか（または SSD・産業用 SD に替えるか）。

やること。

1. `docs/runbooks/hardware-ledger.md`（新規）に、機械ごとの型番、購入日、記憶装置の種類と製造時期、交換予定日、予備の数を並べる。Pi3 の型番は要実測の一覧の項目2で確かめる。
2. KB-428 の結論に沿って、書き込み量ではなく年数で交換する計画を書く。
3. Pi3 が Model B なら、2028-01 の生産終了の前に代わりの機種を決める。
4. NFC、トルクレンチ、バーコードの読み取り機の型番と、生産終了時の代わりを台帳に書く。
5. `docs/runbooks/pi4-spare-swap.md` の空欄（保管場所と台数）を埋め、古い Tailscale ノードを無効にする手順を足す。
6. SD 摩耗の日次報告（INFO）を、閾値を超えたら通知に上げるかどうかを決める。

### 優先5: 100台相当の負荷を測る（観点5）

持ち主: 測定は Claude/Codex。どの環境で測るかはユーザーが承認する。本番では測らない。

まず決めること: 測る場所（本番と同じ構成の別の Pi5、または Mac 上の Docker）。

やること。

1. 負荷を出す道具を1つ選び（k6 が第一候補）、`scripts/load/`（新規）に置く。
2. 100台分の生存報告、キオスクの画面更新、取込処理を同時に流し、応答時間、DB 接続の待ち、CPU とメモリを記録する。
3. DB 接続の上限（10）、1端末の要求上限（120/分）が足りるか判断し、足りなければ設定を変える PR を出す。
4. 結果を KB に書き、1年ごとに同じ測定を繰り返す。

### 優先6: 人向けの入口と古い記述の修正（観点6）

持ち主: 文書は Claude/Codex。契約と管理者の名義の情報はユーザーが出す。

まず決めること: 入口の文書を誰向けに書くか（社内の次の担当者を想定）。

やること。

1. `docs/guides/operator-handbook.md`（新規）に、毎週・毎月・毎年することと、それぞれの手順書へのリンクを1枚で並べる。年次点検の手順（期限台帳、機械の台帳、容量、負荷測定を見る）もここに書く。
2. `README.md:72` の古い更新経路を、今の標準手順（`docs/guides/deployment.md`）へのリンクに直す。
3. `docs/security/system-inventory.md:107,117` から使っていない機械を外す。
4. 契約と管理者の台帳を作る（秘密は書かず、名義、更新日、管理者だけ）。期限台帳と同じ文書にしてもよい。
5. Mac の見張りを別の Mac へ移すときの手順を `docs/runbooks/mac-pi5-watchdog.md` に足す。

## 要実測の一覧（まとめて1回許可を得る）

どれも読み取り専用で、本番の動作は変えない。秘密や `.env` は読まない。実行の前に、この一覧をそのままユーザーに見せて許可を得る。

1. 写真削除が入っているか（Pi5）:

        crontab -l
        sudo crontab -l
        ls /etc/cron.d /etc/cron.daily /etc/cron.monthly
        systemctl list-timers --all

2. 機械と OS の版（全機）:

        cat /etc/os-release
        cat /proc/device-tree/model
        uname -r
        docker version --format '{{.Server.Version}}'
        docker compose version
        tailscale version
        sudo rpi-eeprom-update

   Pi3 は Docker が無い場合がある。その場合は Docker の2行を飛ばす。

3. データの大きさ（Pi5）:

        df -h
        docker system df
        sudo du -sh /opt/RaspberryPiSystem_002/storage/photos/*

   DB の表ごとの大きさは、DB コンテナの中で次の問い合わせを読み取り専用で流す。

        SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 30;

4. 証明書の終了日（Mac から）:

        openssl s_client -connect <Pi5のTailscale名>:443 -servername <Pi5のTailscale名> </dev/null 2>/dev/null | openssl x509 -noout -enddate -issuer

5. Tailscale の鍵の期限（ユーザーが管理画面で見る）: Tailscale の管理画面の Machines の一覧で、各ノードに「Expiry disabled」と出ているかを見る。

## Concrete Steps

この計画の各優先項目は、作業用の worktree と feature branch で始める（`python3 -m scripts.git_lifecycle.cli start`、詳細は `.cursor/rules/20-git-workflow.mdc`）。

優先1の修正の確かめ方（作業ディレクトリはリポジトリの直下）:

    pnpm --filter @raspi-system/api exec vitest run src/lib/__tests__/photo-storage.test.ts

期待: 「2024を渡すと 2024 の12か月分を消す」ことを確かめるテストが通る。

文書だけの項目（優先2、4、6）は、リンク切れを確かめる。

    rg -n "expiry-ledger|hardware-ledger|operator-handbook" docs

## Validation and Acceptance

この計画全体が終わったと言えるのは、次がすべて満たされたときである。

- 期限台帳を開くと、今後12か月に期限が来るものが全部並んでいて、それぞれに持ち主と手順書がある。
- 期限の30日前に通知が来ることを、期限の近い試験用の証明書で一度確かめた。
- 写真の年次削除が、渡した年の全月を消し、今年の写真を消さないことをテストで確かめた。本番に入っているなら、2027-01 より前に直したものが入っている。
- データの種類ごとに保持期限が決まり、10年後の容量の見積もりがこの文書にある。
- 機械の台帳に全機の型番と交換予定日がある。
- 100台相当の負荷の測定結果が KB にあり、足りない設定は直してある。
- 人向けの入口から、毎週・毎月・毎年の作業の手順書へたどれる。
- 年次点検を1回、入口の文書の手順どおりに通して回した。

## Idempotence and Recovery

この文書の更新と台帳づくりは何度やり直しても害が無い。要実測のコマンドはすべて読み取り専用である。

写真の削除処理を直すときは、本番で動かす前に、消す対象のフォルダを一覧するだけの「試し運転」を用意し、その出力を見てから実際に消す。消した写真は戻せないので、初回は Google Drive のバックアップ（`docs/runbooks/google-drive-disaster-recovery.md`）に写真が含まれているかを先に確かめる。

保持期限で消す処理を足すときも同じで、最初は件数だけを記録し、結果を見てから消す。

## Artifacts and Notes

- 調査の根拠は、各観点の「今あるもの」「足りないもの」に path:line で書いた。
- 2026-10-21 の監査メモ（別の会話のメモ）で見つかった、保持期限の無いデータと上限の無い一覧 API を観点3に取り込んだ。
- 10年後の容量の見積もりは、要実測の項目3の結果が出たらここに書く。

## Interfaces and Dependencies

- 通知は既存の通知の経路（キオスクのフローティングチャット）を使い、新しい外部サービス（Slack など）は足さない。
- 機械で確かめる期限の判定は、既存の定期処理（API の日次処理、status-agent）に載せ、新しい常駐プロセスは足さない。
- DGX Spark の Control Plane（`denkoushi/DGXSparkControlPlane`）が持つものはこの計画で扱わない。DGX 側の期限は、そちらのリポジトリで管理する。
- 標準デプロイ（`scripts/update-all-clients.sh`）の手順は変えない。

---

改訂履歴

- 2026-11-15: 初版。6観点の調査結果、優先順位、要実測の一覧を書いた。
