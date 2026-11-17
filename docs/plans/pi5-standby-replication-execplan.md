# 業務用 Pi5 の予備機、PostgreSQL 18 複製、手動切り替えを整える


本書は `.agent/PLANS.md` に従う、M2 の実装前の ExecPlan（実行計画）である。
Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を各段の終了時に更新する。
親計画は [100台計画](fleet-100-scale-gap-execplan.md) の M2 と「1番」である。本書の段は親計画の M 番号と混同しないよう S0〜S8 と呼ぶ。
本書の作成は実装、本番接続、購入、切り替え、commit、push、PR の実行を許可しない。
以下の新しいスクリプト名・オプションは実装予定の契約であり、現在使えるコマンドではない。

## Purpose / Big Picture


中心サーバーが故障しても、業務専用の予備 Pi5 へ人が切り替え、貸出記録と業務ファイルを使って工場の仕事を再開できるようにする。
主とは書き込みを受け付ける DB、予備とは主の変更を受け取る読み取り専用の DB を指す。
PostgreSQL のストリーミング複製とは、変更記録を連続して予備へ送る機能である。
切り替え後、実際のキオスクで貸出・返却、写真・PDF・手順資料の表示を確かめ、停止時間と失った記録の範囲を測る。
DB だけの復旧を成功にせず、ファイル、証明書、端末の接続先、定期処理まで含める。

自動切り替えは入れない。予備は新しい業務専用 Pi5 と SSD であり、個人用 Pi5 は使わない。
見張りは運用者の Mac に置く。これらは親計画の決定済み事項である
（`docs/plans/fleet-100-scale-gap-execplan.md:142-163`）。
許容停止時間（RTO）は再開まで許す時間、許容損失（RPO）は失ってよい直近の記録の時間幅である。
親計画の「十数分、数秒〜数分」は見込みであり保証ではない（同書 `:216-218`）。

## Progress


- [x] (2026-11-15 JST) 公開された設定・スクリプト・既存手順を調べ、計画の下書きを作成。本番の実状態は未確認。
- [x] S0 / PR 1: 手元の Docker で2台を模擬し、複製・切り替え・失敗時の停止条件を確認する。
  (2026-11-17 JST) 専用 Compose と `scripts/deploy/tests/test-pi5-standby-integration.sh` を実装。Mac(Docker 29.9.3 arm64、pgvector/pgvector:pg18)で全18検査が成功、所要30秒、成功後の専用 project の残りは0。
- [ ] S1 / PR 2: 主 DB の複製用設定、通信経路、専用役割、戻し方を追加する。
  (2026-11-17 JST) 任意 overlay、専用 HBA/役割、plan/apply/remove/status に加え、共通 `pi5_server_compose.py` で適用印に応じた overlay 継承と標準更新前の設定・稼働 DB 整合確認を実装。
  手元検証: 関連 pytest 146件、Compose 静的9件、新規 Docker 統合9件(依存経由・明示の db up で DB ID と複製設定が残る)、S0 統合が成功。本番適用は未実施、S1 は未完了。
  本番適用の前に残すこと: Tailscale より先に Docker が起動したとき、IP 指定の 5432 公開で DB が起動しない恐れを実機で確かめる。
- [ ] S2 / PR 3: 予備機の準備と標準デプロイの予備専用経路を追加する。
- [ ] S3 / PR 4: pg_basebackup による予備の初期化と非同期複製を追加する。
- [ ] S4 / PR 5: 業務ファイルの定期同期と切り替え前の整合確認を追加する。
- [ ] S5 / PR 6: WAL と復旧用の全体写しを保管し、指定時点への復旧を試す。
- [ ] S6 / PR 7: Mac の見張りへ複製・ファイル・WAL の遅れを追加する。
- [ ] S7 / PR 8: 手動切り替えと戻しの Runbook を作り、実機訓練を行う。
- [ ] S8 / PR 9: DB の版上げと予備の作り直しを Runbook に追加する。
- [ ] ユーザーによる機材購入・設置、RTO/RPO と候補決定、承認済み SHA の本番適用、実機訓練。
- [ ] integrationPending: 各段の PR、CI、main の統合 SHA、別承認の本番適用と訓練証拠を記録する。

## Surprises & Discoveries

- S1 再調査: 標準更新・health 失敗時 rollback/recovery の phase3 は DB サービスを持たず、API/Web は `--no-deps`。server Compose の利用はボリューム照合であり、同経路に DB 再作成呼び出しはなかった。共通 resolver を照合と複製 CLI に使い、適用印ありの資材欠落・稼働設定不一致はストレージ準備前に停止する。適用印なしは従来どおり何も確かめない。
- S0 模擬は WAL 欠落用の使い捨て予備を分け、slot の `lost/wal_removed` と追従不能を検査する。失敗時は保持、成功時だけ専用 project を削除する（`KEEP_PI5_STANDBY=1` で成功時も保持）。
- (2026-11-17 JST) WAL 欠落は max_slot_wal_keep_size=32MB で slot が約10秒で `lost/wal_removed` になり、使い捨て予備は追従できず作り直しが要ることを実測した。主が動いている間の昇格は拒否され、主の停止後は昇格と書き込みが成功、2回目の昇格は何もしない。
- `rg` は bash から使えない環境があるため、試験では `grep -E` を使う。重い DR 統合試験に合わせ CI には入れず、手元で任意に流す。

- DB は通常の postgres イメージではなく `pgvector/pgvector:pg18` で、5432 は公開されていない。
  根拠: `infrastructure/docker/docker-compose.server.yml:4-42`。
- 通常更新の準備はイメージ取得だけでなく DB の構造変更も行うので、予備へ同じ role を流せない。
  根拠: `infrastructure/ansible/roles/release_pi5/tasks/prepare.yml:769-809`。
- 標準デプロイは実行役の server がちょうど1台であることを要求し、Pi5 の play はその実機でローカル実行する。
  根拠: `scripts/deploy/standard-ansible-release.py:479-499`、`infrastructure/ansible/playbooks/deploy-release-standard.yml:193-213`。
- Google Drive の写しは生の DB ボリュームと Docker イメージを除く。復旧用イメージの事前取得と物理的な全体写しは別途必要。
  根拠: `docs/runbooks/google-drive-disaster-recovery.md:33-40,66`。
- API 内の scheduler（定期処理係）の standby は、同じホストの2版の API を切り替えるための待機状態である。
  根拠: `infrastructure/ansible/roles/release_pi5/tasks/prepare.yml:1245-1256`、`infrastructure/docker/docker-compose.phase3.yml:59-63`。
  この仕組みだけで別 Pi5 の DB 昇格や二重起動防止ができるとは扱わない。

## Context and Orientation


調査根拠の `パス:行番号` は、この下書きを作った時点のリポジトリの位置である。
記載は構成ファイルの事実であり、実機へ反映済みか、実際の容量や復旧時間がどうかは未確認である。
秘密設定、非公開 inventory、本番の `/opt` は読んでいない。

DB の Compose（複数のコンテナをまとめて動かす設定）は `infrastructure/docker/docker-compose.server.yml` である。
名前付きボリューム `db-data-pg18` を `/var/lib/postgresql` へ接続し、旧 `db-data` は読み取り専用で残す（同ファイル `:21-23,264-268`）。
ホスト側の名前は既定で `docker_db-data-pg18` だが、接頭辞で変更できるため固定して操作しない。
DB 内の実データディレクトリ PGDATA はイメージの設定を使う（`docs/runbooks/postgres-15-to-18-upgrade.md:36-37`）。
起動ガードは旧データがあるのに新 PGDATA が空なら初期化を拒否する（`infrastructure/docker/postgres/db-start-guard.sh:4-13`）。
Compose はパスワードをファイルで渡し、`command: [postgres]` で起動する。複製専用設定の記述はこのサービスにはない（Compose `:17-42`）。

`scripts/deploy/postgres-role-bootstrap.sql:11-35` は構造変更用 `raspi_migrator` とアプリ用 `raspi_app` を作る。
どちらも `NOREPLICATION`（複製の権限なし）なので、既存アカウントを流用しない。
`release_pi5` は phase3 の API/web を使い、構造変更専用の Compose も重ねる
（`infrastructure/ansible/roles/release_pi5/defaults/main.yml:13-38`）。
共有ファイルのディレクトリと外部ボリュームを用意し、候補 API で Prisma の構造変更と台帳確認を行う
（`infrastructure/ansible/roles/release_pi5/tasks/prepare-storage.yml:2-36`、`infrastructure/ansible/roles/release_pi5/tasks/prepare.yml:769-809`）。

業務ファイルの正本は主 Pi5 の `/opt/RaspberryPiSystem_002/storage` である。
API の `/app/storage` へ写真、PDF、図面、動画、チェックシート原本などを接続している
（`infrastructure/docker/docker-compose.phase3.yml:68-89`）。
ファイル本体と `.integrity/v1` のハッシュ（内容を照合する値）を一緒に守る。
原子的保存とは、途中までの内容を公開せず完成後に置き換えることであり、複数ファイルと DB を同時に確定する意味ではない。
根拠は `docs/decisions/ADR-20260731-single-ssd-durable-file-storage.md:25-55,65-67`。
派生画像は作り直せても、原本・整合性情報・動画・チェックシートを欠いた予備は業務用として受け入れない。

日常の `scripts/server/backup.sh:157-175` は API が使えなければ中止し、暗号化できない DB 写しを代わりに残さない。
同書 `:215-239,254-282` は写真等と明示されたディレクトリを扱い、30日を超える対象を整理する。
これを storage 全体の連続した写しや、WAL（DB の変更記録）の保管とは見なさない。
Google Drive は restic（暗号化し、同じ内容をまとめて保存する道具）で、毎日23時に DB の論理的な書き出しと原本等を保管する。
保持は日7・週5・月12。生 DB は除外し、隔離復元して初めて受け入れる
（`docs/runbooks/google-drive-disaster-recovery.md:33-40,66-86,90-108`）。
`docs/runbooks/pi5-restore-drill.md:15-28,116-138` は本番を切り替えない全損復旧訓練であり、本計画の切り替え訓練とは分ける。

端末は現在、Tailscale（機器間の暗号化ネットワーク）の名前ではなく、IP から作った HTTPS URL を使う。
`infrastructure/ansible/group_vars/all.yml:7,29-30,42-67` が `server_ip`、`server_base_url`、`kiosk_full_url`、`api_base_url` を作る。
`infrastructure/ansible/inventory.yml:9-14` の `ansible_host` も `server_ip` を参照し、`deploy_executor_host` は別の固定値である。
キオスク URL、NFC、トルク端末、サイネージは同 inventory `:234,255,391-396,608` を参照する。
キオスクは起動スクリプトに URL を埋め込む（`infrastructure/ansible/templates/kiosk-launch.sh.j2:46`）。
status-agent は `API_BASE_URL`、haizen は `/api` を付けない同名の値を使う
（`infrastructure/ansible/templates/status-agent.conf.j2:2`、`infrastructure/ansible/templates/raspi-haizen-agent.conf.j2:2-5`）。
Zero 系にも別 inventory の派生 URL がある（`infrastructure/ansible/inventory-zero-edge.yml:10-24`）。
変数を編集するだけでは、配布済みの設定と開いたままの画面は変わらない。

Caddy は通信の入口であり、通常更新では固定 gateway が API と web の稼働中の版へ転送する。
HTTPS 証明書と内部の転送先は `infrastructure/docker/Caddyfile.gateway.template:7-33`、公開ポートは phase3 Compose `:206-231`。
旧主の Caddy だけを変える方法では、旧主が故障した際に入口も失う。
Mac の見張りは5分間隔、固定 IP の HTTPS と証明書全体の SHA-256 を照合し、復旧を SSH で Chat へ残す
（`docs/runbooks/mac-pi5-watchdog.md:10-36,46-66`）。Mac の睡眠中は見張れない（同書 `:78-85`）。

## Decision Log


以下の「候補」は未承認であり、決定済みの事項と混同しない。
PostgreSQL の設定の意味は [18 の複製設定](https://www.postgresql.org/docs/18/runtime-config-replication.html) と
[18 の WAL 保管と復旧](https://www.postgresql.org/docs/18/continuous-archiving.html) で確認した。
必要な挙動と安全条件は以下へ記載し、外部資料だけを読まないと実装できない形にしない。

- Decision: 手動切り替え、新しい業務専用 Pi5、Mac による見張りを固定の前提とする。
  Rationale: 親計画 `:142-163` のユーザー決定を引き継ぐ。Patroni/repmgr/keepalived は追加しない。
  Date/Author: 2026-11-15 / 下書き担当（既決定の継承）。
- Decision: S1 はユーザー指定の非同期複製とし、`synchronous_standby_names` を空に固定する。同期への切り替えは実装しない。
  Rationale: 予備や経路の故障で主の業務書き込みまで止めない。代わりに未送信・未再生分を失い得るため、RPO と遅れを測る。
  Date/Author: 2026-11-17 / S1 実装担当（ユーザー決定の反映）。
- Decision: S1 はガードを維持した `postgres -c`、送信4・slot4・WAL上限1024MBを使う。WAL上限は実測後に見直す暫定値で、`lost` / invalidation は作り直しが必要な停止条件とする。
  Rationale: 複製と全体写しの並行取得に余裕を取り、無制限保持を避ける。解除は物理 slot が残っていれば停止し、slot の削除やデータ移動は自動化しない。
  Date/Author: 2026-11-17 / S1 実装担当。
- Decision: 既存 PG18 の PGDATA と HBA の場所を実行時に検証し、同じボリューム内の専用 HBA から元の `pg_hba.conf` を include する。許可は専用役割・実行時指定の予備IPv4 /32・SCRAMの1行とし、他の複製要求と専用役割の通常SQLを先に拒否する。
  Rationale: 元の業務用 HBA とデータボリュームを保持し、解除は起動引数だけで元へ戻す。標準更新は overlay を選ばないため、`config/pi5-replication-primary` がある間は更新を止める最小の境界を採用した。
  Date/Author: 2026-11-17 / S1 実装担当。
- Decision 候補: WAL は主の永続的な一時保管へ確実に保存後、予備と外部の専用 restic 保管領域へ定期転送する案を推奨する。
  Rationale: 予備だけでは建物ごとの喪失に弱く、外部だけへの直送はネット障害の影響が大きい。既存の日次 DR は別のまま残す。
  Date/Author: 2026-11-15 / 下書き担当、外部容量・費用・間隔はユーザー未決定。
- Decision 候補: ファイルは予備が SSH 越しに rsync（差分だけ送る道具）で取得し、完成した世代を残す案を推奨する。
  Rationale: DB 複製では原本が移らない。常時共有ディスクより小さく導入でき、即時の削除伝播を避けられるが、DB と同時点にはならない。
  Date/Author: 2026-11-15 / 下書き担当、間隔・保持量はユーザー未決定。
- Decision 候補: 初期は接続先 IP の変更と端末設定の限定再配布を推奨し、安定した業務用 DNS 名への移行は測定後に再判断する。
  Rationale: 現行 IP の派生変数を使える。名前方式は全端末の事前移行、DNS 運用、証明書の準備が必要だが、100台時の再配布を減らせる。
  Date/Author: 2026-11-15 / 下書き担当、切り替え時間を含めユーザー未決定。

## ユーザーに決めてもらうこと


- RTO/RPO: 親計画 M1 の全損復旧訓練と S0 の模擬結果を見て、DB とファイルそれぞれの許容損失と再開時間を決める。
- 複製: 推奨の非同期は主を止めにくいが直近の損失を許し、同期は損失を減らす代わりに予備の不調で書き込みを待たせる。
- WAL 保管: 推奨の予備＋外部は筐体・建物の両方に備え、予備だけは安価だが建物全損には日次の写しまでしか戻れない。
- WAL の予算: 外部に送る間隔と保管日数を決め、実測した1日分の WAL と全体写しの容量で費用と回線負荷を比較する。
- ファイル同期: 推奨の定期 rsync は短い間隔で原本を移し、日次 DR からの復元だけは簡単だが直近ファイルを失う幅と復旧時間が大きい。
- ファイル保持: 同期間隔、上書き前の世代を残す期間、容量上限を決め、時点復旧で必要な原本の保持期間を WAL とそろえる。
- 端末の接続先: 推奨の IP 再配布は既存方式を使い、業務用 DNS 名は導入作業を先に行って切り替え時の端末更新を減らす。
- 機材・運用: ユーザーが Pi5・SSD・電源・設置場所を用意し、旧主を現地で停止できる担当者と不在時の連絡先、訓練時間帯を決める。
- 緊急時の損失: DB とファイルの照合が通らない場合は再開を止めるのを既定とし、古い整合済みの写しへ戻す判断と許容損失を決める。

## Plan of Work


1段を1つの PR とし、その段のコード、対応する手順、狭い検証、計画の証拠更新をまとめる。
実装担当はコードとローカル検証、運用者は承認された実機操作、ユーザーは購入・設置と業務上の判断を担当する。
PR の作成・統合、本番適用はそれぞれ依頼された範囲だけ進める。

### S0 / PR 1: 手元で2台と失敗を模擬する


実装担当は `scripts/deploy/tests/test-pi5-standby-integration.sh` と、その専用 Compose 設定を追加する。
主と予備は同じ PostgreSQL 18・pgvector のイメージを使い、専用 project・ボリューム・内部ネットワークへ隔離する。
実データ・実パス・実接続先を使わず、貸出相当の行と写真相当の小さいファイルを作る。
DB の変更を追えること、主停止後だけ予備を書き込み可能にできること、誤った2度目の初期化を拒否することを示す。
通信断、WAL 欠落、ファイル未着、二重実行を試し、主の停止を確認できない昇格要求は必ず拒否する。
受入は、成功時の行・ハッシュ一致と、危険な操作の拒否が終了コードで分かること。失敗時は模擬環境を保持し、本番へ進まない。

### S1 / PR 2: 主の複製用設定を追加する


`infrastructure/docker/docker-compose.server.yml` の通常設定を壊さず、任意で重ねる `docker-compose.replication-primary.yml` と設定ファイルを同じディレクトリへ追加する。
適用・解除は新設 `scripts/server/pi5-replication.sh` にまとめ、通常の1台構成では複製設定・公開ポートを使わない。
`wal_level=replica`、`max_wal_senders`、`max_replication_slots`、`max_slot_wal_keep_size` を明示する。
最初の値は模擬で複製1接続と全体写しの取得が同時に使える余裕を取り、容量は WAL 実測後に固定する。
無制限の WAL 保持は採らず、上限超過で予備を作り直す停止条件を設ける。
`wal_level`、送信数・slot 数の変更は再起動が必要である。現在値と同じでも Compose の再作成に伴う停止時間を見積もる。
`pg_settings` の `context` と `pending_restart` で必要な停止を確認し、役割・接続許可の変更だけと区別する。

`scripts/deploy/postgres-replication-bootstrap.sql` を別に作り、LOGIN/REPLICATION の専用役割だけを与える。
アプリ用・構造変更用の既存 SQL の権限は変えない。資格情報は実装時に承認された保管先から渡し、ログに出さない。
5432 は主の Tailscale IP だけに bind し、接続許可 `pg_hba.conf` は専用役割・予備の IP /32・SCRAM 認証へ限定する。
Tailscale の通信制限と Docker の転送経路の両方で第三のホスト・LAN から拒否されることを確かめる。
DB 再作成時と Tailscale 起動順も試し、認証なしの許可や全インターフェース公開で回避しない。

本番の前に S0 を通し、当日分のローカル DB 写しと Google Drive の snapshot ID・成功時刻・検査結果を運用者が確認する。
23時前で当日分がなければ手動の写しと隔離復元確認を先に行い、取得コマンドの成功だけでは代用しない。
SHA と CI、停止時間の合意を確認してから運用者が適用し、API health と代表業務を確認する。
受入は許可元のみ複製接続でき、解除後は従来どおり内部通信だけで業務が動くこと。データを移動・削除して戻さない。

### S2 / PR 3: 予備機と配布経路を用意する


ユーザーが新しい業務用 Pi5、十分な容量の SSD、電源と配線を購入・設置する。個人用 Pi5 やそのサービスは変更しない。
運用者は新規 OS、SSD mount、別のホスト名・SSH 鍵・Tailscale 識別を用意し、旧主の識別情報はコピーしない。
実装担当は `inventory.yml` に `standby` 群と実機固定の管理宛先を追加し、`server` 群は現在の主1台だけに保つ。
`ansible_host`、`deploy_executor_host` と端末向け `server_ip` を分離し、接続先変更が旧主への管理接続を予備へすり替えないようにする。

`scripts/deploy/standard-ansible-release.py` と標準 playbook に、明示指定した予備だけを準備する `--standby-prepare` 経路を追加する。
通常の全台更新では予備を切り替え対象にせず、plan に主・予備の役割と別々の取得結果を表示する。
予備準備は現主が停止中でも運用者の Mac から直接実行できるようにし、旧主上の実行役を必須にしない。
取得部分は `infrastructure/ansible/roles/release_pi5/tasks/prepare.yml:43-50` の digest（内容を特定する値）固定の `docker image pull` を踏襲する。
既存の `infrastructure/ansible/roles/release_pi5/tasks/prefetch.yml:2-35` はトルク切り替えと稼働 gateway を要求するので、そのまま予備へ呼ばない。
同じ release-set（配布するイメージの組）から API/web/gateway の正確な参照と設定を準備し、DB・API・定期処理は起動しない。
現在のイメージと直前の復旧用イメージを保持し、取得失敗時は予備を「準備済み」にしない。
受入は plan で対象が一意、予備に各イメージが存在し、migration・昇格・業務処理を一切実行しないこと。

### S3 / PR 4: DB の全体写しから予備を追従させる


`pi5-replication.sh seed` を追加する。pg_basebackup は WAL と一緒に DB 全体を物理的に写す PostgreSQL 標準の道具である。
予備専用 Compose `docker-compose.standby.yml` に同じ版・拡張・digest、固有のボリュームを定義する。
イメージから PGDATA と実行 UID を確認し、空の専用領域に `pg_basebackup -R -X stream` で取得する。
`-R` が作る待機用の印 `standby.signal` と接続設定を検査し、秘密は保護された接続用ファイルで渡す。
物理 slot（予備が必要とする WAL を主に保持させる目印）は専用名で作り、再実行時に既存領域や別の slot を上書きしない。
接続設定や通信許可は主から写された内容をそのまま信用せず、予備用に確認して起動する。
受入は主の `pg_stat_replication` に streaming/async が1件、予備の `pg_is_in_recovery()` が true、試験行が予備へ届くこと。
予備では書き込みが拒否され、API/web と外部連携・定期ジョブが停止していることも確かめる。
途絶が WAL 保持上限を越えたら新しい領域へ全体写しを取り直す。旧領域は確認まで保持し、自動削除しない。

### S4 / PR 5: 業務ファイルを写して整合を判定する


`scripts/server/pi5-storage-sync.sh` と予備側の systemd service/timer を追加する。仮の試験間隔は60秒とし、本番値は RPO と実測で決める。
予備から主の storage 全体を取得する。原本、隠しディレクトリ `.integrity`、既存の全 namespace を対象とし、漏れを一覧で検査する。
作り直せる cache は除外可能だが、必要な表示を再生成できることを測る。DB データ、秘密設定、SSH/Tailscale 状態は対象外である。
読み取り専用の限定 SSH 権限、同時実行防止、途中の世代への取得、完了後の公開を実装し、不完全な世代を完成扱いしない。
最初から `--delete` で唯一の写しを削らず、置換・削除前の完成世代を保持し、完了時刻・容量・ハッシュ検査結果を記録する。
ファイルと sidecar の取得中に主の更新が重なったら照合を失敗にし、次回再試行する。

定期 rsync と DB 複製は原子的にはそろわない。切り替え前は主の書き込みを止め、最終同期と WAL 再生完了後に参照原本とハッシュを照合する。
故障で最終同期できなければ、予備 DB が参照する原本・整合性情報の欠落や不一致を検査し、ゼロでなければ業務開始を止める。
検査対象は写真だけにせず、PDF・動画・チェックシート等を含める。不足時は整合済み世代と対応する DB 復旧点を選び直す。
受入は PDF・写真を作成・置換・削除中にも不一致を検出でき、完成後は予備で同じハッシュを得られること。
初期化や失敗のやり直しでは新しい取得先を使い、主の storage と完成済みの唯一の世代には書き込まない。

### S5 / PR 6: WAL 保管と指定時点への復旧を実装する


PITR（時点復旧）は、物理的な全体写しに WAL を順に適用し、誤削除より前など指定した時刻まで戻すことである。
現在の `pg_dump -Fc` は論理的な書き出しなので、この土台にはできない。日次 DR は残したまま別の全体写しを保管する。
S1 の任意設定へ `archive_mode=on` と `archive_command` を追加し、再起動を要する変更は S1 と同じ安全確認を繰り返す。
完了した WAL を主の永続一時保管へ原子的に保存し、既存同名が同内容の場合だけ再実行を成功にする。
低更新時にも WAL が閉じられるよう `archive_timeout` の候補を測り、転送間隔と合わせて外部復旧の RPO を評価する。
別処理で予備と専用の外部 restic 領域へ送り、双方の保存確認前には一時保管を整理しない。外部の成功と DB の archive 成功は別に記録する。

`scripts/server/pi5-wal-archive.sh` に保存・転送・検査を実装し、秘密と資格情報は既存の日次 DR から独立させる。
WAL 保管が動いた後に復旧用 pg_basebackup を取得し、その開始から必要な WAL、履歴ファイル、manifest を欠かさず保持する。
全体写しを週1回取る案から測定し、保持期間は少なくとも次の検証済み全体写しとそこからの WAL がそろうまで延ばす。
WAL だけ日数で削除せず、復旧可能な組として整理する。容量不足、外部遅延、archive 失敗を検知し、主の空き容量を使い切らせない。
試験では更新A、復旧目標、誤削除Bを作り、隔離 DB に全体写しと WAL を戻して B の直前で止め、A が残ることを示す。
外部だけからも同じ復旧ができること、WAL 欠落で完了を拒否すること、対応する原本世代で表示できることを受入とする。

### S6 / PR 7: Mac で複製と写しの遅れを見張る


`scripts/mac/pi5-watchdog/` と `docs/runbooks/mac-pi5-watchdog.md` を拡張する。
監視専用の役割と SSH の実行制限を設け、複製用や DB 管理者の資格情報を Mac に配らない。
SSH で両機の限定読み取りコマンドを呼び、主の送信位置と予備の受信・再生位置、slot の保持量、ディスク空き、直近成功時刻だけを得る。
LSN（WAL 内の位置）の差をバイト数で測り、定期的な小さい試験更新の再生時間から秒単位の遅れも測る。
無更新時に最終再生時刻だけが古くなる現象を障害扱いしない。予備不通・値不明は正常とは区別する。
ファイル同期、WAL の予備/外部転送、全体写しの最終成功も別項目で確認する。
閾値は許容損失を越える前に知らせる値とし、5分間隔より短い RPO を決めるなら監視間隔も再設計する。
既存の経路不調判定、Mac 通知、復旧時の Chat 記録を維持し、自動昇格は呼ばない。
試験では複製停止・転送失敗・無更新・Mac の経路断を区別し、復旧後に状態が戻ることを確認する。

### S7 / PR 8: 手動切り替え・戻しを1つの手順にする


`docs/runbooks/pi5-standby-failover.md` と `scripts/server/pi5-failover.sh` を追加する。
運用者が対象と準備状態を確認する `check` と、停止証拠を必要とする1コマンドの `promote` を用意する。
既存の全損復旧訓練 Runbook は残し、新 Runbook に本番切り替え訓練を記す。

切り替えは、更新・同期の競合を止め、旧主の API・DB・定期処理を停止し、旧主の再起動を防ぐ順に行う。
旧主へ SSH できない、ping が返らないという事実だけでは停止証拠にしない。
現地担当者が電源を物理的に切って再投入を禁止した証拠を、対象機・時刻・担当者付きで運用者へ渡す。
現地で止められず書き込み不能を保証できないなら、復旧時間を越えても昇格せず停止する。
最終ファイル同期と DB 再生位置を確認するか、障害時の損失・整合確認を通してから `promote` を実行する。
スクリプトは対象識別、停止証拠、未昇格、同時実行なし、DB と原本の整合を検査し、内部で `pg_promote()` 相当を1回だけ実行する。
成功後の再実行は昇格済みを報告して二度目の処理をせず、途中失敗は段階と証拠から再開する。DB とファイルを初期化しない。

昇格後は新主用の接続・認証設定を検証し、準備済みイメージの API/web/gateway と定期処理を新主だけで起動する。
Caddy は新主内の稼働版へ向ける。旧主経由にはせず、証明書の対象 IP または名前、端末の信頼、管理アクセス制限を確認する。
IP 案では管理宛先を固定したまま端末向け `server_ip` を新主へ変え、キオスク起動 URL、NFC/status/haizen/torque/signage/Zero 系の設定を配り直す。
障害時にも Mac から端末へ直接配れる限定 playbook をこの PR で作り、旧主のデプロイ実行役や DB migration に依存させない。
画面とサービスを読み直し、全登録端末の到達を照合する。Mac の URL・証明書固定値・通知用 SSH の宛先も新主へ変更する。
通常更新用 inventory の `server` は新主1台に切り替え、`deploy_executor_host` も更新し、次の plan で旧主へ配布しないことを確認する。

戻しは IP を元へ戻すだけでは行わない。新主で書き込んだ後は旧主のデータを正本として起動しない。
旧主を隔離したまま新主から新規の全体写しとファイルを取得して予備へ作り直すのを既定とする。
元の機材へ主を戻す必要があれば、追従確認後に同じ停止・最終同期・昇格手順を逆方向に実施する。
ユーザーと現地担当者が承認済み時間帯に訓練し、電源断から通知、判断、昇格、全端末の再開までを計時する。
貸出・返却を1件ずつ行い、直前の記録と原本を確認し、RTO/RPO を満たすまで本運用の準備完了としない。

### S8 / PR 9: DB の版上げで予備を安全に作り直す


`docs/runbooks/pi5-standby-failover.md` に小さい版更新と大きい版更新を分けた手順を追加する。
同じ18内の更新でも同じ検証済みイメージと拡張を両機へそろえ、予備更新後の再生を確認してから主を停止時間帯に更新する。
18から次の大きい版へは物理複製をまたがせず、書き込み停止・最終写し・移行検証の後、新主から予備を取り直す。
`scripts/server/postgres-major-upgrade.sh:101-104,136-155,189-203` は15→18専用で、18以降にも使えるとは扱わない。
次の版用の移行スクリプト変更は別途その段で対象を確定し、旧ボリュームを残す方式と、行数・権限・拡張・台帳の照合を踏襲する。
大きい版の前後で WAL 保管系列と全体写しを分け、旧版の WAL を新版へ適用しない。
新版で業務書き込みを受けた後の旧版への単純な巻き戻しは禁止し、新版からの復旧を優先する。
受入は隔離環境で版上げ、予備再作成、切り替え、復旧用全体写しの検査まで通ること。

## Concrete Steps


すべてリポジトリのルートで実行する。現在の下書き段階では最初の文書検査だけを行う。

    git diff --check
    wc -l docs/plans/pi5-standby-replication-execplan.md

実装後、S0 と各段の変更に必要な事例だけを追加して実行する。

    bash scripts/deploy/tests/test-pi5-standby-integration.sh
    python3 -m unittest discover -s scripts/mac/pi5-watchdog/tests -p 'test_*.py'

前者は新設予定で、専用の模擬環境以外を拒否し、検査名と成功/拒否だけを出す契約とする。
後者は S6 で実行する既存の試験入口である（`docs/runbooks/mac-pi5-watchdog.md:87-91`）。
標準経路は `scripts/update-all-clients.sh:4-5` が Python の標準デプロイへ委譲する。
将来、対象 branch と CI を確定し、実機接続が承認されたときだけ、まず次で対象と順序を見る。

    scripts/update-all-clients.sh <承認済みbranch> infrastructure/ansible/inventory.yml --print-plan --limit <正確な対象>

実行時も exact limit を指定する。予備準備は S2 で追加する `--standby-prepare` を明示し、通常更新と区別する。
新設スクリプトの操作は次の形に固定し、各 PR で `--help`、拒否条件、検査結果をそろえる。
`--config` は対象を特定する保護された設定ファイル、`--evidence` は旧主停止などの確認記録であり、秘密そのものを引数にしない。

    bash scripts/server/pi5-replication.sh check --config <対象設定>
    bash scripts/server/pi5-replication.sh seed --config <予備設定>
    bash scripts/server/pi5-storage-sync.sh check --config <予備設定>
    bash scripts/server/pi5-failover.sh check --config <予備設定>
    bash scripts/server/pi5-failover.sh promote --config <予備設定> --evidence <確認記録>

`check` は変更せず、準備不足では非ゼロ終了と理由を返す。模擬でのみ seed/promote を先に試し、実機での実行は別承認とする。
本番の操作・秘密を使うコマンドの具体値は、各 PR のローカル検証後に Runbook へ記載する。

## Validation and Acceptance


ローカルの模擬で主の正常書き込み、予備の読み取り専用、主停止前の昇格拒否、WAL 欠落、原本不一致、再実行の安全を確認する。
本番を変える S1/S5 は事前の当日分の写し・隔離復元・停止時間の確認が揃うまで適用しない。
各段の CI は変更対象に絞り、失敗はこの段との因果を確認し、無関係な修正を混ぜない。
実機では通常更新が予備の DB を変更しないこと、準備したイメージで外部取得なしに起動できることを確かめる。
最終受入は全登録端末の到達、貸出・返却、写真・PDF・動画・チェックシートの原本表示、旧主の隔離継続で判定する。
実測した停止時間、最後に残った DB 記録とファイル世代、外部から戻せた復旧時点を別々に記録し、合意した RTO/RPO と比較する。

## Idempotence and Recovery


昇格前なら予備の処理を止め、複製用 override と接続公開を外して主を再起動すれば1台構成へ戻せる設計にする。
専用 slot は利用停止を確認してから解除し、専用役割・接続許可は閉じる。元のボリュームと業務ファイルは保持する。
WAL 保管を追加済みなら、保管失敗を成功でごまかさず、最後の復旧可能な組を保護して設定を解除する。
昇格後の復旧は S7 の再取得手順を使い、二つの主を合流させない。初期化失敗・転送中断は新しい隔離先からやり直せるようにする。
自動 cleanup で本番 DB、唯一の写し、未転送 WAL、原本世代を削除しない。

## Artifacts and Notes / Interfaces and Dependencies


各 PR の証拠は本書の Progress にリンクし、詳細の操作手順は新 Runbook を正本とする。
記録するのは日時、担当、主/予備の識別、SHA、イメージ digest、CI、snapshot ID、再生位置、遅れ、整合結果、訓練の区間時間である。
秘密、業務内容、個人ファイル名を記録しない。購入・設置・現地停止・訓練の実施証拠は運用者が埋める。
依存は既存の Docker Compose、Ansible、Tailscale、SSH、PostgreSQL 18 標準機能と、新たに予備へ入れる rsync に絞る。
外部保管は既存の restic/rclone を使う候補とし、新たな自動選出基盤や共有ディスクは導入しない。

## Outcomes & Retrospective

2026-11-17 S1 追補: overlay 継承と標準更新の停止条件限定を実装。Docker 統合で依存経由・明示 DB の up 後も ID と複製設定が残ることを確認。Tailscale 起動順の実機確認は残る。

2026-11-17 S1: コードとデーモン不要の静的・モック検証まで実装。`plan` は変更せず `pg_settings.context/pending_restart` を表示し、`apply/remove` は `--yes` 必須。秘密ファイルや実機へは接続していない。実機での SCRAM 認証、第三ホスト/LAN拒否、Tailscale起動順、API health・代表業務、承認済み本番適用は残る。

2026-11-15: 公開リポジトリの根拠を調べた下書きのみ完了。実装、購入、本番接続、実測、PR、統合、本番反映は未実施である。
DB 複製だけでは原本、配布の実行役、端末の接続先、Mac の証明書照合が残ることを明らかにし、独立した段と停止条件に分けた。
各候補の承認とローカル模擬の結果を受けて本書を更新し、実機訓練が合意値を満たすまでは親計画の M2 を完了にしない。

更新メモ: 2026-11-15、新規下書き。主の2重化を防ぐ現地停止と、DB・原本の別々の遅れを扱うために段階を分けた。
更新メモ: 2026-11-17、S1 のローカル実装・検証と判断根拠を記録。本番適用前のため S1 の完了チェックは付けていない。
