import { afterEach, describe, expect, it, vi } from 'vitest';

import { masterNamesSubjectResolver, PrismaSubjectResolver, type MasterNames } from './kiosk-operation-guide-subject.js';

vi.mock('../../config/env.js', () => ({ env: {} }));
vi.mock('../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('masterNamesSubjectResolver', () => {
  const names: MasterNames = {
    inventoryItems: ['超硬チップ CNMG120408'], tools: ['ハンマー'],
    instruments: ['デジタルノギス'], riggingGear: ['シャックル']
  };

  it.each([
    [['チップ'], ['inventory']], [['ノギス'], ['instrument']],
    [['シャックル'], ['rigging']], [['ハンマー'], ['tool']],
    [[], []], [['超'], []], [['超', '登録'], []]
  ])('resolves %j from master names', (terms, expected) => {
    expect(masterNamesSubjectResolver(names)(terms)).toEqual(expected);
  });

  it('normalizes names and terms and returns a deduplicated union in family order', () => {
    const resolve = masterNamesSubjectResolver({
      inventoryItems: ['ＡＢＣ １２'], tools: ['abc12'], instruments: ['ABC12'], riggingGear: ['abc12']
    });
    expect(resolve(['ＡＢＣ', '１２', '登録'])).toEqual(['inventory', 'tool', 'instrument', 'rigging']);
  });
});

function fakeClient() {
  return {
    inventoryItem: { findFirst: vi.fn().mockResolvedValue(null) },
    item: { findFirst: vi.fn().mockResolvedValue(null) },
    measuringInstrument: { findFirst: vi.fn().mockResolvedValue(null) },
    riggingGear: { findFirst: vi.fn().mockResolvedValue(null) }
  };
}

describe('PrismaSubjectResolver', () => {
  it('queries each model for each term and maps hits to a fixed-order union', async () => {
    const db = fakeClient();
    db.inventoryItem.findFirst.mockResolvedValue({ id: 'inventory' });
    db.item.findFirst.mockResolvedValue({ id: 'tool' });
    db.measuringInstrument.findFirst.mockResolvedValue({ id: 'instrument' });
    db.riggingGear.findFirst.mockResolvedValue({ id: 'rigging' });
    const resolver = new PrismaSubjectResolver(db as never);
    expect(await resolver.resolve(['チップ', '登録'])).toEqual(['inventory', 'tool', 'instrument', 'rigging']);
    for (const model of Object.values(db)) {
      expect(model.findFirst.mock.calls).toEqual(['チップ', '登録'].map((term) => [{
        where: { name: { contains: term, mode: 'insensitive' } }, select: { id: true }
      }]));
    }
  });

  it('caches hits and misses by normalized term for ten minutes', async () => {
    vi.useFakeTimers();
    const db = fakeClient();
    db.measuringInstrument.findFirst.mockResolvedValue({ id: 'instrument' });
    const resolver = new PrismaSubjectResolver(db as never);
    expect(await resolver.resolve(['ＡＢＣ'])).toEqual(['instrument']);
    expect(await resolver.resolve(['abc'])).toEqual(['instrument']);
    for (const model of Object.values(db)) expect(model.findFirst).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10 * 60 * 1000);
    await resolver.resolve(['abc']);
    for (const model of Object.values(db)) expect(model.findFirst).toHaveBeenCalledTimes(2);
  });

  it('drops the oldest cached term when the 500-entry bound is exceeded', async () => {
    const db = fakeClient();
    const resolver = new PrismaSubjectResolver(db as never);
    for (let index = 0; index <= 500; index++) await resolver.resolve([`part${index}`]);
    await resolver.resolve(['part1']);
    for (const model of Object.values(db)) expect(model.findFirst).toHaveBeenCalledTimes(501);
    await resolver.resolve(['part0']);
    for (const model of Object.values(db)) expect(model.findFirst).toHaveBeenCalledTimes(502);
  });

  it('ignores terms shorter than two characters', async () => {
    const db = fakeClient();
    expect(await new PrismaSubjectResolver(db as never).resolve(['超'])).toEqual([]);
    for (const model of Object.values(db)) expect(model.findFirst).not.toHaveBeenCalled();
  });

  it('returns no families on any DB error and warns only once', async () => {
    const db = fakeClient();
    db.inventoryItem.findFirst.mockResolvedValue({ id: 'inventory' });
    db.item.findFirst.mockRejectedValue(new Error('unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolver = new PrismaSubjectResolver(db as never);
    expect(await resolver.resolve(['チップ', '登録'])).toEqual([]);
    expect(await resolver.resolve(['ノギス'])).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
