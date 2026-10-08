import { formatRecordBody } from './hermes-record-answer';

import type { HermesRecordAnswerDisplay } from '../../api/domains/assembly';


export function HermesRecordAnswer({ display }: { display: HermesRecordAnswerDisplay }) {
  return (
    <div className="hermes-chat-panel__record-answer">
      {display.records.map((record, recordIndex) => {
        const fields = record.fields.filter((field) => field.value.trim());
        return (
          <article className="hermes-chat-panel__answer-record" key={recordIndex}>
            <header className="hermes-chat-panel__answer-record-head">
              <span className="hermes-chat-panel__answer-source">{record.sourceLabel}</span>
              {fields.filter((field) => field.role !== 'body').map((field, fieldIndex) => (
                <span className={field.role === 'identifier' ? 'hermes-chat-panel__answer-id' : 'hermes-chat-panel__answer-meta'} key={fieldIndex}>
                  {field.label} {field.value}
                </span>
              ))}
            </header>
            {fields.filter((field) => field.role === 'body').map((field, fieldIndex) => (
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
      {display.notices.length || display.dataAsOf ? (
        <footer className="hermes-chat-panel__answer-foot">
          {display.notices.map((notice, index) => <span key={index}>{notice}</span>)}
          {display.dataAsOf ? <span>データ時点 {display.dataAsOf}</span> : null}
        </footer>
      ) : null}
    </div>
  );
}
