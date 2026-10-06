import { describe, expect, it } from 'vitest';
import type { BackupConfig } from '../backup-config.js';
import {
  findMissingRecommendedBackupTargets,
  getRecommendedBackupTargetCatalog,
} from '../backup-recommended-targets.catalog.js';

const minimalConfig = (targets: BackupConfig['targets']): BackupConfig => ({
  storage: {
    provider: 'dropbox',
    options: {
      basePath: '/backups',
      dropbox: { appKey: 'k', appSecret: 's' },
    },
  },
  targets,
});

describe('backup-recommended-targets.catalog', () => {
  it('returns server storage entries and no kiosk secrets', () => {
    const catalog = getRecommendedBackupTargetCatalog();
    expect(catalog.some((c) => c.id === 'server-directory-part-measurement-drawings')).toBe(true);
    expect(catalog.some((c) => c.id === 'server-directory-assembly-procedure-assets')).toBe(true);
    expect(catalog.some((c) => c.id === 'server-directory-work-instruction-assets')).toBe(true);
    expect(catalog.some((c) => c.id === 'server-directory-measuring-instrument-genres')).toBe(true);
    expect(catalog.some((c) => c.id === 'server-directory-pallet-machine-illustrations')).toBe(true);
    expect(catalog.some((c) => c.id === 'server-directory-procedure-materials')).toBe(true);
    expect(catalog.some((c) => c.id === 'server-directory-procedure-videos')).toBe(true);
    expect(catalog.some((c) => c.id === 'server-directory-pdfs')).toBe(false);
    expect(catalog.some((c) => c.target.source.includes('/.ssh'))).toBe(false);
    // キオスクの .env・Tailscale 状態・status-agent 設定は秘密情報なので推奨しない
    expect(catalog.some((c) => c.target.kind === 'client-file' || c.target.kind === 'client-directory')).toBe(false);
    expect(catalog.some((c) => /\.env$|tailscale|raspi-status-agent\.conf/.test(c.target.source))).toBe(false);
  });

  it('findMissing reports all catalog items when targets empty', () => {
    const missing = findMissingRecommendedBackupTargets(minimalConfig([]));
    expect(missing.length).toBe(getRecommendedBackupTargetCatalog().length);
  });

  it('findMissing treats same kind+source as satisfied even if disabled', () => {
    const spec = getRecommendedBackupTargetCatalog().find((c) => c.id === 'server-directory-part-measurement-drawings')!;
    const missing = findMissingRecommendedBackupTargets(
      minimalConfig([{ ...spec.target, enabled: false }])
    );
    expect(missing.find((m) => m.id === spec.id)).toBeUndefined();
  });

  it('findMissing ignores unrelated targets', () => {
    const missing = findMissingRecommendedBackupTargets(
      minimalConfig([
        { kind: 'file', source: '/tmp/other.txt', enabled: true },
      ])
    );
    expect(missing.length).toBeGreaterThan(0);
  });
});
