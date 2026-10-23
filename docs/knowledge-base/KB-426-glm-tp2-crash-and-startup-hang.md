# KB-426: 業務 GLM（2台構成）の停止と、再起動が止まり続けた件

- Status: active
- Date: 2026-10-23
- Scope: DGX Spark 1（head）と Spark 2（worker）の業務 GLM-5.3-Flash TP2。Pi への影響なし

別々の 3 件を分けて記録する。

## 1. 17:54 の停止（原因未確定）

- 17:54 ごろ、私用 Open WebUI から共用 GLM へ画像付きの依頼が届いた（`business start skipped: runtime already running (caller dgx_control.shared_business.hold)`、17:54:54）。
- その直後、rank0 が `RoCE collective on rank 0 timed out waiting for rank 1` で終了した。カーネル、RoCE、ハードウェアの異常は記録されていない。
- ポータルの「画像チャット」による切り替え（lease、`/stop-force`、llama-swap 起動）は起きていない。
- 再現試験（19:04〜19:18）はすべて正常だった。
  - 直接送った小さい画像、4032×3024 の画像、同じ画像の 4 件同時。
  - Open WebUI から共用 GLM へ送った画像（業務の依頼と同時に最大 3 件を処理）。
- 候補: 直前の 17:43〜17:53 に Spark 1 で設定反映（ansible）が走り、17:53:25 に `dgx-control-agent` が再起動していた。停止はその約 1 分後。関係は未確認。
- 再起動でコンテナを作り直したため、停止時の詳細ログは残っていない。

## 2. 再起動が「準備完了待ち」で止まり続けた（原因確定・修正済み）

- 18:0x〜19:00 の起動 4 回が、すべて `Reducing Torch threads` の後で止まった。
- 原因: Spark 2 の既定経路が Wi-Fi（`wlP9s9`、192.168.128.126）で、vLLM の `get_ip()` がその住所を返した。
  - rank1 の Worker_TP1 は、メッセージキュー（shm_broadcast）をその住所で待ち受けた。
  - Spark 1 からその住所へは IPv4 の経路が無い（`enP7s7` は IPv6 だけ、IPv4 の既定経路も無い）。
  - その結果、head は rank1 の READY を、rank1 は head の接続を待ち続けた。
- 修正: `glm53-flash-tp2-adapter.sh` で、各機の `VLLM_HOST_IP` を 2 台をつなぐ線の住所に固定した（head=`BLUE_MASTER_ADDR`、worker=`BLUE_WORKER_SSH_TARGET` の host 部）。
  - 実機には仮に当て、19:03 に起動完了（約 5 分）。rank1 の待ち受けがすべて 192.168.100.11 になったことを確認した。
- 未解明: 同じ条件（Wi-Fi は 10/22 17:44 から接続、アダプタも同じ）で、朝 08:13 の起動は成功していた。

## 3. 18:28 の強制停止（想定どおりの動作）

- 起動監視（Control Plane `business_startup.py`）は、最初の起動から 20 分で準備完了しない場合に `/stop-force` し、30 秒後に 1 回だけ `/start` し直す。
- 手動の再起動（09:26Z）の途中で、最初の起動から数えた期限が来て強制停止された。異常ではない。
- 監視が止まった起動をやり直す場合は、手動で `/start` を重ねない。「準備中」の間の `/start` は何もしない。

## 運用の注意

- 業務 GLM を再起動する前に、両方の機械の `docker logs` を保存する。作り直すと停止の手がかりが消える。
- ポータルの「画像チャット」「テキストチャット」は DGX を私用へ切り替えるため、業務の利用中と利用後 5 分は止められる。共用 GLM は Open WebUI から直接使えば、業務と並行して処理される（業務が優先）。
