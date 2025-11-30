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
        content.pdf.slideInterval || null
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
        content.pdf?.slideInterval || null
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
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  }

  private async buildToolsSvg(
    tools: Array<{ itemCode: string; name: string; thumbnailUrl?: string | null }>,
    width: number,
    height: number,
    mode: 'FULL' | 'SPLIT' = 'FULL'
  ): Promise<string> {
    // 解像度に応じて文字サイズとパディングをスケール（1920x1080基準）
    const scale = WIDTH / 1920;
    const headerSize = Math.round((mode === 'FULL' ? 72 : 58) * scale);
    const itemFontSize = Math.round((mode === 'FULL' ? 52 : 42) * scale);
    const padding = Math.round((mode === 'FULL' ? 80 : 60) * scale);
    // サムネイルサイズを大きく（4:3アスペクト比を維持）
    const thumbnailWidth = Math.round(240 * scale);
    const thumbnailHeight = Math.round(180 * scale);
    const lineHeight = Math.max(itemFontSize + Math.round(20 * scale), thumbnailHeight + Math.round(20 * scale));
    const maxItems = Math.max(4, Math.floor((height - padding * 2 - headerSize) / lineHeight));
    
    const rows = await Promise.all(
      tools.slice(0, maxItems).map(async (tool, index) => {
        const y = padding + headerSize + (index + 1) * lineHeight;
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
                <image x="${padding}" y="${thumbnailY}" width="${thumbnailWidth}" height="${thumbnailHeight}"
                  href="data:image/jpeg;base64,${thumbnailBase64}" />
              `;
            } catch (error) {
              // 画像読み込み失敗時はスキップ
            }
          }
        }
        
        const textX = tool.thumbnailUrl ? padding + thumbnailWidth + Math.round(30 * scale) : padding;
        return `
          ${thumbnailElement}
          <text x="${textX}" y="${y}" font-size="${itemFontSize}" font-family="sans-serif" fill="#e2e8f0" text-rendering="geometricPrecision">
            <tspan fill="#34d399" font-weight="600">${this.escapeXml(tool.itemCode)}</tspan>
            <tspan dx="12" fill="#e2e8f0">${this.escapeXml(tool.name)}</tspan>
          </text>
        `;
      })
    );

    if (rows.length === 0) {
      rows.push(`
        <text x="${padding}" y="${padding + headerSize + lineHeight}" font-size="${itemFontSize}"
          font-family="sans-serif" fill="#94a3b8">
          表示するアイテムがありません
        </text>
      `);
    }

    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${BACKGROUND}" />
        <text x="${padding}" y="${padding + headerSize / 2}" font-size="${headerSize}"
          font-family="sans-serif" fill="#38bdf8" font-weight="600" text-rendering="geometricPrecision">
          工具在庫一覧
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
    slideInterval: number | null
  ): number {
    if (totalPages === 0) {
      return 0;
    }

    // SLIDESHOWモードでslideIntervalが設定されている場合のみページ切り替え
    if (displayMode === 'SLIDESHOW' && slideInterval && slideInterval > 0) {
      const now = Date.now();
      // エポック秒単位で計算（ミリ秒を秒に変換）
      const secondsSinceEpoch = Math.floor(now / 1000);
      // slideInterval秒ごとにページを切り替え
      const pageIndex = Math.floor(secondsSinceEpoch / slideInterval) % totalPages;
      logger.debug({
        totalPages,
        displayMode,
        slideInterval,
        secondsSinceEpoch,
        pageIndex,
      }, 'PDF slide show page index calculated');
      return pageIndex;
    }

    // デフォルトは最初のページ
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
}

