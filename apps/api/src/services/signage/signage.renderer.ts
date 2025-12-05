import sharp from 'sharp';
import path from 'path';
import { promises as fs } from 'fs';
import type { SignageService, SignageContentResponse } from './signage.service.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { PDF_PAGES_DIR } from '../../lib/pdf-storage.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

// 環境変数で解像度を設定可能（デフォルト: 1920x1080、4K: 3840x2160）
// 50インチモニタで近くから見る場合は4K推奨
const WIDTH = parseInt(process.env.SIGNAGE_RENDER_WIDTH || '1920', 10);
const HEIGHT = parseInt(process.env.SIGNAGE_RENDER_HEIGHT || '1080', 10);
const BACKGROUND = '#020617';

type ToolItem = NonNullable<SignageContentResponse['tools']>[number] & {
  isOver12Hours?: boolean;
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
}

export class SignageRenderer {
  private readonly pdfSlideState = new Map<string, { lastIndex: number; lastRenderedAt: number }>();
  private lastCpuSample: { idle: number; total: number } | null = null;

  constructor(private readonly signageService: SignageService) {}

  async renderCurrentContent(): Promise<{
    renderedAt: Date;
    filename: string;
  }> {
    const content = await this.signageService.getContent();
    const buffer = await this.renderContent(content);
    const result = await SignageRenderStorage.saveRenderedImage(buffer);
    return {
      renderedAt: new Date(),
      filename: result.filename
    };
  }

  private async renderContent(content: SignageContentResponse): Promise<Buffer> {
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
    const metricsText = await this.getSystemMetricsText();
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

  private async renderSplit(tools: ToolItem[], pdfOptions?: SplitPdfOptions): Promise<Buffer> {
    const metricsText = await this.getSystemMetricsText();
    const enrichedTools: ToolItem[] = tools.map((tool) => ({
      ...tool,
      isOver12Hours: this.isOver12Hours(tool.borrowedAt),
    }));

    let pdfImageBase64: string | null = null;
    if (pdfOptions?.pageUrl) {
      pdfImageBase64 = await this.encodePdfPageAsBase64(pdfOptions.pageUrl, Math.round(WIDTH * 0.35), Math.round(HEIGHT * 0.7));
    }

    const svg = await this.buildSplitScreenSvg(enrichedTools, {
      ...pdfOptions,
      imageBase64: pdfImageBase64,
    }, metricsText);

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
    const outerPadding = Math.round(60 * scale);
    const accentColor = '#34d399';
    const gradientId = this.generateId('bg');
    const panelWidth = WIDTH - outerPadding * 2;
    const panelHeight = HEIGHT - outerPadding * 2;
    const panelX = outerPadding;
    const panelY = outerPadding;
    const headerHeight = Math.round(90 * scale);
    const innerPadding = Math.round(48 * scale);

    const { cardsSvg, overflowCount } = await this.buildToolCardGrid(tools, {
      x: panelX + innerPadding,
      y: panelY + innerPadding + headerHeight,
      width: panelWidth - innerPadding * 2,
      height: panelHeight - innerPadding * 2 - headerHeight,
      mode: 'FULL',
      showThumbnails: true,
      maxRows: 3,
    });

    const overflowBadge =
      overflowCount > 0
        ? `<text x="${panelX + panelWidth - innerPadding}" y="${panelY + panelHeight - innerPadding / 2}"
            text-anchor="end" font-size="${Math.round(28 * scale)}" fill="#fcd34d" font-family="sans-serif">
            さらに ${overflowCount} 件
          </text>`
        : '';

    const metricsElement = metricsText
      ? `<text x="${panelX + panelWidth - innerPadding}" y="${panelY + innerPadding}"
          text-anchor="end" font-size="${Math.round(28 * scale)}" fill="#cbd5f5" font-family="sans-serif">
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
          <text x="${panelX}" y="${panelY - Math.round(10 * scale)}" fill="${accentColor}" font-size="${Math.round(
            18 * scale
          )}" letter-spacing="${Math.round(scale * 6)}" font-family="sans-serif">TOOLS OVERVIEW</text>
          <rect x="${panelX}" y="${panelY}" rx="${Math.round(32 * scale)}" ry="${Math.round(
      32 * scale
    )}" width="${panelWidth}" height="${panelHeight}"
            fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />

          <text x="${panelX + innerPadding}" y="${panelY + innerPadding + Math.round(36 * scale)}"
            font-size="${Math.round(48 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
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
    metricsText?: string | null
  ): Promise<string> {
    const scale = WIDTH / 1920;
    const outerPadding = Math.round(48 * scale);
    const panelGap = Math.round(32 * scale);
    const gradientId = this.generateId('bg');
    const leftWidth = Math.round((WIDTH - outerPadding * 2 - panelGap) * 0.58);
    const rightWidth = WIDTH - outerPadding * 2 - panelGap - leftWidth;
    const panelHeight = HEIGHT - outerPadding * 2;
    const leftX = outerPadding;
    const rightX = leftX + leftWidth + panelGap;
    const panelRadius = Math.round(28 * scale);
    const innerPadding = Math.round(32 * scale);
    const headerHeight = Math.round(80 * scale);

    const { cardsSvg, overflowCount } = await this.buildToolCardGrid(tools, {
      x: leftX + innerPadding,
      y: outerPadding + innerPadding + headerHeight,
      width: leftWidth - innerPadding * 2,
      height: panelHeight - innerPadding * 2 - headerHeight,
      mode: 'SPLIT',
      showThumbnails: false,
      maxRows: 4,
      maxColumns: 2,
    });

    const overflowBadge =
      overflowCount > 0
        ? `<text x="${leftX + leftWidth - innerPadding}" y="${outerPadding + panelHeight - innerPadding}"
            text-anchor="end" font-size="${Math.round(24 * scale)}" fill="#fcd34d" font-family="sans-serif">
            さらに ${overflowCount} 件
          </text>`
        : '';

    const pdfContent = pdfOptions?.imageBase64
      ? `<image x="${rightX + innerPadding}" y="${outerPadding + innerPadding + headerHeight}"
          width="${rightWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - headerHeight}"
          preserveAspectRatio="xMidYMid meet"
          href="${pdfOptions.imageBase64}" />`
      : `<text x="${rightX + rightWidth / 2}" y="${outerPadding + panelHeight / 2}"
          text-anchor="middle" font-size="${Math.round(32 * scale)}" fill="#e2e8f0" font-family="sans-serif">
          PDFが設定されていません
        </text>`;

    const slideInfo =
      pdfOptions?.slideInterval && pdfOptions.displayMode === 'SLIDESHOW'
        ? `<text x="${rightX + rightWidth - innerPadding}" y="${outerPadding + innerPadding + Math.round(
            34 * scale
          )}" text-anchor="end" font-size="${Math.round(24 * scale)}" fill="#cbd5f5" font-family="sans-serif">
            ${pdfOptions.slideInterval}s 間隔
          </text>`
        : '';

    const metricsElement = metricsText
      ? `<text x="${leftX + leftWidth - innerPadding}" y="${outerPadding + innerPadding + Math.round(
          32 * scale
        )}" text-anchor="end" font-size="${Math.round(24 * scale)}" fill="#cbd5f5" font-family="sans-serif">
          ${this.escapeXml(metricsText)}
        </text>`
      : '';

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
            fill="rgba(15,23,42,0.65)" stroke="rgba(255,255,255,0.08)" />
          <text x="${leftX + innerPadding}" y="${outerPadding + innerPadding + Math.round(32 * scale)}"
            font-size="${Math.round(20 * scale)}" fill="#6ee7b7" letter-spacing="${Math.round(scale * 4)}"
            font-family="sans-serif">TOOLS</text>
          <text x="${leftX + innerPadding}" y="${outerPadding + innerPadding + Math.round(70 * scale)}"
            font-size="${Math.round(40 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            工具データ
          </text>
          ${metricsElement}
          ${cardsSvg}
          ${overflowBadge}
        </g>

        <g>
          <rect x="${rightX}" y="${outerPadding}" width="${rightWidth}" height="${panelHeight}"
            rx="${panelRadius}" ry="${panelRadius}"
            fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.08)" />
          <text x="${rightX + innerPadding}" y="${outerPadding + innerPadding + Math.round(32 * scale)}"
            font-size="${Math.round(20 * scale)}" fill="#93c5fd" letter-spacing="${Math.round(scale * 4)}"
            font-family="sans-serif">DOCUMENT</text>
          <text x="${rightX + innerPadding}" y="${outerPadding + innerPadding + Math.round(70 * scale)}"
            font-size="${Math.round(40 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            ${this.escapeXml(pdfOptions?.title ?? 'PDF表示')}
          </text>
          ${slideInfo}
          ${pdfContent}
        </g>
      </svg>
    `;
  }

  private buildPdfScreenSvg(imageBase64: string, options?: PdfRenderOptions): string {
    const scale = WIDTH / 1920;
    const outerPadding = Math.round(60 * scale);
    const gradientId = this.generateId('bg');
    const panelWidth = WIDTH - outerPadding * 2;
    const panelHeight = HEIGHT - outerPadding * 2;
    const panelRadius = Math.round(32 * scale);
    const innerPadding = Math.round(40 * scale);

    const slideInfo =
      options?.slideInterval && options.displayMode === 'SLIDESHOW'
        ? `<text x="${outerPadding + panelWidth - innerPadding}" y="${outerPadding + innerPadding}"
            text-anchor="end" font-size="${Math.round(26 * scale)}" fill="#cbd5f5" font-family="sans-serif">
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

        <text x="${outerPadding}" y="${outerPadding - Math.round(8 * scale)}"
          fill="#a5b4fc" font-size="${Math.round(18 * scale)}" letter-spacing="${Math.round(scale * 6)}"
          font-family="sans-serif">DOCUMENT</text>

        <text x="${outerPadding + innerPadding}" y="${outerPadding + innerPadding + Math.round(36 * scale)}"
          font-size="${Math.round(46 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
          ${this.escapeXml(options?.title ?? 'PDF表示')}
        </text>
        ${slideInfo}

        <image x="${outerPadding + innerPadding}" y="${outerPadding + innerPadding + Math.round(70 * scale)}"
          width="${panelWidth - innerPadding * 2}" height="${panelHeight - innerPadding * 2 - Math.round(70 * scale)}"
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
    const gap = Math.round((config.mode === 'FULL' ? 28 : 22) * scale);
    const idealCardWidth = (config.mode === 'FULL' ? 320 : 300) * scale;
    let columns = Math.max(1, Math.floor((config.width + gap) / (idealCardWidth + gap)));
    if (config.maxColumns) {
      columns = Math.min(columns, config.maxColumns);
    }
    const cardWidth = Math.floor((config.width - gap * (columns - 1)) / columns);
    const cardHeight = Math.round((config.mode === 'FULL' ? 220 : 190) * scale);
    const maxRows =
      config.maxRows ??
      Math.max(1, Math.floor((config.height + gap) / (cardHeight + gap)));
    const maxItems = columns * maxRows;
    const displayTools = tools.slice(0, maxItems);
    const overflowCount = Math.max(0, tools.length - displayTools.length);
    const cardRadius = Math.round(24 * scale);
    const cardPadding = Math.round(22 * scale);
    const thumbnailHeight = Math.round(cardHeight * 0.45);

    const cards = await Promise.all(
      displayTools.map(async (tool, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = config.x + column * (cardWidth + gap);
        const y = config.y + row * (cardHeight + gap);
        const statusColor = tool.isOver12Hours ? '#f43f5e' : '#34d399';
        const statusLabel = tool.employeeName ? '持出中' : '待機';
        const borrowedText = this.formatBorrowedAt(tool.borrowedAt);
        const primaryText = tool.name ?? tool.itemCode;
        const secondary = tool.employeeName ? `${tool.employeeName} さん` : '未割当';
        const detail = borrowedText ? `${borrowedText} 持出` : '';
        let thumbnailElement = '';

        if (config.showThumbnails && tool.thumbnailUrl) {
          const thumbnailPath = this.resolveThumbnailLocalPath(tool.thumbnailUrl);
          if (thumbnailPath) {
            const base64 = await this.encodeLocalImageAsBase64(thumbnailPath, cardWidth - cardPadding * 2, thumbnailHeight, 'cover');
            if (base64) {
              thumbnailElement = `
                <image x="${x + cardPadding}" y="${y + cardPadding}"
                  width="${cardWidth - cardPadding * 2}" height="${thumbnailHeight}"
                  href="${base64}" preserveAspectRatio="xMidYMid slice" />
              `;
            }
          }
        }

        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${cardRadius}" ry="${cardRadius}"
              fill="rgba(8,15,36,0.85)" stroke="rgba(255,255,255,0.08)" />
            <circle cx="${x + cardPadding}" cy="${y + cardPadding}" r="${Math.round(6 * scale)}" fill="${statusColor}" />
            <text x="${x + cardPadding + Math.round(16 * scale)}" y="${y + cardPadding + Math.round(6 * scale)}"
              font-size="${Math.round(22 * scale)}" fill="${statusColor}" font-family="sans-serif">
              ${statusLabel}
            </text>
            ${thumbnailElement}
            <text x="${x + cardPadding}" y="${y + cardPadding + (config.showThumbnails ? thumbnailHeight + Math.round(36 * scale) : Math.round(46 * scale))}"
              font-size="${Math.round(30 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${this.escapeXml(primaryText)}
            </text>
            <text x="${x + cardPadding}" y="${y + cardHeight - cardPadding - Math.round(32 * scale)}"
              font-size="${Math.round(22 * scale)}" fill="#cbd5f5" font-family="sans-serif">
              ${this.escapeXml(secondary)}
            </text>
            ${
              detail
                ? `<text x="${x + cardPadding}" y="${y + cardHeight - cardPadding - Math.round(8 * scale)}"
                    font-size="${Math.round(20 * scale)}" fill="#94a3b8" font-family="sans-serif">
                    ${this.escapeXml(detail)}
                  </text>`
                : ''
            }
            <text x="${x + cardWidth - cardPadding}" y="${y + cardHeight - cardPadding}"
              text-anchor="end" font-size="${Math.round(20 * scale)}" fill="#e2e8f0" font-family="monospace">
              ${this.escapeXml(tool.itemCode)}
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

      if (!state) {
        this.pdfSlideState.set(pdfId, { lastIndex: 0, lastRenderedAt: now });
        logger.info({
          pdfId,
          totalPages,
          slideInterval,
          lastIndex: 0,
          reason: 'initialized state',
        }, 'PDF slide show page index calculated');
        return 0;
      }

      const elapsed = now - state.lastRenderedAt;
      let steps = Math.floor(elapsed / slideIntervalMs);
      if (steps <= 0) {
        steps = 1;
      } else {
        steps = steps % totalPages;
        if (steps === 0) {
          steps = 1;
        }
      }

      const nextIndex = (state.lastIndex + steps) % totalPages;
      this.pdfSlideState.set(pdfId, { lastIndex: nextIndex, lastRenderedAt: now });

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

