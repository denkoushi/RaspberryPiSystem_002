# キオスク: 部品測定記録（part-measurement）

## 目的

移動票のバーコードと生産スケジュールを参照し、品番・工程（切削/研削）に紐づく測定テンプレートに沿って値を入力し、下書き保存ののち確定する。

## 前提

- API・DB に `part-measurement` マイグレーションが適用済みであること（デプロイ手順は [deployment.md](../guides/deployment.md)）。
- キオスク端末に有効な `x-client-key`（ClientDevice）が設定されていること。
- テンプレートは **品番 × 工程 × 資源CD** ごとに有効版が1つあること（未登録時はキオスクのテンプレ作成、または管理コンソール `/admin/tools/part-measurement-templates` から登録可能）。
- **図面付きテンプレート**（任意）: **visual template** に図面画像1枚を登録し、業務テンプレートから参照する。FIHNCD に紐づけず再利用できる。表面/裏面などは **資源CDが異なる業務テンプレ** に、別 visual を割り当てる。図面上の番号は項目の **図番号（表示用）** に入力する。

## オペレータ手順（キオスク）

1. **推奨**: 生産スケジュール（または手動順番の下ペイン一覧）の行の **測定** 列から開く（`find-or-open` で下書き再開・確定閲覧・新規・テンプレ作成へ振り分け）。
2. またはヘッダの **部品測定** から `/kiosk/part-measurement` を開き、**工程** を切削 / 研削に合わせる（スケジュールから開いた場合は資源CDに応じて自動設定される）。
3. **バーコードスキャン** で移動票を読み取り、**日程を照会** で `ProductNo` を解決する。
4. 複数候補がある場合は一覧から行を選ぶ。
5. 下書きが無ければテンプレが解決できた時点で **記録表（下書き）が作成**される（スケジュール起点・手動照会とも）。
6. **個数** を入力すると、テンプレ項目 × 個数の入力欄が現れる。
7. 必要に応じて **NFC で社員タグ** をかざす（作業者として記録）。
8. 入力は一定間隔で **自動保存** される。離脱しても同じ端末・シート ID が分かれば GET で復元可能（運用上は画面内で継続操作を推奨）。
9. 完了したら **確定** する。確定後は編集用 PATCH が想定どおり拒否される。

## 管理者手順（テンプレ）

1. 管理コンソールに ADMIN / MANAGER でログインする。
2. **部品測定テンプレ** を開く。
3. FIHNCD（品番）・**資源CD**・工程・測定項目（小数桁数を含む）を入力し **登録**する（新規は常に新バージョンとして作成され、同品番・同工程・**同資源CD**の有効版は自動で無効化される）。
4. 図面付きにする場合は **図面テンプレート** で既存 visual を選ぶか、画像（PNG/JPEG/WebP）を新規アップロードする。項目ごとに **図番号（表示用）** を入れると、測定画面の列見出しに表示される。
5. 過去版を有効に戻す場合は一覧の **有効化** を使う。

## 確認・トラブル時

- テンプレが無い・工程が合わない: [KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md) を参照。
- バーコード・カメラ: 要領書のバーコード機能と同様、ブラウザ権限とライト環境を確認（[KB-313](./kiosk-documents.md) のカメラ項も参考）。

## 実機検証（自動・手動）

- **自動（推奨）**: `./scripts/deploy/verify-phase12-real.sh` — API ヘルス・deploy-status（Pi4 キオスク 4 台）・既存キオスク API に加え、`POST /api/part-measurement/resolve-ticket` のスモーク（`candidates` 応答・未認証 **401**）を含む。**実績**: Phase2 反映後（2026-03-29）および **visual template 反映後（2026-03-30）** とも **PASS 37 / WARN 0 / FAIL 0**（[KB-320](../knowledge-base/KB-320-kiosk-part-measurement.md)「実機・自動検証」節）。
- **手動**: 対象キオスクで `/kiosk/part-measurement` を開き、実移動票で照会 → 記録表開始 → 入力・自動保存 → 確定まで通す。管理画面でテンプレが有効であることを事前確認する。
- **チェックリスト**: [verification-checklist.md](../guides/verification-checklist.md) **6.6.9**。

## 関連

- ADR: [ADR-20260329-part-measurement-kiosk-record.md](../decisions/ADR-20260329-part-measurement-kiosk-record.md)（Phase1） / [ADR-20260401-part-measurement-phase2-resource-cd.md](../decisions/ADR-20260401-part-measurement-phase2-resource-cd.md)（Phase2） / [ADR-20260330-part-measurement-visual-template.md](../decisions/ADR-20260330-part-measurement-visual-template.md)（visual template）
- 沉浸式ヘッダー対象: `usesKioskImmersiveLayout` に `/kiosk/part-measurement` **およびその子パス**が含まれる（変更時は `kioskImmersiveLayoutPolicy.test.ts` を更新）
