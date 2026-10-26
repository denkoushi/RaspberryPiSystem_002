import { z } from 'zod';

import { knowledgeDestinationSchema } from './knowledge-destination.js';
import type { KnowledgeIntakeRepositoryPort } from './knowledge-intake.port.js';
import type { PosterResolver } from './knowledge-intake.service.js';
import { enforceReviewTier, normalizeIdentifiers } from './procedure-builder.js';
import { composeTitle, titlePartsSchema } from './procedure-content.js';
import type { TriageRepositoryPort } from './triage.port.js';

export const triageDecisionSchema = z.object({
  posterTagUid: z.string().trim().min(1).max(64),
  destination: knowledgeDestinationSchema,
}).strict();

export const triagePendingSchema = z.object({ posterTagUid: z.string().trim().min(1).max(64) }).strict();

/** The poster decides where their post goes; the AI only suggests. */
export class KnowledgeTriageService {
  constructor(private readonly deps: {
    triage: TriageRepositoryPort; intakes: KnowledgeIntakeRepositoryPort; resolvePoster: PosterResolver;
  }) {}

  private async poster(tagUid: string) {
    const poster = await this.deps.resolvePoster(tagUid);
    if (!poster) throw new Error('UNKNOWN_POSTER');
    return poster;
  }

  /** The scanned employee's posts that still need a destination, with their suggestions. */
  async pending(raw: unknown) {
    const { posterTagUid } = triagePendingSchema.parse(raw);
    const poster = await this.poster(posterTagUid);
    const triages = await this.deps.triage.awaitingFor(poster.id);
    const intakes = await this.deps.intakes.byIds(triages.map(triage => triage.intakeId));
    const byId = new Map(intakes.map(intake => [intake.id, intake]));
    return { posterName: poster.displayName, items: triages.flatMap(triage => {
      const intake = byId.get(triage.intakeId);
      return intake ? [{
        intakeId: triage.intakeId, text: intake.text, createdAt: intake.createdAt.toISOString(), scannedPartNumber: intake.scannedPartNumber,
        files: intake.files.map(file => ({ filename: file.filename, kind: file.kind })), state: triage.state, suggestions: triage.suggestions,
      }] : [];
    }) };
  }

  async decide(intakeId: string, raw: unknown) {
    const { posterTagUid, destination } = triageDecisionSchema.parse(raw);
    const poster = await this.poster(posterTagUid);
    if ('procedureId' in destination) return this.deps.triage.decide(intakeId, poster.id, destination);
    const [triage] = await this.deps.triage.get([intakeId]);
    const detail = destination.newTopic.detail?.trim();
    const parts = titlePartsSchema.parse({ target: destination.newTopic.target, workType: destination.newTopic.workType, ...(detail ? { detail } : {}) });
    const identifiers = normalizeIdentifiers({ partNumber: destination.newTopic.partNumber, drawingNumber: destination.newTopic.drawingNumber });
    // A person may edit the AI's title, but the review tier is still decided in code.
    const proposed = triage?.suggestions?.proposal?.reviewTier ?? 'approval_required';
    const reviewTier = enforceReviewTier({ title: composeTitle(parts), category: parts.workType, identifiers, reviewTier: proposed }, triage?.suggestions?.confidence ?? 0);
    return this.deps.triage.decide(intakeId, poster.id, { newTopic: { parts, identifiers, reviewTier } });
  }
}
