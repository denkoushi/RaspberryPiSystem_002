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
    });

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
    pdfOptions: (SplitPdfOptions & { imageBase64?: string | null }) | undefined
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
    const leftHeaderHeight = Math.round(48 * scale);   // 左ペイン: タイトル下からカードまで大きめの間隔
    const rightHeaderHeight = Math.round(12 * scale);  // 右ペイン: タイトル下からPDFまでの余白をさらに圧縮して黒エリアを拡大

    const { cardsSvg, overflowCount } = await this.buildToolCardGrid(tools, {
      x: leftX + leftInnerPadding,
      y: outerPadding + leftInnerPadding + leftHeaderHeight,
      width: leftWidth - leftInnerPadding * 2,
      height: panelHeight - leftInnerPadding * 2 - leftHeaderHeight,
      mode: 'SPLIT',
      showThumbnails: true,
      maxRows: 3,
      maxColumns: 3,
    });

    const overflowBadge =
      overflowCount > 0
        ? `<text x="${leftX + leftWidth - leftInnerPadding}" y="${outerPadding + panelHeight - leftInnerPadding}"
            text-anchor="end" font-size="${Math.round(16 * scale)}" fill="#fcd34d" font-family="sans-serif">
            さらに ${overflowCount} 件
          </text>`
        : '';

    const pdfContent = pdfOptions?.imageBase64
      ? `<image x="${rightX + rightInnerPadding}" y="${outerPadding + rightInnerPadding + rightHeaderHeight}"
          width="${rightWidth - rightInnerPadding * 2}" height="${panelHeight - rightInnerPadding * 2 - rightHeaderHeight}"
          preserveAspectRatio="xMidYMid meet"
          href="${pdfOptions.imageBase64}" />`
      : `<text x="${rightX + rightWidth / 2}" y="${outerPadding + panelHeight / 2}"
          text-anchor="middle" font-size="${Math.round(32 * scale)}" fill="#e2e8f0" font-family="sans-serif">
          PDFが設定されていません
        </text>`;

    const slideInfo = '';

    const fileNameOverlay =
      pdfOptions?.title && pdfOptions.title.trim().length > 0
        ? `<text x="${rightX + rightInnerPadding + Math.round(4 * scale)}" y="${outerPadding + rightInnerPadding + titleOffsetY + Math.round(12 * scale)}"
            font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            ${this.escapeXml(pdfOptions.title)}
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
            fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.08)" />
          <text x="${leftX + leftInnerPadding}" y="${outerPadding + leftInnerPadding + titleOffsetY}"
            font-size="${Math.round(20 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            工具管理データ
          </text>
          ${cardsSvg}
          ${overflowBadge}
        </g>

        <g>
          <rect x="${rightX}" y="${outerPadding}" width="${rightWidth}" height="${panelHeight}"
            rx="${panelRadius}" ry="${panelRadius}"
            fill="rgba(15,23,42,0.50)" stroke="rgba(255,255,255,0.08)" />
          <text x="${rightX + rightInnerPadding}" y="${outerPadding + rightInnerPadding + titleOffsetY}"
            font-size="${Math.round(20 * scale)}" font-weight="600" fill="#ffffff" font-family="sans-serif">
            PDF表示
          </text>
          ${slideInfo}
          ${pdfContent}
          ${fileNameOverlay}
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
    const textAreaX = cardPadding + thumbnailSize + Math.round(12 * scale);

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
        const cardStroke = isInstrument
          ? 'rgba(107,33,168,1.0)' // purple-800
          : isRigging
            ? 'rgba(194,65,12,1.0)' // orange-700
            : 'rgba(29,78,216,1.0)'; // blue-700
        const strokeWidth = Math.max(2, Math.round(2 * scale)); // 2px以上
        const clipId = this.generateId(`thumb-${index}`);
        let thumbnailElement = '';

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

        const textStartY = y + cardPadding;
        const managementY = textStartY + Math.round(14 * scale);
        const primaryY = isInstrument ? managementY + Math.round(18 * scale) : textStartY + Math.round(20 * scale);
        const nameY = primaryY + Math.round(18 * scale);
        const dateY = nameY + Math.round(16 * scale);
        const timeY = dateY + Math.round(16 * scale);
        const warningY = timeY + Math.round(18 * scale);
        
        const textX = x + textAreaX;
        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${cardRadius}" ry="${cardRadius}"
              fill="${cardFill}" stroke="${cardStroke}" stroke-width="${strokeWidth}" />
            ${thumbnailElement}
            ${isInstrument
              ? `<text x="${textX}" y="${managementY}"
                  font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="700" fill="#ffffff" font-family="sans-serif">
                  📏 ${this.escapeXml(managementText)}
                </text>`
              : isRigging
                ? `<text x="${textX}" y="${managementY}"
                    font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="700" fill="#ffffff" font-family="sans-serif">
                    ⚙️ ${this.escapeXml(managementText)}
                  </text>`
                : `<text x="${textX}" y="${managementY}"
                    font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="700" fill="#ffffff" font-family="sans-serif">
                    🔧 ${this.escapeXml(managementText)}
                  </text>`
            }
            <text x="${textX}" y="${primaryY}"
              font-size="${Math.max(16, Math.round(18 * scale))}" font-weight="700" fill="#ffffff" font-family="sans-serif">
              ${this.escapeXml(primaryText)}
            </text>
            <text x="${textX}" y="${nameY}"
              font-size="${Math.max(14, Math.round(16 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${this.escapeXml(secondary)}
            </text>
            <text x="${textX}" y="${dateY}"
              font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${borrowedDate ? this.escapeXml(borrowedDate) : ''}
            </text>
            <text x="${textX}" y="${timeY}"
              font-size="${Math.max(14, Math.round(14 * scale))}" font-weight="600" fill="#ffffff" font-family="sans-serif">
              ${borrowedTime ? this.escapeXml(borrowedTime) : ''}
            </text>
            ${tool.isOver12Hours
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

