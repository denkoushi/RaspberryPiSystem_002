import { useMemo, useState } from 'react';

import type { LibraryItem } from './hubModel';
import type { SignageContentKind } from './weekTimelineModel';

type Filter = 'all' | SignageContentKind;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'data', label: 'データ' },
  { value: 'web_page', label: '撮影' },
  { value: 'pdf', label: 'PDF' },
  { value: 'chat', label: 'Chat' },
];

export function ContentLibrary({
  items,
  onAddWebCapture,
  onAddPdf,
  onOpenChat,
  onPlace,
  onEditItem,
}: {
  items: LibraryItem[];
  onAddWebCapture: () => void;
  onAddPdf: () => void;
  onOpenChat: () => void;
  onPlace: (item: LibraryItem) => void;
  onEditItem: (item: LibraryItem) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) => (filter === 'all' || item.kind === filter) && (needle === '' || item.name.toLowerCase().includes(needle)),
    );
  }, [items, filter, query]);
  const countOf = (value: Filter) => (value === 'all' ? items.length : items.filter((item) => item.kind === value).length);

  return (
    <section aria-label="コンテンツ" className="sh-panel sh-col" style={{ gap: 14, height: '100%' }}>
      <div className="sh-row-between">
        <span className="sh-eyebrow">コンテンツ</span>
        <span className="sh-mono" style={{ fontSize: 12, color: 'var(--sh-muted)' }}>
          {items.length} 件
        </span>
      </div>

      <div className="sh-add-tiles">
        <button type="button" className="sh-tile sh-tile-web" onClick={onAddWebCapture}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="14" rx="2" />
            <path d="M3 8h18" />
            <circle cx="12" cy="13" r="2.5" />
          </svg>
          ページ撮影
        </button>
        <button type="button" className="sh-tile" onClick={onAddPdf}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sh-kind-pdf)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M12 17v-6" />
            <path d="m9 14 3-3 3 3" />
          </svg>
          PDF
        </button>
        <button type="button" className="sh-tile" onClick={onOpenChat}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sh-kind-chat)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
          Chatで作る
        </button>
      </div>

      <label className="sh-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sh-faint)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input type="search" placeholder="検索" aria-label="コンテンツを検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      <div className="sh-filter">
        {FILTERS.map((entry) => (
          <button key={entry.value} type="button" className="sh-pill" aria-pressed={filter === entry.value} onClick={() => setFilter(entry.value)}>
            {entry.label}
            {entry.value === 'all' ? '' : ` ${countOf(entry.value)}`}
          </button>
        ))}
      </div>

      <div className="sh-items">
        {visible.length === 0 && <p className="sh-hint" style={{ padding: '0 6px' }}>該当するコンテンツがありません。</p>}
        {visible.length > 0 && <p className="sh-hint sh-items-hint">＋ を押すと、その内容で予定を作れます。</p>}
        {visible.map((item) => {
          const editable = item.source.type === 'web_page' || item.source.type === 'pdf' || item.source.type === 'chat';
          return (
            <div key={item.key} className="sh-item">
              <span
                className="sh-item-swatch"
                data-unused={item.usedCount === 0}
                style={{ background: `var(--sh-kind-${item.kind})`, color: `var(--sh-kind-${item.kind})` }}
                aria-hidden="true"
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sh-item-name" title={item.name}>
                  {item.name}
                </div>
                <div className="sh-item-meta">
                  {item.meta} · {item.usedCount > 0 ? `予定 ${item.usedCount}件` : '未使用'}
                  {item.warning && <span style={{ color: 'var(--sh-warn)' }}> · {item.warning}</span>}
                </div>
              </div>
              <div className="sh-item-actions">
                {editable && (
                  <button type="button" className="sh-icon-btn sh-icon-btn-sm" onClick={() => onEditItem(item)} aria-label={`${item.name} を編集`} title="編集">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </button>
                )}
                {item.source.type !== 'chat' && (
                  <button type="button" className="sh-icon-btn sh-icon-btn-sm sh-icon-btn-place" onClick={() => onPlace(item)} aria-label={`${item.name} を予定に置く`} title="予定に置く">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
