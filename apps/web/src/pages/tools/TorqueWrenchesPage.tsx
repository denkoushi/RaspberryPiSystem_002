import { TORQUE_WRENCH_STORAGE_LOCATIONS, type TorqueWrenchStorageLocation } from '@raspi-system/shared-types';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import {
  addTorqueWrenchSetting,
  createTorqueWrench,
  createTorqueWrenchCapabilityGroup,
  createTorqueWrenchModel,
  listTorqueWrenchCapabilityGroups,
  listTorqueWrenchModels,
  listTorqueWrenches,
  updateTorqueWrench,
  updateTorqueWrenchCapabilityGroup,
  updateTorqueWrenchModel,
  type TorqueWrenchCapabilityGroupApi,
  type TorqueWrenchModelApi,
  type TorqueWrenchProfileApi
} from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

type Tab = 'wrenches' | 'models' | 'groups';

function Field(props: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-xs font-semibold text-white/70"><span>{props.label}</span>{props.children}</label>;
}

function calibrationLabel(value: string | null) {
  if (!value) return '未登録';
  return new Date(value).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export function TorqueWrenchesPage() {
  const [tab, setTab] = useState<Tab>('wrenches');
  const [models, setModels] = useState<TorqueWrenchModelApi[]>([]);
  const [wrenches, setWrenches] = useState<TorqueWrenchProfileApi[]>([]);
  const [groups, setGroups] = useState<TorqueWrenchCapabilityGroupApi[]>([]);
  const [selectedWrenchId, setSelectedWrenchId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [modelForm, setModelForm] = useState({ manufacturer: '', modelNumber: '', min: '', max: '', resolution: '' });
  const [wrenchForm, setWrenchForm] = useState({
    name: '', managementNumber: '', modelId: '', serialNumber: '', storageLocation: 'TalkPlazaF1' as TorqueWrenchStorageLocation,
    calibrationExpiryDate: ''
  });
  const [settingForm, setSettingForm] = useState({ lower: '', nominal: '', upper: '', unit: 'N·m', reason: '' });
  const [groupForm, setGroupForm] = useState({
    name: '', nominalDiameter: '', boltLengthMm: '', material: '', strengthClass: '', modelIds: [] as string[]
  });

  const reload = useCallback(async () => {
    const [nextModels, nextWrenches, nextGroups] = await Promise.all([
      listTorqueWrenchModels(true), listTorqueWrenches(true), listTorqueWrenchCapabilityGroups(true)
    ]);
    setModels(nextModels);
    setWrenches(nextWrenches);
    setGroups(nextGroups);
    setWrenchForm((current) => ({ ...current, modelId: current.modelId || nextModels.find((model) => model.isActive)?.id || '' }));
  }, []);

  useEffect(() => {
    void reload().catch((error) => setMessage(error instanceof Error ? error.message : 'トルクレンチマスターを取得できませんでした'));
  }, [reload]);

  const selectedWrench = useMemo(
    () => wrenches.find((wrench) => wrench.id === selectedWrenchId) ?? null,
    [selectedWrenchId, wrenches]
  );

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await reload();
      setMessage(success);
    } catch (error) {
      setMessage(getApiErrorMessage(error, '保存に失敗しました'));
    } finally {
      setBusy(false);
    }
  };

  const submitModel = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => createTorqueWrenchModel({
        manufacturer: modelForm.manufacturer,
        modelNumber: modelForm.modelNumber,
        torqueMinNm: Number(modelForm.min),
        torqueMaxNm: Number(modelForm.max),
        resolutionNm: modelForm.resolution ? Number(modelForm.resolution) : null
      }),
      '型番を登録しました。'
    );
  };

  const submitWrench = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => createTorqueWrench({
        ...wrenchForm,
        calibrationExpiryDate: wrenchForm.calibrationExpiryDate || null
      }),
      '物理トルクレンチを登録しました。'
    );
  };

  const submitSetting = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedWrench) return;
    void run(
      () => addTorqueWrenchSetting(selectedWrench.id, {
        lowerLimit: Number(settingForm.lower), nominalTorque: Number(settingForm.nominal), upperLimit: Number(settingForm.upper),
        unit: settingForm.unit, reason: settingForm.reason || null
      }),
      '設定履歴を追加しました。'
    );
  };

  const submitGroup = (event: FormEvent) => {
    event.preventDefault();
    void run(
      () => createTorqueWrenchCapabilityGroup({
        name: groupForm.name,
        nominalDiameter: groupForm.nominalDiameter,
        boltLengthMm: Number(groupForm.boltLengthMm),
        material: groupForm.material,
        strengthClass: groupForm.strengthClass,
        modelIds: groupForm.modelIds
      }),
      '適合グループを登録しました。'
    );
  };

  return (
    <div className="mx-auto grid w-full max-w-screen-2xl gap-4 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">トルクレンチ管理</h1><p className="text-sm text-white/60">型番・物理製造番号・校正・現在設定・適合条件を管理します。</p></div>
        <div className="flex gap-2">
          {([['wrenches', '物理レンチ'], ['models', '型番'], ['groups', '適合グループ']] as const).map(([value, label]) => (
            <Button key={value} type="button" variant={tab === value ? 'primary' : 'ghostOnDark'} onClick={() => setTab(value)}>{label}</Button>
          ))}
        </div>
      </div>
      {message ? <div className="rounded border border-cyan-300/30 bg-cyan-950/30 px-3 py-2 text-sm">{message}</div> : null}

      {tab === 'models' ? (
        <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
          <form className="grid content-start gap-3 rounded border border-white/15 bg-slate-900/70 p-4" onSubmit={submitModel}>
            <h2 className="font-bold">型番を追加</h2>
            <Field label="メーカー"><Input required value={modelForm.manufacturer} onChange={(e) => setModelForm({ ...modelForm, manufacturer: e.target.value })} /></Field>
            <Field label="型番"><Input required value={modelForm.modelNumber} onChange={(e) => setModelForm({ ...modelForm, modelNumber: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="最小 N·m"><Input required type="number" step="any" value={modelForm.min} onChange={(e) => setModelForm({ ...modelForm, min: e.target.value })} /></Field>
              <Field label="最大 N·m"><Input required type="number" step="any" value={modelForm.max} onChange={(e) => setModelForm({ ...modelForm, max: e.target.value })} /></Field>
            </div>
            <Field label="分解能 N·m"><Input type="number" step="any" value={modelForm.resolution} onChange={(e) => setModelForm({ ...modelForm, resolution: e.target.value })} /></Field>
            <Button type="submit" variant="primary" disabled={busy}>登録</Button>
          </form>
          <div className="overflow-x-auto rounded border border-white/15 bg-slate-900/70"><table className="w-full text-sm"><thead className="bg-white/10"><tr><th className="p-3 text-left">メーカー</th><th className="p-3 text-left">型番</th><th className="p-3">測定範囲 N·m</th><th className="p-3">状態</th></tr></thead><tbody>{models.map((model) => <tr key={model.id} className="border-t border-white/10"><td className="p-3">{model.manufacturer}</td><td className="p-3 font-semibold">{model.modelNumber}</td><td className="p-3 text-center">{model.torqueMinNm}–{model.torqueMaxNm}</td><td className="p-3 text-center"><Button type="button" className="px-2 py-1 text-xs" variant={model.isActive ? 'danger' : 'secondary'} disabled={busy} onClick={() => void run(() => updateTorqueWrenchModel(model.id, { isActive: !model.isActive }), model.isActive ? '型番を利用停止しました。' : '型番を再開しました。')}>{model.isActive ? '利用停止' : '再開'}</Button></td></tr>)}</tbody></table></div>
        </div>
      ) : null}

      {tab === 'wrenches' ? (
        <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
          <div className="grid content-start gap-4">
            <form className="grid gap-3 rounded border border-white/15 bg-slate-900/70 p-4" onSubmit={submitWrench}>
              <h2 className="font-bold">物理レンチを追加</h2>
              <Field label="名称"><Input required value={wrenchForm.name} onChange={(e) => setWrenchForm({ ...wrenchForm, name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="管理番号"><Input required value={wrenchForm.managementNumber} onChange={(e) => setWrenchForm({ ...wrenchForm, managementNumber: e.target.value })} /></Field><Field label="製造番号"><Input required value={wrenchForm.serialNumber} onChange={(e) => setWrenchForm({ ...wrenchForm, serialNumber: e.target.value })} /></Field></div>
              <Field label="型番"><select className="min-h-10 rounded bg-slate-950 px-2" required value={wrenchForm.modelId} onChange={(e) => setWrenchForm({ ...wrenchForm, modelId: e.target.value })}>{models.filter((model) => model.isActive).map((model) => <option key={model.id} value={model.id}>{model.manufacturer} {model.modelNumber}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="保管場所"><select className="min-h-10 rounded bg-slate-950 px-2" value={wrenchForm.storageLocation} onChange={(e) => setWrenchForm({ ...wrenchForm, storageLocation: e.target.value as TorqueWrenchStorageLocation })}>{TORQUE_WRENCH_STORAGE_LOCATIONS.map((location) => <option key={location}>{location}</option>)}</select></Field><Field label="校正期限"><Input type="date" value={wrenchForm.calibrationExpiryDate} onChange={(e) => setWrenchForm({ ...wrenchForm, calibrationExpiryDate: e.target.value })} /></Field></div>
              <Button type="submit" variant="primary" disabled={busy || !wrenchForm.modelId}>登録</Button>
            </form>
            {selectedWrench ? <form className="grid gap-3 rounded border border-cyan-300/30 bg-cyan-950/20 p-4" onSubmit={submitSetting}><h2 className="font-bold">設定履歴を追加</h2><p className="text-xs text-white/60">{selectedWrench.serialNumber}（履歴は上書きされません）</p><div className="grid grid-cols-3 gap-2"><Field label="下限"><Input required type="number" step="any" value={settingForm.lower} onChange={(e) => setSettingForm({ ...settingForm, lower: e.target.value })} /></Field><Field label="規定"><Input required type="number" step="any" value={settingForm.nominal} onChange={(e) => setSettingForm({ ...settingForm, nominal: e.target.value })} /></Field><Field label="上限"><Input required type="number" step="any" value={settingForm.upper} onChange={(e) => setSettingForm({ ...settingForm, upper: e.target.value })} /></Field></div><Field label="単位"><select className="min-h-10 rounded bg-slate-950 px-2" value={settingForm.unit} onChange={(e) => setSettingForm({ ...settingForm, unit: e.target.value })}><option>N·m</option><option>kgf·cm</option></select></Field><Field label="変更理由"><Input value={settingForm.reason} onChange={(e) => setSettingForm({ ...settingForm, reason: e.target.value })} /></Field><Button type="submit" variant="primary" disabled={busy}>履歴を追加</Button><div className="grid max-h-40 gap-1 overflow-y-auto border-t border-white/10 pt-2 text-xs">{selectedWrench.settingHistories.map((setting) => <div key={setting.id} className="rounded bg-black/20 p-2"><span className="font-semibold">{setting.lowerLimit} / {setting.nominalTorque} / {setting.upperLimit} {setting.unit}</span><span className="ml-2 text-white/55">{new Date(setting.effectiveAt).toLocaleString('ja-JP')}{setting.reason ? ` · ${setting.reason}` : ''}</span></div>)}</div></form> : null}
          </div>
          <div className="overflow-x-auto rounded border border-white/15 bg-slate-900/70"><table className="w-full text-sm"><thead className="bg-white/10"><tr><th className="p-3 text-left">製造番号</th><th className="p-3 text-left">型番</th><th className="p-3">保管場所</th><th className="p-3">校正期限</th><th className="p-3">状態</th><th className="p-3">現在設定</th></tr></thead><tbody>{wrenches.map((wrench) => { const setting = wrench.settingHistories[0]; return <tr key={wrench.id} className="cursor-pointer border-t border-white/10 hover:bg-white/5" onClick={() => setSelectedWrenchId(wrench.id)}><td className="p-3 font-semibold">{wrench.serialNumber}</td><td className="p-3">{wrench.model.modelNumber}</td><td className="p-3 text-center">{wrench.measuringInstrument.storageLocation}</td><td className="p-3 text-center">{calibrationLabel(wrench.measuringInstrument.calibrationExpiryDate)}</td><td className="p-3 text-center"><select className="min-h-9 rounded bg-slate-950 px-2 text-xs" disabled={busy} value={wrench.measuringInstrument.status} onClick={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); const status = event.target.value as TorqueWrenchProfileApi['measuringInstrument']['status']; void run(() => updateTorqueWrench(wrench.id, { status }), '物理レンチの状態を更新しました。'); }}><option value="AVAILABLE">AVAILABLE</option><option value="IN_USE">IN_USE</option><option value="MAINTENANCE">MAINTENANCE</option><option value="RETIRED">RETIRED</option></select></td><td className="p-3 text-center">{setting ? `${setting.lowerLimit} / ${setting.nominalTorque} / ${setting.upperLimit} ${setting.unit}` : '未登録'}</td></tr>; })}</tbody></table></div>
        </div>
      ) : null}

      {tab === 'groups' ? (
        <div className="grid gap-4 xl:grid-cols-[24rem_1fr]">
          <form className="grid content-start gap-3 rounded border border-white/15 bg-slate-900/70 p-4" onSubmit={submitGroup}><h2 className="font-bold">適合グループを追加</h2><Field label="グループ名"><Input required value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="呼び径"><Input required value={groupForm.nominalDiameter} onChange={(e) => setGroupForm({ ...groupForm, nominalDiameter: e.target.value })} /></Field><Field label="長さ(mm)"><Input required type="number" step="any" value={groupForm.boltLengthMm} onChange={(e) => setGroupForm({ ...groupForm, boltLengthMm: e.target.value })} /></Field><Field label="材質"><Input required value={groupForm.material} onChange={(e) => setGroupForm({ ...groupForm, material: e.target.value })} /></Field><Field label="強度区分"><Input required value={groupForm.strengthClass} onChange={(e) => setGroupForm({ ...groupForm, strengthClass: e.target.value })} /></Field></div><fieldset className="grid gap-2 rounded border border-white/10 p-2"><legend className="px-1 text-xs text-white/70">適合型番（複数選択可）</legend>{models.filter((model) => model.isActive).map((model) => <label key={model.id} className="flex gap-2 text-sm"><input type="checkbox" checked={groupForm.modelIds.includes(model.id)} onChange={(e) => setGroupForm({ ...groupForm, modelIds: e.target.checked ? [...groupForm.modelIds, model.id] : groupForm.modelIds.filter((id) => id !== model.id) })} />{model.manufacturer} {model.modelNumber}</label>)}</fieldset><Button type="submit" variant="primary" disabled={busy || groupForm.modelIds.length === 0}>登録</Button></form>
          <div className="overflow-x-auto rounded border border-white/15 bg-slate-900/70"><table className="w-full text-sm"><thead className="bg-white/10"><tr><th className="p-3 text-left">グループ</th><th className="p-3">締結対象</th><th className="p-3 text-left">適合型番</th><th className="p-3">状態</th></tr></thead><tbody>{groups.map((group) => <tr key={group.id} className="border-t border-white/10"><td className="p-3 font-semibold">{group.name}</td><td className="p-3 text-center">{group.nominalDiameter}×{group.boltLengthMm} / {group.material} / {group.strengthClass}</td><td className="p-3">{group.models.map(({ model }) => model.modelNumber).join(', ')}</td><td className="p-3 text-center"><Button type="button" className="px-2 py-1 text-xs" variant={group.isActive ? 'danger' : 'secondary'} disabled={busy} onClick={() => void run(() => updateTorqueWrenchCapabilityGroup(group.id, { isActive: !group.isActive }), group.isActive ? '適合グループを利用停止しました。' : '適合グループを再開しました。')}>{group.isActive ? '利用停止' : '再開'}</Button></td></tr>)}</tbody></table></div>
        </div>
      ) : null}
    </div>
  );
}
