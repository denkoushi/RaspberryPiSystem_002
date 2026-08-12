# 段階型CIと`main` rulesetガイド

## 概要

このドキュメントでは、変更内容に応じて実行jobを絞る段階型CIと、`main`を保護するGitHub rulesetの契約を説明します。

## 背景

すべてのPRで全jobを実行するとfeedbackが遅くなります。一方、条件付きjobそのものをrequired checkにすると、正しくskipされたPRがmerge不能になります。そのため次の三層に分けます。

1. `scripts/ci/classify_changes.py`が変更pathを分類し、必要なjobだけを実行する
2. 常に存在する`ci-required`が、選択jobの成功と非選択jobのskipを検証する
3. rulesetは固定名`ci-required`、`codeql`、`gitleaks`だけをrequiredにする

## 段階型CI

PRでは、`repo-policy`、`workspace-quality`、`api`、`web`、`db-infra`、`deploy-contract`、`client`、`e2e-smoke`、`e2e-tests`、`docker-security`から必要なものをmerge-baseで分類して並列実行します。`merge_group`、`workflow_dispatch`、毎日02:30 JSTのscheduleはfull review suiteです。docsとroot Markdownだけの変更は`repo-policy`だけで、固定`codeql` jobは成功したまま解析処理を省略します。Docker securityはAPI/Webを個別選択します。

基準SHA欠落、ゼロSHA、非ancestor、未知path、rename、copy、delete、workflow、action、CI classifier変更はfail-closedでfull suiteになります。PRのAPI testはcoverageなしで全件を1回実行し、full-suite eventではcoverage付き3 shardを実行します。`push main`はGitHub eventの`before -> head`で配布成果物だけを選択し、PRで成功済みのsource test、CodeQL解析、Gitleaks scanを繰り返しません。判断の正本は[ADR-20260728](../decisions/ADR-20260728-change-aware-main-ci-and-server-web-ownership.md)です。

### PR Deploy影響表（4段階品質ゲート）

PRには`.github/pull_request_template.md`のmarker内に、Risk、Target machines、Changed surfaces、Required files/artifacts、Database、Secrets/config delivery、Success evidence、Rollback/cleanup、Production verificationの9行を記入します。これは意図と証拠を残す軽量な契約で、CI jobの選択権限は既存の`classify_event_changes.py`（schemaVersion 6）だけが持ちます。

Riskは`docs`、`ui-logic`、`api-agent-config`、`db-auth-systemd-deploy`、`unknown`の閉じた順序です。`docs/`、README/Markdown、`.cursor/`、`.agent/`、PR templateなど明示的な文書pathだけをsurface `docs`とします。ただし現行classifierが`.cursor/`、`.agent/`、PR templateへ`unknown path`を付ける場合、riskは`unknown`です。package metadata、lockfile、未分類path、または文書以外のfull-suite根拠も`unknown`へfail-closedします。DB、認証、systemd、Ansible、Docker、Deployの既知pathは該当surfaceへ導出します。対象機は既存registryのprofileからPi5/Pi4/Pi3へ導出し、対象機やsurfaceを多く申告することは許可しますが、少なく申告することはできません。`N/A`、`none`、`no`には理由を添え、秘密値は書きません。DB変更を`no`とする申告、placeholder、行不足、表の重複は`change-classification`で失敗します。

PR本文だけを直した場合も`pull_request.edited`で再検証されます。push、merge group、schedule、manual runでは本文契約を再検証せず、既存のfail-closed自動分類を使います。詳細な責務分離と、退役済みDeploy CLIを復活させない判断は[ADR-20260810](../decisions/ADR-20260810-risk-based-deploy-impact-contract.md)、実施記録は[ExecPlan](../plans/risk-based-four-stage-quality-gates-execplan.md)を正本とします。

### `main`のARM64 release成果物

API/Webのproduction imageへ影響する安全な`push main`では、native ARM64 runnerがAPIとWebを一組でbuildし、GHCRへdigest固定でpushして、その配布対象digestをscan・runtime rehearsalします。`ci-required`、`codeql`、`gitleaks`は固定check名を保ちながらmainではsource validationを再実行せず、同じSHAの成果物検査が成功した後だけ、両digest・build設定hash・source SHAを結ぶrelease setを発行して3成果物をattestします。Pi4/Signageもmainでは公開する正確な成果物のbuild・scanだけを行います。PR、merge queue、手動実行、scheduleにはpackage write／attestation権限を与えません。

release setはCI成功の代替ではなく、成功済み成果物のproduction移送契約です。fixed required check名は変更しません。詳細は[ARM64成果物昇格ADR](../decisions/ADR-20260728-attested-arm64-release-artifact-promotion.md)を参照してください。

## `main` ruleset

representative PRで`ci-required`、`codeql`、`gitleaks`が成功した後に、default branchだけを対象とするactive rulesetを設定します。PRを必須にし、必要承認数は`0`、required checkはこの3件だけです。force-pushとbranch deletionは禁止し、branch must be up to dateは無効にします。

条件付きjob名をrequiredへ追加してはいけません。GitHubはrequired status checkをworkflowやeventごとに区別しないため、skipされるjobをrequiredにするとmergeが停止します。`merge_group`でも3つの固定checkが生成されるよう、対応workflowはすべて`merge_group` eventを持ちます。

設定値と確認方法の短い一覧は[`.github/BRANCH_PROTECTION_SETUP.md`](../../.github/BRANCH_PROTECTION_SETUP.md)を参照してください。このrepositoryには`develop` branchがないため、対象は`main`だけです。

## bounded validation policy

失敗したtestを理由なく再実行しません。まず最初の失敗logから原因を特定し、関連する修正を加えた場合だけ、そのtestを1回再実行します。networkやrunner障害を示す具体的な証拠がある場合も再実行は1回までです。無関係なsuiteへ範囲を広げたり、成功済みPR testをmainやローカルで繰り返したりしません。

testは状態を共有せず、必要なdataを自身で用意し、終了時にcleanupします。timeoutは処理の実測上限から設定し、flaky testを長いtimeoutや自動retryで隠しません。`ci-required`の選択結果とskip結果が一致しない場合はfail-closedです。

## トラブルシューティング

### 問題: テストが不安定で頻繁に失敗する

**対策**:
1. テストのログを確認して原因を特定
2. テストの独立性、clock、network、共有stateを確認
3. 原因を修正し、関連testだけを1回再実行
4. 原因不明のままretryや全suite実行を追加しない

### 問題: rulesetが機能しない

**確認事項**:
1. rulesetのenforcementがactiveか
2. 対象がdefault branchか
3. required checkが`ci-required`、`codeql`、`gitleaks`の3件だけか
4. 最新PR headで3件が成功しているか

### 問題: path分類漏れで`main`だけ失敗した

**対応**:
1. 失敗pathをclassifier fixtureとして追加する
2. conditional jobの`if`だけを一時的に無効化し、PRをfull suiteへ戻す
3. `ci-required`とrulesetは維持する
4. fixtureと修正後のrepresentative PRが成功してから条件分岐を再有効化する

## 関連ドキュメント

- `docs/analysis/dropbox-csv-integration-status.md`: CI/CDの課題と対策の詳細
- `.github/workflows/ci.yml`: CIワークフローの設定
- `docs/guides/development.md`: 開発環境とワークフローの説明

## 更新履歴

- 2026-08-13: PRをsource validation、mainを正確な配布成果物のbuild/scan/sign/publishへ分離し、無条件retryを廃止
- 2026-07-28: exact main SHAのnative ARM64 API/Web pair、digest scan、attested release setを追加
- 2026-07-28: 安全な`push main`を変更認識型へ変更し、CodeQL解析とAPI/Web Docker選択を分離
- 2026-07-16: 段階型CI、固定`ci-required`、default-branch ruleset契約へ更新
- 2026-04-21: 必須チェック名を現行ワークフロー（`lint-build-unit` 等）と `codeql` / `gitleaks` に同期
- 2025-12-15: 初版作成、`continue-on-error`削除を実施
