import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveRestoreDestination } from '../restore-destination';

describe('resolveRestoreDestination', () => {
  const base = path.resolve('/srv/backups');
  const root = path.join(base, 'restored');

  it('resolves relative names under the restored folder of the backup storage', () => {
    expect(resolveRestoreDestination('db.sql.gz', base)).toBe(path.join(root, 'db.sql.gz'));
    expect(resolveRestoreDestination('2026/db.sql.gz', base)).toBe(path.join(root, '2026', 'db.sql.gz'));
  });

  it.each(['/tmp/restored.sql.gz', '../x', 'a/../../x', 'a/..', '', '   ', 'a\0b', 'C:\\x', '.'])(
    'rejects %j with 400',
    (destination) => {
      expect(() => resolveRestoreDestination(destination, base)).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  );
});
