import { describe, expect, it } from 'vitest';

import {
  databaseNameFromSource,
  resolveDatabaseBackupSource
} from '../backup-database-source.js';

describe('backup database source identity', () => {
  it.each([
    ['postgresql://user:pass@localhost:5432/borrow_return', 'borrow_return'],
    ['postgres://localhost/borrow_return', 'borrow_return'],
    ['borrow_return', 'borrow_return'],
    ['', undefined],
    ['not/a/database/source', undefined]
  ])('normalizes %s to %s', (source, expected) => {
    expect(databaseNameFromSource(source)).toBe(expected);
  });

  it('prefers the configured logical name over a substituted runtime database', () => {
    expect(
      resolveDatabaseBackupSource(
        'postgres://localhost/borrow_return',
        'postgresql://codex:codex@127.0.0.1:55432/codex_review'
      )
    ).toBe('borrow_return');
  });

  it('falls back to the runtime database when no logical source was configured', () => {
    expect(
      resolveDatabaseBackupSource(undefined, 'postgresql://codex:codex@db:5432/codex_review')
    ).toBe('codex_review');
  });
});
