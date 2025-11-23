/**
 * 共通の型定義
 */

export interface ImportSummarySection {
  processed: number;
  created: number;
  updated: number;
}

export interface ImportSummary {
  replaceExisting?: boolean;
  employees?: ImportSummarySection;
  items?: ImportSummarySection;
}

export interface ImportJob {
  id: string;
  type: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  summary?: ImportSummary | null;
  createdAt: string;
  completedAt?: string | null;
}


