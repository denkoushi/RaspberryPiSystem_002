# AI Agent Entry Point

このリポジトリにおけるAIエージェントの基本方針は、`docs/AI_START_HERE.md` と `.cursor/rules/` に集約する。

## AI Start Rule

作業開始時は次の順で読む。

1. `AGENTS.md`
2. `docs/AI_START_HERE.md`
3. `.cursor/rules/00-core-safety.mdc`
4. `.cursor/rules/01-core-docs-and-knowledge.mdc`
5. 今回の作業に該当する `.cursor/rules/*.mdc`
6. Codex/Cursor agmsg連携を使う場合は `docs/guides/agmsg-codex-cursor-collaboration.md`
7. 関連する KB / Runbook / ADR / Plan
8. DGX API・profile・認証・workload・Hermes／StackChanのDGX利用を変更する場合は、
   [`DGXSparkControlPlane`のリポジトリ責任分界](https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/repository-boundary.md)

## 本番デプロイの必須ルール（常時適用）

- ユーザーの「Deploy」「デプロイ」「本番反映」は、**標準ローリング更新**を意味する。通常のアプリ更新は必ず `scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml` を使う。
- 実機へ接続する前に、対象ブランチまたは不変SHAと、その対象のCI成功を確認する。対象が会話・PR・依頼から一意に決まらない場合は推測せず質問する。本番実行にはユーザーの明示承認が必要であり、同じ作業中に既に承認済みなら再確認しない。
- 通常更新では `scripts/update-all-clients.sh` と標準Ansible経路だけを使う。実行経路は `scripts/deploy/standard-ansible-release.py` → `infrastructure/ansible/playbooks/deploy-release-standard.yml` → `release_pi5` / `release_kiosk` / `release_signage` とし、対象選択はPi5・Pi4・Pi3のinventoryとroleに委ねる。
- 最初に `scripts/update-all-clients.sh <branch> <inventory> --print-plan` を実行し、対象理由と `unknown` hostを確認する。標準では検証済み同一SHAだけを除外し、根拠不明hostは必ず対象に含める。全台を明示的に再検証するときだけ `--full-fleet` を使う。
- 実行後は標準Ansibleの結果と既存のhealth／rollback契約を確認し、Pi5・端末別の結果、失敗理由と復旧結果を報告する。process kill、lock削除、fleet state手編集は行わない。
- TalkPlaza Pi5は構想段階で実機が存在しないため、現時点では `inventory-talkplaza.yml` のplan確認までに留める。
- 詳細な運用・復旧は `docs/guides/deployment.md` と `docs/runbooks/deploy-status-recovery.md` を現行正本とする。設計経緯は `docs/plans/deployment-foundation-refactor-execplan.md` に残す。Pi5本体故障・停電は単体構成の対象外である。

## DGX Spark Control Planeとの境界（常時適用）

- 本リポジトリは業務キオスク、業務管理画面、業務Pi 5／Pi 4、および業務側DGX API利用を担当する。
- DGXのLease・Job・排他調停、Private Piの管理画面・Observer・履歴DBは `denkoushi/DGXSparkControlPlane` が正本である。
- 通常は本リポジトリだけを変更する。DGX互換API、model profile、principal／token、workload識別子、Hermes／StackChanのDGX起動方式を変える場合だけ両リポジトリを確認する。
- 共同変更はControl Planeへ後方互換を先に追加し、本リポジトリのconsumerを後から更新する。各リポジトリで別branch・別PRとする。
- 標準fleet deployからPrivate PiのControl API、Dashboard、Observer、Postgres、DGX Arbiterを導入・置換してはならない。既存の専用Hermes／StackChan手順は明示選択時だけ使用し、Control Planeのserviceやinventoryを変更しない。
- 詳細正本は [`DGXSparkControlPlane/docs/repository-boundary.md`](https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/repository-boundary.md) とする。

## main統合と作業完了の必須監査（常時適用）

- 実装、PR、リリース、デプロイを含む作業は、終了前に次の4状態をSHA付きで別々に確認する: (1) worktreeがclean、(2) ローカルbranchと対応するorigin branchが一致、(3) 有効な変更とデプロイ対象SHAが`origin/main`へ統合済み、(4) fleet各hostの本番実行SHAと検証証跡。
- `scripts/update-all-clients.sh` の `--print-plan`、通常実行結果、`--status` にある `mainIntegration` を確認する。`completionEligible` が `true` でない場合、実機検証が成功していてもリポジトリ作業を「完了」「main反映済み」と報告してはならない。
- feature branchからの承認済み先行検証は許可する。この場合、releaseの`success`と作業完了を区別し、`integrationPending=true`としてPR作成、必須CI、main merge、必要なmain再検証を未完了項目に残す。
- staleまたは廃止branchを機械的に全mergeしない。有効な変更が別PR・別commitでmainへ到達した場合は、置換根拠を記録して元PRをsupersededとして扱う。

## ExecPlan（複雑な作業の必須手順）

複雑な機能追加・大きなリファクタは、`.agent/PLANS.md` に従って ExecPlan を作成し、設計→実装→検証の順で進める。

**ExecPlanの種類**:
- **個別機能のExecPlan**: `docs/plans/*.md` に配置（例: `alerts-platform-phase2.md`、`deploy-stability-execplan.md`）
- **プロジェクト全体のExecPlan**: `EXEC_PLAN.md`（ルート直下・現在は legacy historical log）

**`EXEC_PLAN.md`の現在の扱い**:
- **legacy historical log** として扱う
- 肥大化と文字化けがあるため、詳細正本として信頼しない
- 新規の詳細追記は原則禁止
- 必要な場合でも、現在状態・未完了・次アクションだけに限定する

詳細な事実は1か所だけに記録する。障害・調査は KB、手順は Runbook、設計判断は ADR、未完了計画は Plan に置く。`docs/INDEX.md` と `docs/knowledge-base/index.md` は索引専用とし、本文級の追記は禁止する。

## 参照するルール（`.cursor/rules/`）

### Always（常時適用）

- `.cursor/rules/00-core-safety.mdc`: 安全最優先（破壊的操作の抑止、最小変更、実行境界）
- `.cursor/rules/01-core-docs-and-knowledge.mdc`: ナレッジ/ドキュメントの構造化（KB/ADR/Runbook/索引）
- `.cursor/rules/02-core-architecture.mdc`: 疎結合・モジュール化・互換性維持

### Auto Attached / Agent Requested（必要時のみ）

- `.cursor/rules/10-quality-ci-and-tests.mdc`: CI/テストによる品質担保
- `.cursor/rules/11-debugging-playbook.mdc`: 仮説駆動デバッグ
- `.cursor/rules/20-git-workflow.mdc`: Git安全運用（明示依頼がある時のみ実行）
- `.cursor/rules/30-docs-maintenance.mdc`: ドキュメント肥大化対策
- `.cursor/rules/33-frontend-ui-quality.mdc`: UI品質（UI Skillsを条件付き採用）

## プロジェクト固有コンテキスト（ショートカット）

このプロジェクト固有の文脈（デプロイ手順・運用・KB等）は `docs/` 配下にあります。AI向けの最小入口は `docs/AI_START_HERE.md`、網羅的な入口は `docs/INDEX.md` です。

- **AI向け最小入口**: `docs/AI_START_HERE.md`
- **ドキュメント入口**: `docs/INDEX.md`
- **設計決定（ADR）**: `docs/decisions/`
- **デプロイ標準手順**: `docs/guides/deployment.md`
- **ナレッジベース索引**: `docs/knowledge-base/index.md`
- **CIトラブルシュート**: `docs/guides/ci-troubleshooting.md`
- **Codex/Cursor agmsg連携**: `docs/guides/agmsg-codex-cursor-collaboration.md`
- **PR 自動レビュー Bot（CodeRabbit / Bugbot）**: `docs/security/pr-review-bots.md`
- **過去ログ**: `EXEC_PLAN.md`（legacy historical log。詳細正本として使わない）

## Cursor 状態DB復旧後（2026-06-06）

チャット/Agent 履歴が失われても、**リポジトリ・`docs/`・未コミット WIP は残る**。復旧直後は次を優先する。

- **未コミット変更は WIP として破棄しない**（復旧直後に残っていた作業は `docs/` へ昇格してからコミット）
- **本番デプロイ・Pi 実機操作はユーザー明示まで実行しない**
- 文脈は [docs/AI_START_HERE.md](./docs/AI_START_HERE.md) · [docs/INDEX.md](./docs/INDEX.md) · 該当 KB / Runbook / ADR / Plan から再構築する
- `EXEC_PLAN.md` は過去ログとしてのみ参照し、復旧後の新規詳細追記先にしない

詳細: [KB-388](./docs/knowledge-base/KB-388-cursor-state-db-corruption-external-ssd-recovery.md) · [development §Cursor復旧後](./docs/guides/development.md#cursor-状態db復旧後の-agent-作業2026-06-06)

## 共有時の推奨フレーズ（短縮）

「**`AGENTS.md`、`docs/AI_START_HERE.md`、該当する `.cursor/rules/` を読んでから開始**」
