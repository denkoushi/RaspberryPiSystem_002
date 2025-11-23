# ADR 001: モジュール構造の決定

## 状況

機能拡張時に、1つのファイルに機能が集まりすぎる懸念があった。特に、ルートハンドラーとサービス層のファイルが大きくなり、保守性が低下する可能性があった。

## 決定

ルートとサービス層を機能ごとのサブディレクトリに分割する構造を採用する。

## 構造

### ルート構造

```
routes/tools/
  ├── employees/
  │   ├── index.ts          # ルート登録
  │   ├── list.ts           # GET /employees
  │   ├── get.ts            # GET /employees/:id
  │   ├── create.ts         # POST /employees
  │   ├── update.ts         # PUT /employees/:id
  │   ├── delete.ts         # DELETE /employees/:id
  │   └── schemas.ts        # バリデーションスキーマ
  ├── loans/
  │   ├── index.ts          # ルート登録
  │   ├── borrow.ts         # POST /borrow
  │   ├── return.ts         # POST /return
  │   ├── active.ts         # GET /loans/active
  │   └── schemas.ts        # バリデーションスキーマ
  └── ...
```

### サービス層構造

```
services/tools/
  ├── employees/
  │   ├── index.ts          # EmployeeService エクスポート
  │   └── employee.service.ts
  ├── loans/
  │   ├── index.ts
  │   ├── loan.service.ts
  │   ├── borrow.service.ts  # 持出処理専用（将来分割可能）
  │   └── return.service.ts  # 返却処理専用（将来分割可能）
  └── ...
```

## 理由

1. **ファイルサイズの抑制**: 1ファイルあたり50-100行程度に収まり、可読性が向上
2. **責務の明確化**: ファイル名で機能が明確になり、目的が分かりやすい
3. **テスト容易性**: 機能単位でテスト可能になり、モック化が容易
4. **並行開発**: ファイル単位でコンフリクトを回避しやすくなる

## 影響

- **新規モジュール**: documents, logisticsモジュールはこの構造で実装
- **既存モジュール**: toolsモジュールは段階的に移行（機能追加時に分割）
- **後方互換性**: 既存のAPIパスは維持されるため、クライアントへの影響なし

## 実装方針

1. **Phase 1**: 新規モジュールから適用 ✅ 完了（documentsモジュールのテンプレート作成）
2. **Phase 2**: 既存モジュールを段階的に移行 ✅ 完了（toolsモジュールの分割完了）
3. **Phase 3**: 共通機能の抽出（バリデーションスキーマ、認証ミドルウェア）- 将来実装

## 実装完了

- **toolsモジュール**: 全リソース（employees, items, loans, transactions）を機能ごとのサブディレクトリ構造に分割完了
- **バリデーションスキーマ**: 各サブディレクトリの`schemas.ts`に分離完了
- **後方互換性**: 既存のAPIパスは維持され、クライアントへの影響なし

## 日付

2025-01-XX（決定）、2025-01-XX（実装完了）

