import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';

import { useSites, useProductionScheduleSameModelResourceGroups, useUpdateProductionScheduleSameModelResourceGroups } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export function ProductionScheduleSameModelResourceGroupsCard() {
  const sitesQuery = useSites();
  const sites = (sitesQuery.data ?? []).filter((site) => site.key !== 'shared');
  const [selectedSite, setSelectedSite] = useState('');
  const location = sites.find((site) => site.key === selectedSite)?.key ?? sites[0]?.key ?? '';
  const query = useProductionScheduleSameModelResourceGroups(location);
  const mutation = useUpdateProductionScheduleSameModelResourceGroups();
  const [groups, setGroups] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setGroups(query.data?.groups.map((group) => group.resourceCds) ?? []); setError(null); }, [query.data, location]);
  const resources = query.data?.resources ?? [];
  const used = new Set(groups.flat());
  const busy = !location || query.isFetching || mutation.isPending || !query.data;
  const change = (index: number, members: string[]) => setGroups((previous) => previous.map((group, i) => i === index ? members : group));
  const save = async () => {
    if (!location) return;
    if (groups.some((group) => group.length < 2)) { setError('組には機械を2台以上入れてください'); return; }
    setError(null);
    try { await mutation.mutateAsync({ location, groups: groups.map((resourceCds) => ({ resourceCds })) }); }
    catch (cause) {
      if (isAxiosError(cause) && cause.response?.status === 409) {
        setError(`品番の値が食い違っています: ${(cause.response.data?.details?.fhincds ?? []).join('、')}`);
      } else setError('保存できませんでした');
    }
  };
  return <Card title="同型機の組"><div className="space-y-3">
    <div className="flex items-center gap-2"><label htmlFor="same-model-location" className="text-sm">工場</label>
      <select id="same-model-location" value={location} disabled={mutation.isPending || !sites.length} onChange={(event) => setSelectedSite(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
        {sites.map((site) => <option key={site.key} value={site.key}>{site.displayName}</option>)}
      </select></div>
    {groups.map((group, index) => <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 p-2">
      {group.map((cd) => <span key={cd} className="inline-flex items-center gap-2 rounded-full border border-slate-300 py-1 pl-3 pr-2 text-sm">
        <b className="font-mono">{cd}</b>{resources.find((resource) => resource.resourceCd === cd)?.resourceName}
        <button type="button" aria-label={`${cd}を外す`} disabled={busy} onClick={() => change(index, group.filter((value) => value !== cd))}>×</button>
      </span>)}
      <select aria-label={`${index + 1}組に機械を追加`} value="" disabled={busy} onChange={(event) => { if (event.target.value) change(index, [...group, event.target.value]); }} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
        <option value="">＋機械</option>{resources.filter((resource) => !used.has(resource.resourceCd)).map((resource) => <option key={resource.resourceCd} value={resource.resourceCd}>{resource.resourceCd} {resource.resourceName}</option>)}
      </select>
      <Button type="button" variant="danger" className="ml-auto" disabled={busy} onClick={() => setGroups(groups.filter((_, i) => i !== index))}>削除</Button>
    </div>)}
    {(error || query.isError || sitesQuery.isError) && <p role="alert" className="text-sm text-rose-600">{error ?? '読み込めませんでした'}</p>}
    <div className="flex gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setGroups([...groups, []])}>組を追加</Button><Button type="button" disabled={busy} onClick={() => void save()}>保存</Button></div>
  </div></Card>;
}
