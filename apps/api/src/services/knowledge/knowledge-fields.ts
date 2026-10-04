import { randomUUID } from 'node:crypto';

import type { KnowledgeField, Prisma, PrismaClient } from '@prisma/client';
import type { KnowledgeFieldNode } from '@raspi-system/shared-types';

import { INITIAL_KNOWLEDGE_FIELDS, type KnowledgeFieldSeed } from './knowledge-field-seed.js';

export const normalizeTopicPart = (value: string) => value.normalize('NFKC').trim().toLowerCase();
export const topicIdentity = (parts: { target: string; workType: string; detail?: string | null }) => JSON.stringify([
  normalizeTopicPart(parts.target), normalizeTopicPart(parts.workType), normalizeTopicPart(parts.detail ?? ''),
]);

export function fieldTree(rows: Pick<KnowledgeField, 'id' | 'parentId' | 'name' | 'aliases' | 'sortOrder'>[]): KnowledgeFieldNode[] {
  const names = new Set<string>();
  const byId = new Map(rows.map(row => [row.id, row]));
  const children = new Map<string | null, typeof rows>();
  for (const row of rows) {
    if (names.has(row.name)) throw new Error('INVALID_KNOWLEDGE_FIELD_TREE');
    names.add(row.name);
    let ancestor = row; const seen = new Set([row.id]); let depth = 1;
    while (ancestor.parentId) {
      const parent = byId.get(ancestor.parentId);
      if (!parent) break;
      if (seen.has(parent.id) || ++depth > 3) throw new Error('INVALID_KNOWLEDGE_FIELD_TREE');
      seen.add(parent.id); ancestor = parent;
    }
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  }
  const branch = (parentId: string | null): KnowledgeFieldNode[] => (children.get(parentId) ?? [])
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(row => ({ id: row.id, name: row.name, aliases: row.aliases, children: branch(row.id) }));
  return branch(null);
}

export async function seedKnowledgeFields(db: PrismaClient) {
  await db.$transaction(async tx => {
    // Serialize empty-table seeding so concurrent startups cannot leave a partial tree.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(610041200)`;
    if (await tx.knowledgeField.count()) return;
    const rows: Prisma.KnowledgeFieldCreateManyInput[] = [];
    const add = (nodes: KnowledgeFieldSeed[], parentId: string | null, depth: number) => {
      if (depth > 3 && nodes.length) throw new Error('INVALID_KNOWLEDGE_FIELD_TREE');
      nodes.forEach((node, index) => {
        const id = randomUUID();
        rows.push({ id, parentId, name: node.name, aliases: node.aliases, sortOrder: (index + 1) * 10 });
        add(node.children, id, depth + 1);
      });
    };
    add(INITIAL_KNOWLEDGE_FIELDS, null, 1);
    if (new Set(rows.map(row => row.name)).size !== rows.length) throw new Error('INVALID_KNOWLEDGE_FIELD_TREE');
    await tx.knowledgeField.createMany({ data: rows });
  });
}

export async function activeKnowledgeField(db: Pick<Prisma.TransactionClient, 'knowledgeField'>, name: string) {
  const rows = await db.knowledgeField.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  fieldTree(rows);
  const field = rows.find(row => normalizeTopicPart(row.name) === normalizeTopicPart(name));
  if (!field) throw new Error('UNKNOWN_KNOWLEDGE_FIELD');
  let root = field; let depth = 1;
  while (root.parentId) {
    const parent = rows.find(row => row.id === root.parentId);
    if (!parent || ++depth > 3) throw new Error('UNKNOWN_KNOWLEDGE_FIELD');
    root = parent;
  }
  return { field, root };
}
