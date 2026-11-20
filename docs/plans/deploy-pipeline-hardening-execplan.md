# 配送パイプラインの堅牢化

この ExecPlan は生きた文書である。作業が進むたびに Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を更新する。`.agent/PLANS.md` に従い、この文書だけで初見の作業者が実行できるように書く。コードで確かめた事実は「確認済み」、読み切れていない点は「未確認」と書く。

計画は2段に分ける。第1段(PR1〜PR3、PR5)は設計が固まっており、すぐ実装する。第2段(配布物の決め方、準備の前倒し、`--sha`、旧コード削除)は、2026-11-20 の第三者レビュー(Codex、Fable)で最初の案に重大な穴が見つかったため、下の「第2段の未決事項」を確かめてから設計を書き直し、着手前にもう一度レビューする。

## Purpose / Big Picture

標準ローリング更新(Pi5 を切り替え、続いて Pi4 キオスクを段階的に、最後に Pi3 サイネージを更新する流れ)について、確認済みの問題を、安全な順序の小さな PR で解消する。完了すると次が成り立つ。

- 連続して main に入れても、CI の公開(イメージ、署名付きリリースセット)が途中で取り消されない。
- Web だけの変更が後から main に入っても、先に main に入った Pi4/Pi3 の変更が端末に届かないまま取り残されない。
- 応答しない端末を飛ばした更新で、未適用の端末が `--status` に出る。
- Pi4 の準備(イメージ取得など)が失敗したリリースで、Pi5 だけが先に切り替わらない。
- 標準経路から参照されない古いコードが消える。
- Vault のバックアップファイルが誤ってコミットされない。

用語。
- 標準経路: `scripts/update-all-clients.sh` から `scripts/deploy/standard-ansible-release.py`(ランチャ)を通り、Pi5 上の systemd ユニットが同じ SHA を `git checkout --detach` したランチャで `--execute-standard-route` を実行し、Ansible の `deploy-release-standard.yml` を流す一連の流れ。
- リリースセット: `ghcr.io` の `raspisys-release-set:<sha>-<config_hash>`。中身の `release-set.json` に API/Web のダイジェストと `agentServices` などを持ち、`actions/attest` で署名される。パーサは `scripts/deploy/release_artifact_contract.py` の `parse_release_set`。torque 用は `-torque-v2` を付けたタグで、schema 1 の通常セットを土台にする。
- push 差分: GitHub Actions の `github.event.before` から head までの差分。`scripts/ci/classify_changes.py` がこれで公開する成果物を決める。

## Progress

- [x] 調査と第三者レビュー(2026-11-20)。
- [x] PR1: `.gitignore` に Vault バックアップを追加(denkoushi/RaspberryPiSystem_002#2991、マージ待ち)。
- [ ] PR2: main push の並行制御を SHA ごとにする(ci.yml、codeql.yml、gitleaks.yml)。
- [x] PR3: 調べた結果、変えない(決定2)。
- [ ] PR5: 応答しない端末を `--status` に表示する(表示だけ)。
- [ ] 第2段の未決事項を確かめ、残りの設計を書き直し、レビューする。

## Surprises & Discoveries

- 確認済み: ci.yml の `release-gates`(`ci.yml:1817` 付近)は、同じ SHA の CodeQL と Gitleaks の結果を `scripts/ci/wait_for_release_checks.py`(最大1800秒)で待つ。CodeQL(`codeql.yml:19`)と Gitleaks(`gitleaks.yml:17`)も main push を ref 単位のグループにしており、待ちの run は新しい push に置き換えられて消える。ci.yml だけ直しても、消えた側の SHA は公開ゲートで時間切れになる。
- 確認済み: GitHub の concurrency は1グループにつき実行中1・待ち1。今の設定でも2連続 push は両方完走する。消えるのは3本目が来たときの待ち run。
- 確認済み: ci.yml の可変の共有状態はキャッシュだけ。GHA キャッシュ(`cache-to: type=gha`、`ci.yml:660,810,1157,1601`)と、`scripts/ci/build_release_image.py` が登録先に書く buildcache タグ(`registry_cache_tag`、配布されない)。`:latest` などの可変の配布タグは無い。公開物は SHA を含むタグ。並行で書き換わってもキャッシュの当たり外れが変わるだけで、正しさには影響しない。
- 確認済み: 通常セットのタグは再実行でも同じ(`ci.yml:1883` 付近、`runAttempt` は中身に入る)。v2 の再利用検査は土台のダイジェストまで比べる(`release_artifact_contract.py:722`)。同じ SHA の再実行で v2 再利用が失敗しうる(Codex 指摘、未検証)。
- 確認済み: Pi4 が取り残される仕組み。Web だけの push のセットは `agentServices: []` になり、計画の Pi4 イメージ一覧は空、`unpublished_plan_images` は空のまま、`pi4ReleaseFiles: skipped…` を出して終了コード 0 で通る(`standard-ansible-release.py:1595-1617`)。Pi4/Pi3 の祖先へのフォールバックは禁止(`require_pi5_fallback`、`:543`)。
- 確認済み: ランチャとリリースセットの読み書きは同じコミット。Mac 側は HEAD とリモート SHA の一致を強制し(`resolve_sha`、`:513`)、Pi5 側は同じ SHA を checkout したランチャを実行する(`:785`)。Pi5 に常設のランチャは無い。
- 確認済み: Pi5 側は `FETCH_HEAD` が計画した SHA と違えば実行前に止まる(`:785`)。計画と違う SHA で走ることは無い。最初の案の「問題6」は誤りだった。
- 確認済み: `--status` の要約は `optional-host-preflight` の行を拾わない(`scripts/deploy/rolling_release/safe_diagnostics.py:148-175`)。飛ばした端末は `--status` に一切出ない。通知用の状態は終了時に `remove-run` で消える(`:1519`)。
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

## 第2段の未決事項(設計を書き直す前に確かめる)

1. 配布物の決め方。候補は2つ。(a) release_pair の push ごとに全部品(Pi4 エージェント3種、Pi3 サイネージ)を作る。単純だが CI 時間が増える。(b) Pi5 で既にある祖先へのフォールバック(`resolve_release_artifact_sha`、`image_free_changes`)を Pi4/Pi3 にも広げ、部品ごとに「その部品の入力を最後に変えた祖先」の公開物を使う。どちらも、ロールの `release_sha in …` 検査と、回答キャッシュのイメージ(`raspisys-hermes-answer-cache:<sha>`、`:1493-1497`)を範囲に入れる。決める前に `gh run view` で Pi4 エージェントとサイネージのジョブ時間を測る。Pi4 の別置きファイル(status-agent など、`release_kiosk/tasks/prepare.yml:354`)は画像と別に配られることも考慮する。
2. 暫定ガードの要否と条件。1 の方式と実装時期で決める。入れるなら条件は「Pi4 が対象で、セットの `agentServices` が空か一部で、端末の `APP_REF` が対象 SHA と違う」。
3. 準備の前倒し。Pi4 の準備を丸ごと前に出すと、証明書を替えるリリースで必ず失敗し、1台の取得失敗で Pi5 の修正も止まる。イメージの事前取得と、全台の結果をまとめて見る明示のゲート(Pi5 プレイの先頭で検査、`any_errors_fatal`)に縮める案を検討する。
4. `--sha`。期待する HEAD の照合だけ(小)にするか、祖先の SHA も流せるようにする(ダウングレードと CI 合格の条件が要る)か。
5. 旧コード削除。`run-deploy-contracts-local.sh` と入口テストの呼び出しを同じ差分で直す。堅牢化の完了条件からは外す。

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

どの PR も、本番デプロイの前に対象 SHA の CI 全チェックが成功していること(UNSTABLE は不合格)。

## Idempotence and Recovery

- 各 PR は単独で revert できる。
- PR5 の記録は無くても動く(無いものは表示しない)。
- デプロイの失敗は `docs/runbooks/deploy-status-recovery.md` に従う。process kill、lock、run 情報、migration 台帳の手編集で迂回しない。

## Outcomes & Retrospective

未着手。各 PR のマージ後に結果と想定外を追記する。

## Interfaces and Dependencies

- `.github/workflows/ci.yml`、`codeql.yml`、`gitleaks.yml`、`torque-release.yml` の concurrency。
- `scripts/deploy/standard-ansible-release.py` の `preflight_optional_hosts`、`status()`。
- `scripts/deploy/rolling_release/safe_diagnostics.py` の `summarize_release_journal`。
- 範囲外: DGX Control Plane、Private Pi の導入(`AGENTS.md` の境界)。Hermes の許可リストの移動、個別 playbook のドリフト検知。
