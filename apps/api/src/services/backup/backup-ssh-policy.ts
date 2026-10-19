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

  return [
    '--private-key', paths.privateKeyPath,
    '-e', `ansible_ssh_common_args=${sshOptions}`,
  ];
}

export function assertRemoteBackupPathAllowed(remotePath: string): void {
  const normalized = path.posix.normalize(remotePath);
  if (normalized.split('/').includes('.ssh')) {
    throw new ApiError(400, 'SSH authority directories cannot be backup targets');
  }
}
