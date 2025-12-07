import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * PDFページ画像のベースディレクトリ
 */
const STORAGE_BASE_DIR = process.env.PDF_STORAGE_DIR || '/opt/RaspberryPiSystem_002/storage';
const PDF_PAGES_DIR = path.join(STORAGE_BASE_DIR, 'pdf-pages');

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

    // パストラバーサル対策
    if (filename.includes('..') || pdfId.includes('..')) {
      return reply.status(400).send({ message: '無効なパスです' });
    }

    // ファイルパスを構築
    const filePath = path.join(PDF_PAGES_DIR, pdfId, filename);

    try {
      // ファイルを読み込む
      const imageBuffer = await fs.readFile(filePath);

      // Content-Typeを設定
      reply.type('image/png');

      // 画像データを返す
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

