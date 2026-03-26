import clsx from 'clsx';

const iconClass = 'h-4 w-4 shrink-0';

type SvgProps = { className?: string; 'aria-hidden'?: boolean };

/** 一覧を隠す（左ペインが開いているとき） */
export function IconKioskCollapseListPanel(props: SvgProps) {
  return (
    <svg
      className={clsx(iconClass, props.className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-hidden'] ?? true}
    >
      <polyline points="14 6 8 12 14 18" />
      <line x1="4" y1="5" x2="4" y2="19" />
    </svg>
  );
}

/** 一覧を表示（左ペインが閉じているとき） */
export function IconKioskExpandListPanel(props: SvgProps) {
  return (
    <svg
      className={clsx(iconClass, props.className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-hidden'] ?? true}
    >
      <polyline points="10 6 16 12 10 18" />
      <line x1="4" y1="5" x2="4" y2="19" />
    </svg>
  );
}

/** 標準幅（固定レイアウトのドキュメント） */
export function IconKioskWidthDefault(props: SvgProps) {
  return (
    <svg
      className={clsx(iconClass, props.className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-hidden'] ?? true}
    >
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <rect x="7" y="6" width="10" height="12" rx="0.5" />
    </svg>
  );
}

/** 横幅いっぱい（水平フィット） */
export function IconKioskWidthFit(props: SvgProps) {
  return (
    <svg
      className={clsx(iconClass, props.className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props['aria-hidden'] ?? true}
    >
      <path d="M4 12h16" />
      <path d="M5 9 2 12l3 3M19 9l3 3-3 3" />
      <rect x="6" y="7" width="12" height="10" rx="1" />
    </svg>
  );
}
