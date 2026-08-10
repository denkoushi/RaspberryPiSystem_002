# 組立手順書・テンプレート作成導線 UIUX改善 ExecPlan

## Progress

- [x] `origin/main` の現仕様、既存API、SOP生成方式、テスト基盤を確認
- [x] 元repoのWIPを保全し、`origin/main`から専用worktree/branchを作成
- [x] 手順書登録・プレビュー・公開導線を実装
- [x] テンプレート改版安全性・保存完了導線を実装
- [x] ブラウザ途中復元を実装
- [x] 組立ワークフロー取説を生成・登録
- [x] 単体/API/E2E/Docker検証と後始末を完了

## Context and Decisions

- 基準: `origin/main` at implementation start (`236fcced...`)
- 作業branch: `feat/kiosk-assembly-guided-workflow-sop`
- サーバー下書きとDB migrationは追加しない。途中復元は同一ブラウザのlocalStorageに限定する。
- 改版時の機種名・手順パターンは固定し、別系統は複製して新規で作る。
- 保存成功後は一覧へ戻り、保存版を強調表示する。
- 既存の手順書preview endpoint、assembly template transaction、kiosk-sop-core、検証scriptを再利用する。

## Plan

1. 手順書アップロードをファイル名候補・事前preview・全ページ確認・公開・テンプレート新規作成の順に整理する。
2. Gmail確認、手順書領域の結果表示、主要操作のラベルとタッチ領域を整理する。
3. 改版識別子をAPI/UIで固定し、保存結果を一覧へ返す。
4. editor draftを純粋なrecovery schema、storage I/O、React hook/dialogへ分離する。
5. SOP generatorをdescriptor選択方式へ最小限一般化し、assembly manualを本番routeから生成する。
6. unit/API/E2E/SOP/Docker validationを実行し、全一時資源を削除して残存ゼロを確認する。

## Validation

- `corepack pnpm`（pnpm 9.15.9）で Web/API/shared-types/kiosk-sop-core のlint、型検査、Web buildを実行し、既存テスト基盤を含む全体validatorを完走した。
- 全体validator結果: API 486 files / 2542 passed / 7 skipped、Web 336 files / 1682 passed、Web build成功、migration 158件適用、能力グループfixture 20,100件、`EXPLAIN (ANALYZE, BUFFERS)`で `TorqueWrenchCapabilityGroup_idx_fastener_active` を確認。
- focused E2E: 一本道（preview→下書き→全ページ→公開→テンプレート新規→保存完了）2本、途中復元／破棄1本、組立SOP popup 1本を再実行し、全て合格。SOP popupでは管理画面・新規認証前後・改版認証前の初期sheet、移動、Escape、focus復帰、iframe sandbox、外部通信0を確認。
- SOPはhostで組立manualの連続checkを2回通した後、指定canonical Docker経路 `corepack pnpm kiosk-sop:generate` → `corepack pnpm kiosk-sop:check`（内部で`generate --all`/`check --all`）を完走。checkはinspection/assemblyの両manual、capture contract、既存inspection popupの18ケースを含め全て合格した。Docker generateで検査図面に発生した差分は`manifest.json`の`sourceSha256` 1行だけで、screen/manual/sheets/geometryはバイト不変。sourceShaは共通generator/script変更を反映する必要差分として記録し、視覚artifactは変更していない。組立側の生成HTML、screens、sheets、manifestはcurrent。
- PR CIの初回runでは、生成器ではなく単一manual前提のCIラッパーが`--all`出力ルートを誤読して失敗したため、`run-kiosk-sop-artifact-contract.sh`をinspection/assemblyの個別検証へ最小修正した。修正後の同じcanonical Docker契約（capture contract、両manualのsemantic/integrity/geometry/visual、既存inspection popup 18ケース）はローカルで合格し、head `5b519d24` のCIでは他の必須job（API、Web、E2E、Docker、runtime、agent image等）も合格した。
- 1366x768、1920x1080、900x900の既存multi-viewport/editor E2Eを含む画面境界を維持した。
- Dockerは一時PostgreSQLのみを使用し、migration SQL、API契約、競合409／識別子変更400、active状態不変、fixture／EXPLAINを検証。EXIT/INT/TERM後のcontainer、volume、network、storage、Vite process、4173 listenerは残存0。
- 生成manifestのSHA-256は秘密値ではないため、gitleaksの生成artifact allowlistへ限定パスを追加し、CI false positiveを抑止する。

## Changed-file responsibilities and test boundaries

| Area | Main files | Responsibility / dependency direction | Test boundary |
| --- | --- | --- | --- |
| Library page/state | `KioskAssemblyPage.tsx`, `AssemblyLibraryLayout.test.tsx` | page → assembly feature → existing API client; route/navigation state and result notification only | page/component tests, guided E2E |
| Procedure feature | `AssemblyProcedureUploadModal.tsx`, `AssemblyProcedurePreviewDialog.tsx`, `AssemblyProcedureGmailImportConfirmDialog.tsx`, `AssemblyProcedureLibrarySection.tsx` | file preview, all-page display, Gmail confirmation, publish orchestration; no API contract changes | upload/Gmail component tests, guided E2E |
| Template library/editor | `AssemblyTemplateLibraryTable.tsx`, `KioskAssemblyTemplateEditorFeature.tsx`, editor header/panes/toolbar/dialogs | CTA semantics, locked revision identity, save result callback; controller depends on feature modules, not router | component tests, editor E2E, API integration |
| Recovery | `assemblyTemplateEditorRecovery.ts`, `assemblyTemplateEditorRecoveryStorage.ts`, `useAssemblyTemplateEditorRecovery.ts`, `AssemblyTemplateRecoveryDialog.tsx` | pure schema/key/compatibility → storage I/O → React debounce/decision UI | pure unit tests, recovery E2E |
| API rule | `assembly-template.service.ts`, `assembly.integration.test.ts` | route → service → existing transaction; rejects cross-lineage revise before persistence | API integration + SQL invariants |
| SOP | registry/types, assembly definition/adapter, `generate.mjs`, generated assembly artifacts | registry → descriptor/fixture adapter → existing kiosk-sop-core renderer; no new framework | core tests, capture contract, assembly popup E2E, manual check |
| Documentation/validation | ExecPlan, ADR, `validate-assembly-template-guided-create.sh`, `scripts/ci/run-kiosk-sop-artifact-contract.sh`, E2E specs | records decisions and reproducible disposable validation; CI wrapper verifies each generated manual | diff/status/resource residue checks |
| CI secret scanning | `.gitleaks.toml` | generated SOP manifest hashes are non-secret deterministic artifacts | gitleaks path allowlist |

## Recovery and Safety

- 元repo `/Users/tsudatakashi/RaspberryPiSystem_002` は読み取り専用扱いとし、WIP 2ファイルを変更しない。
- Dockerは固有label/nameの一時container・volume・networkだけを作り、EXIT/INT/TERMで削除する。
- 既存DB/既存containerを再利用せず、検証後にcontainer、volume、network、storageをinspectして残存ゼロを確認する。
- 失敗時は変更を破棄せず、ExecPlanのSurprises/Decision Logへ原因と再開地点を記録する。

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-08-10 | browser recovery only | DB/APIの新しい業務状態を増やさず、同一キオスクで作業消失を防ぐため |
| 2026-08-10 | revision identity locked | 改版による系統移動・誤active化を防ぐため |
| 2026-08-10 | save returns to highlighted library row | 完成状態と次の行動を明確にするため |
| 2026-08-10 | Gmail confirmation uses existing ConfirmDialog | キオスクUIの確認操作を統一し、取込API契約を変更しないため |
| 2026-08-10 | recovery Storage I/O is adjacent to pure recovery module | key/schema/判定とブラウザI/Oのテスト境界を分離するため |
| 2026-08-10 | SOP manual keeps eight sheets | 認証と基本情報を同一シートへまとめ、計画の8区分を維持するため |

## Surprises

- APIの一般 `tsc --noEmit -p tsconfig.json` は、既存tsconfigが `prisma`/`scripts` を `src` rootDirへ含める構成のためrootDirエラーになる。既存canonical build設定 `tsconfig.build.json`で型検査・buildを実行し、設定自体は変更しなかった。
- host直接実行ではfont/browser差によりinspectionのscreen/manualがstaleになったが、承認済みcanonical Docker経路で判定し、Dockerでは視覚artifact差分なし・manifest sourceShaのみとなった。以後SOP判定はDocker経路を使用する。
- CIの`kiosk-sop` jobは旧単一manualラッパーで`/diagnostics/candidate/manifest.json`を探していた。生成器やartifactの不整合ではないことをログで確認し、ラッパーを2つのdescriptor出力へ合わせた。修正後のローカルCI契約は18 popup testsを含め合格した。

## Outcomes

主要導線、改版安全性、ブラウザ途中復元、組立8-sheet取説、focused E2E、API/Docker検証を完了した。Docker canonical SOP checkは全manual合格、視覚artifactの不要な検査図面差分はなく、sourceShaの必要差分だけを記録した。生成物とコード以外の差分はなく、lockfile/workspaceはHEADから不変。元repoのWIP 2ファイルも不変。Deployは実行せず、次工程はfeature branchのcommit/push/PRとCI監視。
