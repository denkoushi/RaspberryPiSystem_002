import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { ZodError } from 'zod';
import { ApiError, DomainHttpError } from './errors.js';

// The error code used for diagnostics; some existing responses deliberately omit it.
export function classifyErrorResponse(error: unknown): { status: number; errorCode: string } {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined;
  if (record && 'validation' in record) return { status: 400, errorCode: 'SCHEMA_VALIDATION_ERROR' };
  if (error instanceof ApiError || error instanceof DomainHttpError) {
    return { status: error.statusCode, errorCode: error.code || `API_ERROR_${error.statusCode}` };
  }
  if (error instanceof ZodError) return { status: 400, errorCode: 'VALIDATION_ERROR' };
  if (error instanceof PrismaClientKnownRequestError) {
    return { status: error.code === 'P2025' ? 404 : 400, errorCode: error.code };
  }
  if (typeof record?.code === 'string' && ['P2025', 'P2002', 'P2003'].includes(record.code)) {
    return { status: record.code === 'P2025' ? 404 : 400, errorCode: record.code };
  }
  const status = typeof record?.statusCode === 'number' ? record.statusCode : undefined;
  return { status: status ?? 500, errorCode: status ? `HTTP_${status}` : 'UNHANDLED_ERROR' };
}
