

import { RiggingInspectionPanel } from './RiggingInspectionPanel';
import { AlertIcon, CheckIcon, CloseIcon, DocIcon, LinkIcon, NfcIcon, PencilIcon, UnlinkIcon } from './TagDeskIcons';
import { KIND_META, uidBytes } from './tagDeskModel';
import { ConfirmRelease, EventLog, RecentUses, Section, TargetCard, UseChips } from './TagDeskParts';
import { TagDeskRecordForm } from './TagDeskRecordForm';
import { tagDesk } from './tagDeskTheme';
import { TagReaderField, type ReaderTone } from './TagReaderField';

import type { TagDeskState } from './useTagDesk';
import type { TagBinding, TagDeskRow } from '../../../api/domains/tag-desk';
import type { Ref } from 'react';

export type DockMode = 'idle' | 'tag' | 'record' | 'form';

export function dockModeOf(state: TagDeskState): DockMode {
  if (state.form) return 'form';
  if (state.uid) return 'tag';
  if (state.selectedRow) return 'record';
  return 'idle';
}

type Props = {
  pin: string;
  state: TagDeskState;
  /** bindingId currently waiting for the second "外す" press. */
  confirming: string | null;
  setConfirming: (bindingId: string | null) => void;
  tokenRef: Ref<HTMLDivElement>;
};

export function TagDeskDock({ pin, state, confirming, setConfirming, tokenRef }: Props) {
  const mode = dockModeOf(state);
  const bindings = state.bindings ?? [];
  const tone: ReaderTone = mode !== 'tag' ? 'idle' : confirming ? 'cut' : bindings.length === 0 && !state.bindingsLoading ? 'ok' : 'live';
  const prompt = mode === 'form' ? null : mode === 'record' ? 'かざして付ける' : 'タグをかざす';

  return (
    <section className={`relative flex min-h-0 flex-col overflow-hidden ${tagDesk.panel}`} aria-label="読み取ったタグ">
      <TagReaderField uid={mode === 'tag' ? state.uid : null} tone={tone} compact={mode === 'record' || mode === 'form'} prompt={prompt} tokenRef={tokenRef} onClear={state.clearUid} onManualUid={state.setUidManually} />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto border-t border-[#223043] px-6 pb-6 pt-5">
        {state.error ? (
          <p className="flex items-center gap-2 rounded-xl border border-[#6b2a2d] bg-[#3a1719] px-4 py-3 text-base font-bold text-[#ff8a8a]" role="alert">
            <AlertIcon className="h-5 w-5 flex-none" />
            {state.error}
          </p>
        ) : null}
        {state.notice ? (
          <p className="flex items-center gap-3 rounded-xl bg-[#10352a] px-4 py-3 text-lg font-bold text-[#34d399]" role="status">
            <CheckIcon className="h-6 w-6 flex-none" />
            {state.notice}
          </p>
        ) : null}
        {mode === 'idle' ? <IdleView state={state} /> : null}
        {mode === 'tag' ? <TagView state={state} bindings={bindings} confirming={confirming} setConfirming={setConfirming} /> : null}
        {mode === 'record' && state.selectedRow ? <RecordView pin={pin} state={state} row={state.selectedRow} confirming={confirming} setConfirming={setConfirming} /> : null}
        {mode === 'form' && state.form ? (
          <TagDeskRecordForm
            key={`${state.form.kind}-${state.form.id ?? 'new'}`}
            kind={state.form.kind}
            record={state.form.id ? state.rows.find((row) => row.id === state.form?.id)?.record ?? null : null}
            name={state.form.id ? state.rows.find((row) => row.id === state.form?.id)?.name ?? null : null}
            options={state.options}
            saving={state.save.isPending}
            deleting={state.remove.isPending}
            onSave={(payload) => state.form && state.save.mutate({ form: state.form, payload })}
            onDelete={() => state.form?.id && state.remove.mutate({ kind: state.form.kind, id: state.form.id })}
            onCancel={() => state.openForm(null)}
          />
        ) : null}
      </div>
    </section>
  );
}

function IdleView({ state }: { state: TagDeskState }) {
  return (
    <>
      <h2 className="text-lg font-bold text-white">紐づけ先</h2>
      <p className="flex items-center gap-3 text-base text-[#8494a8]">
        <NfcIcon className="h-[22px] w-[22px] text-[#4cc9f0]" />
        かざすと、紐づけ先と使いみちが出ます
      </p>
      <div className="mt-auto">
        <EventLog events={state.events} />
      </div>
    </>
  );
}

function CsvNote() {
  return (
    <div className="mt-auto flex">
      <span className={tagDesk.chipInfo}><DocIcon />CSV取込にUIDが残ると戻ります</span>
    </div>
  );
}

function loanChip(binding: TagBinding) {
  if (binding.activeLoans === 0) return null;
  const text = binding.kind === 'employee' ? `持出中 ${binding.activeLoans}件` : '貸出中';
  return <span className={tagDesk.chipWarn}><AlertIcon />{text}</span>;
}

function TagView({ state, bindings, confirming, setConfirming }: { state: TagDeskState; bindings: TagBinding[]; confirming: string | null; setConfirming: (id: string | null) => void }) {
  if (state.bindingsLoading) {
    return <p className="text-base text-[#8494a8]" role="status">読み取っています…</p>;
  }

  if (bindings.length === 0) {
    const row = state.selectedRow;
    const oneTagOnly = row && (row.kind === 'employee' || row.kind === 'item');
    const replacing = Boolean(row && oneTagOnly && row.tags.length > 0);
    const verb = !row ? '' : replacing ? `${row.name} に付け替える` : row.tags.length > 0 ? `${row.name} に追加で付ける` : `${row.name} に付ける`;
    return (
      <>
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-bold text-white">付ける相手</h2>
          <span className={tagDesk.chipOk}><CheckIcon className="h-4 w-4" />未使用のタグ</span>
        </div>
        {row ? (
          <>
            <TargetCard kind={row.kind} name={row.name} code={row.code} sub={row.sub} tone="target" />
            {replacing ? (
              <p className="flex items-center gap-2 text-sm font-bold text-[#ffb547]">
                <AlertIcon />今のタグ {row.tags[0]?.uid} は外れます
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="button" className={`${tagDesk.btn} ${tagDesk.go}`} disabled={state.link.isPending} onClick={() => state.link.mutate({ target: row, replace: replacing })}>
                <LinkIcon />
                {state.link.isPending ? '付けています…' : verb}
              </button>
              <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost}`} onClick={state.clearUid}>やめる</button>
            </div>
            <UseChips kind={row.kind} />
          </>
        ) : (
          <p className="flex items-center gap-3 text-base text-[#8494a8]">
            <LinkIcon className="h-[22px] w-[22px] text-[#4cc9f0]" />
            右の一覧から付ける相手を選ぶ
          </p>
        )}
      </>
    );
  }

  const duplicate = bindings.length > 1;
  const pending = bindings.find((binding) => binding.bindingId === confirming) ?? null;
  return (
    <>
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-bold text-white">紐づけ先</h2>
        <span className="font-mono text-sm text-[#8494a8]">{bindings.length}件</span>
      </div>
      {bindings.map((binding) => (
        <TargetCard
          key={`${binding.kind}-${binding.bindingId}`}
          kind={binding.kind}
          name={binding.name}
          code={binding.code}
          sub={binding.sub}
          tone={binding.bindingId === confirming ? 'cutting' : 'target'}
          onOpen={binding.kind !== 'inventory' ? () => state.setKind(binding.kind as Exclude<typeof binding.kind, 'inventory'>) : undefined}
          chips={(
            <>
              {loanChip(binding)}
              {duplicate ? <span className={tagDesk.chipCut}><AlertIcon />二重登録</span> : null}
            </>
          )}
          action={confirming ? undefined : (
            <button type="button" className={`${tagDesk.btnSm} ${tagDesk.cut}`} onClick={() => setConfirming(binding.bindingId)}>
              <UnlinkIcon className="h-[18px] w-[18px]" />外す
            </button>
          )}
        />
      ))}
      {pending ? (
        <>
          <UseChips kind={pending.kind} lost />
          <ConfirmRelease
            label={pending.name}
            pending={state.unlink.isPending}
            warning={pending.activeLoans > 0 && pending.kind !== 'employee' ? '貸出中です。外すとかざして返却できません' : null}
            onConfirm={() => state.unlink.mutate({ kind: pending.kind, bindingId: pending.bindingId, label: pending.name }, { onSettled: () => setConfirming(null) })}
            onCancel={() => setConfirming(null)}
          />
        </>
      ) : !duplicate && bindings[0] ? (
        <>
          <UseChips kind={bindings[0].kind} />
          <RecentUses uses={bindings[0].recent} />
        </>
      ) : null}
      <CsvNote />
    </>
  );
}

function RecordView({ pin, state, row, confirming, setConfirming }: { pin: string; state: TagDeskState; row: TagDeskRow; confirming: string | null; setConfirming: (id: string | null) => void }) {
  const pendingTag = row.tags.find((tag) => tag.bindingId === confirming) ?? null;
  return (
    <>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-white">{KIND_META[row.kind].label}</h2>
        <button type="button" className={`${tagDesk.btnSm} ${tagDesk.ghost} ml-auto`} onClick={() => state.select(null)} aria-label="選択を閉じる">
          <CloseIcon className="h-4 w-4" />閉じる
        </button>
      </div>
      <TargetCard
        kind={row.kind}
        name={row.name}
        code={row.code}
        sub={row.sub}
        tone="target"
        tetherSource
        action={(
          <button type="button" className={`${tagDesk.btnSm} ${tagDesk.ghost}`} onClick={() => state.openForm({ kind: row.kind, id: row.id })}>
            <PencilIcon className="h-4 w-4" />編集
          </button>
        )}
      />
      <Section title="タグ">
        {row.tags.length === 0 ? (
          <p className="flex items-center gap-2 text-base text-[#8494a8]"><NfcIcon className="h-5 w-5 text-[#4cc9f0]" />タグなし</p>
        ) : (
          <div className="flex flex-col gap-2">
            {row.tags.map((tag) => (
              <div key={tag.bindingId} className="flex items-center gap-3">
                <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#152032] px-3 font-mono text-base text-white">
                  <NfcIcon className="h-4 w-4 text-[#4cc9f0]" />
                  {uidBytes(tag.uid).join(' ')}
                </span>
                {confirming ? null : (
                  <button type="button" className={`${tagDesk.btnSm} ${tagDesk.cut}`} onClick={() => setConfirming(tag.bindingId)}>
                    <UnlinkIcon className="h-[18px] w-[18px]" />外す
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
      {pendingTag ? (
        <ConfirmRelease
          label={row.name}
          pending={state.unlink.isPending}
          onConfirm={() => state.unlink.mutate({ kind: row.kind, bindingId: pendingTag.bindingId, label: row.name }, { onSettled: () => setConfirming(null) })}
          onCancel={() => setConfirming(null)}
        />
      ) : (
        <UseChips kind={row.kind} />
      )}
      {row.kind === 'rigging' ? <RiggingInspectionPanel pin={pin} riggingGearId={row.id} /> : null}
    </>
  );
}
