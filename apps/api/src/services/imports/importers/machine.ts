import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import type { CsvImporter, ImportSummary } from '../csv-importer.types.js';
import { buildUpdateDiff } from '../diff/master-data-diff.js';
import { CsvImportConfigService } from '../csv-import-config.service.js';
import { CsvRowMapper } from '../csv-row-mapper.js';

const machineCsvSchema = z.object({
  equipmentManagementNumber: z.string().min(1, '設備管理番号は必須です'),
  name: z.string().min(1, '加工機名称は必須です'),
  shortName: z.string().optional(),
  classification: z.string().optional(),
  operatingStatus: z.string().optional(),
  ncManual: z.string().optional(),
  maker: z.string().optional(),
  processClassification: z.string().optional(),
  coolant: z.string().optional(),
});

type MachineCsvRow = z.infer<typeof machineCsvSchema>;

function parseCsvRows(buffer: Buffer): Record<string, string>[] {
  if (!buffer.length) {
    return [];
  }
  return parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
}

function normalizeOptional(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class MachineCsvImporter implements CsvImporter {
  readonly type = 'machines' as const;
  private readonly configService: CsvImportConfigService;
  private readonly rowMapper: CsvRowMapper;

  constructor(
    configService: CsvImportConfigService = new CsvImportConfigService(),
    rowMapper: CsvRowMapper = new CsvRowMapper(),
  ) {
    this.configService = configService;
    this.rowMapper = rowMapper;
  }

  async parse(buffer: Buffer): Promise<MachineCsvRow[]> {
    const config = await this.configService.getEffectiveConfig(this.type);
    if (config?.columnDefinitions?.length) {
      const mappedRows = this.rowMapper.mapBuffer(buffer, config.columnDefinitions);
      return mappedRows.map((row, index) => {
        try {
          return machineCsvSchema.parse(row);
        } catch (error) {
          throw new ApiError(400, `加工機CSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }

    const parsedRows = parseCsvRows(buffer);
    return parsedRows.map((row, index) => {
      try {
        return machineCsvSchema.parse(row);
      } catch (error) {
        throw new ApiError(400, `加工機CSVの${index + 2}行目でエラー: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  async import(
    rows: unknown[],
    replaceExisting: boolean,
  ): Promise<ImportSummary> {
    const machineRows = rows as MachineCsvRow[];
    if (machineRows.length === 0) {
      return { processed: 0, created: 0, updated: 0 };
    }

    const result: ImportSummary = {
      processed: machineRows.length,
      created: 0,
      updated: 0,
    };

    if (replaceExisting) {
      await prisma.machine.deleteMany();
    }

    await prisma.$transaction(async (tx) => {
      for (const row of machineRows) {
        const updateData = {
          name: row.name.trim(),
          shortName: normalizeOptional(row.shortName),
          classification: normalizeOptional(row.classification),
          operatingStatus: normalizeOptional(row.operatingStatus),
          ncManual: normalizeOptional(row.ncManual),
          maker: normalizeOptional(row.maker),
          processClassification: normalizeOptional(row.processClassification),
          coolant: normalizeOptional(row.coolant),
        };
        const existing = await tx.machine.findUnique({
          where: { equipmentManagementNumber: row.equipmentManagementNumber.trim() },
        });

        if (existing) {
          const diff = buildUpdateDiff(existing, updateData);
          if (!diff.hasChanges) {
            continue;
          }
          await tx.machine.update({
            where: { equipmentManagementNumber: row.equipmentManagementNumber.trim() },
            data: diff.data,
          });
          result.updated += 1;
          continue;
        }

        await tx.machine.create({
          data: {
            equipmentManagementNumber: row.equipmentManagementNumber.trim(),
            ...updateData,
          },
        });
        result.created += 1;
      }
    });

    return result;
  }
}
