import { useState } from 'react';

import {
  useKioskInquiryReceiverSettings,
  useLookupKioskInquiryEmployee,
  useUpdateKioskInquiryReceiverSettings
} from '../../../api/hooks/kiosk';
import { Button } from '../../../components/ui/Button';

import { inquiryErrorCode } from './inquiryErrors';

import type { KioskInquiryEmployee } from '../../../api/domains/kiosk';

export function KioskInquiryReceiverSettings() {
  const settingsQuery = useKioskInquiryReceiverSettings();
  const update = useUpdateKioskInquiryReceiverSettings();
  const lookup = useLookupKioskInquiryEmployee();
  const [draft, setDraft] = useState<{ receiverClientDeviceIds: string[]; employees: KioskInquiryEmployee[] } | null>(null);
  const [employeeCode, setEmployeeCode] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const settings = settingsQuery.data?.settings;
  const savedIds = settings?.devices.filter(device => device.inquiryReceiverEnabled).map(device => device.id) ?? [];
  const current = draft ?? { receiverClientDeviceIds: savedIds, employees: settings?.employees ?? [] };
  const signature = (values: string[]) => [...values].sort().join('\0');
  const isDirty = !!settings && (signature(current.receiverClientDeviceIds) !== signature(savedIds)
    || signature(current.employees.map(employee => employee.employeeCode)) !== signature(settings.employees.map(employee => employee.employeeCode)));
  const busy = update.isPending || lookup.isPending;

  const add = async () => {
    const code = employeeCode.trim();
    if (!code || busy) return;
    setAddError(null); setMessage(null);
    if (current.employees.some(employee => employee.employeeCode === code)) {
      setAddError(`${code} は登録済みです`); return;
    }
    try {
      const { employee } = await lookup.mutateAsync(code);
      setDraft({ ...current, employees: [...current.employees, employee] });
      setEmployeeCode('');
    } catch (failure) {
      setAddError(inquiryErrorCode(failure) === 'KIOSK_INQUIRY_EMPLOYEE_CODE_NOT_FOUND'
        ? `社員番号 ${code} は社員マスタにありません` : '社員番号を確認できません');
    }
  };

  const save = async () => {
    setMessage(null);
    try {
      await update.mutateAsync({ receiverClientDeviceIds: current.receiverClientDeviceIds,
        employeeCodes: current.employees.map(employee => employee.employeeCode) });
      setDraft(null);
      setMessage({ text: 'お問い合わせの受信設定を保存しました。', tone: 'success' });
    } catch { setMessage({ text: '保存に失敗しました。', tone: 'error' }); }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-bold">お問い合わせの受信</h3>
      {settingsQuery.isLoading ? <p className="text-sm text-slate-600">読込中…</p> : null}
      {settingsQuery.isError ? <p className="text-sm text-red-600" role="alert">設定の取得に失敗しました。</p> : null}
      {settings ? <>
        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className="mb-2 text-sm font-semibold">受け取る端末</legend>
          <div className="flex flex-wrap gap-2">
            {settings.devices.map(device => (
              <label key={device.id} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-emerald-600">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={current.receiverClientDeviceIds.includes(device.id)}
                  onChange={event => {
                    setMessage(null);
                    setDraft({ ...current, receiverClientDeviceIds: event.target.checked
                      ? [...current.receiverClientDeviceIds, device.id] : current.receiverClientDeviceIds.filter(id => id !== device.id) });
                  }} />{device.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className="mb-2 text-sm font-semibold">開ける人(社員番号)</legend>
          <ul className="flex flex-wrap gap-2">
            {current.employees.map(employee => (
              <li key={employee.employeeCode} className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 py-1 pl-3 pr-1 text-sm">
                <b>{employee.employeeCode}</b><span>{employee.displayName}</span>
                <Button type="button" variant="ghost" className="px-2 py-1" aria-label={`${employee.employeeCode} を外す`}
                  onClick={() => {
                    setDraft({ ...current, employees: current.employees.filter(item => item.employeeCode !== employee.employeeCode) });
                    setAddError(null); setMessage(null);
                  }}>×</Button>
              </li>
            ))}
          </ul>
          <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void add(); }}>
            <input className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm" type="text" inputMode="numeric"
              aria-label="社員番号" placeholder="社員番号" maxLength={10} value={employeeCode}
              onChange={event => { setEmployeeCode(event.target.value); setAddError(null); }}
              onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
            <Button type="submit" disabled={!employeeCode.trim()}>追加</Button>
          </form>
          {addError ? <p className="text-sm text-red-600" role="alert">{addError}</p> : null}
        </fieldset>
      </> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!isDirty || busy} onClick={() => void save()}>保存</Button>
        <Button type="button" variant="ghost" disabled={!isDirty || busy}
          onClick={() => { setDraft(null); setEmployeeCode(''); setAddError(null); setMessage(null); }}>変更を戻す</Button>
      </div>
      {message ? <p className={`text-sm ${message.tone === 'success' ? 'text-emerald-700' : 'text-red-600'}`}
        role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
    </div>
  );
}
