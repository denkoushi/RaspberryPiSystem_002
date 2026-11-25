import { inflateRawSync } from 'node:zlib';
import { ApiError } from './errors.js';

/** 展開後の合計バイト数の既定上限(48 MiB)。受信上限 12 MiB の通常の帳票より十分大きい。 */
export const DEFAULT_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 48 * 1024 * 1024;
/** ZIP 内エントリ数の既定上限。 */
export const DEFAULT_ZIP_MAX_ENTRIES = 5000;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;

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

function findEocd(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  for (let pos = buffer.length - EOCD_MIN_SIZE; pos >= lowest; pos--) {
    if (buffer.readUInt32LE(pos) === EOCD_SIGNATURE) return pos;
  }
  throw new ZipFormatError();
}

function readDirectory(buffer: Buffer): Directory {
  const eocd = findEocd(buffer);
  let entries = buffer.readUInt16LE(eocd + 10);
  let size = buffer.readUInt32LE(eocd + 12);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || buffer.readUInt32LE(locator) !== ZIP64_LOCATOR_SIGNATURE) throw new ZipFormatError();
    const zip64Offset = Number(buffer.readBigUInt64LE(locator + 8));
    if (!Number.isSafeInteger(zip64Offset) || zip64Offset + 56 > buffer.length
      || buffer.readUInt32LE(zip64Offset) !== ZIP64_EOCD_SIGNATURE) throw new ZipFormatError();
    entries = Number(buffer.readBigUInt64LE(zip64Offset + 32));
    size = Number(buffer.readBigUInt64LE(zip64Offset + 40));
    offset = Number(buffer.readBigUInt64LE(zip64Offset + 48));
  }
  if (![entries, size, offset].every(Number.isSafeInteger) || offset + size > buffer.length) throw new ZipFormatError();
  return { entries, size, offset };
}

/** 展開後の大きさは申告値を信じず、実際に展開(または格納長を計上)して数える。 */
export function assertZipExpansionWithinBudget(buffer: Buffer, options: ZipExpansionBudgetOptions = {}): void {
  const maxTotal = options.maxTotalUncompressedBytes ?? DEFAULT_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_ZIP_MAX_ENTRIES;
  const { entries, offset: dirOffset, size: dirSize } = readDirectory(buffer);
  if (entries > maxEntries) throw new ZipExpansionLimitError('ファイルに含まれる項目が多すぎます');

  const dirEnd = dirOffset + dirSize;
  let total = 0;
  let pos = dirOffset;
  for (let index = 0; index < entries; index++) {
    if (pos + 46 > dirEnd || buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw new ZipFormatError();
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    let compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize32 = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    let localOffset = buffer.readUInt32LE(pos + 42);
    const next = pos + 46 + nameLength + extraLength + commentLength;
    if (next > dirEnd) throw new ZipFormatError();

    if (compressedSize === 0xffffffff || localOffset === 0xffffffff || uncompressedSize32 === 0xffffffff) {
      // ZIP64 拡張情報: 0xffffffff の項目だけが 非圧縮、圧縮、位置 の順で入る。
      let extra = pos + 46 + nameLength;
      const extraEnd = extra + extraLength;
      let found = false;
      while (extra + 4 <= extraEnd) {
        const id = buffer.readUInt16LE(extra);
        const length = buffer.readUInt16LE(extra + 2);
        if (extra + 4 + length > extraEnd) throw new ZipFormatError();
        if (id === 0x0001) {
          let cursor = extra + 4;
          const take = () => {
            if (cursor + 8 > extra + 4 + length) throw new ZipFormatError();
            const value = Number(buffer.readBigUInt64LE(cursor));
            cursor += 8;
            return value;
          };
          if (uncompressedSize32 === 0xffffffff) take();
          if (compressedSize === 0xffffffff) compressedSize = take();
          if (localOffset === 0xffffffff) localOffset = take();
          found = true;
          break;
        }
        extra += 4 + length;
      }
      if (!found) throw new ZipFormatError();
    }

    if (flags & 0x1) throw new ZipFormatError('暗号化されたファイルは読み込めません');
    if (![compressedSize, localOffset].every(Number.isSafeInteger) || localOffset + 30 > buffer.length
      || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new ZipFormatError();
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new ZipFormatError();
    const data = buffer.subarray(dataStart, dataEnd);

    if (method === 0) {
      total += data.length;
    } else if (method === 8) {
      const remaining = maxTotal - total;
      let inflated: Buffer;
      try {
        inflated = inflateRawSync(data, { maxOutputLength: Math.max(remaining, 0) + 1 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new ZipExpansionLimitError();
        throw new ZipFormatError();
      }
      total += inflated.length;
    } else {
      throw new ZipFormatError();
    }
    if (total > maxTotal) throw new ZipExpansionLimitError();
    pos = next;
  }
}
