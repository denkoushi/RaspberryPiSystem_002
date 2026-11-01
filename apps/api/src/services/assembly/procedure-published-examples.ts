import { prisma } from '../../lib/prisma.js';

export type ProcedureSite = 'assembly' | 'grinding';
export type PublishedProcedure = {
  id: string; revisionRootId: string; updatedAt: Date; texts: string[];
};
export const compareStrings = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** The latest published revision per root is the current one, as in procedure-manual.service resolvePublished; assignments on any revision determine the site, with assembly taking precedence. */
export async function loadPublishedProcedures(site: ProcedureSite): Promise<PublishedProcedure[]> {
  const published = await prisma.assemblyProcedureDocument.findMany({
    where: { status: 'PUBLISHED', isActive: true, revisionMetadata: { isNot: null } },
    select: {
      id: true, updatedAt: true, publishedAt: true,
      revisionMetadata: { select: { revisionRootId: true, revisionNumber: true, updatedAt: true } },
      overlayElements: { where: { kind: 'TEXT' }, select: { text: true, updatedAt: true } },
    },
  });
  const latestByRoot = new Map<string, (typeof published)[number]>();
  for (const document of published) {
    const current = latestByRoot.get(document.revisionMetadata!.revisionRootId);
    if (!current || document.revisionMetadata!.revisionNumber > current.revisionMetadata!.revisionNumber) latestByRoot.set(document.revisionMetadata!.revisionRootId, document);
  }
  const documents = [...latestByRoot.values()];
  if (!documents.length) return [];
  const assignments = await prisma.procedureManualAssignment.findMany({
    where: { assemblyProcedureDocument: { revisionMetadata: { revisionRootId: { in: documents.map(d => d.revisionMetadata!.revisionRootId) } } } },
    select: {
      assemblyProcedureDocument: { select: { revisionMetadata: { select: { revisionRootId: true } } } },
      process: { select: { name: true, parent: { select: { name: true } } } },
    },
  });
  return documents.flatMap(document => {
    const root = document.revisionMetadata!.revisionRootId;
    const names = assignments.filter(a => a.assemblyProcedureDocument?.revisionMetadata?.revisionRootId === root)
      .flatMap(a => [a.process.name, a.process.parent?.name ?? '']);
    const documentSite = names.some(n => n.startsWith('組立')) ? 'assembly' : names.some(n => n.startsWith('研削')) ? 'grinding' : null;
    return documentSite === site ? [{
      id: document.id, revisionRootId: root,
      updatedAt: new Date(Math.max(document.updatedAt.getTime(), document.publishedAt?.getTime() ?? 0,
        document.revisionMetadata!.updatedAt.getTime(), ...document.overlayElements.map(e => e.updatedAt.getTime()))),
      texts: document.overlayElements.flatMap(e => e.text?.trim() ? [e.text.trim()] : []),
    }] : [];
  });
}

const normalize = (text: string) => text.replace(/\s/gu, '');
function bigrams(text: string): Set<string> {
  const chars = Array.from(normalize(text));
  return new Set(chars.slice(1).map((char, i) => chars[i] + char));
}
export function selectPublishedExamples(documents: PublishedProcedure[], revisionRootId: string, pageTexts: string[]): string[] {
  const target = bigrams(pageTexts.join('\n'));
  const unique = new Map<string, string>();
  for (const document of documents) {
    if (document.revisionRootId === revisionRootId) continue;
    for (const raw of document.texts) {
      const text = raw.trim(), key = normalize(text);
      if (key && (!unique.has(key) || compareStrings(text, unique.get(key)!) < 0)) unique.set(key, text);
    }
  }
  const score = (text: string) => {
    const grams = bigrams(text);
    const overlap = [...grams].filter(g => target.has(g)).length;
    return overlap / (target.size + grams.size - overlap || 1);
  };
  const sorted = [...unique.values()].sort((a, b) => score(b) - score(a) || Array.from(a).length - Array.from(b).length || compareStrings(a, b));
  const selected: string[] = [];
  let length = 0;
  for (const text of sorted) {
    const size = Array.from(text).length;
    if (length + size > 1500) continue;
    selected.push(text); length += size;
  }
  return selected;
}

export function buildPublishedExamplesPrompt(examples: string[]): string {
  return examples.length ? `同じ課の公開済み手順書の書き方(書き方と呼び名の参考。数値・品名・プログラム番号を他の text に持ち込まない):\n${examples.map(text => JSON.stringify(text)).join('\n')}\n` : '';
}
