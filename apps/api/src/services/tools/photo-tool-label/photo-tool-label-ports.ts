/**
 * 写真持出 VLM 工具名ラベル — 境界ポート（推論・ストレージ・永続化を差し替え可能にする）
 */

export type VisionCompletionInput = {
  userText: string;
  /** JPEG 等の raw bytes（base64 はアダプタ内で付与） */
  imageBytes: Buffer;
  mimeType: 'image/jpeg';
};

export type VisionCompletionResult = {
  /** モデルが返したプレーンテキスト（正規化前） */
  rawText: string;
};

export interface VisionCompletionPort {
  complete(input: VisionCompletionInput): Promise<VisionCompletionResult>;
}

export interface ThumbnailReaderPort {
  readThumbnail(photoUrl: string): Promise<Buffer>;
}

export type PendingPhotoLoanRow = {
  id: string;
  photoUrl: string;
};

export interface PendingPhotoLabelRepositoryPort {
  resetStaleClaims(staleBefore: Date): Promise<number>;
  listPendingLoans(limit: number): Promise<PendingPhotoLoanRow[]>;
  /** displayName が null かつ claimedAt が null の行のみ更新。成功時 true */
  tryClaim(loanId: string): Promise<boolean>;
  completeWithLabel(loanId: string, displayName: string): Promise<void>;
  releaseClaim(loanId: string): Promise<void>;
}
