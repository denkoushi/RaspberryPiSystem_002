import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../lib/prisma.js';
import { PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION } from './part-measurement-drawing-dimension-map-payload.js';
import { getPartMeasurementDrawingOcrService } from './part-measurement-drawing-ocr.service.js';

export const BASELINE_PLACEMENT_VERSION = 'baseline-v1';
export const BASELINE_PLACEMENT_RANKING_METHOD = 'baseline';

const ratio = z.number().min(0).max(1);
const baselineProposalSchema = z.object({
  sortOrder: z.number().int(),
  kind: z.string(),
  measurementLabel: z.string().min(1),
  reason: z.string(),
  nominalValue: z.number().finite(),
  lowerLimit: z.number().finite().nullable(),
  upperLimit: z.number().finite().nullable(),
  markerXRatio: ratio,
  markerYRatio: ratio,
  anchorXRatio: ratio,
  anchorYRatio: ratio,
  leader: z.tuple([z.number(), z.number()]).nullable()
});
export const baselinePlacementImportSchema = z.object({
  version: z.literal(BASELINE_PLACEMENT_VERSION),
  drawings: z.array(z.object({
    visualTemplateId: z.string().min(1),
    imageSha256: z.string().min(1),
    proposals: z.array(baselineProposalSchema)
  }).superRefine((drawing, ctx) => {
    const seen = new Set<number>();
    drawing.proposals.forEach((proposal, index) => {
      if (seen.has(proposal.sortOrder)) {
        ctx.addIssue({
          code: 'custom', path: ['proposals', index, 'sortOrder'],
          message: `duplicate sortOrder ${proposal.sortOrder} within drawing ${drawing.visualTemplateId}`
        });
      }
      seen.add(proposal.sortOrder);
    });
  }))
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.drawings.forEach((drawing, index) => {
    if (seen.has(drawing.visualTemplateId)) {
      ctx.addIssue({
        code: 'custom', path: ['drawings', index, 'visualTemplateId'],
        message: `duplicate visualTemplateId ${drawing.visualTemplateId} across drawings`
      });
    }
    seen.add(drawing.visualTemplateId);
  });
});
export type BaselinePlacementImport = z.infer<typeof baselinePlacementImportSchema>;
type BaselineProposal = z.infer<typeof baselineProposalSchema>;

export type BaselineImportDrawingOutcome = {
  visualTemplateId: string;
  proposals: number;
  result: 'create' | 'replace' | 'skipped' | 'failed';
  reason?: 'template-missing-or-inactive' | 'fingerprint-unreadable' | 'fingerprint-mismatch' | 'has-decided-proposals' | 'apply-error';
};

export type BaselineImportSummary = {
  apply: boolean;
  drawings: BaselineImportDrawingOutcome[];
  created: number;
  replaced: number;
  skipped: number;
  failed: number;
};

const decimalsOf = (value: number | null) => {
  if (value === null) return 0;
  const [, fraction = ''] = String(value).split('.');
  return fraction.length;
};
export const baselineDecimalPlaces = (proposal: Pick<BaselineProposal, 'nominalValue' | 'lowerLimit' | 'upperLimit'>) =>
  Math.min(3, Math.max(1, decimalsOf(proposal.nominalValue), decimalsOf(proposal.lowerLimit), decimalsOf(proposal.upperLimit)));

export const baselineSourceItemId = (sortOrder: number) => `${BASELINE_PLACEMENT_VERSION}:${sortOrder}`;

const proposalData = (visualTemplateId: string, runId: string, proposal: BaselineProposal) => ({
  runId,
  visualTemplateId,
  // sourceItemId is plain text in the schema (no foreign key), so a synthetic id is fine.
  sourceItemId: baselineSourceItemId(proposal.sortOrder),
  status: 'PROPOSED' as const,
  sortOrder: proposal.sortOrder,
  measurementLabel: proposal.measurementLabel,
  measurementPoint: null,
  decimalPlaces: baselineDecimalPlaces(proposal),
  nominalValue: proposal.nominalValue,
  lowerLimit: proposal.lowerLimit,
  upperLimit: proposal.upperLimit,
  depthMode: 'MEASURED' as const,
  valueKind: 'NUMERIC' as const,
  markerXRatio: proposal.markerXRatio,
  markerYRatio: proposal.markerYRatio,
  dimension: {
    // The reason is explanatory text for operators of the import; it is stored under `reason`, not `text`, so the kiosk never shows it.
    reason: proposal.reason, xRatio: proposal.anchorXRatio, yRatio: proposal.anchorYRatio,
    kind: proposal.kind, leader: proposal.leader
  } satisfies Prisma.InputJsonObject,
  candidates: []
});

export async function importBaselinePlacementProposals(
  input: BaselinePlacementImport,
  options: { apply: boolean; getFingerprint?: (visualTemplateId: string) => Promise<string> }
): Promise<BaselineImportSummary> {
  const getFingerprint = options.getFingerprint
    ?? ((id: string) => getPartMeasurementDrawingOcrService().getCurrentFingerprint(id));
  const drawings: BaselineImportDrawingOutcome[] = [];
  for (const drawing of input.drawings) {
    const base = { visualTemplateId: drawing.visualTemplateId, proposals: drawing.proposals.length };
    const skip = (reason: NonNullable<BaselineImportDrawingOutcome['reason']>): BaselineImportDrawingOutcome =>
      ({ ...base, result: 'skipped', reason });
    // eslint-disable-next-line no-await-in-loop
    const visual = await prisma.partMeasurementVisualTemplate.findFirst({
      where: { id: drawing.visualTemplateId, isActive: true }, select: { id: true }
    });
    if (!visual) { drawings.push(skip('template-missing-or-inactive')); continue; }
    let fingerprint: string;
    try {
      // eslint-disable-next-line no-await-in-loop
      fingerprint = await getFingerprint(drawing.visualTemplateId);
    } catch {
      drawings.push(skip('fingerprint-unreadable'));
      continue;
    }
    if (fingerprint !== drawing.imageSha256) { drawings.push(skip('fingerprint-mismatch')); continue; }
    const key = {
      visualTemplateId: drawing.visualTemplateId,
      drawingImageFingerprint: fingerprint,
      analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION,
      placementVersion: BASELINE_PLACEMENT_VERSION
    };
    const where = { visualTemplateId_drawingImageFingerprint_analysisVersion_placementVersion: key };
    if (!options.apply) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await prisma.partMeasurementDrawingPlacementRun.findUnique({
        where, select: { id: true, proposals: { where: { decidedAt: { not: null } }, select: { id: true }, take: 1 } }
      });
      if (existing && existing.proposals.length > 0) drawings.push(skip('has-decided-proposals'));
      else drawings.push({ ...base, result: existing ? 'replace' : 'create' });
      continue;
    }
    let outcome: BaselineImportDrawingOutcome;
    try {
    // eslint-disable-next-line no-await-in-loop
    outcome = await prisma.$transaction(async (tx): Promise<BaselineImportDrawingOutcome> => {
      const existing = await tx.partMeasurementDrawingPlacementRun.findUnique({ where, select: { id: true } });
      if (existing) {
        // Lock the rows first so a concurrent approval cannot be deleted by the replacement.
        await tx.$queryRaw`SELECT "id" FROM "PartMeasurementDrawingPlacementProposal" WHERE "runId" = ${existing.id} FOR UPDATE`;
        const decided = await tx.partMeasurementDrawingPlacementProposal.count({
          where: { runId: existing.id, decidedAt: { not: null } }
        });
        if (decided > 0) return skip('has-decided-proposals');
      }
      const run = await tx.partMeasurementDrawingPlacementRun.upsert({
        where,
        create: {
          ...key, sourceVisualTemplateId: null, sourceTemplateId: null,
          rankingMethod: BASELINE_PLACEMENT_RANKING_METHOD, proposalCount: drawing.proposals.length, unplacedCount: 0
        },
        update: {
          sourceVisualTemplateId: null, sourceTemplateId: null,
          rankingMethod: BASELINE_PLACEMENT_RANKING_METHOD, proposalCount: drawing.proposals.length, unplacedCount: 0
        }
      });
      await tx.partMeasurementDrawingPlacementProposal.deleteMany({ where: { runId: run.id } });
      if (drawing.proposals.length > 0) {
        await tx.partMeasurementDrawingPlacementProposal.createMany({
          data: drawing.proposals.map((proposal) => proposalData(drawing.visualTemplateId, run.id, proposal))
        });
      }
      return { ...base, result: existing ? 'replace' : 'create' };
    });
    } catch {
      outcome = { ...base, result: 'failed', reason: 'apply-error' };
    }
    drawings.push(outcome);
  }
  return {
    apply: options.apply,
    drawings,
    created: drawings.filter((entry) => entry.result === 'create').length,
    replaced: drawings.filter((entry) => entry.result === 'replace').length,
    skipped: drawings.filter((entry) => entry.result === 'skipped').length,
    failed: drawings.filter((entry) => entry.result === 'failed').length
  };
}
