import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  assertZipExpansionWithinBudget,
  DEFAULT_ZIP_MAX_ENTRIES,
  DEFAULT_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES,
  ZipExpansionLimitError,
  ZipFormatError,
} from '../zip-expansion-budget.js';
import { makeRepeatedZip } from './zip-test-helpers.js';

describe('assertZipExpansionWithinBudget', () => {
  it('既定値は 48 MiB と 5,000 件', () => {
    expect(DEFAULT_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES).toBe(48 * 1024 * 1024);
    expect(DEFAULT_ZIP_MAX_ENTRIES).toBe(5000);
  });

  it('ExcelJS で作った小さな xlsx は通る', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('シート').getCell('A1').value = '値';
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(() => assertZipExpansionWithinBudget(buffer)).not.toThrow();
  });

  it('展開後の合計が上限を超える ZIP を拒否する', async () => {
    const buffer = await makeRepeatedZip(200_000);
    expect(buffer.length).toBeLessThan(10_000);
    expect(() => assertZipExpansionWithinBudget(buffer, { maxTotalUncompressedBytes: 100_000 })).toThrow(ZipExpansionLimitError);
    expect(() => assertZipExpansionWithinBudget(buffer, { maxTotalUncompressedBytes: 1_000_000 })).not.toThrow();
  });

  it('複数エントリの合計で上限を超えたときも拒否する', async () => {
    const buffer = await makeRepeatedZip(60_000, 3);
    expect(() => assertZipExpansionWithinBudget(buffer, { maxTotalUncompressedBytes: 150_000 })).toThrow(ZipExpansionLimitError);
    expect(() => assertZipExpansionWithinBudget(buffer, { maxTotalUncompressedBytes: 200_000 })).not.toThrow();
  });

  it('格納(無圧縮)のエントリも長さを数える', async () => {
    const buffer = await makeRepeatedZip(50_000, 1, 'STORE');
    expect(() => assertZipExpansionWithinBudget(buffer, { maxTotalUncompressedBytes: 10_000 })).toThrow(ZipExpansionLimitError);
  });

  it('申告サイズを小さく偽っても実際の展開量で拒否する', async () => {
    const buffer = await makeRepeatedZip(200_000);
    const forged = Buffer.from(buffer);
    // 中央ディレクトリの uncompressed size(ヘッダー先頭から 24 バイト目)を 10 に書き換える。
    const central = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThan(0);
    forged.writeUInt32LE(10, central + 24);
    expect(() => assertZipExpansionWithinBudget(forged, { maxTotalUncompressedBytes: 100_000 })).toThrow(ZipExpansionLimitError);
  });

  it('エントリ数の上限を超えると拒否する', async () => {
    const zip = new JSZip();
    for (let index = 0; index < 6; index++) zip.file(`f${index}.txt`, 'a');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    expect(() => assertZipExpansionWithinBudget(buffer, { maxEntries: 5 })).toThrow(ZipExpansionLimitError);
    expect(() => assertZipExpansionWithinBudget(buffer, { maxEntries: 6 })).not.toThrow();
  });

  it('壊れた ZIP はエラーにする', async () => {
    expect(() => assertZipExpansionWithinBudget(Buffer.from('invalid'))).toThrow(ZipFormatError);
    expect(() => assertZipExpansionWithinBudget(Buffer.alloc(0))).toThrow(ZipFormatError);
    const buffer = await makeRepeatedZip(1000);
    expect(() => assertZipExpansionWithinBudget(buffer.subarray(0, buffer.length - 30))).toThrow(ZipFormatError);
    const broken = Buffer.from(buffer);
    broken.writeUInt32LE(0, broken.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
    expect(() => assertZipExpansionWithinBudget(broken)).toThrow(ZipFormatError);
  });

  describe('読み込み側(JSZip)と同じ中身だけを数える', () => {
    const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    const CENTRAL = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const threeEntries = async () => {
      const zip = new JSZip();
      for (const name of ['a.txt', 'b.txt', 'c.txt']) zip.file(name, 'x'.repeat(1000), { compression: 'DEFLATE' });
      return zip.generateAsync({ type: 'nodebuffer' });
    };

    it('そのままなら通る', async () => {
      const buffer = await threeEntries();
      expect(() => assertZipExpansionWithinBudget(buffer)).not.toThrow();
    });

    it('末尾の記録の件数を書き換えたものを拒否する', async () => {
      for (const count of [0, 1]) {
        const forged = Buffer.from(await threeEntries());
        const eocd = forged.lastIndexOf(EOCD);
        forged.writeUInt16LE(count, eocd + 8);
        forged.writeUInt16LE(count, eocd + 10);
        expect(() => assertZipExpansionWithinBudget(forged)).toThrow(ZipFormatError);
      }
    });

    it('中央ディレクトリが末尾の記録の直前に無いものを拒否する', async () => {
      const buffer = await threeEntries();
      const eocd = buffer.lastIndexOf(EOCD);
      const dirOffset = buffer.readUInt32LE(eocd + 16);
      // 末尾の記録は元の中央ディレクトリを指したまま、その後ろに別の中央ディレクトリを挟む。
      const forged = Buffer.concat([buffer.subarray(0, eocd), buffer.subarray(dirOffset, eocd), buffer.subarray(eocd)]);
      expect(() => assertZipExpansionWithinBudget(forged)).toThrow(ZipFormatError);
    });

    it('ディスク番号や ZIP64 の目印を持つものを拒否する', async () => {
      for (const [offset, value] of [[4, 0xffff], [6, 1], [8, 0xffff]] as const) {
        const forged = Buffer.from(await threeEntries());
        forged.writeUInt16LE(value, forged.lastIndexOf(EOCD) + offset);
        expect(() => assertZipExpansionWithinBudget(forged)).toThrow(ZipFormatError);
      }
    });

    it('同じデータを複数の項目から指すものを拒否する', async () => {
      const forged = Buffer.from(await threeEntries());
      const first = forged.indexOf(CENTRAL);
      const second = forged.indexOf(CENTRAL, first + 4);
      forged.writeUInt32LE(forged.readUInt32LE(first + 42), second + 42);
      expect(() => assertZipExpansionWithinBudget(forged)).toThrow(ZipFormatError);
    });
  });

  it('エラーは 400 の利用者向けメッセージを持つ', async () => {
    const buffer = await makeRepeatedZip(200_000);
    try {
      assertZipExpansionWithinBudget(buffer, { maxTotalUncompressedBytes: 1000 });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400, message: 'ファイルを展開すると大きすぎます' });
    }
  });
});
