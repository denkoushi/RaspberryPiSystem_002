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
  }
];

export const getBackupTargetTemplates = (): BackupTargetTemplate[] => templates;
