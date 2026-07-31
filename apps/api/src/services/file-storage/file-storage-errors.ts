import { ApiError } from '../../lib/errors.js';

export class FileStorageCapacityExhaustedError extends ApiError {
  constructor() {
    super(
      507,
      'ファイル保存領域の空き容量が不足しています',
      undefined,
      'FILE_STORAGE_CAPACITY_EXHAUSTED'
    );
  }
}

export class FileStorageUnavailableError extends ApiError {
  constructor(cause?: unknown) {
    super(
      503,
      'ファイル保存領域を利用できません',
      undefined,
      'FILE_STORAGE_UNAVAILABLE'
    );
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class FileStorageIntegrityMismatchError extends ApiError {
  constructor() {
    super(
      503,
      '保存ファイルの整合性を確認できません',
      undefined,
      'FILE_STORAGE_INTEGRITY_MISMATCH'
    );
  }
}

export class FileStorageInvalidPathError extends ApiError {
  constructor() {
    super(400, '保存ファイルのパスが不正です', undefined, 'FILE_STORAGE_INVALID_PATH');
  }
}

export class FileStorageAlreadyExistsError extends ApiError {
  constructor() {
    super(409, '同じ保存先のファイルが既に存在します', undefined, 'FILE_STORAGE_ALREADY_EXISTS');
  }
}
