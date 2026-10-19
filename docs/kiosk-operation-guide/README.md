---
title: キオスク操作ガイド(現場向け)の書き方
tags: [kiosk, operation-guide, business-hermes, chat]
audience: [developers, ai-agent]
last-verified: 2026-10-14
related: [../plans/kiosk-chat-system-guide-execplan.md, ../runbooks/kiosk-inquiry-inbox.md]
category: guides
---

# キオスク操作ガイド(現場向け)の書き方

このフォルダは、現場端末(キオスク、`/kiosk` 配下の画面)の操作を現場の人の言葉で説明する文書の正本です。フローティング Chat の案内役(業務 Hermes)が、操作の問い合わせにここから答えます(計画: [ExecPlan](../plans/kiosk-chat-system-guide-execplan.md))。読者は現場の作業者で、開発者ではありません。

## 置き場所と単位

- 画面ごとに 1 ファイル。関連するルート(編集画面、印刷画面など)は同じファイルの `routes` にまとめる。
- 画面をまたぐ基本操作と困りごとは `common/` に置き、`routes: []` にする。
- 管理コンソール(`/admin`)とサーバー操作は対象外。

## 形(検査で強制される)

frontmatter は 1 行ずつ、リストは `[a, b]` のインライン形式で書く。

```
---
title: 画面名(画面に出ている表記)
routes: [/kiosk/xxx, /kiosk/xxx/:id/edit]
keywords: [現場の言い回し 3 語以上]
audience: [operators]
category: kiosk-operation-guide
last-verified: YYYY-MM-DD
---
```

本文の見出しは次の 4 つをこの順で置く(`common/` は 2 つ以上で自由)。

1. `## この画面でできること`
2. `## 基本の手順`
3. `## よくある困りごととその場の対処`
4. `## それでも直らないとき`(画面右下の丸いボタン → 「お問い合わせ」から送る、端末名を添える)

## 書き方の約束

- 画面に実際に出ている文字列(ボタン名、見出し、エラー文)だけを「」で引く。根拠は `apps/web/src/pages/kiosk/` と、そこから使う機能部品のソース。
- コードに無い機能や推測した振る舞いは書かない。分からないことは省く。
- 内部名(コンポーネント名、API 名、環境変数)は書かない。
- 画面を変える PR では、同じ PR でこのフォルダの該当文書を直し、`last-verified` を更新する。

## 検査

```bash
node scripts/docs/check-kiosk-operation-guide.mjs
```

`apps/web/src/App.tsx` の `/kiosk` 配下の全ルート(転送だけのルートを除く)に文書があること、文書の `routes` が実在すること、frontmatter と見出しの形を確かめる。CI の `repo-policy` ジョブで毎回動く。
