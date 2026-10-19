import path from 'path';

/** サイネージに「ファイル」として入れられる形式 */
export type SignageUploadFileType = 'pdf' | 'jpeg' | 'png';

const EXTENSION: Record<SignageUploadFileType, string> = { pdf: '.pdf', jpeg: '.jpg', png: '.png' };

/** 拡張子ではなく先頭のバイト列で形式を判定する（名前を偽ったファイルを受け付けない） */
export function detectSignageUploadFileType(buffer: Buffer): SignageUploadFileType | null {
  // PDF は先頭に数バイトの前置きが付くことがあるため、最初の 1KB 以内にあれば PDF とみなす
  if (buffer.subarray(0, 1024).includes('%PDF-', 0, 'latin1')) return 'pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  return null;
}

/** 判定した形式に合わせて拡張子をそろえる（保存後のページ画像化が拡張子で分岐するため） */
export function normalizeSignageUploadFilename(originalFilename: string, type: SignageUploadFileType): string {
  const base = path.basename(originalFilename, path.extname(originalFilename)) || 'upload';
  return `${base}${EXTENSION[type]}`;
}

export function isSignageImageFilename(filename: string): boolean {
  return /\.(jpe?g|png)$/i.test(filename);
}

/** 表示名の既定値：ファイル名から拡張子を外したもの */
export function defaultSignageUploadName(filename: string): string {
  return filename.replace(/\.(pdf|jpe?g|png)$/i, '');
}
