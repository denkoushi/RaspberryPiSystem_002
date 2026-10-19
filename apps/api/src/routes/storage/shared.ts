import type { FastifyReply, FastifyRequest } from 'fastify';

export function sendStorageReadError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  options: {
    notFoundMessage: string;
    failedMessage: string;
    logMessage?: string;
    logContext: Record<string, unknown>;
  }
): FastifyReply {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return reply.status(404).send({ message: options.notFoundMessage });
  }
  request.log.error(options.logContext, options.logMessage ?? options.failedMessage);
  return reply.status(500).send({ message: options.failedMessage });
}
