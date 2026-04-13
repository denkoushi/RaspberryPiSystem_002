/**
 * サイネージSPLITレイアウトのペイン解決ロジック（純関数）
 *
 * 責務: layoutConfig + content から左右ペインの RenderablePane を解決する。
 * ルール: 空配列（loans=0件）も有効データとして扱い、表示可能とする。
 *
 * SOLID: SRP（分岐判定と描画実行の分離）、OCP（kind追加時の影響局所化）
 */

import type { SignageContentResponse } from './signage.service.js';
import type {
  SignageLayoutConfig,
  SignageSlot,
  PdfSlotConfig,
  CsvDashboardSlotConfig,
  VisualizationSlotConfig,
} from './signage-layout.types.js';

export type ToolItem = NonNullable<SignageContentResponse['tools']>[number];

export interface SplitPdfOptions {
  pageUrl?: string | null;
  title?: string | null;
  slideInterval?: number | null;
  displayMode?: string | null;
}

export interface CsvDashboardData {
  id: string;
  name: string;
  pageNumber: number;
  totalPages: number;
  rows: Array<Record<string, unknown>>;
}

/**
 * 描画可能なペイン記述子（renderSplitWithPanes の引数と互換）
 */
export interface RenderablePane {
  kind: 'pdf' | 'loans' | 'csv_dashboard' | 'visualization';
  tools?: ToolItem[];
  pdfOptions?: SplitPdfOptions;
  csvDashboard?: CsvDashboardData;
  visualizationDashboardId?: string;
}

/**
 * SPLITレイアウトの解決結果
 */
export interface ResolvedSplitPanes {
  left: RenderablePane;
  right: RenderablePane;
}

/**
 * PDFページインデックス解決のコールバック型
 */
export type ResolvePdfPageFn = (
  totalPages: number,
  displayMode: string,
  slideInterval: number | null,
  pdfId: string
) => number;

/**
 * SPLITレイアウトの左右ペインを解決する（純関数）
 *
 * 空配列（loans=0件）も有効として扱い、visualization/csv_dashboard との
 * 組み合わせで正しく renderSplitWithPanes に渡せる構造を返す。
 */
export function resolveSplitPanes(
  layoutConfig: SignageLayoutConfig,
  content: SignageContentResponse,
  getPdfPageIndex: ResolvePdfPageFn
): ResolvedSplitPanes | null {
  if (layoutConfig.layout !== 'SPLIT') {
    return null;
  }

  const leftSlot = layoutConfig.slots.find((s) => s.position === 'LEFT');
  const rightSlot = layoutConfig.slots.find((s) => s.position === 'RIGHT');

  if (!leftSlot || !rightSlot) {
    return null;
  }

  const tools = content.tools ?? [];
  const leftTools = leftSlot.kind === 'loans' ? tools : [];
  const rightTools = rightSlot.kind === 'loans' ? tools : [];

  let leftPdfOptions: SplitPdfOptions | undefined;
  let rightPdfOptions: SplitPdfOptions | undefined;
  let leftCsvDashboard: CsvDashboardData | undefined;
  let rightCsvDashboard: CsvDashboardData | undefined;
  let leftVisualizationId: string | undefined;
  let rightVisualizationId: string | undefined;

  if (leftSlot.kind === 'pdf') {
    const pdfConfig = leftSlot.config as PdfSlotConfig;
    const pdf = content.pdfsById?.[pdfConfig.pdfId] ?? content.pdf;
    if (pdf?.pages?.length) {
      const pdfPageIndex = getPdfPageIndex(
        pdf.pages.length,
        pdfConfig.displayMode ?? 'SINGLE',
        pdfConfig.slideInterval ?? null,
        pdf.id
      );
      leftPdfOptions = {
        pageUrl: pdf.pages[pdfPageIndex],
        title: pdf.name,
        slideInterval: pdfConfig.slideInterval ?? null,
        displayMode: pdfConfig.displayMode,
      };
    }
  } else if (leftSlot.kind === 'csv_dashboard') {
    const config = leftSlot.config as CsvDashboardSlotConfig;
    leftCsvDashboard = content.csvDashboardsById?.[config.csvDashboardId];
  } else if (leftSlot.kind === 'visualization') {
    const config = leftSlot.config as VisualizationSlotConfig;
    leftVisualizationId = config.visualizationDashboardId;
  }

  if (rightSlot.kind === 'pdf') {
    const pdfConfig = rightSlot.config as PdfSlotConfig;
    const pdf = content.pdfsById?.[pdfConfig.pdfId] ?? content.pdf;
    if (pdf?.pages?.length) {
      const pdfPageIndex = getPdfPageIndex(
        pdf.pages.length,
        pdfConfig.displayMode ?? 'SINGLE',
        pdfConfig.slideInterval ?? null,
        pdf.id
      );
      rightPdfOptions = {
        pageUrl: pdf.pages[pdfPageIndex],
        title: pdf.name,
        slideInterval: pdfConfig.slideInterval ?? null,
        displayMode: pdfConfig.displayMode,
      };
    }
  } else if (rightSlot.kind === 'csv_dashboard') {
    const config = rightSlot.config as CsvDashboardSlotConfig;
    rightCsvDashboard = content.csvDashboardsById?.[config.csvDashboardId];
  } else if (rightSlot.kind === 'visualization') {
    const config = rightSlot.config as VisualizationSlotConfig;
    rightVisualizationId = config.visualizationDashboardId;
  }

  const leftPane = buildPane(leftSlot, leftTools, leftPdfOptions, leftCsvDashboard, leftVisualizationId);
  const rightPane = buildPane(rightSlot, rightTools, rightPdfOptions, rightCsvDashboard, rightVisualizationId);

  return { left: leftPane, right: rightPane };
}

function buildPane(
  slot: SignageSlot,
  tools: ToolItem[],
  pdfOptions: SplitPdfOptions | undefined,
  csvDashboard: CsvDashboardData | undefined,
  visualizationDashboardId: string | undefined
): RenderablePane {
  switch (slot.kind) {
    case 'pdf':
      return { kind: 'pdf', pdfOptions };
    case 'loans':
      return { kind: 'loans', tools };
    case 'csv_dashboard':
      return { kind: 'csv_dashboard', csvDashboard };
    case 'visualization':
      return { kind: 'visualization', visualizationDashboardId };
    case 'kiosk_progress_overview':
      // FULL のみ対応。SPLIT で選ばれた場合は空ペイン（運用で避ける想定）。
      return { kind: 'loans', tools: [] };
    case 'kiosk_leader_order_cards':
      return { kind: 'loans', tools: [] };
    case 'mobile_placement_parts_shelf_grid':
      return { kind: 'loans', tools: [] };
    default:
      return { kind: 'loans', tools: [] };
  }
}
