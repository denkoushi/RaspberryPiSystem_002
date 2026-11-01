# 端末100台規模に向けた不足点と改善計画(効き目の大きい順)


本書は `.agent/PLANS.md` に従う実行計画である。Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を作業に合わせて更新する。今回(2026-11-01)は調査と計画だけを行い、実装は一つも始めていない。どの項目から着手するかは、ユーザーが本書を読んでから決める。


## Purpose / Big Picture


工場の Raspberry Pi システムは、Pi5 1台を中心サーバーにし、Pi4 キオスク 8台、Pi3 サイネージ 1台(標準インベントリ `infrastructure/ansible/inventory.yml` の数)と、別のインベントリで管理する Zero 系の小さな端末で動いている。ユーザーは端末を Pi4・Pi3・Zero 2W 合わせて最大100台ほどに増やし、10年安定して動かしたいと考えている。台数が10倍になると、今は手作業や1台ずつで回っている部分が、時間・故障・見落としの面で耐えられなくなる。

本書は、100台規模の端末群で広く使われている定番のやり方7点と今の作りを照らし合わせ、足りない所を効き目の大きい順に並べた計画である。各項目に、今の状態(根拠のファイルと行)、足りない所、推奨案、手間、効き目、危険を書く。手間は次の3段階で表す。小は PR 1本・1〜3日、中は PR 2〜4本・1〜2週、大は機材の追加か本番データの扱いを伴い3週以上。

完了の姿は、各項目が「実装済み(main の SHA と本番反映の run ID 付き)」か「理由つきで見送り」のどちらかになっている状態である。

効き目の大きい順の結論を先に書く。1番は中心サーバーの止まりへの備えで、予備の業務用 Pi5 を置いて PostgreSQL 18 の複製を流し、手動で切り替える(手間は大)。Pi5 が止まると100台すべてが止まり、今の復旧は前日23時の DB 写しからの作り直しだからである。2番は全台の監視で、Pi5 の外にも見張りを置き、台帳にある端末と実際に報告してくる端末を突き合わせ、閾値をそろえ、通知をフローティングチャットへ寄せる(手間は小〜中)。今は Pi5 自体が止まると誰も知らせない。3番はサーバー停止中の記録の保護で、NFC がブラウザへ渡した時点で記録を消している点、バーコードが RAM に50件しか持たない点、配膳端末(haizen)が再送しない点を直す(手間は中)。業務の記録が気づかれずに消えるのはここだけである。4番は更新の並列化、5番は端末の使い捨て化、6番は SD カードの保護、7番は非力な機種の役割の明文化である。


## Progress


- [x] (2026-11-01) 7点の現状をリポジトリから調査した(Codex `gpt-6.1-sol` / `medium` の読み取り専用調査と、主な根拠行の手元での確認)。本番機には接続していない。
- [x] (2026-11-01) 本書を書いた。
- [ ] M0: 本番の読み取り専用の実測(DR タイマーの有効状態と最新スナップショットの日時、直近の標準更新の1台あたり所要時間、Pi3 と Zero 2W の常時メモリ)。親セッション経由でユーザーの許可を得てから行う。
- [ ] M1: 中心サーバーの復旧訓練で今の復旧時間を測り、許容停止時間をユーザーと決める。
- [ ] M2: 予備の業務用 Pi5 と PostgreSQL 18 の複製、手動切り替えの手順書。
- [ ] M3: Pi5 の外の見張り、台帳との突き合わせ、閾値の統一、通知先の整理。
- [ ] M4: NFC・バーコード・配膳端末の記録を、サーバーが受け取るまで端末に残す。
- [ ] M5: 更新の取得を並列化し、切り替えを段階の波にする。Pi5 にイメージの中継キャッシュを置く。
- [ ] M6: 端末の共通イメージと初回起動の登録、予備機への差し替え手順。
- [ ] M7: 端末側の Docker ログの上限と、SD カード保護の試行。
- [ ] M8: 機種ごとの役割と資源の表を runbook に残す。


## Surprises & Discoveries


- Observation: NFC の端末側の記録は、中心サーバーが受け取ったときではなく、同じ端末のブラウザへ渡せた時点で消える。サーバーが止まっていてもブラウザが開いていれば消え、業務の処理が失敗しても再送されない。
  Evidence: `clients/nfc-agent/nfc_agent/main.py:123-129` で `queue_store.enqueue` の直後に `event_manager.broadcast` が成功すると `queue_store.delete([event_id])` を呼ぶ。

- Observation: 監視の「途絶」の基準が2つあり、食い違っている。通知は10分無連絡で出るが、管理画面の端末一覧は12時間無連絡で初めてオフライン扱いにする。
  Evidence: `apps/api/src/services/clients/client-heartbeat-alert-policy.ts:11` の `DEFAULT_STALE_MINUTES = 10` と、`apps/api/src/services/clients/client-telemetry.service.ts:27` の `staleThresholdMs = 1000 * 60 * 60 * 12`。

- Observation: 途絶の見張りは「一度でも報告してきた端末」だけを見ている。台帳に載っていても一度も報告しない端末と、7日以上黙った端末は見張りから外れる。
  Evidence: `apps/api/src/services/clients/client-heartbeat-monitor.ts:74-78` が `clientStatus` の `lastSeen` が `forgetAfterMs` 以内の行から対象を作る。

- Observation: 端末群は今2つに分かれている。Pi5・Pi4・Pi3 は標準インベントリと標準更新、Zero 系は `infrastructure/ansible/inventory-zero-edge.yml` と専用 playbook(`infrastructure/ansible/playbooks/zero-edge.yml`)で別に更新する。100台にするとき、台帳・更新・監視のどれも2系統を前提に考える必要がある。

- Observation: 更新時間の実測は古いものしかない。カナリア1台を含む更新が Docker build の省略で 6分34秒から 3分11秒に縮んだ記録(`docs/knowledge-base/infrastructure/ansible-deployment-performance.md:114,131`)と、2026-07-20 の端末適用 241,853 ms の記録(`docs/plans/deploy-speed-phase-b-execplan.md:70`)がある。8月以降の今の標準経路での1台あたりの時間は未測定である。


## Decision Log


- Decision: 更新の骨格は今の「Pi5 から Ansible で順に送る方式」のまま残し、A/B 区画(Mender、RAUC、SWUpdate)や端末が自分で取りに行く方式(ansible-pull など)には移らない。
  Rationale: `docs/decisions/ADR-20260810-risk-based-deploy-impact-contract.md:83` で RAUC などの外部の配布基盤は既に採らないと決めている。今の方式は事前確認(`--print-plan`)、対象の明示(`--limit` か `--full-fleet`)、1台ずつの健全確認と戻しを持ち、段階的に広げる運用と合っている。100台で困るのは方式ではなく所要時間なので、並列化とキャッシュで解く。
  Date/Author: 2026-11-01 / Claude

- Decision: 中心サーバーの切り替えは手動にし、自動の切り替え(Patroni、repmgr、keepalived など)は入れない。
  Rationale: 2台構成で自動切り替えをすると、ネットワークが一時的に切れただけで両方が自分を主だと思う「二重の主」が起き、記録が分かれて戻せなくなる。工場の規模では、通知を受けた人が手順書どおりに予備機を主に上げる方が安全で、数分〜十数分で戻せる。
  Date/Author: 2026-11-01 / Claude

- Decision: 予備のサーバーは業務専用の新しい Pi5 にする。個人用の Pi5 は使わない。
  Rationale: 個人用 Pi5 と業務の Pi は情報を行き来させない決まりがある。
  Date/Author: 2026-11-01 / Claude

- Decision: 新しく作る端末群の通知はフローティングチャットへ寄せ、Slack を新しく使う案は出さない。
  Rationale: 通知はフローティングチャットへ集める方針がある。今の途絶通知は `apps/api/src/services/clients/client-heartbeat-monitor.ts:57` で Slack 経路(`AlertChannel.SLACK`)に積んでいるので、移すかどうかは M3 で決める。
  Date/Author: 2026-11-01 / Claude

- Decision: Pi4 の読み取り専用ルート(overlayfs)は今は勧めない。端末側の Docker ログの上限を先に入れ、overlayfs は Pi3 と Zero から試す。
  Rationale: Pi4 は 2026-10-22 に無線が止まった件の原因を追えなかった反省から、journald をわざと SD に残す設定にした(`infrastructure/ansible/roles/release_kiosk/tasks/host-journald.yml:1-8`)。読み取り専用にするとこの記録が電源断で消え、決めた方針と衝突する。`docs/plans/stability-improvement-plan.md:335` でも、監視とログ削減を先に安定させてから検討するとしている。
  Date/Author: 2026-11-01 / Claude

- Decision: 端末がサーバー停止中に記録をためる仕組みは、スマホの圏外対応で承認済みの4段の計画(端末側を主に参照し、裏でサーバーから更新する考え方)の上に積む。新しい仕組みを別に作らない。
  Rationale: 既に配膳と照合と購買で端末側を主にする計画があり、同じ考え方をキオスクの NFC とバーコードにも広げるのが一貫している。
  Date/Author: 2026-11-01 / Claude

- Decision(未決): Pi5 の外の見張り役をどの機械に置くか。候補は、新しく置く予備の業務用 Pi5(M2 と兼ねる)、常時電源の Pi4 キオスクのどれか1台、外部の死活監視サービスの3つ。M3 の着手時にユーザーに選んでもらう。
  Rationale: 見張り役は Pi5 と同時に止まらない場所にある必要があるが、どれが一番止まりにくいかは工場の電源とネットワークの配置次第で、リポジトリからは分からない。
  Date/Author: 2026-11-01 / Claude


## Outcomes & Retrospective


2026-11-01 時点では調査と計画だけが終わっている。実装・本番の実測・ユーザーの着手判断はいずれも未実施である。


## Context and Orientation


中心サーバーは Pi5 1台で、API(Node)、web、PostgreSQL 18 を Docker で動かす。DB は `infrastructure/docker/docker-compose.server.yml:4-37` の1つのコンテナ(`pgvector/pgvector:pg18`、データは `db-data-pg18` ボリューム)だけである。API と web は同じ Pi5 の中に青と緑の2つの枠があり(`infrastructure/docker/docker-compose.phase3.yml`)、更新時は Caddy の向き先を切り替える(`infrastructure/ansible/roles/release_pi5/tasks/switch.yml`)。これは同じ機械の中の入れ替えで、機械そのものの故障には効かない。

Pi4 キオスクは Chromium で画面を出し、NFC・バーコード・トルクレンチの部品(`clients/nfc-agent`、`clients/barcode-agent`、`clients/torque-agent`)を Docker で動かす。端末の状態は `clients/status-agent` が約1分ごとに中心へ送る。Pi3 はサイネージ(静止画を `feh` で出す軽い作り)、Zero 系は Python のサービスとして直接動く(`clients/zero-edge-agent`、`clients/watch-cam-agent`)。

標準の更新は `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml` で、中身は `scripts/deploy/standard-ansible-release.py` が `infrastructure/ansible/playbooks/deploy-release-standard.yml` を流す。順番は Pi5、Pi4、Pi3 で、どの段も `serial: 1`(1台ずつ)である(同 playbook の 198、219、267 行)。

本書で使う言葉を定義する。「複製(ストリーミング複製)」は、主の DB の変更を予備の DB へ途切れなく流し続け、予備がいつでも主の代わりになれるようにする PostgreSQL の標準機能である。「WAL」は PostgreSQL が変更を書き留める記録で、これを保管しておくと、夜の写しの後の任意の時点まで戻せる。「許容停止時間(RTO)」は止まってから戻るまでに許せる時間、「許容損失(RPO)」は失ってよい直近の記録の長さである。「共通イメージ」は全端末に同じものを書き込む OS の元型で、端末ごとの違いは設定だけにする。「overlayfs」は SD カードを読み取り専用にし、書き込みを RAM に逃がして再起動で捨てる仕組みである。


## Plan of Work


以下、効き目の大きい順に7項目を書く。各項目は独立した PR の束として実装でき、上の項目が済まなくても下の項目に着手できる。ただし M0 の実測は全項目の前提なので最初に行う。


### 1番 中心サーバーの冗長化(照合項目1)


今の状態。中心サーバーは1台で、DB の複製、WAL の保管、予備機、切り替えはどれもリポジトリに無い。災害用の写しは Google Drive への暗号化した restic で、毎日23時に `pg_dump -Fc` の DB 写し、ソースと Git の束、設定と業務ファイルを送る(`infrastructure/ansible/templates/raspi-google-drive-dr.timer.j2:6`、`scripts/google_drive_dr/snapshot_builder.py:237-252`、`docs/runbooks/google-drive-disaster-recovery.md:31-40`)。保持は日7・週5・月12である。日々の写しは `scripts/server/backup.sh` が別に取り、30日残す。復旧は、新しい OS を用意し、標準の設定を入れ、DB を戻し、確かめてから手で向き先を変える手順で(同 runbook 100-108 行)、手元の Docker で試した記録はあるが、本番の作り直しにかかる時間は測っていない。許容停止時間も許容損失も決めた記録が無い。

足りない所。Pi5 が壊れると100台すべてが止まり、戻るまでの時間は OS の用意から DB の復元までの手作業の長さで決まる。失う記録は最大で前日23時以降の1日分になる。100台になると、止まったときの影響が10倍になるのに、この2つの数字は今と変わらない。

推奨案。まず M1 として、予備の SD か SSD で本番の写しから作り直す訓練を1回行い、今の復旧時間を測る。その数字を見て、ユーザーに許容停止時間と許容損失を決めてもらう。次に M2 として、業務専用の Pi5 をもう1台置き、PostgreSQL 18 のストリーミング複製で常に追いかけさせる。API と web のイメージも予備機に先に取っておく。主が止まったら、通知を受けた人が手順書どおりに予備を主へ上げ(`pg_ctl promote` 相当)、Caddy の向き先と端末が見るサーバーの名前(Tailscale の名前か固定アドレス)を切り替える。あわせて WAL を予備機と外部へ保管し、夜の写しの後の時点にも戻せるようにする。今の Google Drive の写しは、建物ごと失ったときの最後の守りとしてそのまま残す。複製は誤って消したデータもそのまま予備へ流すので、写しの代わりにはならない。

手間は大(予備の Pi5 と SSD の購入、複製の設定、切り替え手順書と訓練で3週ほど)。効き目は最大で、復旧時間を数時間から十数分へ、失う記録を最大1日分から数秒〜数分へ縮める見込みである(訓練で確かめる)。危険は、切り替えを誤ると主が2つになって記録が分かれることと、複製の遅れに気づかないことである。前者は自動切り替えを入れず手順を1つにすることで、後者は M3 の監視で複製の遅れを見張ることで抑える。DB の版上げのときは予備機も同じ版にそろえる手順が増える。


### 2番 全台の監視(照合項目6)


今の状態。各端末の `status-agent` が約1分ごとに CPU、メモリ、ディスク、温度、SD の健康状態を送る(`clients/status-agent/status-agent.py:257-297`、`clients/status-agent/status-agent.timer:5-8`)。中心の API が60秒ごとに途絶を調べ、10分無連絡で1件の警告を出し、戻れば知らせる(`apps/api/src/services/clients/client-heartbeat-monitor.ts`)。警告は Slack 経路に積まれる(同 57 行)。更新中の端末は警告から外す。管理画面 `/admin/clients` に端末一覧と状態の色があり(`apps/web/src/pages/admin/ClientsPage.tsx`)、ここでは12時間無連絡でオフラインになる。API には Prometheus 形式の数値の出口(`apps/api/src/routes/system/metrics.ts`)があるが、集める側は動いていない。

足りない所。見張りが Pi5 の中にあるので、Pi5 か DB が止まると誰も知らせない。一番大事な故障を検知できない。また、一度も報告していない端末と7日以上黙った端末は見張りから外れ、端末の名前が `raspi`、`raspberrypi`、`zero-edge-` で始まらないものも外れる(`apps/api/src/services/clients/client-heartbeat-alert-policy.ts:11-20`)。通知(10分)と画面(12時間)の基準がずれている。100台になると、画面を目で見て気づくことは期待できない。

推奨案。M3 として次の4つを行う。1つ目に、Pi5 の外に見張り役を1つ置き、Pi5 の API の健康確認と DB の応答、(M2 の後は)複製の遅れを数分ごとに確かめ、止まったらフローティングチャットへ知らせる。置き場所は Decision Log の未決事項のとおりユーザーに選んでもらう。2つ目に、「いるはずの端末」の台帳(標準インベントリと Zero 系のインベントリの両方、または管理画面の端末登録)と実際に報告してくる端末を突き合わせ、一度も来ない端末も途絶として扱う。3つ目に、画面のオフラインの基準を通知と同じ10分にそろえる。4つ目に、端末の途絶の通知先をフローティングチャットへ寄せるかどうかをユーザーに確かめる。Prometheus や Grafana などの監視基盤は、この4つで足りない場合にだけ検討する。

手間は小〜中(見張り役の小さなスクリプトと systemd タイマー、API の突き合わせと画面の基準変更で PR 2〜3本、1週ほど)。効き目は大きい。1番の予備機を置いても、止まったことに気づけなければ使えないので、1番と組で効く。危険は、誤報が多いと通知が無視されるようになることである。夜間の計画停止や更新中は今の仕組みと同じく外し、最初の2週は通知の件数を数えて基準を調整する。


### 3番 サーバー停止中の端末の動き(照合項目5)


今の状態。部品ごとに差が大きい。トルクレンチは、測定値を SQLite に保存してから送り、サーバーが受け取った(2xx)ときだけ消し、失敗は最大30秒間隔で再送する(`clients/torque-agent/torque_agent/ingestor.py:119-128`、`clients/torque-agent/torque_agent/api_client.py:81-88`)。Zero 系の部品も SQLite に保存して古い順に再送し、7日を過ぎたものは捨てる(`clients/zero-edge-agent/zero_edge_agent/queue.py:8`)。一方 NFC は、上の Surprises に書いたとおり、ブラウザへ渡せた時点で端末の記録を消す。バーコードは RAM に最後の50件を持つだけで、再起動で消える(`clients/barcode-agent/barcode_agent/main.py:151`)。配膳端末(`clients/haizen-agent`)は読み取りごとに1回だけ API を呼び、失敗はログに残すだけで再送しない。監視カメラ(`clients/watch-cam-agent`)は失敗した画像を捨てる設計で、これは監視画像なので許容できる。キオスクの画面は、スマホの配膳・削除・棚マスタに IndexedDB の送信待ちがあるが(`apps/web/src/features/mobile-placement/haizen/offline/haizenOfflineQueueStore.ts`)、Pi4 キオスクの一般の画面は、サーバーの状態が分かるまで開かない作りである(`apps/web/src/layouts/KioskLayout.tsx:236-245`)。

足りない所。サーバーが止まっている間の NFC の読み取りと、配膳端末の読み取りは、業務として記録されずに消え、作業者も気づかない。100台になると、サーバーの再起動や更新の数十秒の間に誰かが読み取っている確率が上がる。

推奨案。M4 として、記録を消すのは「中心サーバーが受け取ったと返したとき」に統一する。NFC は、ブラウザが API の処理を終えてから「受け取った」を部品へ返す形にするか、トルクと同じく部品が直接 API へ送る形にする(どちらにするかは M4 の着手時に、画面の操作の流れを見て決める)。バーコードは NFC と同じ SQLite の送信待ちを持たせる。配膳端末は Zero 系の部品と同じ送信待ちと再送を持たせるか、新しい Zero 系の部品へ置き換えて古い部品を廃止する(置き換えの計画は `docs/plans/zero-edge-placement-execplan.md` に既にある)。どの送信待ちにも件数の上限を設け、たまっている件数を `status-agent` で中心へ送り、画面にも「未送信 N 件」を出す。キオスクの一般の画面を圏外でも使えるようにすることは、スマホの4段の計画の後に、画面ごとに必要性を見て決める。

手間は中(部品3つの変更とテスト、画面側の確認で PR 3本ほど、2週ほど)。効き目は大きい。業務の記録が黙って消える箇所はここだけである。危険は二重登録である。再送すると同じ読み取りが2回届くことがあるので、トルクと同じく1件ごとの識別子(`eventKey`)をサーバー側で重複として捨てる作りを必ず一緒に入れる。貸出のように時刻の順番が意味を持つ業務は、遅れて届いた記録の扱いを決めてから入れる。


### 4番 更新の方式(照合項目4)


今の状態。上の Context のとおり、Pi5 から Ansible で1台ずつ送る。各端末は自分でイメージを ghcr.io から取り、取り終えてから切り替える(`infrastructure/ansible/roles/release_kiosk/tasks/prepare.yml:253`)ので、端末での組み立ては無い。対象は `--print-plan` で確かめ、`--limit` か `--full-fleet` を付けないと動かない。カナリア用のグループ `kiosk_canary` と `signage_canary` がある(`infrastructure/ansible/inventory.yml:602-608`)。端末が自分で取りに行く仕組みや A/B 区画の仕組みは無い。

100台の見積もり。1台ずつなので、全体の時間は「台数 × 1台あたりの時間」でほぼ決まる。古い実測の1台あたり3分強〜6分半を使うと、Pi4 100台で約5〜11時間、作業者への事前通知(1台あたり約125秒、`docs/guides/deployment.md:143`)を付けるとさらに約3.5時間増える。今の標準経路での実測が無いので、M0 で測り直してからこの数字を直す。加えて、100台がそれぞれ ghcr.io からイメージを取ると、工場のインターネット回線に同じイメージを100回流すことになる。携帯回線の端末は既に約15KB/sで時間切れを起こしている(`docs/runbooks/pi4-sd-card-backup.md:24`)。

足りない所。夜の保守時間の中に全台の更新が収まらなくなる。回線の細い端末が全体を止める。

推奨案。M5 として、更新を「取得」と「切り替え」の2つに分ける。取得は全対象で同時に(たとえば10〜20台ずつ並列に)先に済ませ、切り替えは今の健全確認と戻しを保ったまま、カナリア1台、次に5台、次に約25%、残り、の波で進める。Ansible の `serial` は `[1, 5, "25%", "100%"]` のような段階の指定ができ、`max_fail_percentage: 0` と組めば、どこかの波で1台でも失敗すれば次の波へ進まない。波の間には数分の様子見と、M3 の監視で全台が生きていることの確認を挟む。あわせて Pi5 にイメージの中継キャッシュ(Docker の registry をプルスルーで動かすもの)を置き、端末は Pi5 から取るようにして、インターネット回線に流れる量を1回分にする。A/B 区画と端末が自分で取りに行く方式は、Decision Log のとおり採らない。OS 自体の更新は、今の週1の自動更新(`docs/knowledge-base/KB-425-os-security-weekly-update.md`)のまま進める。

手間は中(playbook の分割と波の指定、中継キャッシュ、トルクの切り替えの特別な流れとの両立の確認で PR 3〜4本、2週ほど)。効き目は中〜大で、見積もりでは全台の更新が1時間前後になる(M0 と試行で確かめる)。危険は、同時に切り替える台数が増えると、悪い版が一度に多くの現場へ届くことである。波の最初を1台と5台に小さく保ち、失敗率0%で止めることで、今と同じ広がり方にする。トルクの切り替えの特別な流れ(`deploy-release-standard.yml:48-191`)は全台をそろえて動かす前提なので、この流れには波を入れない。


### 5番 端末の使い捨て化(照合項目2)


今の状態。端末には残すべき状態がある。NFC とトルクの送信待ちの SQLite(Docker ボリューム `nfc-agent-data`、`torque-agent-data`)、Zero 系の送信待ち、監視の状態、ブラウザの IndexedDB、端末ごとの設定、Tailscale の識別、端末の鍵である。新しい Pi4 は、OS の書き込み、ネットワーク、SSH、Docker、Tailscale、自動ログイン、インベントリと鍵の登録、API への登録、機器の接続、初回の導入(`docs/guides/deployment.md:66-89` の `--first-install`)、確認の順で、手作業が10〜12段ほどある(数えた見積もりで、測ってはいない)。トルクレンチの Bluetooth 接続は自動化の外である。SD カードが壊れたときは、Pi5 が週1で取っている丸ごとの写しから新しいカードへ戻す5段の手順がある(`docs/runbooks/pi4-sd-card-backup.md:41-56`)が、実機での訓練はまだ済んでいない。共通イメージを作る仕組み(rpi-image-gen、pi-gen など)と、別の予備機へ識別を移す手順は無い。

足りない所。100台あると、年に数台は SD や本体が壊れる。今は1台の用意に作業者が付きっきりで時間がかかり、所要時間も測っていない。写しは動いている端末から取るので、SQLite の中身が途中の状態で写ることがある(`scripts/pi4_sd_backup/plan.py:41-47`)。

推奨案。M6 として、全端末共通の OS イメージを rpi-image-gen(Raspberry Pi 公式のイメージ作成ツール)で作り、Docker、自動ログイン、status-agent、最初の登録用のスクリプトまで入れておく。端末ごとの違いは、初回起動時に読むホスト名と登録用の一回限りの鍵だけにし、その後は今の標準の `--first-install` で揃える。予備機を数台用意しておき、壊れた端末の名前と鍵を予備機へ移す手順(中心で古い鍵を無効にし、新しい鍵を発行する)を runbook にする。3番の対策で送信待ちが空になる時間が短くなれば、端末から失って困るものはほとんど無くなる。目標は、予備機の差し替えが30分以内、新しい端末の用意が機器の接続を除いて30分以内で、M6 の訓練で測る。今の SD の丸ごとの写しは、共通イメージの運用が定着するまで残す。

手間は中〜大(イメージ作成の仕組み、初回登録、鍵の入れ替え手順と訓練で3週ほど)。効き目は中で、台数が増えるほど効く。危険は、古い端末と予備機が同じ名前と鍵で同時に動くことで、今の runbook でも禁じている(`docs/runbooks/pi4-sd-card-backup.md:55,60`)。鍵を中心で入れ替えて古い方を使えなくすることで防ぐ。


### 6番 SD カードの保護(照合項目3)


今の状態。Pi4 と Pi5 の journald は SD に残し、200MB を上限にしている(`infrastructure/ansible/roles/release_kiosk/tasks/host-journald.yml`)。監視カメラは RAM だけに残す(`infrastructure/ansible/playbooks/watch-cam.yml:75-85`)。Pi3 のサイネージ画像は RAM 上の `/run/signage` に置く。Docker のログの上限は、Pi5 の古い構成ファイル(`docker-compose.server.yml`)の api と web にだけあり、今の Pi5 の青緑の構成と端末の構成(`infrastructure/ansible/roles/release_kiosk/templates/client-compose.yml.j2`)には無い。Docker 全体の既定の上限(`/etc/docker/daemon.json`)も無い。読み取り専用のルート、log2ram、端末の SSD 起動はどれも無い。Pi5 は SSD から起動している。`status-agent` が SD の書き込み量と健康を見ている。

足りない所。端末の Docker のログに上限が無いので、部品が大量にログを出すと SD を埋め、摩耗も進む。100台あると、年に数枚の SD の故障は避けられない。

推奨案。M7 として、まず全端末と Pi5 の Docker に既定のログ上限(たとえば1ファイル10MB・3世代)を入れる。これは小さな変更で、すぐ効く。次に、SD を産業用の高耐久品に統一する。Pi4 の USB SSD 起動は、キオスクの置き場所で配線と電源が許すかを見て、壊れやすい端末から選んで試す。読み取り専用のルートは、Decision Log のとおり Pi3 のサイネージと Zero 系から試し、Pi4 は journald を残す方針と両立できる形(ログだけを別の書き込み先に分けるなど)が見つかってから検討する。

手間は小(ログ上限は PR 1本、1日)〜中(SSD 起動と読み取り専用の試行で1〜2週)。効き目は中。危険は、ログ上限で古いログが早く消え、障害の調べに足りなくなることである。journald は今の200MBを保ち、Docker のログだけを絞る。読み取り専用のルートは、設定の変更が再起動で消えるので、更新の手順(4番)と一緒に設計しないと更新が効かなくなる。


### 7番 非力な機種の役割(照合項目7)


今の状態。Pi3 では Docker も Chromium も動かしていない。Docker の操作は Pi5 側で行い、Pi3 には検証済みの tar を送り、`feh` で静止画を出す(`infrastructure/ansible/roles/release_signage/tasks/prepare.yml:50-123`、`infrastructure/ansible/roles/signage/templates/signage-lite.service.j2`)。Pi3 の標準の役割から NFC・バーコード・トルクの部品は外している。過去の記録では、Pi3 で実際に使えるメモリは約416MBで、サイネージに約295MB使っていた(`docs/knowledge-base/infrastructure/signage.md:946-948`)。Zero 系はどれも Python のサービスを直接動かし、Docker も Chromium も使わない。監視カメラは使えるメモリを64MBに抑えている(`clients/watch-cam-agent/watch-cam-agent.service`)。

足りない所。今の作りは既に軽い方向で正しいが、機種ごとに何を載せてよいかの決まりが一か所に書かれていない。古い手順書には Pi3 で Chromium を使う記述が残っている(`docs/guides/signage-client-setup.md:101,135`)。100台に増やすとき、誰かが Pi3 にキオスクを、Zero 2W に Docker を載せようとする危険がある。

推奨案。M8 として、機種ごとの役割の表を runbook に書く。Pi4 はキオスク(Chromium)と Docker の部品、Pi3 はサイネージ(`feh`)と軽い Python の部品だけで Docker と Chromium は使わない、Zero 2W は読み取りの部品1つを Python で直接動かし Docker と Chromium は使わない、とする。M0 で測った各機種の常時と更新中のメモリを表に添える。NFC やバーコードを Pi3 や Zero 2W で使いたくなったら、Docker の部品ではなく Zero 系の部品と同じ作り(Python を直接、SQLite の送信待ち)にする。古い手順書の Chromium の記述は直すか、古い記録と明記する。

手間は小(文書1本、1〜2日)。効き目は小〜中で、間違った機種選びの予防になる。危険はほぼ無い。


## Concrete Steps


M0 の実測は本番機への読み取りだけの接続になるため、進行役のセッションを通じてユーザーの許可を得てから行う。測るのは次の4つで、いずれも状態を変えないコマンドで確かめる。Pi5 で Google Drive の写しのタイマーが有効か(`systemctl is-enabled` と `systemctl list-timers` で該当のタイマーを見る)。最新の写しの日時(`docs/runbooks/google-drive-disaster-recovery.md` の確認手順に従う)。直近の標準更新の run で、Pi4 1台あたりにかかった時間(`docs/guides/deployment.md` にある `--status` の結果と recap から読む)。Pi3 と Zero 2W の常時のメモリ(`free -m`)。結果は本書の Surprises & Discoveries に追記し、4番の見積もりを直す。

M1 以降は、各項目の着手が決まったときに、その項目だけの詳しい手順を本書に追記するか、項目ごとの ExecPlan を `docs/plans/` に作る。1つの PR には1つの項目の1段だけを入れる。


## Validation and Acceptance


各項目の受け入れは次の振る舞いで確かめる。1番は、訓練で主の Pi5 の電源を切ってから、手順書どおりに予備を主にして、キオスクで貸出の画面が開き、切る直前の記録が残っていることを確かめ、かかった時間を記録する。2番は、見張り役から見て Pi5 の API を止めた(訓練用の環境で)ときに、数分以内にフローティングチャットへ通知が届き、戻すと回復の通知が届くこと。台帳にあるが電源を入れていない端末が途絶として出ること。3番は、試験環境で API を止めた状態で NFC とバーコードを読み、API を戻すと、記録が1回だけ登録されること。4番は、試験環境の複数台で、取得が並列に済み、切り替えが波ごとに進み、波の途中で1台を失敗させると次の波へ進まないこと。全体の時間を記録する。5番は、予備機への差し替え訓練の所要時間が30分以内であること。6番は、端末で `docker inspect` してログの上限が付いていること。7番は、runbook に機種ごとの表と測ったメモリがあること。


## Idempotence and Recovery


本書の作成自体は文書の追加だけで、何度読み直しても状態は変わらない。M0 の実測は読み取りだけで、繰り返しても安全である。M1 以降の各段は、それぞれの PR の中で戻し方を書く。特に1番の複製は主の DB の設定を変えるので、入れる前に今の Google Drive の写しが当日分まで取れていることを確かめ、予備機の設定を外せば元の1台構成に戻れる形で入れる。


## Artifacts and Notes


調査に使った Codex の実行は、モデル `gpt-6.1-sol`、推論 `medium`、読み取り専用(`-s read-only`)である。本番機には接続していない。調査の範囲はこのリポジトリだけで、外部の設定、秘密情報、非公開のインベントリは読んでいない。


## Interfaces and Dependencies


本書は計画だけで、新しい部品やインターフェースはまだ作らない。各項目で使う予定の外部のものは次のとおりで、いずれも採るかどうかは着手時に決める。PostgreSQL 18 の標準のストリーミング複製と WAL の保管(1番)、Ansible の `serial` の段階指定と `max_fail_percentage`(4番)、Docker の registry のプルスルーのキャッシュ(4番)、rpi-image-gen(5番)、Docker の `daemon.json` の `log-opts`(6番)。
