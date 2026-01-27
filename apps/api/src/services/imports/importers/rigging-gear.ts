import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import pkg from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import type { CsvImporter, ImportSummary } from '../csv-importer.types.js';
import { buildUpdateDiff } from '../diff/master-data-diff.js';
import { CsvImportConfigService } from '../csv-import-config.service.js';
import { CsvRowMapper } from '../csv-row-mapper.js';

const { RiggingStatus } = pkg;

// CSV用スキーマ（日付・数値は文字列として扱う）
const riggingGearCsvSchema = z.object({
  name: z.string().min(1, '名称は必須です'),
  managementNumber: z.string().min(1, '管理番号は必須です'),
  storageLocation: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  startedAt: z.string().optional().nullable().transform((val) => {
    if (!val || val.trim() === '') return null;
    const date = new Date(val);
    return isNaN(date.getTime()) ? null : date;
  }),
  usableYears: z.string().optional().nullable().transform((val) => {
    if (!val || val.trim() === '') return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  }),
  maxLoadTon: z.string().optional().nullable().transform((val) => {
    if (!val || val.trim() === '') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
  }),
  lengthMm: z.string().optional().nullable().transform((val) => {
    if (!val || val.trim() === '') return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  }),
  widthMm: z.string().optional().nullable().transform((val) => {
    if (!val || val.trim() === '') return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  }),
  thicknessMm: z.string().optional().nullable().transform((val) => {
    if (!val || val.trim() === '') return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
  }),
  status: z.string().optional().transform((val) => {
    if (!val || !val.trim()) return RiggingStatus.AVAILABLE;
    const upper = val.trim().toUpperCase();
    if (upper in RiggingStatus) {
      return RiggingStatus[upper as keyof typeof RiggingStatus];
    }
    return RiggingStatus.AVAILABLE;
  }),
  notes: z.string().optional().nullable(),
  rfidTagUid: z.string().optional()
});

type RiggingGearCsvRow = z.infer<typeof riggingGearCsvSchema>;

function parseCsvRows(buffer: Buffer): Record<string, string>[] {
  if (!buffer.length) {
    return [];
  }
  return parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true // UTF-8 BOMを自動的に処理
  }) as Record<string, string>[];
}

/**
 * 吊具CSVインポータ
 */
export class RiggingGearCsvImporter implements CsvImporter {
  readonly type = 'riggingGears' as const;
  private readonly configService: CsvImportConfigService;
  private readonly rowMapper: CsvRowMapper;

  constructor(
    configService: CsvImportConfigService = new CsvImportConfigService(),
    rowMapper: CsvRowMapper = new CsvRowMapper()
  ) {
    this.configService = configService;
    this.rowMapper = rowMapper;
  }

  async parse(buffer: Buffer): Promise<RiggingGearCsvRow[]> {
    const config = await this.configService.getEffectiveConfig(this.type);
    if (config?.columnDefinitions?.length) {
      const mappedRows = this.rowMapper.mapBuffer(buffer, config.columnDefinitions);
      return mappedRows.map((row, index) => {
        try {
          return riggingGearCsvSchema.parse(row);
        } catch (error) {
          throw new ApiError(400, `吊具CSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }

    const parsedRows = parseCsvRows(buffer);
    return parsedRows.map((row, index) => {
      try {
        return riggingGearCsvSchema.parse(row);
      } catch (error) {
        throw new ApiError(400, `吊具CSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async import(
    rows: unknown[],
    replaceExisting: boolean,
    logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
  ): Promise<ImportSummary> {
    const gearRows = rows as RiggingGearCsvRow[];

    if (gearRows.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const result: ImportSummary = {
      processed: gearRows.length,
      created: 0,
      updated: 0
    };

    // replaceExisting=trueの場合: LoanまたはRiggingInspectionRecordが存在しない吊具を削除
    if (replaceExisting) {
      try {
        // 返却されていないLoanが存在する吊具IDを取得
        const activeLoans = await prisma.loan.findMany({
          where: { returnedAt: null },
          select: { riggingGearId: true }
        });
        const gearIdsWithActiveLoans = new Set(
          activeLoans
            .map(l => l.riggingGearId)
            .filter((id): id is string => id !== null)
        );

        // RiggingInspectionRecordが存在する吊具IDを取得
        const inspectionRecords = await prisma.riggingInspectionRecord.findMany({
          select: { riggingGearId: true }
        });
        const gearIdsWithInspections = new Set(
          inspectionRecords.map(r => r.riggingGearId)
        );

        // 削除対象外のIDを結合
        const protectedIds = new Set([
          ...gearIdsWithActiveLoans,
          ...gearIdsWithInspections
        ]);

        if (protectedIds.size > 0) {
          await prisma.riggingGear.deleteMany({
            where: {
              id: {
                notIn: Array.from(protectedIds)
              }
            }
          });
        } else {
          await prisma.riggingGear.deleteMany();
        }
      } catch (error) {
        logger?.error({ err: error }, '[RiggingGearCsvImporter] Error in deleteMany');
        throw error;
      }
    }

    // CSV内のrfidTagUid重複チェック
    const rfidTagUidMap = new Map<string, string[]>();
    for (const row of gearRows) {
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
      logger?.error({ duplicateRfidTagUids }, '[RiggingGearCsvImporter] CSV内でrfidTagUidが重複');
      throw new ApiError(400, errorMessage);
    }

    // 各行をループ処理
    await prisma.$transaction(async (tx) => {
      for (const row of gearRows) {
        const tagUid = row.rfidTagUid?.trim() || null;

        try {
          const existing = await tx.riggingGear.findUnique({
            where: { managementNumber: row.managementNumber }
          });

          if (existing) {
            // 更新処理
            if (tagUid) {
              const existingTag = await tx.riggingGearTag.findFirst({
                where: { rfidTagUid: tagUid }
              });
              if (existingTag && existingTag.riggingGearId !== existing.id) {
                const errorMessage = `rfidTagUid="${tagUid}"は既に他の吊具（managementNumber: ${existing.managementNumber}）で使用されています。`;
                logger?.error({
                  rfidTagUid: tagUid,
                  currentManagementNumber: row.managementNumber,
                  existingManagementNumber: existing.managementNumber
                }, '[RiggingGearCsvImporter] rfidTagUidの重複エラー');
                throw new ApiError(400, errorMessage);
              }
            }

            const updateData = {
              name: row.name,
              storageLocation: row.storageLocation,
              department: row.department,
              startedAt: row.startedAt ?? undefined,
              usableYears: row.usableYears ?? undefined,
              maxLoadTon: row.maxLoadTon ?? undefined,
              lengthMm: row.lengthMm ?? undefined,
              widthMm: row.widthMm ?? undefined,
              thicknessMm: row.thicknessMm ?? undefined,
              status: row.status ?? RiggingStatus.AVAILABLE,
              notes: row.notes ?? undefined
            };
            const diff = buildUpdateDiff(existing, updateData);
            if (diff.hasChanges) {
              await tx.riggingGear.update({
                where: { managementNumber: row.managementNumber },
                data: diff.data
              });
              result.updated += 1;
            }

            // タグの更新
            if (tagUid !== null) {
              // 既存タグを全削除して再作成（単一タグ前提）
              await tx.riggingGearTag.deleteMany({
                where: { riggingGearId: existing.id }
              });
              if (tagUid) {
                await tx.riggingGearTag.create({
                  data: { riggingGearId: existing.id, rfidTagUid: tagUid }
                });
              }
            }

          } else {
            // 作成処理
            if (tagUid) {
              const existingTag = await tx.riggingGearTag.findFirst({
                where: { rfidTagUid: tagUid }
              });
              if (existingTag) {
                const existingGear = await tx.riggingGear.findUnique({
                  where: { id: existingTag.riggingGearId }
                });
                const errorMessage = `rfidTagUid="${tagUid}"は既に他の吊具（managementNumber: ${existingGear?.managementNumber || '不明'}）で使用されています。`;
                logger?.error({
                  rfidTagUid: tagUid,
                  newManagementNumber: row.managementNumber,
                  existingManagementNumber: existingGear?.managementNumber
                }, '[RiggingGearCsvImporter] rfidTagUidの重複エラー（新規作成時）');
                throw new ApiError(400, errorMessage);
              }
            }

            const newGear = await tx.riggingGear.create({
              data: {
                name: row.name,
                managementNumber: row.managementNumber,
                storageLocation: row.storageLocation,
                department: row.department,
                startedAt: row.startedAt ?? undefined,
                usableYears: row.usableYears ?? undefined,
                maxLoadTon: row.maxLoadTon ?? undefined,
                lengthMm: row.lengthMm ?? undefined,
                widthMm: row.widthMm ?? undefined,
                thicknessMm: row.thicknessMm ?? undefined,
                status: row.status ?? RiggingStatus.AVAILABLE,
                notes: row.notes ?? undefined
              }
            });

            if (tagUid) {
              await tx.riggingGearTag.create({
                data: { riggingGearId: newGear.id, rfidTagUid: tagUid }
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
          }, '[RiggingGearCsvImporter] Error processing row');
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

