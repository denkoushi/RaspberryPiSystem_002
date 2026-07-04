import axios from 'axios';

export function formatCsvImportError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown } | undefined;
    const message = typeof data?.message === 'string' ? data.message : undefined;
    if (message) {
      return message;
    }
    if (error.response?.status === 401) {
      return 'Gmailの再認可が必要です。管理コンソールの「Gmail設定」からOAuth認証を実行してください。';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : '操作に失敗しました';
}
