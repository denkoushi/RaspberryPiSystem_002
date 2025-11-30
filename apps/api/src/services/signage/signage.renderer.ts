import sharp from 'sharp';
import path from 'path';
import type { SignageService, SignageContentResponse } from './signage.service.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { PDF_PAGES_DIR } from '../../lib/pdf-storage.js';
import { logger } from '../../lib/logger.js';

// 環境変数で解像度を設定可能（デフォルト: 1920x1080、4K: 3840x2160）
// 50インチモニタで近くから見る場合は4K推奨
const WIDTH = parseInt(process.env.SIGNAGE_RENDER_WIDTH || '1920', 10);
const HEIGHT = parseInt(process.env.SIGNAGE_RENDER_HEIGHT || '1080', 10);
const BACKGROUND = '#0f172a';

export class SignageRenderer {
  private readonly pdfSlideState = new Map<string, { lastIndex: number; lastRenderedAt: number }>();

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
      return await this.renderPdfImage(content.pdf.pages[pdfPageIndex]);
    }

    if (content.contentType === 'TOOLS' && content.tools) {
      return await this.renderTools(content.tools);
    }

    if (content.contentType === 'SPLIT') {
      const pdfPageIndex = this.getCurrentPdfPageIndex(
        content.pdf?.pages?.length || 0,
        content.displayMode,
        content.pdf?.slideInterval || null,
        content.pdf?.id
      );
      const pdfPageUrl = content.pdf?.pages?.[pdfPageIndex];
      return await this.renderSplit(content.tools || [], pdfPageUrl);
    }

    return await this.renderMessage('表示するコンテンツがありません');
  }

  private async renderPdfImage(pageUrl: string): Promise<Buffer> {
    const localPath = this.resolvePdfPageLocalPath(pageUrl);
    if (!localPath) {
      return await this.renderMessage('PDFページが見つかりません');
    }

    return await sharp(localPath)
      .resize(WIDTH, HEIGHT, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  private async renderTools(
    tools: Array<{ itemCode: string; name: string; thumbnailUrl?: string | null }>
  ): Promise<Buffer> {
    const svg = await this.buildToolsSvg(tools, WIDTH, HEIGHT);
    return await sharp(Buffer.from(svg), { density: 300 })
      .resize(WIDTH, HEIGHT, { fit: 'fill' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  }

  private async renderSplit(
    tools: Array<{ itemCode: string; name: string; thumbnailUrl?: string | null }>,
    pageUrl?: string
  ): Promise<Buffer> {
    const leftWidth = Math.floor(WIDTH * 0.5);
    const rightWidth = WIDTH - leftWidth;

    const leftSvg = await this.buildToolsSvg(tools, leftWidth, HEIGHT, 'SPLIT');
    const leftBuffer = await sharp(Buffer.from(leftSvg), { density: 300 })
      .resize(leftWidth, HEIGHT, { fit: 'fill' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    let rightBuffer: Buffer;
    if (pageUrl) {
      const localPath = this.resolvePdfPageLocalPath(pageUrl);
      if (localPath) {
        rightBuffer = await sharp(localPath)
          .resize(rightWidth, HEIGHT, { fit: 'cover' })
          .jpeg({ quality: 90 })
          .toBuffer();
      } else {
        rightBuffer = await this.renderMessage('PDFが見つかりません', rightWidth);
      }
    } else {
      rightBuffer = await this.renderMessage('PDFがありません', rightWidth);
    }

    return await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 3,
        background: BACKGROUND
      }
    })
      .composite([
        { input: leftBuffer, left: 0, top: 0 },
        { input: rightBuffer, left: leftWidth, top: 0 }
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  async renderMessage(message: string, customWidth = WIDTH): Promise<Buffer> {
    // 解像度に応じて文字サイズをスケール（1920x1080基準）
    const scale = WIDTH / 1920;
    const fontSize = Math.round(56 * scale);
    const svg = `
      <svg width="${customWidth}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${BACKGROUND}" />
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
          font-size="${fontSize}" font-family="sans-serif" fill="#e2e8f0" font-weight="600" text-rendering="geometricPrecision">
          ${this.escapeXml(message)}
        </text>
      </svg>
    `;
    return await sharp(Buffer.from(svg), { density: 300 })
      .resize(customWidth, HEIGHT, { fit: 'fill' })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  }

  private async buildToolsSvg(
    tools: Array<{
      itemCode: string;
      name: string;
      thumbnailUrl?: string | null;
      employeeName?: string | null;
      borrowedAt?: string | null;
    }>,
    width: number,
    height: number,
    mode: 'FULL' | 'SPLIT' = 'FULL'
  ): Promise<string> {
    const scale = WIDTH / 1920;
    const headerSize = Math.round(((mode === 'FULL' ? 72 : 58) * scale) / 2);
    const itemFontSize = Math.round((mode === 'FULL' ? 52 : 42) * scale);
    const paddingX = Math.round((mode === 'FULL' ? 60 : 40) * scale);
    const paddingTop = Math.round((mode === 'FULL' ? 24 : 18) * scale);
    const columnGap = Math.round(40 * scale);
    const contentGap = Math.round(8 * scale);
    const columns = 2;
    const thumbnailWidth = Math.round(220 * scale);
    const thumbnailHeight = Math.round(165 * scale);
    const lineHeight = Math.max(itemFontSize + Math.round(12 * scale), thumbnailHeight + Math.round(12 * scale));
    const contentStartY = paddingTop + headerSize + contentGap;
    const rowsPerColumn = Math.max(2, Math.floor((height - contentStartY - paddingTop) / lineHeight));
    const maxItems = rowsPerColumn * columns;
    const columnWidth = (width - paddingX * 2 - columnGap * (columns - 1)) / columns;
    
    const rows = await Promise.all(
      tools.slice(0, maxItems).map(async (tool, index) => {
        const columnIndex = Math.floor(index / rowsPerColumn);
        const rowIndex = index % rowsPerColumn;
        const baseX = paddingX + columnIndex * (columnWidth + columnGap);
        const y = contentStartY + rowIndex * lineHeight + lineHeight / 2;
        const thumbnailY = y - thumbnailHeight / 2;
        
        let thumbnailElement = '';
        if (tool.thumbnailUrl) {
          const thumbnailPath = this.resolveThumbnailLocalPath(tool.thumbnailUrl);
          if (thumbnailPath) {
            try {
              const thumbnailBuffer = await sharp(thumbnailPath)
                .resize(thumbnailWidth, thumbnailHeight, { fit: 'cover' })
                .jpeg({ quality: 90 })
                .toBuffer();
              const thumbnailBase64 = thumbnailBuffer.toString('base64');
              thumbnailElement = `
                <image x="${baseX}" y="${thumbnailY}" width="${thumbnailWidth}" height="${thumbnailHeight}"
                  href="data:image/jpeg;base64,${thumbnailBase64}" />
              `;
            } catch (error) {
              // 画像読み込み失敗時はスキップ
            }
          }
        }
        
        const textX = tool.thumbnailUrl ? baseX + thumbnailWidth + Math.round(24 * scale) : baseX;
        const primaryText = tool.employeeName ?? tool.name ?? tool.itemCode;
        const borrowedText = this.formatBorrowedAt(tool.borrowedAt);
        const secondaryText =
          borrowedText && tool.employeeName
            ? `${borrowedText} 持出`
            : borrowedText ?? tool.name ?? '';
        const tertiaryText =
          tool.employeeName && tool.name && tool.name !== '持出中アイテム' ? tool.name : '';
        const detailLineHeight = Math.round((itemFontSize * 0.7) * Math.max(0.9, scale));

        return `
          ${thumbnailElement}
          <text x="${textX}" y="${y}" font-size="${itemFontSize}" font-family="sans-serif" fill="#e2e8f0" text-rendering="geometricPrecision">
            <tspan fill="#34d399" font-weight="600">${this.escapeXml(primaryText)}</tspan>
            ${
              secondaryText
                ? `<tspan x="${textX}" dy="${detailLineHeight}" font-size="${Math.round(
                    itemFontSize * 0.75
                  )}" fill="#94a3b8">${this.escapeXml(secondaryText)}</tspan>`
                : ''
            }
            ${
              tertiaryText
                ? `<tspan x="${textX}" dy="${detailLineHeight}" font-size="${Math.round(
                    itemFontSize * 0.75
                  )}" fill="#38bdf8">${this.escapeXml(tertiaryText)}</tspan>`
                : ''
            }
            <tspan x="${textX}" dy="${detailLineHeight}" font-size="${Math.round(
              itemFontSize * 0.75
            )}" fill="#38bdf8">${this.escapeXml(tool.itemCode)}</tspan>
          </text>
        `;
      })
    );

    if (rows.length === 0) {
      rows.push(`
        <text x="${paddingX}" y="${contentStartY + lineHeight}" font-size="${itemFontSize}"
          font-family="sans-serif" fill="#94a3b8">
          表示するアイテムがありません
        </text>
      `);
    }

    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${BACKGROUND}" />
        <text x="${paddingX}" y="${paddingTop + headerSize / 2}" font-size="${headerSize}"
          font-family="sans-serif" fill="#38bdf8" font-weight="600" text-rendering="geometricPrecision">
          持出中アイテム
        </text>
        ${rows.join('\n')}
      </svg>
    `;
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
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hour}:${minute}`;
  }
}

