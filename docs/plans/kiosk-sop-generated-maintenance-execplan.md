---
title: 実コード連動型キオスク取説の自動生成・保守基盤
status: completed
owner: Codex
created: 2026-08-01
updated: 2026-08-01
---

# 実コード連動型キオスク取説の自動生成・保守基盤

## Purpose

検査図面の「取説」を手書きモックから実際の本番 React 画面を基にした生成物へ移行する。操作説明、必須・任意区分、対象 UI、画面状態を機械可読な定義にまとめ、画像・HTML・manifest を決定的に生成する。関連コード変更後に成果物が古い場合は CI を失敗させ、今後の取説追加にも同じ仕組みを再利用できるようにする。

## Progress

- [x] (2026-08-01) `main` を fast-forward 同期し、クリーンな状態から `feat/kiosk-sop-generated-maintenance` を作成した。
- [x] (2026-08-01) 共通 `@raspi-system/kiosk-sop-core` パッケージを追加した。
- [x] (2026-08-01) 検査図面の9シート構造化定義、固定Playwright生成器、実画面/注釈PNG、manifestを追加した。
- [x] (2026-08-01) 現行ランチャーを型付き生成 registry に接続し、前後移動と必須・任意表示を実装した。
- [x] (2026-08-01) source digest、限定coverage境界、生成差分検査、CI必須ジョブを追加した。
- [x] (2026-08-01) ADR・索引・既存計画・生成文書 inventory を更新した。
- [x] (2026-08-01) Core/Web の lint・unit・build、Playwright 5件、CI分類17件を通過した。
- [x] (2026-08-01) 固定Linux/Chromium環境で再生成と独立再生成のバイト一致を確認した。
- [x] (2026-08-01) 本番Web Dockerイメージをビルドし、一時Caddyで取説本文と埋込PNGを確認後に削除した。
- [x] (2026-08-01) disposable PostgreSQLで157 migration、関連API統合テスト3件、SQL/EXPLAINを確認し、専用Docker資源をすべて削除した。

## Surprises & Discoveries

- 現行のリリース取説は `docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html` を raw import する静的 HTML で、画像キャプチャーパイプラインではない。
- DEV 編集プレビューは本番部品を多く使うが、兄弟資源保存や OCR 候補などを省略しており、生成元にはできない。
- ローカル Node は v18 でリポジトリ要件を満たさないため、Playwright 生成と最終 Node 検証には固定コンテナを用いる。
- Playwright公式イメージは `sha256:f1e7e...b837a` へ固定し、Chromium `141.0.7390.37` で生成できた。
- 全Web単体テストでは旧2シートのiframe titleを固定していた1件だけが失敗し、9シートregistry契約へ更新した。
- Chromium/Skiaは角丸境界の数ピクセルを実行ごとに1〜6階調変えるため、撮影時だけ角丸を除去する安定化CSSを適用してバイト一致を実現した。アニメーション、キャレット、GPU、フォントヒンティングも固定している。
- 最初のDB再検証中にDocker Desktopのoverlay2 I/Oエラーが発生した。稼働中が専用一時DBだけであることを確認してDocker Desktopを再起動し、専用資源が消えたことを確認後、全検証を再実行した。

## Decision Log

- 取説の正本は機能隣接の JSON 定義とし、LLM による説明文推測は行わない。
- 実行時ビューアーの `srcDoc`、sandbox、focus/postMessage 契約は維持し、生成 registry だけを差し替える。
- 必須は濃いオレンジの実線、任意は控えめなスレートの破線とし、文字ラベルも併用する。
- 生成時刻や Git SHA は manifest に含めず、同一入力から同一出力を得る。
- DB 検証は既存 Docker 資源を使わず、固有名の一時 PostgreSQL/volume/network だけで行う。
- 角丸は機能・レイアウト・座標に影響しない撮影時の正規化対象とし、本番WebのCSSは変更しない。

## Implementation Notes

共通コアは定義検証、描画、座標、ハッシュに限定する。Playwright とファイル操作は `scripts/kiosk-sop`、検査図面固有 fixture は同ディレクトリの adapter、React 接続は Web 側 registry に分離する。生成画像は `apps/web/src/generated/kiosk-sop` に置き、ドキュメント用 HTML は従来パスへ生成する。

## Validation

コア/Web の unit・lint・build、生成/差分チェック、Playwright の本番ルート契約、Web Docker smoke を実行する。DB は `pgvector/pgvector:pg15` の一時環境で migration、関連 API 統合テスト、SQL と `EXPLAIN (ANALYZE, BUFFERS)` を確認し、最後に全一時資源の削除を証明する。

## Outcomes & Retrospective

検査図面取説を、2つの本番Reactシナリオから生成する9シート・44操作へ移行した。背景2枚、最終確認用9枚、自己完結HTML、座標とSHA-256を持つmanifestを同じ構造化定義から生成し、必須は濃いオレンジの3px実線、任意は控えめなスレートの2px破線とラベルで区別した。実行時は型付きregistryから取説IDを選び、既存のsandbox、フォーカス復帰、追加通信なしの契約を維持する。

CIには `kiosk_sop` 分類と必須ジョブを追加した。定義が宣言するエントリーと監視globs、共通ビューアー、UI、テーマ、生成器、コアの変更はsource hashを変え、再生成していない場合は独立生成差分で失敗する。生成時のcoverage境界では未分類の対話要素、未定義API、外部通信、page errorをfail closedにする。現在の厳密な対話要素coverage境界は検査図面一覧の上部操作帯であり、その他の条件付き操作は定義済み正規化座標と広いsource監視で保守する。今後coverage境界を広げる場合は、同じ対象/理由付き除外契約を段階的に適用する。

検証結果は、Core 4件、Web 1666件、Playwright 5件、CI分類17件が成功した。Web production buildと本番Docker/Caddy smokeも成功した。disposable PostgreSQLでは157 migrationが完了済み、未完了・rollback migrationは0件、PNG図面紐付け、兄弟資源改版、非稼働図面取得の関連テストが各1件成功した。通常計画は小規模fixtureのため図面側Seq Scanとテンプレート側複合indexを選び、`enable_seqscan=off` の診断では `PartMeasurementVisualTemplate_searchDigits_trgm_idx` のBitmap Index Scanを確認した。終了時に専用container・volume・networkが0件であることを確認した。
