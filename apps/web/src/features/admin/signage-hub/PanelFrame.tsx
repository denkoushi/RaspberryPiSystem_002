import type { ReactNode } from 'react';

/** 右列の編集パネルの共通枠（戻るボタン＋題名＋中身＋下部の操作） */
export function PanelFrame({
  title,
  accent,
  onBack,
  headerAction,
  footer,
  children,
}: {
  title: string;
  accent?: string;
  onBack: () => void;
  headerAction?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="sh-panel sh-col sh-panel-frame"
      style={{ gap: 16, borderColor: accent ?? 'var(--sh-text)' }}
    >
      <div className="sh-row-between">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="sh-icon-btn" onClick={onBack} aria-label="コンテンツ一覧へ戻る">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
        </div>
        {headerAction}
      </div>
      <div className="sh-col" style={{ gap: 16, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {children}
      </div>
      {footer && <div style={{ display: 'flex', gap: 10 }}>{footer}</div>}
    </section>
  );
}
