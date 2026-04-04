import { PartMeasurementProcessGroup, PartMeasurementSheetStatus, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { EmployeeService } from '../tools/employee.service.js';
import { apiProcessGroupToPrisma, parseApiProcessGroup } from './part-measurement-process-group.adapter.js';
import {
  PART_MEASUREMENT_EDIT_LOCK_TTL_MS,
  PART_MEASUREMENT_LEGACY_RESOURCE_CD
} from './part-measurement-constants.js';
import { partMeasurementTemplateFullInclude } from './part-measurement-template-include.js';

export type CreateSheetInput = {
  productNo: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  machineName?: string | null;
  resourceCdSnapshot: string;
  processGroup: string;
  templateId: string;
  scannedBarcodeRaw?: string | null;
  clientDeviceId?: string | null;
  /**
   * true のとき、テンプレートの資源CDとスナップショットが不一致でも可（キオスクで別資源登録テンプレを借用）。
   * fhincd・工程は現行どおり一致必須。
   */
  allowAlternateResourceTemplate?: boolean;
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

export type FindOrOpenInput = {
  productNo: string;
  processGroup: string;
  resourceCd: string;
  /** 日程行からヘッダを埋める（検証用） */
  scheduleRowId?: string | null;
  fseiban?: string | null;
  fhincd?: string | null;
  fhinmei?: string | null;
  machineName?: string | null;
  scannedBarcodeRaw?: string | null;
  clientDeviceId?: string | null;
};

function normalizeResourceCd(raw: string): string {
  const t = raw.trim();
  if (t.length === 0) return PART_MEASUREMENT_LEGACY_RESOURCE_CD;
  return t;
}

function lockExpiryFromNow(): Date {
  return new Date(Date.now() + PART_MEASUREMENT_EDIT_LOCK_TTL_MS);
}

function isLockValid(sheet: { editLockExpiresAt: Date | null }): boolean {
  if (!sheet.editLockExpiresAt) return false;
  return sheet.editLockExpiresAt.getTime() > Date.now();
}

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

function countDecimalPlacesString(raw: string): number {
  const s = raw.trim();
  const i = s.indexOf('.');
  if (i < 0) return 0;
  return s.length - i - 1;
}

export class PartMeasurementSheetService {
  private readonly employees = new EmployeeService();

  private async assertDraftEditLock(
    sheet: {
      id: string;
      status: string;
      editLockClientDeviceId: string | null;
      editLockExpiresAt: Date | null;
    },
    clientDeviceId: string | null | undefined
  ) {
    if (sheet.status !== 'DRAFT') return;
    // 管理JWTのみ（x-client-key なし）の場合は現場ロックを適用しない
    if (!clientDeviceId) return;
    if (!isLockValid(sheet)) {
      return;
    }
    if (sheet.editLockClientDeviceId && sheet.editLockClientDeviceId !== clientDeviceId) {
      throw new ApiError(
        409,
        'この記録表は別の端末で編集中です。引き継ぎ操作を行ってください。',
        undefined,
        'PART_MEASUREMENT_EDIT_LOCKED'
      );
    }
  }

  private async refreshEditLock(
    tx: Prisma.TransactionClient,
    sheetId: string,
    clientDeviceId: string | null | undefined
  ) {
    if (!clientDeviceId) return;
    await tx.partMeasurementSheet.update({
      where: { id: sheetId },
      data: {
        editLockClientDeviceId: clientDeviceId,
        editLockExpiresAt: lockExpiryFromNow()
      }
    });
  }

  async transferEditLock(sheetId: string, clientDeviceId: string | null | undefined, confirm: boolean) {
    if (!clientDeviceId) {
      throw new ApiError(400, '端末識別が必要です');
    }
    const sheet = await prisma.partMeasurementSheet.findUnique({ where: { id: sheetId } });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    if (sheet.status !== 'DRAFT') {
      throw new ApiError(400, '下書きのみ編集ロックを譲渡できます');
    }
    if (isLockValid(sheet) && sheet.editLockClientDeviceId && sheet.editLockClientDeviceId !== clientDeviceId) {
      if (!confirm) {
        throw new ApiError(
          409,
          '別端末が編集中です。引き継ぎを確認してください。',
          undefined,
          'PART_MEASUREMENT_TRANSFER_CONFIRM_REQUIRED'
        );
      }
    }
    return prisma.partMeasurementSheet.update({
      where: { id: sheetId },
      data: {
        editLockClientDeviceId: clientDeviceId,
        editLockExpiresAt: lockExpiryFromNow()
      },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
  }

  async findDraftByBusinessKey(productNo: string, processGroup: PartMeasurementProcessGroup, resourceCd: string) {
    const r = normalizeResourceCd(resourceCd);
    return prisma.partMeasurementSheet.findFirst({
      where: {
        status: 'DRAFT',
        productNo: productNo.trim(),
        processGroupSnapshot: processGroup,
        resourceCdSnapshot: r
      },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
  }

  async findFinalizedByBusinessKey(
    productNo: string,
    processGroup: PartMeasurementProcessGroup,
    resourceCd: string
  ) {
    const r = normalizeResourceCd(resourceCd);
    return prisma.partMeasurementSheet.findFirst({
      where: {
        status: 'FINALIZED',
        productNo: productNo.trim(),
        processGroupSnapshot: processGroup,
        resourceCdSnapshot: r
      },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
  }

  async findOrOpen(input: FindOrOpenInput) {
    const group = parseApiProcessGroup(input.processGroup);
    const prismaGroup = apiProcessGroupToPrisma(group);
    const resourceCd = normalizeResourceCd(input.resourceCd);
    const pn = input.productNo.trim();

    const draft = await this.findDraftByBusinessKey(pn, prismaGroup, resourceCd);
    if (draft) {
      return { mode: 'resume_draft' as const, sheet: draft };
    }

    const finalized = await this.findFinalizedByBusinessKey(pn, prismaGroup, resourceCd);
    if (finalized) {
      return { mode: 'view_finalized' as const, sheet: finalized };
    }

    const fseiban = input.fseiban?.trim() ?? '';
    const fhincd = input.fhincd?.trim() ?? '';
    const fhinmei = input.fhinmei?.trim() ?? '';
    if (!fseiban || !fhincd || !fhinmei) {
      return { mode: 'needs_resolve' as const, sheet: null };
    }

    const template = await prisma.partMeasurementTemplate.findFirst({
      where: {
        fhincd,
        processGroup: prismaGroup,
        resourceCd,
        isActive: true
      },
      orderBy: { version: 'desc' },
      include: partMeasurementTemplateFullInclude
    });
    if (!template) {
      return {
        mode: 'needs_template' as const,
        sheet: null,
        header: {
          productNo: pn,
          fseiban,
          fhincd,
          fhinmei,
          machineName: input.machineName?.trim() || null,
          resourceCd,
          processGroup: group
        }
      };
    }

    const created = await this.createDraft({
      productNo: pn,
      fseiban,
      fhincd,
      fhinmei,
      machineName: input.machineName ?? null,
      resourceCdSnapshot: resourceCd,
      processGroup: input.processGroup,
      templateId: template.id,
      scannedBarcodeRaw: input.scannedBarcodeRaw ?? null,
      clientDeviceId: input.clientDeviceId ?? null
    });
    return { mode: 'created_draft' as const, sheet: created };
  }

  async createDraft(input: CreateSheetInput) {
    const group = parseApiProcessGroup(input.processGroup);
    const prismaGroup = apiProcessGroupToPrisma(group);
    const resourceCd = normalizeResourceCd(input.resourceCdSnapshot);

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
    const templateResourceNorm = normalizeResourceCd(template.resourceCd);
    const allowAlternate = input.allowAlternateResourceTemplate === true;
    if (!allowAlternate && templateResourceNorm !== resourceCd) {
      throw new ApiError(400, 'テンプレートと資源CDが一致しません');
    }

    const existingFinal = await this.findFinalizedByBusinessKey(input.productNo, prismaGroup, resourceCd);
    if (existingFinal) {
      throw new ApiError(400, 'この製造order・工程・資源CDは既に確定済みの記録があります');
    }

    const existingDraft = await this.findDraftByBusinessKey(input.productNo, prismaGroup, resourceCd);
    if (existingDraft) {
      throw new ApiError(409, '同じキーの下書きが既に存在します', undefined, 'PART_MEASUREMENT_DRAFT_EXISTS');
    }

    return prisma.partMeasurementSheet.create({
      data: {
        status: 'DRAFT',
        productNo: input.productNo.trim(),
        fseiban: input.fseiban.trim(),
        fhincd: input.fhincd.trim(),
        fhinmei: input.fhinmei.trim(),
        machineName: input.machineName?.trim() || null,
        resourceCdSnapshot: resourceCd,
        processGroupSnapshot: prismaGroup,
        templateId: template.id,
        scannedBarcodeRaw: input.scannedBarcodeRaw?.trim() || null,
        clientDeviceId: input.clientDeviceId ?? undefined,
        editLockClientDeviceId: input.clientDeviceId ?? undefined,
        editLockExpiresAt: input.clientDeviceId ? lockExpiryFromNow() : null
      },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
  }

  async getById(id: string) {
    const sheet = await prisma.partMeasurementSheet.findUnique({
      where: { id },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    return sheet;
  }

  async listDrafts(params: { limit: number; cursor?: string | null }) {
    const take = Math.min(Math.max(params.limit, 1), 100);
    const rows = await prisma.partMeasurementSheet.findMany({
      where: { status: 'DRAFT' },
      orderBy: [{ updatedAt: 'desc' }],
      take: take + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      skip: params.cursor ? 1 : 0,
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
    let nextCursor: string | null = null;
    let list = rows;
    if (rows.length > take) {
      const last = rows.pop();
      nextCursor = last?.id ?? null;
      list = rows;
    }
    return { sheets: list, nextCursor };
  }

  async listFinalized(params: {
    limit: number;
    cursor?: string | null;
    productNo?: string | null;
    fseiban?: string | null;
    fhincd?: string | null;
    processGroup?: 'CUTTING' | 'GRINDING' | null;
    resourceCd?: string | null;
    dateFrom?: Date | null;
    dateTo?: Date | null;
    includeCancelled?: boolean;
    includeInvalidated?: boolean;
  }) {
    const take = Math.min(Math.max(params.limit, 1), 100);
    const statuses: PartMeasurementSheetStatus[] = ['FINALIZED'];
    if (params.includeCancelled) statuses.push('CANCELLED');
    if (params.includeInvalidated) statuses.push('INVALIDATED');

    const where: Prisma.PartMeasurementSheetWhereInput = {
      status: { in: statuses }
    };
    if (params.productNo?.trim()) where.productNo = { contains: params.productNo.trim(), mode: 'insensitive' };
    if (params.fseiban?.trim()) where.fseiban = { contains: params.fseiban.trim(), mode: 'insensitive' };
    if (params.fhincd?.trim()) where.fhincd = { contains: params.fhincd.trim(), mode: 'insensitive' };
    if (params.processGroup) where.processGroupSnapshot = params.processGroup;
    if (params.resourceCd?.trim()) {
      where.resourceCdSnapshot = normalizeResourceCd(params.resourceCd);
    }
    if (params.dateFrom || params.dateTo) {
      where.finalizedAt = {};
      if (params.dateFrom) where.finalizedAt.gte = params.dateFrom;
      if (params.dateTo) where.finalizedAt.lte = params.dateTo;
    }

    const rows = await prisma.partMeasurementSheet.findMany({
      where,
      orderBy: [{ finalizedAt: 'desc' }, { updatedAt: 'desc' }],
      take: take + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      skip: params.cursor ? 1 : 0,
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
    let nextCursor: string | null = null;
    let list = rows;
    if (rows.length > take) {
      const last = rows.pop();
      nextCursor = last?.id ?? null;
      list = rows;
    }
    return { sheets: list, nextCursor };
  }

  async patch(id: string, input: PatchSheetInput, clientDeviceId?: string | null) {
    const sheet = await prisma.partMeasurementSheet.findUnique({
      where: { id },
      include: { template: { include: partMeasurementTemplateFullInclude } }
    });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    if (sheet.status !== 'DRAFT') {
      throw new ApiError(400, '下書き以外は更新できません');
    }

    await this.assertDraftEditLock(sheet, clientDeviceId);

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
      await this.refreshEditLock(tx, id, clientDeviceId ?? undefined);

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

      const afterEmp = await tx.partMeasurementSheet.findUnique({ where: { id } });
      if (afterEmp?.employeeId && !afterEmp.createdByEmployeeId) {
        await tx.partMeasurementSheet.update({
          where: { id },
          data: {
            createdByEmployeeId: afterEmp.employeeId,
            createdByEmployeeNameSnapshot: afterEmp.employeeNameSnapshot
          }
        });
      }

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
          include: { template: { include: partMeasurementTemplateFullInclude } }
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
          if (!isBlankValue(r.value) && typeof r.value === 'string' && item) {
            const places = countDecimalPlacesString(r.value);
            if (places > item.decimalPlaces) {
              throw new ApiError(400, `小数桁数は最大${item.decimalPlaces}桁です`);
            }
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

  async finalize(id: string, clientDeviceId?: string | null) {
    const sheet = await prisma.partMeasurementSheet.findUnique({
      where: { id },
      include: { template: { include: partMeasurementTemplateFullInclude } }
    });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    if (sheet.status !== 'DRAFT') {
      throw new ApiError(400, '下書きのみ確定できます');
    }

    await this.assertDraftEditLock(sheet, clientDeviceId);

    if (!sheet.employeeId) {
      throw new ApiError(400, '確定前に作業者（社員）のNFCを読み取ってください');
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
        finalizedAt: new Date(),
        finalizedByEmployeeId: sheet.employeeId,
        finalizedByEmployeeNameSnapshot: sheet.employeeNameSnapshot,
        editLockClientDeviceId: null,
        editLockExpiresAt: null
      },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
  }

  async cancelDraft(id: string, reason: string, clientDeviceId?: string | null) {
    const sheet = await prisma.partMeasurementSheet.findUnique({ where: { id } });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    if (sheet.status !== 'DRAFT') {
      throw new ApiError(400, '下書きのみ取消できます');
    }
    await this.assertDraftEditLock(sheet, clientDeviceId);
    const r = reason.trim();
    if (r.length === 0) {
      throw new ApiError(400, '取消理由を入力してください');
    }

    return prisma.partMeasurementSheet.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: r.slice(0, 2000),
        editLockClientDeviceId: null,
        editLockExpiresAt: null
      },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
  }

  async invalidateFinalized(id: string, reason: string, clientDeviceId?: string | null) {
    const sheet = await prisma.partMeasurementSheet.findUnique({ where: { id } });
    if (!sheet) {
      throw new ApiError(404, '記録表が見つかりません');
    }
    if (sheet.status !== 'FINALIZED') {
      throw new ApiError(400, '確定済みのみ無効化できます');
    }
    const r = reason.trim();
    if (r.length === 0) {
      throw new ApiError(400, '無効化理由を入力してください');
    }
    void clientDeviceId;

    return prisma.partMeasurementSheet.update({
      where: { id },
      data: {
        status: 'INVALIDATED',
        invalidatedAt: new Date(),
        invalidatedReason: r.slice(0, 2000)
      },
      include: {
        template: { include: partMeasurementTemplateFullInclude },
        results: true,
        employee: true,
        createdByEmployee: true,
        finalizedByEmployee: true,
        clientDevice: true,
        editLockClientDevice: true
      }
    });
  }

  buildSheetCsv(sheet: Awaited<ReturnType<PartMeasurementSheetService['getById']>>): string {
    const lines: string[] = [];
    const esc = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? '' : String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    lines.push('rowType,key,value');
    lines.push(`H,id,${esc(sheet.id)}`);
    lines.push(`H,status,${esc(sheet.status)}`);
    lines.push(`H,productNo,${esc(sheet.productNo)}`);
    lines.push(`H,fseiban,${esc(sheet.fseiban)}`);
    lines.push(`H,fhincd,${esc(sheet.fhincd)}`);
    lines.push(`H,fhinmei,${esc(sheet.fhinmei)}`);
    lines.push(`H,machineName,${esc(sheet.machineName)}`);
    lines.push(`H,resourceCd,${esc(sheet.resourceCdSnapshot)}`);
    lines.push(
      `H,processGroup,${esc(sheet.processGroupSnapshot === 'GRINDING' ? 'grinding' : 'cutting')}`
    );
    lines.push(`H,quantity,${esc(sheet.quantity)}`);
    lines.push(`H,createdAt,${esc(sheet.createdAt.toISOString())}`);
    lines.push(`H,finalizedAt,${esc(sheet.finalizedAt?.toISOString() ?? '')}`);
    lines.push(`H,createdByName,${esc(sheet.createdByEmployeeNameSnapshot)}`);
    lines.push(`H,finalizedByName,${esc(sheet.finalizedByEmployeeNameSnapshot)}`);
    lines.push(`H,employeeName,${esc(sheet.employeeNameSnapshot)}`);

    const items = sheet.template?.items ?? [];
    const itemById = new Map(items.map((it) => [it.id, it]));
    const sortedResults = [...sheet.results].sort((a, b) => {
      if (a.pieceIndex !== b.pieceIndex) return a.pieceIndex - b.pieceIndex;
      const oa = itemById.get(a.templateItemId)?.sortOrder ?? 0;
      const ob = itemById.get(b.templateItemId)?.sortOrder ?? 0;
      return oa - ob;
    });

    lines.push('rowType,pieceIndex,displayMarker,datumSurface,measurementPoint,measurementLabel,unit,value');
    for (const r of sortedResults) {
      const it = itemById.get(r.templateItemId);
      const val =
        r.value !== null && r.value !== undefined
          ? typeof r.value === 'object' && 'toFixed' in r.value
            ? String(r.value)
            : String(r.value)
          : '';
      lines.push(
        [
          'D',
          esc(r.pieceIndex + 1),
          esc(it?.displayMarker),
          esc(it?.datumSurface),
          esc(it?.measurementPoint),
          esc(it?.measurementLabel),
          esc(it?.unit),
          esc(val)
        ].join(',')
      );
    }

    return `${lines.join('\n')}\n`;
  }
}
