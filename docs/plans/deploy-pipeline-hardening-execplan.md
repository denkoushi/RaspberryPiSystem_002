# 配送パイプラインの堅牢化

この ExecPlan は生きた文書である。作業が進むたびに Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を更新する。`.agent/PLANS.md` に従い、この文書だけで初見の作業者が実行できるように書く。コードで確かめた事実は「確認済み」、読み切れていない点は「未確認」と書く。

計画は2段に分ける。第1段(PR1〜PR3、PR5)は設計が固まっており、すぐ実装する。第2段は、2026-11-20 の第三者レビュー(Codex、Fable)で最初の案に重大な穴が見つかったため、2026-11-21 に「Pi4 に部品が届かないデプロイを止める」小さな案(PR6)に絞った。全面の作り直しは見送り、理由を「第2段の設計」に残す。

## Purpose / Big Picture

標準ローリング更新(Pi5 を切り替え、続いて Pi4 キオスクを段階的に、最後に Pi3 サイネージを更新する流れ)について、確認済みの問題を、安全な順序の小さな PR で解消する。完了すると次が成り立つ。

- 連続して main に入れても、CI の公開(イメージ、署名付きリリースセット)が途中で取り消されない。
- Web だけの変更が後から main に入っても、先に main に入った Pi4 の変更が、気づかれないまま端末に取り残されない(届かないデプロイは指定なしでは止まる)。
- 応答しない端末を飛ばした更新で、未適用の端末が `--status` に出る。
- Vault のバックアップファイルが誤ってコミットされない。

用語。
- 標準経路: `scripts/update-all-clients.sh` から `scripts/deploy/standard-ansible-release.py`(ランチャ)を通り、Pi5 上の systemd ユニットが同じ SHA を `git checkout --detach` したランチャで `--execute-standard-route` を実行し、Ansible の `deploy-release-standard.yml` を流す一連の流れ。
- リリースセット: `ghcr.io` の `raspisys-release-set:<sha>-<config_hash>`。中身の `release-set.json` に API/Web のダイジェストと `agentServices` などを持ち、`actions/attest` で署名される。パーサは `scripts/deploy/release_artifact_contract.py` の `parse_release_set`。torque 用は `-torque-v2` を付けたタグで、schema 1 の通常セットを土台にする。
- push 差分: GitHub Actions の `github.event.before` から head までの差分。`scripts/ci/classify_changes.py` がこれで公開する成果物を決める。

## Progress

- [x] 調査と第三者レビュー(2026-11-20)。
- [x] PR1: `.gitignore` に Vault バックアップを追加(denkoushi/RaspberryPiSystem_002#2991、2026-11-20 マージ、f92eb4d8)。
- [x] PR2: main push の並行制御を SHA ごとにする(#2992、2026-11-20 マージ、db070c32)。3連続 push で全 run が完走することの実 CI 確認は、新しい設定で連続マージが起きたときに行う(未確認)。
- [x] PR3: 調べた結果、変えない(決定2)。
- [x] PR5: 応答しない端末を `--status` に表示する(#2993、2026-11-20 マージ、be375e2d)。実機の `--status` に `excluded offline hosts:` が出るかは次の通常デプロイ後に確かめる(未確認)。
- [x] 第2段の方式を決めた(決定7、2026-11-21 にユーザーが小さく止める案を選択)。
- [x] 第2段の設計(下の「第2段の設計」)を Codex と Fable でレビューする(2026-11-21 に判定を Ansible に移して書き直した。決定8。17回目で打ち切り)。
- [x] PR6: Pi4 に部品が届かないデプロイを止める(#3008、2026-11-22 マージ、cb7e0e2f)。Pi5 への反映(run `20261122-004522-d0961a`)は成功。`raspi4-kensaku-stonebase01` で `--print-plan` と `--agent-images` の通る側を確かめた。止まる側(部品がそろわない SHA で判定が終了コード 0 以外を返す)の実機確認と、初めて判定に止められたときの `--status` の記録は未確認(Web だけの SHA が main に来たときに `--print-plan` だけで行う)。
- [x] 第3段(速さと台数への強さ)のための計測(2026-11-22、読み取りだけ)。結果と計画は「第3段」。
- [x] PR7: 記録を消えにくくする(#3013、2026-11-22 マージ、1c3156be)。Pi5 への反映(run `20261122-020741-823678`)は成功し、Pi5 の上限が 2G になったことを確かめた。波3が遅い理由は、次の Pi4 を含むデプロイの記録で確かめる(未確認)。
- [ ] PR8: 標準経路で pipelining を使う(canary の1台から)。2026-11-22 に `raspi4-kensaku-stonebase01` で事前確認(sudoers に `requiretty` 無し、become 付きで成功)と測定(読むだけの `stat` 20個、Pi5 から実行: pipelining 無し 26.3 秒・26.2 秒、有り 20.9 秒・20.6 秒。1タスク約1.3秒→約1.0秒で約2割減)をした。この端末のホスト変数だけに入れた。波1の前後比較は反映後(未確認)。

## Surprises & Discoveries

- 確認済み: ci.yml の `release-gates`(`ci.yml:1817` 付近)は、同じ SHA の CodeQL と Gitleaks の結果を `scripts/ci/wait_for_release_checks.py`(最大1800秒)で待つ。CodeQL(`codeql.yml:19`)と Gitleaks(`gitleaks.yml:17`)も main push を ref 単位のグループにしており、待ちの run は新しい push に置き換えられて消える。ci.yml だけ直しても、消えた側の SHA は公開ゲートで時間切れになる。
- 確認済み: GitHub の concurrency は1グループにつき実行中1・待ち1。今の設定でも2連続 push は両方完走する。消えるのは3本目が来たときの待ち run。
- 確認済み: ci.yml の可変の共有状態はキャッシュだけ。GHA キャッシュ(`cache-to: type=gha`、`ci.yml:660,810,1157,1601`)と、`scripts/ci/build_release_image.py` が登録先に書く buildcache タグ(`registry_cache_tag`、配布されない)。`:latest` などの可変の配布タグは無い。公開物は SHA を含むタグ。並行で書き換わってもキャッシュの当たり外れが変わるだけで、正しさには影響しない。
- 確認済み: 通常セットのタグは再実行でも同じ(`ci.yml:1909`、`runAttempt` は中身に入る、`:1898`)。v2 の再利用検査は土台のダイジェストまで比べる(`release_artifact_contract.py:722`)。同じ SHA の再実行で v2 再利用が失敗しうる(Codex 指摘、未検証)。
- 確認済み: Pi4 が取り残される仕組み。Web だけの push のセットは `agentServices: []` になり、Pi4 だけを選ぶと(ほかに未公開のイメージが無いとき)計画の Pi4 イメージ一覧は空、`unpublished_plan_images` は空のまま、`pi4ReleaseFiles: skipped…` を出して終了コード 0 で通る(`standard-ansible-release.py:1615-1640`)。Pi4/Pi3 の祖先へのフォールバックは禁止(`require_pi5_fallback`、`:543`)。
- 確認済み: ランチャとリリースセットの読み書きは同じコミット。Mac 側は HEAD とリモート SHA の一致を強制し(`resolve_sha`、`:513`)、Pi5 側は同じ SHA を checkout したランチャを実行する(`:785`)。Pi5 に常設のランチャは無い。
- 確認済み: Pi5 側は `FETCH_HEAD` が計画した SHA と違えば実行前に止まる(`:785`)。計画と違う SHA で走ることは無い。最初の案の「問題6」は誤りだった。
- 確認済み(PR5 の前): `--status` の要約は `optional-host-preflight` の行を拾わず、飛ばした端末は `--status` に一切出なかった。PR5 で、要約が拾い(`scripts/deploy/rolling_release/safe_diagnostics.py:166`)、ランチャが Ansible の後にも同じ行を出し直す(`standard-ansible-release.py:1516-1523`)ようにした。その run ID の通知用の項目は終了時に `remove-run`(`:1542-1545`)で消える。
- 確認済み: Pi4 の準備は、稼働中の `/etc/raspi-client/server-cert.pem` を上書きし(`roles/client_server_cert_pin`)、今の Pi5 の鍵と SPKI を照合する(`roles/release_kiosk/tasks/prepare.yml:118-141`)。ロールは `release_sha in release_kiosk_*_image` を検査する(同 `:8-15`)。Pi3 も同様(`release_signage/tasks/prepare.yml:8`)。
- 確認済み: Pi4 の準備失敗は rescue で記録され、全台の結果をまとめる既存のゲートがある(`deploy-release-standard.yml:252-305`)。
- 確認済み: Pi3 のイメージ取得は Ansible の前に `signage_identity()` が済ませている(`:1421-1427`)。端末への転送と展開は表示停止の後と決めてある(`release_signage/tasks/prepare.yml:86-106`)。
- 確認済み: 端末には `kiosk-launch.sh` の `APP_REF=<sha>`(`templates/kiosk-launch.sh.j2:47`)と動いているコンテナのイメージがあり、導入済みのものはある程度分かる。
- 確認済み: `roles/signage` は `release_signage` がテンプレートを使う。`controller_gh_verifier.py` はランチャが import する。どちらも消さない。`route_preflight.py` は自分のテストからしか使われない。
- 確認済み: `scripts/ci/run-deploy-contracts-local.sh:75,80` が削除候補のシェルテストを呼ぶ。

## Decision Log

- 決定1(PR2): ci.yml、codeql.yml、gitleaks.yml の main push のグループを「イベント名+SHA」ごとにする(同じ SHA の定期実行や手動実行が待ち中の push を置き換えないように)。ci.yml の cache-to はすべて ignore-error=true にする。PR は従来どおり PR 番号のグループで取り消す。理由: 公開物は SHA ごとのタグで、共有の可変状態はキャッシュ(GHA と登録先の buildcache タグ)だけ。3つ同時に直さないと公開ゲートが時間切れになる。代案の `queue: max`(待ちを複数持つ)は GitHub の仕様を一次資料で確かめるまで使わない。
- 決定2(PR3): torque-release.yml は変えない。「origin/main == 対象 SHA」検査は `docs/decisions/ADR-20260818-release-set-v2-component-adoption.md`(:85「exact-main-only adoption」、:87)で意図して置かれ、`scripts/ci/tests/test_staged_ci_workflow.py:675` が固定している。torque の v2 は最新の main だけに作る設計なので、ref ごとのグループで古い push が待ちから外れても設計どおり。PR2 の ci.yml の並行化とは独立している(torque-release.yml は CI の結果を SHA で待つ)。
- 決定3(PR5): 表示だけにする。`--status` の終了コードは変えない(呼び出し元が失敗と誤認するため)。飛ばした端末の一覧を run ID ごとに残し、`--status <RUN_ID>` で出す。「次回は未適用を優先して対象に入れる」はやめる(exact `--limit` の規則と封印した対象の検査に反する)。
- 決定4: 最初の案の「リリースセット v3 に全部品のダイジェストを前進させる」「端末ごとの installed.json」は採らない。理由: (a) PR2 で run が並行になると直前のセットがまだ無いことがあり、連続マージで main が赤になる、(b) torque の v2 は schema 1 の土台を前提にしている、(c) ロールの検査が SHA タグを前提にしている、(d) installed.json はロールバック後に実態とずれる。代わりの方式は第2段で決める。
- 決定5: 段階移行(読む側を先にデプロイ)は不要。ランチャとセットの読み書きは同じコミットのため。必要なのは新しい読み手が古いセットを読めることだけ。
- 決定6: Pi3 の準備の分割はやめる。取得は既に Ansible の前で済んでいる。
- 決定7(第2段、2026-11-21): 部品ごとに祖先の公開物を使う方式も、全部品を毎回作る方式も採らない。代わりに、部品の入っていない版を Pi4 にデプロイしようとしたら止め、明示の指定があるときだけ通す(下の「第2段の設計」)。理由: 2026-11-20 のレビューで、祖先方式は CI の署名と Trivy の順序、全キオスクのロールの変更、Pi3 の停止条件まで手を入れないと成り立たないと分かった。一方、600コミットの集計で、取り残しが起きるのは、選んだ端末で有効なエージェントがセットに無い SHA(`agentServices` が空のセットや、torque だけのセットなど)で Pi4 にデプロイしたときに限られ、今の運用の決まりで避けている。ユーザーが小さく止める案を選んだ(2026-11-21)。
- 決定8(第2段、2026-11-21): 止める判定はランチャ(Python)ではなく Ansible の `assert` で行う。理由: ロールと同じ式を同じ Ansible が計算するので、ansible-core の版が上がっても判定がずれない。Ansible の標準機能を使い、独自の実装を最小にする方針(ユーザーの指示、2026-11-21)。判定は判定だけの別の playbook に置き、`--print-plan` と実行の両方でランチャが本体の前に流す(標準の playbook の `always` の検査、失敗時の片付け、既存の構造テストを避けるため)。

## 第2段で確かめた事実(2026-11-20)

- 確認済み: CI の時間。main push の CI で、Pi4 エージェントの公開(3並列)は1本 52〜151 秒、サイネージの検査と公開は各 30〜41 秒(run 44753539135、44752118674、44747709600)。どれも `ci-required` の後に API/Web イメージと並列に走り、開始から `release-set` 完了までは、これらが走った run で 396〜421 秒、走らない Web だけの run(44735887369)で 399 秒。キャッシュが効いた run しか見つからなかった。キャッシュ無しの arm/v7 ビルドは 35〜56 分(コミット c6cf0b0b のメッセージ)。
- 確認済み: `release-set` は Pi4 エージェントとサイネージの公開を待たない(`ci.yml` の `release-set` の needs)。測った3本では、エージェントの公開が `release-set` より 11〜93 秒遅れて終わった。セットがあっても、そこに名前のあるエージェントのイメージがまだ無い時間がある。
- 確認済み: 既に `classify_event_changes.py:49-65` は、`requires_complete_fleet_artifacts` に当たるファイル(Pi4 キオスクへ配るファイルなど)の main push で、全エージェントとサイネージを作り、`pi4AgentServices` を全部にする。取り残しが起きるのは、有効なエージェントがセットに無い SHA で Pi4 にデプロイしたとき(「第2段の設計」の「何を防ぐか」)。
- 確認済み: Pi4 は Web だけのリリースでも丸ごと飛ばされてはいない。証明書の照合、通知、kiosk-browser の再起動(`release_kiosk/tasks/switch.yml:135` 付近)、health は、それぞれの条件を満たせば動く(`prepare.yml:132,461,535` など)。`pi4ReleaseFiles: skipped` はファイル配置だけの話で、GUI セッションの条件によってはエージェントが無くてもランチャとブラウザの unit は配置される。
- 確認済み: Pi4 のエージェント切り替えは `docker compose -f /etc/raspi-release/client-compose.yml up -d --no-build <services>`(`switch.yml:83-92`)。対象は「端末で有効なエージェント ∩ セットの `agentServices`」(`prepare.yml:28-56`)。イメージは `raspisys-<名前>-agent:{{ release_sha }}`(`defaults/main.yml:10-12`)で、`prepare.yml:8-15` が `release_sha in <イメージ>` を検査する。
- 確認済み: Pi4 の準備は Pi5 の切り替え(`deploy-release-standard.yml:193-213`)の後(`:215-263`)。準備に失敗した台があれば全台の準備物を掃除して止まり(`:265-305`)、Pi5 だけ新しいまま終わる。
- 確認済み: Pi3 は転送の前に lightdm とサイネージを無条件に止める(`release_signage/tasks/prepare.yml:85-93`)。切り替えが要らない場合でも止めて起動し直す。
- 仕様(実機未確認): compose の `up -d` は、サービスの設定(イメージの参照を含む)とイメージが今のコンテナと同じなら作り直さない。見送った全面の作り直しで使う前提だったもので、今の案では使わない。
- 確認済み: torque の v2 セットは `agentServices` を `["torque-agent"]` に固定し(`release_artifact_contract.py:364-367`)、通常セットの `agentServices` は v2 の作り方に入らない。

## 第2段の設計(2026-11-21 書き直し、判定を Ansible に移した版)

ユーザーの判断(2026-11-21): 全面の作り直しはせず、「小さく止める案」で進める。部品の入っていない版を Pi4 にデプロイしようとしたときは止め、明示の指定があるときだけ通す。さらに、Ansible の標準機能を使い独自の実装を最小にする方針から、判定は Ansible の中で行う(決定8)。

### 何を防ぐか

リリースする SHA を S とする。対象の Pi4 で有効なエージェントのうち、S のリリースセットの `agentServices` に入っていないものは、このデプロイで更新されない(`prepare.yml:28-56` の積集合)。その端末がそれ以前のデプロイで古い版のままなら、取り残しが続く。直前までに届いていないものが何であれ、「有効なエージェントがセットに無い SHA で Pi4 にデプロイしたとき」に起きる。

ランチャも Ansible も各端末の今のエージェントの版を知らない(下の確認済み事項)ので、「本当に古いか」は判定しない。「更新されないエージェントがある」ことを理由に止め、前の版のままでよいと人が確かめたときだけ、指定を付けて通す。

### 判定を Ansible に置く理由(決定8)

最初の書き方(2026-11-21 のレビュー1〜5回目)は、ランチャ(Python)が inventory の値を読み、ロールの式を真似て判定する形だった。レビューで次の問題が続いた。ロールの `bool` の読み方は ansible-core の版で変わり(2.19 で厳しくなった)、版は固定していない(CI は `pip install ansible-core` で毎回最新、`ci.yml:516、869`。Pi5 のランチャは Pi5 上の `ansible-playbook` を使う)ので、真似た判定はずれうる。読めない値の扱い、Ansible との突き合わせテスト、Mac と Pi5 の判定のずれへの対策が要った。判定を Ansible の中に置けば、ロールと同じ式を同じ Ansible が計算するので、これらがまとめて不要になる。

### 止める仕組み(PR6)

- ロールの有効エージェントの式(`infrastructure/ansible/roles/release_kiosk/tasks/prepare.yml:28-35`)を、ロールの変数 `release_kiosk_enabled_agent_services`(新しく作る `roles/release_kiosk/vars/main.yml`)に移す。defaults ではなく vars に置くのは、inventory の同名の値に上書きされないため(defaults は優先度が最下位で、端末に `[]` を置くと判定が素通りすることを実験で確認。role の vars は inventory に勝つ)。`prepare.yml` の `Select agents enabled for this Pi4` の set_fact(`release_kiosk_enabled_services`)は残し、右辺だけこの変数にする(この fact を使う `agents_hardened_prep.yml:25、56、67`、`first_install_preflight.yml:25`、`prepare.yml:46-55` は変えない)。式を1か所にして、判定とロールがずれないようにする。
- 新しいタスクファイル `roles/release_kiosk/tasks/agent_coverage.yml` に `ansible.builtin.assert` を1つ置く。不足を「`release_kiosk_enabled_agent_services | difference(release_kiosk_agent_services)`」とし、条件は次の2つを両方満たすこと。(a) 不足から、その端末について指定で許したエージェント `release_allowed_missing_agents.get(inventory_hostname, [])`(端末名からエージェント名のリストへの辞書)を引いたものが空。(b) 不足が空か、初回導入でない(初回導入では指定を見ない)。判定にも本体と同じ `release_kiosk_service_allowlist`(cutover でないとき `[]`、`standard-ansible-release.py:717`、`:1481`。extra vars なので inventory の値に勝つ)を渡すので、端末に置かれた値は本体と同じく効かず、判定だけが止まることも無い。assert と下の debug には `tags: [always]` を付ける(継承したタグの指定で判定が飛ばされないため。`ANSIBLE_RUN_TAGS=pi4` でタスク0件・終了コード 0 になり、`always` を付けると止まることを実験で確認)。`fail_msg` に、端末名、更新されないエージェント名(`sort` して並びを固定する。`difference` の並びは不定)、`docs/guides/deployment.md` の該当節を出す。指定の書き方(`--allow-agent-skip <端末名>:<エージェント名>:<T>:<project>`。T と付けてよい条件は deployment.md の手順で確かめる)は初回導入でないときだけ出す(初回導入では指定が使えないため)。
- 指定で通したときは、同じファイルの `ansible.builtin.debug` で、端末ごとに更新されないエージェント名を出す(journal に残る)。許したのに不足に無いエージェントがあっても止めない(debug で出すだけ)。
- 判定だけの playbook `infrastructure/ansible/playbooks/release-agent-coverage-check.yml` を新しく置く。プレイは1つで、`hosts: kiosk`、`gather_facts: false`、`any_errors_fatal: false`(全端末の不足をまとめて出すため)、中身は `import_role`(`name: release_kiosk`、`tasks_from: agent_coverage`)だけ。`import_role` は `tasks_from` でも `defaults/main.yml` と `vars/main.yml` を読む。標準の playbook(`deploy-release-standard.yml`)は変えない。別の playbook にする理由は3つ。標準の playbook の `always` タグ付きの staging の検査(`deploy-release-standard.yml:12-22、56-66`。staging は `staging_deploy_enabled: false`)が `--tags` を付けても動き、計画の表示が止まってしまうこと。判定で止まったときに Pi4 の失敗時の片付け(下)を流さずに済むこと。プレイの数や並びを固定している既存のテスト(`scripts/deploy/tests/test_ansible_standard_release.py:1747-1790、1814、2014`、`test_os_security_update_units.py:201-210`)を動かさずに済むこと。
- 手元の ansible-core 2.19.4 で、偽の端末2台と Pi5 の inventory で試した(2026-11-21、2回)。`import_role` の `tasks_from` で defaults と vars が読まれ、`gather_facts: false` の assert と debug は端末に接続せずに動いた(到達しないアドレスでも判定できた)。
- 入力: `release_kiosk_agent_services` はランチャが既に組み立てている(実行は `standard-ansible-release.py:1481`、`--print-plan` は `:717`)。ランチャは `release_allowed_missing_agents` を必ず渡す(指定が無ければ `{}`。渡さないと inventory 側の値で通ってしまうことを実験で確認)。v1 のセットで `agentServices` が無いか `null` のときは3種に既定され(`scripts/deploy/release_artifact_contract.py:347-368、629-633`)、止まらない。明示の `[]` は既定されず、有効エージェントがあれば止まる。有効エージェントの3つの変数は `inventory.yml` の平文(`torque_agent_enabled` は staging の `group_vars/staging.yml:255` にもある)で、Vault の値を参照しない。
- 止めないもの: torque cutover(ランチャが判定を流さない。v2 は torque だけに固定され別の検査がある)、Pi4 を含まない選択(判定を流さない)、有効エージェントが無い Pi4(不足が出ない)。
- 初回導入: 指定を見ない(不足があれば必ず止まる)。有効エージェントが0の拒否などは、今どおり `first_install_preflight.yml:17-29` に任せる。

### ランチャの変更

- 引数 `--allow-agent-skip PAIRS` と `--allow-agent-skip-sha SHA` を足す(片方だけは拒否)。`PAIRS` は、更新されないことを確かめた「端末名:エージェント名:T:project」のカンマ区切り(エージェント名は `nfc-agent`、`barcode-agent`、`torque-agent` のどれか。端末名は選択に入った Pi4 の端末名で、Pi5 側では応答しない端末を外す前の選択で確かめる。外れた端末の組は判定に渡らないだけで、拒否しない。T は「指定を付けてよい条件」の手順1で読んだ、その端末で動いているそのエージェントのイメージの40桁の SHA。project は同じ手順1で読んだ、そのコンテナの Compose の project(手順6の人の確認はそのコンテナについて行うので、実行時に同じ project のコンテナであることを照合する)。端末とエージェントの組の重複は拒否。project は Compose の名前の書式(英小文字・数字・`-`・`_`)を検査する)。`SHA` は確かめたときの S(40桁)で、デプロイする SHA(Mac は `resolve_sha` の結果、Pi5 は `args.sha`)と違えば拒否する(確かめた後に main が進んだら確かめ直させる)。判定の playbook には、Ansible の変数 `release_allowed_missing_agents` を端末名からエージェント名のリストへの辞書として必ず渡す(指定が無ければ `{}`。inventory の値で暗黙に通らないように)。許すのは挙げた端末とエージェントの組だけなので、確かめていない端末に同じ名前の不足が出ても、計画と実行で inventory が違って不足が加わっても、判定で止まる。Ansible に渡す辞書には T を入れない(T の照合は下の実行時の読み直しで行う)。`--first-install`、`--torque-cutover`、`--status`、`--full-fleet` との併用は引数の解析で拒否し、`--limit` は端末名の列挙だけを受け付ける。`--first-install` の検査(`:185-190`)は書式だけで `all` や `kiosk` も通すので、それに加えて、Mac と Pi5 の両方で、各名前が inventory の端末名そのもので(グループ名と一致しない。Pi5 と Pi3 の端末名も可)、解決した端末の集合が指定した名前の集合と一致することを確かめる。選択に Pi4 が1台も無いときは拒否する。この選択に対する検査は inventory が要るので、引数の解析ではなく新しい関数にし、`main()`(Mac)と `execute_standard_route()`(Pi5)の両方で呼ぶ(初回導入の `validate_first_install_selection`、`:287-301` は選択が Pi4 だけであることも要求するので、そのままは使えない)。`--status` は他の指定を拒否する一覧を持つ(`:200`)ので、そこにも足す。Pi5 側の実行には `--skip-kiosk-notice` と同じ形で2つとも値ごと引き継ぐ(`:777-783`)。新しい引数は `getattr(args, ..., None)` で読む(`argparse.Namespace` を手で組むテストがある、`test_standard_ansible_release.py:164`、`:241`、`:272` など)。進捗追跡の会話のパイプラインでは既定で付けない。
- 読み取りのモード `--agent-images --limit <Pi4 の端末名>` を足す(指定を付けてよいかの手順1と、下の実行時の読み直しで使う)。`--status` と同じく、`parse_arguments` で先に返し(`:199-205`)、ブランチは受けず、inventory は `--inventory` で受ける(省略時は標準。デプロイと同じ inventory を渡す)。他の指定(`--limit` と `--inventory` を除く)とは併用させない。`--limit` の各名前は、既存の端末名の書式の検査を通し、その inventory の kiosk の端末であることを Mac で確かめてから渡す。`--status` と同じく、Mac は inventory から Pi5 を解決し(`server_connection`、`ssh_argv`、`:1562-1572`)、同じ ssh の形で、デプロイと同じ `server_release_root(document)`(`:502`。staging は別の `release_remote_root`、`group_vars/staging.yml:101`)で解決した Pi5 側の checkout を作業ディレクトリにし、`ANSIBLE_CONFIG=<その checkout>/infrastructure/ansible/ansible.cfg` を付けて(ランチャと同じ設定、`:249-252`。付けないと `become`、`roles_path`、`vault_password_file` が外れる)、その checkout からの inventory の相対パスで、下の読み取り用の playbook を流す(Mac から Pi4 へ直接はつながない。`deployment.md:72`、`:222`)。run も lock も作らず、何も変えない。Pi5 の checkout は任意の SHA にあり得るが、流すのは inventory と読み取りだけ。PR6 を含む SHA を Pi5 に一度デプロイするまでは、Pi5 の checkout に読み取り用の playbook が無いので使えない(そのときは指定も付けられない)。
  - 読み取り用の playbook `infrastructure/ansible/playbooks/release-agent-images-read.yml` を新しく置く(`hosts: kiosk`、`gather_facts: false`、`import_role` の `tasks_from: agent_images`)。ad-hoc のコマンドにしないのは、ad-hoc ではロールの defaults(`release_kiosk_compose_project` の既定 `docker`)が読まれず、staging などの inventory の上書き(`group_vars/staging.yml:108`)との組み合わせを自前で組むことになるため。playbook にすれば、ロールの既定と inventory の上書きを Ansible がいつもの優先順位で解決する。
  - 新しいタスクファイル `roles/release_kiosk/tasks/agent_images.yml` は、3種のエージェントごとに、既存の `prepare.yml:201-214` と同じ絞り方(`docker ps --all` に Compose のラベル `com.docker.compose.project`=`release_kiosk_compose_project`、`com.docker.compose.service`=エージェント名)でコンテナを探し、各コンテナの `docker inspect` の `.Config.Image`(タグ付きのイメージ名。イメージの ID では手順1のタグの判定ができない)と `.State.Status` を読む。止まっているコンテナも数え、状態ごとに出す。docker の書式の `{{` は既存と同じく `$'\173\173'` で Ansible の展開を避け、既存のタスクと同じく `args.executable: /bin/bash` を付ける(`prepare.yml:201-216`。`$'...'` は bash の書き方なので)。タスクには `become` を書かず、設定ファイルの既定(`become = True`)に任せる。`changed_when: false` で何も変えない。
  - 結果は Ansible の出力から拾わず、ファイルで受け渡す(出力の形は `ansible.cfg:11-12` の `callback_result_format = yaml` や、継承した `ANSIBLE_DISPLAY_OK_HOSTS`、`ANSIBLE_CALLBACK_FORMAT_PRETTY` で変わり、debug の文字列は折り返しやエスケープが入るため。手元の 2.19.4 で確認)。`agent_images.yml` の最後に、`ansible.builtin.copy`(`delegate_to: localhost`、`become: false`)で、端末名・エージェントごとのコンテナのイメージ名と状態・タグを除いた期待のイメージ名(ロールの既定と inventory から組む `defaults/main.yml:10-12` の形の、最後の `:` より前。レジストリ名にポートが入っても切り違えない)・`release_kiosk_compose_project` を `to_json` にした内容を、ランチャが `-e release_agent_guard_out_dir=<一時フォルダ>` で渡したフォルダの `<端末名>.json` に書く。ランチャは一時フォルダを作って渡し、終わったら中のファイルを読んで消す。ファイルが無い端末(届かない、失敗した)は「読めない」とする。`--agent-images` では、Pi5 の実行(`:785`)と同じく短い bash のスクリプトを ssh で、デプロイと同じ `/bin/bash -lc`(`:1174`。非ログインのシェルでは `ansible-playbook` が PATH に無いことがある)で渡し、その中で `cd <checkout>`、`mktemp -d`、`ANSIBLE_CONFIG=... ansible-playbook ... -e release_agent_guard_out_dir="$d"`、`trap` で一時フォルダを必ず消す。ansible-playbook の出力は stderr に回し(stdout の JSON に混ぜない)、その終了コードは変数に取って `set -e` で途中終了させない(1台が届かなくても他の端末のファイルを返すため)。stdout には各ファイルを `cat` の後に改行を足して1行ずつ出す(`copy` の `to_json` は末尾に改行が無く、2台以上で行がつながることを実験で確認)。最後に Ansible の終了コードを1行で出す(`ssh_argv` は1コマンドを `shlex.join` するだけ、`:765-766`)。Mac はその行を JSON として読み、端末名・エージェント名・コンテナごとのイメージ名と状態を JSON にまとめて stdout に出す。
- 実行(Pi5 側): 判定を流す関数(例 `run_agent_coverage_check`)を1つ作り、`execute_standard_route` の中で、リリースセットの検証(`release_set_artifacts`、`:1470-1477`)の直後、サイネージと回答キャッシュのイメージの取得(`:1479`、`:1492-1498`)より前に呼ぶ。`execute_ansible_with_cleanup`(`:1510` で呼ばれ、`:1526-1547`)は変えない。判定に要る値(応答する Pi4 の端末、`release_kiosk_agent_services`、初回導入か)は、`variables`(`:1480-1481`)を待たず、`reachable_selection` と `artifacts` から判定の前に組み立てる。応答する Pi4 を含み torque cutover でないときだけ(Pi4 が全台応答せず外れたときは流さない)、判定の playbook を本体と同じ inventory、同じ `--limit`(応答しない端末を外した後の `effective_limit`)、同じ変数(`release_kiosk_agent_services`、`release_kiosk_first_install`、`release_kiosk_service_allowlist` の `[]`)と `release_allowed_missing_agents` で流す。指定があるときは、判定の前に、指定の組のうち `effective_limit` に残った端末について、読み取り用の playbook(上)を実行と同じ inventory で流し、そのエージェントのコンテナがちょうど1つで動いていて、イメージの完全な参照が、結果のファイルにある期待のイメージ名に `:T` を付けたものと一致し、コンテナの Compose の project が、結果のファイルの `release_kiosk_compose_project`(S の版で本体がこれから扱う project)と、指定の project の両方に一致することを確かめる(読み取りのモードは Pi5 の checkout の版で project を決めるので、S の版と違うことがありうる。違えば、人が手順6で確かめたコンテナと本体が扱うコンテナが別なので止める)。違う、読めない、組の端末に届かないときは、判定の失敗と同じに扱い、ランチャは 0 以外(1)を返す。判定と読み直しの Ansible には上限時間(例 300 秒)を付ける。子は新しいセッションで起動し、出力を取り込む `subprocess` の timeout を超えたらプロセスグループごと止め、種別 `timeout` で 1 を返す。起動できないときも 1 を返す。片付けは本体のときと同じ `remove-run` と、一時フォルダを消す `finally` に任せる(読み直しは排他を持ったまま Pi4 に接続するので、SSH が固まってもロックを持ち続けないため。`--agent-images` は Mac 側で ssh を切ると Pi5 側の `trap` が動かないことがあるので、Pi5 に渡すスクリプトの中で `timeout 300 ansible-playbook ...` とする)。この読み直しは Pi5 の排他(`:785` の `flock`)の中で行うので、確かめた後に別の実行で T が替わっていても、読み取りのモードと実行で inventory が違っても、ここで止まる。判定の照合は台数ではなく端末名の集合で行う。`agent_coverage.yml` の assert の後に、合格した端末ごとに、上と同じ形で `<端末名>.json` を、読み直しとは別の、判定のたびに新しく作った空の一時フォルダに書くタスク(`delegate_to: localhost`、`become: false`、`tags: [always]`)を置き、ファイルのある端末名の集合が判定に渡した Pi4 の端末名の集合と一致しないとき(別の端末、assert が飛ばされた、タスクが0件など)は、Ansible の終了コードが 0 でも判定の失敗とし、ランチャは 0 以外(1)を返す。判定が失敗したら、本体と Pi4 の失敗時の片付け(`release-pi4-failure-cleanup.yml`)を流さずに判定の終了コードを返す。そのとき、`execute_ansible_with_cleanup` の `finally` にある `remove-run`(`:1541-1547`。失敗しても警告だけ)を共通の関数に切り出して同じように呼び、応答しない端末の行の出し直し(`:1516-1523`)も同じように行う(出し直しの `try/finally` の範囲を広げ、判定の呼び出しから、サイネージと回答キャッシュの取得、本体の呼び出しまでを中に入れる)。判定の Ansible を起動できなかったとき(`OSError` など)も、判定の失敗と同じに扱う(本体と片付けを流さず、`remove-run` と出し直しを行う)。なお `remove-run` は systemd の `ExecStopPost` にもある(`:1139-1146`)。明示で呼ぶのは、本体のときと同じく、unit が残っても状態を消すため。判定のコマンドの環境からは `ANSIBLE_RUN_TAGS` と `ANSIBLE_SKIP_TAGS` を外す(タスク側の `tags: [always]` とあわせて二重に防ぐ。計画側も同じ)。判定と読み直しの Ansible は出力を取り込み(本体は取り込まずに流している、`:1532`)、成功でも失敗でも stdout と stderr の各行に固定の接頭辞(例 `[agent-guard] `)を付けて journal に出し直す(結果は上のファイルで読む。`run()` は失敗時に stderr を優先して stdout を落とす(`:141-145`)ので使わない)。接頭辞を付けるのは、`--status` の要約(`safe_diagnostics.py:160-185` は行の先頭で `TASK [`、`fatal:`、`PLAY RECAP` を見る)に判定の recap が本体の recap と同じ形で並び、判定の後のサイネージの取得で失敗したときに本体が動いたように見えるのを避けるため。`--status` の `Result` と `ExecMainStatus` で分かるのは実行が失敗したことまで(リリースセットの取得や本体の失敗でも同じ値になる)で、判定で止まったかとその種別は、`--status` の要約に出る停止の1行(下の `--status`)で見る。
- 計画(`--print-plan`、Mac 側): 今の `--list-hosts` と `--list-tasks`(`:731-732`)の後、Pi4 を含み torque cutover でないときだけ、判定の playbook を同じ `--limit` と変数で流す。判定の出力(Ansible は `fatal:` も stdout に出す)は `run(..., check=False)`(`:141-145`。stdout と stderr の両方が返る)で受け取り、stderr に出す。既存のテストは `run()` を差し替えているので(`test_standard_ansible_release.py:223-235`、`test_staging_inventory_boundary.py:275-337`)、新しい呼び出しも `run()` を通す。判定の実行は名前付きの関数1つにまとめ、`plan()` の中ではなく `main()` から、`plan()` の後で `unpublished_plan_images`(`:1625`)より前に呼ぶ(`plan()` を直接呼ぶテストを変えずに済む。両方に当たるときは判定の文面が出る)。端末名の集合の照合は実行と同じに行い、照合の失敗も 0 以外にする。計画では T の読み直しはせず(Pi5 の排他の中でしか意味が無いため)、指定の書式と組の検査だけを行う。合格なら stdout には今と同じ JSON だけを出す(指定ありで通ったときの、端末ごとの更新されないエージェントは stderr に出る)。不合格なら JSON を出さず、終了コードを 0 以外にする。Vault: Mac は今も同じ `ansible.cfg`(`vault_password_file`、`ansible.cfg:14`)で `ansible-inventory --list` と `--list-tasks` を流しており、判定の playbook も通常の設定のまま流す。テストで Vault で暗号化した host_vars を含む inventory でも判定まで動くことを確かめる(手順4)。
- 計画は応答しない端末を外す前の選択で判定し、実行は外した後で判定する(外すのは実行時だけ。`:1445-1468`)。計画で止まって実行なら通る場合がある(止める側に倒れる)。
- `--detach`: 起動の成功と実行の結果は別。実行の失敗は、`--status` に出る systemd の `SubState`、`Result`、`ExecMainStatus`(0 以外)で拾う。判定で止まったかとその種別は、`--status` の要約に出る停止の1行(下の `--status`)で見る。
- `--status`: 判定と読み直しの出力には接頭辞が付くので、`--status` の要約(`rolling_release/safe_diagnostics.py:160-185`)には判定の `fatal:` も recap も出ない。`Result` と `ExecMainStatus` は実行の失敗を示すだけなので、判定で止まったかとその種別は、下の1行で見る。ランチャは判定で止めるとき、`[agent-guard] stop ` の後に `{"kind": 種別}` だけの1行の JSON を stderr に出す。種別は閉じた語彙で、`check-failed`(判定の Ansible が 0 以外。不足か他の失敗かは区別しない)、`check-result-missing`(端末名の集合が合わない)、`check-launch-failed`(起動できない)、`reread-mismatch`(T か project が合わない)、`reread-unreadable`(読めない、組の端末に届かない)、`timeout`(上限時間を超えた)のどれか。端末名やエージェント名は載せない(ランチャは Ansible の出力から拾わないので、不合格の端末の不足は持たない)。`--status` の要約に、この行を拾って種別を語彙と照合してから出す種類を1つだけ足す(手入力の SSH は禁止で(`deployment.md:72`、`:222`)、実行時にだけ起きる停止は `--print-plan` で再現しないため)。他の `[agent-guard]` の行は要約に出さない。`check-failed` の端末とエージェントは、同じ `--limit` で `--print-plan` を流して見る(Mac も Pi5 も S の同じ inventory を使う)。読み直しの種別は、自分が付けた指定の組について起きる。

### 止まった後に起きること(事実)

- 止まるのは本体の Ansible(Pi5 と Pi4 のサービスの切り替え)の前。ただし Pi5 は無変更ではない。checkout は既に S に替わっている(リモートの実行は `:785` の `git checkout --detach` の後)。今のほかの失敗と同じで、次の実行で替わる。
- Pi5 では、判定より前にリリースセットの取得と検証が終わっている(判定をサイネージと回答キャッシュの取得より前に置くので、それらはまだ取得しない)。API と Web のイメージ本体は本体の Ansible が取得する(`release_pi5/tasks/prepare.yml:43-46`)ので、まだ取得しない。`remove-run` は該当する項目が無くても状態ファイルを保存し直す(`deploy-status-state.py:497-498`)。Mac から起動したときは、回答キャッシュと Hermes の素材を、該当する指定があれば systemd の起動の前に Pi5 へ送っている(`standard-ansible-release.py:1664-1681`)ので、それらは送られたまま残る(今のほかの失敗と同じ)。
- Pi4 と Pi3 には何も起きない(判定は接続せず、本体と片付けは流れない。キオスクに保守表示も出ない。保存の案内と保守表示は本体の中の `release_kiosk/tasks/notice.yml:7-25` で出る)。run の記録は `remove-run` で消すことを試みる。

### 指定を付けてよい条件(deployment.md に書く手順)

止めた文面に出た端末とエージェントの組ごとに、次を確かめたときだけ、その組と手順1で読んだ T を指定に入れる。指定は挙げた組だけを通すので、別の端末に同じエージェントの不足があればそこで止まる。`--limit` は端末名で書く(グループ名と `--full-fleet` は、選択に入る端末が意図より広がりやすく、計画と実行で選択がずれても気づきにくいので、ランチャが拒否する)。確かめは対象の SHA(S、ランチャが流す main の先頭)について行う。デプロイの前に main が進んで S が替わったら確かめ直す。1〜6 のどれかで確かめられないときは指定を付けない。

1. その端末で動いているエージェントのイメージのタグを読む。SSH の手入力も Mac から Pi4 への直接の接続もしない(`deployment.md:72`、`:222`)ので、ランチャの読み取りのモード `scripts/update-all-clients.sh --agent-images --limit <端末名>`(デプロイと同じ inventory を `--inventory` で渡す)を使う。そのエージェントのコンテナが止まっているものを含めてちょうど1つで、それが動いていて、イメージが `ghcr.io/<名前空間>/raspisys-<名前>-agent:<40桁の SHA>`(`defaults/main.yml:10-12` の形)のときだけ、その SHA を T とする。それ以外(コンテナが無い・止まっている・2つ以上、torque cutover で入れた torque-agent のダイジェスト指定、`prepare.yml:10-15、195`、ロールバック後のタグ `raspi-standard-rollback:<run>-<名前>`、`prepare.yml:197`、Pi5 から端末に届かない)は、確かめられないものとする。
2. タグの SHA(T)が S の祖先であることを確かめる(`git merge-base --is-ancestor T S`)。違えば確かめられないものとする。
3. CI の分類をそのまま使い、T から S までにそのエージェントを作り直す変更が無いことを確かめる。`python3 scripts/ci/classify_event_changes.py --event-name push --base-sha T --head-sha S --repo .`(CI が main push で使う分類。差分は T と S の間で1回取る)の JSON の最上位の `pi4AgentServices` にそのエージェントが無く、最上位の `failClosedReasons`(リスト)が空であることを確かめる(ファイルごとの項目にも `pi4AgentServices` と単数の `failClosedReason` があるが、見るのは最上位だけ)。`ci.yml` の変更や改名・削除で CI が全エージェントを作り直す場合はここに入り、指定は付けられない(止める側)。T が手元に無いときも全エージェント扱いになる(`collect_changed_files.py:31-58`)。torque-agent は、同じ結果の最上位の `torqueComposition` が真なら指定を付けない(torque の API 側の変更。分類の Pi4 の項はエージェントのイメージしか見ず、API との互換性は見ない)。
4. エージェントの設定(`.env`)は、セットに入ったエージェントの分しか書き直されない(`prepare.yml:546-548`)。設定の元(`api_base_url` などは `group_vars/all.yml:50、54、66`)は分類の Pi4 の項に入っていない(`classify_changes.py:123-158`)ので、`git diff --name-only T S -- <使う inventory ファイル> infrastructure/ansible/group_vars infrastructure/ansible/host_vars infrastructure/ansible/roles/client_server_cert_pin` が空であることも確かめる。空でなければ指定を付けない。inventory を入れるのは、端末名の指す機械や接続先が T の後に替わっていないことを確かめるため。git の管理外の inventory では指定を付けない。Pi4 と無関係な `host_vars/raspberrypi5` などの変更でも不合格になるが、広く止める側に倒す(deployment.md にその旨を書く)。
5. Web と API の、そのエージェントとの通信の契約(例: `nfcRuntimeContract.ts`、`useSerialBarcodeStream.ts`、torque の API の経路)が T から S までに変わっていないことを、人が差分で確かめる。分類は Web 側の変更を `releasePair`(`classify_changes.py:567`、`:682`)としか出さず、エージェントとの互換性を判定しない(エージェントの判定は `pi4_agent_services_for_path`、`:284-297`)。スクリプトは、T から S までに変わったファイルのうち、そのエージェントの名前(`nfc`、`barcode`、`torque`)を含むものを並べて、確かめる候補として出す。迷ったら指定を付けない。
6. 端末ごとの `host_vars/<端末>/vault.yml` は git で追跡されているので、差し替えてコミットすれば手順4の差分で不合格になる(Pi5 の checkout は汚れていると止まる、`:785`)。人が確かめるのは、git に無いもの(`.vault-pass` の鍵そのものなど)を T をその端末にデプロイした後に替えていないことだけ。替えたなら、そのエージェントを含むセットをその端末にデプロイして反映するまで、指定を付けない。

PR6 に、読み取り専用の小さなスクリプト(`scripts/deploy/agent_skip_check.py`。テストは `scripts/deploy/tests/test_agent_skip_check.py`)を含める。手順3の分類は手元の checkout のものを使うので、ランチャ(`:518-519`)と同じく手元の HEAD が S で、作業ツリーに変更が無い(`git status --porcelain` が空。ランチャと同じ)ことを先に確かめ、違えば判定しない。入力は S、inventory、確かめる「端末名:エージェント名」の組(複数可。Web だけの SHA が多いので、止めた文面に出た組をまとめて渡せるようにする)。手順1の読み取りのモードの JSON から組ごとに T を読み、手順2〜4を判定し、手順5の候補(変わったファイル)を並べる。全部の組が合格のときも「手順1〜4は合格、手順5と6は人の確認待ち」と出し、手順5と6を確かめた後に付ける指定(`--allow-agent-skip-sha S --allow-agent-skip 端末名:エージェント名:T:project,...`)を1行でそのまま出す。どれかの組で手順1〜4が不合格か、判定できない(SHA が不明、端末に届かない、差分が取れない)ときは、その組を「付けてはいけない」と出して終了コードを 0 以外にし、指定の行は出さない。

指定で通すと、その端末で更新するエージェントが1つ以上あれば、`/etc/raspi-release/client-compose.yml` は今回のセットのサービスだけで書き直される(`prepare.yml:330-339、545`。0件なら今の Compose が残る)。外したエージェントのコンテナは動き続ける(切り替えに `--remove-orphans` は無い、`switch.yml:83-92`)が、この Compose ファイルからは作り直せない。これは今の動きと同じ(今は止めずに常にこうなる)で、そのエージェントを含むセットを次にデプロイしたときに戻る。

### 確認済み事項(設計の前提)

- 確認済み: ランチャは端末ごとの「最後に成功した版」を読めない。`--status` は Pi5 の systemd と journal を読むだけで、端末の版を出さない(`standard-ansible-release.py:1562-1573`、`rolling_release/safe_diagnostics.py:149-186`)。端末ごとの成功記録は初回導入の `completed-<host>.json` だけで、Pi4 上にある(`roles/release_kiosk/tasks/main.yml:114-121`)。
- 確認済み: Pi4 を含む選択では、祖先のセットへ切り替わらない(`:543-545`)。判定は S のセットで行えばよい。
- 確認済み: Pi3 は止める必要がない。Pi3 はリリースセットを使わず、`raspisys-pi3-signage:<S>` が無ければ、計画では例外で止まり(`:1625-1631`)、実行では取得の時点で止まる(`:1421-1427`)。
- 集計(main の直近600コミット、push の判定で再計算): エージェント3種とサイネージとリリースセットがそろうのは126件、間隔は最大33・平均4.8。リリースセットがあるのに `agentServices` が空か一部のものは431件、リリースセットが無いものは43件。これは目安で、止まるかは選んだ端末で有効なエージェントによる。Web だけの変更で Pi4 を更新するときは、指定を付けるか、エージェントがそろう SHA を待つことになる。今の運用の決まり(Pi4 は部品入りのコミットが最新のときにデプロイする)を、仕組みで守らせる形。

### 実装の手順(PR6)

1. 専用の worktree(`python3 -m scripts.git_lifecycle.cli start --branch feat/deploy-pi4-agent-skip-guard`)で行う。
2. 実装の前に、有効エージェントの3つの変数の出どころが inventory の平文だけであることを、平文の定義箇所(`inventory.yml`、`group_vars/*.yml`)を `rg` で探して確かめる(vault.yml は開かない。`ansible-inventory --host` は復号した値も出すので使わない。優先順位と Vault の読み込みは手順4のテスト用の暗号化 inventory で確かめる)。式を `vars/main.yml` に移し、`prepare.yml` をその変数を使う形にする。式が `prepare.yml` の set_fact にあることを確かめている既存のテスト(`scripts/deploy/tests/test_ansible_standard_release.py:1323` 付近)を、vars を見る形に直す。あわせて Pi5 の ansible-core の版を `ansible --version` で1回確かめ、計画書の実験(手元の 2.19.4)と違えば、判定と読み取りの playbook の実験を Pi5 と同じ版で流し直す。
3. `agent_coverage.yml` と判定の playbook を足す。読み取り用の playbook と `agent_images.yml` も足す。どちらの playbook も構造(hosts、gather_facts、import_role と tasks_from)をテストで固定する。新しいファイルは既存のテストにも拾われる(`test_ansible_standard_release.py:72-77` の `role_text` はロールの下の `*.yml` を全部読み、`scripts/deploy/tests/test_ansible_task_keyword_placement.py:25` は `playbooks/*.yml` と `roles/*/tasks/*.yml` を走査し、`scripts/deploy/tests/test_ansible_shell_args_split.py:38` は `roles/*/tasks/*.yml` の shell と command を `split_args` に通す。`role_text` を使う検査は、ロールの下で `run_once:`、`ansible_play_hosts`、`ansible_play_batch`(`:2160-2163`)、`--build`、`build:`(`:2666-2674`)、`fleet-release-state`、`route_preflight`(`:2861` 以降)を禁じているので、合格した端末の集計に `run_once` は使わない)ので、それらが通る書き方にする。
4. 実際の Ansible で判定の playbook を流すテストを足す。偽の inventory(到達しないアドレス)で、不足あり・なし、指定あり・なし、指定したエージェントと別のエージェントが不足するときは止まること、初回導入で指定ありでも止まること、inventory に `release_kiosk_enabled_agent_services: []` を置いても判定が変わらないこと、`ANSIBLE_RUN_TAGS` を付けても判定が動くこと、`agentServices` が `[]` のとき、有効エージェントが無い端末、staging の inventory でも計画の判定が `always` の検査に止められないこと、Vault で暗号化した host_vars(テスト用の鍵)を含む inventory でも判定まで動くこと、文面にエージェント名が入ること、を確かめる。読み取り用の playbook も実際の Ansible で流し(端末を `ansible_connection: local` にし、PATH に偽の `docker` を置き、`inspect --format` に渡った引数まで確かめる)、ロールの既定の project 名と inventory の上書き(staging の `release_kiosk_compose_project`)の両方がコマンドに入ること、結果のファイルの形(端末名、期待のイメージ名、project を含む)、止まっているコンテナが状態つきで出ることを確かめる。`ANSIBLE_DISPLAY_OK_HOSTS=false` などの出力の設定を変えても結果が同じことも確かめる。CI は `scripts/ci/run-deploy-contracts-local.sh:82` の `unittest discover` で集め、ansible-core を必須にしている(`:46`)ので、unittest の形で書く(ansible-core が無い手元では skip、CI では必ず動く)。
5. ランチャの引数、併用の拒否、Pi5 への引き継ぎ、実行時の判定(失敗時に本体と片付けを流さず `remove-run` は動く)、計画での判定(合格で JSON 不変、不合格で JSON なし・0 以外)を足す。直す既存のテスト: `scripts/deploy/tests/test_standard_ansible_release.py` の `--status` の拒否(`:1755`)と Pi5 への引き継ぎ(`:1747-1753`)、`main()` を通る `--print-plan` で流すコマンドを2つに固定しているテスト(署名済みの `agentServices=[]` を確かめる `:1559`、`:1617` 付近。`[]` が変数にそのまま渡ることも確かめる。`plan()` を直接呼ぶ `:1439-1461` は判定を呼ばないので変わらない)。Pi4 を選んで `execute_standard_route` を流し `execute_ansible_with_cleanup` だけを差し替えているテスト(`:998-1029`)は、判定の関数も差し替える(差し替えないと本物の Ansible が走る)。torque cutover のテスト(`:1428-1432` 付近)では判定が呼ばれないことを確かめる。`--print-plan` の判定は、`_print_plan` の `run()` の差し替え(`:1505-1529`)で判定のコマンドと変数を確かめ、stdout(JSON だけ)と stderr を分けて確かめる(今の共通部品は両方を結合するので、分けて返す形に直す)。実際の Ansible を流すテストは、既存と同じく `ANSIBLE_ROLES_PATH` を環境で渡し、リポジトリの `ansible.cfg`(`.vault-pass` が要る)を使わない(`test_ansible_standard_release.py:833`、`:2203`)。選択の検査で `--limit kiosk` と `--limit raspberrypi5`(Pi4 が無い)が拒否され、`--limit raspberrypi5:<Pi4 の端末名>` は通ること、知らないエージェント名、選択に無い端末名、`--allow-agent-skip-sha` の不一致と片方だけの指定が拒否されること、端末 A だけを許して端末 B に同じ名前の不足があると止まること、`--agent-images` が何も変えず JSON を出すこと(`ssh_argv` を差し替えて確かめる)、`release_allowed_missing_agents` が必ず渡ること、判定で止まったとき(起動できなかったときを含む)に本体と片付けとサイネージの取得が呼ばれず、`remove-run` と応答しない端末の行の出し直しが呼ばれること、判定の失敗の終了コード(実測で 2)がそのまま返ることも足す。文面のテストは stdout と stderr の両方を見る。`execute_ansible_with_cleanup` は引数を変えず、`remove-run` を共通の関数に切り出すだけにする(既存のテスト `:1674-1688` はそのまま通る)。`test_standard_ansible_release.py:1531-1557` の2テスト(`:1531`、`:1543`)(`--limit pi4-a` で `main()` を通り、`run()` の差し替えが空の出力を返す)は、判定の関数を差し替える形に直す。未公開イメージのテスト(`:1531`)は判定より後の `unpublished_plan_images` を確かめるので、判定を合格に差し替える。`pi4ReleaseFiles` の skipped を確かめる呼び出し(`:1547-1549`)は `agentServices=[]` なので、有効エージェントの無い端末か指定ありで確かめる。`scripts/ci/tests/test_staging_inventory_boundary.py:282-293` は `ansible-inventory` 以外に空の出力と終了コード 0 を返して `--print-plan` の結果 0 を期待している(`:337`)ので、判定の関数を差し替えるか、判定の結果のファイルを置く形に直す。実行時の読み直しで、T が違う、読めない、組の端末に届かないときに止まること、応答しない端末を外した後に残った組だけを読み直すこと、外れた端末の組で拒否されないこと、判定の端末名の集合が合わない(同じ数の別の端末、assert が飛ばされた)と、Ansible が 0 を返しても止まり 0 以外になること、判定と読み直しの出力に接頭辞が付き `--status` の要約に判定の recap が出ないこと、staging の inventory で `--agent-images` が staging の checkout と `ANSIBLE_CONFIG` で流れること、`--agent-images` が `parse_arguments` で先に返りブランチを要求しないこと、T の書式(40桁)と project の書式の検査も足す。同じ T のコンテナが指定と別の project にあるとき、読み直しで止まることも足す。`--agent-images` で2台が読めて1台が届かないとき、読めた2台の結果と届かない1台の「読めない」が出て、Ansible の出力が stdout の JSON に混ざらず、一時フォルダが消えることも足す。ランチャ自身の停止理由の行が、起動できない・結果のファイルが足りない・T が合わないの各場合に `[agent-guard]` 付きで出ることと、止めたときの1行の JSON が `--status` の要約(`rolling_release/safe_diagnostics.py` に足す1種類)に出て、他の `[agent-guard]` の行は出ないことも足す。読み直しが上限時間を超えたとき「読めない」で止まることも足す。実行時に読み直しのファイルだけがあって判定のファイルが無いと、端末名の集合の照合で止まることも足す。
6. 「指定を付けてよい条件」のスクリプトを足す。Ansible の呼び出しは差し替えてテストする。合格(付ける指定が、複数の組をまとめた1行で出る)、タグが SHA でない、端末に届かない、祖先でない、分類にエージェントがある、torque で `torqueComposition` が真、設定の差分がある、差分が取れない、の各場合と、コンテナが2つある、`failClosedReasons` がある、の場合と、手順5の候補(名前を含む変わったファイル)と付ける指定がそのまま出ること、組のどれかが不合格なら指定の行が出ないことを確かめる。
7. `docs/guides/deployment.md` の選択肢の説明(`:41-76`)と `docs/guides/quick-start-deployment.md` に、`--print-plan` が実行するものの説明(`deployment.md:67`。判定の playbook を端末に接続せずに流すことを足す)とあわせて、指定の意味、読み取りのモード `--agent-images` の使い方、付けてよい条件、止まる場面、止まった後に起きることを書く。計画(`--print-plan`)と実行には同じ `--limit` を使い、計画の終了コードも見る、と書く。読み取りのモード `--agent-images` は公開の入口の一覧(`deployment.md:38-47`)に足し、`:222` の禁止(アドホック、Pi4 agent 操作)の対象外であると書く。今の運用の決まり(Pi4 は部品入りのコミットが最新のときにデプロイする)は deployment.md に書かれていないので、止まる場面とあわせて書く。`docs/runbooks/assembly-overlay-staging-hardware-acceptance.md:99-106` と `:528-536`(受入後のロールバックの計画)の計画の JSON を保存する例は、`tee` の後にランチャの終了コードを見ずにハッシュを作るので、1つ目は `set -o pipefail` と終了コードの判定をしてから、計画が成功したときだけハッシュを作る形に、2つ目(ハッシュは作らない)は計画が失敗したら承認と実行に進まないと書く形に直し、計画で判定の playbook が動くことも書き足す。
8. 確かめるコマンド(手元の速い確認。CI と同じ集め方は `scripts/ci/run-deploy-contracts-local.sh`): `python3 -m pytest scripts/deploy/tests/test_standard_ansible_release.py scripts/deploy/tests/test_ansible_standard_release.py scripts/deploy/tests/test_os_security_update_units.py scripts/deploy/tests/test_distrusted_intermediates.py scripts/ci/tests/test_staging_inventory_boundary.py -q`。

### 受け入れ(PR6)

- 上の手順2〜6のテストが通る。判定のコマンドに Pi4 の対象がいるのに判定のタスクが動かない場合(継承したタグなど)が無いことをテストで確かめる。不足が無いときは、`--print-plan` の JSON と実行の流れが今と変わらない。
- 実機: ランチャはブランチの先頭しか対象にできない(`:513-520`)ので、SHA を選んで試すことはしない。PR6 自体が `roles/release_kiosk` を変えるので(`classify_changes.py:158`、ランチャの変更も `:207-212` で全エージェント扱い)、PR6 のマージの SHA は3種がそろう。下の「そろえていないとき」は、その後の Web だけの SHA を待って確かめる。`--agent-images` は、PR6 を含む SHA を Pi5 にデプロイした後で確かめる。PR6 のマージ後、main の先頭のセットが `raspi4-kensaku-stonebase01` の有効エージェントをそろえていないときと、そろえているときに、それぞれ `--print-plan --limit raspi4-kensaku-stonebase01` だけを流す。前者は判定で止まって終了コードが 0 以外、後者は今と同じ出力と終了コード 0 になることを確かめる。あわせて `--agent-images --limit raspi4-kensaku-stonebase01` を流し、3種のエージェントのイメージ名が出て、何も変わらないことを確かめる(読み取りだけ)。`--print-plan` では、Mac で判定の合格ファイルが書けて一時フォルダが消えることも確かめる(今の計画は `--list-hosts` と `--list-tasks` だけで、Mac でタスクが実際に動くのはこれが初めて)。
- Pi5 側の経路(判定で止まったときに本体と片付けを流さない、`remove-run`、`--status` の見え方)は模擬のテストで確かめる。PR6 の後、実際の実行で初めて判定に止められたときに、`--status` の出力(停止の1行)を確かめて、この計画書に記録する。

### 運用への影響と順序

- PR6 を含む SHA をデプロイする前に、Pi4 を含むデプロイをするスクリプト(進捗追跡の会話のパイプライン)が、止まったときに失敗として扱い、指定を自動で付けないことを確かめる。Pi5 だけのデプロイは影響を受けない。部品のそろわない SHA で `--full-fleet` を流すと、Pi5 と Pi3 も本体の前で止まる(指定は `--full-fleet` と併用できない)。そのときは `--limit` で Pi5 と Pi3 だけを選ぶ、と deployment.md に書く。
- 本番の `raspi4-kensaku-stonebase01` と `raspi4-assembly-01` は torque が有効(`inventory.yml:395、496`)。torque-agent がダイジェスト指定のままの間は、指定の手順1で確かめられないので、torque がセットに無い SHA ではこの2台を含めて流せない。3種そろった SHA を1回デプロイすると SHA のタグになり、この制約は外れる。
- ランチャと playbook は実行のたびに対象 SHA から動くので、Pi5 への個別の反映は不要。PR6 を含む SHA のデプロイから効く。
- 戻し: PR6 の revert だけで元に戻る。状態を残さない。

- レビューの止め方(16回目の後に決めた場面): 停止の1行の種別、上限時間と後片付け、テストの細目のように、止めるべきデプロイを通すかどうかに関わらない実装の細部の中は、PR6 の実装のレビューで扱う場面とする。重大0件の回で中がすべてこの場面に収まれば、既知の制約として記録して計画のレビューを打ち切る。
- 計画のレビューは17回目で打ち切った(Codex と Fable とも重大0件、中はすべて上の場面)。PR6 の実装とそのレビューで扱う持ち越し:
  - 戻すときの手順の例も `set -o pipefail` と成功判定を入れ、ランチャが失敗したら承認に進まない形にする。
  - Pi5 側の `timeout` に `--kill-after` を付ける。ランチャ側の上限は `Popen(start_new_session=True)` と `os.killpg` で新しく作り、種別 `timeout`、終了コード 1、後片付けまでテストで確かめる(テスト一覧の「読めない」は `timeout` に直す)。
  - project の書式は `[a-z0-9][a-z0-9_-]*` の完全一致にする。実行時の照合は「結果ファイルの project が指定の project と一致」として書き、コンテナが0個・2個以上・止まっているときの種別(`reread-mismatch` に含める)を決める。
  - 補助スクリプトの作業ツリーの検査は Pi5 側のスクリプト(`:785`)に倣う。未追跡ファイルの扱いを決め、不合格のときは原因のファイル名を出す。project は読み取りの JSON から取ると手順に書く。
  - 「Mac も Pi5 も S の同じ inventory」は「どちらも S の inventory を使う前提。違えば実行側で止まる」に直す。

### この案で残る穴(承知の上で残す)

- `agentServices` は「作る予定」で、公開の証明ではない。`release-set` はエージェントの公開と Trivy を待たない(`ci.yml` の `release-set` の needs)。セットにあるのにイメージがまだ無い、または Trivy 不合格のイメージにタグが付いている時間がありうる。イメージがあるかの確認(`unpublished_plan_images`、`:668-687`)は今は `--print-plan` のときだけ。通常の実行にも広げれば「まだ無い」は Pi5 の切り替え前に止められるが、PR6 の範囲(止める条件1つ)を超えるので、次の候補として残す。Trivy の件はこの案では塞がない。
- 指定を付けた人が端末の版を確かめ違えれば、取り残しは起こる。Web・API とエージェントの通信の互換性は人の確認に頼る(「指定を付けてよい条件」の手順5)。
- `--print-plan` を飛ばして実行すると、Mac は判定しない。Pi5 の checkout が替わり、リリースセットを取得した後で、Pi5 側の判定で初めて止まる。
- 手順4の `git diff` は git に無いもの(`.vault-pass` の鍵など)の変更を見られない。指定で外したエージェントの `.env` は書き直されないので、そうした変更の後は、そのエージェントに反映されるまで指定を付けない(手順6。人の確認に頼る)。`host_vars` の差分は端末を問わず見るので、どの端末の vault.yml の変更でも全端末で指定が付けられなくなる(止める側)。
- 同じ inventory の名前が、T の後に、同じ版 T と同じ project のエージェントが動く別の Pi4 を指すようになった場合、読み直しは通る。git の inventory の変更は手順4で止まり、残るのは git の外の接続先(DNS など)の付け替えだけ。その機械でも T のエージェントが動いているので手順2〜5の条件は同じに成り立ち、違いうるのは git の外の設定(`.env` など)と鍵で、どちらも手順6で人が確かめる範囲なので、端末の識別子の照合は足さない。
- `--print-plan` での判定は、Mac の inventory で行う。実行時の判定は Pi5 の checkout の inventory で行うので、両者が違えば計画では通って実行で止まることがある(止める側に倒れる)。
- 判定は標準の playbook の外にある。ランチャを通さずに `deploy-release-standard.yml` を直接流すと判定されない(標準の経路はランチャだけ)。

- PR6 より前の main のコミットを指すブランチを流すと、判定は働かない。判定のコードは S 自身の中にしかなく(Mac は手元の HEAD が S であること、Pi5 は S に切り替えてから S のランチャを動かす、`:518-519`、`:777-785`)、署名の検査は main で作られたことだけを見る(`:1241`)。受けるブランチを絞るかは別に決める。deployment.md の止まる場面の説明にも書く。
- ランチャは、指定の T が動いているイメージと一致すること(と S の一致)だけを確かめ、手順2〜4(祖先、分類、設定の差分)は確かめない。手順2〜4は補助スクリプトが判定し、合格したときだけ指定の1行を出すので、その1行をそのまま使う運用とする。ランチャに組み込まないのは、指定はもともと手順5と6の人の確認を前提にしており、人の確認を飛ばして T を手で書く場合は手順2〜4を機械で見ても防げないため(独自の判定を増やさない方針)。

- PR6 の実装で残した制約(止めるべきデプロイを通すかには関わらない、後片付けと検査の範囲):
  - 確認用 Ansible が例外(Ctrl-C を含む)で止まったときは、プロセスグループに SIGKILL して回収するだけにした。Ansible の worker は setsid するので、その場合は worker が自分のタスクの終わりまで残ることがある。本番は Pi5 の systemd から動き Ctrl-C は届かない。時間切れのときは SIGTERM、猶予、SIGKILL の順で止める。
  - 読み直しは本体リリースと同じ SSH 設定で接続する(`ansible.cfg` は ssh_args を設定しないので Ansible の既定の ControlPersist=60s)。時間切れで止めたとき、SSH の多重接続の親が最長60秒残ることがある。
  - CI の検査(`scripts/ci/tests/test_agent_guard_inputs_literal.py`)は、追跡中の YAML で3つの入力を定義する行の値が固定値であることだけを行単位で見る。include、複数行の flow 形式、extra vars や inventory プラグインなど YAML の行以外から来る値は見ない(決定8: Ansible の探索を再現しない)。
  - `--print-plan` で Pi4 を選ぶと、判定の playbook を接続せずに1回流す(最長300秒)。stderr に `[agent-guard]` の行が増える。stdout の JSON は変わらない。

### 見送った全面の作り直し(記録)

部品ごとに祖先の公開物を使う方式(旧決定7)は、2026-11-20 の Codex と Fable のレビューで次の穴が見つかり、見送った。再開するときはここから始める。
- nfc や barcode だけの変更はリリースセットを作らないことがあり、セットの `agentServices` では祖先の公開物を保証できない。イメージ自体に CI の署名(Trivy 合格後)が要る。
- CI は Pi4 エージェントを公開(タグ付け)してから Trivy を流しており、署名も無い。
- 祖先方式でも Web だけのリリースで全キオスクに取得・検査・health が走る。同じイメージなら何もしない作りがロール側に要る。
- 上限20では足りない(全部入りの間隔は最大33)。判定の単位(累積差分か1コミットずつか)を揃える必要がある。
- 端末ごとの有効エージェントの差、Pi3 のホスト設定の変更が届かない穴、ロールバックの compose 設定、torque v2 や初回導入でのダウングレード、サイネージのデプロイ時の署名検査が無いこと。
- 準備の前倒し(旧PR9)、Pi3 の無停止化(旧PR8)、`--sha`、旧コード削除も、あわせて見送る。

## 第3段: 速さと台数への強さ(2026-11-22 計測から)

### 計測した事実(2026-11-22、Pi5 の journal と GitHub Actions の記録を読み取りだけで集計)

- 確認済み: Pi5 の journal は `SystemMaxUse=200M`(`/etc/systemd/journald.conf.d/50-raspi-persistent.conf`)で、残っていたのは 2026-11-19 18:20 以降の約3日分だけ。デプロイの記録(ユニット `raspi-standard-release-<runId>` の出力)は数日で消え、障害の後追いも所要時間の比較もできない。
- 確認済み: Pi5 だけの run は 39 本が完走。外れ値1本を除き 371〜449 秒(36 本)、長い2本は 599 秒と 936 秒。長くなる原因はイメージ取得(156 秒、523 秒)と、取得後に負荷が落ち着くまでの待ち(63 秒、52 秒)。取得の中央値は 21 秒。ほかは1秒前後のタスク約 315 個の積み上げで、固定の待ちは health の標本待ち 40 秒が最大。
- 確認済み: Pi4・Pi3 を含む run は記録期間に1本(`20261119-150451-9a1b2a`、Pi4 8 台と Pi3、Pi5 は含まない)。47.0 分で全台成功。内訳は、端末の到達確認 35 秒、Pi4 の事前準備 615 秒、波1(1台)439 秒、波2(5台)460 秒、波3(2台)768 秒、Pi3(1台)498 秒。全台を1回で流した実測は無い(Pi5 の段を足すと約 53 分の推定)。
- 確認済み: Pi4 の波は `serial: [1, 5, '25%', '100%']`(`deploy-release-standard.yml:314`)、`strategy: linear`、`forks = 5`(`ansible.cfg:6`)。事前準備は `strategy: free`(`:219`)。Pi3 は `serial: 1`(`:403`)。波2 は5台で 460 秒、1台の波1 は 439 秒で、波の中の台数はほぼ時間に効かない。時間は「波の数 × 1波の時間」と「forks を超えた分の回転」で決まる。
- 確認済み: 波ごとに保存を促す案内が 60 秒表示される(`release_kiosk_notice_duration_seconds: 60`、`roles/release_kiosk/defaults/main.yml:21`)。現場の作業を守るための待ちで、短縮の対象にしない。
- 未確認: 波3 が他の波より約 300 秒遅い理由。上位は「所有者の記録」88 秒と「ファイルの設置」89 秒で、linear では波の中の最も遅い端末を待つので、特定の端末が遅いと考えられるが、端末ごとの記録が journal の抜粋に無く確かめていない。
- 確認済み: main push の CI は成功時 6.1〜8.7 分。公開までの最短経路は API イメージ(約 4.4 分)→ リハーサル(約 2.3 分)→ release-set(約 0.8 分)の直列で約 8 分。デプロイ本体より短く、この段では触らない。

### 台数が増えたときの見積もり(推定)

- 固定部分: 到達確認 約 0.6 分、Pi5 の段 約 6.5 分(取得が重いと +2〜9 分)。
- Pi4: 事前準備は台数 ÷ 5 の回転、波は 1 → 5 → 25% → 残り。forks が5のままだと、1波が5台を超えるたびに回転が増える。Pi4 が20台なら、波は 1、5、5、9 台で回転は 1+1+1+2 = 5、1波 7〜13 分として 35〜65 分に事前準備(4回転)が加わる。
- Pi3: `serial: 1` で1台あたり約 8.3 分がそのまま比例する。今は1台。
- つまり今の8台では、時間の大半は1波の時間(7〜13分)× 波の数(3)と事前準備。1波の中身は小さいタスクの積み上げなので、1タスクを速くする手(PR8)が台数によらず効く。forks の上限と Pi3 の直列が効いてくるのは台数が倍以上になってから。

### 方針

1. 先に測れるようにする。記録が3日で消える状態で速さを変えると、効いたかを比べられない。
2. 新しい仕組みを作らない。効果が測れたものだけ、既存の設定値を変える。
3. 変えるのは Ansible の標準の設定(forks、serial)と、待ちの位置だけにする。ロールの中身や安全確認(健康確認、ロールバック用の記録、保存の案内)は削らない。
4. 1回に1つだけ変え、Pi4 を含むデプロイ1回ごとに前後を比べる。悪くなったら revert で戻す。

### PR7: デプロイの記録を消えにくくする(測る、設定1行)

- 目的: 記録が約3日で消える状態をやめる。journal は行ごとに時刻を持つので、`ok: [端末]` の行から端末ごとの所要も後から出せる。新しい仕組みも callback も足さない(`profile_tasks` は行が増え、`--status` が読む末尾200行(`standard-ansible-release.py:2137`)から停止の行を押し出すおそれがあるため使わない)。
- 方法: Pi5 の journald の上限 `SystemMaxUse=200M` を `2G` にする(`roles/release_pi5/tasks/host-journald.yml:26`。Pi5 の空きは 774GB、2026-11-22 確認)。Pi4 の SD カードの設定は変えない。
- 受け入れ: 反映後、Pi5 の `journalctl --disk-usage` が 200M を超えて増えていき、1週間前のデプロイの記録が読める。
- 戻し: revert。
- その後: 次の Pi4 を含むデプロイの記録で、波3が遅かった理由(特定の端末か)を確かめる。端末側の原因なら別件にする。

### PR8: 標準経路で Ansible の pipelining を使う(速さ、どの段にも効く)

- 理由: 時間の大半は約1秒の小さなタスクの積み上げ(Pi5 の段で約315個、Pi4 は1台あたり約225個)。pipelining はタスクごとの一時ファイルの転送と後片付けの SSH 往復を省く Ansible の標準設定。2026-07-20 に Pi5 から StoneBase への測定で、1タスクの時間が約60〜65%減った(`docs/plans/deploy-speed-optimization-execplan.md:47,89`)。2026-11-22 に今の標準経路の Ansible(2.19)で測り直すと、約2割減だった(Progress の PR8)。Pi4 1台あたり約225個なら約1分の短縮の見込み。その時は別の経路(端末の forward playbook)だけに入れ、標準経路には入っていない(`ansible.cfg`、`inventory.yml:3-7`、ランチャの環境のどこにも設定が無い、2026-11-22 確認)。
- 方法: まず canary の `raspi4-kensaku-stonebase01` にだけホスト変数 `ansible_pipelining: true` を入れ、1回のデプロイで波1の時間を前後比較する。効けば Pi4 全台、次に Pi5 と Pi3 に広げる(1回に1段)。sudo の `requiretty` があると失敗するので、7月に作った pipelining と become の事前確認(同計画 `:121`)と同じ確認を、入れる前に読み取りだけで行う。
- 受け入れ: その段の時間が下がり、失敗 0、health と `--status` が変わらない。悪ければ1行の revert。

### 今は変えないもの

- Pi3 の `serial: 1`: 今は1台なので効果が無い。Pi3 が3台を超える計画が出たときに見直す。
- 保存の案内の 60 秒、health の標本待ち 40 秒: 安全のための待ち。
- CI の直列(約 8 分): デプロイより短い。
- forks(5): 2026-11-04 に「5のまま」と決めている(`docs/plans/fleet-100-scale-gap-execplan.md:113`)。今の8台では波の最大が5台なので波の時間に効かず、全 playbook に共通の設定でもある。1つの波が5台を超えるのは Pi4 が15台以上になったとき(25% は切り捨て)。その計画が出たら、標準経路だけに `--forks` を渡す形で見直す。
- Pi5 のイメージの先取り: 長くなったのは 39 本中 2 本だけ(取得の中央値 21 秒)。効果に比べて仕組みが増えるので作らない。
- 波の形(1 → 5 → 25% → 残り): canary の安全のため。台数が増えて波の数が問題になったら、PR7 の記録を根拠に別に決める。

## Context and Orientation

CI(`.github/workflows/ci.yml`、約1900行)は main への push で、`release-api-image`、`release-web-image`、`release-gates`、`release-set`、`pi4-agent-images-publish`、`signage-artifact-publish` などを流す。実行可否は `change-classification` の出力で決まる。`BASE_SHA` は PR では base、push では `github.event.before`(`ci.yml:58`)。

並行制御: ci.yml の6〜9行目(`${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}-v2`)、codeql.yml の19行目付近、gitleaks.yml の17〜19行目、torque-release.yml の6〜8行目。どれも取り消しは pull_request だけ。gitleaks.yml には定期実行(cron)もあり、同じグループに入る。

ワークフローの契約テストは `scripts/ci/tests/test_staged_ci_workflow.py`。並行制御を固定するテストは今は無い。torque-release.yml は `scripts/ci/tests/test_classify_changes.py`、`scripts/deploy/tests/test_release_artifact_contract.py`、`scripts/deploy/tests/test_standard_ansible_release.py` が参照する。ランチャのテストは `scripts/deploy/tests/test_standard_ansible_release.py`、Ansible の契約は `scripts/deploy/tests/test_ansible_standard_release.py`(名前が似ているので注意)。

## Plan of Work と Concrete Steps(第1段)

各 PR は専用の worktree(`python3 -m scripts.git_lifecycle.cli start --branch <name>`)で行い、対象テストだけを流す。PR 本文の Deploy impact 表は `scripts/ci/validate_deploy_impact.py` で手元検証してから作る。反映の仕組みの変更なので、各 PR を Codex と Fable でレビューし、重大・中が0件になるまで直す。

PR2(並行制御): 3つのワークフローのグループを `<名前>-${{ github.event.pull_request.number || github.sha }}` の形にする(`merge_group` と定期実行も SHA ごとになる)。`cancel-in-progress` は pull_request だけのまま。`test_staged_ci_workflow.py` に「main push のグループは SHA を含み、PR は PR 番号で取り消す」を3ファイル分固定するテストを足す。デプロイ不要。戻し: revert。影響: main の run が並行に走り、ARM64 ビルドの runner 使用が一時的に増える。

PR3(torque-release.yml): 決定2により変更しない。

PR5(未適用の表示): `preflight_optional_hosts` が外した端末を、run ID ごとの記録として残し、`--status <RUN_ID>` と `safe_diagnostics.summarize_release_journal` で出す。外した端末が無いときの出力は今と同じ(先に今の出力を固定するテストを足す)。終了コードは変えない。デプロイ: ランチャは実行のたびに同じ SHA から動くので、Pi5 への個別の反映は不要。次の通常デプロイから効く。

## Validation and Acceptance

- PR2: 契約テストが通る。マージ後、main への3連続 push で3つの run がすべて完走し、それぞれの SHA の公開ゲートが CodeQL と Gitleaks を見つけて通ることを実 CI で確かめる。
- PR3: 変更なし。
- PR5: 外した端末があるとき `--status` にその一覧が出て、無いときは出力が従来と同じ。終了コードが変わらない。
- PR6: 「第2段の設計」の「受け入れ(PR6)」に従う。

どの PR も、本番デプロイの前に対象 SHA の CI 全チェックが成功していること(UNSTABLE は不合格)。

## Idempotence and Recovery

- 各 PR は単独で revert できる。
- PR5 の記録は無くても動く(無いものは表示しない)。
- PR6 は状態を持たない。止まるのはサービスの切り替え(本体の Ansible)の前で、Pi4 と Pi3 は変わらない。Pi5 は checkout とリリースセットの取得、状態ファイルの保存し直しだけが起きる(「止まった後に起きること」)。指定を付けて流し直すか、エージェントがそろう SHA を待つ。
- デプロイの失敗は `docs/runbooks/deploy-status-recovery.md` に従う。process kill、lock、run 情報、migration 台帳の手編集で迂回しない。

## Outcomes & Retrospective

未着手。各 PR のマージ後に結果と想定外を追記する。

## Interfaces and Dependencies

- `.github/workflows/ci.yml`、`codeql.yml`、`gitleaks.yml`、`torque-release.yml` の concurrency。
- `scripts/deploy/standard-ansible-release.py` の `preflight_optional_hosts`、`status()`。
- `scripts/deploy/rolling_release/safe_diagnostics.py` の `summarize_release_journal`。
- 範囲外: DGX Control Plane、Private Pi の導入(`AGENTS.md` の境界)。Hermes の許可リストの移動、個別 playbook のドリフト検知。
