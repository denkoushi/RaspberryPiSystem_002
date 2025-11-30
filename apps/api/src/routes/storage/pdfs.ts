import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PdfStorage } from '../../lib/pdf-storage.js';
import { authorizeRoles } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

/**
 * PDF配信ルート
 * 
 * PDFファイルをAPI経由で配信する（認証必要）。
 * JWTトークンまたはclient-keyで認証可能。
 */
export function registerPdfStorageRoutes(app: FastifyInstance): void {
  // 認証が必要（JWTトークンまたはAPIキー）
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  /**
   * GET /api/storage/pdfs/*
   * 
   * PDFファイルを配信する
   * パス例: /api/storage/pdfs/filename.pdf
   */
  app.get('/storage/pdfs/*', async (request: FastifyRequest, reply: FastifyReply) => {
    // client-keyがあれば認証をスキップ
    const headerKey = request.headers['x-client-key'];
    if (!headerKey) {
      // client-keyがない場合はJWT認証を要求
      await canView(request, reply);
    } else {
      // client-keyの有効性を確認
      const client = await prisma.clientDevice.findUnique({ 
        where: { apiKey: typeof headerKey === 'string' ? headerKey : headerKey[0] } 
      });
      if (!client) {
        throw new ApiError(401, 'クライアント API キーが不正です');
      }
    }
    
    // Fastifyのワイルドカードパスは request.url から抽出する
    const urlPath = request.url.replace('/api/storage/pdfs/', '');
    
    if (!urlPath) {
      return reply.status(400).send({ message: 'PDFのパスが指定されていません' });
    }

    try {
      // URLパスを構築
      const pdfUrl = `/api/storage/pdfs/${urlPath}`;
      
      // PDFファイルを読み込む
      const pdfBuffer = await PdfStorage.readPdf(pdfUrl);

      // Content-Typeを設定
      reply.type('application/pdf');
      
      // PDFデータを返す
      return reply.send(pdfBuffer);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      // ファイルが存在しない場合
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ message: 'PDFが見つかりません' });
      }

      request.log.error({ err, pdfUrl: `/api/storage/pdfs/${urlPath}` }, 'PDFの読み込みに失敗しました');
      return reply.status(500).send({ message: 'PDFの読み込みに失敗しました' });
    }
  });
}

