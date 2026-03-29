import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { EmployeeService } from '../tools/employee.service.js';
import { apiProcessGroupToPrisma, parseApiProcessGroup } from './part-measurement-process-group.adapter.js';

export type CreateSheetInput = {
  productNo: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  machineName?: string | null;
  resourceCdSnapshot?: string | null;
  processGroup: string;
  templateId: string;
  scannedBarcodeRaw?: string | null;
  clientDeviceId?: string | null;
};

export type PatchSheetInput = {
  quantity?: number | null;
  employeeTagUid?: string | null;
  clearEmployee?: boolean;
  results?: Array<{
    pieceIndex: number;
    templateItemId: string;
    value?: string | number | null;
  }>;
};

function parseDecimal(value: string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Prisma.Decimal(String(value));
  }
  const s = value.trim();
  if (s.length === 0) return null;
  try {
    return new Prisma.Decimal(s);
  } catch {
    return null;
  }
}

function isBlankValue(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}


export class PartMeasurementSheetService {
  private readonly employees = new EmployeeService();

  async createDraft(input: CreateSheetInput) {
    const group = parseApiProcessGroup(input.processGroup);
    const prismaGroup = apiProcessGroupToPrisma(group);

    const template = await prisma.partMeasurementTemplate.findFirst({
      where: { id: input.templateId, isActive: true },
      include: { items: true }
    });
    if (!template) {
      throw new ApiError(404, 'テンプレートが見つかりません');
    }
    if (template.fhincd.trim().toUpperCase() !== input.fhincd.trim().toUpperCase()) {
      throw new ApiError(400, 'テンプレートと品番が一致しません');
    }
    if (template.processGroup !== prismaGroup) {
      throw new ApiError(400, 'テンプレートと工程区分が一致しません');
    }

    return prisma.partMeasurementSheet.create({
      data: {
        status: 'DRAFT',
        productNo: input.productNo.trim(),
        fseiban: input.fseiban.trim(),
        fhincd: input.fhincd.trim(),
        fhinmei: input.fhinmei.trim(),
        machineName: input.machineName?.trim() || null,
        resourceCdSnapshot: input.resourceCdSnapshot?.trim() || null,
        processGroupSnapshot: prismaGroup,
        templateId: template.id,
        scannedBarcodeRaw: input.scannedBarcodeRaw?.trim() || null,
        clientDeviceId: input.clientDeviceId ?? undefined
      },
      include: {
        template: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
        results: true,
        employee: true
      }
    });
  }

  async getById(id: string) {
    const sheet = await prisma.partMeasurementSheet.findUnique({
      where: { id },
      include: {
        template: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
        results: true,
        employee: true
      }
    });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    return sheet;
  }

  async patch(id: string, input: PatchSheetInput) {
    const sheet = await prisma.partMeasurementSheet.findUnique({
      where: { id },
      include: { template: { include: { items: true } } }
    });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    if (sheet.status === 'FINALIZED') {
      throw new ApiError(400, '確定済みの記録表は更新できません');
    }

    let employeeId: string | null | undefined;
    let employeeNameSnapshot: string | null | undefined;
    let touchEmployee = false;
    if (input.clearEmployee) {
      employeeId = null;
      employeeNameSnapshot = null;
      touchEmployee = true;
    } else if (input.employeeTagUid !== undefined) {
      const tag = (input.employeeTagUid ?? '').trim();
      if (tag.length > 0) {
        const emp = await this.employees.findByNfcTagUid(tag);
        if (!emp) {
          throw new ApiError(404, '従業員が登録されていません');
        }
        employeeId = emp.id;
        employeeNameSnapshot = emp.displayName;
        touchEmployee = true;
      }
    }

    const quantityUpdate =
      input.quantity === undefined ? undefined : input.quantity === null ? null : input.quantity;

    await prisma.$transaction(async (tx) => {
      const data: Prisma.PartMeasurementSheetUpdateInput = {};
      if (quantityUpdate !== undefined) {
        data.quantity = quantityUpdate;
      }
      if (touchEmployee) {
        data.employeeNameSnapshot = employeeNameSnapshot ?? null;
        data.employee =
          employeeId !== undefined && employeeId !== null
            ? { connect: { id: employeeId } }
            : { disconnect: true };
      }
      await tx.partMeasurementSheet.update({
        where: { id },
        data
      });

      const updated = await tx.partMeasurementSheet.findUnique({ where: { id } });
      const q = updated?.quantity;
      if (typeof q === 'number' && q >= 0) {
        await tx.partMeasurementResult.deleteMany({
          where: { sheetId: id, pieceIndex: { gte: q } }
        });
      }

      if (input.results && input.results.length > 0) {
        const template = await tx.partMeasurementSheet.findUnique({
          where: { id },
          include: { template: { include: { items: true } } }
        });
        const items = template?.template?.items ?? [];
        const itemIds = new Set(items.map((i) => i.id));
        const qty = template?.quantity;

        for (const r of input.results) {
          if (!itemIds.has(r.templateItemId)) {
            throw new ApiError(400, 'テンプレート項目IDが不正です');
          }
          if (r.pieceIndex < 0) {
            throw new ApiError(400, '個体番号が範囲外です');
          }
          if (typeof qty === 'number' && r.pieceIndex >= qty) {
            throw new ApiError(400, '個体番号が範囲外です');
          }
          const item = items.find((i) => i.id === r.templateItemId);
          const dec = parseDecimal(r.value);
          if (!isBlankValue(r.value) && dec === null) {
            throw new ApiError(400, '測定値は数値で入力してください');
          }
          if (dec !== null && item && !item.allowNegative && dec.lessThan(0)) {
            throw new ApiError(400, '負の値は入力できません');
          }
          await tx.partMeasurementResult.upsert({
            where: {
              sheetId_pieceIndex_templateItemId: {
                sheetId: id,
                pieceIndex: r.pieceIndex,
                templateItemId: r.templateItemId
              }
            },
            create: {
              sheetId: id,
              pieceIndex: r.pieceIndex,
              templateItemId: r.templateItemId,
              value: dec
            },
            update: { value: dec }
          });
        }
      }
    });

    return this.getById(id);
  }

  async finalize(id: string) {
    const sheet = await prisma.partMeasurementSheet.findUnique({
      where: { id },
      include: { template: { include: { items: { orderBy: { sortOrder: 'asc' } } } } }
    });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    if (sheet.status === 'FINALIZED') {
      throw new ApiError(400, 'すでに確定済みです');
    }
    if (!sheet.employeeId) {
      throw new ApiError(400, '作業者（社員）が未設定です');
    }
    if (sheet.quantity === null || sheet.quantity === undefined || sheet.quantity < 1) {
      throw new ApiError(400, '個数を入力してください');
    }
    const items = sheet.template?.items ?? [];
    if (items.length === 0) {
      throw new ApiError(400, 'テンプレート項目がありません');
    }

    const expectedCount = sheet.quantity * items.length;
    const itemIds = items.map((it) => it.id);
    const actualCount = await prisma.partMeasurementResult.count({
      where: {
        sheetId: id,
        templateItemId: { in: itemIds },
        pieceIndex: { gte: 0, lt: sheet.quantity },
        NOT: { value: null }
      }
    });
    if (actualCount < expectedCount) {
      throw new ApiError(400, '未入力の測定値があります');
    }

    return prisma.partMeasurementSheet.update({
      where: { id },
      data: {
        status: 'FINALIZED',
        finalizedAt: new Date()
      },
      include: {
        template: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
        results: true,
        employee: true
      }
    });
  }
}
