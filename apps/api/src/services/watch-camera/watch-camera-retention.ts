export async function pruneWatchCameraFrames(now = new Date()): Promise<{ deleted: number; failed: number }> {
  const [{ prisma }, { env }, { getFileStorageRuntime }, { logger }] = await Promise.all([
    import('../../lib/prisma.js'), import('../../config/env.js'), import('../file-storage/file-storage-runtime.js'),
    import('../../lib/logger.js'),
  ]);
  const where = { capturedAt: { lt: new Date(now.getTime() - env.WATCH_CAMERA_RETENTION_DAYS * 86400000) } };
  let deleted = 0;
  const failedIds: string[] = [];
  while (true) {
    const rows = await prisma.watchCameraFrame.findMany({
      where: { ...where, ...(failedIds.length ? { id: { notIn: failedIds } } : {}) }, select: { id: true, fileKey: true }, orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }], take: 200,
    });
    if (!rows.length) break;
    for (const row of rows) {
      try { await getFileStorageRuntime().store.delete(row.fileKey, { integrity: true }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          failedIds.push(row.id);
          logger.warn({ errorName: error instanceof Error ? error.name : 'UnknownError', failed: 1 }, 'Watch camera file deletion failed');
          continue;
        }
      }
      const result = await prisma.watchCameraFrame.deleteMany({ where: { ...where, id: row.id } });
      deleted += result.count;
    }
    if (rows.length < 200) break;
  }
  return { deleted, failed: failedIds.length };
}
