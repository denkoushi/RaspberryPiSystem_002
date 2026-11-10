// Read-only leave-one-out evaluation of inspection drawing marker proposals. Run from apps/api:
//   node dist/scripts/evaluate-drawing-placement-loo.js --process all --vision auto --out /tmp/placement-loo.json
//   pnpm exec tsx src/scripts/evaluate-drawing-placement-loo.ts --vision none --limit 10
// Reference: --method reference [--exclude-same-machine] [--interactive] uses the business text model (background
// admission unless --interactive) and retries deferred
// targets up to 3 times, waiting 20 seconds each time. Both methods report nominal-only matches.
// Options: --method transfer|reference (default transfer), --exclude-same-machine, --process cutting|grinding|all, --limit N (drawings, before expanding process groups),
//   --visual-template-id <id[,id...]> (repeatable), --vision auto|none, --pos-tol 0.03, --out <file.json>.
// Uses the server's existing API configuration and drawing storage. No database writes, OCR,
// dimension-map generation, saved matches or placement runs. Auto performs up to three production
// selection attempts in memory (normally separate background ticks); none uses scored name-family candidates.
// Human truth includes all marked items of active templates in the process group, including null nominal
// values (unmatchable). UNPLACED transfers are not proposals. Error rows are excluded from micro averages;
// zero denominators yield zero. Transfer uses the pure position ranking, without an optional JEV reorder.
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

import { InferenceDeferredError } from '../services/inference/ports/text-completion.port.js';
import { buildReferenceExamples, drawingMachinePrefix, selectReferenceExamples } from '../services/part-measurement/part-measurement-drawing-reference-proposer.js';
import { DRAWING_REFERENCE_LABEL_VOCABULARY } from '../services/part-measurement/part-measurement-drawing-reference-guide.js';

import type { PartMeasurementProcessGroup, PartMeasurementTemplateItem } from '@prisma/client';

import {
  decodePartMeasurementDrawingDimensionMapPayload,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING,
  PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION
} from '../services/part-measurement/part-measurement-drawing-dimension-map-payload.js';
import {
  chooseSourceSibling, drawingNameFamily, transferItems, type DimensionMap, type PlacementSourceItem
} from '../services/part-measurement/part-measurement-drawing-placement-transfer.js';
import { prefilterDrawingSiblings } from '../services/part-measurement/part-measurement-drawing-sibling-match.js';
import type { DrawingSiblingSelection } from '../services/part-measurement/part-measurement-drawing-sibling-selection.js';
import { comparePlacementMarkers, nominalMatched, placementRates, type EvaluationMarker } from './drawing-placement-loo-metrics.js';

type Method = DrawingSiblingSelection['method'] | 'none' | 'reference';
type Row = {
  visualTemplateId: string;
  drawingName: string;
  processGroup: PartMeasurementProcessGroup;
  humanTemplateIds: string[];
  siblingId: string | null;
  siblingName: string | null;
  sourceTemplateId: string | null;
  sameFamily: boolean | null;
  method: Method;
  selectionMethod: Method;
  attempts: number;
  warning: string | null;
  humanCount: number;
  proposalCount: number | null;
  matched: number | null;
  nominalMatched: number | null;
  positionOk: number | null;
  precision: number | null;
  recall: number | null;
  positionOkRate: number | null;
  error: string | null;
};

function options() {
  const { values } = parseArgs({ options: {
    process: { type: 'string', default: 'all' },
    method: { type: 'string', default: 'transfer' },
    'exclude-same-machine': { type: 'boolean', default: false },
    interactive: { type: 'boolean', default: false },
    limit: { type: 'string' },
    'visual-template-id': { type: 'string', multiple: true },
    vision: { type: 'string', default: 'auto' },
    'pos-tol': { type: 'string', default: '0.03' },
    out: { type: 'string' }
  } });
  if (!['cutting', 'grinding', 'all'].includes(values.process!) || !['auto', 'none'].includes(values.vision!)) {
    throw new Error('Invalid process or vision option');
  }
  if (!['transfer', 'reference'].includes(values.method!)) throw new Error('Invalid method');
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  const positionTolerance = Number(values['pos-tol']);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Invalid limit');
  if (!values['pos-tol']?.trim() || !Number.isFinite(positionTolerance) || positionTolerance < 0) {
    throw new Error('Invalid position tolerance');
  }
  const visualTemplateIds = (values['visual-template-id'] ?? []).flatMap((value) => value.split(',').map((id) => id.trim()));
  if (visualTemplateIds.some((id) => !id) || values.out === '') throw new Error('Empty ID or output path');
  const processGroups: PartMeasurementProcessGroup[] = values.process === 'all'
    ? ['CUTTING', 'GRINDING'] : [values.process === 'cutting' ? 'CUTTING' : 'GRINDING'];
  return { method: values.method!, excludeSameMachine: values['exclude-same-machine'], interactive: values.interactive, processGroups, limit, visualTemplateIds, vision: values.vision!, positionTolerance, out: values.out };
}

// Identical numeric eligibility/conversion to placement.service sourceItems; human truth keeps null nominal values.
function sourceItems(items: PartMeasurementTemplateItem[]): PlacementSourceItem[] {
  return items.flatMap((item) => {
    if (item.markerXRatio === null || item.markerYRatio === null || item.nominalValue === null) return [];
    return [{
      id: item.id, sortOrder: item.sortOrder, measurementLabel: item.measurementLabel,
      nominalValue: item.nominalValue.toNumber(), lowerLimit: item.lowerLimit?.toNumber() ?? null,
      upperLimit: item.upperLimit?.toNumber() ?? null, depthMode: item.depthMode, valueKind: item.valueKind,
      markerXRatio: item.markerXRatio.toNumber(), markerYRatio: item.markerYRatio.toNumber(),
      calloutTipXRatio: item.calloutTipXRatio?.toNumber() ?? null, calloutTipYRatio: item.calloutTipYRatio?.toNumber() ?? null
    }];
  });
}

async function main() {
  let config: ReturnType<typeof options>;
  try { config = options(); }
  catch {
    console.error('Invalid options. Use --method transfer|reference [--exclude-same-machine] [--interactive] --process cutting|grinding|all --vision auto|none --limit <positive integer> --pos-tol <nonnegative number> --visual-template-id <id[,id...]> --out <file.json>.');
    process.exitCode = 1;
    return;
  }
  const { prisma } = await import('../lib/prisma.js');
  try {
    const { drawingSiblingSelectionDeps, selectDrawingSiblings } = await import(
      '../services/part-measurement/part-measurement-drawing-sibling-selection.js'
    );
    const reference = config.method === 'reference' ? await (async () => {
      const { getInferenceRuntime } = await import('../services/inference/inference-runtime.js');
      const { proposeFromReference } = await import('../services/part-measurement/part-measurement-drawing-reference-placement.service.js');
      const { InspectionDrawingMeasurementLabelSettingsService } = await import('../services/part-measurement/inspection-drawing-measurement-label-settings.service.js');
      const settings = await new InspectionDrawingMeasurementLabelSettingsService().listSettings();
      return { text: getInferenceRuntime().createTextCompletionPort(), proposeFromReference,
        labels: [...new Set([...settings, ...DRAWING_REFERENCE_LABEL_VOCABULARY].map(({ label }) => label.normalize('NFKC').trim()))] };
    })() : null;
    const visuals = await prisma.partMeasurementVisualTemplate.findMany({
      where: { isActive: true, businessTemplates: { some: { isActive: true,
        items: { some: { markerXRatio: { not: null }, markerYRatio: { not: null } } }
      } } },
      orderBy: { id: 'asc' },
      select: {
        id: true, name: true, drawingImageRelativePath: true,
        dimensionMaps: {
          where: { analysisVersion: PART_MEASUREMENT_DRAWING_DIMENSION_MAP_VERSION },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 1,
          select: { drawingImageFingerprint: true, status: true, payloadCompressed: true, payloadEncoding: true }
        },
        businessTemplates: {
          where: { isActive: true, items: { some: { markerXRatio: { not: null }, markerYRatio: { not: null } } } },
          orderBy: { id: 'asc' },
          select: { id: true, processGroup: true, updatedAt: true,
            items: { where: { markerXRatio: { not: null }, markerYRatio: { not: null } }, orderBy: { sortOrder: 'asc' } }
          }
        }
      }
    });
    const completed = await Promise.all(visuals.filter((visual) => visual.dimensionMaps[0]?.status === 'COMPLETED')
      .map(async (visual) => {
        const latest = visual.dimensionMaps[0];
        let map: DimensionMap | null = null;
        try {
          if (latest.payloadEncoding !== PART_MEASUREMENT_DRAWING_DIMENSION_MAP_PAYLOAD_ENCODING || !latest.payloadCompressed) {
            throw new Error('Missing map payload');
          }
          const payload = await decodePartMeasurementDrawingDimensionMapPayload(latest.payloadCompressed);
          if (!Array.isArray(payload.dimensions) || !payload.image) throw new Error('Invalid map payload');
          map = payload;
        } catch { /* Record target errors below; production also omits undecodable sibling maps. */ }
        return { ...visual, map, fingerprint: latest.drawingImageFingerprint };
      }));
    const pool = completed.flatMap((visual) => visual.map ? [{ ...visual, map: visual.map }] : []);
    // Restrict held-out targets only. Every other eligible drawing remains in the sibling pool.
    const targets = completed.filter((visual) =>
      (!config.visualTemplateIds.length || config.visualTemplateIds.includes(visual.id)) &&
      visual.businessTemplates.some((template) => config.processGroups.includes(template.processGroup))
    ).slice(0, config.limit);
    const rows: Row[] = [];
    for (const target of targets) {
      let selection: DrawingSiblingSelection | null = null;
      let selectionError: string | null = target.map ? null : 'Dimension map payload could not be decoded';
      let attempts = 0;
      try {
        if (target.map && !reference) {
          const deps = config.vision === 'none'
            ? { ...drawingSiblingSelectionDeps, enabled: () => false } : drawingSiblingSelectionDeps;
          const candidates = deps.enabled() ? await prefilterDrawingSiblings(target, pool.filter((candidate) =>
            candidate.id !== target.id && candidate.fingerprint !== target.fingerprint), deps) : [];
          do {
            attempts++;
            // Same production retry thresholds, without persisting PENDING or attempts.
            // eslint-disable-next-line no-await-in-loop
            selection = await selectDrawingSiblings(target, candidates, attempts, deps);
          } while (selection.status === 'PENDING' && attempts < 3);
          if (selection.status === 'PENDING') selectionError = 'Sibling selection remained pending';
        }
      } catch { selectionError = 'Sibling selection failed'; }
      for (const processGroup of config.processGroups) {
        const templates = target.businessTemplates.filter((template) => template.processGroup === processGroup);
        if (!templates.length) continue;
        const humans: EvaluationMarker[] = templates.flatMap((template) => template.items.map((item) => ({
          nominalValue: item.nominalValue?.toNumber() ?? null, measurementLabel: item.measurementLabel,
          markerXRatio: item.markerXRatio!.toNumber(), markerYRatio: item.markerYRatio!.toNumber()
        })));
        const row: Row = {
          visualTemplateId: target.id, drawingName: target.name, processGroup,
          humanTemplateIds: templates.map((template) => template.id),
          siblingId: null, siblingName: null, sourceTemplateId: null, sameFamily: null,
          method: 'none', selectionMethod: selection?.method ?? 'none', attempts,
          warning: selection?.lastError ?? null,
          humanCount: humans.length, proposalCount: null, matched: null, nominalMatched: null, positionOk: null,
          precision: null, recall: null, positionOkRate: null, error: selectionError
        };
        if (!row.error && target.map && reference) {
          const examples = selectReferenceExamples({ ...target, map: target.map }, pool.filter((candidate) =>
            candidate.businessTemplates.some((template) => template.processGroup === processGroup)), {
            excludeMachinePrefix: config.excludeSameMachine ? drawingMachinePrefix(target.name) : null
          }).map((candidate) => ({ map: candidate.map, ...buildReferenceExamples(candidate.map,
            candidate.businessTemplates.filter((template) => template.processGroup === processGroup)
              .flatMap((template) => sourceItems(template.items).map((item) => ({ ...item, label: item.measurementLabel })))) }));
          row.method = 'reference';
          row.selectionMethod = 'reference';
          for (let attempt = 0; attempt <= 3; attempt++) {
            row.attempts = attempt + 1;
            try {
              // eslint-disable-next-line no-await-in-loop
              const proposals = await reference.proposeFromReference({ ...reference, target: target.map, examples, processGroup,
                background: !config.interactive });
              Object.assign(row, comparePlacementMarkers(proposals, humans, config.positionTolerance), {
                nominalMatched: nominalMatched(proposals, humans)
              });
              break;
            } catch (error) {
              if (error instanceof InferenceDeferredError && attempt < 3) {
                // eslint-disable-next-line no-await-in-loop
                await delay(20000);
                continue;
              }
              row.error = error instanceof InferenceDeferredError ? 'Reference inference deferred after 3 retries' : 'Reference proposal or comparison failed';
              break;
            }
          }
        } else if (!row.error && target.map && selection) {
          try {
            const source = chooseSourceSibling({
              target, targetMap: target.map,
              siblings: selection.siblings.flatMap((sibling) => {
                const visual = pool.find((candidate) => candidate.id === sibling.visualTemplateId);
                return visual ? [{ ...visual, isActive: true,
                  templates: visual.businessTemplates.filter((template) => template.processGroup === processGroup)
                    .map((template) => ({ ...template, isActive: true, items: sourceItems(template.items) }))
                }] : [];
              })
            });
            if (source) {
              row.siblingId = source.sibling.id;
              row.siblingName = source.sibling.name;
              row.sourceTemplateId = source.template.id;
              row.method = selection.method;
              const family = drawingNameFamily(target.name);
              row.sameFamily = Boolean(family && family === drawingNameFamily(source.sibling.name));
            }
            // eslint-disable-next-line no-await-in-loop
            const transfers = source ? await transferItems({
              targetMap: target.map, sourceMap: pool.find((visual) => visual.id === source.sibling.id)!.map,
              sourceItems: source.template.items, existingItems: []
            }) : [];
            const proposals = transfers.flatMap((entry) => entry.status === 'PROPOSED' ? [{
              nominalValue: entry.item.nominalValue, measurementLabel: entry.item.measurementLabel,
              markerXRatio: entry.markerXRatio!, markerYRatio: entry.markerYRatio!
            }] : []);
            Object.assign(row, comparePlacementMarkers(proposals, humans, config.positionTolerance), {
              nominalMatched: nominalMatched(proposals, humans)
            });
          } catch { row.error = 'Placement transfer or comparison failed'; }
        }
        rows.push(row);
      }
    }
    const successful = rows.filter((row) => row.error === null);
    const countsByMethod: Record<Method, number> = { 'dgx-vision': 0, none: 0, reference: 0 };
    for (const row of successful) countsByMethod[row.method]++;
    const summary = {
      drawings: targets.length, rows: rows.length, evaluatedRows: successful.length, errorRows: rows.length - successful.length,
      invalidCandidateMaps: completed.length - pool.length, countsByMethod,
      nominalMatched: successful.reduce((sum, row) => sum + row.nominalMatched!, 0),
      sameFamily: successful.filter((row) => row.sameFamily === true).length,
      differentFamily: successful.filter((row) => row.sameFamily === false).length,
      ...placementRates(successful.reduce((sum, row) => ({
        humanCount: sum.humanCount + row.humanCount, proposalCount: sum.proposalCount + row.proposalCount!,
        matched: sum.matched + row.matched!, positionOk: sum.positionOk + row.positionOk!
      }), { humanCount: 0, proposalCount: 0, matched: 0, positionOk: 0 }))
    };
    if (config.out) await writeFile(config.out, `${JSON.stringify({ options: config, summary, rows }, null, 2)}\n`, { flag: 'wx' });
    console.table(rows.map((row) => ({
      drawing: row.drawingName, process: row.processGroup, sibling: row.siblingName, method: row.method,
      sameFamily: row.sameFamily, human: row.humanCount, proposals: row.proposalCount,
      matched: row.matched, nominalMatched: row.nominalMatched, positionOk: row.positionOk,
      precision: row.precision?.toFixed(3) ?? '-', recall: row.recall?.toFixed(3) ?? '-',
      positionOkRate: row.positionOkRate?.toFixed(3) ?? '-', error: row.error
    })));
    console.log(JSON.stringify(summary));
  } finally { await prisma.$disconnect(); }
}

// Never print upstream exceptions: they can contain image response text or connection details.
main().catch(() => {
  console.error('Evaluation failed while loading configuration, reading data, or writing output (output path must be new).');
  process.exitCode = 1;
});
