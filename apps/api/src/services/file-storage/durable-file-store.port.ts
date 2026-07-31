import type { Stats } from 'node:fs';

export type FileWriteMode = 'create' | 'replace';

export type FileWriteRequest = {
  key: string;
  data: Buffer;
  mode: FileWriteMode;
  integrity: boolean;
};

export type StoredFileResult = {
  key: string;
  sha256: string;
  size: number;
};

export interface DurableFileStorePort {
  initialize(namespaces: readonly string[]): Promise<void>;
  absolutePath(key: string): string;
  write(request: FileWriteRequest): Promise<StoredFileResult>;
  writeBatch(requests: readonly FileWriteRequest[]): Promise<StoredFileResult[]>;
  read(key: string, options: { verifyIntegrity: boolean }): Promise<Buffer>;
  hash(key: string): Promise<StoredFileResult>;
  stat(key: string): Promise<Stats>;
  delete(key: string, options: { integrity: boolean }): Promise<void>;
}
