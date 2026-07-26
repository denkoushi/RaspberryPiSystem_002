export {
  buildAssemblyLotWorkIds,
  normalizeAssemblyUpperIdentifier,
  toHalfWidthAscii
} from '@raspi-system/shared-types';

export function createAssemblyRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function readAssemblyApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

export function formatAssemblyTimestamp(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function assemblyProcedureStatusLabel(status: 'draft' | 'published' | undefined): string {
  return status === 'draft' ? '下書き' : '公開済み';
}

export function assemblyProcedureStatusClassName(status: 'draft' | 'published' | undefined): string {
  return status === 'draft'
    ? 'bg-amber-400/25 text-amber-100'
    : 'bg-emerald-400/20 text-emerald-100';
}
