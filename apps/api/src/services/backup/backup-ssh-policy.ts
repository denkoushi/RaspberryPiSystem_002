import path from 'path';
import { constants, promises as fs } from 'fs';
import { ApiError } from '../../lib/errors.js';

export const DEFAULT_BACKUP_SSH_PRIVATE_KEY_PATH = '/run/secrets/backup-ssh/id_ed25519';
export const DEFAULT_BACKUP_SSH_KNOWN_HOSTS_PATH = '/run/secrets/backup-ssh/known_hosts';

type BackupSshPaths = {
  privateKeyPath: string;
  knownHostsPath: string;
};

function requireAbsoluteFilePath(value: string, setting: string): string {
  if (!path.isAbsolute(value) || value.endsWith(path.sep)) {
    throw new ApiError(500, `${setting} must be an absolute file path`);
  }
  return value;
}

export function resolveBackupSshPaths(
  env: NodeJS.ProcessEnv = process.env,
): BackupSshPaths {
  const privateKeyPath = requireAbsoluteFilePath(
    env.BACKUP_SSH_PRIVATE_KEY_PATH || DEFAULT_BACKUP_SSH_PRIVATE_KEY_PATH,
    'BACKUP_SSH_PRIVATE_KEY_PATH',
  );
  const knownHostsPath = requireAbsoluteFilePath(
    env.BACKUP_SSH_KNOWN_HOSTS_PATH || DEFAULT_BACKUP_SSH_KNOWN_HOSTS_PATH,
    'BACKUP_SSH_KNOWN_HOSTS_PATH',
  );

  if (privateKeyPath === knownHostsPath) {
    throw new ApiError(500, 'Backup SSH private key and known_hosts paths must differ');
  }
  return { privateKeyPath, knownHostsPath };
}

export async function assertBackupSshAuthorityAvailable(paths: BackupSshPaths): Promise<void> {
  try {
    await Promise.all([
      fs.access(paths.privateKeyPath, constants.R_OK),
      fs.access(paths.knownHostsPath, constants.R_OK),
    ]);
  } catch {
    throw new ApiError(503, 'Dedicated backup SSH authority is unavailable');
  }
}

export function buildBackupSshAnsibleArgs(paths: BackupSshPaths): string[] {
  const sshOptions = [
    '-o IdentitiesOnly=yes',
    '-o StrictHostKeyChecking=yes',
    `-o UserKnownHostsFile=${paths.knownHostsPath}`,
    '-o GlobalKnownHostsFile=/dev/null',
  ].join(' ');

  // key=value 形式の -e は Ansible が空白で分割するため、JSON で1変数として渡す
  return [
    '--private-key', paths.privateKeyPath,
    '-e', JSON.stringify({ ansible_ssh_common_args: sshOptions }),
  ];
}

// Ansible の extra vars は Jinja として評価されるため、ホスト名とパスは許可文字だけに限定する
const CLIENT_BACKUP_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const CLIENT_BACKUP_PATH_PATTERN = /^\/[A-Za-z0-9._/@+-]*$/;

export type ClientBackupSource = {
  clientHost: string;
  remotePath: string;
};

export function parseClientBackupSource(source: string, expectedFormat: string): ClientBackupSource {
  const separatorIndex = source.indexOf(':');
  if (separatorIndex <= 0) {
    throw new ApiError(400, `Invalid client backup source format. Expected format: "${expectedFormat}"`);
  }
  const clientHost = source.slice(0, separatorIndex);
  const remotePath = source.slice(separatorIndex + 1);
  if (!CLIENT_BACKUP_HOST_PATTERN.test(clientHost)) {
    throw new ApiError(400, 'Client backup host may contain only letters, digits, ".", "_" and "-"');
  }
  if (!CLIENT_BACKUP_PATH_PATTERN.test(remotePath)) {
    throw new ApiError(400, 'Client backup path must be absolute and may contain only letters, digits, and "._/@+-"');
  }
  assertRemoteBackupPathAllowed(remotePath);
  return { clientHost, remotePath };
}

export function buildClientBackupExtraVarsArgs(vars: Record<string, string>): string[] {
  return ['-e', JSON.stringify(vars)];
}

export function assertRemoteBackupPathAllowed(remotePath: string): void {
  const normalized = path.posix.normalize(remotePath);
  if (normalized.split('/').includes('.ssh')) {
    throw new ApiError(400, 'SSH authority directories cannot be backup targets');
  }
}
