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
} from './signage-layout.types.js';

// 環境変数で解像度を設定可能（デフォルト: 1920x1080、4K: 3840x2160）
// 50インチモニタで近くから見る場合は4K推奨
const WIDTH = parseInt(process.env.SIGNAGE_RENDER_WIDTH || '1920', 10);
const HEIGHT = parseInt(process.env.SIGNAGE_RENDER_HEIGHT || '1080', 10);
const BACKGROUND = '#020617';

type ToolItem = NonNullable<SignageContentResponse['tools']>[number] & {
  isOver12Hours?: boolean;
  isOverdue?: boolean;
};

interface ToolGridConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: 'FULL' | 'SPLIT';
  showThumbnails: boolean;
  maxRows?: number;
  maxColumns?: number;
}

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
  private readonly pdfSlideState = new Map<string, { lastIndex: number; lastRenderedAt: number }>();
  private lastCpuSample: { idle: number; total: number } | null = null;

  constructor(private readonly signageService: SignageService) {}

  async renderCurrentContent(): Promise<{
    renderedAt: Date;
    filename: string;
  }> {
    const renderStartTime = Date.now();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:53',message:'renderCurrentContent started',data:{renderStartTime},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    const content = await this.signageService.getContent();
    // #region agent log
    logger.info({ location: 'signage.renderer.ts:53', hypothesisId: 'E', contentType: content.contentType, hasLayoutConfig: content.layoutConfig != null, layoutConfig: content.layoutConfig }, 'renderCurrentContent got content');
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:57',message:'Content retrieved',data:{contentType:content.contentType,hasLayoutConfig:content.layoutConfig!=null,pdfId:content.pdf?.id,pdfPages:content.pdf?.pages?.length,displayMode:content.displayMode,slideInterval:content.pdf?.slideInterval},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    const buffer = await this.renderContent(content);
    // #region agent log
    logger.info({ location: 'signage.renderer.ts:58', hypothesisId: 'E', bufferSize: buffer.length }, 'renderContent completed');
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:61',message:'Content rendered',data:{bufferSize:buffer.length,renderDuration:Date.now()-renderStartTime},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    const result = await SignageRenderStorage.saveRenderedImage(buffer);
    // #region agent log
    logger.info({ location: 'signage.renderer.ts:59', hypothesisId: 'C', filename: result.filename }, 'Image saved');
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:65',message:'Image saved',data:{filename:result.filename,totalDuration:Date.now()-renderStartTime},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return {
      renderedAt: new Date(),
      filename: result.filename
    };
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
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:161',message:'Rendering PDF page',data:{pdfId:pdf.id,pdfPageIndex,pageNumber,totalPages:pdf.pages.length,pageUrl:pageUrl.substring(0,50)+'...'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        return await this.renderPdfImage(pageUrl, {
          title: pdf.name,
          slideInterval: pdfConfig.slideInterval ?? null,
          displayMode: pdfConfig.displayMode,
        });
      } else if (slot.kind === 'loans') {
        return await this.renderTools(content.tools ?? []);
      }
    } else if (layoutConfig.layout === 'SPLIT') {
      // 左右分割表示
      const leftSlot = layoutConfig.slots.find((s) => s.position === 'LEFT');
      const rightSlot = layoutConfig.slots.find((s) => s.position === 'RIGHT');

      let leftTools: ToolItem[] = [];
      let rightTools: ToolItem[] = [];
      let leftPdfOptions: SplitPdfOptions | undefined;
      let rightPdfOptions: SplitPdfOptions | undefined;

      // 左スロットの処理
      if (leftSlot?.kind === 'loans') {
        leftTools = (content.tools ?? []).map((tool) => ({
          ...tool,
          isOver12Hours: this.isOver12Hours(tool.borrowedAt),
        }));
      } else if (leftSlot?.kind === 'pdf') {
        const pdfConfig = leftSlot.config as PdfSlotConfig;
        const pdf = content.pdf;
        if (pdf && pdf.pages?.length) {
          const pdfPageIndex = this.getCurrentPdfPageIndex(
            pdf.pages.length,
            pdfConfig.displayMode === 'SLIDESHOW' ? 'SLIDESHOW' : 'SINGLE',
            pdfConfig.slideInterval || null,
            pdf.id
          );
          leftPdfOptions = {
            pageUrl: pdf.pages[pdfPageIndex],
            title: pdf.name,
            slideInterval: pdfConfig.slideInterval ?? null,
            displayMode: pdfConfig.displayMode,
          };
        }
      }

      // 右スロットの処理
      if (rightSlot?.kind === 'loans') {
        rightTools = (content.tools ?? []).map((tool) => ({
          ...tool,
          isOver12Hours: this.isOver12Hours(tool.borrowedAt),
        }));
      } else if (rightSlot?.kind === 'pdf') {
        const pdfConfig = rightSlot.config as PdfSlotConfig;
        const pdf = content.pdf;
        if (pdf && pdf.pages?.length) {
          const pdfPageIndex = this.getCurrentPdfPageIndex(
            pdf.pages.length,
            pdfConfig.displayMode === 'SLIDESHOW' ? 'SLIDESHOW' : 'SINGLE',
            pdfConfig.slideInterval || null,
            pdf.id
          );
          rightPdfOptions = {
            pageUrl: pdf.pages[pdfPageIndex],
            title: pdf.name,
            slideInterval: pdfConfig.slideInterval ?? null,
            displayMode: pdfConfig.displayMode,
          };
        }
      }

      // 左がPDF、右が工具管理の場合は順序を入れ替えて呼び出す
      if (leftSlot?.kind === 'pdf' && rightSlot?.kind === 'loans') {
        return await this.renderSplit(rightTools, leftPdfOptions, true);
      } else {
        // 左が工具管理、右がPDFの通常ケース
        return await this.renderSplit(leftTools, rightPdfOptions, false);
      }
    }

    return await this.renderMessage('表示するコンテンツがありません');
  }

  private async renderPdfImage(pageUrl: string, options?: PdfRenderOptions): Promise<Buffer> {
    const renderStartTime = Date.now();
    // #region agent log
    const pageUrlShort = pageUrl.substring(0, 50) + '...';
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:246',message:'renderPdfImage started',data:{pageUrl:pageUrlShort,renderStartTime},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    const imageBase64 = await this.encodePdfPageAsBase64(pageUrl, Math.round(WIDTH * 0.7), Math.round(HEIGHT * 0.75));
    // #region agent log
    const encodeTime = Date.now() - renderStartTime;
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:249',message:'PDF page encoded',data:{pageUrl:pageUrlShort,encodeTime,hasImageBase64:!!imageBase64},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    if (!imageBase64) {
      return await this.renderMessage('PDFページが見つかりません');
    }

    const svg = this.buildPdfScreenSvg(imageBase64, options);
    const buffer = await sharp(Buffer.from(svg), { density: 220 })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    // #region agent log
    const totalRenderTime = Date.now() - renderStartTime;
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:255',message:'renderPdfImage completed',data:{pageUrl:pageUrlShort,bufferSize:buffer.length,totalRenderTime,encodeTime},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return buffer;
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
    const scale = WIDTH / 1920;
    const gap = Math.round(14 * scale);
    const desiredColumns = config.maxColumns ?? 2;
    const idealCardWidth = Math.round((config.mode === 'FULL' ? 360 : 300) * scale);
    let columns = Math.max(1, Math.floor((config.width + gap) / (idealCardWidth + gap)));
    columns = Math.min(columns, desiredColumns);
    const cardWidth = Math.floor((config.width - gap * (columns - 1)) / columns);
    const cardHeight = Math.round(140 * scale);
    const maxRows =
      config.maxRows ??
      Math.max(1, Math.floor((config.height + gap) / (cardHeight + gap)));
    const maxItems = columns * maxRows;
    const displayTools = tools.slice(0, maxItems);
    const overflowCount = Math.max(0, tools.length - displayTools.length);
        const cardRadius = Math.round(12 * scale);
        const cardPadding = Math.round(12 * scale);
        const thumbnailSize = Math.round(96 * scale);
        const thumbnailWidth = thumbnailSize;
        const thumbnailHeight = thumbnailSize;
        const thumbnailGap = Math.round(12 * scale);

    const cards = await Promise.all(
      displayTools.map(async (tool, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = config.x + column * (cardWidth + gap);
        const y = config.y + row * (cardHeight + gap);
        const borrowedText = this.formatBorrowedAt(tool.borrowedAt) ?? '';
        const [borrowedDate, borrowedTime] = borrowedText.split(' ');
        const primaryText = tool.name || '写真撮影モード';
        const secondary = tool.employeeName ? `${tool.employeeName} さん` : '未割当';
        const isInstrument = Boolean(tool.isInstrument);
        const isRigging = Boolean(tool.isRigging);
        const managementText = isInstrument || isRigging
          ? (tool.managementNumber || tool.itemCode || '')
          : (tool.itemCode || '');
        // 提案3カラーパレット: 工場現場特化・高視認性テーマ
        // 工具: bg-blue-500 (RGB: 59,130,246), ボーダー: border-blue-700 (RGB: 29,78,216)
        // 計測機器: bg-purple-600 (RGB: 147,51,234), ボーダー: border-purple-800 (RGB: 107,33,168)
        // 吊具: bg-orange-500 (RGB: 249,115,22), ボーダー: border-orange-700 (RGB: 194,65,12)
        const cardFill = isInstrument
          ? 'rgba(147,51,234,1.0)' // purple-600
          : isRigging
            ? 'rgba(249,115,22,1.0)' // orange-500
            : 'rgba(59,130,246,1.0)'; // blue-500
        // 超過アイテムの判定（isOver12Hours または isOverdue）
        const isExceeded = tool.isOver12Hours || Boolean(tool.isOverdue);
        
        // 超過アイテムは赤い太枠、それ以外は通常のボーダー
        const cardStroke = isExceeded
          ? 'rgba(220,38,38,1.0)' // red-600 赤い太枠
          : isInstrument
            ? 'rgba(107,33,168,1.0)' // purple-800
            : isRigging
              ? 'rgba(194,65,12,1.0)' // orange-700
              : 'rgba(29,78,216,1.0)'; // blue-700
        const strokeWidth = isExceeded
          ? Math.max(4, Math.round(4 * scale)) // 超過アイテムは4px以上の太枠
          : Math.max(2, Math.round(2 * scale)); // 通常は2px以上
        const clipId = this.generateId(`thumb-${index}`);
        let thumbnailElement = '';
        let hasThumbnail = false;

        if (config.showThumbnails && tool.thumbnailUrl) {
          const thumbnailPath = this.resolveThumbnailLocalPath(tool.thumbnailUrl);
          if (thumbnailPath) {
            const base64 = await this.encodeLocalImageAsBase64(
              thumbnailPath,
              thumbnailWidth,
              thumbnailHeight,
              'cover'
            );
            if (base64) {
              hasThumbnail = true;
              const thumbnailX = x + cardPadding;
              const thumbnailY = y + Math.round((cardHeight - thumbnailHeight) / 2);
              thumbnailElement = `
                <clipPath id="${clipId}">
                  <rect x="${thumbnailX}" y="${thumbnailY}"
                    width="${thumbnailWidth}" height="${thumbnailHeight}" rx="${Math.round(8 * scale)}" ry="${Math.round(8 * scale)}" />
                </clipPath>
                <image x="${thumbnailX}" y="${thumbnailY}"
                  width="${thumbnailWidth}" height="${thumbnailHeight}"
                  href="${base64}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />
              `;
            }
          }
        }

        // テキストエリアのX座標: サムネイルがある場合は右側、ない場合は左側から開始
        const textAreaX = hasThumbnail
          ? cardPadding + thumbnailSize + thumbnailGap
          : cardPadding;

        const textStartY = y + cardPadding;
        const textX = x + textAreaX;
        // 統一された情報の並び順: 名称、従業員名、日付+時刻（横並び）、警告
        // すべてのアイテム種別（工具/計測機器/吊具）で同じ順序に統一
        const primaryY = textStartY + Math.round(20 * scale); // 名称の位置（全アイテム共通）
        const nameY = primaryY + Math.round(28 * scale); // primaryText(18px) + 28px間隔（約1.6倍）
        const dateTimeY = nameY + Math.round(26 * scale); // secondary(16px) + 26px間隔（約1.6倍）
        // 日付と時刻を横並びに配置（同じY座標、X座標をずらす）
        const dateX = textX;
        const timeX = textX + (borrowedDate ? Math.round(80 * scale) : 0); // 日付の右側に時刻を配置（日付がない場合は左端から）
        const warningY = dateTimeY + Math.round(24 * scale); // date/time(14px) + 24px間隔（約1.7倍）
        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${cardRadius}" ry="${cardRadius}"
              fill="${cardFill}" stroke="${cardStroke}" stroke-width="${strokeWidth}" />
            ${thumbnailElement}
            <text x="${textX}" y="${primaryY}"
              font-size="${Math.max(16, Math.round(18 * scale))}" font-weight="700" fill="#ffffff" font-family="sans-serif">
              ${this.escapeXml(primaryText)}
            </text>
            <text x="${textX}" y="${nameY}"
              font-size="${Math.max(14, Math.round(16 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${this.escapeXml(secondary)}
            </text>
            <text x="${dateX}" y="${dateTimeY}"
              font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${borrowedDate ? this.escapeXml(borrowedDate) : ''}
            </text>
            <text x="${timeX}" y="${dateTimeY}"
              font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${borrowedTime ? this.escapeXml(borrowedTime) : ''}
            </text>
            ${isExceeded
              ? `<text x="${textX}" y="${warningY}"
                  font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="700" fill="#ffffff" font-family="sans-serif">
                  ⚠ 期限超過
                </text>`
              : ''
            }
            <text x="${x + cardWidth - cardPadding}" y="${y + cardHeight - cardPadding}"
              text-anchor="end" font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="monospace">
              ${this.escapeXml(managementText || tool.itemCode || '')}
            </text>
          </g>
        `;
      })
    );

    if (cards.length === 0) {
      cards.push(`
        <text x="${config.x}" y="${config.y + Math.round(40 * scale)}"
          font-size="${Math.round(28 * scale)}" fill="#ffffff" font-family="sans-serif">
          表示するアイテムがありません
        </text>
      `);
    }

    return {
      cardsSvg: cards.join('\n'),
      overflowCount,
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:745',message:'getCurrentPdfPageIndex called',data:{totalPages,displayMode,slideInterval,pdfId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (totalPages === 0) {
      if (pdfId) {
        this.pdfSlideState.delete(pdfId);
      }
      return 0;
    }

    if (displayMode === 'SLIDESHOW' && slideInterval && slideInterval > 0 && pdfId) {
      const now = Date.now();
      const slideIntervalMs = slideInterval * 1000;
      const state = this.pdfSlideState.get(pdfId);

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:761',message:'State retrieved',data:{pdfId,hasState:!!state,state:state?{lastIndex:state.lastIndex,lastRenderedAt:state.lastRenderedAt,elapsed:now-state.lastRenderedAt}:null,now,slideIntervalMs},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      if (!state) {
        this.pdfSlideState.set(pdfId, { lastIndex: 0, lastRenderedAt: now });
        logger.info({
          pdfId,
          totalPages,
          slideInterval,
          lastIndex: 0,
          reason: 'initialized state',
        }, 'PDF slide show page index calculated');
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:772',message:'State initialized',data:{pdfId,lastIndex:0,lastRenderedAt:now},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        return 0;
      }

      const elapsed = now - state.lastRenderedAt;
      let steps = Math.floor(elapsed / slideIntervalMs);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:776',message:'Steps calculated (before adjustment)',data:{pdfId,elapsed,slideIntervalMs,stepsBeforeAdjust:steps,lastIndex:state.lastIndex,totalPages},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      if (steps <= 0) {
        steps = 1;
      } else {
        steps = steps % totalPages;
        if (steps === 0) {
          steps = 1;
        }
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:784',message:'Steps calculated (after adjustment)',data:{pdfId,stepsAfterAdjust:steps,lastIndex:state.lastIndex,totalPages},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      const nextIndex = (state.lastIndex + steps) % totalPages;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:786',message:'Next index calculated',data:{pdfId,lastIndex:state.lastIndex,steps,nextIndex,totalPages,expectedSequence:Array.from({length:totalPages},(_,i)=>(state.lastIndex+i+1)%totalPages).slice(0,5)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      this.pdfSlideState.set(pdfId, { lastIndex: nextIndex, lastRenderedAt: now });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'signage.renderer.ts:787',message:'State updated',data:{pdfId,lastIndex:nextIndex,lastRenderedAt:now},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      logger.info({
        pdfId,
        totalPages,
        slideInterval,
        elapsed,
        steps,
        nextIndex,
      }, 'PDF slide show page index calculated');

      return nextIndex;
    }

    if (pdfId) {
      this.pdfSlideState.delete(pdfId);
    }

    return 0;
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

