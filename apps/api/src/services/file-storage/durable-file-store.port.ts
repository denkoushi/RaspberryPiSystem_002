import type { Stats } from 'node:fs';
import type { Readable } from 'node:stream';

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
  /**
   * Opens an inclusive byte range; size is the full file size. Streamed reads do not
   * verify SHA-256 per request: hashing a range would require reading the whole file.
   * Only size is checked against an existing catalog record; mismatch throws
   * FileStorageIntegrityMismatchError. A missing record throws when requiresCatalog()
   * is true, otherwise logs a warning, as read() does. Full-content integrity is
   * covered by write-time hashing and the integrity backfill/scan.
   */
  openReadStream(key: string, options?: { start?: number; end?: number }): Promise<{ stream: Readable; size: number }>;
  /** Lists direct child names (files and directories); returns [] for a missing namespace. */
  list(namespace: string): Promise<string[]>;
  /** Streams to a local destination; verification checks full SHA-256 and size with read()'s missing-record policy. */
  copyToFile(key: string, destination: string, options: { verifyIntegrity: boolean }): Promise<void>;
  hash(key: string): Promise<StoredFileResult>;
  stat(key: string): Promise<Stats>;
  delete(key: string, options: { integrity: boolean }): Promise<void>;
}
