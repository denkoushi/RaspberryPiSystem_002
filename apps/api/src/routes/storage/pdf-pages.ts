import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';

import { PDF_PAGES_DIR } from '../../lib/pdf-storage.js';
import {
  buildPdfPageEtag,
  ifNoneMatchSatisfied,
  resolvePdfPageCacheControl,
} from './pdf-page-http-cache.js';

/**
 * PDFページ画像配信ルート
 * 
 * PDFを画像に変換したページ画像を配信する（認証不要、サイネージ用）。
 */
export function registerPdfPageRoutes(app: FastifyInstance): void {
  /**
   * GET /api/storage/pdf-pages/:pdfId/:filename
   * 
   * PDFページ画像を配信する
   * パス例: /api/storage/pdf-pages/uuid/page-1.png
   */
  app.get('/storage/pdf-pages/:pdfId/:filename', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { pdfId: string; filename: string };
    const { pdfId, filename } = params;

    let decodedPdfId: string;
    let decodedFilename: string;
    try {
      decodedPdfId = decodeURIComponent(pdfId);
      decodedFilename = decodeURIComponent(filename);
    } catch {
      return reply.status(400).send({ message: '無効なパスです' });
    }

    // パストラバーサル対策
    if (
      decodedFilename.includes('..') ||
      decodedPdfId.includes('..') ||
      decodedFilename.split(/[/\\]/).some((segment) => segment === '..') ||
      decodedPdfId.split(/[/\\]/).some((segment) => segment === '..')
    ) {
      return reply.status(400).send({ message: '無効なパスです' });
    }

    // ファイルパスを構築
    const resolvedBase = path.resolve(PDF_PAGES_DIR);
    const filePath = path.resolve(resolvedBase, decodedPdfId, decodedFilename);
    if (!filePath.startsWith(resolvedBase + path.sep)) {
      return reply.status(400).send({ message: '無効なパスです' });
    }

    try {
      const stat = await fs.stat(filePath);
      const etag = buildPdfPageEtag(stat);
      const cacheControl = resolvePdfPageCacheControl();
      reply.header('ETag', etag);
      reply.header('Cache-Control', cacheControl);

      const inm = request.headers['if-none-match'];
      if (ifNoneMatchSatisfied(inm, etag)) {
        return reply.code(304).send();
      }

      const imageBuffer = await fs.readFile(filePath);

      const lower = filename.toLowerCase();
      if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
        reply.type('image/jpeg');
      } else if (lower.endsWith('.webp')) {
        reply.type('image/webp');
      } else {
        reply.type('image/png');
      }

      return reply.send(imageBuffer);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // ファイルが存在しない場合
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ message: '画像が見つかりません' });
      }

      request.log.error({ err, filePath }, '画像の読み込みに失敗しました');
      return reply.status(500).send({ message: '画像の読み込みに失敗しました' });
    }
  });
}

