import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { ApiError } from '../lib/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    const method = request.method;
    const url = request.url;
    const userAgent = request.headers['user-agent'];
    const userId = request.user?.id;

    if (error instanceof ApiError) {
      request.log.warn(
        {
          requestId,
          method,
          url,
          statusCode: error.statusCode,
          message: error.message,
          details: error.details,
          userId,
        },
        'API error',
      );
      // ApiErrorのメッセージを確実に返す
      const response: { message: string; details?: unknown; code?: string } = { message: error.message };
      if (error.details) {
        response.details = error.details;
      }
      if ((error.details as any)?.code) {
        response.code = (error.details as any).code;
      }
      reply.status(error.statusCode).send(response);
      return;
    }

    if (error instanceof ZodError) {
      request.log.warn(
        {
          requestId,
          method,
          url,
          issues: error.issues,
          userId,
        },
        'Validation error',
      );
      reply.status(400).send({ message: 'リクエスト形式が不正です', issues: error.issues });
      return;
    }

    if (error instanceof PrismaClientKnownRequestError) {
      request.log.error(
        {
          requestId,
          method,
          url,
          prismaCode: error.code,
          meta: error.meta,
          userId,
          errorMessage: error.message,
        },
        'Database error',
      );
      
      // P2003: 外部キー制約違反の場合、より詳細なメッセージを返す
      if (error.code === 'P2003') {
        const fieldName = (error.meta as any)?.field_name || '不明なフィールド';
        const modelName = (error.meta as any)?.model_name || '不明なモデル';
        reply.status(400).send({ 
          message: `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、削除できません。`,
          code: error.code,
          details: error.meta
        });
        return;
      }
      
      reply.status(400).send({ 
        message: `データベースエラー: ${error.code}`,
        code: error.code,
        details: error.meta
      });
      return;
    }

    request.log.error(
      {
        requestId,
        method,
        url,
        userAgent,
        userId,
        err: error,
        stack: error.stack,
        errorName: error.name,
        errorMessage: error.message,
      },
      'Unhandled error',
    );
    
    // エラーメッセージが存在しない場合のフォールバック
    const statusCode = error.statusCode ?? 500;
    const message = error.message || 'サーバーエラー';
    
    reply.status(statusCode).send({ message });
  });
}
