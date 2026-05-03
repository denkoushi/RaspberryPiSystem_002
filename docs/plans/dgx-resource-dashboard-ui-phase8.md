# ExecPlan: DGX リソース管理ダッシュボード UI Phase8（KPI 先頭・説明削減・全文可読）

## ステータス

- completed（ブランチ `feat/dgx-resource-dashboard-ui-phase8` で実装・Pi5 deploy・実機検証まで完了）
- **代表コミット**: `89f65a7c`
- **本番デプロイ**: `./scripts/update-all-clients.sh feat/dgx-resource-dashboard-ui-phase8 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **Detach Run ID**: `20260503-181600-946`
- **実機検証**: `./scripts/deploy/verify-phase12-real.sh` → `PASS 43 / WARN 0 / FAIL 0`

## 背景

- HTML デザインプレビュー（`docs/design-preview/dgx-resource-current.html`）で合意した方向性:
  - メインの **ページ見出し `DGX リソース` と説明文（4操作のみ等）をやめる**
  - **`overview.kpis` を画面上部に KPI カードとして提示**（横一列優先・狭い幅は横スクロール）
  - **シナリオカードから絵文字行を削除**し、説明段落を冗長にしない
  - **文言は `truncate` で省略しない**（長いときは折り返しで全文）

## 目的別インデックス

- Runbook 節は後続で [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md) に一文追記してよい（本 Phase は **Web のみ**）。
- KB は障害が出たときのみ（通常は不要）。

## アーキテクチャ（SOLID）

| 原則 | 適用 |
| --- | --- |
| **S** | KPI の「値・バー割合・色クラス」の組み立てを **`dgxResourceKpiStripModel.ts`** に閉じ、コンポーネントは描画のみ。 |
| **O** | KPI 項目追加時はモデルの配列ビルダーを拡張し、レイアウトコンポーネントは項目を map するだけ。 |
| **L** | モデルは `DgxResourceKpis` にのみ依存し、React に依存しない（単体テスト可能）。 |
| **I** | コンポーネント Props は既存の `kpis` のみ（DIP: 詳細は API 型）。 |
| **D** | `dgxResourceProfiles.policyBarTone` は既存の単一ソースを再利用（重複ロジックを増やさない）。 |

疎結合: Dashboard は KPI ストリップを **構成要素として合成**するだけ。PrimaryScenarioFlow はオーケストレーション UX のみ担当。

## 実装タスク

1. [x] `dgxResourceKpiStripModel.ts` — `buildDgxResourceKpiStripItems(kpis)`
2. [x] `dgxResourceKpiStripModel.test.ts` — キー順・null KPI のプレースホルダ
3. [x] `DgxResourceKpiStrip.tsx` — モデル駆動・レイアウト（flex + lg:flex-1、`break-words`）
4. [x] `DgxResourceDashboard.tsx` — KPI を先頭に、`h1`/説明削除、エラー行のみヘッダー付近に維持
5. [x] `DgxResourcePrimaryScenarioFlow.tsx` — 絵文字・「4つの操作だけ…」削除、カード内 `break-words`
6. [x] `DgxResourceSparkStatusPanel.tsx` — `errorBrief` / `probeUrl` の省略をやめ折り返し

## 検証（実装者）

- `pnpm exec vitest run src/features/admin/dgx-resource/dgxResourceKpiStripModel.test.ts`（`apps/web`）
- `pnpm exec eslint ...`（変更ファイル）

## 判断ポイント（選択肢・推奨）

### A. KPI が未取得のときの表示

| 選択肢 | 内容 |
| --- | --- |
| **A1（推奨）** | API が既に `kpis` を常時返す前提で、そのまま「—」と灰色バーを表示（現状の `formatMem` 等と整合）。 |
| A2 | メトリクス未設定時だけ KPI セクションを非表示にする（`optionalProbes.metricsConfigured`）。 |

**推奨理由**: overview の契約は `kpis` 必須。別条件で DOM を消すと、レイアウトのジャンプと「なぜ無いか」の説明コストが増える。

### B. ロード中の見出し

| 選択肢 | 内容 |
| --- | --- |
| **B1（推奨）** | データ未取得時のみ従来どおり **`DGX リソース` + 読み込み中** を表示（OAuth 後の初期状態が迷子になりにくい）。 |
| B2 | ロード中も KPI スケルトンを出す（別コンポーネント）。 |

**推奨理由**: Phase8 のスコープを最小にし、追加デザイン議論を避ける。

### C. 状態チップ列と KPI の Policy の重複

| 選択肢 | 内容 |
| --- | --- |
| **C1（推奨）** | **両方残す**。チップはワークロード別、`Policy` KPI はバー付きサマリーで役割が異なる。 |
| C2 | チップからポリシーを消して KPI に一本化。 |

**推奨理由**: チップは「一目で業務/VLM/Comfy/実験」を読むための短期対応 UI。削ると運用コンソールの既習慣を壊しやすい。

## Surprises（メモ）

- Pi5 標準デプロイ preflight は **Pi5→Pi5 self-SSH** を使うため、Pi5 自身の公開鍵が `authorized_keys` に無いと **`Permission denied (publickey)`** で止まる。
- preflight 失敗時に **`runner=bootstrap` / `runPid=null`** の orphan lock が残ることがあり、**実行中プロセスと deploy artifact 不在**を確認してから lock を退避削除する必要があった。

## References

- [KB-365 §Phase7](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)
- [dgx-resource.types.ts](../../apps/web/src/api/dgx-resource.types.ts)（`DgxResourceKpis`）
