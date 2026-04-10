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
  it('returns catalog entries for part-measurement drawings and extra Pi4 kiosks', () => {
    const catalog = getRecommendedBackupTargetCatalog();
    expect(catalog.some((c) => c.id === 'server-directory-part-measurement-drawings')).toBe(true);
    expect(catalog.some((c) => c.target.source.includes('raspi4-robodrill01:'))).toBe(true);
    expect(catalog.some((c) => c.target.source.includes('/home/tools04/.ssh'))).toBe(true);
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
