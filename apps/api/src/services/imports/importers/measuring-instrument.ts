import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import pkg from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import type { CsvImporter, ImportSummary } from '../csv-importer.types.js';

const { MeasuringInstrumentStatus } = pkg;

// CSV用スキーマ（日付は文字列として扱う）
const measuringInstrumentCsvSchema = z.object({
  name: z.string().min(1, '名称は必須です'),
  managementNumber: z.string().min(1, '管理番号は必須です'),
  storageLocation: z.string().optional().nullable(),
  measurementRange: z.string().optional().nullable(),
  calibrationExpiryDate: z.string().optional().nullable().transform((val) => {
    if (!val || val.trim() === '') return null;
    const date = new Date(val);
    return isNaN(date.getTime()) ? null : date;
  }),
  status: z.string().optional().transform((val) => {
    if (!val || !val.trim()) return MeasuringInstrumentStatus.AVAILABLE;
    const upper = val.trim().toUpperCase();
    if (upper in MeasuringInstrumentStatus) {
      return MeasuringInstrumentStatus[upper as keyof typeof MeasuringInstrumentStatus];
    }
    return MeasuringInstrumentStatus.AVAILABLE;
  }),
  rfidTagUid: z.string().optional()
});

type MeasuringInstrumentCsvRow = z.infer<typeof measuringInstrumentCsvSchema>;

function parseCsvRows(buffer: Buffer): Record<string, string>[] {
  if (!buffer.length) {
    return [];
  }
  return parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];
}

/**
 * 計測機器CSVインポータ
 */
export class MeasuringInstrumentCsvImporter implements CsvImporter {
  readonly type = 'measuringInstruments' as const;

  async parse(buffer: Buffer): Promise<MeasuringInstrumentCsvRow[]> {
    const parsedRows = parseCsvRows(buffer);
    return parsedRows.map((row, index) => {
      try {
        return measuringInstrumentCsvSchema.parse(row);
      } catch (error) {
        throw new ApiError(400, `計測機器CSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async import(
    rows: unknown[],
    replaceExisting: boolean,
    logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
  ): Promise<ImportSummary> {
    const instrumentRows = rows as MeasuringInstrumentCsvRow[];

    if (instrumentRows.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const result: ImportSummary = {
      processed: instrumentRows.length,
      created: 0,
      updated: 0
    };

    // replaceExisting=trueの場合: LoanまたはInspectionRecordが存在しない計測機器を削除
    if (replaceExisting) {
      try {
        // 返却されていないLoanが存在する計測機器IDを取得
        const activeLoans = await prisma.loan.findMany({
          where: { returnedAt: null },
          select: { measuringInstrumentId: true }
        });
        const instrumentIdsWithActiveLoans = new Set(
          activeLoans
            .map(l => l.measuringInstrumentId)
            .filter((id): id is string => id !== null)
        );

        // InspectionRecordが存在する計測機器IDを取得
        const inspectionRecords = await prisma.inspectionRecord.findMany({
          select: { measuringInstrumentId: true }
        });
        const instrumentIdsWithInspections = new Set(
          inspectionRecords.map(r => r.measuringInstrumentId)
        );

        // 削除対象外のIDを結合
        const protectedIds = new Set([
          ...instrumentIdsWithActiveLoans,
          ...instrumentIdsWithInspections
        ]);

        if (protectedIds.size > 0) {
          await prisma.measuringInstrument.deleteMany({
            where: {
              id: {
                notIn: Array.from(protectedIds)
              }
            }
          });
        } else {
          await prisma.measuringInstrument.deleteMany();
        }
      } catch (error) {
        logger?.error({ err: error }, '[MeasuringInstrumentCsvImporter] Error in deleteMany');
        throw error;
      }
    }

    // CSV内のrfidTagUid重複チェック
    const rfidTagUidMap = new Map<string, string[]>();
    for (const row of instrumentRows) {
      if (row.rfidTagUid && row.rfidTagUid.trim()) {
        const uid = row.rfidTagUid.trim();
        if (!rfidTagUidMap.has(uid)) {
          rfidTagUidMap.set(uid, []);
        }
        rfidTagUidMap.get(uid)!.push(row.managementNumber);
      }
    }
    const duplicateRfidTagUids = Array.from(rfidTagUidMap.entries())
      .filter(([, numbers]) => numbers.length > 1)
      .map(([uid, numbers]) => ({ uid, managementNumbers: numbers }));
    if (duplicateRfidTagUids.length > 0) {
      const errorMessage = `CSV内でrfidTagUidが重複しています: ${duplicateRfidTagUids.map(({ uid, managementNumbers }) => `rfidTagUid="${uid}" (managementNumber: ${managementNumbers.join(', ')})`).join('; ')}`;
      logger?.error({ duplicateRfidTagUids }, '[MeasuringInstrumentCsvImporter] CSV内でrfidTagUidが重複');
      throw new ApiError(400, errorMessage);
    }

    // 各行をループ処理
    await prisma.$transaction(async (tx) => {
      for (const row of instrumentRows) {
        const tagUid = row.rfidTagUid?.trim() || null;

        try {
          const existing = await tx.measuringInstrument.findUnique({
            where: { managementNumber: row.managementNumber }
          });

          if (existing) {
            // 更新処理
            if (tagUid) {
              const existingTag = await tx.measuringInstrumentTag.findUnique({
                where: { rfidTagUid: tagUid }
              });
              if (existingTag && existingTag.measuringInstrumentId !== existing.id) {
                const errorMessage = `rfidTagUid="${tagUid}"は既に他の計測機器（managementNumber: ${existing.managementNumber}）で使用されています。`;
                logger?.error({
                  rfidTagUid: tagUid,
                  currentManagementNumber: row.managementNumber,
                  existingManagementNumber: existing.managementNumber
                }, '[MeasuringInstrumentCsvImporter] rfidTagUidの重複エラー');
                throw new ApiError(400, errorMessage);
              }
            }

            await tx.measuringInstrument.update({
              where: { managementNumber: row.managementNumber },
              data: {
                name: row.name,
                storageLocation: row.storageLocation ?? undefined,
                measurementRange: row.measurementRange ?? undefined,
                calibrationExpiryDate: row.calibrationExpiryDate ?? undefined,
                status: row.status ?? MeasuringInstrumentStatus.AVAILABLE
              }
            });

            // タグの更新
            if (tagUid !== null) {
              if (tagUid) {
                await tx.measuringInstrumentTag.upsert({
                  where: { rfidTagUid: tagUid },
                  update: { measuringInstrumentId: existing.id },
                  create: { measuringInstrumentId: existing.id, rfidTagUid: tagUid }
                });
              } else {
                // 空文字の場合はタグを削除
                await tx.measuringInstrumentTag.deleteMany({
                  where: { measuringInstrumentId: existing.id }
                });
              }
            }

            result.updated += 1;
          } else {
            // 作成処理
            if (tagUid) {
              const existingTag = await tx.measuringInstrumentTag.findUnique({
                where: { rfidTagUid: tagUid }
              });
              if (existingTag) {
                const existingInstrument = await tx.measuringInstrument.findUnique({
                  where: { id: existingTag.measuringInstrumentId }
                });
                const errorMessage = `rfidTagUid="${tagUid}"は既に他の計測機器（managementNumber: ${existingInstrument?.managementNumber || '不明'}）で使用されています。`;
                logger?.error({
                  rfidTagUid: tagUid,
                  newManagementNumber: row.managementNumber,
                  existingManagementNumber: existingInstrument?.managementNumber
                }, '[MeasuringInstrumentCsvImporter] rfidTagUidの重複エラー（新規作成時）');
                throw new ApiError(400, errorMessage);
              }
            }

            const newInstrument = await tx.measuringInstrument.create({
              data: {
                name: row.name,
                managementNumber: row.managementNumber,
                storageLocation: row.storageLocation ?? undefined,
                measurementRange: row.measurementRange ?? undefined,
                calibrationExpiryDate: row.calibrationExpiryDate ?? undefined,
                status: row.status ?? MeasuringInstrumentStatus.AVAILABLE
              }
            });

            if (tagUid) {
              await tx.measuringInstrumentTag.create({
                data: { measuringInstrumentId: newInstrument.id, rfidTagUid: tagUid }
              });
            }

            result.created += 1;
          }
        } catch (error) {
          const errorWithCode = error as { code?: string; meta?: unknown };
          logger?.error({
            err: error,
            managementNumber: row.managementNumber,
            errorCode: errorWithCode?.code,
            errorMeta: errorWithCode?.meta
          }, '[MeasuringInstrumentCsvImporter] Error processing row');
          throw error;
        }
      }
    }, {
      timeout: 30000,
      isolationLevel: 'ReadCommitted'
    });

    return result;
  }
}

