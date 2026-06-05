# キオスク自主検査セッション — ボタンUI要件

**Status**: 実装中（`feat/kiosk-self-inspection-button-ui`）  
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

- [ ] プレビュー HTML と本番のクラスが対応している
- [ ] 押せるボタンがすべて同じ背景・白枠なしに見える
- [ ] 押せないボタンが保存・完了・再開で同じ弱さ
- [ ] `入力を保存` は `saveActionState.enabled` のときだけ青外枠
- [ ] `自主検査を完了` は `completeActionState.enabled` のときだけ青外枠
- [ ] `再開` は青外枠にならない
- [ ] 青外枠の有無でボタンサイズや詰まり方が変わらない
- [ ] 選択中入力件だけ色が変わっていない
- [ ] Pi4 キオスクで強制リロード後目視

---

## 8. 参照

- 調査・議論: チャット（自主検査ボタン統一）
- KB 活性: [KB-320 §セッション操作ボタン活性](../knowledge-base/KB-320-kiosk-part-measurement.md#自主検査-セッション操作ボタン活性-2026-06-04)
