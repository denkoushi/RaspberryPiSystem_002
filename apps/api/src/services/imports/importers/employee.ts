import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import pkg from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import type { CsvImporter, ImportSummary } from '../csv-importer.types.js';
import { buildUpdateDiff } from '../diff/master-data-diff.js';
import { CsvImportConfigService } from '../csv-import-config.service.js';
import { CsvRowMapper } from '../csv-row-mapper.js';

const { EmployeeStatus } = pkg;

const employeeCsvSchema = z.object({
  employeeCode: z.string().regex(/^\d{4}$/, '社員コードは数字4桁である必要があります（例: 0001）'),
  lastName: z.string().min(1, '苗字は必須です'),
  firstName: z.string().min(1, '名前は必須です'),
  nfcTagUid: z.string().optional(),
  department: z.string().optional(),
  status: z.string().optional()
});

type EmployeeCsvRow = z.infer<typeof employeeCsvSchema>;

function normalizeEmployeeStatus(value?: string) {
  if (!value) return EmployeeStatus.ACTIVE;
  const upper = value.trim().toUpperCase();
  if (upper in EmployeeStatus) {
    return EmployeeStatus[upper as keyof typeof EmployeeStatus];
  }
  throw new ApiError(400, `無効な従業員ステータス: ${value}`);
}

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
 * 従業員CSVインポータ
 */
export class EmployeeCsvImporter implements CsvImporter {
  readonly type = 'employees' as const;
  private readonly configService: CsvImportConfigService;
  private readonly rowMapper: CsvRowMapper;

  constructor(
    configService: CsvImportConfigService = new CsvImportConfigService(),
    rowMapper: CsvRowMapper = new CsvRowMapper()
  ) {
    this.configService = configService;
    this.rowMapper = rowMapper;
  }

  async parse(buffer: Buffer): Promise<EmployeeCsvRow[]> {
    const config = await this.configService.getEffectiveConfig(this.type);
    if (config?.columnDefinitions?.length) {
      const mappedRows = this.rowMapper.mapBuffer(buffer, config.columnDefinitions);
      return mappedRows.map((row, index) => {
        try {
          return employeeCsvSchema.parse(row);
        } catch (error) {
          throw new ApiError(400, `従業員CSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }

    const parsedRows = parseCsvRows(buffer);
    return parsedRows.map((row, index) => {
      try {
        return employeeCsvSchema.parse(row);
      } catch (error) {
        throw new ApiError(400, `従業員CSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async import(
    rows: unknown[],
    replaceExisting: boolean,
    logger?: { info: (obj: unknown, msg: string) => void; error: (obj: unknown, msg: string) => void }
  ): Promise<ImportSummary> {
    const employeeRows = rows as EmployeeCsvRow[];

    if (employeeRows.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const result: ImportSummary = {
      processed: employeeRows.length,
      created: 0,
      updated: 0
    };

    // replaceExisting=trueの場合: Loanレコードが存在しない従業員を削除
    if (replaceExisting) {
      try {
        const loans = await prisma.loan.findMany({
          select: { employeeId: true }
        });
        const employeeIdsWithLoans = new Set(loans.map(l => l.employeeId).filter((id): id is string => id !== null));
        
        if (employeeIdsWithLoans.size > 0) {
          await prisma.employee.deleteMany({
            where: {
              id: {
                notIn: Array.from(employeeIdsWithLoans)
              }
            }
          });
        } else {
          await prisma.employee.deleteMany();
        }
      } catch (error) {
        logger?.error({ err: error }, '[EmployeeCsvImporter] Error in deleteMany');
        throw error;
      }
    }

    // CSV内のnfcTagUid重複チェック
    const nfcTagUidMap = new Map<string, string[]>();
    for (const row of employeeRows) {
      if (row.nfcTagUid && row.nfcTagUid.trim()) {
        const uid = row.nfcTagUid.trim();
        if (!nfcTagUidMap.has(uid)) {
          nfcTagUidMap.set(uid, []);
        }
        nfcTagUidMap.get(uid)!.push(row.employeeCode);
      }
    }
    const duplicateNfcTagUids = Array.from(nfcTagUidMap.entries())
      .filter(([, codes]) => codes.length > 1)
      .map(([uid, codes]) => ({ uid, employeeCodes: codes }));
    if (duplicateNfcTagUids.length > 0) {
      const errorMessage = `CSV内でnfcTagUidが重複しています: ${duplicateNfcTagUids.map(({ uid, employeeCodes }) => `nfcTagUid="${uid}" (employeeCode: ${employeeCodes.join(', ')})`).join('; ')}`;
      logger?.error({ duplicateNfcTagUids }, '[EmployeeCsvImporter] CSV内でnfcTagUidが重複');
      throw new ApiError(400, errorMessage);
    }

    // 各行をループ処理
    await prisma.$transaction(async (tx) => {
      for (const row of employeeRows) {
        // displayNameはlastName + firstNameから自動生成
        const displayName = `${row.lastName}${row.firstName}`;
        const updateData = {
          displayName,
          lastName: row.lastName,
          firstName: row.firstName,
          department: row.department || null,
          nfcTagUid: row.nfcTagUid || null,
          status: normalizeEmployeeStatus(row.status)
        };
        const createData = {
          employeeCode: row.employeeCode,
          ...updateData
        };

        try {
          const existing = await tx.employee.findUnique({ where: { employeeCode: row.employeeCode } });
          
          if (existing) {
            // 更新処理
            const nfcTagUidToCheck = row.nfcTagUid ? row.nfcTagUid.trim() : null;
            if (nfcTagUidToCheck) {
              const otherEmployee = await tx.employee.findFirst({
                where: {
                  nfcTagUid: nfcTagUidToCheck,
                  employeeCode: { not: row.employeeCode }
                }
              });
              if (otherEmployee) {
                const errorMessage = `nfcTagUid="${nfcTagUidToCheck}"は既にemployeeCode="${otherEmployee.employeeCode}"で使用されています。employeeCode="${row.employeeCode}"では使用できません。`;
                logger?.error({ 
                  nfcTagUid: nfcTagUidToCheck,
                  currentEmployeeCode: row.employeeCode,
                  existingEmployeeCode: otherEmployee.employeeCode
                }, '[EmployeeCsvImporter] nfcTagUidの重複エラー');
                throw new ApiError(400, errorMessage);
              }
            }
            
            const diff = buildUpdateDiff(existing, updateData);
            if (!diff.hasChanges) {
              continue;
            }
            await tx.employee.update({
              where: { employeeCode: row.employeeCode },
              data: diff.data
            });
            result.updated += 1;
          } else {
            // 作成処理
            const nfcTagUidToCheck = row.nfcTagUid ? row.nfcTagUid.trim() : null;
            
            if (nfcTagUidToCheck) {
              const existingWithSameNfcTag = await tx.employee.findFirst({
                where: {
                  nfcTagUid: nfcTagUidToCheck
                }
              });
              
              if (existingWithSameNfcTag) {
                const errorMessage = `nfcTagUid="${nfcTagUidToCheck}"は既にemployeeCode="${existingWithSameNfcTag.employeeCode}"で使用されています。employeeCode="${row.employeeCode}"では使用できません。`;
                logger?.error({ 
                  nfcTagUid: nfcTagUidToCheck,
                  newEmployeeCode: row.employeeCode,
                  existingEmployeeCode: existingWithSameNfcTag.employeeCode
                }, '[EmployeeCsvImporter] nfcTagUidの重複エラー（新規作成時）');
                throw new ApiError(400, errorMessage);
              }
            }
            
            try {
              await tx.employee.create({
                data: createData
              });
              result.created += 1;
            } catch (createError) {
              if (createError instanceof PrismaClientKnownRequestError && createError.code === 'P2002') {
                const meta = createError.meta as { target?: string[] } | undefined;
                const target = meta?.target || [];
                if (target.includes('nfcTagUid')) {
                  const conflictingEmployee = nfcTagUidToCheck ? await tx.employee.findFirst({
                    where: { nfcTagUid: nfcTagUidToCheck }
                  }) : null;
                  const errorMessage = conflictingEmployee
                    ? `nfcTagUid="${nfcTagUidToCheck}"は既にemployeeCode="${conflictingEmployee.employeeCode}"で使用されています。employeeCode="${row.employeeCode}"では使用できません。`
                    : `nfcTagUid="${nfcTagUidToCheck || '(空)'}"は既に使用されています。employeeCode="${row.employeeCode}"では使用できません。`;
                  logger?.error({ 
                    nfcTagUid: nfcTagUidToCheck,
                    employeeCode: row.employeeCode,
                    errorCode: createError.code,
                    errorMeta: createError.meta,
                    conflictingEmployee: conflictingEmployee ? {
                      id: conflictingEmployee.id,
                      employeeCode: conflictingEmployee.employeeCode,
                      nfcTagUid: conflictingEmployee.nfcTagUid
                    } : null
                  }, '[EmployeeCsvImporter] P2002エラー: nfcTagUidの重複');
                  throw new ApiError(400, errorMessage);
                }
              }
              throw createError;
            }
          }
        } catch (error) {
          const errorWithCode = error as { code?: string; meta?: unknown };
          logger?.error({ 
            err: error,
            employeeCode: row.employeeCode,
            errorCode: errorWithCode?.code,
            errorMeta: errorWithCode?.meta
          }, '[EmployeeCsvImporter] Error processing row');
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

