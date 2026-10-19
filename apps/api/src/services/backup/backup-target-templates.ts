import type { BackupConfig } from './backup-config.js';

export type BackupTargetTemplate = {
  id: string;
  label: string;
  description?: string;
  target: BackupConfig['targets'][number];
  requiresSource?: boolean;
};

const templates: BackupTargetTemplate[] = [
  {
    id: 'cert-directory',
    label: '証明書ディレクトリ',
    description: '/app/host/certs を週次でバックアップ',
    target: {
      kind: 'directory',
      source: '/app/host/certs',
      schedule: '0 2 * * 0',
      enabled: true,
      storage: { provider: 'dropbox' },
      retention: { days: 14, maxBackups: 4 }
    }
  },
  {
    id: 'photo-storage',
    label: '写真ストレージ',
    description: '写真ストレージ（photo-storage）を日次バックアップ',
    target: {
      kind: 'image',
      source: 'photo-storage',
      schedule: '0 3 * * *',
      enabled: true,
      storage: { provider: 'local' }
    }
  },
  {
    id: 'api-env-file',
    label: 'API環境変数ファイル',
    description: 'APIの.envを日次バックアップ',
    target: {
      kind: 'file',
      source: '/opt/RaspberryPiSystem_002/apps/api/.env',
      schedule: '0 4 * * *',
      enabled: true,
      storage: { provider: 'local' }
    }
  },
  {
    id: 'part-measurement-drawings-dir',
    label: '部品測定図面ストレージ',
    description: '/app/storage/part-measurement-drawings を日次バックアップ（永続ボリューム）',
    target: {
      kind: 'directory',
      source: '/app/storage/part-measurement-drawings',
      schedule: '0 2 * * *',
      enabled: true,
      storage: { provider: 'dropbox' },
      retention: { days: 14, maxBackups: 4 }
    }
  },
  {
    id: 'work-instruction-assets-dir',
    label: 'SharePoint作業要領の原本画像',
    description: '/app/storage/work-instruction-assets を日次バックアップ（原本画像）',
    target: {
      kind: 'directory',
      source: '/app/storage/work-instruction-assets',
      schedule: '0 2 * * *',
      enabled: true,
      storage: { provider: 'dropbox' },
      retention: { days: 14, maxBackups: 4 }
    }
  },
  {
    id: 'assembly-procedure-assets-dir',
    label: '組立手順書assetストレージ',
    description: '/app/storage/assembly-procedure-assets を日次バックアップ（原本・overlay）',
    target: {
      kind: 'directory',
      source: '/app/storage/assembly-procedure-assets',
      schedule: '0 2 * * *',
      enabled: true,
      storage: { provider: 'dropbox' },
      retention: { days: 14, maxBackups: 4 }
    }
  }
];

export const getBackupTargetTemplates = (): BackupTargetTemplate[] => templates;
