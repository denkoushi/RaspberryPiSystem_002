import path from 'node:path';

export const DURABLE_FILE_NAMESPACES = [
  'photos',
  'thumbnails',
  'pdfs',
  'part-measurement-drawings',
  'assembly-procedure-images',
  'measuring-instrument-genres',
  'pallet-machine-illustrations',
  'csv-dashboards',
] as const;

export const CACHE_FILE_NAMESPACES = [
  'pdf-pages',
  'signage-rendered',
  'part-measurement-drawings-derivatives',
] as const;

export type FileStorageConfig = {
  root: string;
  minimumFreeBytes: number;
};

const FIVE_GIB = 5 * 1024 * 1024 * 1024;

function optionalAbsolute(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!path.isAbsolute(trimmed)) {
    throw new Error('File storage paths must be absolute');
  }
  return path.resolve(trimmed);
}

export function resolveFileStorageConfig(
  source: NodeJS.ProcessEnv = process.env
): FileStorageConfig {
  const canonical = optionalAbsolute(source.FILE_STORAGE_ROOT);
  const durableAliases = [
    { name: 'PHOTO_STORAGE_DIR', root: optionalAbsolute(source.PHOTO_STORAGE_DIR) },
    { name: 'PDF_STORAGE_DIR', root: optionalAbsolute(source.PDF_STORAGE_DIR) },
    {
      name: 'CSV_DASHBOARD_STORAGE_DIR',
      root: optionalAbsolute(source.CSV_DASHBOARD_STORAGE_DIR),
    },
  ].filter((entry): entry is { name: string; root: string } => Boolean(entry.root));
  const signageRenderDir = optionalAbsolute(source.SIGNAGE_RENDER_DIR);
  const aliases = [
    ...durableAliases,
    ...(signageRenderDir
      ? [{ name: 'SIGNAGE_RENDER_DIR', root: path.dirname(signageRenderDir) }]
      : []),
  ];

  const root =
    canonical ??
    durableAliases[0]?.root ??
    (source.NODE_ENV === 'test'
      ? '/tmp/test-photo-storage'
      : '/opt/RaspberryPiSystem_002/storage');

  const conflicts =
    source.NODE_ENV === 'test' ? [] : aliases.filter((entry) => entry.root !== root);
  if (conflicts.length > 0) {
    throw new Error(
      `FILE_STORAGE_ROOT conflicts with legacy storage settings: ${conflicts
        .map((entry) => entry.name)
        .join(', ')}`
    );
  }

  return {
    root,
    minimumFreeBytes: FIVE_GIB,
  };
}

export function getFileStorageRoot(): string {
  return resolveFileStorageConfig().root;
}
