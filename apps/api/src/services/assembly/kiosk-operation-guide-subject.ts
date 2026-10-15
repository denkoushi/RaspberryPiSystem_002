import type { PrismaClient } from '@prisma/client';

import { normalize } from './kiosk-operation-guide.service.js';

export type GuideFamily = 'inventory' | 'tool' | 'instrument' | 'rigging';

export const GUIDE_FAMILY_ROUTES: Record<GuideFamily, string[]> = {
  inventory: ['/kiosk/inventory'],
  tool: ['/kiosk/tag', '/kiosk/tag-desk'],
  instrument: ['/kiosk/instruments'],
  rigging: ['/kiosk/rigging']
};

export type MasterNames = { inventoryItems: string[]; tools: string[]; instruments: string[]; riggingGear: string[] };
// Resolvers take the question's terms the guide documents do not know (KioskOperationGuideIndex.unknownTerms).
export type SubjectResolver = (terms: string[]) => GuideFamily[];
export type AsyncSubjectResolver = { resolve(terms: string[]): Promise<GuideFamily[]> };

const FAMILIES: GuideFamily[] = ['inventory', 'tool', 'instrument', 'rigging'];

export function masterNamesSubjectResolver(names: MasterNames): SubjectResolver {
  const normalizedNames = [names.inventoryItems, names.tools, names.instruments, names.riggingGear]
    .map((entries) => entries.map(normalize));
  return (rawTerms) => {
    const terms = rawTerms.map(normalize).filter((term) => term.length >= 2);
    return FAMILIES.filter((_, index) => normalizedNames[index]!.some((name) => terms.some((term) => name.includes(term))));
  };
}

export class PrismaSubjectResolver implements AsyncSubjectResolver {
  private readonly cache = new Map<string, { families: GuideFamily[]; expiresAt: number }>();
  private warned = false;

  constructor(private readonly db: Pick<PrismaClient, 'inventoryItem' | 'item' | 'measuringInstrument' | 'riggingGear'>) {}

  async resolve(rawTerms: string[]): Promise<GuideFamily[]> {
    try {
      const terms = [...new Set(rawTerms.map(normalize).filter((term) => term.length >= 2))];
      const hits = await Promise.all(terms.map(async (term) => {
        const cached = this.cache.get(term);
        if (cached && cached.expiresAt > Date.now()) return cached.families;
        const query = { where: { name: { contains: term, mode: 'insensitive' as const } }, select: { id: true } };
        const results = await Promise.all([
          this.db.inventoryItem.findFirst(query), this.db.item.findFirst(query),
          this.db.measuringInstrument.findFirst(query), this.db.riggingGear.findFirst(query)
        ]);
        const families = FAMILIES.filter((_, index) => results[index] != null);
        this.cache.delete(term);
        this.cache.set(term, { families, expiresAt: Date.now() + 10 * 60 * 1000 });
        if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
        return families;
      }));
      return FAMILIES.filter((family) => hits.some((families) => families.includes(family)));
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.warn('Unable to resolve kiosk operation guide subject', error);
      }
      return [];
    }
  }
}
