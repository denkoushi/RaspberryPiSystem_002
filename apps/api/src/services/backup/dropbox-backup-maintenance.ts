export type BackupListEntry = {
  path?: string | null;
  modifiedAt?: Date | string | null;
  sizeBytes?: number | null;
};

export type DropboxSelectivePurgePlan = {
  keep: BackupListEntry[];
  remove: BackupListEntry[];
  skippedMissingPath: BackupListEntry[];
  reason?: 'no_database_backups';
};

const DATABASE_PREFIX = 'database/';

const toDate = (value: BackupListEntry['modifiedAt']): Date => {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
};

export const planDropboxSelectivePurge = (
  entries: BackupListEntry[],
  keepLatestDatabaseCount: number
): DropboxSelectivePurgePlan => {
  if (!Number.isFinite(keepLatestDatabaseCount) || keepLatestDatabaseCount < 1) {
    throw new Error('keepLatestDatabaseCount must be >= 1');
  }

  const skippedMissingPath = entries.filter((entry) => !entry.path);
  const withPath = entries.filter(
    (entry): entry is BackupListEntry & { path: string } => typeof entry.path === 'string' && entry.path.length > 0
  );

  const databaseEntries = withPath.filter((entry) => entry.path.startsWith(DATABASE_PREFIX));
  if (databaseEntries.length === 0) {
    return {
      keep: [],
      remove: [],
      skippedMissingPath,
      reason: 'no_database_backups'
    };
  }

  const sortedDb = [...databaseEntries].sort((a, b) => toDate(b.modifiedAt).getTime() - toDate(a.modifiedAt).getTime());
  const keepSet = new Set(sortedDb.slice(0, keepLatestDatabaseCount).map((entry) => entry.path));

  const keep = withPath.filter((entry) => keepSet.has(entry.path));
  const remove = withPath.filter((entry) => !keepSet.has(entry.path));

  return { keep, remove, skippedMissingPath };
};
