import { inventoryThumbnailUrl, type InventoryImport, type InventoryItem, type InventoryToolFieldSuggestion } from '../../../../api/client';
import { ChevronDownIcon } from '../InventoryIcons';
import { invButtonSm, invField, invLabel, invSeg } from '../inventoryUi';

import { InventoryUnitPicker } from './InventoryUnitPicker';
import { TEXT_FIELDS, type Draft } from './registrationDraft';
import { Row } from './RegistrationRowParts';

import type { Dispatch, SetStateAction } from 'react';

type RegistrationDetailsProps = {
  accessPassword: string;
  candidate: InventoryImport;
  draft: Draft;
  selectedItem: InventoryItem | undefined;
  modeNumber: number;
  namesNumber: number;
  unitNumber: number;
  isDone: (id: string) => boolean;
  currentId: string | null;
  chooseNew: () => void;
  update: (patch: Partial<Draft>) => void;
  reading: boolean;
  readPhoto: () => Promise<void>;
  optionsOpen: boolean;
  setOptionsOpen: Dispatch<SetStateAction<boolean>>;
  visibleSuggestion: InventoryToolFieldSuggestion | null;
  suggestionFailed: boolean | null;
};

export function RegistrationDetails({
  accessPassword, candidate, draft, selectedItem, modeNumber, namesNumber, unitNumber,
  isDone, currentId, chooseNew, update, reading, readPhoto, optionsOpen, setOptionsOpen,
  visibleSuggestion, suggestionFailed,
}: RegistrationDetailsProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <Row id="mode" number={modeNumber} title="新規か既存か" done={isDone('mode')} current={currentId === 'mode'}>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={draft.mode === 'NEW_ITEM'} className={invSeg(draft.mode === 'NEW_ITEM')} onClick={chooseNew}>新規登録</button>
          <button type="button" aria-pressed={draft.mode === 'EXISTING_ITEM'} className={invSeg(draft.mode === 'EXISTING_ITEM')} onClick={() => update({ mode: 'EXISTING_ITEM', shelfId: '', drawerId: '', drawerLabel: '', itemTagUid: '', quantity: '' })}>既存のアイテムに写真を追加</button>
        </div>
        {draft.mode === 'EXISTING_ITEM' ? (
          draft.itemId ? <div className="mt-2 flex h-16 items-center gap-2.5 rounded-xl border-2 border-inv-cyan bg-inv-cyan/[0.12] px-2.5">
            {selectedItem?.photos[0] ? <img loading="lazy" decoding="async" src={inventoryThumbnailUrl(selectedItem.photos[0].photoUrl)} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <span className="h-12 w-12 shrink-0 rounded-lg bg-inv-s3" aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate text-base font-black">{draft.itemName}</span>
            <span className="shrink-0 text-[13px] text-inv-muted">追加先</span>
          </div> : <div className="mt-2 flex h-16 items-center rounded-xl border border-dashed border-inv-cyan px-3.5 text-base font-bold text-inv-cyan">→ 右の一覧から追加先を選ぶ</div>
        ) : null}
      </Row>

      <Row
        id="names"
        number={namesNumber}
        title="名前・工具情報"
        done={isDone('names')}
        current={false}
        bounded
        aside={<div className="flex gap-2"><button type="button" className={invButtonSm} disabled={reading || !candidate.photos.length} onClick={() => void readPhoto()}>{reading ? '読み取り中…' : '写真から読む'}</button><button type="button" aria-expanded={optionsOpen} className={`${invButtonSm} self-start border-inv-cyan bg-inv-cyan/[0.12] text-[#dff8ff] hover:bg-inv-cyan/20`} onClick={() => setOptionsOpen((open) => !open)}><ChevronDownIcon />登録済みから選ぶ</button></div>}
      >
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-x-3 gap-y-2 overflow-y-auto">
          {TEXT_FIELDS.map((field) => (
            <div key={field.key} className={`flex min-w-0 flex-col gap-1 ${field.key === 'name' ? 'col-span-2' : ''}`}>
              <span className={invLabel}>{field.label}</span>
              <input aria-label={field.aria ?? field.label} placeholder={field.key === 'name' ? undefined : '省略可'} className={`${invField} h-11 w-full`} value={draft[field.key]} onChange={(event) => update({ [field.key]: event.target.value } as Partial<Draft>)} />
              {(field.key === 'model' || field.key === 'maker') && visibleSuggestion?.[field.key].length ? <div className="flex h-11 shrink-0 gap-1.5 overflow-x-auto" role="group" aria-label={`${field.label}の読取候補`}>
                {visibleSuggestion[field.key].map((value) => <button key={value} type="button" aria-pressed={draft[field.key] === value} className={`${invSeg(draft[field.key] === value)} h-11 shrink-0 whitespace-nowrap font-mono`} onClick={() => update({ [field.key]: value })}>{value}</button>)}
              </div> : null}
            </div>
          ))}
        </div>
        {suggestionFailed ? <p role="status" className="shrink-0 text-sm text-inv-red">読み取れませんでした</p> : null}
      </Row>

      <Row id="unit" number={unitNumber} title="単位" done current={false}>
        <div className="max-h-36 overflow-y-auto">
        <InventoryUnitPicker value={draft.unit} onChange={(unit) => update({ unit })} accessPassword={accessPassword} />
        </div>
      </Row>

    </div>
  );
}
