import { isAxiosError } from 'axios';

export type DocumentEditorConflict = {
  currentEditVersion: number | null;
};

export const DOCUMENT_EDITOR_CONFLICT_MESSAGES = {
  save: '他の編集で更新されています。現在の入力内容は保持しています。別画面で最新内容を確認してください。',
  retry: '再保存中にも更新競合が発生しました。内容は保持しています。',
  publish: '公開前に別の編集が行われました。入力内容を保持しています。',
  discard: '改版の状態が変わりました。入力内容は保持しています。'
} as const;

function readConflictPayload(error: unknown): {
  currentEditVersion: unknown;
} | null {
  if (!isAxiosError(error)) return null;
  const response = error.response;
  if (response?.status !== 409) return null;
  const data = response.data as {
    currentEditVersion?: unknown;
    details?: { currentEditVersion?: unknown };
  } | undefined;
  return {
    currentEditVersion: data?.details?.currentEditVersion ?? data?.currentEditVersion
  };
}

export function readDocumentEditorConflict(error: unknown): DocumentEditorConflict | null {
  const payload = readConflictPayload(error);
  if (!payload) return null;
  const value = payload.currentEditVersion;
  return {
    currentEditVersion:
      typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
  };
}

export function isDocumentEditorConflict(error: unknown): boolean {
  return readConflictPayload(error) != null;
}
