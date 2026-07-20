import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeAssemblyUpperIdentifier } from './assembly-identifiers.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
import { AssemblyTraceabilityAccessService } from './assembly-traceability-access.service.js';
import {
  AssemblyTraceabilityRepository,
  workUnitWithSessionSelect,
  type AssemblyTraceabilityTransaction
} from './assembly-traceability.repository.js';

export type AssemblyTraceabilityActor = {
  username: string | null;
  clientDeviceId: string | null;
  clientDeviceNameSnapshot: string | null;
};

type ProtectedInput = { accessPassword: string; actor: AssemblyTraceabilityActor };

export type AssemblyTraceabilityWorkUnitSummary = {
  id: string;
  workId: string;
  status: 'in_progress' | 'completed' | 'cancelled' | 'not_started';
  productNo: string | null;
  targetUnit: string | null;
  templateName: string | null;
  completedAt: Date | null;
};

function normalizeRequiredIdentifier(value: string, label: string): string {
  const normalized = normalizeAssemblyUpperIdentifier(value).slice(0, 120);
  if (!normalized) throw new ApiError(400, `${label}が必要です`);
  return normalized;
}

function requireReason(value: string | null | undefined): string {
  const reason = value?.trim().slice(0, 500) ?? '';
  if (!reason) throw new ApiError(400, '理由が必要です');
  return reason;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}

function sessionStatus(value: string | undefined): AssemblyTraceabilityWorkUnitSummary['status'] {
  if (value === 'IN_PROGRESS') return 'in_progress';
  if (value === 'COMPLETED') return 'completed';
  if (value === 'CANCELLED') return 'cancelled';
  return 'not_started';
}

function serializeWorkUnit(unit: {
  id: string;
  workId: string;
  workSession: {
    id: string;
    status: string;
    productNo: string;
    targetUnit: string;
    template: { name: string; version: number };
    completedAt: Date | null;
  } | null;
}): AssemblyTraceabilityWorkUnitSummary {
  return {
    id: unit.id,
    workId: unit.workId,
    status: sessionStatus(unit.workSession?.status),
    productNo: unit.workSession?.productNo ?? null,
    targetUnit: unit.workSession?.targetUnit ?? null,
    templateName: unit.workSession ? `${unit.workSession.template.name} v${unit.workSession.template.version}` : null,
    completedAt: unit.workSession?.completedAt ?? null
  };
}

function actorCreateData(actor: AssemblyTraceabilityActor) {
  return {
    linkedByUsernameSnapshot: actor.username,
    linkedByClientDeviceId: actor.clientDeviceId,
    linkedByClientDeviceNameSnapshot: actor.clientDeviceNameSnapshot
  };
}

function actorUnlinkData(actor: AssemblyTraceabilityActor, reason: string) {
  return {
    unlinkedAt: new Date(),
    unlinkedByUsernameSnapshot: actor.username,
    unlinkedByClientDeviceId: actor.clientDeviceId,
    unlinkedByClientDeviceNameSnapshot: actor.clientDeviceNameSnapshot,
    unlinkReason: reason
  };
}

export class AssemblyTraceabilityService {
  constructor(
    private readonly repository = new AssemblyTraceabilityRepository(),
    private readonly accessService = new AssemblyTraceabilityAccessService()
  ) {}

  async verifyAccessPassword(password: string): Promise<{ success: boolean }> {
    return this.accessService.verifyAccessPassword(password);
  }

  async listTopLevelCompleted(params: { query?: string; limit?: number } = {}) {
    const query = params.query ? normalizeAssemblyUpperIdentifier(params.query) : '';
    const rows = await this.repository.findTopLevelCompleted(prisma, {
      query,
      limit: Math.min(Math.max(Math.trunc(params.limit ?? 50), 1), 100)
    });
    return rows.map((row) => ({
      ...serializeWorkUnit(row),
      formalIdentifier: row.formalIdentifierAssignments[0]
        ? {
            id: row.formalIdentifierAssignments[0].id,
            formalId: row.formalIdentifierAssignments[0].formalId,
            assignedAt: row.formalIdentifierAssignments[0].assignedAt
          }
        : null
    }));
  }

  async resolve(workIdInput: string) {
    const workId = normalizeRequiredIdentifier(workIdInput, '作業用ID');
    const unit = await prisma.assemblyWorkUnit.findUnique({
      where: { workId },
      select: {
        ...workUnitWithSessionSelect,
        parentCompositionLinks: {
          where: { unlinkedAt: null },
          select: { id: true, childWorkUnit: { select: workUnitWithSessionSelect } },
          orderBy: { linkedAt: 'asc' }
        },
        childCompositionLinks: {
          where: { unlinkedAt: null },
          select: { id: true, parentWorkUnit: { select: workUnitWithSessionSelect } }
        },
        formalIdentifierAssignments: {
          orderBy: { assignedAt: 'desc' },
          select: {
            id: true,
            formalId: true,
            assignedAt: true,
            assignedByUsernameSnapshot: true,
            supersededAt: true,
            supersedeReason: true,
            supersededByUsernameSnapshot: true
          }
        }
      }
    });
    if (!unit) throw new ApiError(404, '作業用IDが見つかりません');

    const root = await this.resolveRoot(unit.id);
    const genealogy = await this.buildTree(root.id);
    const genealogyWorkUnitIds = await this.listActiveDescendantIds(root.id);
    const compositionHistory = await prisma.assemblyWorkUnitComposition.findMany({
      where: {
        OR: [
          { parentWorkUnitId: { in: genealogyWorkUnitIds } },
          { childWorkUnitId: { in: genealogyWorkUnitIds } }
        ]
      },
      include: {
        parentWorkUnit: { select: { workId: true } },
        childWorkUnit: { select: { workId: true } }
      },
      orderBy: { linkedAt: 'asc' }
    });
    return {
      workUnit: serializeWorkUnit(unit),
      activeParent: unit.childCompositionLinks[0]
        ? { linkId: unit.childCompositionLinks[0].id, workUnit: serializeWorkUnit(unit.childCompositionLinks[0].parentWorkUnit) }
        : null,
      activeChildren: unit.parentCompositionLinks.map((link) => ({
        linkId: link.id,
        workUnit: serializeWorkUnit(link.childWorkUnit)
      })),
      root: {
        workUnit: serializeWorkUnit(root),
        formalIdentifier: root.formalIdentifierAssignments[0]
          ? { id: root.formalIdentifierAssignments[0].id, formalId: root.formalIdentifierAssignments[0].formalId }
          : null
      },
      formalIdentifierHistory: root.formalIdentifierAssignments.map((assignment) => ({
        id: assignment.id,
        formalId: assignment.formalId,
        assignedAt: assignment.assignedAt,
        assignedByUsernameSnapshot: assignment.assignedByUsernameSnapshot,
        supersededAt: assignment.supersededAt,
        supersededByUsernameSnapshot: assignment.supersededByUsernameSnapshot,
        supersedeReason: assignment.supersedeReason
      })),
      compositionHistory: compositionHistory.map((link) => ({
        id: link.id,
        parentWorkId: link.parentWorkUnit.workId,
        childWorkId: link.childWorkUnit.workId,
        linkedAt: link.linkedAt,
        linkedByUsernameSnapshot: link.linkedByUsernameSnapshot,
        unlinkedAt: link.unlinkedAt,
        unlinkedByUsernameSnapshot: link.unlinkedByUsernameSnapshot,
        unlinkReason: link.unlinkReason
      })),
      genealogy
    };
  }

  async link(input: ProtectedInput & { parentWorkId: string; childWorkId: string }) {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const parentWorkId = normalizeRequiredIdentifier(input.parentWorkId, '親の作業用ID');
    const childWorkId = normalizeRequiredIdentifier(input.childWorkId, '子の作業用ID');
    if (parentWorkId === childWorkId) throw new ApiError(409, '同じ作業用IDを親子にはできません');
    try {
      return await runAssemblyTransaction(async (tx) => {
        const units = await tx.assemblyWorkUnit.findMany({
          where: { workId: { in: [parentWorkId, childWorkId] } },
          select: { ...workUnitWithSessionSelect, formalIdentifierAssignments: { where: { supersededAt: null }, select: { id: true } } }
        });
        const parent = units.find((unit) => unit.workId === parentWorkId);
        const child = units.find((unit) => unit.workId === childWorkId);
        if (!parent || !child) throw new ApiError(404, '親または子の作業用IDが見つかりません');
        await this.repository.lockWorkUnits(tx, [parent.id, child.id]);
        await this.repository.lockActiveCompositionForWorkUnit(tx, child.id);
        await this.assertCanBeParent(tx, parent);
        await this.assertCanBeChild(tx, child);
        if (child.formalIdentifierAssignments.length > 0) {
          throw new ApiError(409, '正式ID付与済みの完成品を子にすることはできません');
        }
        const currentParent = await tx.assemblyWorkUnitComposition.findFirst({
          where: { childWorkUnitId: child.id, unlinkedAt: null },
          select: { id: true }
        });
        if (currentParent) throw new ApiError(409, 'この子の作業用IDは既に別の親へ紐付いています');
        if (await this.repository.hasActiveDescendant(tx, child.id, parent.id)) {
          throw new ApiError(409, '循環する製品構成は登録できません');
        }
        const link = await tx.assemblyWorkUnitComposition.create({
          data: { parentWorkUnitId: parent.id, childWorkUnitId: child.id, ...actorCreateData(input.actor) }
        });
        return { id: link.id };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ApiError(409, 'この子の作業用IDは既に別の親へ紐付いています');
      throw error;
    }
  }

  async unlink(input: ProtectedInput & { linkId: string; reason: string }) {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const reason = requireReason(input.reason);
    return runAssemblyTransaction(async (tx) => {
      const link = await tx.assemblyWorkUnitComposition.findUnique({
        where: { id: input.linkId },
        select: { id: true, parentWorkUnitId: true, childWorkUnitId: true, unlinkedAt: true }
      });
      if (!link) throw new ApiError(404, '製品構成が見つかりません');
      await this.repository.lockWorkUnits(tx, [link.parentWorkUnitId, link.childWorkUnitId]);
      if (link.unlinkedAt) throw new ApiError(409, 'この製品構成は既に解除されています');
      await tx.assemblyWorkUnitComposition.update({ where: { id: link.id }, data: actorUnlinkData(input.actor, reason) });
      return { id: link.id };
    });
  }

  async reassign(input: ProtectedInput & { linkId: string; parentWorkId: string; reason: string }) {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const reason = requireReason(input.reason);
    const parentWorkId = normalizeRequiredIdentifier(input.parentWorkId, '新しい親の作業用ID');
    try {
      return await runAssemblyTransaction(async (tx) => {
        const link = await tx.assemblyWorkUnitComposition.findUnique({
          where: { id: input.linkId },
          select: { id: true, parentWorkUnitId: true, childWorkUnitId: true, unlinkedAt: true }
        });
        if (!link) throw new ApiError(404, '製品構成が見つかりません');
        if (link.unlinkedAt) throw new ApiError(409, 'この製品構成は既に解除されています');
        const newParent = await tx.assemblyWorkUnit.findUnique({
          where: { workId: parentWorkId },
          select: { ...workUnitWithSessionSelect, formalIdentifierAssignments: { where: { supersededAt: null }, select: { id: true } } }
        });
        const child = await tx.assemblyWorkUnit.findUnique({
          where: { id: link.childWorkUnitId },
          select: { ...workUnitWithSessionSelect, formalIdentifierAssignments: { where: { supersededAt: null }, select: { id: true } } }
        });
        if (!newParent || !child) throw new ApiError(404, '親または子の作業用IDが見つかりません');
        if (newParent.id === child.id) throw new ApiError(409, '同じ作業用IDを親子にはできません');
        if (newParent.id === link.parentWorkUnitId) throw new ApiError(400, '同じ親への変更はできません');
        await this.repository.lockWorkUnits(tx, [link.parentWorkUnitId, newParent.id, child.id]);
        await this.assertCanBeParent(tx, newParent);
        await this.assertCanBeChild(tx, child);
        if (child.formalIdentifierAssignments?.length) throw new ApiError(409, '正式ID付与済みの完成品を子にすることはできません');
        if (await this.repository.hasActiveDescendant(tx, child.id, newParent.id)) {
          throw new ApiError(409, '循環する製品構成は登録できません');
        }
        await tx.assemblyWorkUnitComposition.update({ where: { id: link.id }, data: actorUnlinkData(input.actor, reason) });
        const replacement = await tx.assemblyWorkUnitComposition.create({
          data: { parentWorkUnitId: newParent.id, childWorkUnitId: child.id, ...actorCreateData(input.actor) }
        });
        return { id: replacement.id, replacedLinkId: link.id };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ApiError(409, 'この子の作業用IDは既に別の親へ紐付いています');
      throw error;
    }
  }

  async assignFormalIdentifier(input: ProtectedInput & { workId: string; formalId: string }) {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const workId = normalizeRequiredIdentifier(input.workId, '作業用ID');
    const formalId = normalizeRequiredIdentifier(input.formalId, '正式ID');
    try {
      return await runAssemblyTransaction(async (tx) => {
        const unit = await tx.assemblyWorkUnit.findUnique({ where: { workId }, select: workUnitWithSessionSelect });
        if (!unit) throw new ApiError(404, '作業用IDが見つかりません');
        await this.repository.lockWorkUnits(tx, [unit.id]);
        await this.repository.lockActiveCompositionForWorkUnit(tx, unit.id);
        await this.assertCanReceiveFormalIdentifier(tx, unit.id, unit.workSession?.status);
        const assignment = await tx.assemblyFormalIdentifierAssignment.create({
          data: {
            workUnitId: unit.id,
            formalId,
            assignedByUsernameSnapshot: input.actor.username,
            assignedByClientDeviceId: input.actor.clientDeviceId,
            assignedByClientDeviceNameSnapshot: input.actor.clientDeviceNameSnapshot
          }
        });
        return { id: assignment.id, formalId: assignment.formalId };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ApiError(409, 'この正式IDまたは作業用IDは既に登録されています');
      throw error;
    }
  }

  async correctFormalIdentifier(input: ProtectedInput & { assignmentId: string; formalId: string; reason: string }) {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const formalId = normalizeRequiredIdentifier(input.formalId, '正式ID');
    const reason = requireReason(input.reason);
    try {
      return await runAssemblyTransaction(async (tx) => {
        const previous = await tx.assemblyFormalIdentifierAssignment.findUnique({
          where: { id: input.assignmentId },
          select: { id: true, workUnitId: true, supersededAt: true }
        });
        if (!previous) throw new ApiError(404, '正式IDの履歴が見つかりません');
        if (previous.supersededAt) throw new ApiError(409, 'この正式IDは既に訂正済みです');
        await this.repository.lockWorkUnits(tx, [previous.workUnitId]);
        await this.repository.lockActiveCompositionForWorkUnit(tx, previous.workUnitId);
        const unit = await tx.assemblyWorkUnit.findUnique({ where: { id: previous.workUnitId }, select: workUnitWithSessionSelect });
        if (!unit) throw new ApiError(404, '作業用IDが見つかりません');
        await this.assertCanReceiveFormalIdentifier(tx, unit.id, unit.workSession?.status);
        await tx.assemblyFormalIdentifierAssignment.update({
          where: { id: previous.id },
          data: {
            supersededAt: new Date(),
            supersededByUsernameSnapshot: input.actor.username,
            supersededByClientDeviceId: input.actor.clientDeviceId,
            supersededByClientDeviceNameSnapshot: input.actor.clientDeviceNameSnapshot,
            supersedeReason: reason
          }
        });
        const assignment = await tx.assemblyFormalIdentifierAssignment.create({
          data: {
            workUnitId: unit.id,
            formalId,
            assignedByUsernameSnapshot: input.actor.username,
            assignedByClientDeviceId: input.actor.clientDeviceId,
            assignedByClientDeviceNameSnapshot: input.actor.clientDeviceNameSnapshot
          }
        });
        return { id: assignment.id, formalId: assignment.formalId, correctedAssignmentId: previous.id };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ApiError(409, 'この正式IDは現在または過去に使用されています');
      throw error;
    }
  }

  async exportTraceabilityForSession(sessionId: string) {
    const unit = await prisma.assemblyWorkUnit.findFirst({ where: { workSession: { id: sessionId } }, select: { workId: true } });
    if (!unit) return null;
    const selected = await this.resolve(unit.workId);
    return this.resolve(selected.root.workUnit.workId);
  }

  private async assertCanBeParent(_tx: AssemblyTraceabilityTransaction, parent: { workSession: { status: string } | null }) {
    if (!parent.workSession || parent.workSession.status === 'CANCELLED') {
      throw new ApiError(409, '親の作業用IDは進行中または完了済みである必要があります');
    }
  }

  private async assertCanBeChild(_tx: AssemblyTraceabilityTransaction, child: { workSession: { status: string } | null }) {
    if (!child.workSession || child.workSession.status !== 'COMPLETED') {
      throw new ApiError(409, '子の作業用IDは完了済みである必要があります');
    }
  }

  private async assertCanReceiveFormalIdentifier(
    tx: AssemblyTraceabilityTransaction,
    workUnitId: string,
    status: string | undefined
  ) {
    if (status !== 'COMPLETED') throw new ApiError(409, '正式IDは完了済みの作業用IDにのみ付与できます');
    const activeParent = await tx.assemblyWorkUnitComposition.findFirst({
      where: { childWorkUnitId: workUnitId, unlinkedAt: null },
      select: { id: true }
    });
    if (activeParent) throw new ApiError(409, '正式IDは最上位の完成品にのみ付与できます');
  }

  private async resolveRoot(workUnitId: string) {
    let currentId = workUnitId;
    for (let depth = 0; depth < 100; depth += 1) {
      const incoming = await prisma.assemblyWorkUnitComposition.findFirst({
        where: { childWorkUnitId: currentId, unlinkedAt: null },
        select: { parentWorkUnitId: true }
      });
      if (!incoming) break;
      currentId = incoming.parentWorkUnitId;
    }
    const root = await prisma.assemblyWorkUnit.findUnique({
      where: { id: currentId },
      select: {
        ...workUnitWithSessionSelect,
        formalIdentifierAssignments: {
          orderBy: { assignedAt: 'desc' },
          select: {
            id: true,
            formalId: true,
            assignedAt: true,
            assignedByUsernameSnapshot: true,
            supersededAt: true,
            supersededByUsernameSnapshot: true,
            supersedeReason: true
          }
        }
      }
    });
    if (!root) throw new ApiError(404, '作業用IDが見つかりません');
    return root;
  }

  private async buildTree(rootId: string): Promise<Array<{ workUnit: AssemblyTraceabilityWorkUnitSummary; children: unknown[] }>> {
    const ids = await this.listActiveDescendantIds(rootId);
    const units = await prisma.assemblyWorkUnit.findMany({
      where: { id: { in: ids } },
      select: {
        ...workUnitWithSessionSelect,
        parentCompositionLinks: {
          where: { unlinkedAt: null },
          select: { childWorkUnitId: true },
          orderBy: { linkedAt: 'asc' }
        }
      }
    });
    const unitsById = new Map(units.map((unit) => [unit.id, unit]));
    const toTree = (id: string, depth: number): { workUnit: AssemblyTraceabilityWorkUnitSummary; children: unknown[] } | null => {
      const unit = unitsById.get(id);
      if (!unit) return null;
      const children = depth >= 100
        ? []
        : unit.parentCompositionLinks
            .map((link) => toTree(link.childWorkUnitId, depth + 1))
            .filter((child): child is NonNullable<typeof child> => child != null);
      return { workUnit: serializeWorkUnit(unit), children };
    };
    const root = toTree(rootId, 0);
    return root ? [root] : [];
  }

  private async listActiveDescendantIds(rootId: string): Promise<string[]> {
    const descendants = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH RECURSIVE descendants AS (
        SELECT ${rootId}::text AS "id"
        UNION
        SELECT composition."childWorkUnitId" AS "id"
        FROM "AssemblyWorkUnitComposition" AS composition
        INNER JOIN descendants ON composition."parentWorkUnitId" = descendants."id"
        WHERE composition."unlinkedAt" IS NULL
      )
      SELECT DISTINCT "id" FROM descendants
    `);
    return descendants.map((row) => row.id);
  }
}
