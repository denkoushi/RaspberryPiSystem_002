---
title: Location Scope 命名規約ガイド
tags: [location-scope, 命名規約, production-schedule, due-management]
audience: [開発者, 運用者]
last-verified: 2026-03-16
related: [deployment.md, ../runbooks/deploy-status-recovery.md, ../knowledge-base/KB-297-kiosk-due-management-workflow.md]
category: guides
update-frequency: medium
---

# Location Scope 命名規約ガイド

最終更新: 2026-03-16（Phase13 安全リファクタ追記）

## 目的

`location` が複数の意味を持って再混在しないよう、`site/device/infraHost` の用語を固定する。

## 用語定義（正規）

| 用語 | 意味 | 代表例 | 主な利用層 |
|------|------|--------|------------|
| `siteKey` | 拠点共通スコープキー | `第2工場` | 拠点共通設定（resource category等） |
| `deviceScopeKey` | 端末単位スコープキー | `第2工場 - kensakuMain` | キオスク操作・端末単位状態 |
| `infraHost` | インフラ接続先/ホスト識別 | `raspberrypi4` | デプロイ/接続/運用 |
| `actorLocation` | 操作者端末の表示用ロケーション | `第2工場 - kensakuMain` | APIレスポンス（閲覧/説明） |
| `targetLocation` | 操作対象の表示用ロケーション | `第2工場` | global-rank等の対象指定 |

## 命名ルール

1. **境界入力は意味を分離して受ける**
- ルート/サービス間の公開入力は `siteKey` と `deviceScopeKey` を明示し、`location` 単語だけの入力を増やさない。

2. **互換入力は公開境界に出さない**
- 互換変換（legacy形式）は adapter/private ヘルパーへ閉じ込める。
- 新規公開型に `legacy*` プロパティを追加しない。

3. **旧契約名が残る箇所は橋渡し名を使う**
- 既存サービス契約が `locationKey` を要求する場合、ルート側ローカル変数は `deviceScopeKey` とし、呼び出し時に `locationKey: deviceScopeKey` と明示する。

4. **表示用フィールドと保存用キーを混同しない**
- APIレスポンスの `targetLocation` / `actorLocation` は表示用。
- 永続化・検索条件は `siteKey` / `deviceScopeKey` を使う。

5. **旧契約への橋渡しは境界ヘルパーに限定する**
- `locationKey` を要求する既存契約へは、ルート境界の `toLegacyLocationKeyFromDeviceScope()` を通して橋渡しする。
- 機能実装側で `deviceScopeKey -> locationKey` の再変換を増やさない。

## 実装パターン

### 推奨

```ts
const locationScopeContext = resolveLocationScopeContext(clientDevice);
const deviceScopeKey = locationScopeContext.deviceScopeKey;
return updateSomething({ locationKey: deviceScopeKey });
```

### 非推奨

```ts
const locationKey = resolveLocationKey(clientDevice);
return updateSomething({ locationKey });
```

## 運用チェック

- 実機検証時は `./scripts/deploy/verify-phase12-real.sh` を使い、`global-rank` と fallback監視を含めて確認する。
- `Due management auto-tuning scheduler` ログが見つからない場合は、`PUT /global-rank/auto-generate` の `200` を代替正常判定にする（ログローテーション考慮）。

## 関連

- [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)
- [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md)
- [EXEC_PLAN.md](../../EXEC_PLAN.md)
