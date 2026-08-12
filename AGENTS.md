# AI Agent Entry Point

このファイルには、全作業で必要な長期不変の境界だけを置く。現在の進捗、端末状態、詳細手順、実行結果はここへ複製せず、各正本で確認する。

## Start Rule

このファイルを読んだ後、次の順で必要な範囲だけを読む。

1. `docs/AI_START_HERE.md`
2. `.cursor/rules/00-core-safety.mdc`
3. `.cursor/rules/01-core-docs-and-knowledge.mdc`
4. `.cursor/rules/02-core-architecture.mdc`
5. 今回の作業に該当するルールと、関連する KB / Runbook / ADR / Plan

作業別の必須ルールは次のとおり。

- コード、テスト、CI: `.cursor/rules/10-quality-ci-and-tests.mdc`
- 不具合調査: `.cursor/rules/11-debugging-playbook.mdc`
- commit、push、PR、merge: `.cursor/rules/20-git-workflow.mdc`（ユーザーが依頼した段階だけ）
- ドキュメント: `.cursor/rules/30-docs-maintenance.mdc`
- フロントエンド/UI: `.cursor/rules/33-frontend-ui-quality.mdc`
- Codex/Cursor agmsg連携: `docs/guides/agmsg-codex-cursor-collaboration.md`

大きな文書を一括で読まず、依頼と変更対象に関係する箇所を検索して読む。編集前に `git status` / `git diff` を確認し、既存の未コミット変更をユーザーの WIP として保護する。

## Scope And Evidence

- 依頼から変更対象、受入条件、成功を示す証拠を絞り、最小変更で満たす。近接する改善や失敗を見つけても、依頼との因果がなければ別スコープとする。
- 実装依頼は commit、push、PR、merge、release、deploy の許可を含まない。依頼された段階を越える前に明示承認を得る。
- コード、テスト、CIの変更では、`10-quality-ci-and-tests.mdc` の検証予算、再実行上限、停止条件を必ず守る。無関係な失敗の修正はスコープ拡大として扱う。
- 複雑な機能追加や大きなリファクタだけ、`.agent/PLANS.md` に従って `docs/plans/` に ExecPlan を作る。小変更へ形式的な計画文書を追加しない。
- ルートの `EXEC_PLAN.md` は legacy historical log であり、詳細正本にせず、新しい進捗ログを追記しない。

## Production Deploy Boundary

- ユーザーの「Deploy」「デプロイ」「本番反映」は、別方式が明示されない限り標準ローリング更新を指す。本番実行には明示承認が必要で、同じ作業中に承認済みなら再確認しない。
- 実機へ接続する前に、対象branchまたは不変SHAと、その対象のCI成功を確認する。対象が一意でなければ推測せず質問する。
- 通常更新は `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml` を使う。最初に `--print-plan` で対象と順序を確認し、mutationには exact `--limit PATTERN` または明示的な `--full-fleet` を付ける。
- 現行の手順と端末別制約は `docs/guides/deployment.md` と `docs/guides/quick-start-deployment.md`、復旧は `docs/runbooks/deploy-status-recovery.md` を正本とする。
- process killや、lock、run情報、migration台帳などの運用状態の手編集で標準経路を迂回しない。

## DGX Spark Control Plane Boundary

- 通常はこのリポジトリだけを変更する。DGXのLease、Job、排他調停、Private Pi管理、Observer、履歴DBは `denkoushi/DGXSparkControlPlane` の責務である。
- DGX互換API、model profile、principal/token、workload識別子、Hermes/StackChanのDGX起動方式を変える場合は、[`DGXSparkControlPlane` の責任分界](https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/repository-boundary.md)を先に確認する。
- 共同変更はControl Planeへ後方互換を先に追加し、consumerを後から更新する。リポジトリごとにbranchとPRを分ける。
- 標準fleet deployからPrivate PiのControl API、Dashboard、Observer、Postgres、DGX Arbiterを導入または置換しない。

## Completion Boundary

- 終了時は、依頼された段階の証拠だけを確認する。ローカル実装は差分と対象検証、PRはpush済みSHAとchecks、mergeはmainのmerge SHAとCI、deployはrun ID、status、recap、health、rollback結果を確認する。
- 未実施の段階は未実施と明記する。feature branchの検証成功を、main統合や本番反映の成功として扱わない。
- 最後にworktreeを再確認し、自分の変更と既存WIPを区別して報告する。
