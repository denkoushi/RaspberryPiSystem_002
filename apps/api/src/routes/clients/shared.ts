import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';

export const heartbeatSchema = z.object({
  apiKey: z.string().min(8),
  name: z.string().min(1),
  location: z.string().optional().nullable()
});

export const metricSchema = z.object({
  clientId: z.string().min(1),
  hostname: z.string().min(1),
  ipAddress: z.string().min(3),
  cpuUsage: z.number().min(0).max(100),
  memoryUsage: z.number().min(0).max(100),
  diskUsage: z.number().min(0).max(100),
  temperature: z.number().min(-50).max(120).optional(),
  uptimeSeconds: z.number().int().min(0).optional(),
  lastBoot: z.coerce.date().optional(),
  logs: z
    .array(
      z.object({
        level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
        message: z.string().min(1).max(1000),
        context: z.record(z.unknown()).optional()
      })
    )
    .max(20)
    .optional()
});

export const logsPayloadSchema = z.object({
  clientId: z.string().min(1),
  logs: z
    .array(
      z.object({
        level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
        message: z.string().min(1).max(1000),
        context: z.record(z.unknown()).optional()
      })
    )
    .min(1)
    .max(50)
});

export const logListQuerySchema = z.object({
  clientId: z.string().min(1).optional(),
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.coerce.date().optional()
});

const clientDisplayNameSchema = z
  .string()
  .max(100)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'name is required');

export const updateClientSchema = z.object({
  name: clientDisplayNameSchema.optional(),
  defaultMode: z.enum(['PHOTO', 'TAG']).optional().nullable()
});

export const normalizeClientKey = (rawKey: unknown): string | undefined => {
  if (typeof rawKey === 'string') {
    try {
      const parsed = JSON.parse(rawKey);
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // noop
    }
    return rawKey;
  }
  if (Array.isArray(rawKey) && rawKey.length > 0 && typeof rawKey[0] === 'string') {
    return rawKey[0];
  }
  return undefined;
};

export const requireClientKey = (headerValue: unknown): string => {
  const clientKey = normalizeClientKey(headerValue);
  if (!clientKey) {
    throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
  }
  return clientKey;
};

export const canManage = authorizeRoles('ADMIN', 'MANAGER');
export const canViewStatus = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
