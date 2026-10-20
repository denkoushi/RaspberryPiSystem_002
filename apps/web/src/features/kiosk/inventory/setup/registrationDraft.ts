import type { InventoryImport } from '../../../../api/client';

export type Draft = {
  mode: 'NEW_ITEM' | 'EXISTING_ITEM' | null;
  itemId: string;
  itemName: string;
  name: string;
  model: string;
  usage: string;
  unit: string | null;
  maker: string;
  toolName: string;
  workMaterial: string;
  toolSize: string;
  /** Shelf area chosen for this item, "<machine> <direction>". */
  area: string;
  shelfId: string;
  drawerId: string;
  drawerLabel: string;
  itemTagUid: string;
  manualUid: string;
  quantity: string;
};

type CheckItem = { id: string; label: string; done: boolean; detail: string; optional?: boolean };

export const QUANTITY_MAX_DIGITS = 6;

export function emptyDraft(candidate: InventoryImport | null): Draft {
  return {
    mode: null,
    itemId: '',
    itemName: '',
    name: candidate ? `ItemlistRaspi ${candidate.sourceItemId}` : '',
    model: '',
    usage: '',
    unit: null,
    maker: '',
    toolName: '',
    workMaterial: '',
    toolSize: '',
    area: '',
    shelfId: '',
    drawerId: '',
    drawerLabel: '',
    itemTagUid: '',
    manualUid: '',
    quantity: '',
  };
}

/** What is done and what is left, in the order a worker does it. */
export function registrationChecklist(draft: Draft): CheckItem[] {
  const items: CheckItem[] = [
    {
      id: 'mode',
      label: '新規か既存か',
      done: draft.mode === 'NEW_ITEM' || (draft.mode === 'EXISTING_ITEM' && Boolean(draft.itemId)),
      detail: draft.mode === 'NEW_ITEM' ? '新規' : draft.mode === 'EXISTING_ITEM' ? (draft.itemId ? draft.itemName : '追加先を選ぶ') : 'まだ',
    },
    { id: 'names', label: '名前・工具情報', done: true, optional: true, detail: draft.name },
    { id: 'unit', label: '単位', done: true, optional: true, detail: draft.unit || '個' },
  ];
  if (draft.mode === 'EXISTING_ITEM') return items;
  return [
    ...items,
    { id: 'place', label: '置き場所', done: Boolean(draft.drawerId), detail: draft.drawerId ? draft.drawerLabel : 'まだ' },
    { id: 'tag', label: 'アイテムタグ', done: Boolean(draft.itemTagUid), detail: draft.itemTagUid ? '読み取り済み' : 'まだ' },
    { id: 'quantity', label: '最初の数', done: draft.quantity !== '', detail: draft.quantity !== '' ? `${draft.quantity}${draft.unit || '個'}` : 'まだ' },
  ];
}

type TextFieldKey = 'name' | 'model' | 'usage' | 'maker' | 'toolName' | 'workMaterial' | 'toolSize';
export const TEXT_FIELDS: Array<{ key: TextFieldKey; label: string; aria?: string }> = [
  { key: 'name', label: '名前', aria: 'アイテム名' },
  { key: 'model', label: '型式' },
  { key: 'maker', label: 'メーカー' },
  { key: 'toolName', label: '工具名' },
  { key: 'workMaterial', label: '被削材' },
  { key: 'toolSize', label: '工具寸法' },
  { key: 'usage', label: '用途' },
];
export type RegistrationState = {
  selectedId: string | null;
  draft: Draft | null;
  completed?: { candidateId: string; labelNumber?: number; name: string; location: string };
};

