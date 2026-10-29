import type { Prisma } from '@prisma/client';
import type { AssemblyCheckSheetActor, AssemblyCheckSheetPayload, AssemblyCheckSheetStampInput } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { KNOWLEDGE_POSITION_RANKS, positionRank } from '../../knowledge/knowledge-position-rank.js';
import { resolveActiveAssemblyOperatorNfcUid } from '../assembly-operator-nfc-resolve.service.js';
import { runAssemblyTransaction } from '../assembly-transaction.js';
import { getFileStorageRuntime } from '../../file-storage/file-storage-runtime.js';
import { buildCheckSheetLayout } from './check-sheet-layout.js';
import { buildCheckSheetWrites } from './check-sheet-paper-writes.js';
import { fillCheckSheetXlsx } from './check-sheet-xlsx-filler.js';
import { revisionInclude, serializeRevision } from './check-sheet.service.js';

const sheetInclude = { revision: { include: revisionInclude }, stamps: true, workUnit: true };
type Sheet = Prisma.AssemblyCheckSheetGetPayload<{ include: typeof sheetInclude }>;
type Item = Sheet['revision']['items'][number];
type Device = { clientDeviceId: string | null };
type StampInput = AssemblyCheckSheetStampInput & Device;
type StoredStampInput = Omit<StampInput, 'result'> & { result: 'OK' | 'NG' | 'NA' };
const roleLabels: Record<string, string> = {
  general: '一般', leader: '班長', section_chief: '係長', manager: '課長', general_manager: '部長', executive: '役員'
};
function serialize(sheet: Sheet): AssemblyCheckSheetPayload {
  return {
    id: sheet.id, workUnitId: sheet.workUnitId, revisionId: sheet.revisionId, status: sheet.status,
    headerValues: sheet.headerValues as Record<string, string>, pausedReason: sheet.pausedReason,
    startedAt: sheet.startedAt.toISOString(), completedAt: sheet.completedAt?.toISOString() ?? null,
    revision: serializeRevision(sheet.revision),
    stamps: sheet.stamps.map((stamp) => ({
      id: stamp.id, itemId: stamp.itemId, result: stamp.result, values: stamp.values as Record<string, string | number>,
      flagged: stamp.flagged, ngReason: stamp.ngReason, employeeId: stamp.employeeId,
      employeeCodeSnapshot: stamp.employeeCodeSnapshot, employeeNameSnapshot: stamp.employeeNameSnapshot,
      positionNameSnapshot: stamp.positionNameSnapshot, stampedAt: stamp.stampedAt.toISOString()
    }))
  };
}
async function readSheet(tx: Prisma.TransactionClient, id: string) {
  const sheet = await tx.assemblyCheckSheet.findUnique({ where: { id }, include: sheetInclude });
  if (!sheet) throw new ApiError(404, 'チェックシートが見つかりません');
  return sheet;
}
async function resolveActor(tx: Prisma.TransactionClient, actor: AssemblyCheckSheetActor) {
  const employee = await resolveActiveAssemblyOperatorNfcUid(tx, actor.nfcTagUid);
  const detail = await tx.employee.findUniqueOrThrow({ where: { id: employee.employeeId }, select: { positionName: true } });
  const mapping = detail.positionName
    ? await tx.knowledgePositionRank.findUnique({ where: { positionName: detail.positionName } }) : null;
  return { ...employee, positionName: detail.positionName, rank: positionRank(mapping?.rank) };
}
type Actor = Awaited<ReturnType<typeof resolveActor>>;
function assertRole(item: Item, sheet: Sheet, actor: Actor) {
  const members = sheet.revision.departmentRoleMembers as Record<string, string[]>;
  const missing = item.roleKeys.filter((role) => {
    const rank = KNOWLEDGE_POSITION_RANKS.find((key) => key === role);
    return rank
      ? !actor.positionName || KNOWLEDGE_POSITION_RANKS.indexOf(actor.rank) < KNOWLEDGE_POSITION_RANKS.indexOf(rank)
      : !members[role]?.includes(actor.employeeId);
  }).map((role) => roleLabels[role] ?? role);
  if (missing.length) throw new ApiError(403, `${missing.join('・')}のタグが必要です`, { requiredRoles: missing }, 'CHECK_SHEET_ROLE_REQUIRED');
}
function assertValues(item: Item, input: AssemblyCheckSheetStampInput) {
  const spec = item.inputSpec as { fields?: { key: string }[]; options?: string[] };
  const keys = new Set((spec.fields ?? []).map((field) => field.key));
  if (item.inputKind === 'CHOICE') keys.add('result');
  const entries = Object.entries(input.values);
  const invalid = entries.some(([key, value]) => !keys.has(key) ||
    (item.inputKind === 'NUMBER' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'string' || !value.trim()));
  // NG can record an inspection that could not be measured; supplied values must still be valid.
  if (invalid || (input.result === 'OK' && [...keys].some((key) => !Object.hasOwn(input.values, key))) ||
    (item.inputKind === 'CHOICE' && Object.hasOwn(input.values, 'result') && !spec.options?.includes(String(input.values.result))) ||
    (item.inputKind === 'CHOICE' && input.values.result === 'NG' && input.result !== 'NG')) {
    throw new ApiError(400, '記入値を確認してください', undefined, 'CHECK_SHEET_VALUES_INVALID');
  }
  if (input.flagged && (input.result !== 'NG' || !input.ngReason?.trim())) throw new ApiError(400, '問題点を書いてください');
}
async function putStamp(tx: Prisma.TransactionClient, sheet: Sheet, item: Item, input: StoredStampInput, actor: Actor) {
  const previous = sheet.stamps.find((stamp) => stamp.itemId === item.id);
  if (previous) {
    const { id, ...data } = previous;
    await tx.assemblyCheckSheetStampHistory.create({ data: { ...data, values: data.values as Prisma.InputJsonValue, stampId: id } });
  }
  const data = {
    result: input.result, values: input.values, flagged: input.flagged,
    ngReason: input.result === 'NG' ? input.ngReason ?? null : null,
    employeeId: actor.employeeId, employeeCodeSnapshot: actor.employeeCode, employeeNameSnapshot: actor.displayName,
    nfcTagUidSnapshot: actor.nfcTagUid, positionNameSnapshot: actor.positionName,
    clientDeviceId: input.clientDeviceId ?? null, stampedAt: new Date()
  };
  await tx.assemblyCheckSheetStamp.upsert({
    where: { sheetId_itemId: { sheetId: sheet.id, itemId: item.id } }, update: data,
    create: { ...data, sheetId: sheet.id, itemId: item.id }
  });
}
function transitionHistory(sheet: Sheet, action: 'pause' | 'resume', actor: Actor, clientDeviceId: string | null): Prisma.InputJsonValue {
  return [...(Array.isArray(sheet.transitionHistory) ? sheet.transitionHistory : []), {
    action, employeeId: actor.employeeId, employeeCodeSnapshot: actor.employeeCode,
    employeeNameSnapshot: actor.displayName, nfcTagUidSnapshot: actor.nfcTagUid,
    positionNameSnapshot: actor.positionName, clientDeviceId, occurredAt: new Date().toISOString()
  }];
}
export class AssemblyCheckSheetKioskService {
  async create(input: { workUnitId: string; revisionRootId?: string } & Device) {
    return runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AssemblySerialRegistry" WHERE "id" = ${input.workUnitId} FOR UPDATE`;
      const unit = await tx.assemblyWorkUnit.findUnique({ where: { id: input.workUnitId }, include: { lotSerial: { include: { lot: { include: { template: true } } } }, workSession: { include: { template: true } } } });
      if (!unit) throw new ApiError(404, '台が見つかりません');
      const existing = await tx.assemblyCheckSheet.findUnique({ where: { workUnitId: unit.id }, include: sheetInclude });
      if (existing) return serialize(existing);
      if (unit.invalidatedAt) throw new ApiError(409, '削除済みの作業用IDは変更できません');
      const source = unit.lotSerial?.lot ?? unit.workSession;
      const heads = await tx.assemblyCheckSheetRevision.findMany({
        where: { isRevisionHead: true, ...(input.revisionRootId ? { revisionRootId: input.revisionRootId } : {}) }
      });
      const matching = heads.filter((head) => head.modelCode === source?.template.modelCode);
      const revision = input.revisionRootId ? heads[0] : matching.length === 1 ? matching[0] : null;
      if (!revision) throw new ApiError(409, 'チェックシートの機種を選んでください', undefined, 'CHECK_SHEET_REVISION_REQUIRED');
      const sheet = await tx.assemblyCheckSheet.create({
        data: { workUnitId: unit.id, revisionId: revision.id, clientDeviceId: input.clientDeviceId, headerValues: {
          productNo: unit.workId, seiban: source?.productNo ?? '', productName: source?.targetUnit ?? revision.modelCode,
          modelCode: revision.modelCode, shipDate: '', customer: ''
        } }, include: sheetInclude
      });
      return serialize(sheet);
    });
  }
  async get(id: string) { return serialize(await readSheet(prisma, id)); }
  private async paper(id: string, needsSource: boolean) {
    const sheet = await this.get(id);
    let source: Buffer | undefined;
    if (needsSource || !sheet.revision.layoutSnapshot) {
      const asset = await prisma.assemblyCheckSheetAsset.findUnique({ where: { id: sheet.revision.sourceAssetId } });
      if (!asset) throw new ApiError(404, '取込元が見つかりません');
      source = await getFileStorageRuntime().store.read(asset.storageKey, { verifyIntegrity: true });
    }
    if (!sheet.revision.layoutSnapshot) {
      const layoutSnapshot = await buildCheckSheetLayout(source!, sheet.revision.sourceSheetName);
      await prisma.assemblyCheckSheetRevision.update({ where: { id: sheet.revisionId }, data: { layoutSnapshot } });
      sheet.revision.layoutSnapshot = layoutSnapshot;
    }
    return { sheet, source, layoutSnapshot: sheet.revision.layoutSnapshot, writes: buildCheckSheetWrites(sheet) };
  }
  async paperLayout(id: string) {
    const { sheet, layoutSnapshot, writes } = await this.paper(id, false);
    return { layoutSnapshot, writes, stampCells: sheet.revision.items.map((item) => item.stampCell) };
  }
  async paperXlsx(id: string) {
    const { sheet, source, writes } = await this.paper(id, true);
    return {
      buffer: await fillCheckSheetXlsx(source!, sheet.revision.sourceSheetName, writes),
      filename: `${sheet.revision.documentNo}_${sheet.headerValues.seiban ?? ''}.xlsx`
    };
  }
  private async mutate(id: string, work: (tx: Prisma.TransactionClient, sheet: Sheet) => Promise<void>, allowPaused = false) {
    return runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AssemblyCheckSheet" WHERE "id" = ${id} FOR UPDATE`;
      const sheet = await readSheet(tx, id);
      if (sheet.workUnit.invalidatedAt) throw new ApiError(409, '削除済みの作業用IDは変更できません');
      if (sheet.status === 'COMPLETED') throw new ApiError(409, '完了済みです');
      if (sheet.status === 'PAUSED' && !allowPaused) throw new ApiError(409, '再開してください', undefined, 'CHECK_SHEET_PAUSED');
      await work(tx, sheet);
      return serialize(await readSheet(tx, id));
    });
  }
  async changeRevision(id: string, input: { revisionRootId: string } & Device) {
    return this.mutate(id, async (tx, sheet) => {
      if (sheet.stamps.length || await tx.assemblyCheckSheetStampHistory.findFirst({ where: { sheetId: id } })) {
        throw new ApiError(409, '押印済みのため機種を変えられません', undefined, 'CHECK_SHEET_ALREADY_STAMPED');
      }
      const revision = await tx.assemblyCheckSheetRevision.findFirst({
        where: { revisionRootId: input.revisionRootId, isRevisionHead: true }
      });
      if (!revision) throw new ApiError(404, 'チェックシートが見つかりません');
      if (revision.id === sheet.revisionId) return;
      const headerValues = sheet.headerValues as Record<string, string>;
      await tx.assemblyCheckSheet.update({ where: { id }, data: {
        revisionId: revision.id, headerValues: { ...headerValues, modelCode: revision.modelCode,
          ...(headerValues.productName === sheet.revision.modelCode ? { productName: revision.modelCode } : {}) }
      } });
    });
  }
  async stamp(id: string, input: StampInput) {
    if (input.result !== 'OK' && input.result !== 'NG') throw new ApiError(400, 'NAは条件の該当なしから指定してください');
    return this.mutate(id, async (tx, sheet) => {
      const item = sheet.revision.items.find((candidate) => candidate.id === input.itemId);
      if (!item) throw new ApiError(400, 'この版の項目ではありません');
      const actor = await resolveActor(tx, input);
      assertRole(item, sheet, actor);
      assertValues(item, input);
      // Inspecting one item of a condition means it applies; the siblings' NA no longer holds.
      for (const stale of sheet.stamps.filter((stamp) => stamp.result === 'NA' && stamp.itemId !== item.id &&
        sheet.revision.items.some((candidate) => candidate.id === stamp.itemId && item.conditionKey && candidate.conditionKey === item.conditionKey))) {
        const { id: staleId, ...data } = stale;
        await tx.assemblyCheckSheetStampHistory.create({ data: { ...data, values: data.values as Prisma.InputJsonValue, stampId: staleId } });
        await tx.assemblyCheckSheetStamp.delete({ where: { id: staleId } });
      }
      await putStamp(tx, sheet, item, input, actor);
      if (input.result === 'NG' && !input.flagged) await tx.assemblyCheckSheet.update({
        where: { id }, data: { status: 'PAUSED', pausedReason: `${item.itemKey}\u3000${input.ngReason || 'NG'}`,
          transitionHistory: transitionHistory(sheet, 'pause', actor, input.clientDeviceId) }
      });
    });
  }
  async condition(id: string, input: AssemblyCheckSheetActor & Device & { conditionKey: string; applies: false }) {
    return this.mutate(id, async (tx, sheet) => {
      const items = sheet.revision.items.filter((item) => item.conditionKey === input.conditionKey);
      if (!items.length) throw new ApiError(400, '条件が見つかりません');
      const actor = await resolveActor(tx, input);
      // Check the entire condition before writing any stamp.
      items.forEach((item) => assertRole(item, sheet, actor));
      for (const item of items) await putStamp(tx, sheet, item, { ...input, itemId: item.id, values: {}, result: 'NA', flagged: false }, actor);
    });
  }
  async transition(id: string, action: 'pause' | 'resume' | 'complete', input: AssemblyCheckSheetActor & Device) {
    return this.mutate(id, async (tx, sheet) => {
      if (action === 'complete' && (!sheet.revision.items.length || sheet.revision.items.some((item) =>
        !sheet.stamps.some((stamp) => stamp.itemId === item.id && ['OK', 'NA'].includes(stamp.result) && !stamp.flagged)))) {
        throw new ApiError(409, '未確認または目印が残っています', undefined, 'CHECK_SHEET_INCOMPLETE');
      }
      const actor = await resolveActor(tx, input);
      await tx.assemblyCheckSheet.update({ where: { id }, data: {
        status: action === 'pause' ? 'PAUSED' : action === 'resume' ? 'IN_PROGRESS' : 'COMPLETED',
        pausedReason: action === 'pause' ? sheet.pausedReason : null, ...(action === 'complete' ? {
          completedAt: new Date(), completedByEmployeeId: actor.employeeId,
          completedByEmployeeCodeSnapshot: actor.employeeCode, completedByEmployeeNameSnapshot: actor.displayName,
          completedByNfcTagUidSnapshot: actor.nfcTagUid, completedByPositionNameSnapshot: actor.positionName,
          clientDeviceId: input.clientDeviceId
        } : { transitionHistory: transitionHistory(sheet, action, actor, input.clientDeviceId) })
      } });
    }, action !== 'complete');
  }
}
