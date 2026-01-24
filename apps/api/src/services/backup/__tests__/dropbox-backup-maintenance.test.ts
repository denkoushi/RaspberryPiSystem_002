import { describe, expect, it } from 'vitest';
import { planDropboxSelectivePurge } from '../dropbox-backup-maintenance';

describe('planDropboxSelectivePurge', () => {
  it('keeps latest database backup and removes others', () => {
    const entries = [
      { path: 'database/2026-01-01/borrow_return.sql.gz', modifiedAt: new Date('2026-01-01T00:00:00Z') },
      { path: 'database/2026-01-02/borrow_return.sql.gz', modifiedAt: new Date('2026-01-02T00:00:00Z') },
      { path: 'csv/2026-01-02/employees.csv', modifiedAt: new Date('2026-01-02T01:00:00Z') },
      { path: 'image/2026-01-02/photo-storage.tar.gz', modifiedAt: new Date('2026-01-02T02:00:00Z') }
    ];

    const plan = planDropboxSelectivePurge(entries, 1);

    expect(plan.keep.map((entry) => entry.path)).toEqual(['database/2026-01-02/borrow_return.sql.gz']);
    expect(plan.remove.map((entry) => entry.path)).toEqual([
      'database/2026-01-01/borrow_return.sql.gz',
      'csv/2026-01-02/employees.csv',
      'image/2026-01-02/photo-storage.tar.gz'
    ]);
    expect(plan.reason).toBeUndefined();
  });

  it('aborts when no database backups are found', () => {
    const entries = [
      { path: 'csv/2026-01-02/employees.csv', modifiedAt: new Date('2026-01-02T01:00:00Z') }
    ];

    const plan = planDropboxSelectivePurge(entries, 1);

    expect(plan.reason).toBe('no_database_backups');
    expect(plan.keep).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it('treats missing modifiedAt as oldest', () => {
    const entries = [
      { path: 'database/2026-01-02/borrow_return.sql.gz', modifiedAt: new Date('2026-01-02T00:00:00Z') },
      { path: 'database/unknown/borrow_return.sql.gz' }
    ];

    const plan = planDropboxSelectivePurge(entries, 1);

    expect(plan.keep.map((entry) => entry.path)).toEqual(['database/2026-01-02/borrow_return.sql.gz']);
    expect(plan.remove.map((entry) => entry.path)).toEqual(['database/unknown/borrow_return.sql.gz']);
  });

  it('skips entries without path', () => {
    const entries = [
      { modifiedAt: new Date('2026-01-02T00:00:00Z') },
      { path: 'database/2026-01-02/borrow_return.sql.gz', modifiedAt: new Date('2026-01-02T00:00:00Z') }
    ];

    const plan = planDropboxSelectivePurge(entries, 1);

    expect(plan.skippedMissingPath).toHaveLength(1);
    expect(plan.keep.map((entry) => entry.path)).toEqual(['database/2026-01-02/borrow_return.sql.gz']);
  });
});
