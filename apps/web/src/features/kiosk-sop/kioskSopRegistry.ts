import assemblyManualUrl from '../../generated/kiosk-sop/assembly-procedure-template/manual.html?url';
import inspectionDrawingManualUrl from '../../generated/kiosk-sop/inspection-drawing/manual.html?url';
import { registerKioskPreload } from '../kiosk/kioskLazyPreload';

import type { KioskSopManual, KioskSopManualId } from './types';

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Manual request failed: ${response.status}`);
  return response.text();
}

// The Vite dev server injects its client scripts into fetched HTML, so dev keeps the raw module import.
// Vitest also defines import.meta.hot, so tests exercise the fetch path used in production.
const useRawImport = import.meta.hot !== undefined && import.meta.env.MODE !== 'test';
function cachedHtml(load: () => Promise<string>): () => Promise<string> {
  let pending: Promise<string> | undefined;
  return () => pending ??= load().catch((error) => {
    pending = undefined;
    throw error;
  });
}

const INSPECTION_DRAWING_MANUAL: KioskSopManual = Object.freeze({
  id: 'inspection-drawing',
  title: '検査図面 操作取説',
  loadSourceHtml: cachedHtml(useRawImport
    ? () => import('../../generated/kiosk-sop/inspection-drawing/manual.html?raw').then((module) => module.default)
    : () => fetchHtml(inspectionDrawingManualUrl)),
  sheets: Object.freeze([
    { id: 'library-entry-search', label: '一覧・検索' },
    { id: 'library-visual-management', label: '図面管理' },
    { id: 'library-template-management', label: 'テンプレート管理' },
    { id: 'edit-basics', label: '編集の基本' },
    { id: 'edit-visual-source', label: '図面ソース' },
    { id: 'edit-required-point', label: '測定点の必須項目' },
    { id: 'edit-advanced-point', label: '測定点の補助設定' },
    { id: 'edit-point-management', label: '点・引出線管理' },
    { id: 'edit-trial-report', label: '試行・帳票' },
    { id: 'edit-group-history', label: '資源・履歴' }
  ])
});

const ASSEMBLY_PROCEDURE_TEMPLATE_MANUAL: KioskSopManual = Object.freeze({
  id: 'assembly-procedure-template',
  title: '組立 手順書・テンプレート取説',
  loadSourceHtml: cachedHtml(useRawImport
    ? () => import('../../generated/kiosk-sop/assembly-procedure-template/manual.html?raw').then((module) => module.default)
    : () => fetchHtml(assemblyManualUrl)),
  sheets: Object.freeze([
    { id: 'assembly-overview', label: '管理画面と全体の流れ' },
    { id: 'assembly-file-register', label: 'ファイル登録・事前プレビュー' },
    { id: 'assembly-gmail-publish', label: 'Gmail取込・公開' },
    { id: 'assembly-template-auth-basics', label: 'テンプレート新規作成・認証・基本情報' },
    { id: 'assembly-template-procedure', label: '文書・表示ステップ・切抜き' },
    { id: 'assembly-template-markers', label: '工程・締結／チェック' },
    { id: 'assembly-template-save', label: '復元・保存完了' },
    { id: 'assembly-revision', label: '改版・複製・履歴' }
  ])
});

const MANUALS: Readonly<Record<KioskSopManualId, KioskSopManual>> = Object.freeze({
  'inspection-drawing': INSPECTION_DRAWING_MANUAL,
  'assembly-procedure-template': ASSEMBLY_PROCEDURE_TEMPLATE_MANUAL
});

export function getKioskSopManual(manualId: KioskSopManualId): KioskSopManual {
  return MANUALS[manualId];
}

Object.values(MANUALS).forEach((manual) => registerKioskPreload(manual.loadSourceHtml));
