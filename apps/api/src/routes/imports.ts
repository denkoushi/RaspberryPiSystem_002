import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { EmployeeStatus, ImportStatus, ItemStatus, Prisma } from '@prisma/client';
import { authorizeRoles } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';

const fieldSchema = z.object({
  replaceExisting: z.coerce.boolean().optional().default(false)
});

const employeeCsvSchema = z.object({
  employeeCode: z.string().min(1),
  displayName: z.string().min(1),
  nfcTagUid: z.string().optional(),
  department: z.string().optional(),
  contact: z.string().optional(),
  status: z.string().optional()
});

const itemCsvSchema = z.object({
  itemCode: z.string().min(1),
  name: z.string().min(1),
  nfcTagUid: z.string().optional(),
  category: z.string().optional(),
  storageLocation: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional()
});

type EmployeeCsvRow = z.infer<typeof employeeCsvSchema>;
type ItemCsvRow = z.infer<typeof itemCsvSchema>;

interface ImportResult {
  processed: number;
  created: number;
  updated: number;
}

async function readFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

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

function normalizeEmployeeStatus(value?: string): EmployeeStatus {
  if (!value) return EmployeeStatus.ACTIVE;
  const upper = value.trim().toUpperCase();
  if (upper in EmployeeStatus) {
    return EmployeeStatus[upper as keyof typeof EmployeeStatus];
  }
  throw new ApiError(400, `無効な従業員ステータス: ${value}`);
}

function normalizeItemStatus(value?: string): ItemStatus {
  if (!value) return ItemStatus.AVAILABLE;
  const upper = value.trim().toUpperCase();
  if (upper in ItemStatus) {
    return ItemStatus[upper as keyof typeof ItemStatus];
  }
  throw new ApiError(400, `無効なアイテムステータス: ${value}`);
}

async function importEmployees(
  tx: Prisma.TransactionClient,
  rows: EmployeeCsvRow[],
  replaceExisting: boolean
): Promise<ImportResult> {
  if (rows.length === 0) {
    return { processed: 0, created: 0, updated: 0 };
  }

  const result: ImportResult = {
    processed: rows.length,
    created: 0,
    updated: 0
  };

  if (replaceExisting) {
    await tx.employee.deleteMany();
  }
  for (const row of rows) {
    const payload = {
      displayName: row.displayName,
      department: row.department || null,
      contact: row.contact || null,
      nfcTagUid: row.nfcTagUid || null,
      status: normalizeEmployeeStatus(row.status)
    };
    const existing = await tx.employee.findUnique({ where: { employeeCode: row.employeeCode } });
    if (existing) {
      await tx.employee.update({
        where: { employeeCode: row.employeeCode },
        data: payload
      });
      result.updated += 1;
    } else {
      await tx.employee.create({
        data: {
          employeeCode: row.employeeCode,
          ...payload
        }
      });
      result.created += 1;
    }
  }

  return result;
}

async function importItems(
  tx: Prisma.TransactionClient,
  rows: ItemCsvRow[],
  replaceExisting: boolean
): Promise<ImportResult> {
  if (rows.length === 0) {
    return { processed: 0, created: 0, updated: 0 };
  }

  const result: ImportResult = {
    processed: rows.length,
    created: 0,
    updated: 0
  };

  if (replaceExisting) {
    await tx.item.deleteMany();
  }
  for (const row of rows) {
    const payload = {
      name: row.name,
      description: row.notes || null,
      category: row.category || null,
      storageLocation: row.storageLocation || null,
      nfcTagUid: row.nfcTagUid || null,
      status: normalizeItemStatus(row.status),
      notes: row.notes || null
    };
    const existing = await tx.item.findUnique({ where: { itemCode: row.itemCode } });
    if (existing) {
      await tx.item.update({
        where: { itemCode: row.itemCode },
        data: payload
      });
      result.updated += 1;
    } else {
      await tx.item.create({
        data: {
          itemCode: row.itemCode,
          ...payload
        }
      });
      result.created += 1;
    }
  }

  return result;
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  const mustBeAdmin = authorizeRoles('ADMIN');

  app.post('/imports/master', { preHandler: mustBeAdmin }, async (request) => {
    const files: { employees?: Buffer; items?: Buffer } = {};
    const fieldValues: Record<string, string> = {};

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await readFile(part);
        if (part.fieldname === 'employees') {
          files.employees = buffer;
        } else if (part.fieldname === 'items') {
          files.items = buffer;
        }
      } else {
        fieldValues[part.fieldname] = String(part.value);
      }
    }

    const { replaceExisting } = fieldSchema.parse(fieldValues);

    if (!files.employees && !files.items) {
      throw new ApiError(400, 'employees.csv もしくは items.csv をアップロードしてください');
    }

    const employeeRows = files.employees
      ? parseCsvRows(files.employees).map((row) => employeeCsvSchema.parse(row))
      : [];
    const itemRows = files.items ? parseCsvRows(files.items).map((row) => itemCsvSchema.parse(row)) : [];

    const job = await prisma.importJob.create({
      data: {
        type: 'MASTER',
        status: ImportStatus.PROCESSING,
        summary: {
          replaceExisting
        }
      }
    });

    try {
      const summary: Prisma.JsonObject = {};

      await prisma.$transaction(async (tx) => {
        if (employeeRows.length > 0) {
          const employeeSummary = await importEmployees(tx, employeeRows, replaceExisting);
          summary.employees = employeeSummary as unknown as Prisma.JsonValue;
        }
        if (itemRows.length > 0) {
          const itemSummary = await importItems(tx, itemRows, replaceExisting);
          summary.items = itemSummary as unknown as Prisma.JsonValue;
        }
      });

      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: ImportStatus.COMPLETED,
          summary,
          completedAt: new Date()
        }
      });

      return { jobId: job.id, summary };
    } catch (error) {
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: ImportStatus.FAILED,
          summary: {
            error: error instanceof Error ? error.message : 'Unknown error'
          },
          completedAt: new Date()
        }
      });
      throw error;
    }
  });

  app.get('/imports/jobs', { preHandler: mustBeAdmin }, async () => {
    const jobs = await prisma.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    return { jobs };
  });
}
