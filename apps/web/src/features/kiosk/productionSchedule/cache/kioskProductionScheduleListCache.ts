/**
 * React Query キャッシュ上のキオスク生産スケジュール一覧形。
 * hooks の complete / note 更新と揃える。
 */
export type KioskProductionScheduleListCache = {
  page: number;
  pageSize: number;
  total: number;
  rows: Array<{
    id: string;
    occurredAt: string | Date;
    rowData: unknown;
    processingOrder?: number | null;
    note?: string | null;
    dueDate?: string | null;
  }>;
};
