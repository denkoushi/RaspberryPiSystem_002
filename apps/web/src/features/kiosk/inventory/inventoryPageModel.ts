import { playTone } from '../../../utils/audioTone';

import type { InventoryCompartment, InventoryImportSummary } from '../../../api/client';
import type { NfcEvent } from '../../../hooks/useNfcStream';

export type InventoryRouteState = { inventoryNfcEvent?: NfcEvent };

export function messageFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : '処理に失敗しました';
}

export function isClientError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status !== undefined && status >= 400 && status < 500;
}

export const thumbnailSizeKey = 'kiosk-inventory-thumbnail-size';
export const viewModeKey = 'kiosk-inventory-view-mode';
export const defaultAreasKey = 'kiosk-inventory-default-areas';
export function readDefaultAreas(): string[] {
  try {
    const saved = localStorage.getItem(defaultAreasKey);
    if (saved !== null) {
      const parsed: unknown = JSON.parse(saved);
      return Array.isArray(parsed) ? [...new Set(parsed.filter((area): area is string => typeof area === 'string' && area.trim().length > 0))] : [];
    }
    const legacy = localStorage.getItem('kiosk-inventory-default-area')?.trim();
    return legacy ? [legacy] : [];
  } catch { return []; }
}
export const EMPTY_IMPORTS: InventoryImportSummary[] = [];
export const EMPTY_COMPARTMENTS: InventoryCompartment[] = [];
export function playInventoryTone(kind: 'success' | 'restock' | 'error') {
  playTone({
    freq: kind === 'success' ? 880 : kind === 'restock' ? 660 : 180,
    dur: 0.18, peak: 0.12, attack: 0.01,
    type: kind === 'error' ? 'sawtooth' : 'sine'
  });
}
