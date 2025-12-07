---
name: Lint導入計画
overview: 全コードをlint適合させ、CIが安定して連続成功する状態を作る。将来の統合・拡張に耐える秩序あるコードベースを維持する。
todos:
  - id: phase1-ci-integration
    content: "Phase 1: CI lintステップ追加・VSCode推奨設定"
    status: completed
  - id: phase1-test
    content: "Phase 1: CI統合テスト（CI-001〜003）"
    status: completed
    dependencies:
      - phase1-ci-integration
  - id: phase2-fix-unused
    content: "Phase 2: 未使用削除（warning群）"
    status: completed
    dependencies:
      - phase1-test
  - id: phase2-fix-any
    content: "Phase 2: any除去と型付け（error群）"
    status: completed
    dependencies:
      - phase1-test
  - id: phase2-fix-hooks
    content: "Phase 2: Hooks依存修正"
    status: completed
    dependencies:
      - phase1-test
  - id: phase2-test
    content: "Phase 2: ローカルでlint/build/test/E2E確認（--max-warnings=0）"
    status: completed
    dependencies:
      - phase2-fix-unused
      - phase2-fix-any
      - phase2-fix-hooks
  - id: phase3-rules
    content: "Phase 3: ルール強化を1つずつ試験導入"
    status: completed
    dependencies:
      - phase2-test
  - id: phase3-test
    content: "Phase 3: 新規コードで厳格ルール確認"
    status: completed
    dependencies:
      - phase3-rules
  - id: documentation
    content: README追記と必要ならlintガイド最小作成
    status: completed
    dependencies:
      - phase3-test
  - id: phase4-e2e-smoke-create
    content: "Phase 4a: E2Eスモークテスト作成"
    status: completed
    dependencies:
      - documentation
  - id: phase5-ci-lint-strict
    content: "Phase 5: CI lint基準を--max-warnings=0に変更"
    status: completed
    dependencies:
      - phase4-e2e-smoke-create
  - id: phase6-ci-continuous-success
    content: "Phase 6: CIが3回以上連続成功することを確認"
    status: completed
    dependencies:
      - phase5-ci-lint-strict
  - id: phase7-arch-lint
    content: "Phase 7: モジュール統合のlint強化（shared-types厳格・import/depルール）"
    status: pending
    dependencies:
      - phase6-ci-continuous-success
  - id: phase8-contract-tests
    content: "Phase 8: モジュール間契約テストと依存検証（API/Web）"
    status: pending
    dependencies:
      - phase7-arch-lint
  - id: phase9-knowledge-sharing
    content: "Phase 9: 進捗管理とナレッジ共有（docs/guides等更新）"
    status: pending
    dependencies:
      - phase8-contract-tests
---

# Lint導入計画

## 1. 方針とゴール（理想状態）

- **目的**: 全コードをlint適合させ、CIが安定して連続成功する状態を作る。将来の統合・拡張に耐える秩序あるコードベースを維持する。
- **最終ゴール**:
  1. 全コード（apps/api, apps/web）が`pnpm lint --max-warnings=0`で通る
  2. CIの`lint-and-test`ジョブで`--max-warnings=0`が通る
  3. CIの`e2e-smoke`ジョブが安定して連続成功する（3回以上）
  4. CIが安定して通ることで、PRマージ前にコード品質と動作の両方を担保できる

## 2. 現状と課題（2025-12-07時点）

### 達成済み
- ローカル: `pnpm lint --max-warnings=0`で全コード（apps/api, apps/web）が通る
- 既存指摘（20件）は全て解消済み
- E2Eスモークテストは作成済み
- CIにlint, e2e-smokeジョブが追加済み
- **CI lint基準**: `--max-warnings=0`に変更済み（Phase 5完了）
- **CI連続成功**: 3回連続成功を確認（Phase 6完了）

### 理想状態到達 ✅
- Phase 6が完了した時点で「全コードがlint適合し、CIが安定して連続成功する状態」に到達したと判定する

## 3. 導入ステップ（過不足を整理）

### Phase 1（最小導入・CI統合）

- 追加: CIにlintステップ（`pnpm lint --max-warnings=20`）、VS Code推奨拡張（ESLint/Prettier）
- 変更: 既存ルールは維持。error→warningへの一括緩和はしない（`--max-warnings`で吸収）
- 成功基準: CIにlintステップが追加されたこと、ローカルで`pnpm lint --max-warnings=20`がexit 0で完了する（lint時間30秒以内）

**実施完了** (2025-01-06, commit: a8e3c8a):
- `.github/workflows/ci.yml`にlintステップ追加（`pnpm lint --max-warnings=20`）
- `.vscode/extensions.json`作成（ESLint/Prettier推奨）
- CI-001〜003のテスト完了（lint実行・検出確認・max-warnings動作確認）

### Phase 2（既存指摘の解消）

- 順序: ①未使用削除（12件） ②`any`除去と型付け（8件） ③Hooks依存修正
- `--max-warnings`: 20→10→0で段階的に下げる
- 成功基準: ローカルで`pnpm lint --max-warnings=0`がexit 0で完了する、build/test/E2Eがローカルで通る

**実施完了** (2025-01-06, commit: a8e3c8a):
- 未使用変数・インポート削除（12件）: `apps/web/src/api/client.ts`, `apps/web/src/api/hooks.ts`, `apps/web/src/features/kiosk/borrowMachine.ts`, `apps/web/src/pages/admin/ClientsPage.tsx`, `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`, `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`, `apps/api/src/lib/photo-storage.ts`, `apps/api/src/routes/clients.ts`, `apps/api/src/routes/documents/index.ts`, `apps/api/src/routes/imports.ts`, `apps/api/src/routes/signage/pdfs.ts`, `apps/api/src/routes/storage/pdf-pages.ts`, `apps/api/src/routes/tools/employees/get.ts`, `apps/api/src/routes/tools/loans/active.ts`, `apps/api/src/services/signage/signage-render-scheduler.ts`, `apps/api/src/services/signage/signage.renderer.ts`, `apps/api/src/services/signage/signage.service.ts`
- `any`型の型定義追加（8件）: `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`, `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`, `apps/web/src/pages/tools/EmployeesPage.tsx`, `apps/web/src/pages/tools/HistoryPage.tsx`
- React Hooks依存関係修正: `apps/web/src/pages/admin/ClientsPage.tsx`, `apps/web/src/pages/kiosk/KioskBorrowPage.tsx`, `apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`
- `pnpm lint --max-warnings=0`で通過確認、build/test/E2E通過確認

### Phase 3（ルール強化・新規コード厳格化）

- 試験導入: `@typescript-eslint/recommended-type-checked`, `eslint-plugin-security`, `eslint-plugin-import` を1つずつ評価
- 適用方針: 新規コードに厳格適用、既存は必要箇所のみ`eslint-disable`で隔離
- 成功基準: 新規コードでエラー0、既存への副作用なし

**実施完了** (2025-01-06, commit: bfdfb53):
- `recommended-type-checked`, `security`, `import`プラグインを評価した結果、効果が不明確なため導入を見送り
- 既存ルール（型安全性・未使用コード・Hooks依存）で十分と判断
- `docs/guides/lint.md`に方針を記録（過剰厳格化を避け、基本規律を維持）

### Phase 4a（E2Eスモークテスト作成）

**目的**: CI環境でE2Eテストを安定して実行できるようにし、PRマージ前に基本的なUI動作を確認できるようにする。

**実施完了** (2025-12-07):
- `e2e/smoke/kiosk-smoke.spec.ts`作成（E2E-SMOKE-001〜003を実装）
- `package.json`に`test:e2e:smoke`スクリプト追加
- `.github/workflows/ci.yml`に`e2e-smoke`ジョブ追加（必須）
- PostgreSQL起動、Prisma generate/migrate/seed、Vite proxy設定、client-keyシードを追加
- CIで1回成功を確認（commit: 1cb83d4）

### Phase 5（CI lint基準を--max-warnings=0に変更）

**目的**: ローカルとCIのlint基準を統一し、全コードがlint適合していることをCIで保証する。

**実施内容**:
- `.github/workflows/ci.yml`の`pnpm lint --max-warnings=20`を`--max-warnings=0`に変更
- CIを実行し、lintジョブが成功することを確認

**実施完了** (2025-12-07):
- `.github/workflows/ci.yml`のlint基準を`--max-warnings=0`に変更
- CI `lint-and-test`ジョブで`pnpm lint --max-warnings=0`が成功することを確認

### Phase 6（CI連続成功の確認）

**目的**: CIが安定して通ることを確認し、理想状態に到達したことを証明する。

**実施内容**:
- Phase 5完了後、CIを3回以上実行
- 全て成功することを確認

**実施完了** (2025-12-07):
- `lint-and-test`ジョブが3回連続成功
- `e2e-smoke`ジョブが3回連続成功
- `docker-build`ジョブが3回連続成功

**理想状態到達の判定**:
- Phase 6が完了した時点で「全コードがlint適合し、CIが安定して連続成功する状態」に到達したと判定する ✅

### Phase 7（モジュール統合のlint強化）【実施中】

**目的**: モジュール化された機能同士の統合で衝突や依存崩れを防ぐため、lintで境界と依存を強化する。

**タスク**:
1. shared-typesへのlint導入  
   - `packages/shared-types/package.json` に `lint: "eslint . --ext .ts"` を追加  
   - ルートlintで shared-types を実行するか、pnpm -r lint で拾えるようにする
2. 依存・循環検出の強化  
   - `eslint-plugin-import` の `import/order` と `no-cycle` を有効化（API/Web 共通設定）  
   - 境界ルールを `import/no-restricted-paths` で設定（API→Web 逆参照禁止など）
3. 型厳格化の段階導入  
   - `@typescript-eslint/recommended-type-checked` を shared-types と API services に限定導入  
   - 影響を見ながら Web hooks/queries へ拡大
4. CI確認  
   - `pnpm lint --max-warnings=0` が全パッケージで成功することをCIで確認

**成功基準**:
- shared-types を含む全ワークスペースで `pnpm lint --max-warnings=0` が成功
- 循環依存が0件であることを確認
- 既存コードへの副作用が許容範囲（必要箇所のみ局所的な disable に限定）
**実施状況** (2025-12-07):
- ✅ `packages/shared-types` に lint 導入（lintスクリプト追加、.eslintrc.cjs で import/order・no-cycle、dist除外）
- ✅ `pnpm lint --max-warnings=0` を全パッケージ（API/Web/shared-types）でローカル実行し成功を確認
- ✅ import拡張子付き参照を修正し、循環依存・未解決importエラーを解消
- ✅ 循環依存0件を確認（API/Web ともに `import/no-cycle` エラー0件）
- ⏳ CI確認待ち（コミット・プッシュ後にCIで成功を確認）

### Phase 8（モジュール間契約テストと依存検証）【実施中】

**目的**: API/Web 間の契約ずれや依存崩れを早期検知し、統合を安全にする。

**タスク**:
1. 契約テストの追加  
   - API: shared-types に基づくレスポンス型整合テストを追加（型/キーのスナップショット or zod一致）  
   - Web: APIクライアントの型整合チェックを追加（shared-types と DTO の差分検出）
2. 依存・互換性チェック  
   - API公開インターフェースの破壊的変更を検知する型差分チェックをスクリプト化
3. E2Eスモーク拡張  
   - `e2e/smoke` に契約整合性チェックを1ケース追加（基本レスポンスのキー/型の存在確認）
4. CI組み込み  
   - 1〜3のテストをCIに組み込み、安定通過を確認（少なくとも1回成功）

**成功基準**:
- 契約テストが CI で成功し、破壊的変更を検知できる体制になる
- E2E スモークに契約チェックを追加後も安定して通る

### Phase 9（進捗管理とナレッジ共有）【これから】

**目的**: 今後の拡張やモジュール統合の知見を共有し、維持管理の負荷を下げる。

**タスク**:
1. ガイド更新  
   - `docs/guides/lint.md` に新ルール（import/order, no-cycle, 境界ルール、type-checked導入範囲）と例外ポリシーを反映  
   - CIトラブルシュートガイドに新しいチェックポイントを追加
2. 進捗と指標の共有  
   - CI安定性（連続成功回数など）の指標を記録し、今後の拡張指針を追記  
   - 追加予定のルール（セキュリティ系、import解決強化、循環検知の拡張）を段階計画として明記
3. 参照性の確保  
   - 主要ガイドへの導線を `docs/INDEX.md` に追記し、参照しやすくする

**成功基準**:
- lintガイド/CIトラブルシュートガイドに新ルールと運用手順が反映される
- チームが参照しやすい場所（docs/ 配下）に集約されている

## 4. テスト項目と明確な基準

### CI統合

- CI-001: CIにlintステップが追加されたこと、ローカルで`pnpm lint --max-warnings=20`がexit 0（30秒以内）
- CI-002: ローカルで既存指摘が20件検出（8 error/12 warn）
- CI-003: ローカルで`--max-warnings`閾値超過でfailすることを確認

### 修正フェーズ

- FIX-001: 未使用削除 → warning減少、ローカルでbuild/test/E2E通過
- FIX-002: `any`除去 → error減少、ローカルで`tsc --noEmit`通過
- FIX-003: Hooks依存修正 → warning減少、無限ループ/古い値なし（ローカルE2E通過）
- PHASE-2-OK: ローカルで`--max-warnings=0`でlint/build/test/E2E成功

### ルール強化

- RULE-TRY-1: `recommended-type-checked`試験導入 → 評価完了、効果不明確のため見送り
- RULE-TRY-2: `security`/`import`プラグインは効果を見て採否判断 → 評価完了、効果不明確のため見送り

### E2Eスモークテスト

- E2E-SMOKE-001: キオスク持出画面の基本表示確認 → 「キオスク端末」テキスト、ナビゲーションリンク（持出・返却）が表示される
- E2E-SMOKE-002: キオスク返却画面の基本表示確認 → 「キオスク端末」テキスト、ナビゲーションリンク（返却）が表示される
- E2E-SMOKE-003: ナビゲーション動作確認 → 持出↔返却の切り替えが正常に動作し、URLが正しく遷移する
- E2E-SMOKE-004: ローカル環境での実行確認 → ローカルで`pnpm test:e2e:smoke`がexit 0で完了し、実行時間が30秒以内

**成功基準**:
- E2E-SMOKE-001: `page.getByText(/キオスク端末/i)`が表示される、`page.getByRole('link', { name: /持出/i })`と`page.getByRole('link', { name: /返却/i })`が表示される
- E2E-SMOKE-002: `page.getByText(/キオスク端末/i)`が表示される、`page.getByRole('link', { name: /返却/i })`が表示される
- E2E-SMOKE-003: 返却リンククリック後、`page.url()`が`/kiosk/return`を含む、持出リンククリック後、`page.url()`が`/kiosk`で終わる
- E2E-SMOKE-004: ローカルで`pnpm test:e2e:smoke`がexit 0で完了、実行時間が30秒以内

**失敗基準**:
- 要素が見つからない（タイムアウト5秒以内に表示されない）
- ナビゲーションが動作しない（クリック後、URLが期待通りに遷移しない）
- ローカルでexit 1で失敗する
- 実行時間が30秒を超える

## 5. リスクと抑制

- CI失敗: `--max-warnings`で初期吸収、段階的にゼロ化
- 工数増: 型付けはスコープ限定＆小PRで進める
- 過剰厳格化: 追加ルールは1つずつABテストし、不要なら撤回
- 実行時間: lint 30秒以内を目安。超過時は対象ディレクトリを絞る

## 6. ドキュメント（最小限）

- `README.md`: lint実行方法（`pnpm lint`, `pnpm lint --fix`）を追記
- `.vscode/extensions.json`: ESLint/Prettier推奨
- `docs/guides/lint.md`: lint運用ガイド作成済み

## 7. ブランチとタスク

- ブランチ: `feature/lint-integration`
- Phase1: CI lintステップ追加 + VS Code推奨
- Phase2: 未使用→any→Hooksの順で修正し、`--max-warnings`をゼロ化
- Phase3: ルール強化は1つずつ試験導入
- Phase4a: E2Eスモークテスト作成
- Phase5: CI lint基準を`--max-warnings=0`に変更
- Phase6: CI 3回連続成功を確認

## 8. 効果/リスクの要約

- 効用: 未使用削除で可読性とバンドル削減、any除去で型安全、Hooks依存修正で無限ループ/古い値バグ防止、E2EスモークテストでCI活用と基本的なUI動作の継続確認
- リスク: CI落ち・工数増・過剰厳格化・E2E不安定化 → 段階導入、閾値管理、1ルールずつ試験導入、軽量スモークテストで抑制

