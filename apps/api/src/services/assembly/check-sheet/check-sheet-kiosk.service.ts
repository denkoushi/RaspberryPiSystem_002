import type { Prisma } from '@prisma/client';
import type { AssemblyCheckSheetActor, AssemblyCheckSheetPayload, AssemblyCheckSheetStampInput } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { KNOWLEDGE_POSITION_RANKS, positionRank } from '../../knowledge/knowledge-position-rank.js';
import { resolveActiveAssemblyOperatorNfcUid } from '../assembly-operator-nfc-resolve.service.js';
import { runAssemblyTransaction } from '../assembly-transaction.js';
import { revisionInclude, serializeRevision } from './check-sheet.service.js';

const sheetInclude = { revision: { include: revisionInclude }, stamps: true, workUnit: true };
type Sheet = Prisma.AssemblyCheckSheetGetPayload<{ include: typeof sheetInclude }>;
type Item = Sheet['revision']['items'][number];
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
  if (invalid || (input.result === 'OK' && [...keys].some((key) => !(key in input.values))) ||
    (item.inputKind === 'CHOICE' && 'result' in input.values && !spec.options?.includes(String(input.values.result))) ||
    (input.result === 'NA' && entries.length)) {
    throw new ApiError(400, '記入値を確認してください', undefined, 'CHECK_SHEET_VALUES_INVALID');
  }
  if (input.flagged && (input.result !== 'NG' || !input.ngReason?.trim())) throw new ApiError(400, '問題点を書いてください');
}
async function putStamp(tx: Prisma.TransactionClient, sheet: Sheet, item: Item, input: AssemblyCheckSheetStampInput, actor: Actor) {
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
export class AssemblyCheckSheetKioskService {
  async create(input: { workUnitId: string; revisionRootId?: string }) {
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
      const revision = input.revisionRootId ? heads[0] : matching.length === 1 ? matching[0] : heads.length === 1 ? heads[0] : null;
      if (!revision) throw new ApiError(409, 'チェックシートの機種を選んでください', undefined, 'CHECK_SHEET_REVISION_REQUIRED');
      const sheet = await tx.assemblyCheckSheet.create({
        data: { workUnitId: unit.id, revisionId: revision.id, headerValues: {
          productNo: unit.workId, seiban: source?.productNo ?? '', productName: source?.targetUnit ?? revision.modelCode,
          modelCode: revision.modelCode, shipDate: '', customer: ''
        } }, include: sheetInclude
      });
      return serialize(sheet);
    });
  }
  async get(id: string) { return serialize(await readSheet(prisma, id)); }
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
  async stamp(id: string, input: AssemblyCheckSheetStampInput) {
    return this.mutate(id, async (tx, sheet) => {
      const item = sheet.revision.items.find((candidate) => candidate.id === input.itemId);
      if (!item) throw new ApiError(400, 'この版の項目ではありません');
      const actor = await resolveActor(tx, input);
      assertRole(item, sheet, actor);
      assertValues(item, input);
      await putStamp(tx, sheet, item, input, actor);
      if (input.result === 'NG' && !input.flagged) await tx.assemblyCheckSheet.update({
        where: { id }, data: { status: 'PAUSED', pausedReason: `${item.itemKey}\u3000${input.ngReason || 'NG'}` }
      });
    });
  }
  async condition(id: string, input: AssemblyCheckSheetActor & { conditionKey: string; applies: false }) {
    return this.mutate(id, async (tx, sheet) => {
      const items = sheet.revision.items.filter((item) => item.conditionKey === input.conditionKey);
      if (!items.length) throw new ApiError(400, '条件が見つかりません');
      const actor = await resolveActor(tx, input);
      // Check the entire condition before writing any stamp.
      items.forEach((item) => assertRole(item, sheet, actor));
      for (const item of items) await putStamp(tx, sheet, item, { ...input, itemId: item.id, values: {}, result: 'NA', flagged: false }, actor);
    });
  }
  async transition(id: string, action: 'pause' | 'resume' | 'complete') {
    return this.mutate(id, async (tx, sheet) => {
      if (action === 'complete' && (!sheet.revision.items.length || sheet.revision.items.some((item) =>
        !sheet.stamps.some((stamp) => stamp.itemId === item.id && ['OK', 'NA'].includes(stamp.result) && !stamp.flagged)))) {
        throw new ApiError(409, '未確認または目印が残っています', undefined, 'CHECK_SHEET_INCOMPLETE');
      }
      await tx.assemblyCheckSheet.update({ where: { id }, data: {
        status: action === 'pause' ? 'PAUSED' : action === 'resume' ? 'IN_PROGRESS' : 'COMPLETED',
        pausedReason: action === 'pause' ? sheet.pausedReason : null, ...(action === 'complete' ? { completedAt: new Date() } : {})
      } });
    }, action !== 'complete');
  }
}
