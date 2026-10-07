import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { canApprove, positionRank } from '../knowledge/knowledge-position-rank.js';

/** Master records that carry NFC tags and are managed on the kiosk tag desk. */
export const TAG_DESK_KINDS = ['employee', 'item', 'instrument', 'rigging'] as const;
export type TagDeskKind = (typeof TAG_DESK_KINDS)[number];
/** Inventory shelf / quantity / restock tags can only be released here; they are attached in inventory setup. */
export type TagBindingKind = TagDeskKind | 'inventory';

export type TagDeskTag = { bindingId: string; uid: string };
export type PositionApproval = 'approver' | 'none' | 'unmapped';

export type TagDeskRow = {
  kind: TagDeskKind;
  id: string;
  code: string;
  name: string;
  sub: string | null;
  sub2?: string | null;
  positionName?: string | null;
  positionApproval?: PositionApproval | null;
  status: string;
  tags: TagDeskTag[];
  /** Editable master fields, shaped like the kiosk edit form. */
  record: Record<string, unknown>;
};

export type TagUse = { at: string; action: 'BORROW' | 'RETURN'; label: string };

export type TagBinding = {
  kind: TagBindingKind;
  bindingId: string;
  targetId: string | null;
  code: string;
  name: string;
  sub: string | null;
  sub2?: string | null;
  status: string | null;
  /** Loans not yet returned (for an employee: items they still hold). */
  activeLoans: number;
  recent: TagUse[];
};

export type TagBindingEventView = {
  id: string;
  uid: string;
  action: 'LINK' | 'UNLINK';
  targetKind: string;
  targetLabel: string;
  createdAt: string;
};

type Tx = Prisma.TransactionClient;

const RECENT_LIMIT = 3;
const INVENTORY_TAG_LABELS = { ITEM: '在庫の棚タグ', QUANTITY: '数量タグ', RESTOCK: '補充タグ' } as const;

export function normalizeTagUid(raw: string): string {
  return raw.trim();
}

function loanUses(
  loans: Array<{ borrowedAt: Date; returnedAt: Date | null; cancelledAt: Date | null; label: string }>
): TagUse[] {
  const uses: TagUse[] = [];
  for (const loan of loans) {
    if (loan.cancelledAt) continue;
    uses.push({ at: loan.borrowedAt.toISOString(), action: 'BORROW', label: loan.label });
    if (loan.returnedAt) uses.push({ at: loan.returnedAt.toISOString(), action: 'RETURN', label: loan.label });
  }
  return uses.sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT_LIMIT);
}

const loanSelect = {
  borrowedAt: true,
  returnedAt: true,
  cancelledAt: true,
  employee: { select: { displayName: true } },
  item: { select: { name: true } },
  measuringInstrument: { select: { name: true } },
  riggingGear: { select: { name: true } }
} satisfies Prisma.LoanSelect;

type LoanRow = Prisma.LoanGetPayload<{ select: typeof loanSelect }>;

const assetLabel = (loan: LoanRow) =>
  loan.item?.name ?? loan.measuringInstrument?.name ?? loan.riggingGear?.name ?? '写真持出';

function positionApproval(name: string | null, ranks: Map<string, string>): PositionApproval | null {
  if (!name) return null;
  if (!ranks.has(name)) return 'unmapped';
  return canApprove(positionRank(ranks.get(name))) ? 'approver' : 'none';
}

export class TagDeskService {
  async listRegistry(kind: TagDeskKind): Promise<TagDeskRow[]> {
    switch (kind) {
      case 'employee': {
        const [rows, mappings] = await Promise.all([
          prisma.employee.findMany({ orderBy: { employeeCode: 'asc' } }),
          prisma.knowledgePositionRank.findMany({ select: { positionName: true, rank: true } })
        ]);
        const ranks = new Map(mappings.map((mapping) => [mapping.positionName, mapping.rank]));
        return rows.map((e) => ({
          kind,
          id: e.id,
          code: e.employeeCode,
          name: e.displayName,
          sub: e.department,
          sub2: e.section || null,
          positionName: e.positionName,
          positionApproval: positionApproval(e.positionName, ranks),
          status: e.status,
          tags: e.nfcTagUid ? [{ bindingId: e.id, uid: e.nfcTagUid }] : [],
          record: {
            employeeCode: e.employeeCode,
            lastName: e.lastName ?? '',
            firstName: e.firstName ?? '',
            department: e.department ?? '',
            section: e.section ?? '',
            positionName: e.positionName ?? '',
            status: e.status
          }
        }));
      }
      case 'item': {
        const rows = await prisma.item.findMany({ orderBy: { itemCode: 'asc' } });
        return rows.map((i) => ({
          kind,
          id: i.id,
          code: i.itemCode,
          name: i.name,
          sub: i.storageLocation,
          status: i.status,
          tags: i.nfcTagUid ? [{ bindingId: i.id, uid: i.nfcTagUid }] : [],
          record: {
            itemCode: i.itemCode,
            name: i.name,
            category: i.category ?? '',
            storageLocation: i.storageLocation ?? '',
            status: i.status,
            notes: i.notes ?? ''
          }
        }));
      }
      case 'instrument': {
        const rows = await prisma.measuringInstrument.findMany({
          orderBy: { managementNumber: 'asc' },
          include: { tags: { orderBy: { createdAt: 'asc' } } }
        });
        return rows.map((m) => ({
          kind,
          id: m.id,
          code: m.managementNumber,
          name: m.name,
          sub: m.storageLocation,
          status: m.status,
          tags: m.tags.map((t) => ({ bindingId: t.id, uid: t.rfidTagUid })),
          record: {
            name: m.name,
            managementNumber: m.managementNumber,
            genreId: m.genreId ?? '',
            storageLocation: m.storageLocation ?? '',
            department: m.department ?? '',
            measurementRange: m.measurementRange ?? '',
            calibrationExpiryDate: m.calibrationExpiryDate ? m.calibrationExpiryDate.toISOString().slice(0, 10) : '',
            status: m.status
          }
        }));
      }
      case 'rigging': {
        const rows = await prisma.riggingGear.findMany({
          orderBy: { managementNumber: 'asc' },
          include: { tags: { orderBy: { createdAt: 'asc' } } }
        });
        return rows.map((r) => ({
          kind,
          id: r.id,
          code: r.managementNumber,
          name: r.name,
          sub: r.storageLocation,
          status: r.status,
          tags: r.tags.map((t) => ({ bindingId: t.id, uid: t.rfidTagUid })),
          record: {
            name: r.name,
            managementNumber: r.managementNumber,
            idNum: r.idNum ?? '',
            storageLocation: r.storageLocation ?? '',
            department: r.department ?? '',
            maxLoadTon: r.maxLoadTon ?? '',
            lengthMm: r.lengthMm ?? '',
            widthMm: r.widthMm ?? '',
            thicknessMm: r.thicknessMm ?? '',
            startedAt: r.startedAt ? r.startedAt.toISOString().slice(0, 10) : '',
            status: r.status,
            notes: r.notes ?? ''
          }
        }));
      }
    }
  }

  /** Every place this UID is bound, with what it was used for recently. */
  async resolve(rawUid: string): Promise<TagBinding[]> {
    const uid = normalizeTagUid(rawUid);
    if (!uid) return [];
    const [employee, item, instrumentTag, riggingTag, inventoryTag] = await Promise.all([
      prisma.employee.findUnique({ where: { nfcTagUid: uid } }),
      prisma.item.findUnique({ where: { nfcTagUid: uid } }),
      prisma.measuringInstrumentTag.findUnique({ where: { rfidTagUid: uid }, include: { measuringInstrument: true } }),
      prisma.riggingGearTag.findUnique({ where: { rfidTagUid: uid }, include: { riggingGear: true } }),
      prisma.inventoryNfcTag.findUnique({
        where: { uid },
        include: { compartment: { include: { inventoryItem: true, drawer: { include: { shelf: true } } } } }
      })
    ]);

    const bindings: TagBinding[] = [];
    if (employee) {
      const [loans, activeLoans] = await Promise.all([
        prisma.loan.findMany({ where: { employeeId: employee.id }, orderBy: { borrowedAt: 'desc' }, take: RECENT_LIMIT * 2, select: loanSelect }),
        prisma.loan.count({ where: { employeeId: employee.id, returnedAt: null, cancelledAt: null } })
      ]);
      bindings.push({
        kind: 'employee', bindingId: employee.id, targetId: employee.id, code: employee.employeeCode,
        name: employee.displayName, sub: employee.department, sub2: employee.section || null, status: employee.status, activeLoans,
        recent: loanUses(loans.map((l) => ({ ...l, label: assetLabel(l) })))
      });
    }
    const assetBinding = async (
      kind: 'item' | 'instrument' | 'rigging',
      bindingId: string,
      asset: { id: string; code: string; name: string; sub: string | null; status: string },
      where: Prisma.LoanWhereInput
    ) => {
      const [loans, activeLoans] = await Promise.all([
        prisma.loan.findMany({ where, orderBy: { borrowedAt: 'desc' }, take: RECENT_LIMIT * 2, select: loanSelect }),
        prisma.loan.count({ where: { ...where, returnedAt: null, cancelledAt: null } })
      ]);
      bindings.push({
        kind, bindingId, targetId: asset.id, code: asset.code, name: asset.name, sub: asset.sub, status: asset.status,
        activeLoans, recent: loanUses(loans.map((l) => ({ ...l, label: l.employee?.displayName ?? '不明' })))
      });
    };
    if (item) {
      await assetBinding('item', item.id, { id: item.id, code: item.itemCode, name: item.name, sub: item.storageLocation, status: item.status }, { itemId: item.id });
    }
    if (instrumentTag) {
      const m = instrumentTag.measuringInstrument;
      await assetBinding('instrument', instrumentTag.id, { id: m.id, code: m.managementNumber, name: m.name, sub: m.storageLocation, status: m.status }, { measuringInstrumentId: m.id });
    }
    if (riggingTag) {
      const r = riggingTag.riggingGear;
      await assetBinding('rigging', riggingTag.id, { id: r.id, code: r.managementNumber, name: r.name, sub: r.storageLocation, status: r.status }, { riggingGearId: r.id });
    }
    if (inventoryTag) {
      const compartment = inventoryTag.compartment;
      const place = compartment ? `${compartment.drawer.shelf.area} 棚${compartment.drawer.shelf.shelfNumber}-${compartment.drawer.drawerNumber}` : null;
      const name = inventoryTag.kind === 'QUANTITY'
        ? `${INVENTORY_TAG_LABELS.QUANTITY} ${inventoryTag.quantity ?? ''}`.trim()
        : compartment?.inventoryItem.name ?? INVENTORY_TAG_LABELS[inventoryTag.kind];
      bindings.push({
        kind: 'inventory', bindingId: inventoryTag.id, targetId: inventoryTag.compartmentId, code: INVENTORY_TAG_LABELS[inventoryTag.kind],
        name, sub: place, status: null, activeLoans: 0, recent: []
      });
    }
    return bindings;
  }

  async link(input: { kind: TagDeskKind; targetId: string; uid: string; replace?: boolean; clientDeviceId: string | null }): Promise<TagBinding[]> {
    const uid = normalizeTagUid(input.uid);
    if (uid.length < 4) throw new ApiError(400, 'タグのIDが短すぎます', undefined, 'TAG_UID_INVALID');
    try {
      await prisma.$transaction(async (tx) => {
        const usedBy = await this.findUsage(tx, uid);
        if (usedBy) {
          throw new ApiError(409, `このタグは「${usedBy}」で使われています。先に外してください`, { usedBy }, 'TAG_IN_USE');
        }
        let label: string;
        switch (input.kind) {
          case 'employee': {
            const employee = await tx.employee.findUnique({ where: { id: input.targetId } });
            if (!employee) throw new ApiError(404, '社員が見つかりません', undefined, 'TARGET_NOT_FOUND');
            label = employee.displayName;
            if (employee.nfcTagUid) {
              if (!input.replace) throw new ApiError(409, `${label} には別のタグが付いています`, undefined, 'TARGET_HAS_TAG');
              await this.record(tx, { uid: employee.nfcTagUid, action: 'UNLINK', targetKind: 'employee', targetId: employee.id, targetLabel: label, clientDeviceId: input.clientDeviceId });
            }
            await tx.employee.update({ where: { id: employee.id }, data: { nfcTagUid: uid } });
            break;
          }
          case 'item': {
            const item = await tx.item.findUnique({ where: { id: input.targetId } });
            if (!item) throw new ApiError(404, '工具が見つかりません', undefined, 'TARGET_NOT_FOUND');
            label = item.name;
            if (item.nfcTagUid) {
              if (!input.replace) throw new ApiError(409, `${label} には別のタグが付いています`, undefined, 'TARGET_HAS_TAG');
              await this.record(tx, { uid: item.nfcTagUid, action: 'UNLINK', targetKind: 'item', targetId: item.id, targetLabel: label, clientDeviceId: input.clientDeviceId });
            }
            await tx.item.update({ where: { id: item.id }, data: { nfcTagUid: uid } });
            break;
          }
          case 'instrument': {
            const instrument = await tx.measuringInstrument.findUnique({ where: { id: input.targetId } });
            if (!instrument) throw new ApiError(404, '計測機器が見つかりません', undefined, 'TARGET_NOT_FOUND');
            label = instrument.name;
            await tx.measuringInstrumentTag.create({ data: { measuringInstrumentId: instrument.id, rfidTagUid: uid } });
            break;
          }
          case 'rigging': {
            const gear = await tx.riggingGear.findUnique({ where: { id: input.targetId } });
            if (!gear) throw new ApiError(404, '吊具が見つかりません', undefined, 'TARGET_NOT_FOUND');
            label = gear.name;
            await tx.riggingGearTag.create({ data: { riggingGearId: gear.id, rfidTagUid: uid } });
            break;
          }
        }
        await this.record(tx, { uid, action: 'LINK', targetKind: input.kind, targetId: input.targetId, targetLabel: label, clientDeviceId: input.clientDeviceId });
      });
    } catch (error) {
      // Another terminal bound the same tag between our check and the write.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'このタグは別の場所で使われています。先に外してください', undefined, 'TAG_IN_USE');
      }
      throw error;
    }
    return this.resolve(uid);
  }

  async unlink(input: { kind: TagBindingKind; bindingId: string; clientDeviceId: string | null }): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const notFound = () => new ApiError(404, 'この紐づけは見つかりません。すでに外れています', undefined, 'BINDING_NOT_FOUND');
      switch (input.kind) {
        case 'employee': {
          const employee = await tx.employee.findUnique({ where: { id: input.bindingId } });
          if (!employee?.nfcTagUid) throw notFound();
          await tx.employee.update({ where: { id: employee.id }, data: { nfcTagUid: null } });
          await this.record(tx, { uid: employee.nfcTagUid, action: 'UNLINK', targetKind: 'employee', targetId: employee.id, targetLabel: employee.displayName, clientDeviceId: input.clientDeviceId });
          return;
        }
        case 'item': {
          const item = await tx.item.findUnique({ where: { id: input.bindingId } });
          if (!item?.nfcTagUid) throw notFound();
          await tx.item.update({ where: { id: item.id }, data: { nfcTagUid: null } });
          await this.record(tx, { uid: item.nfcTagUid, action: 'UNLINK', targetKind: 'item', targetId: item.id, targetLabel: item.name, clientDeviceId: input.clientDeviceId });
          return;
        }
        case 'instrument': {
          const tag = await tx.measuringInstrumentTag.findUnique({ where: { id: input.bindingId }, include: { measuringInstrument: true } });
          if (!tag) throw notFound();
          await tx.measuringInstrumentTag.delete({ where: { id: tag.id } });
          await this.record(tx, { uid: tag.rfidTagUid, action: 'UNLINK', targetKind: 'instrument', targetId: tag.measuringInstrumentId, targetLabel: tag.measuringInstrument.name, clientDeviceId: input.clientDeviceId });
          return;
        }
        case 'rigging': {
          const tag = await tx.riggingGearTag.findUnique({ where: { id: input.bindingId }, include: { riggingGear: true } });
          if (!tag) throw notFound();
          await tx.riggingGearTag.delete({ where: { id: tag.id } });
          await this.record(tx, { uid: tag.rfidTagUid, action: 'UNLINK', targetKind: 'rigging', targetId: tag.riggingGearId, targetLabel: tag.riggingGear.name, clientDeviceId: input.clientDeviceId });
          return;
        }
        case 'inventory': {
          const tag = await tx.inventoryNfcTag.findUnique({ where: { id: input.bindingId }, include: { compartment: { include: { inventoryItem: true } } } });
          if (!tag) throw notFound();
          await tx.inventoryNfcTag.delete({ where: { id: tag.id } });
          const label = tag.compartment?.inventoryItem.name ?? INVENTORY_TAG_LABELS[tag.kind];
          await this.record(tx, { uid: tag.uid, action: 'UNLINK', targetKind: 'inventory', targetId: tag.compartmentId, targetLabel: label, clientDeviceId: input.clientDeviceId });
          return;
        }
      }
    });
  }

  async listEvents(limit: number): Promise<TagBindingEventView[]> {
    const rows = await prisma.nfcTagBindingEvent.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map((r) => ({ id: r.id, uid: r.uid, action: r.action, targetKind: r.targetKind, targetLabel: r.targetLabel, createdAt: r.createdAt.toISOString() }));
  }

  async listOptions(): Promise<{
    divisions: string[];
    sections: Array<{ division: string; name: string }>;
    departments: string[];
    genres: Array<{ id: string; name: string }>;
    positions: Array<{ name: string; approval: PositionApproval }>;
  }> {
    const [employees, instrumentDepartments, riggingDepartments, genres, mappings] = await Promise.all([
      prisma.employee.findMany({ distinct: ['department', 'section', 'positionName'], select: { department: true, section: true, positionName: true } }),
      prisma.measuringInstrument.findMany({ where: { department: { not: null } }, distinct: ['department'], select: { department: true } }),
      prisma.riggingGear.findMany({ where: { department: { not: null } }, distinct: ['department'], select: { department: true } }),
      prisma.measuringInstrumentGenre.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.knowledgePositionRank.findMany({ select: { positionName: true, rank: true } })
    ]);
    const uniqueNames = (values: Array<string | null>) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b, 'ja'));
    const divisions = uniqueNames(employees.map((employee) => employee.department));
    const sections = [...new Map(employees.flatMap((employee) => {
      const division = employee.department?.trim();
      const name = employee.section?.trim();
      return division && name ? [[JSON.stringify([division, name]), { division, name }] as const] : [];
    })).values()].sort((a, b) => a.division.localeCompare(b.division, 'ja') || a.name.localeCompare(b.name, 'ja'));
    const departments = uniqueNames([
      ...employees.map((employee) => employee.section),
      ...instrumentDepartments.map((instrument) => instrument.department),
      ...riggingDepartments.map((rigging) => rigging.department)
    ]);
    const ranks = new Map(mappings.map((mapping) => [mapping.positionName, mapping.rank]));
    const positions = [...new Set([...mappings.map((mapping) => mapping.positionName), ...employees.map((employee) => employee.positionName)]
      .filter((name): name is string => Boolean(name)))]
      .sort((a, b) => a.localeCompare(b, 'ja'))
      .map((name) => ({ name, approval: positionApproval(name, ranks)! }));
    return { divisions, sections, departments, genres, positions };
  }

  /** Label of the first record this UID is bound to, or null when it is free. */
  private async findUsage(tx: Tx, uid: string): Promise<string | null> {
    const [employee, item, instrumentTag, riggingTag, inventoryTag] = await Promise.all([
      tx.employee.findUnique({ where: { nfcTagUid: uid }, select: { displayName: true } }),
      tx.item.findUnique({ where: { nfcTagUid: uid }, select: { name: true } }),
      tx.measuringInstrumentTag.findUnique({ where: { rfidTagUid: uid }, select: { measuringInstrument: { select: { name: true } } } }),
      tx.riggingGearTag.findUnique({ where: { rfidTagUid: uid }, select: { riggingGear: { select: { name: true } } } }),
      tx.inventoryNfcTag.findUnique({ where: { uid }, select: { kind: true } })
    ]);
    return employee?.displayName
      ?? item?.name
      ?? instrumentTag?.measuringInstrument.name
      ?? riggingTag?.riggingGear.name
      ?? (inventoryTag ? INVENTORY_TAG_LABELS[inventoryTag.kind] : null);
  }

  private async record(tx: Tx, event: { uid: string; action: 'LINK' | 'UNLINK'; targetKind: string; targetId: string | null; targetLabel: string; clientDeviceId: string | null }) {
    await tx.nfcTagBindingEvent.create({ data: event });
  }
}
