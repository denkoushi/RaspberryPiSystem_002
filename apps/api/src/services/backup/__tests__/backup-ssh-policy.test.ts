import { describe, expect, it } from 'vitest';
import {
  assertRemoteBackupPathAllowed,
  buildBackupSshAnsibleArgs,
  buildClientBackupExtraVarsArgs,
  parseClientBackupSource,
  resolveBackupSshPaths,
} from '../backup-ssh-policy.js';
import { ClientDirectoryBackupTarget } from '../targets/client-directory-backup.target.js';
import { ClientFileBackupTarget } from '../targets/client-file-backup.target.js';

describe('backup SSH policy', () => {
  it('uses a dedicated private key and pinned known_hosts with strict checking', () => {
    const paths = resolveBackupSshPaths({});
    const args = buildBackupSshAnsibleArgs(paths);

    expect(args).toContain('/run/secrets/backup-ssh/id_ed25519');
    expect(args.join(' ')).toContain('StrictHostKeyChecking=yes');
    expect(args.join(' ')).toContain('UserKnownHostsFile=/run/secrets/backup-ssh/known_hosts');
    expect(args.join(' ')).toContain('IdentitiesOnly=yes');
  });

  it('passes ssh common args as one JSON extra var so Ansible does not split it on spaces', () => {
    const args = buildBackupSshAnsibleArgs(resolveBackupSshPaths({}));
    const extraVars = JSON.parse(args[args.indexOf('-e') + 1]);
    expect(extraVars.ansible_ssh_common_args).toBe(
      '-o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/run/secrets/backup-ssh/known_hosts -o GlobalKnownHostsFile=/dev/null',
    );
  });

  it('passes client backup vars as a single JSON extra var', () => {
    expect(buildClientBackupExtraVarsArgs({ client_host: 'raspberrypi4', client_dir_path: '/var/lib/tailscale' })).toEqual([
      '-e', '{"client_host":"raspberrypi4","client_dir_path":"/var/lib/tailscale"}',
    ]);
  });

  it('accepts documented client backup sources', () => {
    expect(parseClientBackupSource('raspberrypi4:/opt/RaspberryPiSystem_002/clients/nfc-agent/.env', 'h:/p')).toEqual({
      clientHost: 'raspberrypi4',
      remotePath: '/opt/RaspberryPiSystem_002/clients/nfc-agent/.env',
    });
    expect(new ClientDirectoryBackupTarget('raspberrypi3:/var/lib/tailscale').info.source).toBe('raspberrypi3:/var/lib/tailscale');
  });

  it.each([
    "raspberrypi4:/etc/hostname{{ lookup('pipe','id') }}",
    "raspberrypi4:/home/pi/{{ '.ss' ~ 'h' }}",
    'raspberrypi4:/tmp/x ansible_connection=local',
    'raspberrypi4:relative/path',
    'raspberrypi4:/tmp/a:b',
    'all ansible_python_interpreter=/tmp/x:/tmp/a',
    '{{ 7*7 }}:/tmp/a',
    ':/tmp/a',
    'raspberrypi4',
  ])('rejects client backup sources that could inject Ansible vars or templates (%s)', (source) => {
    expect(() => parseClientBackupSource(source, 'h:/p')).toThrow();
    expect(() => new ClientFileBackupTarget(source)).toThrow();
    expect(() => new ClientDirectoryBackupTarget(source)).toThrow();
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
