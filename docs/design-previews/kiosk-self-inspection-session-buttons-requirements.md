# キオスク自主検査セッション — ボタンUI要件

**Status**: **Pi5 本番反映・実機 OK**（`feat/kiosk-self-inspection-button-ui` → **`main` マージ**）  
**Preview**: [kiosk-self-inspection-session-buttons-preview.html](./kiosk-self-inspection-session-buttons-preview.html)（参照用）  
**対象画面**: `/kiosk/part-measurement/self-inspection/sessions/:sessionId`  
**実装**: [`selfInspectionKioskTheme.ts`](../../apps/web/src/features/part-measurement/selfInspectionKioskTheme.ts) · [`SelfInspectionKioskButton.tsx`](../../apps/web/src/features/part-measurement/SelfInspectionKioskButton.tsx) · `KioskSelfInspectionSessionPage.tsx` · `SelfInspectionSessionHeader.tsx` · `InspectionDrawingCanvasZoomControls`（`getButtonClassName`）

---

## 1. 目的

- 自主検査セッション内のボタンで、**押せる／押せない／どの入力件か**が迷わないようにする。
- **見た目の種類を最小化**し、旧UIの混在（緑塗り・白枠ゴースト・シアン・opacity/grayscale のばらつき）をやめる。
- `入力を保存` と `自主検査を完了` は、**押せる条件がそろったときだけ**青外枠で目立たせる（文言は増やさない）。

---

## 2. スコープ

| 含む | 含まない |
|------|----------|
| ヘッダー（再開・次の測定点・一覧へ・ズーム） | 活性条件ロジックの変更（`selfInspectionSessionActionState` は現状維持） |
| 入力件チップ | 押せない理由の補助テキスト（amber 文言） |
| 保存・完了の青外枠強調 | 検査図面作成ツールバー・部品計測トップの工程トグル |
| 入力件ページ送り（前へ・次へ） | 順位ボード「検」ボタンの色 |
| 測定点ガイド（`useSelfInspectionGuidedFocus`） | 押下後に青外枠を消す state/hook |

---

## 3. 視覚ルール（正本）

### 3.1 押せるとき — **1形のみ**

すべての押せるボタン（ツール・未選択/選択の入力件・保存・完了）で **同じスタイル**。

| 属性 | 値（プレビュー正本） |
|------|----------------------|
| 背景 | `#334155`（Tailwind 相当: `bg-slate-700`） |
| 枠 | **なし**（`border-0`） |
| 文字 | 白・semibold |
| 形状 | `min-h-11`（44px）・角丸・padding 横 |

**禁止（押せる間）**

- 選択だけ白塗り、完了だけ緑塗り、入力件だけシアン等の **役割別の色分け**
- 未選択入力件を押せない見た目に近づけること
- `ghostOnDark` と `primary` の混在

**許容**

- 完了ボタンの **幅だけ** やや広く（色・枠スタイルは同じ）

### 3.2 押せないとき — **1形のみ**（合意済み）

| 属性 | 方針 |
|------|------|
| 形 | 押せるときと同じ（高さ・角丸・padding） |
| 背景・枠・文字 | 弱い色にする（枠も **なし**） |
| 禁止 | 要素全体の `opacity-60` / `grayscale` / `saturate`、破線枠、シアン等の装飾 |

プレビュー実装例: 背景 `rgba(30,41,59,0.5)`、文字 `rgba(248,250,252,0.38)`。

**既存 `Button` の `disabled:opacity-60` は上書きして無効化すること**（`inspectionDrawingKioskDisabledButtonClass` の grayscale も使わない）。

### 3.2.1 青外枠強調（`入力を保存` / `自主検査を完了` のみ・文言追加なし）

| 属性 | 方針 |
|------|------|
| 対象 | **`入力を保存`** と **`自主検査を完了`** のみ |
| 条件 | それぞれ `saveActionState.enabled` / `completeActionState.enabled` が true のとき |
| 見た目 | `ring-2 ring-sky-400` + 青系の軽い `box-shadow`（`border` 幅は変えない） |
| 非対象 | `再開`、入力件チップ、ページ送り、ズーム、`次の測定点` |
| 禁止 | 補助文言・ラベル追加、押下後消灯 state、業務順序の優先判定 |

両方押せる場合は両方に青外枠を付けてよい。ただし現行ロジックでは、未保存がある間は完了は通常 `unsaved_changes` で押せない。

### 3.3 どの件を編集中か（色分けしない）

- **切替ボタン（`1` `2` `最初` 等）の色は押せるとき他ボタンと同じ**。選択は `aria-pressed` + 必要時 `aria-label` に「選択中」。
- **見出し** `入力件（{selectedSlotLabel} / {requiredEntryCount}）` を必ず維持。
- **測定値パネル**（`InspectionDrawingValuePanel`）の内容で件の違いを確認。

### 3.4 文言・装飾

| 項目 | 要件 |
|------|------|
| 押せない理由 | **表示しない**（目障りのため） |
| 帯ラベル・比較用旧UI・破線 | **不要** |
| ボタンらしさ | 文字リンクのみにしない（枠＋背景必須） |

---

## 4. 状態とロジックの関係

- **活性条件**は既存 `selfInspectionSessionActionState` のまま（保存・完了・再開の `enabled` / `disabled` 属性）。
- **青外枠**は活性条件と同じ `enabled` をページから `highlighted` にそのまま渡す。専用の誘導判定は持たない。
- 本要件の UI 変更は **見た目のみ**。`disabled` 属性と見た目クラスを一致させる。
- 測定点ガイド（`useSelfInspectionGuidedFocus` / `resolveSelfInspectionResumeGuideActionState` / `consumeNextBlurGuideAdvance`）は既存のまま残す。

---

## 5. 実装（コード）

### テーマ API

`selfInspectionKioskButtonClass({ disabled?, size?, wide?, pressed?, highlighted? })`

| 引数 | 用途 |
|------|------|
| `disabled` | 押せない見た目 |
| `size` | `default` / `compact` / `icon` |
| `wide` | 完了ボタン幅 |
| `pressed` | 入力件選択（色は変えない） |
| `highlighted` | 青外枠強調（enabled 時のみ反映） |

| size | 用途 |
|------|------|
| `default` | 保存・完了・切替 |
| `compact` | ヘッダー・前へ/次へ |
| `icon` | ズーム ±□ |

### コンポーネント

- **`SelfInspectionKioskButton`**: 共通 `Button` 不使用。`highlighted` prop をテーマへ渡す。外部 `className` 禁止。
- **`InspectionDrawingCanvasZoomControls`**: 親から `getButtonClassName(disabled)` を渡したときのみネイティブ `<button>`。未指定時は従来 `Button` + `ghostOnDark`（共通部品は自主検査テーマを import しない）。

### ページ配線（`KioskSelfInspectionSessionPage`）

```tsx
<SelfInspectionKioskButton
  disabled={!saveActionState.enabled}
  highlighted={saveActionState.enabled}
>
  入力を保存
</SelfInspectionKioskButton>
<SelfInspectionKioskButton
  disabled={!completeActionState.enabled}
  highlighted={completeActionState.enabled}
>
  自主検査を完了
</SelfInspectionKioskButton>
```

### 削除した常時表示

- `saveActionHint` / `completeActionHint` / `resumeGuideActionHint` の JSX

### 削除した未依頼差分

- `selfInspectionGuidedButtonTarget.ts`
- `useSelfInspectionGuidedButtonHighlight.ts`
- `resumeGuideHighlighted` prop
- 押下後消灯の `dismiss...` 呼び出し

### 残した理由文言

- `selfInspectionActionReasonMessage` — 保存ガード失敗時の `actionError`
- `actionError` — API 失敗表示

---

## 6. 旧UIからの差分（要約）

| 旧（本番） | 新（要件） |
|------------|------------|
| 保存=primary 緑塗り、完了=ghostOnDark | 押せる=すべて同じスレート背景 |
| 選択入力件=シアン塗り | 選択=色変更なし |
| 再開だけ `opacity-35`+grayscale | 押せない=統一の弱い見た目 |
| 無効理由 amber 補助文 | 理由文なし |
| 白枠あり | 白枠なし |
| 保存/完了の強調なし | 押せるときだけ青外枠 |

---

## 7. 検証

- [x] プレビュー HTML と本番のクラスが対応している（`ring-2 ring-sky-400` · `border-0`）
- [x] 押せるボタンがすべて同じ背景・白枠なしに見える（Pi5 実機 OK）
- [x] 押せないボタンが保存・完了・再開で同じ弱さ
- [x] `入力を保存` は `saveActionState.enabled` のときだけ青外枠
- [x] `自主検査を完了` は `completeActionState.enabled` のときだけ青外枠
- [x] `再開` は青外枠にならない
- [x] 青外枠の有無でボタンサイズや詰まり方が変わらない（`ring` + shadow · `border` 幅不変）
- [x] 選択中入力件だけ色が変わっていない
- [ ] Pi4 キオスクで強制リロード後目視（**Pi4×4 未デプロイ** — Pi5 OK 後に順次）

### ローカル自動

- `selfInspectionKioskTheme.test.ts` · `SelfInspectionKioskButton.test.tsx`（ページ配線ミラー含む）
- web lint · build OK

### Pi5 バンドル（`docker exec docker-web-1`）

`/srv/site/assets/index-D2jVY8TP.js` に `ring-2 ring-sky-400` · `border-0` · `入力を保存` · `自主検査を完了` を確認（Detach **`20260605-105452-27065`** · HEAD **`ffdaebda`**）。

---

## 8. 本番反映（2026-06-05）

| 項目 | 内容 |
|------|------|
| ブランチ | **`feat/kiosk-self-inspection-button-ui`** → **`main` マージ** |
| 代表コミット | **`f2b374f5`**（ボタンスタイル統一）· **`ffdaebda`**（保存/完了の青外枠） |
| 変更種別 | **Web のみ** |
| CI | **`26990244892`** success（全ジョブ · `security-docker` 含む） |
| Pi5 デプロイ | Detach **`20260605-105452-27065`** · HEAD **`ffdaebda`** · **`failed=0`** · **web** 再ビルド |
| Pi4×4 | **未** — Pi5 実機 OK 後に `--limit` 1 台ずつ + 強制リロード |
| Phase12 | **43/0/0**（約 28s · Tailscale） |

**将来展開**: カラーテーマによる操作誘導（`highlighted` + `enabled` 直結）は他キオスク画面への横展開を別機会で検討（本画面のみスコープ）。

---

## 9. 設計判断・却下した案

| 案 | 判断 | 理由 |
|----|------|------|
| `guided` / `resume_guide` 優先の誘導ハイライト | **却下・削除** | 未依頼実装。業務順序の優先判定を UI に持ち込まない |
| 押下後に青外枠を消す state/hook | **却下** | 操作誘導は活性条件と同期するだけで十分 |
| 補助文言（「次は保存」等） | **却下** | 文言追加なしの合意 |
| 再開・入力件チップへの青外枠 | **却下** | 保存/完了のみが対象 |
| 白枠（`border-slate-500` 等） | **廃止** | 全ボタン `border-0` で統一 |

測定点ガイド（`useSelfInspectionGuidedFocus` 等）は **既存のまま維持**（本改修のスコープ外）。

---

## 10. 参照

- 調査・議論: チャット（自主検査ボタン統一 · 操作誘導合意）
- KB 正本: [KB-320 §ボタンUI統一](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション-ボタンui統一-2026-06-05)
- KB 活性: [KB-320 §セッション操作ボタン活性](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション操作ボタン活性-2026-06-04)
- デプロイ: [deployment §ボタンUI](../guides/deployment.md#kiosk-self-inspection-session-button-ui-2026-06-05)
- Runbook: [§ボタンUI](../runbooks/kiosk-part-measurement.md#自主検査-セッション-ボタンui統一-2026-06-05)
