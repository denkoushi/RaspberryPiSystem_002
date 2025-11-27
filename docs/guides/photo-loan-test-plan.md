---
title: 写真撮影持出機能 テスト計画
tags: [テスト, 写真撮影持出, FR-009, Validation 9]
audience: [開発者, テスター, QA]
last-verified: 2025-11-27
related: [../requirements/system-requirements.md, verification-checklist.md]
category: guides
update-frequency: medium
---

# 写真撮影持出機能 テスト計画

## 概要

写真撮影持出機能（FR-009）のテスト計画です。macでのテスト、CIでのテスト、実機テストの各フェーズで実施するテスト項目を定義します。

## テスト環境

### macでのテスト
- 開発環境（Docker Compose）
- MockCameraDriverを使用（実際のカメラハードウェア不要）

### CIでのテスト
- GitHub Actions
- MockCameraDriverを使用

### 実機テスト
- Raspberry Pi 5（サーバー）
- Raspberry Pi 4（クライアント端末）
- 実際のカメラハードウェア（Raspberry Pi Camera ModuleまたはUSBカメラ）

## テスト項目

### 1. バックエンドAPIテスト

#### 1.1 写真撮影持出API（POST `/api/tools/loans/photo-borrow`）

**テストケース**:
- ✅ 正常系: 従業員タグUIDを指定して撮影＋持出が成功する
- ✅ 正常系: 撮影失敗時のリトライ（3回まで）が動作する
- ✅ 異常系: 存在しない従業員タグUIDを指定した場合、404エラーが返る
- ✅ 異常系: 撮影が3回連続で失敗した場合、500エラーが返る
- ✅ 正常系: クライアントIDが正しく設定される
- ✅ 正常系: Loanレコードに`photoUrl`と`photoTakenAt`が正しく保存される
- ✅ 正常系: `itemId`がNULLで保存される（写真撮影持出ではItem情報を保存しない）

**実装方法**:
```bash
# macでのテスト
cd apps/api
pnpm test src/routes/tools/loans/photo-borrow.test.ts

# CIでのテスト
# .github/workflows/ci.ymlに追加
```

#### 1.2 写真配信API（GET `/api/storage/photos/*`）

**テストケース**:
- ✅ 正常系: 認証済みユーザーが写真を取得できる
- ✅ 異常系: 認証なしでアクセスした場合、401エラーが返る
- ✅ 異常系: 存在しない写真パスを指定した場合、404エラーが返る
- ✅ 正常系: 正しいContent-Type（image/jpeg）が返る

**実装方法**:
```bash
# macでのテスト
cd apps/api
pnpm test src/routes/storage/photos.test.ts
```

#### 1.3 クライアント端末設定更新API（PUT `/clients/:id`）

**テストケース**:
- ✅ 正常系: `defaultMode`を`PHOTO`に更新できる
- ✅ 正常系: `defaultMode`を`TAG`に更新できる
- ✅ 正常系: `defaultMode`を`null`に更新できる（デフォルトに戻す）
- ✅ 異常系: 存在しないクライアントIDを指定した場合、404エラーが返る
- ✅ 異常系: 認証なしでアクセスした場合、401エラーが返る

**実装方法**:
```bash
# macでのテスト
cd apps/api
pnpm test src/routes/clients.test.ts
```

### 2. フロントエンドテスト

#### 2.1 写真撮影持出画面（`/kiosk/photo`）

**テストケース**:
- ✅ 正常系: 従業員タグをスキャンすると撮影＋持出が実行される
- ✅ 正常系: 撮影中の状態が正しく表示される
- ✅ 正常系: 撮影成功時にサムネイルが表示される
- ✅ 正常系: エラー時にエラーメッセージが表示される
- ✅ 正常系: リセットボタンで状態がリセットされる

**実装方法**:
```bash
# macでのテスト
cd apps/web
pnpm test src/pages/kiosk/KioskPhotoBorrowPage.test.tsx

# E2Eテスト（Playwright）
pnpm test:e2e photo-borrow.spec.ts
```

#### 2.2 返却画面の写真サムネイル表示

**テストケース**:
- ✅ 正常系: 写真付きLoanのサムネイルが表示される
- ✅ 正常系: 写真なしLoanは通常通り表示される
- ✅ 正常系: サムネイル読み込みエラー時に非表示になる
- ✅ 正常系: 写真撮影日時が表示される

**実装方法**:
```bash
# macでのテスト
cd apps/web
pnpm test src/pages/kiosk/KioskReturnPage.test.tsx
```

#### 2.3 クライアント端末管理画面

**テストケース**:
- ✅ 正常系: クライアント端末一覧が表示される
- ✅ 正常系: `defaultMode`を編集できる
- ✅ 正常系: 保存後に設定が反映される
- ✅ 正常系: キャンセルボタンで編集がキャンセルされる

**実装方法**:
```bash
# macでのテスト
cd apps/web
pnpm test src/pages/admin/ClientsPage.test.tsx
```

#### 2.4 キオスク画面の初期表示リダイレクト

**テストケース**:
- ✅ 正常系: `defaultMode`が`PHOTO`の場合、`/kiosk/photo`にリダイレクトされる
- ✅ 正常系: `defaultMode`が`TAG`の場合、`/kiosk`にリダイレクトされる
- ✅ 正常系: `defaultMode`が未設定の場合、`/kiosk`にリダイレクトされる（デフォルト）

**実装方法**:
```bash
# macでのテスト
cd apps/web
pnpm test src/components/KioskRedirect.test.tsx
```

### 3. 統合テスト

#### 3.1 写真撮影持出フロー全体

**テストケース**:
- ✅ 正常系: 従業員タグスキャン → 撮影 → 保存 → Loan作成 → 返却画面に表示の一連の流れが動作する
- ✅ 正常系: 複数の写真撮影持出が正しく記録される
- ✅ 正常系: 写真付きLoanと通常のLoanが混在しても正しく表示される

**実装方法**:
```bash
# E2Eテスト（Playwright）
cd apps/web
pnpm test:e2e photo-loan-flow.spec.ts
```

### 4. パフォーマンステスト

#### 4.1 写真撮影のパフォーマンス

**テストケース**:
- ✅ 正常系: 撮影から保存まで3秒以内に完了する
- ✅ 正常系: サムネイル生成が1秒以内に完了する
- ✅ 正常系: リトライを含めても10秒以内に完了する

**実装方法**:
```bash
# macでのテスト
cd apps/api
pnpm test src/services/camera/camera.service.perf.test.ts
```

### 5. 実機テスト

#### 5.1 Raspberry Pi 5での動作確認

**テストケース**:
- ✅ 正常系: Dockerコンテナが正常に起動する
- ✅ 正常系: 写真ディレクトリが正しくマウントされる
- ✅ 正常系: 写真が正しく保存される
- ✅ 正常系: サムネイルが正しく生成される
- ✅ 正常系: Caddyでサムネイルが配信される

**実装方法**:
```bash
# 実機で実行
cd /opt/RaspberryPiSystem_002
./scripts/server/deploy.sh feature/photo-loan-camera

# 動作確認
curl http://localhost:8080/api/system/health
curl http://localhost:4173/storage/thumbnails/2025/11/test_thumb.jpg
```

#### 5.2 Raspberry Pi 4での動作確認

**テストケース**:
- ✅ 正常系: キオスク画面が正常に表示される
- ✅ 正常系: 従業員タグスキャンで撮影＋持出が動作する
- ✅ 正常系: 返却画面に写真サムネイルが表示される
- ✅ 正常系: クライアント端末設定に応じて初期表示が切り替わる

**実装方法**:
```bash
# 実機で実行
# ブラウザで http://raspberry-pi-5:4173 にアクセス
# 従業員タグをスキャンして動作確認
```

### 6. 運用テスト

#### 6.1 写真自動削除機能

**テストケース**:
- ✅ 正常系: 1月以外の月では削除処理がスキップされる
- ✅ 正常系: 1月中に2年前の写真が削除される
- ✅ 正常系: cronジョブで正しく実行される

**実装方法**:
```bash
# macでのテスト（日付を変更してテスト）
TZ=Asia/Tokyo date -s "2027-01-15 02:00:00"
./scripts/server/cleanup-photos.sh

# 実機でのcron設定
# crontab -e
# 0 2 * * * /opt/RaspberryPiSystem_002/scripts/server/cleanup-photos.sh >> /var/log/photo-cleanup.log 2>&1
```

#### 6.2 バックアップスクリプト

**テストケース**:
- ✅ 正常系: 写真ディレクトリがバックアップに含まれる
- ✅ 正常系: バックアップファイルが正しく作成される
- ✅ 正常系: バックアップファイルから復元できる

**実装方法**:
```bash
# macでのテスト
./scripts/server/backup.sh
ls -lh /opt/backups/photos_backup_*.tar.gz

# 復元テスト
tar -xzf /opt/backups/photos_backup_YYYYMMDD_HHMMSS.tar.gz -C /tmp/test-restore
```

## テスト実行順序とベストプラクティス

### 推奨アプローチ: 部分機能ごとに進める

**ベストプラクティス**: 部分機能ごとに、macテスト → CIテスト → 実機テストの順で進める

#### 基本フロー

```
機能実装 → macテスト → CIテスト → 実機テスト
```

#### 部分機能ごとの進め方（推奨）

**例**: 写真撮影持出機能の場合

1. **部分機能1: バックエンドAPI**
   - macテスト: 統合テストを実装・実行 ✅ 完了
   - CIテスト: GitHub Actionsで自動実行 ✅ 完了
   - 実機テスト: Raspberry Pi 5でAPI動作確認 ⏳ 次のステップ

2. **部分機能2: フロントエンドUI**
   - macテスト: コンポーネントテスト、E2Eテスト ⏳ 未実装
   - CIテスト: GitHub Actionsで自動実行 ⏳ 未実装
   - 実機テスト: Raspberry Pi 4でUI動作確認 ⏳ 未実施

3. **部分機能3: 統合フロー**
   - macテスト: E2Eテストで全体フローを検証 ⏳ 未実装
   - CIテスト: GitHub Actionsで自動実行 ⏳ 未実装
   - 実機テスト: Raspberry Pi 5とRaspberry Pi 4で統合動作確認 ⏳ 未実施

#### 理由

1. **早期フィードバック**: 問題を早期に発見できる
2. **リスクの最小化**: 小さな単位で検証することで、大きな問題を回避できる
3. **効率的な開発**: 一度にすべてをテストするよりも、段階的に進める方が効率的

### テスト実行のタイミング

1. **macでのテスト**: 単体テスト、統合テスト、E2Eテストを実行
   - **タイミング**: 機能実装直後、コミット前
   - **目的**: ローカル環境での動作確認、早期のバグ発見
   - **実行頻度**: 機能実装ごと、または1日1回以上

2. **CIでのテスト**: GitHub Actionsで自動テストを実行
   - **タイミング**: プッシュ時、プルリクエスト作成時
   - **目的**: 自動化されたテストで回帰を防ぐ、コード品質の維持
   - **実行頻度**: すべてのコミット

3. **実機テスト**: Raspberry Pi 5とRaspberry Pi 4で動作確認
   - **タイミング**: CIテスト成功後、マージ前
   - **目的**: 実際のハードウェア環境での動作確認
   - **実行頻度**: 機能完成時、マージ前

### テスト実装の優先順位

すべてのテストを一度に実装するのではなく、**優先順位をつけて段階的に実装**します：

#### 優先度1: 必須テスト（実装必須）
- **統合テスト**: APIエンドポイントの動作確認 ✅ 完了
- **CIテスト**: 自動化されたテストで回帰を防ぐ ✅ 完了
- **実機テスト（基本動作）**: 実際のハードウェアでの基本動作確認 ⏳ 次のステップ

#### 優先度2: 推奨テスト（実装推奨）
- **単体テスト**: 複雑なロジックの検証 ⏳ 未実装
- **E2Eテスト**: ユーザーシナリオの検証 ⏳ 未実装
- **実機テスト（詳細）**: エッジケースやパフォーマンスの確認 ⏳ 未実施

#### 優先度3: オプショナルテスト（実装任意）
- **パフォーマンステスト**: 負荷テスト、ストレステスト ⏳ 未実装
- **セキュリティテスト**: 脆弱性スキャン ⏳ 未実装
- **運用テスト**: 長期運用の検証 ⏳ 未実施

### 現在の実装状況

- ✅ **統合テスト**: 3件（photo-borrow, photo-storage, clients）
- ⏳ **単体テスト**: 0件（未実装）
- ⏳ **E2Eテスト**: 0件（未実装）
- ⏳ **実機テスト**: 未実施

**注意**: テスト計画表の✅マークは「**テストケースが定義されている**」ことを示しており、「**テストが実装済み**」や「**テストが通過済み**」を意味するものではありません。

## テスト結果の記録

テスト結果は以下の場所に記録します：
- 単体テスト: `apps/api/coverage/`, `apps/web/coverage/`
- E2Eテスト: `apps/web/test-results/`
- 実機テスト: `docs/guides/verification-checklist.md`のValidation 9に記録

## 関連ドキュメント

- [システム要件定義](../requirements/system-requirements.md): FR-009（写真撮影持出機能）
- [検証チェックリスト](verification-checklist.md): Validation 9（写真撮影持出）
- [モジュール仕様書](../modules/tools/photo-loan.md): 写真撮影持出機能の詳細仕様

