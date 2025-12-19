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
 * クライアント端末のファイルをAnsible経由でバックアップするターゲット
 * 
 * source形式: "hostname:/path/to/file" または "hostname:/path/to/file:dest_name"
 * 例: "raspberrypi4:/opt/RaspberryPiSystem_002/clients/nfc-agent/.env"
 */
export class ClientFileBackupTarget implements BackupTarget {
  private readonly clientHost: string;
  private readonly remotePath: string;
  private readonly ansibleInventoryPath: string;
  private readonly ansiblePlaybookPath: string;

  constructor(source: string, ansibleInventoryPath?: string, ansiblePlaybookPath?: string) {
    // source形式をパース: "hostname:/path/to/file" または "hostname:/path/to/file:dest_name"
    const parts = source.split(':');
    if (parts.length < 2) {
      throw new ApiError(400, `Invalid client file source format: ${source}. Expected format: "hostname:/path/to/file"`);
    }

    this.clientHost = parts[0];
    this.remotePath = parts.slice(1).join(':'); // パスに:が含まれる可能性があるため、最初の:以降を結合

    // Ansibleのパスを設定
    // Dockerコンテナ内では /app/host/infrastructure/ansible にマウントされている
    const projectRoot = process.env.PROJECT_ROOT || '/opt/RaspberryPiSystem_002';
    const ansibleBasePath = process.env.ANSIBLE_BASE_PATH || path.join(projectRoot, 'infrastructure/ansible');
    
    // デフォルトパスを設定（後でcreateBackup時に存在確認してから使用）
    this.ansibleInventoryPath = ansibleInventoryPath || path.join(ansibleBasePath, 'inventory.yml');
    this.ansiblePlaybookPath = ansiblePlaybookPath || path.join(ansibleBasePath, 'playbooks/backup-clients.yml');
  }

  get info(): BackupTargetInfo {
    return {
      type: 'client-file',
      source: `${this.clientHost}:${this.remotePath}`,
      metadata: {
        clientHost: this.clientHost,
        remotePath: this.remotePath
      }
    };
  }

  async createBackup(): Promise<Buffer> {
    // 一時ディレクトリを作成
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'client-backup-'));
    const backupDestination = tmpDir;
    // ファイル名はAnsibleが生成する形式に合わせる（inventory_hostname_basename）
    // Ansibleのfetchモジュールは inventory_hostname を使用するため
    const outputFileName = `${this.clientHost}_${path.basename(this.remotePath)}`;
    const outputFilePath = path.join(backupDestination, outputFileName);

    // Ansibleのパスを解決（Dockerコンテナ内のマウントパスを優先）
    const containerAnsiblePath = '/app/host/infrastructure/ansible';
    let ansibleInventoryPath = this.ansibleInventoryPath;
    let ansiblePlaybookPath = this.ansiblePlaybookPath;
    
    try {
      // Dockerコンテナ内のマウントパスが存在するか確認
      await fs.access(path.join(containerAnsiblePath, 'inventory.yml'));
      ansibleInventoryPath = path.join(containerAnsiblePath, 'inventory.yml');
      ansiblePlaybookPath = path.join(containerAnsiblePath, 'playbooks/backup-clients.yml');
    } catch {
      // マウントパスが存在しない場合はデフォルトパスを使用
    }

    try {
      // Ansible Playbookを実行してクライアント端末からファイルを取得
      const { stdout, stderr } = await execFileAsync(
        'ansible-playbook',
        [
          '-i', ansibleInventoryPath,
          ansiblePlaybookPath,
          '-e', `client_host=${this.clientHost}`,
          '-e', `client_file_path=${this.remotePath}`,
          '-e', `backup_destination=${backupDestination}`
        ],
        {
          cwd: path.dirname(ansibleInventoryPath),
          maxBuffer: 1024 * 1024 * 10, // 10MB
          encoding: 'utf-8'
        }
      );

      // ファイルが取得されたか確認
      try {
        await fs.access(outputFilePath);
      } catch {
        throw new ApiError(
          500,
          `Failed to fetch file from client device. Ansible output: ${stdout}\nStderr: ${stderr}`
        );
      }

      // ファイルを読み込んでBufferとして返す
      const fileBuffer = await fs.readFile(outputFilePath);

      // 一時ファイルを削除
      await fs.rm(tmpDir, { recursive: true, force: true });

      return fileBuffer;
    } catch (error) {
      // エラー時も一時ファイルを削除
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ApiError(
          500,
          `ansible-playbook command not found. Ansible must be installed on the server.`
        );
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(
        500,
        `Failed to backup client file: ${errorMessage}`
      );
    }
  }
}
