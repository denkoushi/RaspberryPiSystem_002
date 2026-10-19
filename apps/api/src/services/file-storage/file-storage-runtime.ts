import {
  CACHE_FILE_NAMESPACES,
  DURABLE_FILE_NAMESPACES,
  resolveFileStorageConfig,
} from './file-storage-config.js';
import { FileStorageHealthService } from './file-storage-health.service.js';
import { FileStorageIntegrityCatalog } from './file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from './local-durable-file-store.js';

type FileStorageRuntime = {
  root: string;
  catalog: FileStorageIntegrityCatalog;
  store: LocalDurableFileStore;
  health: FileStorageHealthService;
};

const runtimes = new Map<string, FileStorageRuntime>();

export function getFileStorageRuntime(): FileStorageRuntime {
  const config = resolveFileStorageConfig();
  const existing = runtimes.get(config.root);
  if (existing) return existing;
  const catalog = new FileStorageIntegrityCatalog(config.root);
  const store = new LocalDurableFileStore(config.root, catalog, {
    minimumFreeBytes: config.minimumFreeBytes,
  });
  const runtime = {
    root: config.root,
    catalog,
    store,
    health: new FileStorageHealthService(config.root, store, catalog),
  };
  runtimes.set(config.root, runtime);
  return runtime;
}

export async function initializeFileStorageRuntime(): Promise<FileStorageRuntime> {
  const runtime = getFileStorageRuntime();
  await runtime.store.initialize([...DURABLE_FILE_NAMESPACES, ...CACHE_FILE_NAMESPACES, '.integrity']);
  await runtime.health.startupProbe();
  return runtime;
}

export function resetFileStorageRuntimesForTests(): void {
  runtimes.clear();
}
