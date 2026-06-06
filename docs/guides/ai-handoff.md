---
title: AI引き継ぎガイド - 現行AI入口と正本ルール
tags: [AI, 引き継ぎ, 運用, ドキュメント体系]
audience: [AIアシスタント, 開発者]
last-verified: 2026-06-06
related: [../AI_START_HERE.md, ../../AGENTS.md, ../../README.md]
category: guides
update-frequency: low
---

# AI引き継ぎガイド - 現行AI入口と正本ルール

この文書は過去の「EXEC_PLAN.md中心」運用を置き換えるための短いガイドです。AIが最初に読むべき最小入口は [docs/AI_START_HERE.md](../AI_START_HERE.md) です。

## 現行の読み順

1. [AGENTS.md](../../AGENTS.md)
2. [docs/AI_START_HERE.md](../AI_START_HERE.md)
3. `.cursor/rules/00-core-safety.mdc`
4. `.cursor/rules/01-core-docs-and-knowledge.mdc`
5. 今回の作業に該当する `.cursor/rules/*.mdc`
6. 関連する KB / Runbook / ADR / Plan

最初から巨大文書を全文読みしない。必要な正本文書へ絞って読む。

## EXEC_PLAN.md の扱い

[EXEC_PLAN.md](../../EXEC_PLAN.md) は現在 `legacy historical log` として扱う。肥大化と文字化けがあるため、詳細正本として使わない。

新規の詳細追記は禁止する。どうしても触る場合は、現在状態・未完了・次アクションだけに限定する。

## 正本の置き場所

- 障害、調査、原因、再発防止: `docs/knowledge-base/`
- 運用、復旧、デプロイ、検証手順: `docs/runbooks/`
- 設計判断、採用理由、却下理由、トレードオフ: `docs/decisions/`
- 未完了作業、実装計画、検証計画: `docs/plans/`
- 全体索引: `docs/INDEX.md`
- KB索引: `docs/knowledge-base/index.md`

索引は詳細正本ではない。索引には短いリンクだけを置き、本文級の説明を追記しない。

## 書き方

- 詳細な事実は1か所だけに置く
- 同じ検証結果やトラブルシュートを複数文書へ全文コピーしない
- 既存巨大文書は全面整理しない。触った範囲だけ正す
- 新規の独立した KB / ADR / Runbook / Plan は英語見出しと構造化メタデータを優先する
- 日本語UI文言、現場用語、ログ、ユーザー発話は原文のまま残す

## 引き継ぎチェック

- `docs/AI_START_HERE.md` を読んだ
- `EXEC_PLAN.md` を詳細正本として扱わないことを理解した
- 今回の作業の正本種別（KB / Runbook / ADR / Plan）を決めた
- 索引へ本文級追記をしないことを確認した
- コミット前のドキュメント健全性チェックを実施する
