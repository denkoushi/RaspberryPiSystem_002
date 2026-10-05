import { KindIcon } from './TagDeskIcons';
import { KIND_META } from './tagDeskModel';
import { tagDesk } from './tagDeskTheme';

import type { TagBindingEvent, TagBindingKind, TagUse } from '../../../api/domains/tag-desk';
import type { ReactNode } from 'react';



const timeFormat = new Intl.DateTimeFormat('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const formatWhen = (iso: string) => timeFormat.format(new Date(iso)).replace(/\s/, ' ');

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className={tagDesk.eyebrow}>{title}</h3>
      {children}
    </div>
  );
}

/** One bound record (or the record picked in the list), as a card. */
export function TargetCard(props: {
  kind: TagBindingKind;
  name: string;
  code: string;
  sub: string | null;
  sub2?: string | null;
  tone: 'target' | 'cutting' | 'gone' | 'plain';
  chips?: ReactNode;
  action?: ReactNode;
  onOpen?: () => void;
  /** Draw the tether from this card (instead of the reader). */
  tetherSource?: boolean;
}) {
  const sub = props.kind === 'employee' ? [props.sub, props.sub2].filter(Boolean).join(' ') : props.sub;
  const border = props.tone === 'target' ? 'border-[#4cc9f0]' : props.tone === 'cutting' ? 'border-[#6b2a2d]' : 'border-[#223043]';
  const body = (
    <>
      <div className="grid h-14 w-14 place-items-center rounded-xl bg-[#1a2636] text-[#4cc9f0]">
        <KindIcon kind={props.kind} className="h-7 w-7" />
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-left">
        <span className="text-xs font-bold tracking-[0.1em] text-[#8494a8]">{KIND_META[props.kind].label}</span>
        <span className="truncate text-[22px] font-bold leading-tight text-white">{props.name}</span>
        <span className="flex gap-3 text-sm text-[#8494a8]">
          <code className="font-mono text-[#aebbd0]">{props.code}</code>
          {sub ? <span className="truncate">{sub}</span> : null}
        </span>
        {props.chips ? <div className="mt-1 flex flex-wrap gap-2">{props.chips}</div> : null}
      </div>
    </>
  );
  return (
    <div
      data-tether-source={props.tetherSource ? '' : undefined}
      className={`grid grid-cols-[56px_1fr_auto] items-center gap-4 rounded-xl border bg-[#131c29] px-4 py-3.5 ${border} ${props.tone === 'gone' ? 'opacity-45' : ''}`}
    >
      {props.onOpen ? (
        <button type="button" onClick={props.onOpen} className="col-span-2 grid grid-cols-[56px_1fr] items-center gap-4 rounded-lg text-left" aria-label={`${props.name} を一覧で開く`}>
          {body}
        </button>
      ) : body}
      {props.action ?? <span />}
    </div>
  );
}

export function UseChips({ kind, lost }: { kind: TagBindingKind; lost?: boolean }) {
  return (
    <Section title={lost ? '使えなくなる機能' : 'このタグで使う機能'}>
      <div className="flex flex-wrap gap-1.5">
        {KIND_META[kind].uses.map((use) => (
          <span
            key={use}
            className={lost
              ? 'inline-flex h-[30px] items-center rounded-lg border border-dashed border-[#223043] px-[11px] text-sm text-[#5c6d83] line-through'
              : 'inline-flex h-[30px] items-center rounded-lg border border-[#223043] px-[11px] text-sm text-[#c3cedd]'}
          >
            {use}
          </span>
        ))}
      </div>
    </Section>
  );
}

const USE_LABEL: Record<TagUse['action'], string> = { BORROW: '持出', RETURN: '返却' };

export function RecentUses({ uses }: { uses: TagUse[] }) {
  if (uses.length === 0) return null;
  return (
    <Section title="最近の使用">
      <div className="flex flex-col">
        {uses.map((use) => (
          <div key={`${use.at}-${use.action}`} className="grid h-[34px] grid-cols-[118px_64px_minmax(0,1fr)] items-center gap-3 border-b border-[#172131] text-[15px] last:border-b-0">
            <time className="font-mono text-sm tabular-nums text-[#8494a8]">{formatWhen(use.at)}</time>
            <span className="text-[#c3cedd]">{USE_LABEL[use.action]}</span>
            <span className="truncate text-white">{use.label}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function EventLog({ events }: { events: TagBindingEvent[] }) {
  return (
    <Section title="最近の付け外し">
      {events.length === 0 ? (
        <p className="text-sm text-[#5c6d83]">まだありません</p>
      ) : (
        <div className="flex flex-col">
          {events.map((event) => (
            <div key={event.id} className="grid h-[34px] grid-cols-[118px_56px_minmax(0,1fr)_150px] items-center gap-3 border-b border-[#172131] text-[15px] last:border-b-0">
              <time className="font-mono text-sm tabular-nums text-[#8494a8]">{formatWhen(event.createdAt)}</time>
              <span className={event.action === 'UNLINK' ? 'font-bold text-[#ff5d5d]' : 'font-bold text-[#4cc9f0]'}>
                {event.action === 'UNLINK' ? '外す' : '付ける'}
              </span>
              <span className="truncate text-white">{event.targetLabel}</span>
              <code className="truncate text-right font-mono text-[13px] text-[#8494a8]">{event.uid}</code>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Inline "really release?" row; the person presses the red button themselves. */
export function ConfirmRelease(props: { label: string; pending: boolean; onConfirm: () => void; onCancel: () => void; warning?: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#6b2a2d] bg-[#3a1719] px-4 py-3.5">
      <div className="min-w-0 flex-1 text-lg font-bold text-white">
        {props.label} から外しますか？
        <small className="mt-0.5 block text-[13px] font-medium text-[#f0a3a3]">{props.warning ?? 'タグは未使用に戻ります'}</small>
      </div>
      <button type="button" className={`${tagDesk.btn} ${tagDesk.cutSolid}`} disabled={props.pending} onClick={props.onConfirm}>
        {props.pending ? '外しています…' : '外す'}
      </button>
      <button type="button" className={`${tagDesk.btn} ${tagDesk.ghost}`} disabled={props.pending} onClick={props.onCancel}>
        やめる
      </button>
    </div>
  );
}
