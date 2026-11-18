# JPCERT 注意喚起の要否を自動で判定し、OS 更新を前倒しする

この ExecPlan は `.agent/PLANS.md` に従う生きた文書である。進むたびに Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective を更新する。

## Purpose / Big Picture

今は Pi5 が JPCERT/CC の注意喚起を取得し、API が LLM で「影響あり/なし/判定できず」を付けて、全件をフローティングChat へ通知している。ユーザーは毎回それを読み、対応の要否を自分で決めている。

この計画が終わると、次のようになる。

- 注意喚起は自動で「対応不要」「自動で直る予定」「人の対応が必要」の3つに分かれる。
- 通知が届くのは「人の対応が必要」だけになる。対応不要と自動で直る予定は記録だけ残す。
- 自動で直る予定のものは、日曜の週次更新(KB-438)を待たずに、各端末がその日の夜間の時間帯に安全更新を前倒しで入れる。
- 更新のあとに端末が実際の導入版を報告する。直る版に届いていなければ、期限が来た時点で通知する。

ユーザーが見て分かる変化は、フローティングChat に届く JPCERT 通知が「何をすればよいか」の一言付きのものだけになることである。

## Progress

- [x] (2026-11-18) 今の仕組みを Codex で調査した(読み取りのみ)。
- [x] (2026-11-18) 段階1の API に構造化された `evidence` の受け入れと振り分けを実装。
- [x] (2026-11-18) 段階2a: 収集側で製品ごとの `evidence` と `remedies` を付け、本文に出る製品もジョブに加える(PR2)。
- [ ] 段階2b: LLM の回答に `fixed_versions` を足し、導入版と比べて `none` にする(API の PR)。
- [ ] 段階3: 端末の版の報告、前倒し要求、更新後の確認(PR3)。
- [ ] kensaku-stonebase01 だけで前倒しを有効にして1回確かめる。
- [ ] 全台で前倒しを有効にする。

## Surprises & Discoveries

- 端末(Pi4、Pi3)に入っている版を、Pi5 が継続的に知る経路は無い。`versions` は Pi5 上の probe だけで、端末の区別も無い。
- `raspi-os-security-update` の `success` は、何も選ばなかった場合や dry-run でも成功になる。修正の到達の証拠にはならない。
- 上流の版の文字列比較は、Debian のバックポートで成り立たない(例: OpenSSL の修正が `3.5.1-1+deb13u1` に入る)。成り立つのは、Debian も上流の版番号をそのまま使う chromium のような製品だけである。
- `advisoryJobSchema` は `.strict()` である。収集側が先にフィールドを足すと、ジョブがすべて `invalid` へ落ちる。
- 収集側は標準リリースではなく `prepare-pi5-jpcert-advisories.yml` で配る。

## Decision Log

- 判断: 黙らせる判定は「安全側に倒す」。`unknown`、`unavailable`、版の証拠が無い `not_affected` は、必ず通知する。
  理由: ユーザーは通知を読まなくなる。誤って「対応不要」にする方が、通知が1件多いより害が大きい。日付: 2026-11-18。
- (2026-11-18) 通知抑止には収集側の構造化した `evidence` を使い、`fleet` は段階3まで通知する。`versions` は Pi5 上の値で、Pi4/Pi3 の導入状況を示さない。代替パッケージや blue/green の項目も版文字列だけでは導入を確かめられない。
- 判断: 振り分けは決定的な規則で行い、LLM は根拠の抽出(影響の有無、直る版の文字列)だけに使う。LLM が出した直る版は、注意喚起の本文に同じ文字列がある場合だけ採用する。
  理由: LLM の当て推量で通知を消さないため。日付: 2026-11-18。
- 判断: 前倒しは pull 方式にする。端末の status-agent が毎分の `POST /api/clients/status` の応答で前倒し要求を受け取り、ローカルの要求ファイルに書く。毎晩動く更新の timer が、日曜または要求があるときだけ更新を行う。
  理由: Pi5 から端末を遠隔操作する経路(SSH と sudo)を増やさないため。status-agent は root で動くので、要求ファイルを書ける。日付: 2026-11-18。
- 判断: 前倒しは、各端末に今ある夜間の時刻をそのまま使う(Pi5 は 02:00、Pi4 は 01:00 から最大 90 分ずらす、Pi3 は 01:30 から最大 30 分ずらす)。曜日の指定だけを毎日に広げる。
  理由: Pi4 の 03:30 の保守、Pi3 の 03:00 の再起動とぶつけないため。日付: 2026-11-18。
- 判断: 要求は「更新後に測った導入版を報告したとき」に完了とする。`skipped_release`、ロックの取り合い、電源断では消費しない。要求には期限(既定 14 日)を持たせ、期限までに確かめられなければ通知する。日付: 2026-11-18。
- 判断: 版の確認は製品ごとに2段にする。
  - 直る版の上流版が分かり、上流の版番号で比べてよい製品(rules.json で `upstream_version_comparable: true`。例: chromium)は、導入版の上流部分と比べる。
  - それ以外は「更新後に、その package に新しい安全更新の候補が残っていない」ことで確かめる。この方法では「修正が入った」と「修正がまだ配布されていない」を区別できない。そのため、期限が来ても候補が出ないままなら、「配布待ちのまま」として通知する。
  日付: 2026-11-18。
- 判断: 前倒しはフラグ `os_security_update_early_enabled` で止めておく。最初に kensaku-stonebase01 だけで有効にし、1回動くのを確かめてから全台へ広げる。KB-438 で1台から広げたのと同じ進め方である。日付: 2026-11-18。
- 判断: 段階2を収集側(2a)と API 側(2b、`fixed_versions` と版の比較)に分ける。
  理由: `answerSchema` が strict なので `fixed_versions` は API の変更になる。API は標準リリース、収集側は専用 playbook で配り、反映経路が違う。日付: 2026-11-18。
- 判断: `absent` は、`rules.json` で `absence_by_dpkg: true` を付けた製品で、dpkg が未導入(`un`/`rc`/未知)と答えたときだけ付ける。タイムアウトや途中の状態は `unmeasured`。コンテナ内にもある製品(OpenSSL、curl、zlib、Python)には付けない。
  理由: ホストに無いことは Pi5 に無いことを意味しないため。日付: 2026-11-18。
- (2026-11-18) 段階2a の時点で `scope: pi5` かつ `absent` になりうる製品は0件である。通知件数は段階2b と段階3まで変わらない。
- 判断: 段階ごとに PR を分け、反映の順番を「API が新しい形を受け入れる → 収集側 → 端末」に固定する。日付: 2026-11-18。

## Outcomes & Retrospective

(完了後に書く)

## Context and Orientation

- 収集: `scripts/server/jpcert-advisories/fetch.py`(毎時)、製品表 `scripts/server/jpcert-advisories/rules.json`、配布 `infrastructure/ansible/roles/server/tasks/jpcert-advisories.yml` と `infrastructure/ansible/playbooks/prepare-pi5-jpcert-advisories.yml`、契約テスト `scripts/ci/tests/test_jpcert_advisories_contract.py`。
- 判定と通知: `apps/api/src/services/advisory-check/advisory-check.service.ts`(5分ごと)、通知 `apps/api/src/services/kiosk-inquiry/system-notice.service.ts` の `deliverSystemNotice`。同じキーに `state: 'recovered'` を送ると、未解決の通知が閉じる。
- OS 更新: `scripts/os-security-update/raspi-os-security-update.py`、`infrastructure/ansible/tasks/os-security-update.yml`、timer `raspi-os-security-update.timer.j2`、`docs/knowledge-base/KB-438-os-security-weekly-update.md`。
- 端末の報告: `clients/status-agent/status-agent.py`(root、約60秒ごとに `POST /api/clients/status`、`x-client-key`)、`clients/status-agent/os_update_health.py`。API 側は `apps/api/src/routes/clients/` と `client-telemetry.service.ts`。
- 言語設定: robodrill01 と kensaku-stonebase01 は EUC-JP である。新しく呼ぶ `dpkg-query` と `apt-cache` には、必ず `LC_ALL=C.UTF-8` を付ける。

## Plan of Work

### 段階1(PR1、API だけ)

- API は `version: 1` のまま任意の `evidence` と `remedies` を受け入れ、`triage` は `none`、`auto`、`manual` を読める。
- `not_affected`、取得エラーなし、空白以外の本文があり12,000文字未満で、全対象製品の `evidence` が `scope: pi5`、`state: absent`、`versions: []` かつ `job.versions` に実測値がない場合だけ `none` とする。
- `none` は通知せず `done` に保存する。他は `manual` として通知し、1行目に「要対応:」を付ける。`not_affected` の通知には自動確認が不十分だったことを伝える定型文と LLM の理由を載せる。
- LLM には製品ごとの `evidence` と導入版を渡す。`scope: pi5` で `state: installed` の製品は証拠の版を優先する。`claimed` には判定結果だけを記録し、振り分けは再計算して `done` に保存する。
- 段階2で収集側が `evidence` を付けるまで、通知件数は従来と同じである。
- 段階1の間、`not_affected` の通知も「要対応:」に続けて自動確認が不十分だったことを伝える定型文で始まる。

### 段階2(PR2、収集側)

- `rules.json` の各製品に `scope` (`pi5` または `fleet`) と `remedy` を持たせる。`remedy` は `os-security-update` (パッケージ一覧と `upstream_version_comparable` を指定) または `manual` とする。
- 週次更新の拒否リストに入るパッケージ(カーネル、Docker、Tailscale)は `manual` とする。契約テストで整合を確認する。
- 導入済みかは `dpkg-query` の `${db:Status-Abbrev}` で確かめる。代替パッケージはどれか1つが `installed` で、残りがすべて `absent` なら製品を `installed` とする。
- `absent` はホスト、コンテナ、`package.json` のどの測り方でも製品が見つからない場合に限る。測り方が `dpkg` 以外の製品には `absent` を付けない。
- ジョブに製品ごとの `evidence` (`scope`、`state`、`versions`) と `remedies` を載せる。
- `absent` の製品は `job.versions` の該当キーの値を空配列にするか、そのキーを省略する。契約テストで固定する。
- LLM の回答に任意の `fixed_versions` を足す。注意喚起本文に同じ文字列がある版を採用する。
- `products` は RSS の題と概要で別名に一致した製品だけである。本文にだけ出る製品を取りこぼしたまま `none` にしないよう、列挙が本文の対象を網羅していると確かめられない場合は `manual` にする条件とテストを決める。
- `installed` の製品を含む場合は、本文に同じ文字列がある `fixed_versions` の修正版と導入版を比較でき、導入版が修正版以上と確認できる場合だけ `none` とする。

### 段階3(PR3、端末と API)

- DB に前倒し要求と、端末ごとの確認状態を置く(Prisma の migration)。
- `auto` は、対象の全製品が `os-security-update` で、かつ `affected` のときとする。要求を作り、通知は出さない。
- status の応答に `osSecurityUpdateRequest`(id、packages、期限)を任意で足す。古い status-agent はこれを無視するので、互換を保てる。
- status-agent は要求を `/var/lib/raspi-os-security-update/request.json` に原子的に書く。次の status POST では、要求された package について、導入版、APT の候補、測った時刻、要求 id を報告する。
- 更新の timer は毎日動かす。本体は、日曜か、期限内の要求があるときだけ更新する。フラグが false の端末は日曜だけ更新する(今と同じ)。
- API は報告を突き合わせる。全端末で確かめられたら記録だけ残す。期限切れ、確かめられなかった端末、配布待ちは `manual` の通知にする(端末名を書く)。

## Concrete Steps

各段階は worktree `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--jpcert-auto-triage`(段階2と3は新しい branch)で行う。変えた部品の型チェックと関係するテストを流す(`~/.local/heavy-run/bin/check-summary`)。

## Validation and Acceptance

- 段階1:
  - 構造化された証拠と本文の条件を満たす `not_affected` は通知せず、他は `manual` として通知する。
  - 新規ジョブの受理上限は 512,000 バイトとする。判定または試行回数を保存した `pending` と、`claimed`、`done` の読み戻し上限は 577,536 バイトとする。配送失敗後に、判定の保存で受理上限を超えたジョブを `pending` 経由で読み戻し、保存済みの判定を再利用できることをテストで確認する。
- 段階2の契約テストで `scope` と `remedy` の形、拒否リストとの整合、導入状態の判定を固定する。`fixed_versions` は、本文に無い文字列を捨てることをテストで固定する。
- 段階3:
  - 要求が `skipped_release` やロックでは消費されず、導入版の報告で完了することをテストで固定する。
  - 期限切れで通知することをテストで固定する。
  - フラグが false の端末の動きが今と変わらないことをテストで固定する。
  - kensaku-stonebase01 で、夜間に前倒しが1回動き、報告で確認済みになるのを確かめる。

## Idempotence and Recovery

- 振り分けは、保存済みの判定から計算し直すだけである。LLM は呼び直さない。
- 段階2の収集側を入れる前に、api-blue と api-green の両方がこの PR 以降の版であることを確認する。
- 段階1でも、判定や試行回数を保存して 512,000 バイトを超えた未配送のジョブは、旧 API に戻すか新旧が混在すると `invalid` に移る。差分前の API にも同じ性質がある。API を戻した後は `invalid` を点検する。
- 段階2以降に API をこの PR より前へ戻す場合は、先に収集側を戻す。`pending` と `claimed` に `evidence` または `remedies` 付きのジョブがないことを確認するか、該当ジョブを退避してから API を戻す。旧 API は 512,000 バイトを超えるジョブも `invalid` に移す。API を戻した後は `invalid` を点検し、必要に応じてジョブを `pending` へ戻す。
- 前倒しを戻すときは、フラグを false にして反映する。端末は日曜だけの更新に戻る。
- 段階3の migration は、テーブルの追加だけにする。

## Interfaces and Dependencies

- `POST /api/clients/status` の応答に、任意の `osSecurityUpdateRequest` を足す(後方互換)。
- status の本文に、任意の `osSecurityPackages` を足す(後方互換)。
- ジョブの JSON には任意の `evidence` と `remedies` を足す。`version: 1` のまま、API が先に受け入れる。
