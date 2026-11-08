import type { UserRole } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';

export function assertSubjectPatternUnchanged(role: UserRole, next: string | null | undefined, stored: string | null = null): void {
  if (role !== 'ADMIN' && next !== undefined && (next ?? '') !== (stored ?? '')) {
    throw new ApiError(403, '操作権限がありません', undefined, 'AUTH_INSUFFICIENT_PERMISSIONS');
  }
}
