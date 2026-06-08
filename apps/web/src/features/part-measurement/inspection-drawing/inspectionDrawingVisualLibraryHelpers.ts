import { getPartMeasurementVisualTemplate } from '../../../api/client';

import type { PartMeasurementVisualTemplateDto } from '../types';

export function defaultVisualNameFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return stem.length > 0 ? stem : '図面テンプレート';
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
