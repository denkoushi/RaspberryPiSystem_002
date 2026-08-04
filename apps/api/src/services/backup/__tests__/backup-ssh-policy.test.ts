import { describe, expect, it } from 'vitest';
import {
  assertRemoteBackupPathAllowed,
  buildBackupSshAnsibleArgs,
  resolveBackupSshPaths,
} from '../backup-ssh-policy.js';

describe('backup SSH policy', () => {
  it('uses a dedicated private key and pinned known_hosts with strict checking', () => {
    const paths = resolveBackupSshPaths({});
    const args = buildBackupSshAnsibleArgs(paths);

    expect(args).toContain('/run/secrets/backup-ssh/id_ed25519');
    expect(args.join(' ')).toContain('StrictHostKeyChecking=yes');
    expect(args.join(' ')).toContain('UserKnownHostsFile=/run/secrets/backup-ssh/known_hosts');
    expect(args.join(' ')).toContain('IdentitiesOnly=yes');
  });

  it('rejects relative authority paths and a shared key/known_hosts file', () => {
    expect(() => resolveBackupSshPaths({ BACKUP_SSH_PRIVATE_KEY_PATH: 'id_ed25519' })).toThrow();
    expect(() => resolveBackupSshPaths({
      BACKUP_SSH_PRIVATE_KEY_PATH: '/run/backup-authority',
      BACKUP_SSH_KNOWN_HOSTS_PATH: '/run/backup-authority',
    })).toThrow();
  });

  it('rejects SSH authority directories as file or directory backup targets', () => {
    expect(() => assertRemoteBackupPathAllowed('/home/device/.ssh')).toThrow();
    expect(() => assertRemoteBackupPathAllowed('/home/device/.ssh/id_ed25519')).toThrow();
    expect(() => assertRemoteBackupPathAllowed('/var/lib/tailscale')).not.toThrow();
  });
});
