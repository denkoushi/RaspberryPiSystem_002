import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo } from '../backup-types.js';
import { ApiError } from '../../../lib/errors.js';

const execFileAsync = promisify(execFile);

/**
 * クライアント端末のディレクトリをAnsible経由でtar.gz化してバックアップするターゲット
 *
 * source形式: "hostname:/path/to/directory"
 * 例: "raspberrypi4:/home/tools03/.ssh"
 */
export class ClientDirectoryBackupTarget implements BackupTarget {
  private readonly clientHost: string;
  private readonly remoteDirPath: string;
  private readonly ansibleInventoryPath: string;
  private readonly ansiblePlaybookPath: string;

  constructor(source: string, ansibleInventoryPath?: string, ansiblePlaybookPath?: string) {
    const parts = source.split(':');
    if (parts.length < 2) {
      throw new ApiError(400, `Invalid client directory source format: ${source}. Expected format: "hostname:/path/to/directory"`);
    }

    this.clientHost = parts[0];
    this.remoteDirPath = parts.slice(1).join(':');

    const projectRoot = process.env.PROJECT_ROOT || '/opt/RaspberryPiSystem_002';
    const ansibleBasePath = process.env.ANSIBLE_BASE_PATH || path.join(projectRoot, 'infrastructure/ansible');

    this.ansibleInventoryPath = ansibleInventoryPath || path.join(ansibleBasePath, 'inventory.yml');
    this.ansiblePlaybookPath = ansiblePlaybookPath || path.join(ansibleBasePath, 'playbooks/backup-client-directory.yml');
  }

  get info(): BackupTargetInfo {
    return {
      type: 'client-directory',
      source: `${this.clientHost}:${this.remoteDirPath}`,
      metadata: {
        clientHost: this.clientHost,
        remoteDirPath: this.remoteDirPath
      }
    };
  }

  async createBackup(): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'client-dir-backup-'));
    const backupDestination = tmpDir;
    const outputFileName = `${this.clientHost}_${path.basename(this.remoteDirPath)}.tar.gz`;
    const outputFilePath = path.join(backupDestination, outputFileName);

    const containerAnsiblePath = '/app/host/infrastructure/ansible';
    let ansibleInventoryPath = this.ansibleInventoryPath;
    let ansiblePlaybookPath = this.ansiblePlaybookPath;

    try {
      await fs.access(path.join(containerAnsiblePath, 'inventory.yml'));
      ansibleInventoryPath = path.join(containerAnsiblePath, 'inventory.yml');
      ansiblePlaybookPath = path.join(containerAnsiblePath, 'playbooks/backup-client-directory.yml');
    } catch {
      // ignore
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        'ansible-playbook',
        [
          '-i', ansibleInventoryPath,
          ansiblePlaybookPath,
          '-e', `client_host=${this.clientHost}`,
          '-e', `client_dir_path=${this.remoteDirPath}`,
          '-e', `backup_destination=${backupDestination}`
        ],
        {
          cwd: path.dirname(ansibleInventoryPath),
          maxBuffer: 1024 * 1024 * 20,
          encoding: 'utf-8'
        }
      );

      // ファイルが取得されたか確認
      try {
        await fs.access(outputFilePath);
      } catch {
        throw new ApiError(
          500,
          `Failed to fetch directory archive from client device. Ansible output: ${stdout}\nStderr: ${stderr}`
        );
      }

      const fileBuffer = await fs.readFile(outputFilePath);
      await fs.rm(tmpDir, { recursive: true, force: true });
      return fileBuffer;
    } catch (error) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

      if (error instanceof ApiError) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ApiError(500, `ansible-playbook command not found. Ansible must be installed on the server.`);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(500, `Failed to backup client directory: ${errorMessage}`);
    }
  }
}


