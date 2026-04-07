import sharp from 'sharp';
import path from 'path';
import { promises as fs } from 'fs';
import type { SignageService, SignageContentResponse } from './signage.service.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { PDF_PAGES_DIR } from '../../lib/pdf-storage.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import type {
  PdfSlotConfig,
  CsvDashboardSlotConfig,
  VisualizationSlotConfig,
  KioskProgressOverviewSlotConfig,
} from './signage-layout.types.js';
import type { RenderablePane } from './signage-pane-resolver.js';
import { resolveSplitPanes } from './signage-pane-resolver.js';
import { CsvDashboardTemplateRenderer } from '../csv-dashboard/csv-dashboard-template-renderer.js';
import { CsvDashboardService } from '../csv-dashboard/index.js';
import { VisualizationService } from '../visualization/index.js';
import { getProductionScheduleProgressOverview } from '../production-schedule/progress-overview-query.service.js';
import { computeSplitPaneGeometry } from './signage-layout-math.js';
import { getRotatingSlideIndex, type SignageSlideRotationState } from './signage-slide-rotation.js';
import { buildKioskProgressOverviewSvg } from './kiosk-progress-overview/kiosk-progress-overview-svg.js';
import {
  DEFAULT_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE,
  MAX_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE,
  progressOverviewPageCount,
  sanitizeSeibanPerPage,
  sliceProgressOverviewItems,
} from './kiosk-progress-overview/pagination.js';
import {
  COMPACT24_MAX_COLUMNS,
  COMPACT24_MAX_ROWS,
  COMPACT24_CARD_HEIGHT_PX,
} from './loan-card/loan-card-contracts.js';
import { computeLoanGridLayout } from './loan-grid/compute-loan-grid-layout.js';
import { buildLoanCardViewModels } from './loan-grid/build-loan-card-view-models.js';
import { createLoanGridRasterizer } from './loan-grid/create-loan-grid-rasterizer.js';
import type { ToolGridConfig } from './loan-grid/tool-grid-config.js';
import type { LoanGridRasterizerPort } from './loan-grid/loan-grid-rasterizer.port.js';
import type { SvgLoanGridDependencies } from './loan-grid/svg-loan-grid-dependencies.js';

// 環境変数で解像度を設定可能（デフォルト: 1920x1080、4K: 3840x2160）
// 50インチモニタで近くから見る場合は4K推奨
const WIDTH = parseInt(process.env.SIGNAGE_RENDER_WIDTH || '1920', 10);
const HEIGHT = parseInt(process.env.SIGNAGE_RENDER_HEIGHT || '1080', 10);
const BACKGROUND = '#020617';

type ToolItem = NonNullable<SignageContentResponse['tools']>[number] & {
  isOver12Hours?: boolean;
  isOverdue?: boolean;
};

/** 左右ペイン共通: SPLIT 持出カード（compact 24）。契約定数は `loan-card-contracts.ts`。 */
const SPLIT_COMPACT24_LOAN_GRID_BASE: Pick<
  ToolGridConfig,
  'mode' | 'showThumbnails' | 'maxRows' | 'maxColumns' | 'cardLayout' | 'cardHeightPx'
> = {
  mode: 'SPLIT',
  showThumbnails: true,
  maxRows: COMPACT24_MAX_ROWS,
  maxColumns: COMPACT24_MAX_COLUMNS,
  cardLayout: 'splitCompact24',
  cardHeightPx: COMPACT24_CARD_HEIGHT_PX,
};

interface PdfRenderOptions {
  title?: string | null;
  slideInterval?: number | null;
  displayMode?: string | null;
}

interface SplitPdfOptions extends PdfRenderOptions {
  pageUrl?: string | null;
  metricsText?: string | null;
}

export class SignageRenderer {
  private readonly pdfSlideState = new Map<string, SignageSlideRotationState>();
  private readonly kioskProgressOverviewSlideState = new Map<string, SignageSlideRotationState>();
  private readonly csvDashboardPageState = new Map<string, { lastPageNumber: number; lastRenderedAt: number }>();
  private lastCpuSample: { idle: number; total: number } | null = null;
  private readonly csvDashboardTemplateRenderer = new CsvDashboardTemplateRenderer();
  private readonly csvDashboardService = new CsvDashboardService();
  private readonly visualizationService = new VisualizationService();
  private readonly loanGridRasterizer: LoanGridRasterizerPort;

  constructor(private readonly signageService: SignageService) {
    this.loanGridRasterizer = createLoanGridRasterizer(this.makeSvgLoanGridDependencies());
  }

  private makeSvgLoanGridDependencies(): SvgLoanGridDependencies {
    return {
      escapeXml: (value) => this.escapeXml(value),
      generateId: (prefix) => this.generateId(prefix),
      encodeLocalImageAsBase64: (localPath, width, height, fit) =>
        this.encodeLocalImageAsBase64(localPath, width, height, fit),
      resolveThumbnailLocalPath: (thumbnailUrl) => this.resolveThumbnailLocalPath(thumbnailUrl),
    };
  }

  /**
   * 登録済み ClientDevice ごとにコンテンツを選び、端末別 JPEG を保存する。
   * 端末が0件のときのみレガシー current.jpg を1枚更新する。
   */
  async renderCurrentContent(): Promise<{
    renderedAt: Date;
    filename: string;
    clientKeysRendered: number;
  }> {
    const clientKeys = await this.signageService.listSignageRenderClientApiKeys();
    let lastFilename = '';

    if (clientKeys.length === 0) {
      const content = await this.signageService.getContent();
      const buffer = await this.renderContent(content);
      const result = await SignageRenderStorage.saveLegacyGlobalImage(buffer);
      lastFilename = result.filename;
      logger.info({ location: 'signage.renderer.ts:renderCurrentContent', filename: result.filename }, 'Legacy global signage image saved');
    } else {
      for (const clientKey of clientKeys) {
        const content = await this.signageService.getContent({ clientKey });
        const buffer = await this.renderContent(content);
        const result = await SignageRenderStorage.saveRenderedImageForClient(buffer, clientKey);
        lastFilename = result.filename;
        logger.info(
          { location: 'signage.renderer.ts:renderCurrentContent', filename: result.filename, clientKeyLen: clientKey.length },
          'Client signage image saved',
        );
      }
    }

    return {
      renderedAt: new Date(),
      filename: lastFilename,
      clientKeysRendered: clientKeys.length,
    };
  }

  /**
   * 可視化ダッシュボードをJPEGバッファでレンダリング（Web /signage 表示用API）
   */
  async renderVisualizationToBuffer(dashboardId: string): Promise<Buffer> {
    return await this.renderVisualizationDashboard(dashboardId);
  }

  private async renderContent(content: SignageContentResponse): Promise<Buffer> {
    // #region agent log
    logger.info({ location: 'signage.renderer.ts:66', hypothesisId: 'E', hasLayoutConfig: content.layoutConfig != null, contentType: content.contentType, layoutConfig: content.layoutConfig }, 'renderContent called');
    // #endregion
    // layoutConfigを優先し、nullの場合は旧形式（contentType）から処理
    if (content.layoutConfig) {
      // #region agent log
      logger.info({ location: 'signage.renderer.ts:68', hypothesisId: 'E', layoutConfig: content.layoutConfig }, 'Rendering with layoutConfig');
      // #endregion
      return await this.renderWithLayoutConfig(content);
    }

    // 後方互換: 旧形式（contentType）から処理
    if (content.contentType === 'PDF' && content.pdf?.pages?.length) {
      const pdfPageIndex = this.getCurrentPdfPageIndex(
        content.pdf.pages.length,
        content.displayMode,
        content.pdf.slideInterval || null,
        content.pdf.id
      );
      return await this.renderPdfImage(content.pdf.pages[pdfPageIndex], {
        title: content.pdf.name,
        slideInterval: content.pdf.slideInterval ?? null,
        displayMode: content.displayMode,
      });
    }

    if (content.contentType === 'TOOLS') {
      return await this.renderTools(content.tools ?? []);
    }

    if (content.contentType === 'SPLIT') {
      const pdfPageIndex = this.getCurrentPdfPageIndex(
        content.pdf?.pages?.length || 0,
        content.displayMode,
        content.pdf?.slideInterval || null,
        content.pdf?.id
      );
      const pdfPageUrl = content.pdf?.pages?.[pdfPageIndex];
      return await this.renderSplit(content.tools ?? [], {
        pageUrl: pdfPageUrl,
        title: content.pdf?.name ?? null,
        slideInterval: content.pdf?.slideInterval ?? null,
        displayMode: content.displayMode,
      });
    }

    return await this.renderMessage('表示するコンテンツがありません');
  }

  /**
   * layoutConfigに基づいてレンダリング（新形式）
   */
  private async renderWithLayoutConfig(content: SignageContentResponse): Promise<Buffer> {
    if (!content.layoutConfig) {
      return await this.renderMessage('レイアウト設定がありません');
    }

    const layoutConfig = content.layoutConfig;

    if (layoutConfig.layout === 'FULL') {
      // 全体表示: 最初のスロットを全体に表示
      const slot = layoutConfig.slots[0];
      if (!slot) {
        return await this.renderMessage('表示するコンテンツがありません');
      }

      if (slot.kind === 'pdf') {
        const pdfConfig = slot.config as PdfSlotConfig;
        const pdf = content.pdf;
        if (!pdf || !pdf.pages?.length) {
          return await this.renderMessage('PDFが見つかりません');
        }
        const pdfPageIndex = this.getCurrentPdfPageIndex(
          pdf.pages.length,
          pdfConfig.displayMode === 'SLIDESHOW' ? 'SLIDESHOW' : 'SINGLE',
          pdfConfig.slideInterval || null,
          pdf.id
        );
        // #region agent log
        const pageUrl = pdf.pages[pdfPageIndex];
        const pageNumber = pdfPageIndex + 1;
        logger.info({ location: 'signage.renderer.ts:161', hypothesisId: 'F', pdfId: pdf.id, pdfPageIndex, pageNumber, totalPages: pdf.pages.length, pageUrl: pageUrl.substring(0, 50) + '...' }, 'Rendering PDF page');
        // #endregion
        return await this.renderPdfImage(pageUrl, {
          title: pdf.name,
          slideInterval: pdfConfig.slideInterval ?? null,
          displayMode: pdfConfig.displayMode,
        });
      } else if (slot.kind === 'loans') {
        return await this.renderTools(content.tools ?? []);
      } else if (slot.kind === 'csv_dashboard') {
        const csvDashboardConfig = slot.config as CsvDashboardSlotConfig;
        const csvDashboard = content.csvDashboardsById?.[csvDashboardConfig.csvDashboardId];
        if (!csvDashboard) {
          return await this.renderMessage('CSVダッシュボードが見つかりません');
        }
        return await this.renderCsvDashboard(csvDashboardConfig.csvDashboardId, csvDashboard);
      } else if (slot.kind === 'visualization') {
        const visualizationConfig = slot.config as VisualizationSlotConfig;
        return await this.renderVisualizationDashboard(visualizationConfig.visualizationDashboardId);
      } else if (slot.kind === 'kiosk_progress_overview') {
        const kioskCfg = slot.config as KioskProgressOverviewSlotConfig;
        const scopeKey = kioskCfg.deviceScopeKey?.trim();
        if (!scopeKey) {
          return await this.renderMessage('キオスク進捗: deviceScopeKey が未設定です');
        }
        const slideSec = kioskCfg.slideIntervalSeconds ?? 30;
        const perPageRaw = kioskCfg.seibanPerPage ?? DEFAULT_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE;
        if (!Number.isFinite(perPageRaw) || perPageRaw < 1) {
          return await this.renderMessage('キオスク進捗: seibanPerPage が無効です');
        }
        const perPage = sanitizeSeibanPerPage(perPageRaw);
        if (perPageRaw > MAX_KIOSK_PROGRESS_OVERVIEW_SEIBAN_PER_PAGE) {
          logger.warn(
            { deviceScopeKey: scopeKey, requested: perPageRaw, capped: perPage },
            'kiosk_progress_overview seibanPerPage was capped'
          );
        }
        return await this.renderKioskProgressOverviewFull(scopeKey, slideSec, perPage);
      }
    } else if (layoutConfig.layout === 'SPLIT') {
      // SignagePaneResolver でペイン解決（loans=0件も有効）
      const resolved = resolveSplitPanes(
        layoutConfig,
        content,
        (totalPages, displayMode, slideInterval, pdfId) =>
          this.getCurrentPdfPageIndex(totalPages, displayMode, slideInterval, pdfId)
      );

      if (resolved) {
        const leftPane = this.enrichPaneForRender(resolved.left);
        const rightPane = this.enrichPaneForRender(resolved.right);

        return await this.renderSplitWithPanes(leftPane, rightPane);
      }
    }

    return await this.renderMessage('表示するコンテンツがありません');
  }

  /**
   * 解決済みペインに isOver12Hours を付与（loans のみ）
   */
  private enrichPaneForRender(pane: RenderablePane): RenderablePane & { tools?: ToolItem[] } {
    if (pane.kind !== 'loans' || !pane.tools) {
      return pane;
    }
    return {
      ...pane,
      tools: pane.tools.map((t) => ({
        ...t,
        isOver12Hours: this.isOver12Hours(t.borrowedAt),
      })),
    };
  }

  private async renderPdfImage(pageUrl: string, options?: PdfRenderOptions): Promise<Buffer> {
    const imageBase64 = await this.encodePdfPageAsBase64(pageUrl, Math.round(WIDTH * 0.7), Math.round(HEIGHT * 0.75));
    if (!imageBase64) {
      return await this.renderMessage('PDFページが見つかりません');
    }

    const svg = this.buildPdfScreenSvg(imageBase64, options);
    return await sharp(Buffer.from(svg), { density: 220 })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  }

  private async renderTools(tools: ToolItem[]): Promise<Buffer> {
    const metricsText = await this.getClientSystemMetricsText();
    const enrichedTools: ToolItem[] = tools.map((tool) => ({
      ...tool,
      isOver12Hours: this.isOver12Hours(tool.borrowedAt),
    }));
    const svg = await this.buildToolsScreenSvg(enrichedTools, metricsText);
    return await sharp(Buffer.from(svg), { density: 300 })
      .resize(WIDTH, HEIGHT, { fit: 'fill' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  }

  private async renderSplit(tools: ToolItem[], pdfOptions?: SplitPdfOptions, swapSides = false): Promise<Buffer> {
    const enrichedTools: ToolItem[] = tools.map((tool) => ({
      ...tool,
      isOver12Hours: this.isOver12Hours(tool.borrowedAt),
    }));

    let pdfImageBase64: string | null = null;
    if (pdfOptions?.pageUrl) {
      pdfImageBase64 = await this.encodePdfPageAsBase64(pdfOptions.pageUrl, Math.round(WIDTH * 0.35), Math.round(HEIGHT * 0.7));
    }

    const metricsText = await this.getClientSystemMetricsText();
    const svg = await this.buildSplitScreenSvg(enrichedTools, {
      ...pdfOptions,
      imageBase64: pdfImageBase64,
      metricsText,
    }, swapSides);

    return await sharp(Buffer.from(svg), { density: 240 })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  }

  async renderMessage(message: string, customWidth = WIDTH): Promise<Buffer> {
    const svg = this.buildMessageScreenSvg(message, customWidth);
    return await sharp(Buffer.from(svg), { density: 240 })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  }

  private async buildToolsScreenSvg(tools: ToolItem[], metricsText?: string | null): Promise<string> {
    const scale = WIDTH / 1920;
    const outerPadding = Math.round(2 * scale); // 最小限の枠余白で上貼り付きを防止
    const gradientId = this.generateId('bg');
    const panelWidth = WIDTH - outerPadding * 2;
    const panelHeight = HEIGHT - outerPadding * 2;
    const panelX = outerPadding;
    const panelY = outerPadding;
    const headerHeight = Math.round(28 * scale);
    const innerPadding = Math.round(10 * scale);
    const panelRadius = Math.round(12 * scale);

    const { cardsSvg, overflowCount } = await this.buildToolCardGrid(tools, {
      x: panelX + innerPadding,
      y: panelY + innerPadding + headerHeight,
      width: panelWidth - innerPadding * 2,
      height: panelHeight - innerPadding * 2 - headerHeight,
      mode: 'FULL',
      showThumbnails: true,
      maxRows: 3,
      maxColumns: 2,
    });

    const overflowBadge =
      overflowCount > 0
        ? `<text x="${panelX + panelWidth - innerPadding}" y="${panelY + panelHeight - innerPadding / 2}"
            text-anchor="end" font-size="${Math.round(18 * scale)}" fill="#fcd34d" font-family="sans-serif">
            さらに ${overflowCount} 件
          </text>`
        : '';

    const metricsElement = metricsText
      ? `<text x="${panelX + panelWidth - innerPadding}" y="${panelY + innerPadding}"
          text-anchor="end" font-size="${Math.round(18 * scale)}" fill="#cbd5f5" font-family="sans-serif">
          ${this.escapeXml(metricsText)}
        </text>`
      : '';

    return `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#020617"/>
            <stop offset="50%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#${gradientId})" />

        <g>
          <rect x="${panelX}" y="${panelY}" rx="${panelRadius}" ry="${panelRadius}" width="${panelWidth}" height="${panelHeight}"
            fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />

          <text x="${panelX + innerPadding}" y="${panelY + innerPadding + Math.round(18 * scale)}"
            font-size="${Math.round(20 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            工具在庫状況
          </text>
          ${metricsElement}
          ${cardsSvg}
          ${overflowBadge}
        </g>
      </svg>
    `;
  }

  private async buildSplitScreenSvg(
    tools: ToolItem[],
    pdfOptions: (SplitPdfOptions & { imageBase64?: string | null }) | undefined,
    swapSides = false
  ): Promise<string> {
    const scale = WIDTH / 1920;
    const outerPadding = 0;
    const panelGap = Math.round(12 * scale); // ペイン間に少し余裕
    const gradientId = this.generateId('bg');
    const leftWidth = Math.round((WIDTH - outerPadding * 2 - panelGap) * 0.58);
    const rightWidth = WIDTH - outerPadding * 2 - panelGap - leftWidth;
    const panelHeight = HEIGHT - outerPadding * 2;
    const leftX = outerPadding;
    const rightX = leftX + leftWidth + panelGap;
    const panelRadius = Math.round(10 * scale);
    const leftInnerPadding = Math.round(20 * scale);   // 左ペイン: タイトルとカードに十分な余白
    const rightInnerPadding = Math.round(6 * scale);   // 右ペイン: タイトルが枠に張り付かない最小余白
    const titleOffsetY = Math.round(22 * scale);       // 左右共通: タイトルのベースラインオフセット
    const leftHeaderHeight = Math.round(60 * scale);   // 左ペイン: タイトル下からカードまで大きめの間隔（タイトルと被らないように）
    const rightHeaderHeight = Math.round(12 * scale);  // 右ペイン: タイトル下からPDFまでの余白をさらに圧縮して黒エリアを拡大

    // swapSidesがtrueの場合、左右を入れ替える
    const actualLeftTools = swapSides ? [] : tools;
    const actualRightTools = swapSides ? tools : [];
    const actualLeftPdfOptions = swapSides ? pdfOptions : undefined;
    const actualRightPdfOptions = swapSides ? undefined : pdfOptions;

    const leftTitle = swapSides ? (pdfOptions?.title ?? 'PDF表示') : '持出中アイテム';
    const rightTitle = swapSides ? '持出中アイテム' : (pdfOptions?.title ?? 'PDF表示');

    const { cardsSvg, overflowCount } = await this.buildToolCardGrid(
      swapSides ? actualRightTools : actualLeftTools,
      {
        x: swapSides ? rightX + rightInnerPadding : leftX + leftInnerPadding,
        y: outerPadding + (swapSides ? rightInnerPadding + rightHeaderHeight : leftInnerPadding + leftHeaderHeight),
        width: (swapSides ? rightWidth : leftWidth) - (swapSides ? rightInnerPadding : leftInnerPadding) * 2,
        height: panelHeight - (swapSides ? rightInnerPadding : leftInnerPadding) * 2 - (swapSides ? rightHeaderHeight : leftHeaderHeight),
        mode: 'SPLIT',
        showThumbnails: true,
        maxRows: 3,
        maxColumns: 3,
      }
    );

    const overflowBadge =
      overflowCount > 0
        ? `<text x="${swapSides ? rightX + rightWidth - rightInnerPadding : leftX + leftWidth - leftInnerPadding}" y="${outerPadding + panelHeight - (swapSides ? rightInnerPadding : leftInnerPadding)}"
            text-anchor="end" font-size="${Math.round(16 * scale)}" fill="#fcd34d" font-family="sans-serif">
            さらに ${overflowCount} 件
          </text>`
        : '';

    const metricsElement = pdfOptions?.metricsText
      ? `<text x="${swapSides ? rightX + rightWidth - rightInnerPadding : leftX + leftWidth - leftInnerPadding}" y="${outerPadding + (swapSides ? rightInnerPadding : leftInnerPadding)}"
          text-anchor="end" font-size="${Math.round(18 * scale)}" fill="#cbd5f5" font-family="sans-serif">
          ${this.escapeXml(pdfOptions.metricsText)}
        </text>`
      : '';

    const pdfContent = (swapSides ? actualLeftPdfOptions : actualRightPdfOptions)?.imageBase64
      ? `<image x="${swapSides ? leftX + leftInnerPadding : rightX + rightInnerPadding}" y="${outerPadding + (swapSides ? leftInnerPadding + leftHeaderHeight : rightInnerPadding + rightHeaderHeight)}"
          width="${(swapSides ? leftWidth : rightWidth) - (swapSides ? leftInnerPadding : rightInnerPadding) * 2}" height="${panelHeight - (swapSides ? leftInnerPadding : rightInnerPadding) * 2 - (swapSides ? leftHeaderHeight : rightHeaderHeight)}"
          preserveAspectRatio="xMidYMid meet"
          href="${(swapSides ? actualLeftPdfOptions : actualRightPdfOptions)?.imageBase64}" />`
      : swapSides ? '' : `<text x="${rightX + rightWidth / 2}" y="${outerPadding + panelHeight / 2}"
          text-anchor="middle" font-size="${Math.round(32 * scale)}" fill="#e2e8f0" font-family="sans-serif">
          PDFが設定されていません
        </text>`;

    const slideInfo = '';

    return `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#020617"/>
            <stop offset="50%" stop-color="#0d162c"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#${gradientId})" />

        <g>
          <rect x="${leftX}" y="${outerPadding}" width="${leftWidth}" height="${panelHeight}"
            rx="${panelRadius}" ry="${panelRadius}"
            fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.08)" />
          <text x="${leftX + leftInnerPadding}" y="${outerPadding + leftInnerPadding + titleOffsetY}"
            font-size="${Math.round(20 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            ${this.escapeXml(leftTitle)}
          </text>
          ${swapSides ? '' : metricsElement}
          ${swapSides ? pdfContent : cardsSvg}
          ${overflowBadge}
        </g>

        <g>
          <rect x="${rightX}" y="${outerPadding}" width="${rightWidth}" height="${panelHeight}"
            rx="${panelRadius}" ry="${panelRadius}"
            fill="rgba(15,23,42,0.50)" stroke="rgba(255,255,255,0.08)" />
          <text x="${rightX + rightInnerPadding}" y="${outerPadding + rightInnerPadding + titleOffsetY}"
            font-size="${Math.round(20 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            ${this.escapeXml(rightTitle)}
          </text>
          ${swapSides ? slideInfo : ''}
          ${swapSides ? cardsSvg : pdfContent}
          ${overflowBadge}
        </g>
      </svg>
    `;
  }

  /**
   * CSVダッシュボードをレンダリング
   */
  private async renderCsvDashboard(
    dashboardId: string,
    csvDashboard: { id: string; name: string; pageNumber: number; totalPages: number; rows: Array<Record<string, unknown>> },
    options?: { canvasWidth?: number; canvasHeight?: number }
  ): Promise<Buffer> {
    const dashboard = await prisma.csvDashboard.findUnique({
      where: { id: dashboardId },
    });

    if (!dashboard || !dashboard.enabled) {
      return await this.renderMessage('CSVダッシュボードが見つかりません');
    }

    // Prisma Json型からColumnDefinition[]へ変換（必須フィールドは取得済み）
    const columnDefinitions = dashboard.columnDefinitions as unknown as Array<{
      internalName: string;
      displayName: string;
      dataType: string;
      csvHeaderCandidates?: string[];
      order?: number;
    }>;

    let svg: string;
    if (dashboard.templateType === 'TABLE') {
      const templateConfig = dashboard.templateConfig as {
        rowsPerPage: number;
        fontSize: number;
        displayColumns: string[];
        columnWidths?: Record<string, number>;
      };
      svg = this.csvDashboardTemplateRenderer.renderTable(
        csvDashboard.rows,
        columnDefinitions,
        templateConfig,
        dashboard.name,
        dashboard.emptyMessage,
        { canvasWidth: options?.canvasWidth ?? WIDTH, canvasHeight: options?.canvasHeight ?? HEIGHT }
      );
    } else {
      const templateConfig = dashboard.templateConfig as {
        cardsPerPage: number;
        fontSize: number;
        displayFields: string[];
      };
      svg = this.csvDashboardTemplateRenderer.renderCardGrid(
        csvDashboard.rows,
        columnDefinitions,
        templateConfig,
        dashboard.name,
        dashboard.emptyMessage
      );
    }

    const targetWidth = options?.canvasWidth ?? WIDTH;
    const targetHeight = options?.canvasHeight ?? HEIGHT;

    // 重要: デフォルト(fit=cover)だと、SVGの縦横比が16:9でない場合に左右/上下がトリミングされ
    // 表示が見切れる。サイネージでは「見切れない」ことを優先して contain に固定する。
    return await sharp(Buffer.from(svg))
      .resize(targetWidth, targetHeight, { fit: 'contain', background: BACKGROUND })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  /**
   * 可視化ダッシュボードをレンダリング
   */
  private async renderVisualizationDashboard(
    dashboardId: string,
    options?: { canvasWidth?: number; canvasHeight?: number }
  ): Promise<Buffer> {
    const dashboard = await prisma.visualizationDashboard.findUnique({
      where: { id: dashboardId },
    });

    const targetWidth = options?.canvasWidth ?? WIDTH;
    const targetHeight = options?.canvasHeight ?? HEIGHT;

    if (!dashboard || !dashboard.enabled) {
      const fallback = await this.renderMessage('可視化が見つかりません', targetWidth);
      return await sharp(fallback)
        .resize(targetWidth, targetHeight, { fit: 'contain', background: BACKGROUND })
        .jpeg({ quality: 90 })
        .toBuffer();
    }

    const output = await this.visualizationService.renderToBuffer(
      {
        dataSourceType: dashboard.dataSourceType,
        rendererType: dashboard.rendererType,
        dataSourceConfig: dashboard.dataSourceConfig as Record<string, unknown>,
        rendererConfig: dashboard.rendererConfig as Record<string, unknown>,
      },
      {
        width: targetWidth,
        height: targetHeight,
        title: dashboard.name,
      }
    );

    const normalized =
      output.contentType === 'image/jpeg'
        ? output.buffer
        : await sharp(output.buffer).jpeg({ quality: 90 }).toBuffer();

    return await sharp(normalized)
      .resize(targetWidth, targetHeight, { fit: 'contain', background: BACKGROUND })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  private async renderKioskProgressOverviewFull(
    deviceScopeKey: string,
    slideIntervalSeconds: number,
    seibanPerPage: number
  ): Promise<Buffer> {
    const overview = await getProductionScheduleProgressOverview(deviceScopeKey);
    const scheduled = overview.scheduled;
    if (scheduled.length === 0) {
      return await this.renderMessage('登録製番がありません');
    }

    const totalPages = progressOverviewPageCount(scheduled.length, seibanPerPage);
    if (totalPages < 1) {
      return await this.renderMessage('登録製番がありません');
    }

    const stateKey = `kiosk-progress-overview:${deviceScopeKey}`;
    const pageIndex = getRotatingSlideIndex(this.kioskProgressOverviewSlideState, {
      stateKey,
      totalPages,
      displayMode: 'SLIDESHOW',
      slideIntervalSeconds,
      logContext: { kind: 'kiosk_progress_overview', deviceScopeKey },
    });

    const pageItems = sliceProgressOverviewItems(scheduled, pageIndex, seibanPerPage);
    const svg = buildKioskProgressOverviewSvg(pageItems, WIDTH, HEIGHT);

    return await sharp(Buffer.from(svg), { density: 220 })
      .resize(WIDTH, HEIGHT, { fit: 'fill' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  }

  /**
   * 左右ともにPDF、工具、またはCSVダッシュボードを描画できる汎用SPLITレンダリング
   */
  private async renderSplitWithPanes(
    leftPane: {
      kind: 'pdf' | 'loans' | 'csv_dashboard' | 'visualization';
      tools?: ToolItem[];
      pdfOptions?: SplitPdfOptions;
      csvDashboard?: { id: string; name: string; pageNumber: number; totalPages: number; rows: Array<Record<string, unknown>> };
      visualizationDashboardId?: string;
    },
    rightPane: {
      kind: 'pdf' | 'loans' | 'csv_dashboard' | 'visualization';
      tools?: ToolItem[];
      pdfOptions?: SplitPdfOptions;
      csvDashboard?: { id: string; name: string; pageNumber: number; totalPages: number; rows: Array<Record<string, unknown>> };
      visualizationDashboardId?: string;
    }
  ): Promise<Buffer> {
    // buildSplitWithPanesSvg と同じレイアウト計算で、CSV/可視化をペインサイズに合わせてレンダリングする
    const geometry = computeSplitPaneGeometry({ width: WIDTH, height: HEIGHT });
    const paneContentHeight = geometry.paneContentHeight;
    const leftPaneContentWidth = geometry.leftPaneContentWidth;
    const rightPaneContentWidth = geometry.rightPaneContentWidth;

    // 左右のPDF画像またはCSVダッシュボード画像を事前にBase64エンコード
    let leftImageBase64: string | null = null;
    let rightImageBase64: string | null = null;

    if (leftPane.kind === 'pdf' && leftPane.pdfOptions?.pageUrl) {
      leftImageBase64 = await this.encodePdfPageAsBase64(
        leftPane.pdfOptions.pageUrl,
        Math.round(WIDTH * 0.45),
        Math.round(HEIGHT * 0.85)
      );
    } else if (leftPane.kind === 'csv_dashboard' && leftPane.csvDashboard) {
      // CSVダッシュボードをレンダリングしてBase64エンコード
      const csvDashboardBuffer = await this.renderCsvDashboard(leftPane.csvDashboard.id, leftPane.csvDashboard, {
        canvasWidth: leftPaneContentWidth,
        canvasHeight: paneContentHeight,
      });
      leftImageBase64 = `data:image/jpeg;base64,${csvDashboardBuffer.toString('base64')}`;
    } else if (leftPane.kind === 'visualization' && leftPane.visualizationDashboardId) {
      const visualizationBuffer = await this.renderVisualizationDashboard(leftPane.visualizationDashboardId, {
        canvasWidth: leftPaneContentWidth,
        canvasHeight: paneContentHeight,
      });
      leftImageBase64 = `data:image/jpeg;base64,${visualizationBuffer.toString('base64')}`;
    }

    if (rightPane.kind === 'pdf' && rightPane.pdfOptions?.pageUrl) {
      rightImageBase64 = await this.encodePdfPageAsBase64(
        rightPane.pdfOptions.pageUrl,
        Math.round(WIDTH * 0.45),
        Math.round(HEIGHT * 0.85)
      );
    } else if (rightPane.kind === 'csv_dashboard' && rightPane.csvDashboard) {
      // CSVダッシュボードをレンダリングしてBase64エンコード
      const csvDashboardBuffer = await this.renderCsvDashboard(rightPane.csvDashboard.id, rightPane.csvDashboard, {
        canvasWidth: rightPaneContentWidth,
        canvasHeight: paneContentHeight,
      });
      rightImageBase64 = `data:image/jpeg;base64,${csvDashboardBuffer.toString('base64')}`;
    } else if (rightPane.kind === 'visualization' && rightPane.visualizationDashboardId) {
      const visualizationBuffer = await this.renderVisualizationDashboard(rightPane.visualizationDashboardId, {
        canvasWidth: rightPaneContentWidth,
        canvasHeight: paneContentHeight,
      });
      rightImageBase64 = `data:image/jpeg;base64,${visualizationBuffer.toString('base64')}`;
    }

    const svg = await this.buildSplitWithPanesSvg(
      leftPane,
      rightPane,
      leftImageBase64,
      rightImageBase64
    );

    return await sharp(Buffer.from(svg))
      .resize(WIDTH, HEIGHT)
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  /**
   * 左右ペインのSVGを生成
   */
  private async buildSplitWithPanesSvg(
    leftPane: {
      kind: 'pdf' | 'loans' | 'csv_dashboard' | 'visualization';
      tools?: ToolItem[];
      pdfOptions?: SplitPdfOptions;
      csvDashboard?: { id: string; name: string; pageNumber: number; totalPages: number; rows: Array<Record<string, unknown>> };
    },
    rightPane: {
      kind: 'pdf' | 'loans' | 'csv_dashboard' | 'visualization';
      tools?: ToolItem[];
      pdfOptions?: SplitPdfOptions;
      csvDashboard?: { id: string; name: string; pageNumber: number; totalPages: number; rows: Array<Record<string, unknown>> };
    },
    leftImageBase64: string | null,
    rightImageBase64: string | null
  ): Promise<string> {
    const geometry = computeSplitPaneGeometry({ width: WIDTH, height: HEIGHT });
    const scale = geometry.scale;
    const outerPadding = geometry.outerPadding;
    const gradientId = this.generateId('bg');
    const leftWidth = geometry.leftWidth;
    const rightWidth = geometry.rightWidth;
    const panelHeight = geometry.panelHeight;
    const leftX = geometry.leftX;
    const rightX = geometry.rightX;
    const panelRadius = Math.round(10 * scale);
    const innerPadding = geometry.innerPadding;
    const titleOffsetY = Math.round(22 * scale);
    const headerHeight = geometry.headerHeight;

    const leftTitle = leftPane.kind === 'pdf'
      ? (leftPane.pdfOptions?.title ?? 'PDF表示')
      : leftPane.kind === 'csv_dashboard'
      ? (leftPane.csvDashboard?.name ?? 'CSVダッシュボード')
      : leftPane.kind === 'visualization'
      ? '可視化'
      : '持出中アイテム';
    const rightTitle = rightPane.kind === 'pdf'
      ? (rightPane.pdfOptions?.title ?? 'PDF表示')
      : rightPane.kind === 'csv_dashboard'
      ? (rightPane.csvDashboard?.name ?? 'CSVダッシュボード')
      : rightPane.kind === 'visualization'
      ? '可視化'
      : '持出中アイテム';

    // 左ペインのコンテンツ
    let leftContent = '';
    if (leftPane.kind === 'pdf' && leftImageBase64) {
      leftContent = `<image x="${leftX + innerPadding}" y="${outerPadding + innerPadding + headerHeight}"
        width="${leftWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - headerHeight}"
        preserveAspectRatio="xMidYMid meet"
        href="${leftImageBase64}" />`;
    } else if (leftPane.kind === 'pdf') {
      leftContent = `<text x="${leftX + leftWidth / 2}" y="${outerPadding + panelHeight / 2}"
        text-anchor="middle" font-size="${Math.round(24 * scale)}" fill="#e2e8f0" font-family="sans-serif">
        PDFが設定されていません
      </text>`;
    } else if (leftPane.kind === 'csv_dashboard' && leftImageBase64) {
      leftContent = `<image x="${leftX + innerPadding}" y="${outerPadding + innerPadding + headerHeight}"
        width="${leftWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - headerHeight}"
        preserveAspectRatio="xMidYMid meet"
        href="${leftImageBase64}" />`;
    } else if (leftPane.kind === 'csv_dashboard') {
      leftContent = `<text x="${leftX + leftWidth / 2}" y="${outerPadding + panelHeight / 2}"
        text-anchor="middle" font-size="${Math.round(24 * scale)}" fill="#e2e8f0" font-family="sans-serif">
        CSVダッシュボードが設定されていません
      </text>`;
    } else if (leftPane.kind === 'visualization' && leftImageBase64) {
      leftContent = `<image x="${leftX + innerPadding}" y="${outerPadding + innerPadding + headerHeight}"
        width="${leftWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - headerHeight}"
        preserveAspectRatio="xMidYMid meet"
        href="${leftImageBase64}" />`;
    } else if (leftPane.kind === 'visualization') {
      leftContent = `<text x="${leftX + leftWidth / 2}" y="${outerPadding + panelHeight / 2}"
        text-anchor="middle" font-size="${Math.round(24 * scale)}" fill="#e2e8f0" font-family="sans-serif">
        可視化が設定されていません
      </text>`;
    } else if (leftPane.kind === 'loans') {
      const { cardsSvg, overflowCount } = await this.buildToolCardGrid(leftPane.tools ?? [], {
        x: leftX + innerPadding,
        y: outerPadding + innerPadding + headerHeight,
        width: leftWidth - innerPadding * 2,
        height: panelHeight - innerPadding * 2 - headerHeight,
        ...SPLIT_COMPACT24_LOAN_GRID_BASE,
      });
      leftContent = cardsSvg;
      if (overflowCount > 0) {
        leftContent += `<text x="${leftX + leftWidth - innerPadding}" y="${outerPadding + panelHeight - innerPadding}"
          text-anchor="end" font-size="${Math.round(16 * scale)}" fill="#fcd34d" font-family="sans-serif">
          さらに ${overflowCount} 件
        </text>`;
      }
    }

    // 右ペインのコンテンツ
    let rightContent = '';
    if (rightPane.kind === 'pdf' && rightImageBase64) {
      rightContent = `<image x="${rightX + innerPadding}" y="${outerPadding + innerPadding + headerHeight}"
        width="${rightWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - headerHeight}"
        preserveAspectRatio="xMidYMid meet"
        href="${rightImageBase64}" />`;
    } else if (rightPane.kind === 'pdf') {
      rightContent = `<text x="${rightX + rightWidth / 2}" y="${outerPadding + panelHeight / 2}"
        text-anchor="middle" font-size="${Math.round(24 * scale)}" fill="#e2e8f0" font-family="sans-serif">
        PDFが設定されていません
      </text>`;
    } else if (rightPane.kind === 'csv_dashboard' && rightImageBase64) {
      rightContent = `<image x="${rightX + innerPadding}" y="${outerPadding + innerPadding + headerHeight}"
        width="${rightWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - headerHeight}"
        preserveAspectRatio="xMidYMid meet"
        href="${rightImageBase64}" />`;
    } else if (rightPane.kind === 'csv_dashboard') {
      rightContent = `<text x="${rightX + rightWidth / 2}" y="${outerPadding + panelHeight / 2}"
        text-anchor="middle" font-size="${Math.round(24 * scale)}" fill="#e2e8f0" font-family="sans-serif">
        CSVダッシュボードが設定されていません
      </text>`;
    } else if (rightPane.kind === 'visualization' && rightImageBase64) {
      rightContent = `<image x="${rightX + innerPadding}" y="${outerPadding + innerPadding + headerHeight}"
        width="${rightWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - headerHeight}"
        preserveAspectRatio="xMidYMid meet"
        href="${rightImageBase64}" />`;
    } else if (rightPane.kind === 'visualization') {
      rightContent = `<text x="${rightX + rightWidth / 2}" y="${outerPadding + panelHeight / 2}"
        text-anchor="middle" font-size="${Math.round(24 * scale)}" fill="#e2e8f0" font-family="sans-serif">
        可視化が設定されていません
      </text>`;
    } else if (rightPane.kind === 'loans') {
      const { cardsSvg, overflowCount } = await this.buildToolCardGrid(rightPane.tools ?? [], {
        x: rightX + innerPadding,
        y: outerPadding + innerPadding + headerHeight,
        width: rightWidth - innerPadding * 2,
        height: panelHeight - innerPadding * 2 - headerHeight,
        ...SPLIT_COMPACT24_LOAN_GRID_BASE,
      });
      rightContent = cardsSvg;
      if (overflowCount > 0) {
        rightContent += `<text x="${rightX + rightWidth - innerPadding}" y="${outerPadding + panelHeight - innerPadding}"
          text-anchor="end" font-size="${Math.round(16 * scale)}" fill="#fcd34d" font-family="sans-serif">
          さらに ${overflowCount} 件
        </text>`;
      }
    }

    return `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#020617"/>
            <stop offset="50%" stop-color="#0d162c"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#${gradientId})" />

        <g>
          <rect x="${leftX}" y="${outerPadding}" width="${leftWidth}" height="${panelHeight}"
            rx="${panelRadius}" ry="${panelRadius}"
            fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.08)" />
          <text x="${leftX + innerPadding}" y="${outerPadding + innerPadding + titleOffsetY}"
            font-size="${Math.round(20 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            ${this.escapeXml(leftTitle)}
          </text>
          ${leftContent}
        </g>

        <g>
          <rect x="${rightX}" y="${outerPadding}" width="${rightWidth}" height="${panelHeight}"
            rx="${panelRadius}" ry="${panelRadius}"
            fill="rgba(15,23,42,0.50)" stroke="rgba(255,255,255,0.08)" />
          <text x="${rightX + innerPadding}" y="${outerPadding + innerPadding + titleOffsetY}"
            font-size="${Math.round(20 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            ${this.escapeXml(rightTitle)}
          </text>
          ${rightContent}
        </g>
      </svg>
    `;
  }

  private buildPdfScreenSvg(imageBase64: string, options?: PdfRenderOptions): string {
    const scale = WIDTH / 1920;
    const outerPadding = 0;
    const gradientId = this.generateId('bg');
    const panelWidth = WIDTH - outerPadding * 2;
    const panelHeight = HEIGHT - outerPadding * 2;
    const panelRadius = Math.round(10 * scale);
    const innerPadding = Math.round(12 * scale);

    const slideInfo =
      options?.slideInterval && options.displayMode === 'SLIDESHOW'
        ? `<text x="${outerPadding + panelWidth - innerPadding}" y="${outerPadding + innerPadding}"
            text-anchor="end" font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            ${options.slideInterval}s ごとに切替
          </text>`
        : '';

    return `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#030712"/>
            <stop offset="45%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#${gradientId})" />
        <rect x="${outerPadding}" y="${outerPadding}" width="${panelWidth}" height="${panelHeight}"
          rx="${panelRadius}" ry="${panelRadius}" fill="rgba(15,23,42,0.65)" stroke="rgba(255,255,255,0.08)" />

        <text x="${outerPadding + innerPadding}" y="${outerPadding + innerPadding + Math.round(18 * scale)}"
          font-size="${Math.round(20 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
          ${this.escapeXml(options?.title ?? 'PDF表示')}
        </text>
        ${slideInfo}

        <image x="${outerPadding + innerPadding}" y="${outerPadding + innerPadding + Math.round(32 * scale)}"
          width="${panelWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - Math.round(32 * scale)}"
          preserveAspectRatio="xMidYMid meet"
          href="${imageBase64}" />
      </svg>
    `;
  }

  private buildMessageScreenSvg(message: string, customWidth: number): string {
    const scale = WIDTH / 1920;
    const gradientId = this.generateId('bg');
    const fontSize = Math.round(48 * scale);
    return `
      <svg width="${customWidth}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#030712"/>
            <stop offset="50%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#031525"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#${gradientId})" />
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
          font-size="${fontSize}" font-weight="600" fill="#e2e8f0" font-family="sans-serif">
          ${this.escapeXml(message)}
        </text>
      </svg>
    `;
  }

  private async buildToolCardGrid(tools: ToolItem[], config: ToolGridConfig): Promise<{ cardsSvg: string; overflowCount: number }> {
    const allViews = await buildLoanCardViewModels(
      tools,
      config,
      WIDTH,
      (d) => this.formatBorrowedAt(d),
      this.makeSvgLoanGridDependencies()
    );
    const layout = computeLoanGridLayout(WIDTH, config, allViews);
    const layer = await this.loanGridRasterizer.render({
      canvasWidth: WIDTH,
      config,
      layout,
    });

    if (layer.kind === 'svg_fragment') {
      return { cardsSvg: layer.fragment, overflowCount: layer.overflowCount };
    }

    const href = `data:image/png;base64,${layer.pngBuffer.toString('base64')}`;
    return {
      cardsSvg: `<image x="${config.x}" y="${config.y}" width="${config.width}" height="${config.height}" href="${href}" preserveAspectRatio="none" />`,
      overflowCount: layer.overflowCount,
    };
  }

  private resolvePdfPageLocalPath(pageUrl: string): string | null {
    const parts = pageUrl.split('/');
    if (parts.length < 2) {
      return null;
    }
    const filename = parts.pop();
    const pdfId = parts.pop();
    if (!filename || !pdfId) {
      return null;
    }
    return path.join(PDF_PAGES_DIR, pdfId, filename);
  }

  private async encodeLocalImageAsBase64(
    localPath: string,
    width: number,
    height: number,
    fit: 'cover' | 'contain'
  ): Promise<string | null> {
    try {
      const buffer = await sharp(localPath)
        .resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), {
          fit,
          background: BACKGROUND,
        })
        .jpeg({ quality: 90 })
        .toBuffer();
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to encode image for signage');
      return null;
    }
  }

  private async encodePdfPageAsBase64(pageUrl: string, width: number, height: number): Promise<string | null> {
    const localPath = this.resolvePdfPageLocalPath(pageUrl);
    if (!localPath) {
      return null;
    }
    return await this.encodeLocalImageAsBase64(localPath, width, height, 'contain');
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private resolveThumbnailLocalPath(thumbnailUrl: string): string | null {
    if (!thumbnailUrl.startsWith('/storage/thumbnails/')) {
      return null;
    }
    const thumbnailPath = thumbnailUrl.replace('/storage/thumbnails/', '');
    const storageBaseDir = process.env.PHOTO_STORAGE_DIR || '/app/storage';
    return path.join(storageBaseDir, 'thumbnails', thumbnailPath);
  }

  private getCurrentPdfPageIndex(
    totalPages: number,
    displayMode: string,
    slideInterval: number | null,
    pdfId?: string
  ): number {
    return getRotatingSlideIndex(this.pdfSlideState, {
      stateKey: pdfId,
      totalPages,
      displayMode,
      slideIntervalSeconds: slideInterval,
      logContext: { pdfId, kind: 'pdf' },
    });
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatBorrowedAt(isoDate?: string | null): string | null {
    if (!isoDate) {
      return null;
    }
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    // 日本時間（JST）でフォーマット
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: env.SIGNAGE_TIMEZONE,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const month = parts.find(p => p.type === 'month')?.value ?? '';
    const day = parts.find(p => p.type === 'day')?.value ?? '';
    const hour = parts.find(p => p.type === 'hour')?.value ?? '';
    const minute = parts.find(p => p.type === 'minute')?.value ?? '';
    return `${month}/${day} ${hour}:${minute}`;
  }

  private isOver12Hours(isoDate?: string | null): boolean {
    if (!isoDate) {
      return false;
    }
    const borrowedDate = new Date(isoDate);
    if (Number.isNaN(borrowedDate.getTime())) {
      return false;
    }
    // 現在時刻との差分を計算（UTC時刻で計算してから時間差を算出）
    const now = new Date();
    const diffMs = now.getTime() - borrowedDate.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours > 12;
  }

  /**
   * Pi3のサイネージ端末の温度・CPU負荷を取得（ClientStatusから）
   * Pi3のClientDeviceを特定して、そのstatusClientIdでClientStatusを取得
   */
  private async getClientSystemMetricsText(): Promise<string | null> {
    try {
      // Pi3のサイネージ端末を特定（apiKeyが'client-key-raspberrypi3-signage1'のもの）
      const pi3Client = await prisma.clientDevice.findUnique({
        where: { apiKey: 'client-key-raspberrypi3-signage1' }
      }) as { statusClientId?: string | null } | null;

      if (!pi3Client || !pi3Client.statusClientId) {
        // Pi3のClientDeviceが見つからない、またはstatusClientIdが設定されていない場合は
        // Pi5サーバー自身の温度を表示（フォールバック）
        return await this.getSystemMetricsText();
      }

      // ClientStatusからPi3の温度・CPU負荷を取得
      const clientStatus = await prisma.clientStatus.findUnique({
        where: { clientId: pi3Client.statusClientId }
      });

      if (!clientStatus) {
        // ClientStatusが見つからない場合はPi5サーバー自身の温度を表示（フォールバック）
        return await this.getSystemMetricsText();
      }

      const cpuText = clientStatus.cpuUsage !== null ? `CPU ${clientStatus.cpuUsage.toFixed(0)}%` : null;
      const temperature = clientStatus.temperature !== null ? `${clientStatus.temperature.toFixed(1)}°C` : null;

      if (!cpuText && !temperature) {
        return null;
      }

      return [cpuText, temperature ? `Temp ${temperature}` : null].filter(Boolean).join('  ');
    } catch (error) {
      logger.warn({ err: error }, 'Failed to get client system metrics, falling back to server metrics');
      // エラー時はPi5サーバー自身の温度を表示（フォールバック）
      return await this.getSystemMetricsText();
    }
  }

  /**
   * Pi5サーバー自身の温度・CPU負荷を取得（/sys/class/thermal/thermal_zone0/tempから）
   * フォールバック用
   */
  private async getSystemMetricsText(): Promise<string | null> {
    try {
      const [cpuPercent, tempRaw] = await Promise.all([
        this.getCpuUsagePercent(),
        fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8').catch(() => null),
      ]);

      const cpuText = cpuPercent !== null ? `CPU ${cpuPercent.toFixed(0)}%` : null;
      const temperature = tempRaw ? `${(Number(tempRaw.trim()) / 1000).toFixed(1)}°C` : null;

      if (!cpuText && !temperature) {
        return null;
      }

      return [cpuText, temperature ? `Temp ${temperature}` : null].filter(Boolean).join('  ');
    } catch {
      return null;
    }
  }

  private async getCpuUsagePercent(): Promise<number | null> {
    try {
      const statRaw = await fs.readFile('/proc/stat', 'utf8');
      const cpuLine = statRaw.split('\n')[0];
      const numbers = cpuLine.trim().split(/\s+/).slice(1).map(Number);

      if (numbers.length < 4) {
        return null;
      }

      const idle = numbers[3] + (numbers[4] ?? 0); // idle + iowait
      const total = numbers.reduce((sum, value) => sum + value, 0);

      if (!this.lastCpuSample) {
        this.lastCpuSample = { idle, total };
        return null;
      }

      const idleDiff = idle - this.lastCpuSample.idle;
      const totalDiff = total - this.lastCpuSample.total;
      this.lastCpuSample = { idle, total };

      if (totalDiff <= 0) {
        return null;
      }

      const usage = (1 - idleDiff / totalDiff) * 100;
      return Math.max(0, Math.min(100, usage));
    } catch {
      return null;
    }
  }
}

