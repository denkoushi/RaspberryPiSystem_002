import { getPartMeasurementVisualTemplate } from '../../../api/client';

import type { PartMeasurementVisualTemplateDto } from '../types';

export function readApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

export function defaultVisualNameFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return stem.length > 0 ? stem : '図面テンプレート';
}

/** 図面名「品番 品名」を最初の空白（半角・全角）で品番と品名に分ける。空白が無ければ全体を品番として返す。 */
export function splitVisualNameIntoPartNumberAndName(name: string): { partNumber: string; partName: string } {
  const trimmed = name.trim();
  const match = /^(\S+)[\s\u3000]+(.+)$/u.exec(trimmed);
  return match ? { partNumber: match[1], partName: match[2] } : { partNumber: trimmed, partName: '' };
}

export function formatVisualLibraryTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export async function resolveVisualTemplateById(
  visualTemplateId: string,
  clientKey?: string
): Promise<PartMeasurementVisualTemplateDto | null> {
  const id = visualTemplateId.trim();
  if (!id) return null;
  return getPartMeasurementVisualTemplate(id, clientKey);
}
