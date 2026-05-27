# 負荷調整タブ 改善提案（外注・部品単位）

| 項目 | 内容 |
|------|------|
| 対象 | キオスク > 負荷調整 > **資源CD俯瞰**（外注候補シミュ） |
| ステータス | **Phase 0 実装・Pi5 デプロイ済み**（本提案は Phase 1 以降） |
| ブランチ（ベースライン） | `feat/kiosk-load-balancing-outsourcing-sim` @ `128f89bd` |
| 正本ドキュメント | [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md) / [ガイド](../guides/kiosk-production-schedule-load-balancing.md) |
| 元稿 | Codex `2026-05-26/raspberrypisystem-002/load-balancing-improvement-proposal.md` |

## 前提（スコープ）

- 本ドキュメントは **設計・改修計画**（実装は別タスク）。
- **説得用表示**、**外注先の負荷能力管理**、**DB への外注確定反映**、**協力企業向け CSV 出力**は対象外。
- 主目的: 「どの**部品**を外に出せばキャパオーバーが解消するか」を可視化し、候補部品の**入れ替え**まで試せる状態にする。

---

## 実装ベースライン（Phase 0 · 2026-05-26）

[前回セッション](803da3df-9ea5-467c-b8d8-2eee0e3aefc5)で計画 1〜3 を実装し、**Pi5 のみ**標準デプロイ・実機検証済み。

| 項目 | 内容 |
|------|------|
| 超過資源選択 | `overMinutes > 0` の資源CDチップ・複数選択（初期は全超過） |
| 外注候補 | `POST .../outsourcing-candidates` · 効果 `min(行分, 源超過)` 降順 |
| 累積シミュ | `POST .../outsourcing-simulate` · `selectedRowIds[]` · DB 不変 |
| 社内移管 | 既存 `POST .../suggestions`（下部・外注とは別） |
| Pi5 デプロイ | Detach `20260526-183237-15690` · `128f89bd` · Phase12 **43/0/0** |
| CI | run `26443561903` **success** |
| **未デプロイ** | Pi4×4（キオスク実機は Pi5 検証のみ完了） |

### 現状の限界（本提案の動機）

1. **判断単位が工程行** — 同一品番が複数行・複数資源に分散すると、現場の思考（部品単位）とずれる。
2. **超過解消セットは手動** — 候補は効果順に並ぶだけで、「これを選べば解消」はユーザーが試行錯誤する。
3. **候補効果は静的** — `listOutsourcingCandidates` は初期 `overMap` 固定。選択済み行を反映した再ランキングはない（累積シミュは `simulate` 側のみ再計算）。
4. ~~**タブ間の工数定義差**~~ — **2026-05-27 解消**: 3タブとも `FSIGENSHOYORYO` 行総分 + 共通 eligibility。

**2026-05-27 追記（生産システム突合 + 本番）**: 生産の負荷グラフは **`FSIGENSHOYOYMD`（資源所要量 CSV）** 軸。キオスクは **着手日** 軸でよい（[ADR-20260527](../decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)）。集計修正 + **`shared` 能力フォールバック**は **`feat/kiosk-load-balancing-aggregation-fix`**（PR [#350](https://github.com/denkoushi/RaspberryPiSystem_002/pull/350)）·Pi5 **`20260527-161741-7843`** — [KB-363](../knowledge-base/KB-363-load-balancing-production-system-reconciliation.md)·[KB-362 §2026-05-27](../knowledge-base/KB-362-kiosk-load-balancing.md#実機検証2026-05-27--集計修正--shared-フォールバック)。

---

## 結論

現在の実装は、超過資源の**工程行**を候補として並べ、チェックした行を社内負荷から差し引くシミュレーションである。

ベストプラクティスに近づけるには、次の 3 段階に整理する。

1. 外に出す単位を「工程行」から「**部品候補**」に上げる。
2. 超過を解消する候補セットを**サーバ側で自動計算**する。
3. UI を「候補チェック」ではなく「**推奨セットの編集・入れ替え**」に変える。

---

## 改善 1: 外に出す単位を工程行から部品候補へ上げる

### 問題

候補単位は `LoadBalancingRowCandidate`（工程行）。画面上の判断が「どの部品を外すか」にならない。

### 提案

`ExternalizationCandidate` を追加し、`fseiban + productNo + fhincd` で束ねる（必要時のみ `fkojun` / 資源CD をキーに含める）。

```ts
export type ExternalizationCandidate = {
  candidateId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei?: string;
  operations: LoadBalancingRowCandidate[];
  impactByResource: Array<{
    resourceCd: string;
    reducedMinutes: number;
    overReductionMinutes: number;
  }>;
  totalReducedMinutes: number;
  totalOverReductionMinutes: number;
  resolvesOverResourceCds: string[];
};
```

### ブラッシュアップ（採用）

- **グループキー規則を明文化**: 既定は `fseiban|productNo|fhincd`。同一品番で工程だけ外す運用がある場合は `fkojun` をキーに含めるフラグ（API クエリ `groupBy?: 'part' | 'part_operation'`）を Phase 1 で検討。
- **部品名 `fhinmei`**: 機種別月次と同様、表示用にバッチ解決（境界: assembler / service。エンジンは ID のみ）。

---

## 改善 2: 超過解消セットを自動計算する

### 問題

`listOutsourcingCandidates` はソートのみ。解消に必要な組み合わせはユーザー任せ。

### 提案

`computeExternalizationPlan`（貪欲法・初期版）:

1. 選択中の超過資源に効く候補に限定
2. `totalOverReductionMinutes` 降順
3. 同点 → `operations.length` 昇順（部品あたり工程が少ない方）
4. 同点 → `totalReducedMinutes` 昇順（外に出す総量が少ない方）
5. **1 件選ぶたびに資源別負荷を再計算**（静的 overMap 問題の解消）
6. 対象資源の超過がゼロになったら停止

戦略: `min_count` | `max_over_reduction` | `min_total_minutes`（初期は貪欲 + 再計算ループ。`min_count` の厳密最適化は将来の set cover / ILP）。

### ブラッシュアップ（採用）

- **`maxCandidates` 切り捨てリスク**: plan 実行前に対象超過資源の候補を **切らない**、または plan 専用で上限を引き上げる。候補一覧 API だけ 100 件 cap を維持。
- **未解消時の契約**: `resolved: false` と `remainingOverMinutes`、および「あと N 分相当」のヒント（任意）を返す。
- **`alternatives`**: 同点候補を UI の入れ替えパネルへ渡す（改善 3 と接続）。

---

## 改善 3: simulation と planning を分ける

エンジン責務:

```txt
buildExternalizationCandidates   — 工程行 → 部品候補
computeExternalizationPlan       — 推奨セット自動選定
simulateExternalizationSelection — ユーザー選択の試算
computeReplacementOptions        — 1 件外したときの代替
```

`computeReplacementOptions` は、除外後の状態で **再び `computeExternalizationPlan` を 1 ステップ**するか、上位 K 件の差分試算を返す（性能: K≤5 推奨）。

---

## 改善 4: API を 4 本に整理

```txt
POST .../outsourcing-candidates    — 部品候補一覧（既存 URL 維持・レスポンス拡張）
POST .../outsourcing-plan          — 推奨セット（新規）
POST .../outsourcing-simulate      — selectedCandidateIds（移行期 selectedRowIds も受理）
POST .../outsourcing-replacements  — 入れ替え案（新規）
```

### 互換（採用）

- **移行期（1 リリース）**: `selectedRowIds` を受けたらサーバで `candidateId` にマップ。Web は新フィールドのみ送信。
- OpenAPI / `client.ts` / hooks を同時更新。KB・ガイドに breaking の有無を記載。

---

## 改善 5: 工数計算ポリシーを共通化

`load-minutes-policy.ts` で `per_row` | `quantity` を統一。

**注意**: 着手日タブと数値を揃えると、資源CD俯瞰の既存超過表示が変わる可能性がある。**業務オーナー確認後**に Phase 5 を実施。外注候補・plan・simulate だけ先に `per_row` のまま Phase 1〜4 を進めてよい。

---

## 改善 6: UI を「推奨セット編集」に

- 上段: 対象月 · 超過資源 · **推奨セットを自動選定**
- 中段: 推奨セット（部品 · 削減資源 · 残超過 · 外す · 入れ替え）
- 下段: 代替候補 · 資源別 before/after（常時表示）

チェックボックス中心 UI は廃止（移行期は「詳細: 工程行一覧」折りたたみで残してもよい）。

---

## 改善 7: フロント状態の分離

```txt
LoadBalancingOverviewTab.tsx          — 組み立てのみ
useExternalizationPlanState.ts        — 候補・plan・simulate・replacement
ExternalizationPlanPanel.tsx
ExternalizationCandidateTable.tsx
ExternalizationReplacementPanel.tsx
ResourceLoadBeforeAfterTable.tsx
```

---

## 改善 8: テスト（業務結果ベース）

エンジン:

- 複数工程 → 1 部品候補
- 1 部品が複数資源の超過を同時に削る
- 貪欲 + 再計算で超過ゼロで停止
- `maxCandidates` 切り捨てでも plan は解を返す（または未解消を明示）
- 重複 `candidateId` · 存在しない ID · 対象外資源はスキップ（simulate と同様）

API / UI: plan・replacements・自動選定ボタン・入れ替え後の before/after 更新。

---

## 推奨改修順

| Phase | 内容 | 状態 |
|-------|------|------|
| **0** | 超過資源選択・効果順候補・累積シミュ（工程行） | **完了**（Pi5 デプロイ済み） |
| **1** | `ExternalizationCandidate` · グループ化 · API レスポンス拡張 | **実装済み**（ブランチ `feat/kiosk-load-balancing-externalization-plan`・未デプロイ） |
| **2** | `computeExternalizationPlan` + 再計算ループ + テスト | **実装済み**（同上） |
| **3** | `outsourcing-plan` / `outsourcing-replacements` · simulate 移行 | **実装済み**（同上） |
| **4** | UI 推奨セット編集 · 状態分離 | **実装済み**（同上） |
| **5** | `load-minutes-policy` 共通化（業務確認後） | 未着手 |

**デプロイ順**: Phase 3 以降は API 変更を含む → **Pi5 先行** → Pi4×4（[deployment.md](../guides/deployment.md)）。

---

## 最終的な理想の動き

1. 対象月を選ぶ → 超過資源を表示
2. **推奨セットを自動選定** → サーバが部品セットを返す
3. 「この部品を外せば超過解消」と表示
4. 外したい部品は **入れ替え** → 代替候補と解消可否を即時表示
5. すべて read-only（DB 不変）

---

## 所見サマリ（レビュー）

| 観点 | 評価 |
|------|------|
| 問題把握 | **正確** — 工程行単位・手動試行・静的ランキングはコードと一致 |
| アーキテクチャ | **妥当** — engine 純関数 + service + ルート分離は既存パターンと整合 |
| Phase 分割 | **実務的** — 1→2→3→4 の順は依存関係が明確 |
| リスク | **工数ポリシー（改善 5）** と **貪欲の非最適性** をドキュメント化済み（本稿） |
| 即効性 | Phase 1+2 だけでも「部品単位の推奨セット」価値が出る。UI（Phase 4）は後追い可 |

**推奨**: 次の実装タスクは **Phase 1（部品候補型 + グループ化）と Phase 2（plan API）を同一 PR** にまとめ、Pi5 で API スモーク後に UI（Phase 4）を別 PR に分けるとレビューしやすい。
