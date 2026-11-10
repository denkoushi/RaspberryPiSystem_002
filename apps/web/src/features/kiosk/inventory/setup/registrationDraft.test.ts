import { describe, expect, it } from 'vitest';

import { emptyDraft, registrationChecklist, TEXT_FIELDS, type Draft } from './registrationDraft';

import type { InventoryImport } from '../../../../api/client';

const candidate = { sourceItemId: 'A-0042' } as unknown as InventoryImport;
const draft = (partial: Partial<Draft>): Draft => ({ ...emptyDraft(null), ...partial });
const summarize = (d: Draft) => registrationChecklist(d).map(({ id, done, detail }) => ({ id, done, detail }));

describe('emptyDraft', () => {
  it('取込候補があれば仮名に元アイテムIDを入れ、それ以外は空で始める', () => {
    expect(emptyDraft(candidate)).toMatchObject({ mode: null, name: 'ItemlistRaspi A-0042', unit: null, quantity: '' });
    expect(emptyDraft(null).name).toBe('');
  });
});

describe('registrationChecklist', () => {
  it('未選択の新規登録は 新規/既存・置き場所・タグ・最初の数 が未完了', () => {
    expect(summarize(draft({ name: 'ドリル' }))).toEqual([
      { id: 'mode', done: false, detail: 'まだ' },
      { id: 'names', done: true, detail: 'ドリル' },
      { id: 'unit', done: true, detail: '個' },
      { id: 'place', done: false, detail: 'まだ' },
      { id: 'tag', done: false, detail: 'まだ' },
      { id: 'quantity', done: false, detail: 'まだ' },
    ]);
  });

  it('新規登録で全項目が揃えば全て完了し、数量に単位を付ける', () => {
    const items = summarize(
      draft({ mode: 'NEW_ITEM', unit: '本', drawerId: 'd1', drawerLabel: 'A棚 1段目', itemTagUid: '04AABB', quantity: '12' })
    );
    expect(items.every((item) => item.done)).toBe(true);
    expect(items.find((i) => i.id === 'mode')?.detail).toBe('新規');
    expect(items.find((i) => i.id === 'place')?.detail).toBe('A棚 1段目');
    expect(items.find((i) => i.id === 'tag')?.detail).toBe('読み取り済み');
    expect(items.find((i) => i.id === 'quantity')?.detail).toBe('12本');
  });

  it('数量 "0" は入力済み扱い、単位未設定なら 個 を補う', () => {
    const quantity = registrationChecklist(draft({ mode: 'NEW_ITEM', quantity: '0' })).find((i) => i.id === 'quantity');
    expect(quantity).toMatchObject({ done: true, detail: '0個' });
  });

  it('既存アイテムへの追加は追加先を選ぶまで未完了で、置き場所・タグ・数の項目を出さない', () => {
    expect(summarize(draft({ mode: 'EXISTING_ITEM' }))).toEqual([
      { id: 'mode', done: false, detail: '追加先を選ぶ' },
      { id: 'names', done: true, detail: '' },
      { id: 'unit', done: true, detail: '個' },
    ]);
    expect(summarize(draft({ mode: 'EXISTING_ITEM', itemId: 'item-1', itemName: '既存ドリル' }))[0]).toEqual({
      id: 'mode',
      done: true,
      detail: '既存ドリル',
    });
  });

  it('名前と単位は任意項目として印を付ける', () => {
    const optionalIds = registrationChecklist(draft({})).filter((i) => i.optional).map((i) => i.id);
    expect(optionalIds).toEqual(['names', 'unit']);
  });
});

describe('TEXT_FIELDS', () => {
  it('Draft のテキスト項目を重複なく網羅する', () => {
    const keys = TEXT_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(['maker', 'model', 'name', 'toolName', 'toolSize', 'usage', 'workMaterial']);
  });
});
