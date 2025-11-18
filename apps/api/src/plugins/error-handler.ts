import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from '../lib/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({ message: error.message, details: error.details });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({ message: 'リクエスト形式が不正です', issues: error.issues });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      reply.status(400).send({ message: `データベースエラー: ${error.code}` });
      return;
    }

    request.log.error({ err: error }, '未処理のエラー');
    reply.status(error.statusCode ?? 500).send({ message: error.message ?? 'サーバーエラー' });
  });
}
