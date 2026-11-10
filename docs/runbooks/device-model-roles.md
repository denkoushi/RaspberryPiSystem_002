---
title: 機種ごとの役割と資源の運用表
status: active
scope: Pi5、Pi4、Pi3、Zero W / Zero 2W の役割、搭載制限、メモリ、保存先
last_verified: 2026-11-02
source_of_truth: docs/runbooks/device-model-roles.md
related_docs:
  - ../plans/fleet-100-scale-gap-execplan.md
  - ../guides/deployment.md
  - zero-edge-agent.md
  - watch-camera.md
---

# 機種ごとの役割と資源の運用表

端末を追加するとき、役割を変えるときは、この表で機種を選ぶ。搭載制限は運用上の決まりであり、ハードウェア上の動作可否を示すものではない。配備は[標準更新](../guides/deployment.md)、Zero は[棚スキャナー](zero-edge-agent.md)または[監視カメラ](watch-camera.md)の専用手順に従う。

## 実測の範囲

M0（2026-11-01）で各ホストの `free -m` を読み取り専用で確認した値を使う。以下はホスト全体の常時の値であり、agent 単体の使用量ではない。**更新中のメモリは全機種とも未測定**であり、常時の空きから更新時の余裕を推定しない。Pi4 の標準更新は1台約8分だった。これは所要時間であり、メモリの測定結果ではない。

## Pi5

| 項目 | 役割と資源 |
| --- | --- |
| 役割 | 中心サーバー。標準台帳の `server` グループ（[inventory.yml](../../infrastructure/ansible/inventory.yml)）。 |
| 動かしてよいもの | Docker の API / Web blue-green と gateway（[phase3 compose](../../infrastructure/docker/docker-compose.phase3.yml)）、Postgres（[server compose](../../infrastructure/docker/docker-compose.server.yml)）。ホストの `status-agent`（同 inventory）。 |
| 動かしてはいけないもの | 現場端末のキオスク Chromium、NFC・バーコード読み取り用 agent を追加しない。標準更新も `server` / `kiosk` / `signage` を分離する（[標準 playbook](../../infrastructure/ansible/playbooks/deploy-release-standard.yml)）。サーバー内のサイネージ画像生成と、端末の画面表示は別の役割である。 |
| 常時の実測メモリ | M0 では測っていない。 |
| 更新中のメモリ | 未測定。blue-green の構成だけから必要量を決めない。 |
| 保存先 | M0 の実機情報では SSD 起動。業務ファイルも単一 SSD 上に置く。保存先と復旧確認は [Pi5 保存 runbook](pi5-local-file-storage.md)を使う。 |

## Pi4

| 項目 | 役割と資源 |
| --- | --- |
| 役割 | キオスク端末。標準台帳の `clients.kiosk` グループで Chromium を指定する（[inventory.yml](../../infrastructure/ansible/inventory.yml)）。 |
| 動かしてよいもの | キオスク Chromium、Docker の `nfc-agent` / `barcode-agent` / `torque-agent`。必要な機能だけを端末設定で有効にする（[選択処理](../../infrastructure/ansible/roles/release_kiosk/tasks/prepare.yml)、[client compose](../../infrastructure/ansible/roles/release_kiosk/templates/client-compose.yml.j2)）。ホストの Python `status-agent` も使う（[unit](../../infrastructure/ansible/roles/release_kiosk/templates/status-agent.service.j2)）。 |
| 動かしてはいけないもの | Pi5 の API / Web / Postgres / gateway を追加しない。標準の端末 agent 以外のコンテナを便宜的に同居させない。許可された業務 agent は上記3種類である（[release defaults](../../infrastructure/ansible/roles/release_kiosk/defaults/main.yml)）。 |
| 常時の実測メモリ | total 約3.7GB、used 約0.8〜1.4GB、available 約2.4〜3.0GB。swap は未測定。 |
| 更新中のメモリ | 未測定。標準更新は1台約8分。 |
| 保存先 | SD 保護を考慮する。journald は再起動を越えて残し、`SystemMaxUse=200M`、`SystemKeepFree=1G` とする（[host-journald.yml](../../infrastructure/ansible/roles/release_kiosk/tasks/host-journald.yml)）。Docker の NFC・トルクのデータ volume も書き込み先である（上記 client compose）。ログを失う読み取り専用化を無条件に適用しない。 |

## Pi3

| 項目 | 役割と資源 |
| --- | --- |
| 役割 | `feh` で静止画を表示するサイネージ専用端末。標準台帳の `clients.signage`、`device_type: pi3`（[inventory.yml](../../infrastructure/ansible/inventory.yml)）。 |
| 動かしてよいもの | `signage-lite.service` と画像更新・watchdog・再起動の timer、軽い Python の `status-agent`（[release defaults](../../infrastructure/ansible/roles/release_signage/defaults/main.yml)、[表示 unit](../../infrastructure/ansible/roles/signage/templates/signage-lite.service.j2)、[表示スクリプト](../../infrastructure/ansible/roles/signage/templates/signage-display.sh.j2)）。 |
| 動かしてはいけないもの | Docker、Chromium、Pi4 用 NFC・バーコード・トルクの agent、サーバー機能。標準の Pi3 payload にこれらを追加しない（上記 release defaults）。NFC・バーコードを追加する場合は後述の直接 Python の設計を使う。 |
| 常時の実測メモリ | total 416MB、used 293MB、available 約123MB。swap は415MB中244MB使用。swap 使用を含めて余裕が小さいものとして扱う。 |
| 更新中のメモリ | 未測定。標準更新は転送前に `lightdm` と表示関連 service を止めて資源を空ける（[prepare.yml](../../infrastructure/ansible/roles/release_signage/tasks/prepare.yml)）。 |
| 保存先 | 画像キャッシュは `/run/signage`（揮発領域。上記表示スクリプト）。配備物は `/opt/raspisystem-signage`、転送用 tar は `/var/tmp/raspisystem-signage-stage`（上記 release defaults）。画像の揮発化はルート全体の読み取り専用化を意味しない。 |

Pi3 更新時の Docker 操作はコントローラー側で行い、Pi3 へは SHA-256 を検証する tar を渡す。Pi3 自体で Docker を起動する手順ではない（上記 prepare.yml の `delegate_to: localhost`）。

## Zero W / Zero 2W

| 項目 | 役割と資源 |
| --- | --- |
| 役割 | 読み取り・送信の業務 agent を1つだけ、直接 Python の systemd service として動かす。棚スキャナーなら `zero-edge-agent`、監視カメラなら `watch-cam-agent` のどちらかを選ぶ。heartbeat の `status-agent` と timer は併用する（[zero-edge playbook](../../infrastructure/ansible/playbooks/zero-edge.yml)、[watch-cam playbook](../../infrastructure/ansible/playbooks/watch-cam.yml)）。 |
| 動かしてよいもの | 上記の業務 agent 1つと軽い heartbeat。どちらの業務 unit も `/usr/bin/python3 -m ...` を直接実行する（[scanner unit](../../clients/zero-edge-agent/zero-edge-agent.service)、[camera unit](../../clients/watch-cam-agent/watch-cam-agent.service)）。 |
| 動かしてはいけないもの | Docker、Chromium、キオスク、サイネージ表示、複数の業務 agent の同居、Pi4 用 Docker agent。棚スキャナーの配備では旧 `haizen-agent.service` を停止・無効化する（上記 zero-edge playbook）。 |
| 常時の実測メモリ | 現在唯一の Zero は `zero-edge-cam-1`、**Zero W Rev 1.1（Zero 2W ではない）**。total 426MB、used 190MB、available 約236MB。swap は未測定。Zero 2W の実測値はない。 |
| 更新中のメモリ | Zero W / Zero 2W とも未測定。カメラの `MemoryMax=64M` は service の上限であり、実測値でもホスト全体の上限でもない（上記 camera unit）。 |
| 保存先 | スキャナーは `/var/lib/zero-edge-agent/queue.db` に SQLite の送信待ちを残す（[config.py](../../clients/zero-edge-agent/zero_edge_agent/config.py)、[queue.py](../../clients/zero-edge-agent/zero_edge_agent/queue.py)）。カメラは失敗画像を端末にためず、Pi5 に保存する（[camera runbook](watch-camera.md)）。カメラの journald は揮発、上限8MB（上記 watch-cam playbook）。全 Zero で保存方式が同じとは扱わない。 |

共通の [inventory-zero-edge.yml](../../infrastructure/ansible/inventory-zero-edge.yml) は `zero_edge` / `watch_cam` のグループだけを持つ。実機の一覧は管理外の台帳に置くため、本書では読んでいない。実機の機種と台数は M0 の実測に基づく。標準 fleet 台帳へ Zero を追加しない。

## Pi3 / Zero に NFC・バーコードが必要になった場合

Pi4 用 Docker agent を載せず、Zero と同じ「直接 Python の systemd service + SQLite の送信待ち」で設計する。参考実装は上記 scanner unit と queue.py、[sender.py](../../clients/zero-edge-agent/zero_edge_agent/sender.py)である。送信失敗時に待ちを保持し、再起動や更新でも DB を残す。現行 sender は HTTP 200 のほか 400 / 422 でも待ちから削除するため、無条件の配送保証とは扱わない。

現在の `zero-edge-agent` は棚スキャナー用であり、汎用 NFC agent ではない。Pi3 の標準配備にも NFC・バーコードは含まれない。追加には別途実装と検証が必要であり、この表だけで使用可能になったとは扱わない。Zero では業務 agent 1つの制限を守る。

## 計画・旧記録との違い

- [100台計画の7番](../plans/fleet-100-scale-gap-execplan.md#7番-非力な機種の役割照合項目7)は Zero 2W を例にするが、M0 の現物は Zero W Rev 1.1 である。[既存カメラ手順](watch-camera.md)の Zero 2 W という表記も現物とは異なる。コードの専用 playbook と Python unit は確認したが、Zero 2W での稼働・資源測定の証拠にはしない。
- 計画の「常時と更新中のメモリを表に添える」のうち、更新中は未測定である。Pi5 のメモリも M0 では測っていない。64MB の制限値を実測の代わりに使わない。
- 「読み取りの部品1つ」は業務 agent の数とする。実装には別途 heartbeat がある。カメラは撮影送信、棚スキャナーは SQLite 送信待ちを持ち、用途が異なる。
- [旧サイネージ手順](../guides/signage-client-setup.md)の Pi3 Chromium 手順は過去の記録である。現在の Pi3 は feh を使い、Docker も Chromium も使わない。
