# 古いソフトのサポート期限対応(期限の近い順)


本書は `.agent/PLANS.md` に従う実行記録である。Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を作業に合わせて更新する。

## Purpose / Big Picture


2026-10-21 の「10年持つか」の構造点検で、業務システム(Pi5 サーバーと Raspberry Pi 群)が使うソフトのいくつかがサポート期限に近い、または既に過ぎていると分かった。サポートが切れたソフトには脆弱性の修正が出なくなり、10年使い続ける前提が崩れる。本書は対象ごとに、今の版、上げる先、サポート期限、影響範囲、危険度、戻し方を一覧にし、期限の近い順に1件ずつ更新するための計画である。1つの PR には1つのソフトの更新だけを入れる。

完了の姿は、一覧の各行が「更新済み(main の SHA と本番反映の run ID 付き)」か「次に着手する理由つきで保留」のどちらかになっている状態である。

この計画の範囲外は次のとおり。DGX の管理側(`denkoushi/DGXSparkControlPlane`)、個人用 Pi5(Hermes/Discord)、Raspberry Pi OS 自体の版上げ、外部提供の `nousresearch/hermes-agent` イメージの更新。

## 対象一覧


サポート期限は 2026-10-25 時点で各プロジェクトが公表している終了日である。「影響範囲」は版指定を書き換えるファイルと、動作が変わる機器を指す。危険度は、失敗したときに業務が止まる広さと、戻しの難しさで決めた。

    | # | 対象 | 今の版 | 上げる先 | サポート期限 | 影響範囲 | 危険度 | 戻し方 |
    |---|---|---|---|---|---|---|---|
    | 1 | Node.js(業務Hermesの中継部品 egress 2個) | node:20-alpine(digest固定) | node:24-alpine(digest固定、LTSは2028-04まで) | 2026-04-30 終了済み | infrastructure/docker/docker-compose.phase3.yml、infrastructure/ansible/inventory.yml、roles/release_pi5/defaults/main.yml、templates/docker.env.j2、テスト2本、runbook。Pi5 の business-hermes-egress と business-hermes-chat-egress だけ | 低〜中(Hermes の案内と相談が入れ替え中に数十秒止まる。API/Web と締付業務は止まらない) | digest を元に戻す commit を入れ、同じ入れ替え許可指定つきで標準反映 |
    | 2 | Prisma(DB接続ライブラリ) | 5.22.0 | 7.x(prisma@7 に固定。8 は GA 直後なので見送り) | 5 系は保守終了済み(6 系も 2026-11-19 で終了) | apps/api の全DBアクセス、prisma/schema.prisma、migrate 実行、API イメージ | 中〜高(7 は Rust エンジン廃止で接続設定と生成コードが変わる。全APIに影響) | lockfile と package.json を戻す commit で標準反映。DB スキーマは変えない方針で進め、migration を伴わせない |
    | 3 | Debian 12 bookworm(API・kiosk-sop の node:24-bookworm-slim の土台) | bookworm | trixie(Debian 13) | 通常保守は 2026-06-10 終了、LTS は 2028-06-30 まで | infrastructure/docker/Dockerfile.api、Dockerfile.kiosk-sop-generator | 中(ネイティブ依存のビルドが変わる) | digest を戻して標準反映 |
    | 4 | Python 3.11(NFC・バーコード・トルクの各 agent イメージ、hermes-answer-cache) | python:3.11-slim、pyproject は ^3.11 | python:3.13-slim(サポートは2029-10まで) | 2027-10 | infrastructure/docker/Dockerfile.nfc-agent、Dockerfile.barcode-agent、Dockerfile.torque-agent、services/hermes-answer-cache/Dockerfile、clients/*/pyproject.toml と lock。Pi4 群とキオスク端末 | 中(端末の読取りが止まると貸出・締付の現場作業に響く) | 前のイメージタグへ戻して Pi4 へ再反映 |
    | 5 | PostgreSQL 15(pgvector/pgvector:pg15) | 15 | 18(pgvector/pgvector:pg18、pgvector 0.8 系) | 2027-11-11 | infrastructure/docker/docker-compose.server.yml、docker-compose.mac-local.override.yml、.github/workflows/ci.yml と torque-release.yml、本番DBのデータ領域 | 高(本番データの移行を伴う) | 旧データ領域を消さずに残し、旧 pg15 コンテナへ切り戻す。移行前の pg_dump から復元も可能 |
    | 6 | React 18(apps/web) | 18.2 | 19 | 公式の終了日なし。新機能と修正は 19 系のみ | apps/web 全画面 | 中 | package.json と lockfile を戻す |

点検メモにあった ESLint 8 は、既に 9.39.5 へ更新済みのため対象から外す。TypeScript 5.4、Vite 6、Alpine 3.24、Go 1.27 は現時点で期限が近くないため一覧に入れない。

## 進める順番と理由


期限の近い順は 1(終了済み)、2(保守終了済み)、3(LTS 期間中)、4(2027-10)、5(2027-11)、6(期限なし)となる。PostgreSQL は期限が最後のほうでも準備に時間がかかるので、4 と並行して試し移行だけ早めに始める。

## 各項目の手順


### 1. Node.js 20 の中継部品(egress)

業務 Hermes は、外部への通信を中継部品(egress proxy、`infrastructure/docker/business-hermes-egress/proxy.mjs` を Node で動かすだけのコンテナ)経由でしか行えない作りになっている。組立ガイド用の `business-hermes-egress` と相談チャット用の `business-hermes-chat-egress` の2個があり、どちらも `node:20-alpine` を digest で固定している。proxy.mjs は `node:net` と `node:http` だけを使い、Node 24 で変わる機能に依存しない。

注意点として、標準反映(`infrastructure/ansible/roles/release_pi5/tasks/prepare.yml` の「Refuse to replace an independent business Hermes egress image during API/Web rollback window」と、`business-hermes-chat-prepare.yml` の「Preserve the fixed image boundary for existing consultation containers」)は、動いている中継部品のイメージが今回の指定と違うと、入れ替えを拒否して反映全体を失敗させる。これは API/Web を戻す途中で Hermes 側が勝手に変わらないようにする安全装置で、この digest は導入(#1350)以来一度も更新されていない。digest だけを差し替えると、以後の標準反映がすべてここで止まる。

そこで、入れ替えを明示的に許可する一回限りの指定を標準反映に追加する。既定は「許可しない」のままで、指定したときだけ上の2つの拒否を外し、新しいイメージで中継部品を作り直す。反映が途中で失敗した場合の戻しは既存の rollback(`rollback.yml` と `business-hermes-chat-rollback.yml`)が前のイメージで作り直すことを確認し、足りなければ追加する。

digest は記憶で書かず、公式の multi-arch index の digest と Pi5 向け arm64 manifest の digest をレジストリから取得して両方を runbook に記録する。

受け入れ条件は、関係テスト(`scripts/deploy/tests/` の該当テストと `test_ansible_standard_release.py`)が通り、既定では拒否が働き、許可指定のときだけ外れることがテストで確かめられ、CI が緑であること。本番反映は進行管理役の会話が、許可指定つきで1回だけ行う。

### 2. Prisma 5 → 7

別 PR で行う。prisma と @prisma/client を 7 系に固定し、7 で必要になる接続アダプタ(PostgreSQL 用ドライバアダプタ)と生成先の設定を加える。DB スキーマと migration は変えない。CI の API テスト一式と migration 検証が通ることを受け入れ条件とする。8 系の CLI は schema.prisma を読まないため、`npx prisma` で最新を引かないよう版を固定する。

### 3. Debian bookworm → trixie

別 PR で行う。node:24-trixie-slim の digest に差し替え、API イメージと kiosk-sop 生成イメージのビルド、API テスト、kiosk-sop の生成確認を通す。

### 4. Python 3.11 → 3.13

別 PR で行う。Pi4 へ配るファイルは、main の最新がその変更の commit である間に全 Pi4 へ反映しないと届かないため、マージ後は他の PR をマージする前に Pi4 全台の反映を終える。端末ごとの文字コード(EUC-JP の端末がある)にも注意する。

#### 4-1. 影響範囲(2026-10-30 調査)

書き換えるのは次の4つのイメージの土台だけである。

- `infrastructure/docker/Dockerfile.nfc-agent`、`Dockerfile.barcode-agent`、`Dockerfile.torque-agent`。各3段(lock-export、builder、runtime)とも `python:3.11-slim`。CI の `pi4-agent-images-publish` が `linux/arm64` と `linux/arm/v7` を作り、`ghcr.io/denkoushi/raspisys-{nfc,barcode,torque}-agent:<main の SHA>` として push する。端末上ではビルドせず、role `release_kiosk` が pull して `docker compose --no-build` で切り替える。
- `services/hermes-answer-cache/Dockerfile`(`python:3.11-slim`、arm64 のみ)。Pi5 の `business-hermes-answer-cache` で動き、role `release_pi5` が digest 付き参照で配る。Pi4 には関係しない。

対象外は次のとおり。status-agent、haizen-agent、zero-edge-agent は端末の OS の `python3` で動くため、OS の版上げ(本計画の範囲外)に従う。`clients/haizen-agent/pyproject.toml` も OS の Python 用である。

agent が動く端末(inventory の `kiosk` グループ):

- NFC のみ: raspberrypi4、raspi4-robodrill01、raspi4-fjv60-80、raspi4-sessaku-01、raspi4-kensaku-02、raspi4-assembly-02
- NFC とトルク: raspi4-assembly-01
- NFC、バーコード、トルク: raspi4-kensaku-stonebase01(3つ全部が動く唯一の端末)
- raspberrypi3(サイネージ)は agent イメージを使わない。

事前の読み取り確認(2026-10-30 21:38、Pi5 から uname・docker ps・curl のみ):

- Pi4 の 8 台はすべて aarch64(dpkg arm64)。armv7 の端末は無い。CI は両方を作るが、実際に届くのは arm64。
- 8 台とも現在の agent イメージは c452a53c。nfc-agent の `readerConnected` は 8 台すべて true。
- stonebase01: torque-agent は healthy で `/health` 200。barcode-agent は Up で `readerConnected` false(リーダー未接続のため。反映後も false のままなら正常)。
- assembly-01: torque-agent は healthy で `/health` 200。
- ほかの 6 台は nfc-agent だけが動いている。

#### 4-2. 依存の確認(Mac の Docker で試しビルド)

- 3つの agent を `python:3.13-slim`(3.13.18)へ差し替え、今の poetry.lock のまま arm64 と arm/v7 の両方でビルドした。6本とも成功し、各イメージで主要モジュール(nfc は smartcard・evdev・uvloop・httptools・fastapi、torque は evdev・uvloop・fastapi、barcode は serial・uvloop・fastapi)の import を確かめた。所要は arm64 が約1分、arm/v7 が 10〜13 分(QEMU、キャッシュなし)。
- C 拡張: pyscard 2.3.1 と evdev 1.9.3 は Linux 用 wheel が無くソースからビルドするが、3.13 でも両アーキテクチャで通った。uvloop、httptools、pyyaml は armv7 用 wheel が無く QEMU でコンパイルされる(3.11 でも同じ)。pydantic-core と watchfiles は cp313 の wheel がある。
- poetry.lock は作り直さない。lock には既に cp313 の wheel が載っており、`^3.11` の制約は 3.13 を含む。作り直すと全パッケージの版が動き、今回の変更が「Python の版」だけでなくなるため。
- 3.13 と 3.12 で消えた標準モジュール(cgi、telnetlib、imghdr、distutils、asyncore など)は、clients/ と services/hermes-answer-cache/ で import されていない。
- テストを 3.11 と 3.13 で同じ条件で比べた。nfc-agent は両方 6 件合格。torque-agent は両方 82 件合格・1 件失敗(`test_capture_kit.py` の replay の安全確認。コンテナを root で動かしたための環境由来で、3.11 でも同じく失敗する)。barcode-agent はテストが無く、import を確かめた。
- hermes-answer-cache は 3.13 でイメージを作り、faiss・gptcache・fastembed・SQLAlchemy の import と、埋め込みモデルの焼き込みが通った。テスト 53 件合格。

#### 4-3. 端末固有の注意

- raspi4-robodrill01 と raspi4-kensaku-stonebase01 は `ja_JP.EUC-JP`。コンテナ内の Python はホストのロケールに依存しないが、Ansible の手作業の読み取りでは先に `LC_ALL=C.UTF-8` にする。
- Pi4 に届くのは main の HEAD の SHA のイメージだけである。マージ後、Pi4 全台の反映が終わるまで他の PR をマージしない。試しの1台で確認を待つ間も、この止めは続く。
- イメージの pull が `lookup ghcr.io ... server misbehaving` で失敗したら、その端末の `/etc/resolv.pre-tailscale-backup.conf` が空になっていないかを見る。切り替え前の失敗なので、端末は前の版のまま動き続ける。
- 標準反映の正常確認は、各 agent の HTTP 応答(nfc と barcode は `/api/agent/status`、torque は `/health`)が 200 かどうかだけを見る。読取機が実際につながっているかは見ないので、反映の前後で `/api/agent/status` の `readerConnected` を比べ、さらに現場でカードを1回読ませて確かめる。

#### 4-4. 戻し方

- 反映中の失敗(pull、切り替え、HTTP 確認): role `release_kiosk` が切り替え前に今のイメージへ `raspi-standard-rollback:<run_id>-<agent>` の印を付け、失敗時はそのイメージで `--no-build` 起動し直す。自動で前の 3.11 版に戻る。
- 反映後に不具合が分かった場合: 標準反映は main の HEAD しか配れないため、この PR を取り消す commit を main に入れ、CI が 3.11 のイメージを新しい SHA で作るのを待ち、Pi5 と該当 Pi4 を標準反映し直す。armv7 のビルドキャッシュは 3.13 で上書きされているため、取り消しの CI は KB-414 と同じく 1 時間近くかかる見込みである。その間、読取りの止まった端末は手作業での記録で運用する。
- 戻せることの確かめ方: 試しの1台の反映で、run の記録に rollback 用の印付けが成功していること(`Capture current Pi4 agent images as temporary rollback tags` が ok)を確認する。取り消し commit による戻しは本番では試さず、PR の CI で 3.11 と 3.13 の両方のイメージが作れることをもって代える。

#### 4-5. 反映の進め方

1. PR をマージし、main の CI(3 agent × 2 アーキテクチャと hermes-answer-cache)が緑になるのを待つ。
2. 反映前に、全 Pi4 の CPU の種類(`uname -m`、`dpkg --print-architecture`)と各 agent の `readerConnected` を読み取りだけで記録する。
3. Pi5 を標準反映する(hermes-answer-cache が 3.13 になる)。
4. 試しの1台として raspi4-kensaku-stonebase01 を `--limit` で反映する(2026-10-30 ユーザー指示)。3つの agent がすべて有効だが、今つながっている読取機は NFC リーダーだけである。EUC-JP の端末なので、手作業の Ansible の読み取りには `LC_ALL=C.UTF-8` を付ける(標準反映の role は対応済み)。現場の人が立ち会える時間に行う。
5. stonebase01 の確認(反映後すぐ):
   1. 読み取りだけで、3つの agent の HTTP 応答が 200 であること、NFC の `readerConnected` が反映前と同じ(true)であること、バーコードとトルクのコンテナが再起動を繰り返していないことを見る。
   2. 現場で NFC カードを1回読ませ、キオスクの画面に読み取りが出ることを確かめる。実機での確認はこの1回だけ。
   読めなければ、4-4 の手順で戻す。
6. 問題がなければ、raspi4-assembly-01 を反映する。トルクレンチを実機で確かめられる端末で、NFC カードの読み取りとトルクレンチの1回の締め付けを現場で確かめる。トルクの部品は Bluetooth の入力を evdev で読むので、ここで初めて実機の入力を通す。
7. NFC だけの6台(raspi4-kensaku-02、raspi4-sessaku-01、raspi4-fjv60-80、raspi4-assembly-02、raspberrypi4、raspi4-robodrill01)を1台ずつ反映し、それぞれ `readerConnected` を読み取りで確かめる。robodrill01 も EUC-JP の端末である。
8. 全台終わるまで main への他のマージを止める。

読取機がつながっていない部品の扱い: 3つの部品とも、読取機が無くても起動し、状態確認(nfc と barcode は `/api/agent/status`、torque は `/health`)は 200 を返す。読取機の有無は応答の中の `readerConnected` などに出るだけで、標準反映の正常確認は失敗しない。barcode のコンテナは `/dev/ttyACM0` を個別に割り当てず `privileged` で動くため、装置が無くても起動できる。torque は Bluetooth の入力が無いと待ち直しを続ける作りである(`hid_reader.py`)。

バーコードを実機で確かめられる端末は今は無い(バーコードの部品が有効なのは stonebase01 だけで、読取機はつながっていない)。代わりに、3.13 のバーコード部品のイメージ(arm64 と arm/v7)の中で仮の端末(pty)を `SERIAL_DEVICE` に指定し、1行流すと `readerConnected: true` と `lastLine` に届くことを Mac で確かめた。バーコードの読取機を再びつなぐときに、現場で1回読ませて確かめる。

### 5. PostgreSQL 15 → 18

本番データに触るため、本番 DB の移行(手順 5)は実行の直前にユーザーの明示承認を得る。計画と準備(手順 1〜4)の承認は、本番移行の承認を含まない。

**上げる先は PostgreSQL 18(`pgvector/pgvector:pg18`)とする。** 18 は 2025-09 公開で、コミュニティのサポートは 2030-11 まで。19 は 2026-10-15 に RC1 が出たばかりで、正式版は 2026-11-19 の予定のため選ばない。

**今の構成(2026-10-27 時点の main)**

- 本番 DB は業務 Pi5 の `db` コンテナ(`pgvector/pgvector:pg15`)で、データは Docker ボリューム `db-data`(`/var/lib/postgresql/data` に mount)。DB は `borrow_return` の1つ。
- 拡張は `vector`(pgvector)と `pg_trgm`。
- DB ユーザーは superuser の `postgres` のほかに、migration 用とアプリ用のロールがある(`scripts/deploy/postgres-role-bootstrap.sql`)。`pg_dump` は DB 単位でロールを含まないため、ロールは `pg_dumpall --globals-only` で別に取る。
- 日常のバックアップは `scripts/server/backup.sh`(`/opt/backups` に `pg_dump` を gzip)。全損対策は Google Drive の restic スナップショット(`pg_dump -Fc`)。
- pg15 を指定している箇所: `docker-compose.server.yml`、`docker-compose.mac-local.override.yml`、`.github/workflows/ci.yml`、`torque-release.yml`、`scripts/ci/rehearse-release-runtime.sh`、`scripts/test/*`、`scripts/deploy/tests/*`(DR の復元検証を含む)、`scripts/kiosk-sop/validate-db-contract.sh`。
- 検証用の staging Pi5 は inventory に枠があるだけで実機はない。トークプラザ工場の Pi5(`inventory-talkplaza.yml`)にも DB があるので、稼働していれば別日に同じ手順で移す。

**移し方は「ダンプして新しい空の pg18 に復元する」方式にする。** 次の理由で、ボリュームをそのまま変換する `pg_upgrade` は使わない。

- `pg_upgrade` は 15 と 18 の両方のプログラムが1つのコンテナに必要で、公式イメージだけではできない。
- 18 は新しく作る DB でデータのチェックサムが既定で有効になり、チェックサムなしの 15 からは `pg_upgrade` が拒否する。
- 土台の OS が変わると文字の並び順(collation)の定義が変わることがある。復元なら索引が作り直されるので影響しない。
- DB は1つで、Pi5 の規模なら復元の時間は短い見込み(手順 3 で測る)。

**注意: 公式イメージの 18 はデータの置き場所が変わる。** PGDATA が `/var/lib/postgresql/18/docker` になり、mount 先は `/var/lib/postgresql` が推奨になった。古い mount 先のまま 18 を起動すると、起動に失敗するか、空の DB を新しく作ってしまう。そこで、新しいボリューム `db-data-pg18` を `/var/lib/postgresql` に mount する。旧 `db-data` は compose に宣言したまま残し、消さない。

**最大の危険は、compose の版だけ変えて標準反映すること。** 標準デプロイ自体は `db` を再作成しないが、明示的な `up -d db` で空の pg18 が起動すると、API の `migrate deploy` が空の DB に表を作り、画面上はデータが消えたように見える。これを防ぐため、手順 2 の起動前チェックを先に入れ、本番の compose を切り替える PR は移行の当日にだけマージする。

**手順**(PR は 1〜2 と 4 が別。どれも1つのソフト更新の準備として扱う)

1. **CI とテストを pg18 にそろえる PR。** 本番以外の pg15 の指定(CI、torque-release、リハーサル、テスト用スクリプト、DR の復元検証、mac-local)を `pgvector/pgvector:pg18` に替える。新しい `pg_restore` は古い形式のダンプも読めるので、DR の検証は本番が 15 のままでも通る。全 migration が 18 で通り、API テスト、ロール境界テスト、DR の統合テストが成功することを受け入れ条件とする。本番の compose はまだ変えない。
2. **移行用の手順書とスクリプトの PR。** 次の3つを入れる。
   - `scripts/server/postgres-major-upgrade.sh`。止める、取る、復元する、比べる、切り替える、を1本で行い、どこかで失敗したら止まる。
   - DB の起動前チェック。新しいボリュームが空で、旧 `db-data` にデータがあるときは起動を止める。誤って空の DB で動き出すのを防ぐ。
   - [Runbook](../runbooks/postgres-15-to-18-upgrade.md)。
3. **試し移行(手元の Mac、arm64)。** Mac は Pi5 と同じ arm64 なので、ここで試す。
   1. 本番から読み取りだけでダンプを取る。`pg_dumpall --globals-only` と `pg_dump -Fc` の2つ。
   2. 本番 DB の大きさと Pi5 の空き容量を測る(読み取りのみ)。空き容量は、DB の大きさの2倍にダンプの分を足した量を目安とする。
   3. Mac で pg15 を作って復元し、移行前の状態を再現する。そこからスクリプトで pg18 へ移す。
   4. 次を確かめる。全テーブルの件数の一致、拡張の版(`vector`、`pg_trgm`)、ロールと権限、sequence の現在値、`prisma migrate status` が最新であること、API の主要画面と検索(pgvector)。あわせて所要時間を測る。
   5. 戻す手順(旧ボリュームへ切り替える)も1回試す。
   6. 本番データの写しは使い終わったら Mac から消す。
4. **本番の compose を切り替える PR。** `db` の image を pg18 にし、mount を `db-data-pg18:/var/lib/postgresql` にする。旧 `db-data` の宣言は残す。手順 3 の結果を PR に書き、マージは手順 5 の当日に進行管理役が行う。
   - Dockerfile.api の `postgresql-client-15`(API バックアップの pg_dump)を切替 PR までに18へ更新する。pg_dump 18 は15のサーバーも扱えるので先行更新できる。
5. **本番移行(ユーザーの明示承認のあとにだけ行う)。**
   1. 業務が止まってよい時間帯をユーザーと決める。目安は手順 3 で測った時間の3倍。
   2. 開始前に、`backup.sh` の手動実行と、globals と `-Fc` のダンプを Pi5 の外(Mac)へ1部ずつ保管する。
   3. API と Web を止めて書き込みを止める。
   4. スクリプトで新しいボリュームへ復元し、件数を比べる。
   5. 手順 4 の PR をマージして標準反映する(運用順序はRunbookに従い、クライアント停止前に行う)。標準デプロイは `db` を再作成しないため、旧 `db` を停止し、スクリプトの `activate --expect-major 18 --work-dir <dir>` で切り替える。
   6. health、主要画面、`migrate status` を確かめる。
   7. 業務を再開する前に、進めるか戻すかを決める。
6. **後片付け。** 旧 `db-data` は少なくとも2週間残す。その間に DR スナップショットを1回取り、Google Drive からの復元検証を pg18 で通す。消すのは、ユーザーの承認を得て別の作業で行う。

**戻し方**

- 業務を再開する前なら、`db` を pg15 と旧 `db-data` に戻して(手順 4 の PR を revert して)、スクリプトの `activate --expect-major 15 --work-dir <dir>` で起動・比較する。旧ボリュームには一切書き込んでいないので、データは移行の直前のまま。
- 業務を再開した後に戻すと、再開後に書き込まれたデータが旧ボリュームに無い。そのため、戻すかどうかは再開前に決める。再開後に重い問題が出たときは、pg18 から取ったダンプを pg15 へ入れられるか試してから判断する(版を下げる復元は、うまくいく保証がない)。
- 最後の手段は、移行直前のダンプ(Pi5 の外にある写し)から pg15 に復元すること。

### 6. React 18 → 19

別 PR で行う。期限がないため最後に回す。

## Progress


- [x] (2026-10-25) 点検会話の結果を読み、リポジトリの版指定を調べて一覧を作成。
- [x] (2026-10-25) ユーザーが1件目に Node 20 の中継部品を選んだ。
- [x] (2026-10-25) node:24-alpine(index sha256:06d7adf3…、arm64 manifest sha256:398bcf38…、Node v24.22.1)へ差し替え、旧 Node 20 の pin を `release_pi5_business_hermes_egress_replaceable_images` に登録。ガイド用は既存の作り直し経路、相談用は戻し時に旧イメージを指定するよう変更。proxy テスト 7/7、Docker 上の権限テスト成功、deploy テスト 151 件成功。
- [x] (2026-10-25) 1件目 PR #2287 をマージ(e98e40bc)。Brotli 対応の #2289 と同時に Pi5 へ反映(main fa13444e、run 20261025-014627-11001b、成功)。
- [x] (2026-10-26) ユーザーが2件目の Prisma 5→7 に進むことを選んだ。prisma・@prisma/client・@prisma/adapter-pg を 7.10.1 に固定し、pg のドライバアダプタへ切り替える PR を作成。スキーマと migration は変えない。
- [x] (2026-10-26) #2300 は main e111ad83 にマージ後、release-api-image で API イメージの圧縮サイズ予算を約 7MB 超えた(1107188550 > 1100000000、run 40257094214)。Pi5 反映前に #2304 で取り消した(main 65b101a7)。
- [x] (2026-10-26) 入れ直しの PR を作成。API イメージから PostgreSQL 以外のクエリコンパイラ(wasm)と source map を消し、圧縮後で約 29MB 減らす見込み。
- [x] (2026-10-26) 入れ直しの #2306 をマージ(main 4f9d5030)。main で API イメージの圧縮サイズは 1078539311 バイトで予算内。Pi5 へ反映(run 20261026-044219-700883、失敗 0)し、API で prisma 7.10.1 と migrate status が最新(240 件)であることを確認した。
- [x] (2026-10-27) ユーザーが次に PostgreSQL 15 の更新へ進むことを選んだ(計画と準備までの承認。本番移行は別に承認を得る)。5 の手順を詳しく書いた。

- [x] (2026-10-25) Brotli の脆弱性(CVE-2026-111497)対応として、API と kiosk-sop 生成の node:24-bookworm-slim を Node 24.21.0 の digest(sha256:2fe369e9…)から Node 24.22.1 の digest(index sha256:55fb5f5a…)へ差し替える別 PR を作成。土台は bookworm のままで、3件目の trixie 化とは分ける。
- [x] (2026-10-29) PostgreSQL更新の手順2として、移行・比較・activateスクリプト、空DB初期化ガード、契約/ガード/E2Eテスト、[Runbook](../runbooks/postgres-15-to-18-upgrade.md)を追加。本番composeとDockerfile.apiは変更せず、切替は手順4で行う。

- [x] (2026-10-29) PostgreSQL更新の手順3として、Macで読み取り専用の本番ダンプを使い試し移行・切戻しを実施。本番はPostgreSQL 15.17、DB 5.7GB、custom dump 242MB（SSH経由150秒）、コピーの復元82秒。preflight 3秒、migrate 100秒、停止＋activate 18は5秒、切戻しの停止＋activate 15は4秒。284行の比較レポートと拡張版（vector 0.8.7 / pg_trgm 1.6）は一致。Pi5は遅くなる見込みのため、保守時間は1時間を確保する。
- [x] (2026-10-29) 手順4の切替PR用に、本番composeをpg18・新ボリューム・旧ボリュームread-only・起動ガードへ変更し、APIのPGDGクライアントを18へ更新。マージは移行当日のみ（Runbookの当日手順2）。標準デプロイはdbを再作成せず、migrate後に運用者が `activate --expect-major 18` で切り替える。本番移行は未実施。
- [x] (2026-10-30) 本番移行を実施（切替PR #2398、修正PR #2404）。7:41の初回は旧dbコンテナがパスワードを環境変数で持ちmigrateが停止、自動でpg15へ戻した（停止約20秒、データ変更なし）。修正後、17:50開始で一括実行しRESULT=OK。Pi5の停止区間は719秒（migrate 579秒、activate 18は8秒、API/web再開100秒、migrate status確認19秒）。比較レポートの差分なし、PostgreSQL 18.6。旧ボリュームdb-dataは残し、移行時のダンプはMacへ写してsha256一致を確認。
- [x] (2026-10-30) 3件目の Debian trixie 化: API と kiosk-sop 生成の基盤を node:24-trixie-slim(Node 24.22.2、index `sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446`、arm64 manifest `sha256:7924b020d1e9972de4d7838a7a8ab8c54ef0d6e51435d6a7d1dfa73c6f106241`)へ替え、PGDG を trixie-pgdg、t64 の部品名、最低版チェックを trixie の版に直した。Mac(arm64)で API イメージを作り、Debian 13.7・pg_dump 18.6・Python 3.13.5・ndlocr-lite・rapidocr・ansible・ffmpeg・pdftoppm が動くことを確認。圧縮サイズの手元見積もりは合計 1078966439 バイト、最大の層 619208532 バイト、33 層で予算内。kiosk-sop は生成照合と画面テスト 18 件が合格し、ソースのダイジェストだけ更新した。

## Surprises & Discoveries

- trixie の python3-yaml(PyYAML 6.0.2)は pip で消せず、PyYAML 6.0.1 を指定する ndlocr-lite の導入が止まった。PyYAML 6.0.1 を `--ignore-installed` で先に pip 側へ入れて回避した。

- Node 20 は 2026-04-30 でサポートが終わっており、点検時点で既に期限切れだった。
- 業務 Hermes の中継部品は、標準反映がイメージの入れ替えを拒否する作りで、更新の通り道がまだ無い。
- ESLint は既に 9 系へ更新済みだった。
- 本番のdbコンテナは `POSTGRES_PASSWORD_FILE` 導入前に作られ、パスワードを環境変数で持っていた。移行スクリプトはComposeのdbのbindからパスワードファイルを取るよう修正した（#2404）。

## Decision Log


- 2026-10-25: 期限切れの Node 20 中継部品を1件目のおすすめにした。範囲が Pi5 の2コンテナに限られ、本番データにも Pi4 群にも触れないため。
- 2026-10-25: Prisma の上げる先は 7 系とした。8 系は GA 直後で、CLI が schema.prisma を読まない大きな変更を含むため。
- 2026-10-25: 中継部品の入れ替えは、新しい実行時指定を足さず、「入れ替えてよい旧イメージ」の一覧を role の既定値に置く方式にした。標準反映をそのまま使え、一覧にない違うイメージは従来どおり拒否されるため。戻すときは、その時点の現行 pin を一覧に足してから pin を戻す。
- 2026-10-26: Prisma 7 の generator は `prisma-client-js` のままにした。`prisma-client` へ移ると全ファイルの import が変わり、1PR の差分が大きくなりすぎるため。移行は別 PR で行う。
- 2026-10-26: Prisma 7 の `@prisma/client` と `prisma` CLI は全データベース用の wasm を同梱するため、Dockerfile.api の本番 install と同じ層で PostgreSQL 以外の分と source map を消す。予算(1.1GB)は上げない。
- 2026-10-26: pg は接続確立と空き接続待ちを1つの上限で扱う。そのため、Prisma 5 の `connect_timeout`(10秒)と `pool_timeout`(20秒)の長いほうを使い、本番で新たにタイムアウトが起きないようにした。
- 2026-10-27: PostgreSQL の上げる先は 18 とした。19 は正式版がまだ出ていない(2026-11-19 予定)ため。
- 2026-10-27: PostgreSQL はダンプと復元で移す。`pg_upgrade` は公式イメージだけでは使えず、18 のチェックサム既定の変更と、OS が変わることによる並び順の変化にも引っかかるため。旧ボリュームは消さずに残して戻し先にする。
- 2026-10-30: Python 3.13 化では poetry.lock を作り直さず、イメージの土台だけを替える。lock は既に cp313 の wheel を含み、3.13 で両アーキテクチャのビルドとテストが通ったため。作り直すと依存の版も一緒に動き、不具合の原因を切り分けにくくなる。
- 2026-10-25: 計画文書は1件目の PR に同梱する。文書は更新そのものではないため「1PR1ソフト」の決まりに反しない。

## Outcomes & Retrospective


各項目の完了時に、main の SHA、本番反映の run ID、戻しが必要だったかを書く。

- 1. Node.js 20 の中継部品: main e98e40bc(#2287)、本番反映 run 20261025-014627-11001b(main fa13444e)。両中継部品が node:24-alpine で healthy。戻しは不要だった。
- (計画外)Brotli 脆弱性 CVE-2026-111497: API と kiosk-sop の node:24-bookworm-slim を Node 24.22.1 の digest へ(#2289)。同じ run で反映し、API の node -v が v24.22.1。
- 2. Prisma 5 → 7: main 4f9d5030(#2306)、本番反映 run 20261026-044219-700883。#2300 は API イメージの容量予算を超えたため #2304 で取り消し、wasm を削って入れ直した。入れ直し後の戻しは不要だった。
