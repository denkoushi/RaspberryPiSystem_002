import sharp from 'sharp';
import path from 'path';
import type { SignageService, SignageContentResponse } from './signage.service.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { PDF_PAGES_DIR } from '../../lib/pdf-storage.js';

const WIDTH = 1920;
const HEIGHT = 1080;
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
      return await this.renderPdfImage(content.pdf.pages[0]);
    }

    if (content.contentType === 'TOOLS' && content.tools) {
      return await this.renderTools(content.tools);
    }

    if (content.contentType === 'SPLIT') {
      return await this.renderSplit(content.tools || [], content.pdf?.pages?.[0]);
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
    const svg = this.buildToolsSvg(tools, WIDTH, HEIGHT);
    return await sharp(Buffer.from(svg))
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  private async renderSplit(
    tools: Array<{ itemCode: string; name: string; thumbnailUrl?: string | null }>,
    pageUrl?: string
  ): Promise<Buffer> {
    const leftWidth = Math.floor(WIDTH * 0.5);
    const rightWidth = WIDTH - leftWidth;

    const leftSvg = this.buildToolsSvg(tools, leftWidth, HEIGHT, 'SPLIT');
    const leftBuffer = await sharp(Buffer.from(leftSvg))
      .jpeg({ quality: 90 })
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
    const svg = `
      <svg width="${customWidth}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${BACKGROUND}" />
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
          font-size="56" font-family="sans-serif" fill="#e2e8f0" font-weight="600">
          ${this.escapeXml(message)}
        </text>
      </svg>
    `;
    return await sharp(Buffer.from(svg))
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  private buildToolsSvg(
    tools: Array<{ itemCode: string; name: string }>,
    width: number,
    height: number,
    mode: 'FULL' | 'SPLIT' = 'FULL'
  ): string {
    const headerSize = mode === 'FULL' ? 72 : 58;
    const itemFontSize = mode === 'FULL' ? 52 : 42;
    const padding = mode === 'FULL' ? 80 : 60;
    const lineHeight = itemFontSize + 20;
    const maxItems = Math.max(4, Math.floor((height - padding * 2 - headerSize) / lineHeight));
    const rows = tools.slice(0, maxItems).map((tool, index) => {
      const y = padding + headerSize + (index + 1) * lineHeight;
      return `
        <text x="${padding}" y="${y}" font-size="${itemFontSize}" font-family="sans-serif" fill="#e2e8f0">
          <tspan fill="#34d399" font-weight="600">${this.escapeXml(tool.itemCode)}</tspan>
          <tspan dx="12" fill="#e2e8f0">${this.escapeXml(tool.name)}</tspan>
        </text>
      `;
    });

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
          font-family="sans-serif" fill="#38bdf8" font-weight="600">
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

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

