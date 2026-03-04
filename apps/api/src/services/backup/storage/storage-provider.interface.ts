export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export type UploadSource =
  | { kind: 'buffer'; data: Buffer }
  | { kind: 'file'; filePath: string; sizeBytes?: number; cleanup?: () => Promise<void> };

export interface FileInfo {
  path: string;
  sizeBytes?: number;
  modifiedAt?: Date;
}

export interface StorageProvider {
  upload(file: Buffer, path: string, options?: UploadOptions): Promise<void>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<FileInfo[]>;
}

export interface LargeFileUploadProvider {
  uploadFromFile(filePath: string, path: string, options?: UploadOptions): Promise<void>;
}

export function isLargeFileUploadProvider(
  provider: StorageProvider
): provider is StorageProvider & LargeFileUploadProvider {
  return typeof (provider as Partial<LargeFileUploadProvider>).uploadFromFile === 'function';
}


