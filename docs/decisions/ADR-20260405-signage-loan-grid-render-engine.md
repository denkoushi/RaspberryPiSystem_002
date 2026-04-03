---
title: ADR-20260405 サイネージ貸出グリッドの描画エンジン（svg_legacy / playwright_html）
status: accepted
date: 2026-04-03
category: decisions
---

# ADR-20260405: サイネージ貸出グリッドの描画エンジン選択

## Context

- SPLIT レイアウトの loans ペインで、ブラウザ相当の折り返しに近い見た目を **サーバー側 JPEG** に載せたい。
- 既存実装は **SVG 生成（`svg_legacy`）** であり、互換・フォールバックの正本として残す必要がある。
- **Headless Chromium（Playwright）** で HTML/CSS をラスタ化する経路は **コンテナサイズ・運用コスト**が増える。

## Decision

- 環境変数 **`SIGNAGE_LOAN_GRID_ENGINE`** で切り替える。
  - **`svg_legacy`**（既定）: 既存 SVG パス。
  - **`playwright_html`**: HTML 文書生成 → Playwright で PNG → 親 SVG の `<image>` 合成。
- 本番では **Ansible `docker.env.j2` → ホスト `infrastructure/docker/.env` → `api` コンテナ** で値を配線する（`apps/api/.env` のみでは compose が読まないケースがある）。
- **KB**: [KB-327](../knowledge-base/infrastructure/signage.md#kb-327-貸出グリッド-playwright--signage_loan_grid_engine-とデプロイ環境のずれ)。

## Alternatives

- **常に Playwright のみ**: 既存環境・縮退運用でリスクが高い。
- **クライアント側で HTML 描画**: Pi3 軽量表示（JPEG 取得）は維持したいため不採用。

## Consequences

- **良い**: 段階的導入・即時ロールバック（`svg_legacy`）が可能。
- **悪い**: env 未配線時は **常に既定 `svg_legacy`** のため、「コードは新しいのに見た目が変わらない」という運用誤解が起きうる → KB・デプロイ手順で明示する。

## References

- `apps/api/src/config/env.ts`
- `apps/api/src/services/signage/loan-grid/create-loan-grid-rasterizer.ts`
- `infrastructure/ansible/templates/docker.env.j2`
- [deployment.md](../guides/deployment.md)
