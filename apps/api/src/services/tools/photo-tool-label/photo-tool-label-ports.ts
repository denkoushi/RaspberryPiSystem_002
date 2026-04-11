/**
 * 写真持出 VLM 工具名ラベル — 境界ポート（推論・ストレージ・永続化を差し替え可能にする）
 */

import type { PhotoToolVlmLabelProvenance } from '@raspi-system/shared-types';

/** 推論層の汎用 Vision ポートを再エクスポート（写真ツール以外からも import 可能にする） */
export type {
  VisionCompletionInput,
  VisionCompletionResult,
  VisionCompletionPort,
} from '../../inference/ports/vision-completion.port.js';

export type CompletePhotoToolLabelInput = {
  displayName: string;
  vlmProvenance: PhotoToolVlmLabelProvenance;
};

export interface ThumbnailReaderPort {
  readThumbnail(photoUrl: string): Promise<Buffer>;
}

/** VLM へ渡す JPEG バイト列（本画像リサイズ or サムネ。実装が選ぶ） */
export interface PhotoToolVisionImageSourcePort {
  readImageBytesForVision(photoUrl: string): Promise<Buffer>;
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
  completeWithLabel(loanId: string, input: CompletePhotoToolLabelInput): Promise<void>;
  releaseClaim(loanId: string): Promise<void>;
}
