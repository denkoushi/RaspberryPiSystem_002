# 10年安定稼働に向けた「壊れない・古びない」ための計画

この ExecPlan は生きた文書である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は作業の進行に合わせて更新する。書き方は `.agent/PLANS.md` に従う。

## Purpose / Big Picture

この計画は、今のシステムをこれから10年止めずに使い続けるために、壊れる前に手を打つ「予防」をまとめたものである。対象は、Pi5 サーバー1台、Pi4 キオスク8台、Pi3 サイネージ1台と、外から見張る Mac である。

壊れたときに早く戻す仕組みは、すでに `docs/plans/fleet-100-scale-gap-execplan.md`（以下「100台計画」）が扱っている。そこにあるのは、復旧訓練、予備の Pi5 と DB の複製、外からの見張り、端末側の送信待ち、段階的な更新、共通イメージと予備機の差し替え、ログの上限、SD の保護である。この計画はそれと重ねない。扱うのは、時間がたつと必ず起きる次の6つを先回りして防ぐことである。

1. ソフトウェアの保守期限切れと、更新の習慣
2. 機械（Pi、記憶装置、電源、読み取り機）の寿命と調達
3. データが増え続けること
4. 期限のあるもの（証明書、鍵、契約、外部サービス、時計）
5. 端末100台になったときの性能の余裕
6. 担当者が替わっても回せること

この計画が終わると、運用担当は次のことができるようになる。年に1回、決まった台帳を開くだけで分かる。

- 今年中に期限が来るもの
- 寿命が近い機械
- 容量の見込み

期限が機械で確かめられるものは、30日前に通知が来る。担当が替わっても、入口の1枚から必要な手順書へたどれる。

完了の条件に「年次点検を1回通して回す」が入っている。そのため、この計画は最短でも約1年続く。

この文書は、調査と方針の正本である。各項目の実装は、それぞれ別の小さな PR で行う。

## 用語

- EOL（保守期限切れ）: 作った側がセキュリティ修正を出さなくなる日。これを過ぎた部品は、穴が見つかっても直らない。
- LTS: 長期保守版。通常より長く修正が出る版、またはその期間。
- 期限台帳: 期限のあるものを1か所に並べた表。証明書、鍵、契約、外部サービス、ソフトの EOL、機械の生産終了を載せる。この計画で新しく作る。
- 機械の台帳: 機械ごとの型番、購入日、記憶装置、交換予定を並べた表。この計画で新しく作る。
- 要実測: リポジトリと公開情報からは分からず、本番機で読み取り専用のコマンドを打って初めて分かること。この計画を書く間、本番機には触れていない。測るときは、まとめてユーザーの許可を得る（後述の「要実測の一覧」）。
- 持ち主: その作業を誰がするか。
  - 「ユーザー」は、人の判断、契約、購入、現場作業をする。
  - 「Claude/Codex」は、リポジトリの変更と、読み取り専用の確認をする。
- cron / systemd timer: 決まった時刻にコマンドを動かす Linux の仕組み。
- Dependabot: GitHub が依存部品の新しい版を見つけて、更新の PR を自動で出す仕組み。設定は `.github/dependabot.yml`。
- digest: コンテナイメージの中身を一意に表す値（`sha256:...`）。これで固定すると、同じ名前で中身が差し替わっても影響を受けない。
- ghcr: GitHub Container Registry。この repo のコンテナイメージの置き場。
- OAuth: 外部サービス（Dropbox、Gmail など）にパスワードを渡さずに接続する仕組み。更新用の鍵が失効すると接続が切れる。
- EEPROM: Pi4 と Pi5 の基板にある起動用の書き換え可能なファームウェア。Pi3 には無い。
- RTC: 電源が切れても時刻を保つ時計。Pi4 と Pi3 には電池付きの RTC が無く、起動後にネットワークで時刻を合わせる。
- k6: 多数の利用者を模して同時に要求を送る負荷試験の道具。

## Progress

- [x] (2026-11-15) リポジトリと公開情報で6観点の現状を調べ、根拠の行を確かめた。
- [x] (2026-11-15) 公式の EOL と生産終了の日付を一次情報で確かめた。
- [x] (2026-11-15) 初版を書き、`docs/INDEX.md` に登録した。Fable、Opus、Codex の3者で独立にレビューし、引用のずれ、言い過ぎ、抜けていたリスクを直した。
- [ ] 要実測の一覧をユーザーに見せ、まとめて許可を得て測る。
- [ ] 優先1: 写真の年次削除を作り直す（2027-01 より前）。
- [ ] 優先2a: 期限台帳と期限前の通知を作る。
- [ ] 優先2b: キオスクのブラウザの自動更新を、先に1台で当てる形にする。
- [ ] 優先2c: 手で上げる部品（Docker、Tailscale、カーネル、ファームウェア、EEPROM）の時期を決め、Dependabot の抜けを埋める。
- [ ] 期限付き: Node 24 から 26 への切り替えを 2027-12 までに終える（Node 24 の EOL は 2028-04-30）。
- [ ] 期限付き: ホスト OS のメジャー更新の ExecPlan を 2027-08 までに立てる（trixie の通常保守は 2028-08-09 まで）。
- [ ] 期限付き: Pi3 が Model B なら、2027-12 までに代わりの機種を決める（Model B の生産保証は 2028-01 まで）。
- [ ] 優先3: データの保持方針と、月次の容量記録を作る。
- [ ] 優先4: 機械の台帳と調達計画を作る。
- [ ] 優先5: 100台相当の負荷を隔離環境で測る。
- [ ] 優先6: 人向けの入口を作り、古い記述を直す。
- [ ] 年次点検を1回通して回し、この計画の振り返りを書く。

## Surprises & Discoveries

### 写真の年次削除は、作りが壊れている

削除する年の計算が二重になっていて、意図と逆に「今年の1月の写真」を対象にする。

- `apps/api/src/scripts/cleanup-photos.ts:22-36` は1月にだけ動き、`currentYear - 2` を `PhotoStorage.deletePhotosByYear` に渡す。
- `apps/api/src/lib/photo-storage.ts:160-183` の `deletePhotosByYear(year)` は、中で受け取った年に2を足し、月を `01` に決める。そのうえで `photos/<年>/01` と `thumbnails/<年>/01` を消す。
- 差し引きすると、2027年1月に動くと 2027/01 を消す。
- 仮に意図どおり動いても、消すのは1か月分だけで、1年分ではない。
- 消すのはファイルだけで、DB に残る写真の参照はそのままになる。
- テスト `apps/api/src/lib/__tests__/photo-storage.test.ts:16-17` は、`deletePhotosByYear(2024)` が `photos/2026/01` を見ることを期待している。この挙動をそのまま固めている。

起動役の `scripts/server/cleanup-photos.sh` にも問題がある。

- cron の書き方の例（10行目、13行目）があるだけで、Ansible や cron の設定でこれを入れている所はリポジトリに無い。
- 例のとおりに入れると、1月中は毎日動く。その場合、その日までに撮った1月の写真を毎日消すことになる。
- 39行目は、古い `infrastructure/docker/docker-compose.server.yml` の `api` に `pnpm tsx ...` を流す作りになっている。
  - 今の API は青緑の2系統で動いている（`infrastructure/docker/docker-compose.phase3.migration.yml:8,14` の `api-blue` と `api-green`）。
  - `tsx` は開発用の依存である（`apps/api/package.json:112`）。本番イメージは `pnpm install --prod` で作り（`infrastructure/docker/Dockerfile.api:154`）、開発用の依存を持ち込まない（同 196-198 行目）。
  - したがって、cron に入っていても、消す前にコマンドが失敗している見込みが高い（イメージの中は未確認）。

まとめると、本番で写真が消えているかどうかは2段階で分からない。入っているかどうかと、入っていて実際に動くかどうかである。どちらも要実測とする。どちらにしても、写真を消す仕組みとしては使えないので作り直す。

### SD カードは、書き込み量が少なくても壊れた

`docs/knowledge-base/KB-428-sessaku01-sd-card-failure.md` に、2022-07 製の同型 32GB カードの記録がある。

- 壊れたものの書き込み量は 141GB だった。
- まだ健全な2枚は 385GB と 408GB だった。
- KB は、制御部の故障の可能性を挙げている。

ここから言えるのは、書き込み量だけでは交換時期を決められない、ということまでである。何年で交換すべきかは実証されていない。この計画では、年数での計画交換を予防の方針として採る。媒体の選び方（産業用 SD、USB SSD）は100台計画の M7 で扱う。

### Pi3 の型番が分からない

`docs/runbooks/device-model-roles.md` は「Pi3」とだけ書いている。公式の生産保証（「少なくとも〜まで生産」の表記）は次のとおりで、2年違う。

- Raspberry Pi 3 Model B: 2028-01 まで
- 3 Model B+: 2030-01 まで

Pi3 が 32bit の OS で動いている場合は、さらに2つ問題がある。

- 毎週のセキュリティ更新が当たらないおそれがある。更新の仕組みは、配布元が `Debian` かつ `Debian-Security` の版だけを採用する（`scripts/os-security-update/raspi-os-security-update.py:54-60`）。32bit の Raspberry Pi OS では配布元の名前が違うことがあり、その場合は何も当たらないまま成功として終わる。
- 時刻の扱いの2038年問題が残るおそれがある。

型番と、32bit か 64bit かは要実測。

### Pi5 の性能の余裕は、今の台数でもう少ない

100台計画の M0 の実測（`docs/plans/fleet-100-scale-gap-execplan.md:67`、2026-11-05）がある。Pi5 は available 3476MB あるが、swap 2047MB をほぼ使い切っている（2046MB）。

### キオスクのブラウザは、全台が同じ時刻に自動で更新される

毎週のセキュリティ更新は、chromium を例外として許可している（`infrastructure/ansible/group_vars/all.yml:430-433`）。日曜 02:00 に、ずらしの時間 0 で全台に当たる。100台計画の段階的な更新は自前の版の配布だけが対象なので、どちらの計画もこの危険を扱っていなかった。

### 人が最初に読む所が古い

- `README.md:72` は今も古い経路（RealVNC と git pull）で端末を更新する説明になっている。
- `docs/security/system-inventory.md` には、2026-04-26 に止めた Ubuntu の LocalLLM 機（`docs/runbooks/local-llm-tailscale-sidecar.md:9`）が、26行目付近をはじめ10か所ほど残っている。

## Decision Log

- Decision: 100台計画が扱うものは、この計画に書かず、リンクだけにする。対象は「壊れた後に早く戻す」仕組み、予備機の置き場所と台数、古い Tailscale ノードの無効化、SD の媒体の選び方である。
  Rationale: 同じ事実を2か所に書くと、片方が古くなる（`.cursor/rules/01-core-docs-and-knowledge.mdc`）。予備機と旧ノードは100台計画の M6、媒体は M7 の範囲である。
  Date/Author: 2026-11-15 / Claude

- Decision: この計画では、`docs/plans/software-support-upgrade-execplan.md` の一度きりの EOL 更新を繰り返さない。扱うのは次の2つだけにする。
  - 次の期限を毎年見直す習慣
  - その計画で対象外にした OS のメジャー更新
  Rationale: 更新そのものは済んでいる。足りないのは、次の期限を誰がいつ見るかという仕組みである。
  Date/Author: 2026-11-15 / Claude

- Decision: 優先順位は「止まる・消えるまでの近さ」と「気づかずに起きるか」の掛け合わせで決める。写真の削除を最優先にする。
  Rationale: 2027-01 という具体的な日に、データが消えるか、消すべきものが消えない状態が続く。しかも直すのは小さい。
  Date/Author: 2026-11-15 / Claude

- Decision: 本番機での確認は、この計画を書く間に一切していない。要るものは「要実測の一覧」に読み取り専用のコマンドとしてまとめ、まとめて1回許可を得る。
  Rationale: 依頼の制約である。何度も許可を求めると、ユーザーの手間が増える。
  Date/Author: 2026-11-15 / Claude

- Decision: zero2w-* の試作端末は、この計画の対象から外す。DGX Spark の Control Plane 側の期限は、そちらのリポジトリで扱う。
  Rationale: zero2w は本番の端末ではない。Control Plane は責任分界の外である。
  Date/Author: 2026-11-15 / Claude

- Decision: 負荷試験の道具は新しい置き場を作らず、既存の `scripts/perf/` に足す。
  Rationale: 測る道具とデータ投入の道具がすでにそこにある。
  Date/Author: 2026-11-15 / Claude

## Outcomes & Retrospective

（初版の時点では未記入。優先1〜6のそれぞれが終わるたびに、何ができて何が残ったかを書く。）

## Context and Orientation

### 構成と関係する計画

本番の機械は次のとおり。

- Pi5 サーバー1台。API、Web、PostgreSQL、Caddy を Docker で動かす。
- Pi4 キオスク8台。
- Pi3 サイネージ1台。
- 運用者の Mac 1台が、外から Pi5 を見張る（`docs/runbooks/mac-pi5-watchdog.md:4`）。

端末の一覧は `infrastructure/ansible/inventory.yml`、機種ごとの役割は `docs/runbooks/device-model-roles.md` にある。

関係する計画は次の2つ。この計画は、どちらとも中身を重ねない。

- `docs/plans/fleet-100-scale-gap-execplan.md`: 次のものを扱う。
  - 復旧訓練
  - 予備の Pi5 と DB の複製
  - 外からの見張り
  - 端末側の送信待ち
  - 段階的な更新
  - 共通イメージと予備機の差し替え（M6）
  - ログの上限と SD の保護（M7）
- `docs/plans/software-support-upgrade-execplan.md`: 2026-10 から 2026-11-02 にかけて終えた、一度きりの EOL 更新。
  - Node 24、Prisma 7.10.1、Debian trixie のベースイメージ、エージェントの Python 3.13
  - PostgreSQL 15 から 18.6（本番移行は 2026-10-30、232行目）
  - pnpm 12、React 19.3.1、Playwright 1.64.1（2026-11-02、242行目）
  - OS のメジャー更新は対象外（13行目）

### 公式の期限（2026-11-15 に確認）

- Raspberry Pi の生産保証（「少なくとも〜まで生産」）
  - Pi5: 2036-01 まで
  - Pi4: 2034-01 まで
  - Pi3 Model B+: 2030-01 まで
  - Pi3 Model B: 2028-01 まで
  - 出典は raspberrypi.com の製品ごとの記載。
- Node.js
  - 22: 2027-04-30 まで。
  - 24: 2026-10-20 から保守期に入り、2028-04-30 まで。
  - 26: 2026-10-28 に Active LTS になり、2029-04-30 まで。
  - 出典は nodejs.org のリリース表。
- PostgreSQL 18: 2030-11-14 まで（postgresql.org の versioning ポリシー）。
- Python 3.13: 2029-10 まで（devguide.python.org）。
- Debian
  - 13 trixie: 通常の保守は 2028-08-09 まで、LTS は 2030-06-30 まで。
  - 12 bookworm: 通常の保守は 2026-07-11 に終えた。LTS は 2028-06-30 まで。
  - 出典は debian.org。
- Caddy: 保守期限の方針は見当たらない。

これらは変わりうるので、期限台帳（優先2a）で毎年見直す。

## 6つの観点の現状と足りないもの

### 観点1: ソフトウェアの保守期限と更新の習慣

今あるもの。

- 依存の自動更新: `.github/dependabot.yml` が毎週、次の更新 PR を出す。
  - npm
  - GitHub Actions
  - Docker（`/infrastructure/docker` だけ。node のメジャーと playwright のメジャー・マイナーは除外）
  - pip（`clients/torque-agent` だけ）
- OS のセキュリティ更新: `docs/knowledge-base/KB-438-os-security-weekly-update.md` の仕組みで、全機が毎週 trixie-security から修正を当てる（`infrastructure/ansible/group_vars/all.yml:413` の `os_security_update_mode: apply`）。
- コンテナの土台
  - `infrastructure/docker/Dockerfile.api:72` は `node:24-trixie-slim` を digest まで固定している。
  - `infrastructure/docker/Dockerfile.web:2` は `node:24-alpine` で、digest は無い。
  - Caddy は `Dockerfile.web:88` で v2.11.4 に固定している。
  - DB は `infrastructure/docker/docker-compose.server.yml:5` で `pgvector/pgvector:pg18` を使う。

足りないもの。

- 手で上げる時期が決まっていない部品がある。
  - KB-438 の自動更新は、Docker、Tailscale、カーネル、ファームウェアを除外している（KB-438 の34〜37行目）。除外は正しいが、これらを手で上げる時期が決まっていない。
  - EEPROM も同じである。
  - Docker Engine と Compose の版は、どこにも固定も記録もされていない。
- ホスト OS のメジャー更新（trixie の次）を扱う計画が無い。
  - status-agent は OS の python3 と標準ライブラリだけで動く（依存の宣言ファイルが無い）。そのため、OS の更新がそのまま status-agent の Python の更新になる。
- キオスクのブラウザ（chromium）が、全台同時に自動で更新される（「Surprises & Discoveries」参照）。先に1台で確かめる仕組みも、壊れたときの戻し方も無い。
- Dependabot が見ていない依存がある。
  - pip: `clients/nfc-agent` と `clients/barcode-agent`（どちらも pyproject と poetry.lock がある）。`clients/haizen-agent` は pyproject はあるが lock が無いので、先に lock を作る。
  - 回答キャッシュの `services/hermes-answer-cache/requirements.txt` と、同じ場所の Dockerfile。
  - `scripts/dgx-local-llm-system/Dockerfile.embedding-eg2`。
  - Renovate は使っていない。
- Node 24 の期限は 2028-04-30 だが、26 への切り替えはまだ計画に無い。
- CI の実行環境は、ほとんどの workflow が `ubuntu-latest` を使っている（`.github/workflows/*.yml`）。中身は何年かごとに切り替わり、Dependabot はその切り替わりを見ない。実例として、ubuntu-latest が 26.04 になって e2e が落ちたことがある（`software-support-upgrade-execplan.md:242`）。
- Android の haizen アプリは `targetSdk = 34` のままである（`apps/android-haizen-shell/app/build.gradle.kts:12`）。端末側の Android や WebView の更新に追いつく予定が無い。
- 次の点は要実測である。
  - 本番のホスト OS が本当に trixie か
  - Docker、Tailscale、カーネルの版
  - Pi3 が 32bit か 64bit か

### 観点2: 機械の寿命

今あるもの。

- 機種ごとの役割とメモリの実測が `docs/runbooks/device-model-roles.md` にある。
- SD の摩耗の日次報告がある（`docs/guides/status-agent.md:113`）。ただし INFO 扱いで、通知にはならない。
- 低電圧と温度の制限は status-agent が検出する（`clients/status-agent/storage_health.py:307-325`）。停電や電源操作の後の戻し方は `docs/runbooks/kiosk-power-operation-recovery.md` にある。
- 予備機への差し替え手順は `docs/runbooks/pi4-spare-swap.md` にある。予備の保管場所と台数、古い Tailscale ノードの無効化は、そこと100台計画の M6 で扱っている。
- KB-428 は、SD の故障の記録と、残り2枚を USB SSD の試験と合わせて替える方針を持っている。

足りないもの。

- 機械ごとの購入日、記憶装置の製造時期、交換予定日をまとめた台帳が無い。
- 書き込み量だけでは交換時期を決められない（KB-428）。年数で計画交換する方針が要る。
- 電源アダプタ、ケーブル、冷却の経年劣化を見る項目が無い。低電圧の検出はあるが、交換の判断に使っていない。
- Pi3 の型番が分からない（Model B なら、生産保証は 2028-01 まで）。要実測。
- 読み取り機の型番と、生産が終わったときの代わりが決まっていない。
  - NFC は Sony RC-S300/S1（`clients/nfc-agent/README.md:3`）。
  - トルクレンチは CEM3-BTLA（`docs/runbooks/assembly-torque-agent.md`）。
  - バーコード読み取り機は、型番の記録が無い。

### 観点3: データの増え方

今あるもの。

- 端末ログの保持
  - `apps/api/src/services/clients/client-network-log-retention.ts:3,13` が、30日より古いものを消す。
  - 対象は network_health、kiosk_net_stats、sessaku-pieces の端末ログと、切削の片の監査ログ（同29〜37行目）である。
  - 毎日 03:20 に動く（`apps/api/src/services/clients/client-network-log-retention.scheduler.ts:14`）。
- その他の保持
  - CSV の取込履歴は既定で90日保持する（`apps/api/src/services/imports/import-history.service.ts:184`）。
  - 計測器の貸出履歴は、2年前の1年分を消す（`apps/api/src/services/measuring-instruments/measuring-instrument-loan-retention.service.ts:10-15`）。
  - ほかに、CSV ダッシュボード、古いメール取込分、バックアップ履歴にも保持の処理がある。
- バックアップ
  - DB のバックアップは30日保持する（`scripts/server/backup.sh:27`）。
  - Google Drive への退避は、日次7、週次5、月次12を残す（`docs/runbooks/google-drive-disaster-recovery.md:95`）。
- ディスクの警告
  - Pi5 は 70/80/90% で警告する（`docs/runbooks/pi5-local-file-storage.md:41`）。
  - 端末側は status-agent が 80% で警告する（`clients/status-agent/storage_health.py:21`）。
  - 過去に、Docker の残骸で1日21GB 増えた記録がある（同 runbook の81行目）。
- 写真の置き場所は `/opt/RaspberryPiSystem_002/storage/photos/YYYY/MM` である（`docker-compose.server.yml:269-275` で bind）。

足りないもの。

- 保持期限の無いデータがある。
  - 上記以外の端末ログ
  - 警告（Alert）の DB 行。`alerts-inbox-cleanup` はファイルだけを消す。
  - 実績工数の生データ（ActualHoursRaw）
- 写真の年次削除が壊れている（「Surprises & Discoveries」参照）。そもそも写真を何年残すかが決まっていない。
- 件数の上限が無いまま全件を返す API がある。データが増えると遅くなり、メモリも食う。2026-11-15 の確認で、次のものが残っていた。
  - 実績工数の集計
  - トルク学習の元データ
  - CSV ダッシュボードの表示データの全件取得
  - 計測器と吊具の点検一覧
  - 2026-10-21 の監査で挙がった他の箇所は、その後の変更でファイルや行が移っている。直すときに改めて洗い出す。
- 大きさを記録する仕組みが無く、10年後の容量を見積もれない。
  - 表ごと、フォルダごとの大きさを毎月記録していない。
  - Google Drive 側の容量も見ていない。
  - DB の migration はすでに298本あり（`apps/api/prisma/migrations`）、入れ直しと復旧訓練の時間に効いてくる。
- 表の大きさ、`df -h`、`docker system df`、写真の年ごとの大きさは要実測である。
- 戻せる版の下限が書かれていない。ghcr の古いイメージは workflow で消している（`.github/workflows/pr-cache-cleanup.yml`）。

### 観点4: 期限のあるもの

今あるもの。

- HTTPS 証明書
  - Caddy は自動取得を切って（`infrastructure/docker/Caddyfile.gateway.template:4` の `auto_https off`）、自前の cert.pem を使う。
  - 作る手順は `scripts/server/generate-ssl-cert-for-tailscale.sh` にある。49行目の `-days 3650` で、10年の自己署名になる。
  - 別に、社内 CA の証明書を入れる playbook がある（`infrastructure/ansible/playbooks/activate-pi5-local-ca-certificate.yml`）。56行目で残りが30日以上あるかを確かめるが、反映のときだけである。
  - 本番でどちらが有効かは要実測。
- Mac の見張りは、証明書の SHA-256 を固定している（`docs/runbooks/mac-pi5-watchdog.md:34-36`）。証明書を替えると、見張りの設定も替える必要がある。
- Tailscale
  - ある日、鍵の期限切れで Pi3、Pi4 キオスク、Pi5 がまとめて影響を受けた（`docs/security/tailscale-policy.md:325-327`）。
  - 人のいない機械は、鍵の期限を無効にする（Disable key expiry）方針である（同333行目）。
  - 本番の各ノードで実際に無効になっているかは、管理画面で見る必要がある（要実測）。
- 管理画面のログイン: アクセストークンは15分（`apps/api/src/config/env/core.ts:66`）である。セッションは作ってから7日で失効し、更新しても延びない（`apps/api/src/services/auth/auth-session.service.ts:30-57`）。週に1回の再ログインは仕様どおりで、台帳の対象外とする。
- 端末の鍵を差し替える手順がある（`scripts/security/rotate-client-key.sh`）。
- 外部接続の台帳: `docs/guides/external-integration-ledger.md`。Dropbox の更新は96行目、Gmail は243〜245行目、Slack は171行目にある。

足りないもの。

- 期限を1か所に並べた台帳が無く、期限前の通知も無い。
- 台帳に載っていないものがある。
  - ghcr からイメージを取得するための資格情報
  - Android の haizen アプリの署名鍵
  - ドメインや契約の更新日（あれば）
- 外部サービスの仕様変更や終了への備えが、OAuth の更新しか無い。抜けているのは次のもの。
  - 業務 LLM の接続先（`apps/api/src/config/env/business-hermes.ts`）
  - Gmail と Dropbox の OAuth アプリの方針変更
  - Google Drive の退避先の名義と容量
- 自己署名証明書の終了日が記録されていない。10年後に一斉に切れる可能性があり、そのときは見張りの固定値も同時に替える必要がある。
- 時刻のずれを誰も見ていない。
  - Pi4 には電池付きの時計が無く、時刻合わせは `systemd-timesyncd` だけに頼っている（`infrastructure/image/rpi-image-gen/layer/pi4-kiosk-base.yaml:6`）。
  - status-agent は時刻のずれを報告しない。
  - 一方で、次のものは時刻に依存している。
    - データの新しさの判定（`apps/api/src/services/kiosk-inquiry/csv-feed-freshness-evaluator.ts`）
    - 証明書の判定
    - ログの並び順

### 観点5: 端末100台での性能の余裕

今あるもの。

- DB 接続の上限は、既定で10である（`apps/api/src/config/env/core.ts:44`）。
- 要求の回数の上限は1分120回である（`apps/api/src/plugins/rate-limit.ts:58-70`）。
  - 数えるのは、端末（無ければ IP）と経路の組み合わせごとで、端末全体の合計ではない。
  - 数えない経路もある。
- 端末の生存報告は60秒ごとである（`clients/status-agent/status-agent.timer:6`）。100台なら毎秒約1.7件になる。
- Ansible の同時実行数は5である（`infrastructure/ansible/ansible.cfg:6`）。
- 1本ずつの応答時間を測る道具はある。
  - 道具とデータ投入は `scripts/perf/` にある（`measure-kiosk-perf.mjs`、`measure-kiosk-documents-api.mjs`、`seed-kiosk-perf-data.ts` など）。
  - CI には応答時間の閾値がある（`.github/workflows/ci.yml:234` の `PERF_RESPONSE_TIME_THRESHOLD_MS`）。
  - 実測の記録は、KB-369、KB-313、KB-394、KB-418、KB-439 などにある。
- Pi5 は、今の台数でも swap をほぼ使い切っている（100台計画の67行目）。

足りないもの。

- 多数の端末から同時に要求を受けたときの試験の道具（k6 など）が無く、100台相当を一度も測っていない。
- 足りるかどうか分からない点がある。
  - DB 接続10本で、キオスクの画面更新、生存報告、取込処理が重なったときに足りるか。
  - メモリが、今の swap の状態から100台に耐えるか。
- 全件を返す API（観点3）は、件数と端末数の両方で重くなる。

更新の並列化と端末側の送信待ちは、100台計画の範囲である。ここでは「測る」ことだけを扱う。

### 観点6: 担当者が替わっても回せること

今あるもの。

- runbook は35本ある（zero2w を除く）。デプロイの正本は `docs/guides/deployment.md` と `docs/guides/quick-start-deployment.md` である。
- AI 向けの入口は `docs/AI_START_HERE.md` と `AGENTS.md` である。

足りないもの。

- 人向けの入口が無い。新しい担当者が、まず何を読み、毎週・毎月・毎年何をするかを1枚で知る文書が無い。
- 古い記述がある。
  - `README.md:72` が古い更新経路を説明している。
  - `docs/security/system-inventory.md` に、止めた機械が残っている。
- 契約と管理者の台帳が無い。Tailscale、GitHub、Google、Dropbox、ドメインなどについて、誰の名義で、いつ更新で、誰が管理者かが分からない。
- Mac の見張りを別の Mac へ移す手順が無い。見張りを増やすことと、置き場所を決めることは、100台計画の M3 の範囲である。

## Plan of Work

優先順位は、上から順に「止まる・消えるまでが近く、しかも気づかずに起きる」ものである。各項目は別々の小さな PR にする。

### 優先1: 写真の年次削除を作り直す（期限: 2027-01 より前）

持ち主: 修正は Claude/Codex。写真を何年残すか、使用中の写真をどう扱うかはユーザーが決める。

まず決めること: 本番の Pi5 に、この削除が入っているか、動いた跡があるか（要実測の一覧の項目1）。入っていれば、2027-01 より前に止める。

やること。

1. `deletePhotosByYear` は使わない。代わりに「保持期限より古い月のフォルダを全部消す」処理にする。こうすると、ある年に止まっていても、次に動いたときに取り残しを回収できる。保持年数は設定値にし、既定はユーザーの決定に合わせる。
2. 消す前に、DB の写真の参照（`apps/api/prisma/schema.prisma:971-975,994` の写真の URL）を見る。まだ使われている写真（未返却の貸出など）は消さない。消した写真の参照をどう扱うかも決める。
3. 起動は Ansible で入れる systemd timer か、API の定期処理にする。古い compose と開発用の `tsx` には頼らない。手で入れた cron にも頼らない。
4. 初回は消さずに、対象の一覧と件数だけを記録する試し運転にする。
5. テスト `apps/api/src/lib/__tests__/photo-storage.test.ts` を、新しい動きに合わせて書き直す。

確かめ方（リポジトリの直下）:

    pnpm --filter @raspi-system/api exec vitest run src/lib/__tests__/photo-storage.test.ts

期待: 次の3つを確かめるテストが通る。

- 保持期限より古い月だけを対象にする。
- 今年の月を対象にしない。
- DB から参照されている写真を消さない。

### 優先2a: 期限台帳と期限前の通知（観点1と4）

持ち主: 台帳と通知は Claude/Codex。年次点検の月と、契約の持ち主はユーザーが決める。

まず決めること: 年次点検を何月にするか。期限の通知を誰が受けるか。

やること。

1. `docs/runbooks/expiry-ledger.md`（新規）に期限台帳を作る。載せる行の種類は次の10種類に決める。
   - ソフトの EOL（Node、PostgreSQL、Python、Debian、Caddy）
   - 機械の生産終了
   - 証明書
   - Tailscale の鍵の期限の設定
   - OAuth の接続
   - ghcr の資格情報
   - Android の署名鍵
   - 外部サービス（業務 LLM、Slack、Google Drive）
   - 契約とドメイン
   - CI の実行環境
2. 台帳の各行には、次の4つを書く。
   - 期限の日
   - 次に見る日
   - 持ち主
   - 替え方の手順書
   秘密の値そのものは書かない。
3. 機械で確かめられる期限（証明書の終了日、Pi の時刻のずれ）は、既存の定期処理か status-agent で確かめる。期限の30日前、または時刻のずれが閾値を超えたら、既存の通知（キオスクのフローティングチャット）に出す。
4. Pi5 の Google Drive 退避先の残り容量も、同じ通知に載せる。

確かめ方:

- 判定の処理を、日付を差し替えた単体テストで確かめる。本番の証明書は替えない。
- 台帳の行の種類が、上の10種類を全部そろえているかを目で見る。

### 優先2b: キオスクのブラウザの自動更新を、先に1台で当てる

持ち主: 仕組みは Claude/Codex。どの端末を先に当てるかはユーザーが決める（試す端末の候補は kensaku-stonebase01）。

まず決めること: 先に当てる1台と、残りの端末に当てるまでの間隔。

やること。

1. chromium の更新を、先に1台だけ当てる形にする。決めた日数のあいだ異常が無ければ、残りに当てる。
2. 壊れたときに、前の版の chromium に戻す手順を KB-438 に足す。

確かめ方: Ansible の `--check` で、先に当てる端末とそれ以外とで、更新の対象が変わることを見る。

### 優先2c: 手で上げる部品の時期と、Dependabot の抜け

持ち主: 設定の変更は Claude/Codex。年に何回上げるかはユーザーが決める。

やること。

1. 年に1回、手で上げる部品を決め、KB-438 の除外リストの横に「いつ、誰が上げるか」を書く。対象は次のとおり。
   - Docker Engine と Compose
   - Tailscale
   - カーネル
   - ファームウェア
   - EEPROM
2. Dependabot を広げる。
   - pip: nfc-agent、barcode-agent。haizen-agent は lock を作ってから足す。
   - pip と Docker: `services/hermes-answer-cache`。
   - Docker: `scripts/dgx-local-llm-system`。
3. `Dockerfile.web:2` の `node:24-alpine` を digest で固定する。固定しないなら、その理由を書く。
4. Node 26 への切り替えは、2027-12 までに終える（Progress の期限付きの行）。手順は、software-support 計画の Node 24 のときの形に合わせる。
5. ホスト OS のメジャー更新は、2027-08 までに別の ExecPlan を立てる（Progress の期限付きの行）。status-agent など、OS の python3 で動く部品もその計画で扱う。
6. Android の `targetSdk` は、年次点検で Google Play 側の要件と照らす。

確かめ方: `.github/dependabot.yml` を変えた PR で、GitHub の Insights の Dependency graph の Dependabot 画面に、新しい対象が出ることを見る。

### 優先3: データの保持方針と月次の容量記録（観点3）

持ち主: 測る仕組みと消す処理は Claude/Codex。データの種類ごとに何年残すかはユーザーが決める。

まず決めること: 次のデータを、それぞれ何年残すか。法令や社内規程で残す必要があるものがあるか。

- 写真
- 端末ログ
- 警告
- 実績工数の生データ

やること。

1. 要実測の一覧の項目3で、次の大きさを測る。
   - DB の表ごと
   - 写真の年ごと
   - Docker
2. その結果から10年後の容量を見積もり、この計画の「Artifacts and Notes」に書く。Pi5 の記憶装置と Google Drive の両方について見積もる。
3. 決まった保持期限で消す処理を足す。形は、端末ログの保持処理（`client-network-log-retention.ts`）にそろえる。
4. 毎月1回、表とフォルダの大きさを記録する仕組みを作る。読み取りだけの集計にする。
5. 全件を返す API に、件数の上限かページ分けを入れる。1本ずつ別の PR にする。
6. 戻せる版の下限（ghcr に残す古いイメージの数）を決めて、台帳に書く。

確かめ方:

- 消す処理を足すたびに、初回は件数だけを記録して見る。
- 月次の記録が2か月分たまったら、増え方をこの文書に書く。

### 優先4: 機械の台帳と調達計画（観点2）

持ち主: 台帳の雛形は Claude/Codex。予算と交換の年数はユーザーが決める。

まず決めること: 記憶装置を何年で交換するか。予備の台数と置き場所は、100台計画の M6 の決定に従う。

やること。

1. `docs/runbooks/hardware-ledger.md`（新規）に、機械ごとに次のものを並べる。
   - 型番
   - 購入日
   - 記憶装置の種類と製造時期
   - 交換予定日
   - 電源アダプタ
   Pi3 の型番は、要実測の一覧の項目2で確かめる。
2. 記憶装置は年数で計画交換する。媒体の選び方は、100台計画の M7 の結論にリンクする。
3. Pi3 が Model B なら、2027-12 までに代わりの機種を決める。
4. 読み取り機（NFC、トルクレンチ、バーコード）の型番と、生産が終わったときの代わりを台帳に書く。
5. 年次点検で、低電圧と温度の記録を見る。続けて出ている機械は、電源と冷却を替える。
6. SD の摩耗の日次報告（INFO）を、閾値を超えたら通知に上げるかどうかを決める。

確かめ方: 台帳の行の数が、`infrastructure/ansible/inventory.yml` の本番機の数（zero2w を除く）と一致する。

### 優先5: 100台相当の負荷を測る（観点5）

持ち主: 測るのは Claude/Codex。どこで測るかはユーザーが承認する。本番では測らない。

まず決めること: 測る場所。本番と同じ構成の別の Pi5 か、Mac 上の Docker か。

やること。

1. 同時に負荷を出す道具を1つ選び（k6 が第一候補）、既存の `scripts/perf/` に足す。データの投入は `seed-kiosk-perf-data.ts` を使う。
2. 100台分の次の要求を、30分続けて流す。
   - 生存報告
   - キオスクの画面更新
   - 取込処理
   記録するのは次のもの。
   - 応答時間
   - エラーの割合
   - DB 接続の待ち
   - CPU、メモリ、swap
3. 合格の基準は次の4つを案とし、測る前にユーザーと決める。
   - キオスクの主な API の p95（95%の要求がこの時間内に返る値）が 1 秒以下
   - 5xx のエラーが 0.1% 以下
   - DB 接続の待ちが続かない
   - swap が試験中に増え続けない
4. 基準を満たさなければ、設定（DB 接続の上限、回数の上限、メモリ）を変える PR を出す。
5. 結果を KB に書き、1年ごとに同じ測定を繰り返す。

確かめ方: 同じ条件で2回流し、結果の差が小さいことを見てから判断する。

### 優先6: 人向けの入口と古い記述の修正（観点6）

持ち主: 文書は Claude/Codex。契約と管理者の名義の情報はユーザーが出す。

まず決めること: 入口の文書を誰向けに書くか。社内の次の担当者を想定する。

やること。

1. `docs/guides/operator-handbook.md`（新規）に、毎週・毎月・毎年することと、それぞれの手順書へのリンクを1枚で並べる。年次点検の手順もここに書く。年次点検で見るのは次のもの。
   - 期限台帳
   - 機械の台帳
   - 容量
   - 負荷の測定
   - CI の実行環境
   - Android の要件
2. `README.md:72` の古い更新経路を、今の標準手順（`docs/guides/deployment.md`）へのリンクに直す。
3. `docs/security/system-inventory.md` から、止めた Ubuntu LocalLLM 機の記述を全部外す（26行目付近をはじめ約10か所）。
4. 契約と管理者の台帳を作る。秘密は書かず、名義、更新日、管理者だけを書く。期限台帳と同じ文書にしてもよい。
5. Mac の見張りを別の Mac へ移すときの手順を、`docs/runbooks/mac-pi5-watchdog.md` に足す。

確かめ方:

- 入口の文書から、毎週・毎月・毎年の各作業の手順書へ、リンクで1回でたどれる。
- 次のコマンドで、使っていない機械の記述が残っていないことを見る。

        rg -n "Ubuntu LocalLLM" docs/security/system-inventory.md

## 要実測の一覧（まとめて1回許可を得る）

どれも読み取り専用で、本番の動作は変えない。秘密や `.env` は読まない。実行の前に、この一覧をそのままユーザーに見せて許可を得る。`sudo` でパスワードの入力が出る場合は、どの機械かを言ってユーザーに入れてもらう。

1. 写真の削除が入っているか、動いた跡があるか（Pi5）。crontab の中身を丸ごと出すと秘密が混じるおそれがあるので、名前で絞る。

        sudo grep -rn cleanup-photos /etc/crontab /etc/cron.d /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /var/spool/cron 2>/dev/null
        systemctl list-timers --all | grep -i photo
        ls -l /var/log/photo-cleanup.log 2>/dev/null && tail -n 20 /var/log/photo-cleanup.log

2. 機械と OS の版（全機）

        cat /etc/os-release
        cat /proc/device-tree/model
        uname -r
        uname -m
        dpkg --print-architecture
        docker version --format '{{.Server.Version}}'
        docker compose version
        tailscale version

   Pi4 と Pi5 だけ、次も見る（Pi3 には EEPROM が無い）。引数なしは確認だけで、更新はしない。

        sudo rpi-eeprom-update

   Docker が入っていない機械では、Docker の2行を飛ばす。

3. データの大きさ（Pi5）

        df -h
        docker system df
        sudo du -sh /opt/RaspberryPiSystem_002/storage/photos/*

   DB の表ごとの大きさを見る。DB コンテナ（compose のサービス名 `db`、利用者 `postgres`）の中で、次の読み取り専用の問い合わせを流す。動いている compose のファイル名は、測るときに `docker compose ls` で確かめる。

        docker compose -f <動いている compose のファイル> exec -T db psql -U postgres -d borrow_return -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 30;"

4. 証明書の終了日（Mac から）。`PI5_HOST` に Pi5 の Tailscale 名を入れてから流す。

        PI5_HOST=<Pi5のTailscale名>
        openssl s_client -connect "$PI5_HOST:443" -servername "$PI5_HOST" </dev/null 2>/dev/null | openssl x509 -noout -enddate -issuer

5. Tailscale の鍵の期限（ユーザーが管理画面で見る）。Tailscale の管理画面の Machines の一覧で、各ノードに「Expiry disabled」と出ているかを見る。

## Concrete Steps

各優先項目は、作業用の worktree と feature branch で始める（`python3 -m scripts.git_lifecycle.cli start`。詳細は `.cursor/rules/20-git-workflow.mdc`）。各項目の確かめ方は「Plan of Work」の中に書いた。

文書の項目を足したら、リンク先のファイルがあるかを確かめる。

    for f in docs/runbooks/expiry-ledger.md docs/runbooks/hardware-ledger.md docs/guides/operator-handbook.md; do test -f "$f" && echo "ok $f" || echo "missing $f"; done

期待: 作り終えたものは `ok` と出る。

## Validation and Acceptance

この計画全体が終わったと言えるのは、次がすべて満たされたときである。

- 期限台帳に、優先2aで決めた10種類の行がすべてある。各行に、期限の日、次に見る日、持ち主、手順書がある。
- 証明書の期限と時刻のずれの判定が、日付を差し替えた単体テストで、30日前に通知を出す。
- 写真の削除について、次の2つが満たされている。
  - テストで確かめた: 保持期限より古い月だけを消し、今年の月と、使用中の写真を消さない。
  - 本番では: 2027-01 より前に、古い起動役が止まっているか、無いことを確かめた。新しい起動役は、試し運転の記録を一度出した。
- データの種類ごとに保持期限が決まっている。10年後の容量の見積もりがこの文書にあり、Pi5 と Google Drive のどちらも、3年先まで余裕があるか、増設の時期が決まっている。
- 機械の台帳の行の数が、本番機の数と一致している。全機に交換予定日がある。
- 100台相当の負荷の測定結果が KB にあり、優先5で決めた基準を満たしている。満たさなかった点は、直す PR がマージされている。
- 人向けの入口から、毎週・毎月・毎年の作業の手順書へたどれる。
- 年次点検を1回、入口の文書の手順どおりに通して回し、この文書の「Outcomes & Retrospective」に結果を書いた。

## Idempotence and Recovery

この文書の更新と台帳づくりは、何度やり直しても害が無い。要実測のコマンドは、すべて読み取り専用である。

写真や古いデータを消す処理は、消したら戻せない。そのため、次の順で進める。

1. 初回は対象の一覧と件数だけを記録する。
2. 消す対象の写真が Google Drive の退避（`docs/runbooks/google-drive-disaster-recovery.md`）に含まれているかを確かめる。
3. 一覧を見てから消す。

chromium の段階的な更新は、先に当てた1台で異常が出たら、残りには当てずに前の版へ戻す。

## Artifacts and Notes

- 調査の根拠は、各観点の「今あるもの」と「足りないもの」に path:line で書いた。
- 2026-10-21 の監査メモ（別の会話のメモ）で見つかった、保持期限の無いデータと全件を返す API を観点3に取り込んだ。行は 2026-11-15 に確かめ直した。
- 10年後の容量の見積もりは、要実測の項目3の結果が出たらここに書く。

## Interfaces and Dependencies

- 通知は、既存の通知の経路（キオスクのフローティングチャット）を使う。新しい外部サービスは足さない。
- 機械で確かめる期限と時刻の判定は、既存の定期処理（API の日次処理、status-agent）に載せる。新しい常駐プロセスは足さない。
- 負荷試験の道具は `scripts/perf/` に置き、標準デプロイには含めない。
- DGX Spark の Control Plane（`denkoushi/DGXSparkControlPlane`）が持つものは、この計画で扱わない。
- 標準デプロイ（`scripts/update-all-clients.sh`）の手順は変えない。

---

改訂履歴

- 2026-11-15: 初版。6観点の調査結果、優先順位、要実測の一覧を書いた。
- 2026-11-15: Fable、Opus、Codex の独立レビューを反映した。
  - 写真の削除について、起動役の不具合を書き足し、取り逃しの回収と使用中の写真の除外を加えた。
  - 抜けていたリスクを足した。chromium の一斉自動更新、時刻のずれ、外部サービス、Pi3 の 32bit の問題、Pi5 の swap、電源と冷却、CI の実行環境、Android、戻せる版の下限。
  - 引用のずれを直した。system-inventory、回数の上限の単位、保持処理、外部接続の台帳の行、見張りの行、software-support 計画の日付。
  - 100台計画と重なる予備機、旧ノード、媒体の選び方をリンクに変えた。
  - 優先2を3つに分け、期限付きの行を Progress に出した。
  - 各優先項目に確かめ方を、受入条件に数字の基準を足した。
  - 要実測のコマンドを、秘密が出ない形と、そのまま動く形に直した。
