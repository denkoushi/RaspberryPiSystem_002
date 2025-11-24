# CI環境でのE2Eテスト安定化のベストプラクティス

## 問題の分類

### 1. 環境の違いによる問題（ある程度は普通）

- **CI環境はクリーンな状態から始まる**
  - ローカルにはキャッシュや既存データがあるが、CIにはない
  - 初回セットアップに時間がかかる

- **ネットワーク遅延やリソース制限**
  - CI環境は共有リソースを使用するため、パフォーマンスが不安定
  - ネットワーク遅延が発生しやすい

- **タイミングの違い**
  - 非同期処理の実行順序が異なる可能性
  - ブラウザのレンダリングタイミングが異なる

### 2. コーディング上の配慮不足（修正すべき）

- **タイミング依存のテスト**
  - 適切な待機処理がない
  - Reactの状態更新の非同期性を考慮していない

- **非決定的なテスト**
  - ランダム性に依存している
  - 実行順序に依存している

- **環境変数の設定漏れ**
  - CI環境で必要な環境変数が設定されていない

## 今回のケースの分析

### 問題
ログイン成功後のリダイレクトがCIで失敗していた

### 真因
- `login`関数で`setUser(response.user)`を呼んでも、Reactの状態更新は非同期
- `LoginPage`の`handleSubmit`で`await login(...)`直後に`navigate(from)`を実行
- `/admin`に遷移しても、`RequireAuth`のレンダリング時点で`user`がまだ`null`
- `RequireAuth`が`if (!user)`で`<Navigate to="/login" />`を返す

### 解決策
- `LoginPage`で`useEffect`を使って`user`の更新を監視
- `user`が設定されたら自動的にナビゲートするように修正

## CIで安定させるためのベストプラクティス

### 1. 適切な待機処理を使用

```typescript
// ❌ 悪い例：固定の待機時間
await page.waitForTimeout(1000);

// ✅ 良い例：要素の出現を待つ
await expect(page.getByRole('button', { name: /ログイン/i })).toBeVisible();

// ✅ 良い例：URLの変更を待つ
await page.waitForURL(/\/admin/, { timeout: 10000 });

// ✅ 良い例：ネットワークアイドルを待つ
await page.waitForLoadState('networkidle');
```

### 2. Reactの状態更新を考慮する

```typescript
// ❌ 悪い例：状態更新を待たずにナビゲート
await login(username, password);
navigate('/admin'); // userがまだnullの可能性

// ✅ 良い例：useEffectで状態更新を監視
useEffect(() => {
  if (user) {
    navigate('/admin');
  }
}, [user, navigate]);
```

### 3. タイムアウトを適切に設定

```typescript
// CI環境では遅延が発生しやすいため、タイムアウトを長めに設定
await expect(page.getByText(/ダッシュボード/i)).toBeVisible({ timeout: 10000 });
```

### 4. アサーションを明確にする

```typescript
// ❌ 悪い例：曖昧なアサーション
await page.waitForSelector('.some-class');

// ✅ 良い例：明確なアサーション
await expect(page.getByRole('heading', { name: /ダッシュボード/i })).toBeVisible();
```

### 5. テストの独立性を保つ

```typescript
// ❌ 悪い例：他のテストに依存
test('テスト2', async ({ page }) => {
  // テスト1で作成したデータに依存している
});

// ✅ 良い例：各テストが独立している
test.beforeEach(async ({ page }) => {
  // 必要なデータをセットアップ
});
```

### 6. エラーハンドリングを適切に行う

```typescript
// ✅ 良い例：エラーを適切に処理
try {
  await login(username, password);
} catch (err) {
  // エラーメッセージを適切に表示
  setError(err.message);
}
```

## チェックリスト

CIでテストが安定するように、以下を確認：

- [ ] 適切な待機処理を使用しているか
- [ ] Reactの状態更新の非同期性を考慮しているか
- [ ] タイムアウトを適切に設定しているか
- [ ] アサーションが明確か
- [ ] テストが独立しているか
- [ ] 環境変数が適切に設定されているか
- [ ] エラーハンドリングが適切か

## まとめ

**ローカルで通るがCIで通らない場合**：
- 環境の違いによる問題もあるが、多くの場合は**コーディング上の配慮不足**
- 特に**タイミング依存の問題**が多い
- Reactの状態更新の非同期性を考慮することが重要

