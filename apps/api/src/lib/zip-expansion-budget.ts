import { inflateRawSync } from 'node:zlib';
import { ApiError } from './errors.js';

/** 展開後の合計バイト数の既定上限(48 MiB)。受信上限 12 MiB の通常の帳票より十分大きい。 */
export const DEFAULT_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 48 * 1024 * 1024;
/** ZIP 内エントリ数の既定上限。 */
export const DEFAULT_ZIP_MAX_ENTRIES = 5000;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

export class ZipExpansionLimitError extends ApiError {
  constructor(message = 'ファイルを展開すると大きすぎます') {
    super(400, message, undefined, 'ZIP_EXPANSION_LIMIT');
    this.name = 'ZipExpansionLimitError';
  }
}

export class ZipFormatError extends ApiError {
  constructor(message = 'ファイルの形式が正しくありません') {
    super(400, message, undefined, 'ZIP_INVALID');
    this.name = 'ZipFormatError';
  }
}

export type ZipExpansionBudgetOptions = {
  maxTotalUncompressedBytes?: number;
  maxEntries?: number;
};

type Directory = { entries: number; size: number; offset: number };

// 読み込みに使う JSZip(ExcelJS も内部で使う)と同じ中身を見るため、JSZip が
// 位置の補正や ZIP64 の読み替えをする余地のある形はすべて拒否する。
// 受け付けるのは、中央ディレクトリが末尾の記録の直前にちょうど収まる単一ディスクの ZIP だけ。
function findEocd(buffer: Buffer): number {
  if (buffer.length < EOCD_MIN_SIZE) throw new ZipFormatError();
  const lowest = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let pos = buffer.length - EOCD_MIN_SIZE; pos >= lowest; pos--) {
    if (buffer.readUInt32LE(pos) === EOCD_SIGNATURE) return pos;
  }
  throw new ZipFormatError();
}

function readDirectory(buffer: Buffer): Directory {
  const eocd = findEocd(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const dirDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entries = buffer.readUInt16LE(eocd + 10);
  const size = buffer.readUInt32LE(eocd + 12);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || dirDisk !== 0 || entriesOnDisk !== entries
    || entries === MAX16 || size === MAX32 || offset === MAX32) throw new ZipFormatError();
  if (offset + size !== eocd) throw new ZipFormatError();
  return { entries, size, offset };
}

/** 展開後の大きさは申告値を信じず、実際に展開(または格納長を計上)して数える。 */
export function assertZipExpansionWithinBudget(buffer: Buffer, options: ZipExpansionBudgetOptions = {}): void {
  const maxTotal = options.maxTotalUncompressedBytes ?? DEFAULT_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_ZIP_MAX_ENTRIES;
  const { entries, offset: dirOffset, size: dirSize } = readDirectory(buffer);
  if (entries > maxEntries) throw new ZipExpansionLimitError('ファイルに含まれる項目が多すぎます');

  const dirEnd = dirOffset + dirSize;
  const ranges: Array<[number, number]> = [];
  let total = 0;
  let pos = dirOffset;
  for (let index = 0; index < entries; index++) {
    if (pos + 46 > dirEnd || buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw new ZipFormatError();
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const next = pos + 46 + nameLength + extraLength + commentLength;
    if (next > dirEnd) throw new ZipFormatError();
    if (compressedSize === MAX32 || uncompressedSize === MAX32 || localOffset === MAX32) throw new ZipFormatError();
    if (flags & 0x1) throw new ZipFormatError('暗号化されたファイルは読み込めません');
    if (localOffset + 30 > dirOffset || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new ZipFormatError();
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > dirOffset) throw new ZipFormatError();
    ranges.push([localOffset, dataEnd]);
    const data = buffer.subarray(dataStart, dataEnd);

    if (method === 0) {
      total += data.length;
    } else if (method === 8) {
      if (data.length > 0) {
        const remaining = maxTotal - total;
        let inflated: Buffer;
        try {
          inflated = inflateRawSync(data, { maxOutputLength: Math.max(remaining, 0) + 1 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new ZipExpansionLimitError();
          throw new ZipFormatError();
        }
        total += inflated.length;
      }
    } else {
      throw new ZipFormatError();
    }
    if (total > maxTotal) throw new ZipExpansionLimitError();
    pos = next;
  }
  // 申告件数で歩き終えた位置が末尾の記録と一致しないもの(件数の書き換え)は拒否する。
  if (pos !== dirEnd) throw new ZipFormatError();
  // 同じ圧縮データを複数の項目から指すもの(重なり)は拒否する。展開の総量を入力の長さで抑える。
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] < ranges[i - 1][1]) throw new ZipFormatError();
  }
}
