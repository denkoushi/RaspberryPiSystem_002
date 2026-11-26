import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getMobilePlacementResourceShelves, replaceMobilePlacementResourceShelves } from '../../../../api/domains/mobile-placement';
import { Dialog } from '../../../../components/ui/Dialog';
import { useLocalStorage } from '../../../../hooks/useLocalStorage';
import { invButton, invButtonPrimary, invSeg, invTitle } from '../../../kiosk/inventory/inventoryUi';
import { mobileRequest } from '../../connectivity';
import { HaizenHeader } from '../../haizen/HaizenHeader';
import { HaizenShelfPhotoTile } from '../../haizen/HaizenShelfPhotoPicker';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';
import { refreshRegisteredShelvesAfterAssignment } from '../../shelfListCache';
import { hp } from '../../ui/haizenPhoneTokens';
import { useRegisteredShelves } from '../../useRegisteredShelves';

import type { ResourceFactory, ResourceShelfAssignment } from '../../../../api/domains/mobile-placement';
import type { RegisteredShelfEntryDto } from '../../registeredShelves';

const resourceShelvesKey = [...mobilePlacementQueryKeys.all, 'resource-shelves'] as const;
const factories: [ResourceFactory, string][] = [['MISHIMA', '三島工場'], ['SENDAI', '仙台工場']];

function useResourceShelfSettings(kiosk: boolean) {
  const client = useQueryClient();
  const shelves = useRegisteredShelves();
  const query = useQuery({
    queryKey: resourceShelvesKey,
    // The kiosk is wired; the phone's unreachable latch would otherwise stick until reload.
    queryFn: () => kiosk ? getMobilePlacementResourceShelves() : mobileRequest(getMobilePlacementResourceShelves),
    networkMode: 'always', retry: false
  });
  const [storedFactory, setFactory] = useLocalStorage<ResourceFactory>('mobile-placement-resource-shelf-factory', 'MISHIMA');
  const factory: ResourceFactory = storedFactory === 'SENDAI' ? 'SENDAI' : 'MISHIMA';
  const resources = (query.data?.resources ?? []).filter((resource) => resource.factory === factory);
  const [resourceCd, setResourceCd] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const selected = resources.find((resource) => resource.resourceCd === resourceCd) ?? (kiosk ? resources[0] : undefined);
  const codes = draft ?? selected?.shelfCodes ?? [];
  const save = useMutation({
    networkMode: 'always',
    mutationFn: async ({ resourceCd, shelfCodes }: Pick<ResourceShelfAssignment, 'resourceCd' | 'shelfCodes'>) => {
      if (!shelves.data) throw new Error('棚を取得できませんでした');
      const assignment = await replaceMobilePlacementResourceShelves(resourceCd, shelfCodes);
      const key = mobilePlacementQueryKeys.registeredShelves;
      await client.cancelQueries({ queryKey: key });
      const current = client.getQueryData<typeof shelves.data>(key) ?? shelves.data;
      const refreshed = await refreshRegisteredShelvesAfterAssignment(current, assignment.resourceCd, assignment.shelfCodes);
      client.setQueryData(key, refreshed);
      return assignment;
    },
    onSuccess: (assignment) => {
      client.setQueryData<typeof query.data>(resourceShelvesKey, (data) => data && ({
        resources: data.resources.map((resource) => resource.resourceCd === assignment.resourceCd ? { ...resource, ...assignment } : resource)
      }));
      setDraft(null);
      if (!kiosk) setResourceCd(null);
    }
  });
  const select = (cd: string | null) => { save.reset(); setResourceCd(cd); setDraft(null); };
  const groups = new Map<string | undefined, RegisteredShelfEntryDto[]>();
  for (const shelf of shelves.data?.shelves ?? []) {
    const group = groups.get(shelf.machineName) ?? [];
    group.push(shelf);
    groups.set(shelf.machineName, group);
  }
  return {
    resources, selected, codes, groups, select, factory,
    selectFactory: (value: ResourceFactory) => { select(null); setFactory(value); },
    toggle: (code: string) => { save.reset(); setDraft(codes.includes(code) ? codes.filter((value) => value !== code) : [...codes, code]); },
    save: () => { if (selected) save.mutate({ resourceCd: selected.resourceCd, shelfCodes: codes }); },
    busy: save.isPending, saved: save.isSuccess, saveError: save.isError,
    canSave: Boolean(selected && shelves.data && !save.isPending),
    loading: query.isPending || shelves.isLoading, loadError: query.isError || shelves.isError,
    retry: () => { void query.refetch(); void shelves.refetch(); }
  };
}

type Settings = ReturnType<typeof useResourceShelfSettings>;

function FactorySwitch({ settings: s, kiosk = false }: { settings: Settings; kiosk?: boolean }) {
  return <div className="flex shrink-0 gap-1.5">
    {factories.map(([value, label]) => <button key={value} type="button" aria-pressed={s.factory === value} disabled={s.busy}
      className={kiosk ? invSeg(s.factory === value) : hp.segment} onClick={() => s.selectFactory(value)}>{label}</button>)}
  </div>;
}

function ResourceRows({ settings: s, kiosk = false }: { settings: Settings; kiosk?: boolean }) {
  if (s.loadError) return <p role="alert">資源CDと棚を取得できません <button type="button" className={kiosk ? invButton : hp.mini} onClick={s.retry}>再試行</button></p>;
  if (s.loading) return <p role="status">読込中…</p>;
  if (!s.resources.length) return <p>資源CDがありません</p>;
  return s.resources.map((resource) => <button key={resource.resourceCd} type="button"
    disabled={s.busy} aria-pressed={kiosk ? resource.resourceCd === s.selected?.resourceCd : undefined}
    className={`flex shrink-0 items-center text-left disabled:opacity-50 ${kiosk
      ? 'min-h-11 gap-2 rounded-[10px] border border-inv-line bg-inv-s2 px-2.5 py-1 aria-pressed:border-inv-cyan aria-pressed:bg-inv-cyan/10'
      : 'min-h-12 gap-2.5 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] px-3 py-2'}`}
    onClick={() => s.select(resource.resourceCd)}>
    <strong className={`shrink-0 font-mono ${kiosk ? 'min-w-11 whitespace-nowrap text-lg' : 'w-14 break-all text-xl'}`}>{resource.resourceCd}</strong>
    <span className={`min-w-0 flex-1 font-bold ${kiosk ? 'truncate text-sm leading-tight' : ''}`}>{resource.resourceNames.join('・')}
      <small className={`block ${kiosk ? 'truncate text-xs' : 'break-words'} ${resource.shelfCodes.length ? kiosk ? 'text-inv-amber' : 'text-[var(--hp-shelf)]' : kiosk ? 'text-inv-muted' : hp.muted}`}>
        {resource.shelfCodes.join('・') || '棚なし'}
      </small>
    </span>
    {!kiosk && <span aria-hidden className={`text-xl ${hp.muted}`}>›</span>}
  </button>);
}

function ShelfGroups({ settings: s, kiosk = false }: { settings: Settings; kiosk?: boolean }) {
  if (!s.selected) return null;
  if (!s.groups.size) return <p>棚がありません</p>;
  return [...s.groups].map(([machineName, shelves]) => <section key={machineName ?? ''} className={kiosk ? 'flex items-start gap-2' : undefined}>
    <h3 className={`font-mono text-sm font-bold ${kiosk ? 'w-40 shrink-0 break-words pt-2 leading-tight text-inv-muted' : `mb-1 ${hp.muted}`}`}>{machineName ?? 'その他'}</h3>
    <div className={kiosk ? 'flex min-w-0 flex-1 flex-wrap gap-1.5' : 'grid grid-cols-2 gap-2'}>
      {shelves.map((shelf) => {
        const selected = s.codes.includes(shelf.shelfCodeRaw);
        const toggle = () => s.toggle(shelf.shelfCodeRaw);
        return kiosk
          ? <button key={shelf.shelfCodeRaw} type="button" className={`${invSeg(selected)} !h-9 !px-3`} aria-pressed={selected} disabled={s.busy}
            aria-label={shelf.shelfCodeRaw} onClick={toggle}>{machineName && shelf.direction ? shelf.direction : shelf.shelfCodeRaw}</button>
          : <HaizenShelfPhotoTile key={shelf.shelfCodeRaw} shelf={shelf} compact selected={selected} disabled={s.busy} onClick={toggle} />;
      })}
    </div>
  </section>);
}

export function ResourceShelfPhoneSettings({ onClose }: { onClose: () => void }) {
  const s = useResourceShelfSettings(false);
  const back = () => { if (!s.busy) s.selected ? s.select(null) : onClose(); };
  return <>
    <div className="shrink-0 [&_h1]:min-w-0 [&_h1]:!shrink [&_h1]:truncate">
      <HaizenHeader title={s.selected ? `${s.selected.resourceCd} ${s.selected.resourceNames.join('・')}` : '資源CDと棚'} onBack={back} />
    </div>
    {!s.selected && <div className="shrink-0 px-3.5 pb-1"><FactorySwitch settings={s} /></div>}
    <div className={hp.list} key={s.selected?.resourceCd}>
      {s.selected ? <ShelfGroups settings={s} /> : <ResourceRows settings={s} />}
    </div>
    {s.selected && <>
      {s.saveError && <p role="alert" className="px-3.5 text-[var(--hp-ng)]">保存できませんでした</p>}
      <footer className={hp.dock}>
        <button type="button" className={`${hp.segment} !h-14 flex-1`} disabled={s.busy} onClick={back}>やめる</button>
        <button type="button" className={`${hp.bottomPrimary} !h-14 bg-[var(--hp-shelf)]`} disabled={!s.canSave} onClick={s.save}>保存</button>
      </footer>
    </>}
  </>;
}

export function ResourceShelfKioskDialog({ onClose }: { onClose: () => void }) {
  const s = useResourceShelfSettings(true);
  return <Dialog isOpen ariaLabel="資源CDと棚" size="full" onClose={() => { if (!s.busy) onClose(); }}
    overlayClassName="!items-center" className="!my-0 !flex h-[calc(100vh-2rem)] !max-h-none flex-col gap-3.5 !border-inv-line2 !bg-inv-s1 !text-inv-text">
    <header className="flex shrink-0 items-center gap-2">
      <h2 className={`${invTitle} mr-auto`}>資源CDと棚</h2>
      <FactorySwitch settings={s} kiosk />
      <button type="button" className={invButton} disabled={s.busy} onClick={onClose}>閉じる</button>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_28rem] gap-4">
      <div className="grid min-h-0 auto-rows-min grid-cols-[repeat(auto-fill,minmax(190px,1fr))] content-start gap-1 overflow-y-auto"><ResourceRows settings={s} kiosk /></div>
      <div key={s.selected?.resourceCd} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto border-l border-inv-line pl-4"><ShelfGroups settings={s} kiosk /></div>
    </div>
    <footer className="flex shrink-0 items-center justify-end gap-2">
      {s.saveError && <p role="alert" className="text-inv-red">保存できませんでした</p>}
      {s.saved && <p role="status" className="text-inv-green">✓ 保存しました</p>}
      <button type="button" className={invButton} disabled={!s.canSave} onClick={() => s.select(s.selected?.resourceCd ?? null)}>元に戻す</button>
      <button type="button" className={invButtonPrimary} disabled={!s.canSave} onClick={s.save}>保存</button>
    </footer>
  </Dialog>;
}
