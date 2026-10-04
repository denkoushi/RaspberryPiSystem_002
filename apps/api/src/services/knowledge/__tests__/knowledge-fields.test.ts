import type { KnowledgeField, PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { activeKnowledgeField, fieldTree, seedKnowledgeFields, topicIdentity } from '../knowledge-fields.js';
import { INITIAL_KNOWLEDGE_FIELDS } from '../knowledge-field-seed.js';
import { INITIAL_WORK_TYPES } from '../knowledge-reference-data.js';
import { enforceReviewTier, validateSuggestions } from '../procedure-builder.js';

const row = (id: string, name: string, parentId: string | null = null, sortOrder = 1): KnowledgeField => ({ id, name, parentId, sortOrder, aliases: [], active: true, createdAt: new Date() });

describe('knowledge fields', () => {
  it('seeds only an empty tree and preserves ids and curated values on the second startup', async () => {
    let rows: KnowledgeField[] = [];
    const tx = { $executeRaw: vi.fn(), knowledgeField: { count: vi.fn(async () => rows.length), createMany: vi.fn(async ({ data }) => { rows = data; }) } };
    const db = { $transaction: vi.fn(async run => run(tx)) } as unknown as PrismaClient;
    await seedKnowledgeFields(db);
    expect(rows).toHaveLength(110);
    const tree = fieldTree(rows);
    const names: string[] = [];
    const walk = (nodes: typeof tree, depth = 1) => { expect(depth).toBeLessThanOrEqual(3); for (const node of nodes) { names.push(node.name); if (node.children.length) walk(node.children, depth + 1); } };
    walk(tree);
    expect(new Set(names).size).toBe(110);
    expect(names).toEqual(expect.arrayContaining([...INITIAL_WORK_TYPES]));
    expect(tree.map(node => node.name)).toEqual(INITIAL_KNOWLEDGE_FIELDS.map(node => node.name));
    rows[0].active = false; const snapshot = JSON.stringify(rows);
    await seedKnowledgeFields(db);
    expect(JSON.stringify(rows)).toBe(snapshot); expect(tx.knowledgeField.createMany).toHaveBeenCalledOnce();
  });
  it('orders each level and rejects duplicate names, cycles and a fourth level', () => {
    expect(fieldTree([row('r2', '品質', null, 2), row('r1', '加工'), row('c', '切削', 'r1')]).map(node => node.name)).toEqual(['加工', '品質']);
    expect(() => fieldTree([row('1', '加工'), row('2', '加工')])).toThrow('INVALID_KNOWLEDGE_FIELD_TREE');
    expect(() => fieldTree([row('1', 'a', '2'), row('2', 'b', '1')])).toThrow('INVALID_KNOWLEDGE_FIELD_TREE');
    expect(() => fieldTree([row('1', 'a'), row('2', 'b', '1'), row('3', 'c', '2'), row('4', 'd', '3')])).toThrow('INVALID_KNOWLEDGE_FIELD_TREE');
  });
  it('accepts active names and resolves the top field, rejecting inactive and unknown names', async () => {
    const knowledgeField = { findMany: vi.fn().mockResolvedValue([row('r', '加工'), row('c', '切削', 'r'), row('g', '穴あけ・タップ', 'c')]) };
    const db = { knowledgeField } as unknown as PrismaClient;
    expect(await activeKnowledgeField(db, ' 穴あけ・タップ ')).toMatchObject({ field: { id: 'g' }, root: { name: '加工' } });
    await expect(activeKnowledgeField(db, '発明')).rejects.toThrow('UNKNOWN_KNOWLEDGE_FIELD');
    knowledgeField.findMany.mockResolvedValue([]);
    await expect(activeKnowledgeField(db, '加工')).rejects.toThrow('UNKNOWN_KNOWLEDGE_FIELD');
    expect(knowledgeField.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
  });
  it.each(['加工', '段取り', '検査・測定', '組立'])('requires approval for descendants of %s without weakening existing rules', root => {
    const header = { title: '対象｜穴あけ・タップ', category: '穴あけ・タップ', identifiers: {}, reviewTier: 'auto_publish' as const };
    expect(enforceReviewTier(header, 1, root)).toBe('approval_required');
  });
  it('publishes human-selected office knowledge unless its identifiers or words require approval', () => {
    const header = { title: '休暇｜各種申請', category: '各種申請', identifiers: {}, reviewTier: 'auto_publish' as const };
    expect(enforceReviewTier(header, 1, '事務・教育')).toBe('auto_publish');
    expect(enforceReviewTier({ ...header, identifiers: { partNumber: 'P-1' } }, 1, '事務・教育')).toBe('approval_required');
    expect(enforceReviewTier({ ...header, title: '寸法の記録' }, 1, '事務・教育')).toBe('approval_required');
  });
  it('normalizes the three title parts independently', () => {
    expect(topicIdentity({ target: ' Ｐ-Ａ ', workType: '段取り ', detail: ' ｸﾗﾝﾌﾟ ' })).toBe(topicIdentity({ target: 'p-a', workType: '段取り', detail: 'クランプ' }));
  });
});

it('applies field ancestry to the AI proposal before the poster sees its review tier', () => {
  const result = validateSuggestions({ candidates: [], confidence: 0.99, proposal: { target: '設備A', workType: 'NCプログラム', reviewTier: 'auto_publish' } },
    { materials: [], scannedPartNumber: null, topics: [], workTypes: ['NCプログラム', 'その他'], fieldRoots: { NCプログラム: '加工', その他: 'その他' } });
  expect(result.proposal?.reviewTier).toBe('approval_required');
});
