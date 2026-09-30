import type { TagBindingKind } from '../../../api/domains/tag-desk';

type IconProps = { className?: string };

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export function NfcIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg {...base} strokeWidth={2} className={className}>
      <path d="M6 8.5a5 5 0 0 1 0 7" /><path d="M9.5 6a9 9 0 0 1 0 12" /><path d="M13 3.5a13 13 0 0 1 0 17" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function LinkIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg {...base} strokeWidth={2.2} className={className}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
    </svg>
  );
}

export function UnlinkIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg {...base} strokeWidth={2.2} className={className}>
      <path d="M9 7 7.5 5.5a3.5 3.5 0 0 0-5 5L4 12" /><path d="M15 17l1.5 1.5a3.5 3.5 0 0 0 5-5L20 12" />
      <path d="M8 16l-2 2M16 8l2-2M12 4v2M20 12h-2M4 12h2M12 20v-2" />
    </svg>
  );
}

export function CheckIcon({ className = 'h-5 w-5' }: IconProps) {
  return <svg {...base} strokeWidth={2.6} className={className}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
}

export function AlertIcon({ className = 'h-4 w-4' }: IconProps) {
  return <svg {...base} strokeWidth={2.2} className={className}><path d="M12 3 2 20h20Z" /><path d="M12 10v4M12 17h.01" /></svg>;
}

export function PlusIcon({ className = 'h-5 w-5' }: IconProps) {
  return <svg {...base} strokeWidth={2.4} className={className}><path d="M12 5v14M5 12h14" /></svg>;
}

export function PencilIcon({ className = 'h-5 w-5' }: IconProps) {
  return <svg {...base} strokeWidth={2} className={className}><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></svg>;
}

export function CloseIcon({ className = 'h-5 w-5' }: IconProps) {
  return <svg {...base} strokeWidth={2.4} className={className}><path d="M6 6l12 12M18 6 6 18" /></svg>;
}

export function SearchIcon({ className = 'h-5 w-5' }: IconProps) {
  return <svg {...base} strokeWidth={2} className={className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

export function LockIcon({ className = 'h-5 w-5' }: IconProps) {
  return <svg {...base} strokeWidth={2.2} className={className}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

export function DocIcon({ className = 'h-4 w-4' }: IconProps) {
  return <svg {...base} strokeWidth={2} className={className}><path d="M14 3H6v18h12V7Z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></svg>;
}

export function KindIcon({ kind, className = 'h-5 w-5' }: IconProps & { kind: TagBindingKind }) {
  switch (kind) {
    case 'employee':
      return <svg {...base} strokeWidth={2} className={className}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    case 'item':
      return <svg {...base} strokeWidth={2} className={className}><path d="M14.7 6.3a4 4 0 0 0 5 5L13 18l-3 3-4-4 3-3 6.7-6.7Z" /><path d="M14.7 6.3 17 4" /></svg>;
    case 'instrument':
      return <svg {...base} strokeWidth={2} className={className}><path d="M4 17a8 8 0 1 1 16 0" /><path d="m12 17 4-5" /><circle cx="12" cy="17" r="1.3" fill="currentColor" /></svg>;
    case 'rigging':
      return <svg {...base} strokeWidth={2} className={className}><circle cx="12" cy="4.5" r="2" /><path d="M12 6.5V13a4 4 0 1 1-4 4" /></svg>;
    case 'inventory':
      return <svg {...base} strokeWidth={2} className={className}><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5Z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>;
  }
}
