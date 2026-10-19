---
title: キオスク取説を本番UIから決定的に生成する
status: accepted
date: 2026-08-01
---

# ADR: キオスク取説を本番UIから決定的に生成する

## Context

従来の検査図面取説は、実装を参考に手書きした HTML/CSS/SVG のモックだった。実機能の追加後も文章と画面が自動では追従せず、必須・任意の視覚区分もなかった。DEV プレビューも本番編集ページの全状態を再現しない。

## Decision

- 機能隣接の構造化定義を操作説明の正本とする。任意コードからLLMで説明を推測しない。
- 固定Playwrightコンテナで本番Reactルートを開き、APIだけを決定的fixtureへ差し替えて画面PNGを生成する。
- 1シートごとに独立したBrowser contextを作り、その説明に必要な実画面状態をfixture adapterで準備する。別シートの画面状態や背景PNGを再利用しない。
- 各操作は同じ `data-kiosk-sop-target` を持つ可視DOM要素が正確に1個ある場合だけ生成する。丸数字の座標はDOM矩形の右下角をviewport正規化した値とし、手書き座標・欠落時fallback・要素中央は使用しない。
- 背景PNG、注釈済みシートPNG、自己完結HTML、ハッシュmanifestをリポジトリへ保存する。
- 関連ソースと生成物のハッシュが一致しない場合、専用CIジョブを失敗させてマージを止める。
- ランタイムは `manualId` から生成registryを解決し、任意HTMLを画面側から渡さない。
- 必須は `#C2410C` の3px実線と「必須」、任意は `#64748B` の2px破線と「任意」を用いる。
- ADR-20260728 の左ステップレール、focus/hover時の引出線、印刷時非表示は維持する。

## Consequences

画像は実コードと固定fixtureから再現でき、機能変更後の再生成漏れを機械的に検出できる。生成にはDockerが必要で、画像差分は固定Chromiumとフォントの更新時にも発生する。自然言語の意味的正しさはコードから推測せず、機能変更と同じ差分で構造化定義を更新する。

## References

- [実装ExecPlan](../plans/kiosk-sop-generated-maintenance-execplan.md)
- [生成済みプレビュー](../design-previews/kiosk-inspection-drawing-edit-existing-sop.html)
- [ステップレールADR](./ADR-20260728-inspection-drawing-sop-step-rail.md)
- [semantic target correction ExecPlan](../plans/kiosk-sop-semantic-target-correction-execplan.md)
