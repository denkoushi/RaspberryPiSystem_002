import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { ApiError } from '../lib/errors.js';

type ErrorResponse = {
  message: string;
  errorCode?: string;
  requestId: string | number;
  timestamp: string;
  details?: unknown;
  issues?: unknown;
};

const buildErrorResponse = (
  requestId: string | number,
  message: string,
  options?: {
    errorCode?: string;
    details?: unknown;
    issues?: unknown;
  },
): ErrorResponse => {
  const payload: ErrorResponse = {
    message,
    requestId,
    timestamp: new Date().toISOString(),
  };

  if (options?.errorCode) {
    payload.errorCode = options.errorCode;
  }
  if (options?.details !== undefined) {
    payload.details = options.details;
  }
  if (options?.issues !== undefined) {
    payload.issues = options.issues;
  }

  return payload;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

type PrismaMeta = Record<string, unknown> | undefined;

const getMetaString = (meta: PrismaMeta, key: string, fallback: string): string => {
  const raw = meta?.[key];
  return typeof raw === 'string' ? raw : fallback;
};

const getMetaListString = (meta: PrismaMeta, key: string, fallback: string): string => {
  const raw = meta?.[key];
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value)).join(', ');
  }
  if (typeof raw === 'string') {
    return raw;
  }
  return fallback;
};

type PrismaLikeError = {
  code: string;
  meta?: Record<string, unknown>;
};

const isPrismaLikeError = (value: unknown): value is PrismaLikeError =>
  isRecord(value) && typeof (value as Record<string, unknown>).code === 'string';

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
      reply
        .status(error.statusCode)
        .send(
          buildErrorResponse(requestId, error.message, {
            errorCode: error.code,
            details: error.details,
          }),
        );
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
      reply
        .status(400)
        .send(
          buildErrorResponse(requestId, 'リクエスト形式が不正です', {
            errorCode: 'VALIDATION_ERROR',
            issues: error.issues,
          }),
        );
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
          errorStack: error.stack,
        },
        'Database error',
      );
      
      // P2003: 外部キー制約違反の場合、より詳細なメッセージを返す
      if (error.code === 'P2003') {
        const fieldName = getMetaString(error.meta, 'field_name', '不明なフィールド');
        const modelName = getMetaString(error.meta, 'model_name', '不明なモデル');
        // 外部キー制約違反の一般的なメッセージ（削除エンドポイントでは事前チェックで防いでいるため、通常は発生しない）
        const detailedMessage = `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、操作できません。`;
        request.log.error({ 
          requestId,
          method,
          url,
          prismaCode: error.code,
          meta: error.meta,
          detailedMessage
        }, 'P2003エラー詳細');
        reply
          .status(400)
          .send(
            buildErrorResponse(requestId, detailedMessage, {
              errorCode: error.code,
              details: error.meta,
            }),
          );
        return;
      }
      
      // P2002: ユニーク制約違反の場合、より詳細なメッセージを返す
      if (error.code === 'P2002') {
        const targetFields = getMetaListString(error.meta, 'target', 'target');
        const modelName = getMetaString(error.meta, 'model_name', '不明なモデル');
        const detailedMessage = `ユニーク制約違反: ${modelName}の${targetFields}が既に存在します。`;
        request.log.error({ 
          requestId,
          method,
          url,
          prismaCode: error.code,
          meta: error.meta,
          detailedMessage
        }, 'P2002エラー詳細');
        reply
          .status(400)
          .send(
            buildErrorResponse(requestId, detailedMessage, {
              errorCode: error.code,
              details: error.meta,
            }),
          );
        return;
      }
      
      reply
        .status(400)
        .send(
          buildErrorResponse(requestId, `データベースエラー: ${error.code} - ${error.message}`, {
            errorCode: error.code,
            details: error.meta,
          }),
        );
      return;
    }
    
    // PrismaClientKnownRequestErrorのインスタンスチェックが失敗する場合のフォールバック
    if (isPrismaLikeError(error)) {
      const prismaError = error;
      const errorCode = prismaError.code;
      
      if (errorCode === 'P2003') {
        const fieldName = getMetaString(prismaError.meta, 'field_name', '不明なフィールド');
        const modelName = getMetaString(prismaError.meta, 'model_name', '不明なモデル');
        const detailedMessage = `外部キー制約違反: ${modelName}の${fieldName}に関連するレコードが存在するため、操作できません。`;
        request.log.error({ 
          requestId,
          method,
          url,
          errorCode,
          errorMeta: prismaError.meta,
          detailedMessage
        }, 'P2003エラー（フォールバック）');
        reply
          .status(400)
          .send(
            buildErrorResponse(requestId, detailedMessage, {
              errorCode,
              details: prismaError.meta,
            }),
          );
        return;
      }
      
      if (errorCode === 'P2002') {
        const targetFields = getMetaListString(prismaError.meta, 'target', 'target');
        const modelName = getMetaString(prismaError.meta, 'model_name', '不明なモデル');
        const detailedMessage = `ユニーク制約違反: ${modelName}の${targetFields}が既に存在します。`;
        request.log.error({ 
          requestId,
          method,
          url,
          errorCode,
          errorMeta: prismaError.meta,
          detailedMessage
        }, 'P2002エラー（フォールバック）');
        reply
          .status(400)
          .send(
            buildErrorResponse(requestId, detailedMessage, {
              errorCode,
              details: prismaError.meta,
            }),
          );
        return;
      }
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
    
    const statusCode = error.statusCode ?? 500;
    const message = error.message || 'サーバーエラー';
    
    reply
      .status(statusCode)
      .send(
        buildErrorResponse(requestId, message, {
          errorCode: error.statusCode ? `HTTP_${error.statusCode}` : 'UNHANDLED_ERROR',
        }),
      );
  });
}
