import type { BackupTarget } from './backup-target.interface.js';
import type { BackupKind } from './backup-types.js';
import { DatabaseBackupTarget } from './targets/database-backup.target.js';
import { FileBackupTarget } from './targets/file-backup.target.js';
import { DirectoryBackupTarget } from './targets/directory-backup.target.js';
import { CsvBackupTarget } from './targets/csv-backup.target.js';
import { ImageBackupTarget } from './targets/image-backup.target.js';
import { ClientFileBackupTarget } from './targets/client-file-backup.target.js';
import { ApiError } from '../../lib/errors.js';
import type { BackupConfig } from './backup-config.js';

/**
 * パスマッピング設定
 * Dockerコンテナ内のマウントパスへの変換ルール
 */
export interface PathMapping {
  hostPath: string;
  containerPath: string;
}

/**
 * バックアップターゲットファクトリー
 * レジストリパターンを使用してバックアップターゲットを作成する
 */
export class BackupTargetFactory {
  private static readonly targetCreators: Map<
    BackupKind,
    (source: string, metadata?: Record<string, unknown>, pathMappings?: PathMapping[]) => BackupTarget
  > = new Map<BackupKind, (source: string, metadata?: Record<string, unknown>, pathMappings?: PathMapping[]) => BackupTarget>([
    ['database', (source: string) => new DatabaseBackupTarget(source)],
    [
      'file',
      (source: string, _metadata?: Record<string, unknown>, pathMappings?: PathMapping[]) => {
        // パスマッピングを適用
        const containerPath = BackupTargetFactory.convertHostPathToContainerPath(source, pathMappings);
        return new FileBackupTarget(containerPath);
      }
    ],
    ['directory', (source: string) => new DirectoryBackupTarget(source)],
    [
      'csv',
      (source: string, metadata?: Record<string, unknown>) => {
        if (source === 'employees' || source === 'items') {
          return new CsvBackupTarget(source as 'employees' | 'items', metadata);
        }
        throw new ApiError(400, `Invalid CSV source: ${source}. Must be 'employees' or 'items'`);
      }
    ],
    ['image', (_source: string, metadata?: Record<string, unknown>) => new ImageBackupTarget(metadata)],
    ['client-file', (source: string) => new ClientFileBackupTarget(source)]
  ]);

  /**
   * パスマッピングを設定する
   * デフォルトのマッピングを返す
   */
  static getDefaultPathMappings(): PathMapping[] {
    return [
      { hostPath: '/opt/RaspberryPiSystem_002/apps/api/.env', containerPath: '/app/host/apps/api/.env' },
      { hostPath: '/opt/RaspberryPiSystem_002/apps/web/.env', containerPath: '/app/host/apps/web/.env' },
      {
        hostPath: '/opt/RaspberryPiSystem_002/infrastructure/docker/.env',
        containerPath: '/app/host/infrastructure/docker/.env'
      },
      {
        hostPath: '/opt/RaspberryPiSystem_002/clients/nfc-agent/.env',
        containerPath: '/app/host/clients/nfc-agent/.env'
      }
    ];
  }

  /**
   * ホストのパスをDockerコンテナ内のパスに変換
   */
  static convertHostPathToContainerPath(hostPath: string, pathMappings?: PathMapping[]): string {
    const mappings = pathMappings || this.getDefaultPathMappings();

    for (const mapping of mappings) {
      if (hostPath === mapping.hostPath) {
        return mapping.containerPath;
      }
    }

    // マッピングがない場合はそのまま返す（既にコンテナ内のパスの可能性）
    return hostPath;
  }

  /**
   * バックアップターゲットを作成
   */
  static create(
    kind: BackupKind,
    source: string,
    metadata?: Record<string, unknown>,
    pathMappings?: PathMapping[]
  ): BackupTarget {
    const creator = this.targetCreators.get(kind);
    if (!creator) {
      throw new ApiError(400, `Unknown backup kind: ${kind}`);
    }

    return creator(source, metadata, pathMappings);
  }

  /**
   * 設定ファイルからバックアップターゲットを作成
   */
  static createFromConfig(
    config: BackupConfig,
    kind: BackupKind,
    source: string,
    metadata?: Record<string, unknown>
  ): BackupTarget {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup-target-factory.ts:114',message:'createFromConfig called',data:{kind,source,hasMetadata:!!metadata,hasPathMappings:!!config.pathMappings},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    const pathMappings = config.pathMappings || this.getDefaultPathMappings();
    try {
      const target = this.create(kind, source, metadata, pathMappings);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup-target-factory.ts:118',message:'createFromConfig success',data:{targetType:target.constructor.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      return target;
    } catch (error: unknown) {
      // #region agent log
      const errorObj = error as { message?: string; name?: string };
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'backup-target-factory.ts:122',message:'createFromConfig error',data:{errorMessage:errorObj?.message,errorName:errorObj?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      throw error;
    }
  }

  /**
   * バックアップターゲットの種類を登録（拡張用）
   */
  static register(
    kind: BackupKind,
    creator: (source: string, metadata?: Record<string, unknown>, pathMappings?: PathMapping[]) => BackupTarget
  ): void {
    this.targetCreators.set(kind, creator);
  }

  /**
   * 登録されているバックアップターゲットの種類を取得
   */
  static getRegisteredKinds(): BackupKind[] {
    return Array.from(this.targetCreators.keys());
  }
}
