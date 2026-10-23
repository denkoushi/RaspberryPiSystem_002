# 業務LLMを GLM-5.3-Flash-FP4(2台テンソル並列)へ切り替える

この ExecPlan は `.agent/PLANS.md` に従う生きた文書である。進捗、発見、判断を作業のたびに更新する。

## Purpose / Big Picture

業務LLMを、Spark 1 単体で動く Qwen3.8-Flash-Next(`business_qwen38_flash_next_nvfp4`)から、Spark 1 と Spark 2 の2台で動く `nvidia/GLM-5.3-Flash-FP4-Local`(新プロファイル `business_glm53_flash_fp4_tp2`)へ切り替える。業務側(Pi5 API、Control Plane、Private Hermes の shared_business)から見たモデル名は `system-prod-primary` のまま変わらない。Qwen の起動経路は消さずに残し、プロファイルを戻すだけでロールバックできるようにする。

## Progress

- [x] 2026-10-22 Spark 1 と Spark 2 を QSFP で直結した(192.168.100.10/.11、MTU 9000、両方向で約206Gb/s)。
- [x] 2026-10-22 手動の `docker run` 2本で GLM の TP=2 試験をした。普通の会話、`reasoning_effort=low`、道具の呼び出し、画像入力に合格し、速度は 24〜36 tok/s だった。終了後は Qwen に戻した。
- [x] 2026-10-22 公式文書、vLLM recipe、NVIDIA フォーラム、Mia-AiLab、両リポジトリを調査した。
- [x] R1: 2026-10-22 ローカル実装・文書更新済み。`scripts/dgx-local-llm-system/tests` の全135テストが成功(sandbox 外で実行)。変更shellの `bash -n` は成功、shellcheck は未導入。
- [x] CP1: 2026-10-22 Control Plane に後方互換の変更を入れた(起動失敗の検出文字列、締切の環境変数 `DGX_BUSINESS_STARTUP_TIMEOUT_SECONDS`、Hermes の待ち時間を `business_` 全体へ)。CP の全テスト成功。
- [x] T2: 2026-10-22 2回目の試験に合格した(下の受入条件)。
- [x] 反映: 2026-10-22 21:16 に本番を GLM へ切り替えた。CP を先にリリースし、このリポジトリのファイルを Spark 1 へ配置し、Pi5 vault と CP inventory の指す先を GLM にした。keep-warm の drop-in(`/etc/systemd/system/dgx-control-keep-warm.service.d/config.conf`)は、このときは手で書き換えた。
- [x] 2026-10-23 GPU メモリ割合を 0.87 から 0.85 に下げた(#2239)。0.87 では Spark 1 の空きが約3GBで警告が出ていた。0.85 で入れ直した後、空きは Spark 1 が約7〜8GB、Spark 2 が約10GB、KV cache は 15.66GiB。priority=10 の会話 4.9秒、業務の会話 10.8秒、道具の呼び出し 0.9秒で、すべて正しく答えた。
- [x] 2026-10-23 本番の会話で切替前後の答え方を比べた(#2242)。GLM 94.8%、Qwen 88.8%。
- [ ] 追従: モデル指定なしの `/start` が Qwen で起動する問題と、ラベルの無い複数画像で色を取り違える問題を直す(#2244)。
- [ ] 追従: Control Plane の既定プロファイルを GLM にし、keep-warm の drop-in を `dgx_agent` ロールで再適用できるようにする(Control Plane 側の PR)。
- [ ] 経過観察の後、Qwen の重みを外付けSSDへ移し、Qwen マニフェストを `enabled:false` にする。

## Surprises & Discoveries

- Pi5 の on_demand 起動(`LOCAL_LLM_RUNTIME_MODE=on_demand`)は業務利用のたびに `/start` を送る。keep-warm を止めても、GPU に Qwen が載り直した。試験中は `dgx-control-business-proxy` を止める必要があった。
- GB10 は統合メモリなので、ページキャッシュは vLLM から「空き」に見えない(vLLM issue #35313)。そのため `Free memory ... less than desired GPU memory utilization` で起動に失敗する。起動直前に drop_caches すると通った。
- GLM のチャットテンプレートには `enable_thinking` が無い。`chat_template_kwargs.reasoning_effort` は low/high を受け、それ以外は max になる。今の gateway が付ける `enable_thinking:false` を送ると、英語の思考が `content` に漏れる。Pi5 は content が空のとき reasoning を表示に使うので、漏れは利用者に直接見える。公式にも思考オフは無い。zai-org のカードは `clear_thinking=true` を推奨している。
- Mia-AiLab の GLM-5.3 は EXL3 形式だけで、今回の vLLM FP4 構成にはそのまま使えない。
- 2026-10-23 0.85 へ入れ直すとき、CP を通さずに手で再起動した。CP の起動監視(`business_startup.py`)はその起動の確認に20分間通らず、08:07 に「startup readiness timed out」と記録して、自動で1回だけ再起動した(08:13 頃)。その後は active・確認済みで、業務の利用は正常。原因は確定していない(確認用の会話がリースや優先度の高い要求に断られた、または 07:44〜07:57 に business-proxy が止まっていた可能性)。教訓: 再起動は CP の `/stop-force` と `/start` で行う。手で再起動すると、監視が失敗と判断して入れ直すことがある。自動再試行の回数は1回使った。
- 2026-10-23 GLM はラベルの無い画像3枚以上を1つのメッセージで受けると、画像どうしの色を取り違えた。各画像の前に「画像N:」があれば正しく答えた。Pi5 はすでにラベルを付けているので、本番の利用者には影響が無い。gateway でも付けるよう直す(#2244)。
- 2026-10-23 keep-warm の drop-in を書く正規の経路は、CP の `dgx_agent` ロール(タスク「Configure central Lease-aware keep-warm」)だった。CP の通常リリース(deploy.sh)はこれを書かない。

## Decision Log

- 2026-10-22: worker の model dir 確認後、起動命令の前に marker を書く。起動命令が非0でも保持し、SSH 切断後の worker を stop で回収できるようにする。
- 2026-10-22: ラベルなしの既存コンテナは GLM TP2 要求だけ不一致にし、その他の既存プロファイルの再要求は従来どおり成功させる。
- 2026-10-22: GLM の head ラベル一致時も marker の worker が running か確認する。marker 不備・停止・SSH 失敗時は理由を stderr に出し、アダプタで両 rank を作り直す。
- 2026-10-22: プロファイル ID は `business_glm53_flash_fp4_tp2`、アダプタ名は `glm53_flash_tp2` とする。理由: CP の再試行は `business_` で始まる ID だけに効くから。
- 2026-10-22: head コンテナは今と同じ名前 `system-prod-trtllm`、ポート `127.0.0.1:38083`、別名 `system-prod-primary` にする。理由: CP の keep_warm、business_startup、probe、recovery playbook、proxy を変えずに済む。worker は Spark 2 の `system-prod-trtllm-rank1` とする。
- 2026-10-22: worker の起動と停止はこのリポジトリのアダプタが、Spark 1 の `ubudgxkoushi`(control-server の実行ユーザー)から ssh で行う。CP は Spark 2 を管理しないので、`repository-boundary.md` の deploy 対象と `check-deploy-boundary.sh` は変えない。
- 2026-10-22: 思考の制御はマニフェストの `runtimeProfile.chat.thinkingControl: "reasoning_effort"` で gateway が切り替える。キーが無いプロファイル(Qwen)の動作は今のままにする。
- 2026-10-22: 文脈長は Qwen と同じ 262144 にする(demo の 500000 にはしない)。画像の上限は Pi5 の最大61枚に合わせ `--limit-mm-per-prompt '{"image":61}'` とする。`--scheduling-policy priority` を付ける。CP は全リクエストに priority を入れるので必須である。
- 2026-10-22: Spark 1 のモデルは private 領域(`/srv/dgx/private-personal/...`)から業務領域 `/srv/dgx/system-prod/data/models/GLM-5.3-Flash-FP4-Local` へ複製する。理由: private と業務の分離を守るため。Spark 2 は `~/models/GLM-5.3-Flash-FP4-Local` をそのまま使う。

## Context and Orientation

- 起動経路: Pi5 API または CP → gateway `127.0.0.1:38081` → control-server `39090` `/start` → `scripts/dgx-local-llm-system/start-trtllm-server.sh` → `BLUE_SERVER_ADAPTER` の `case`(今は `vllm` と `qwen38_flash_next` だけ)。
- マニフェストから環境変数への変換: `profile_launcher.py`。launcherHints と runtimeProfile.vllm は許可リスト方式である。
- control-server は start コマンドが exit 0 なら、要求されたプロファイルを `active-model-profile.json` に書く(`control-server.py:318-345`)。start-trtllm-server.sh は `system-prod-trtllm` が動いていれば何もせず exit 0 する。そのため、別プロファイルの `/start` が来ると状態ファイルと実体が食い違う。
- 停止: `stop-trtllm-server.sh` はローカルの `docker rm -f system-prod-trtllm` だけを行う。control-server の各コマンドの制限時間は 120 秒である。
- 思考制御: `gateway-server.py:265-289` の `inject_blue_chat_completions_defaults`。
- Spark への配置は手作業である(scp と PID 再起動。`docs/runbooks/dgx-system-prod-local-llm.md`)。CI は `scripts/dgx-local-llm-system/tests` を実行しない。

## Plan of Work

R1(このリポジトリ):
1. `glm53-flash-tp2-adapter.sh` を新しく作る。`start-trtllm-server.sh` の case に `glm53_flash_tp2` を足す。
   - 起動前に head と worker を両方 `docker rm -f` する(片方だけ残った組を作り直すため)。
   - ssh で worker 側のモデル dir を確認し、worker を起動して running になったことを確かめる。
   - 両ノードで drop_caches を行い、その後 head を起動する。
   - 両コンテナに `--label dgx.profile=<id>` を付け、`/srv/dgx/system-prod/state/blue-remote-worker.json` を書く。
   - 120 秒以内に返し、準備完了かどうかは呼び出し側が `/v1/models` で確かめる。
2. `start-trtllm-server.sh` に、動いている head のラベルと要求プロファイルを比べる処理を入れる。違えば非0で終了する(状態の食い違いを防ぐ)。ラベルの無い今の Qwen コンテナは Qwen 扱いにする。
3. `stop-trtllm-server.sh` に、marker があれば ssh で worker を `docker rm -f` して marker を消す処理を入れる。失敗したら非0で終了する。marker が無ければ今と同じ動作にする。
4. `profile_launcher.py` の許可リストに worker 用の launcherHints と vllm キーを足す。足すのは、ssh 先、worker の model dir、master addr/port、NCCL/IB インタフェース、image、limitMmPerPrompt、speculative 設定である。
5. マニフェスト `model-registry.examples/business_glm53_flash_fp4_tp2/manifest.json` を作る(最初は `enabled:true` だが keep-warm/Pi5 は指さない)。
6. gateway: `thinkingControl=reasoning_effort` のプロファイルでは次のようにする。
   - `enable_thinking` を除き、`reasoning_effort` を既定 low(true なら high)にし、`clear_thinking:true` を付ける。
   - top-level の `reasoning_effort` は high 以外を low にする。
7. テスト: 偽の docker/ssh で、worker が先に起動すること、marker、停止で両方消えること、ラベル不一致で非0になること、各フラグ、gateway の変換を確かめる。
8. 正本: `docs/runbooks/dgx-system-prod-local-llm.md` に切替・ロールバックの節を足し、`scripts/dgx-local-llm-system/README.md` のプロファイル一覧を更新する。

CP1(denkoushi/DGXSparkControlPlane、別 branch・別 PR):
- `business_startup.py` に、NCCL、rank、分散初期化の失敗文字列を足す(既存の Qwen 用は残す)。1200 秒の締切は環境変数で上書きできるようにする。テストも足す。
- Hermes `dgx_runtime_prepare.py` の 1200 秒の待ち時間を、`business_` で始まる任意の ID に効かせる。
- 文書: keep-warm runbook と `repository-boundary.md` に、業務ランタイムが2台目の Spark にまたがることと、CP がそこへは deploy しないことを追記する。

## Validation and Acceptance(T2: 2回目の試験)

保守時間内に、business-proxy を止めて次を確かめる。
1. `/stop-force` の後、`/start {"modelProfileId":"business_glm53_flash_fp4_tp2"}` で、2台が起動して `/v1/models` に `system-prod-primary` が出る。
2. `"priority":10` 付きのリクエストが成功する。
3. gateway 経由の `enable_thinking:false` リクエストで、content に思考が混ざらない。
4. 画像5枚以上のリクエストが成功する。
5. max_tokens 700 の業務的な質問で、content が空にならない。
6. `/stop-force` で両ノードのコンテナが消え、Spark 2 の GPU メモリが解放される。
7. worker だけを残した状態から `/start` すると、作り直して起動する。
8. Spark 2 での drop_caches(特権コンテナ方式)が効く(利用者が実行する)。

## Idempotence and Recovery

- ロールバック: `/stop-force`(marker で両ノードを消す)の後、`/start {"modelProfileId":"business_qwen38_flash_next_nvfp4"}` を送る。Pi5 vault と CP inventory の指す先を戻す。Qwen の重みは経過観察が終わるまで今の場所に残す。
- 切替手順: 指す先(Pi5 `*_RUNTIME_START_PROFILE_ID`、CP `dgx_keep_warm_profile_id`、`dgx_private_shared_business_profile_id`)を更新し、`/stop-force` の後に GLM を `/start` する。

## Interfaces and Dependencies

- GLM が動いている間、Spark 2 の GPU は業務 worker でほぼ埋まる。Spark 2 の私用モデル(DS4.1 など)は同時には動かせない。
- Spark への配置(scp、PID 再起動、docker 操作)は、Claude の自動判定で止められるため、利用者が実行する。
