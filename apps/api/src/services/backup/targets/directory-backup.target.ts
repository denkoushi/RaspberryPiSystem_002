import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo } from '../backup-types.js';

const execFileAsync = promisify(execFile);

/**
 * ディレクトリ全体をtar.gzに固めて返すターゲット。
 * 依存を最小化するため、システムの`tar`コマンドを利用する。
 */
export class DirectoryBackupTarget implements BackupTarget {
  constructor(private readonly dirPath: string) {}

  get info(): BackupTargetInfo {
    return {
      type: 'directory',
      source: path.basename(this.dirPath)
    };
  }

  async createBackup(): Promise<Buffer> {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'directory-backup.target.ts:25',message:'Directory backup start',data:{dirPath:this.dirPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    const tmpFile = path.join(
      os.tmpdir(),
      `backup-${Date.now()}-${Math.random().toString(16).slice(2)}.tar.gz`
    );

    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'directory-backup.target.ts:32',message:'Checking directory access',data:{dirPath:this.dirPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      await fs.access(this.dirPath);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'directory-backup.target.ts:35',message:'Executing tar command',data:{dirPath:this.dirPath,tmpFile},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      await execFileAsync('tar', ['-czf', tmpFile, '-C', this.dirPath, '.'], {
        maxBuffer: 1024 * 1024 * 200
      });
      const data = await fs.readFile(tmpFile);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'directory-backup.target.ts:40',message:'Directory backup success',data:{dirPath:this.dirPath,dataSize:data.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return data;
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'directory-backup.target.ts:43',message:'Directory backup error',data:{error:error instanceof Error?error.message:'Unknown',errorName:error instanceof Error?error.name:'Unknown',dirPath:this.dirPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      throw error;
    } finally {
      await fs.rm(tmpFile, { force: true }).catch(() => {});
    }
  }
}

