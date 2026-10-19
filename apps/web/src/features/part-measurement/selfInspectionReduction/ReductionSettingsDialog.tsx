import {
  SELF_INSPECTION_REDUCTION_CONSECUTIVE_LOTS_RANGE,
  SELF_INSPECTION_REDUCTION_CPK_THRESHOLDS,
  SELF_INSPECTION_REDUCTION_MINIMUM_SAMPLE_RANGE,
  type SelfInspectionReductionPolicy
} from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';


import { Dialog } from '../../../components/ui/Dialog';

import { NfcIcon, NfcPrompt, Segmented, kioskButtonClass, kioskInputClass, kioskPrimaryButtonClass } from './reductionUi';

import type { SelfInspectionReductionApprover } from '../../../api/client';

function Stepper({
  label,
  unit,
  value,
  step,
  range,
  onChange
}: {
  label: string;
  unit: string;
  value: number;
  step: number;
  range: { min: number; max: number };
  onChange: (value: number) => void;
}) {
  const clamp = (next: number) => Math.min(Math.max(next, range.min), range.max);
  return (
    <div className="flex items-center gap-3 text-base">
      <span className="flex-1">{label}</span>
      <span className="inline-flex h-11 items-center overflow-hidden rounded-lg border border-[#2f4159]">
        <button type="button" aria-label={`${label}を減らす`} className="h-11 w-11 bg-[#0a111a] text-2xl" onClick={() => onChange(clamp(value - step))}>
          −
        </button>
        <output aria-label={label} className="min-w-16 text-center font-mono text-[22px] font-semibold">
          {value}
        </output>
        <button type="button" aria-label={`${label}を増やす`} className="h-11 w-11 bg-[#0a111a] text-2xl" onClick={() => onChange(clamp(value + step))}>
          ＋
        </button>
      </span>
      <span className="w-12 whitespace-nowrap text-sm text-[#72849b]">{unit}</span>
    </div>
  );
}

export function ReductionSettingsDialog({
  open,
  policy,
  approvers,
  pending,
  message,
  addArmed,
  onClose,
  onSave,
  onArmAddApprover,
  onCancelAddApprover,
  onRemoveApprover
}: {
  open: boolean;
  policy: SelfInspectionReductionPolicy;
  approvers: readonly SelfInspectionReductionApprover[];
  pending: boolean;
  message: string | null;
  addArmed: boolean;
  onClose: () => void;
  onSave: (policy: SelfInspectionReductionPolicy, password: string) => void;
  onArmAddApprover: (password: string) => void;
  onCancelAddApprover: () => void;
  onRemoveApprover: (id: string, password: string) => void;
}) {
  const [draft, setDraft] = useState(policy);
  const [password, setPassword] = useState('');
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(policy);
      setPassword('');
      setLocalMessage(null);
    }
  }, [open, policy]);

  const withPassword = (action: (password: string) => void) => {
    if (!password.trim()) {
      setLocalMessage('操作時パスワードを入力してください');
      passwordRef.current?.focus();
      return;
    }
    setLocalMessage(null);
    action(password);
  };

  const shownMessage = localMessage ?? message;

  return (
    <Dialog
      isOpen={open}
      onClose={onClose}
      title="判定設定"
      closeOnEsc={!pending}
      closeOnBackdrop={!pending}
      size="lg"
      className="!my-auto !max-w-[600px] !rounded-xl !border !border-[#2f4159] !bg-[#111b28] !p-6 !text-[#e8eef6] !shadow-2xl"
      titleClassName="text-2xl font-black"
    >
      <form
        className="mt-4 grid gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) withPassword((value) => onSave(draft, value));
        }}
      >
        <fieldset className="grid gap-3 rounded-xl border border-[#243347] bg-[#141e2b] px-4 py-3.5">
          <legend className="px-1 text-[15px] font-bold text-[#aab8ca]">公差の余裕</legend>
          <div className="flex items-center gap-3 text-base">
            <span className="flex-1">工程能力 Cpk の基準</span>
            <Segmented
              label="工程能力 Cpk の基準"
              value={draft.cpkThreshold}
              options={SELF_INSPECTION_REDUCTION_CPK_THRESHOLDS.map((value) => ({ value, label: value.toFixed(2) }))}
              onChange={(cpkThreshold) => setDraft({ ...draft, cpkThreshold })}
            />
          </div>
        </fieldset>

        <fieldset className="grid gap-3 rounded-xl border border-[#243347] bg-[#141e2b] px-4 py-3.5">
          <legend className="px-1 text-[15px] font-bold text-[#aab8ca]">検査を1段減らす条件</legend>
          <Stepper
            label="連続合格"
            unit="ロット"
            value={draft.requiredConsecutiveLots}
            step={1}
            range={SELF_INSPECTION_REDUCTION_CONSECUTIVE_LOTS_RANGE}
            onChange={(requiredConsecutiveLots) => setDraft({ ...draft, requiredConsecutiveLots })}
          />
          <Stepper
            label="データ量"
            unit="個"
            value={draft.minimumSampleCount}
            step={5}
            range={SELF_INSPECTION_REDUCTION_MINIMUM_SAMPLE_RANGE}
            onChange={(minimumSampleCount) => setDraft({ ...draft, minimumSampleCount })}
          />
          <div className="flex items-center gap-3 text-base">
            <span className="flex-1">変化点のあと連続合格を0から数え直す</span>
            <button
              type="button"
              aria-pressed={draft.resetStreakOnChangePoint}
              onClick={() => setDraft({ ...draft, resetStreakOnChangePoint: !draft.resetStreakOnChangePoint })}
              className="inline-flex h-11 items-center gap-2.5 rounded-lg border border-[#2f4159] bg-[#0a111a] px-3 text-[15px] font-bold"
            >
              <span
                className={clsx(
                  'relative h-[22px] w-10 rounded-full transition-colors after:absolute after:left-[3px] after:top-[3px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform',
                  draft.resetStreakOnChangePoint ? 'bg-emerald-400 after:translate-x-[18px]' : 'bg-[#2a3a50]'
                )}
              />
              {draft.resetStreakOnChangePoint ? 'ON' : 'OFF'}
            </button>
          </div>
        </fieldset>

        <fieldset className="grid gap-3 rounded-xl border border-[#243347] bg-[#141e2b] px-4 py-3.5">
          <legend className="px-1 text-[15px] font-bold text-[#aab8ca]">承認できる人</legend>
          <ul className="grid gap-1.5">
            {approvers.map((approver) => (
              <li key={approver.id} className="flex h-11 items-center gap-2.5 rounded-lg border border-[#1f2d3f] bg-[#0e1722] pl-3 pr-1.5">
                <span className="font-mono text-sm text-[#72849b]">{approver.employeeCode}</span>
                {approver.displayName}
                <button
                  type="button"
                  aria-label={`${approver.displayName}を外す`}
                  disabled={pending}
                  onClick={() => withPassword((value) => onRemoveApprover(approver.id, value))}
                  className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-[#aab8ca] hover:bg-white/5"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="h-[18px] w-[18px]" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
            {approvers.length === 0 ? <li className="text-[#72849b]">未設定</li> : null}
          </ul>
          {addArmed ? (
            <NfcPrompt
              action={
                <button type="button" className={clsx(kioskButtonClass, 'h-10 px-3 text-[15px]')} onClick={onCancelAddApprover}>
                  やめる
                </button>
              }
            >
              追加する人の社員タグをタッチ
            </NfcPrompt>
          ) : (
            <button
              type="button"
              disabled={pending}
              className={clsx(kioskButtonClass, 'justify-self-start')}
              onClick={() => withPassword(onArmAddApprover)}
            >
              <NfcIcon className="h-[22px] w-[22px] text-sky-300" />
              社員タグで追加
            </button>
          )}
        </fieldset>

        <div className="flex items-center gap-3">
          <input
            ref={passwordRef}
            type="password"
            autoComplete="off"
            aria-label="操作時パスワード"
            placeholder="操作時パスワード"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={clsx(kioskInputClass, 'w-56')}
          />
          <span className="flex-1" />
          <button type="button" className={kioskButtonClass} disabled={pending} onClick={onClose}>
            閉じる
          </button>
          <button type="submit" className={kioskPrimaryButtonClass} disabled={pending}>
            {pending ? '保存中…' : '保存'}
          </button>
        </div>
        {shownMessage ? (
          <p role="alert" className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
            {shownMessage}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
