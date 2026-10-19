import { useState } from 'react';

import { formatRecordBody } from './hermes-record-answer';

import type { HermesRecordAnswerDisplay, HermesRecordRefine } from '../../api/domains/assembly';


export function HermesRecordAnswer({ display, onRefine, disabled = false }: {
  display: HermesRecordAnswerDisplay;
  onRefine?: (refine: HermesRecordRefine, label?: string) => void;
  disabled?: boolean;
}) {
  const [selectedAxis, setSelectedAxis] = useState(0);
  const [expanded, setExpanded] = useState<number[]>([]);
  const groups = display.groups ?? [];
  const compact = display.records.length > 5 || groups.length > 0;
  const selected = groups[selectedAxis] ?? groups[0];
  const alternate = groups[(groups.indexOf(selected) + 1) % groups.length] ?? selected;
  const remaining = display.coverage ? display.coverage.total - display.coverage.shown : 0;
  const chips = (group: typeof selected) => group ? (
    <div className="hermes-chat-panel__answer-chips">
      {group.buckets.map(bucket => (
        <button type="button" className="hermes-chat-panel__answer-chip" key={bucket.value}
          aria-pressed={false} disabled={disabled || !onRefine}
          onClick={() => {
            const refine = { axis: group.axis, field: group.field, value: bucket.value };
            if (group.axis === 'cause') onRefine?.(refine, bucket.label);
            else onRefine?.(refine);
          }}>
          {bucket.label} {bucket.count}
        </button>
      ))}
      {group.otherCount > 0 ? <span className="hermes-chat-panel__answer-other">{group.otherLabel ?? 'その他'} {group.otherCount} 件</span> : null}
    </div>
  ) : null;
  return (
    <div className="hermes-chat-panel__record-answer">
      {compact ? <>
        <p className="hermes-chat-panel__answer-count"><strong>{display.coverage?.total ?? display.records.length} 件</strong> 見つかりました</p>
        {groups.length ? <>
          <div className="hermes-chat-panel__answer-tabs">
            {groups.map((group, index) => <button type="button" className="hermes-chat-panel__answer-tab"
              key={`${group.axis}:${group.field}`} aria-pressed={group === selected} onClick={() => setSelectedAxis(index)}>
              {group.label}で分ける
            </button>)}
          </div>
          {chips(selected)}
        </> : null}
      </> : null}
      {display.records.map((record, recordIndex) => {
        const fields = record.fields.filter((field) => field.value.trim());
        const isExpanded = expanded.includes(recordIndex);
        const preview = Array.from(fields.find(field => field.role === 'body')?.value.trim().split(/\r?\n/u)[0] ?? '').slice(0, 40).join('');
        return (
          <article className={`hermes-chat-panel__answer-record${compact ? ' hermes-chat-panel__answer-record--compact' : ''}`} key={recordIndex}>
            {compact ? <button type="button" className="hermes-chat-panel__answer-row" aria-expanded={isExpanded}
              onClick={() => setExpanded(current => isExpanded ? current.filter(index => index !== recordIndex) : [...current, recordIndex])}>
              {(['identifier', 'date', 'organization'] as const).flatMap(role => fields.filter(field => field.role === role).map((field, index) => (
                <span className={role === 'identifier' ? 'hermes-chat-panel__answer-id' : 'hermes-chat-panel__answer-meta'} key={`${role}:${index}`}>{field.value}</span>
              )))}
              <span className="hermes-chat-panel__answer-preview">{preview}</span>
            </button> : <header className="hermes-chat-panel__answer-record-head">
              <span className="hermes-chat-panel__answer-source">{record.sourceLabel}</span>
              {fields.filter((field) => field.role !== 'body').map((field, fieldIndex) => (
                <span className={field.role === 'identifier' ? 'hermes-chat-panel__answer-id' : 'hermes-chat-panel__answer-meta'} key={fieldIndex}>
                  {field.label} {field.value}
                </span>
              ))}
            </header>}
            {(!compact || isExpanded) && fields.filter((field) => field.role === 'body').map((field, fieldIndex) => (
              <section className="hermes-chat-panel__answer-field" key={fieldIndex}>
                <h3>{field.label}</h3>
                {formatRecordBody(field.value).map((group, groupIndex) => (
                  <div key={groupIndex}>
                    {group.heading ? <h4 className="hermes-chat-panel__answer-sub">{group.heading}</h4> : null}
                    <ul>{group.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                  </div>
                ))}
              </section>
            ))}
          </article>
        );
      })}
      {compact && remaining > 0 ? <div className="hermes-chat-panel__answer-more">
        <p>他にも {remaining} 件あります。{alternate?.label ?? '条件'}で絞ってください。</p>
        {chips(alternate)}
        <span>20 件ずつ表示しています</span>
      </div> : null}
      {display.notices.length || display.dataAsOf ? (
        <footer className="hermes-chat-panel__answer-foot">
          {display.notices.map((notice, index) => <span key={index}>{notice}</span>)}
          {display.dataAsOf ? <span>データ時点 {display.dataAsOf}</span> : null}
        </footer>
      ) : null}
    </div>
  );
}
