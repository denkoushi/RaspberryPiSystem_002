export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

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


