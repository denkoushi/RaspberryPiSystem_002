import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { authorizeRoles } from '../../lib/auth.js';
import { SignageService } from '../../services/signage/index.js';
import { pdfSchema, pdfUpdateSchema, pdfParamsSchema } from './schemas.js';
import { PdfStorage } from '../../lib/pdf-storage.js';
import { ApiError } from '../../lib/errors.js';
// SignageDisplayModeは型として使用するため、Prisma Clientが生成されるまで型エラーが発生する可能性がある
// 実機環境でマイグレーション実行後にPrisma Clientを生成する必要がある
type SignageDisplayMode = 'SLIDESHOW' | 'SINGLE';

async function readFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export function registerPdfRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  // GET /api/signage/pdfs - PDF一覧取得（管理画面用）
  app.get('/pdfs', { preHandler: canManage }, async () => {
    const pdfs = await signageService.getPdfs();
    return { pdfs };
  });

  // POST /api/signage/pdfs - PDFアップロード（管理画面用）
  app.post('/pdfs', { preHandler: canManage }, async (request: FastifyRequest) => {
    let pdfBuffer: Buffer | null = null;
    let filename = '';
    let name = '';
    let displayMode: SignageDisplayMode = 'SINGLE';
    let slideInterval: number | null = null;

    try {
      // マルチパートリクエストの処理
      if (!request.isMultipart()) {
        throw new ApiError(400, 'マルチパートフォームデータが必要です。Content-Type: multipart/form-dataを指定してください。');
      }

      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'file') {
            pdfBuffer = await readFile(part as MultipartFile);
            filename = part.filename || 'unknown.pdf';
          }
        } else {
          if (part.fieldname === 'name') {
            name = String(part.value);
          } else if (part.fieldname === 'displayMode') {
            displayMode = String(part.value) === 'SLIDESHOW' ? 'SLIDESHOW' : 'SINGLE' as SignageDisplayMode;
          } else if (part.fieldname === 'slideInterval') {
            const interval = parseInt(String(part.value), 10);
            if (!isNaN(interval) && interval > 0) {
              slideInterval = interval;
            }
          }
        }
      }

      if (!pdfBuffer) {
        throw new ApiError(400, 'PDFファイルがアップロードされていません');
      }

      if (!name) {
        name = filename.replace(/\.pdf$/i, '');
      }

      // PDFファイルを保存
      const pathInfo = await PdfStorage.savePdf(filename, pdfBuffer);

      // データベースに登録
      const pdf = await signageService.createPdf({
        name,
        filename: pathInfo.filename,
        filePath: pathInfo.filePath,
        displayMode: displayMode as 'SLIDESHOW' | 'SINGLE',
        slideInterval,
        enabled: true,
      });

      return { pdf };
    } catch (error) {
      request.log.error({ err: error }, 'PDFアップロードエラー');
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(500, `PDFアップロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // PUT /api/signage/pdfs/:id - PDF更新（管理画面用）
  app.put('/pdfs/:id', { preHandler: canManage }, async (request) => {
    const params = pdfParamsSchema.parse(request.params);
    const body = pdfUpdateSchema.parse(request.body);
    const pdf = await signageService.updatePdf(params.id, body);
    return { pdf };
  });

  // DELETE /api/signage/pdfs/:id - PDF削除（管理画面用）
  app.delete('/pdfs/:id', { preHandler: canManage }, async (request) => {
    const params = pdfParamsSchema.parse(request.params);
    await signageService.deletePdf(params.id);
    return { success: true };
  });
}

