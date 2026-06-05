---
title: Hermes 普段遣いパイロット（D6-pre）
tags: [Hermes Agent, Discord, Spark LocalAI, Cursor, Codex, pilot, safety]
audience: [運用者, Cursor, Codex]
last-verified: 2026-06-06
related:
  - private-pi5-hermes-agent-plan.md
  - private-pi5-hermes-butler-vision-and-roadmap.md
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../../scripts/private-pi5-hermes/config/daily-pilot.policy.yaml
category: plans
update-frequency: high
---

# Hermes 普段遣いパイロット（D6-pre）

## 目的

現行の生産・開発システムにいきなり Hermes を接続せず、まず普段遣いで「司令塔としての振る舞い」を試す。

この段階の Hermes は **実行者ではなく進行係**。Discord から受けた内容を整理し、Cursor や Codex に渡す Markdown、CI 確認チェックリスト、Deploy 前チェックリストを作るだけにする。

## 使うモデル

Spark の LocalAI / DGX 側 OpenAI 互換 endpoint を使う想定。Hermes 公式の custom provider 方針どおり、OpenAI 互換 `/v1/chat/completions` として扱う。

## 許可すること

| 種類 | 内容 |
|------|------|
| メモ整理 | Discord で渡したメモを要約・分類する |
| Cursor 指示書 | Cursor に貼る作業依頼 Markdown を作る |
| Codex レビュー依頼 | 計画書・差分レビュー用 Prompt を作る |
| CI 確認 | GitHub Actions の結果を貼ったら、見るべき点を整理する |
| Deploy 前確認 | Deploy 前に確認する項目を Markdown にする |
| 日次ログ | 今日やったこと、次にやることを整理する |

## 禁止すること

| 種類 | 理由 |
|------|------|
| Cursor / Codex CLI の自動実行 | まだ worker 境界がない |
| コード編集 | 現行リポジトリを壊す恐れがある |
| git commit / push / merge | 人間承認と CI 状態の確認が必要 |
| Deploy / systemctl / docker | 実機影響が大きい |
| `.env` / token / secret 読取 | 秘密情報の漏洩リスク |
| terminal / shell 実行 | 実質的に何でもできてしまう |
| tailnet / LAN scan | 内部ネットワーク探索になる |

正本ポリシー: [`daily-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/daily-pilot.policy.yaml)

## Discord で試す例

```text
/daily 今日の作業メモを整理して、Cursorに渡す指示書にして
```

```text
/daily このCI失敗ログを貼るので、非エンジニア向けに原因候補と次の確認を整理して
```

```text
/daily この計画書をCodexにレビューさせるためのPromptを作って
```

## まだ試さない例

```text
Cursorを起動して実装して
```

```text
Codex CLIでレビューを実行して
```

```text
git pushしてDeployして
```

これらは D6+ の専用 worker profile / worktree / 承認設計ができてから扱う。

## 受け入れ条件

- Discord に `/daily` が登録され、Hermes が Markdown の整理・指示書作成だけを行う。
- Cursor/Codex/terminal/git/deploy を自動実行しない。
- policy validation が通る。
- Cursor に渡した指示書で、ユーザーが手動で次工程へ進める。

## 検証（2026-06-06 実施済）

```bash
python3 -m unittest scripts/private-pi5-hermes/tests/test_discord_daily_pilot_bridge.py \
  scripts/private-pi5-hermes/tests/test_discord_task_bridge_plugin_register.py \
  scripts/private-pi5-hermes/tests/test_daily_pilot_policy.py -v
# 17 OK（policy regex regression 含む）

python3 -m unittest discover -s scripts/private-pi5-hermes/tests -v
# 143 OK

python3 scripts/private-pi5-hermes/validate_boundary_policy.py \
  --check-docker-volumes --emit-hermes-security --emit-browser-env \
  --validate-task-bridge --validate-daily-pilot

./scripts/private-pi5-hermes/verify-discord-task-bridge-smoke.sh

ANSIBLE_LOCAL_TEMP=/private/tmp/ansible-local ANSIBLE_REMOTE_TEMP=/tmp/ansible-remote \
  ansible-playbook -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.sample.yml \
  infrastructure/ansible/playbooks/private-pi5-hermes.yml --syntax-check
```

記録: [KB daily pilot](../knowledge-base/KB-private-pi5-hermes-daily-pilot.md)

## 私用 Pi5 実機検証（2026-06-06 完了）

- fragment: `private_pi5_hermes_daily_pilot_enabled: true`（非コミット）
- 初回は sandbox 制限のため最小ファイル手動配置 → `hermes-gateway` restart
- Discord 受け入れ: 安全/危険プロンプトとも期待どおり
- **残タスク**: 標準 Ansible deploy で手動配置状態へ収束 · Discord command sync 手順の運用固定

## 有効化

fragment（非コミット）に以下を追加して標準デプロイする。

```yaml
private_pi5_hermes_daily_pilot_enabled: true
```

これにより `daily-pilot.policy.yaml` が chat gateway plugin へ配備され、`/daily` が登録される。`/daily` は deterministic Markdown を返すだけで、Spark LocalAI / Cursor / Codex / terminal / git / deploy は呼び出さない。

## 次の段階（D6-pre 維持期間）

Markdown-only を維持し、自動 Cursor/Codex 実行は追加しない。

優先:

- Ansible フルデプロイの収束確認
- Discord `/daily` command sync の Runbook 化
- 観測性・信頼性（plugin 登録・policy 配備の drift 検知）

D6 では、いきなり terminal を開けず、以下を設計する。

- `/task-code` のような専用入口
- 1 task = 1 worktree = 1 branch
- Cursor/Codex CLI は read-only review から開始
- write / commit / push / deploy は個別承認
- Hermes は実行ログと最終記録を残す
