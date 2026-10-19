export function KioskHomeIcon({ filled = false, className = 'h-5 w-5' }: { filled?: boolean; className?: string }) {
  return filled ? (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.8 2.4 10.9l1.3 1.5.8-.7V20.5h5.6v-5.6h3.8v5.6h5.6v-8.8l.8.7 1.3-1.5z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9.5h13V10" />
      <path d="M10 19.5v-5h4v5" />
    </svg>
  );
}
