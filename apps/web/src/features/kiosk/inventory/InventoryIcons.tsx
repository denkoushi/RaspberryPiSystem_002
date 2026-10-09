import type { ReactNode } from 'react';

function Icon({ size = 16, width = 2.2, children }: { size?: number; width?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

export const NfcIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size} width={2.4}><path d="M6 8.5a6 6 0 0 1 0 7" /><path d="M10 6a10 10 0 0 1 0 12" /><path d="M14 3.5a14 14 0 0 1 0 17" /></Icon>
);
export const LockIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Icon>
);
export const PinIcon = ({ size = 13 }: { size?: number }) => (
  <Icon size={size} width={2.4}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></Icon>
);
export const BackIcon = () => <Icon><path d="M15 18l-6-6 6-6" /></Icon>;
export const UndoIcon = () => <Icon><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></Icon>;
export const GridIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Icon>
);
export const ListIcon = ({ size }: { size?: number }) => (
  <Icon size={size}><rect x="3" y="4" width="4" height="4" rx="1" /><path d="M10 6h11" /><rect x="3" y="10" width="4" height="4" rx="1" /><path d="M10 12h11" /><rect x="3" y="16" width="4" height="4" rx="1" /><path d="M10 18h11" /></Icon>
);
export const ResetIcon = () => <Icon><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></Icon>;
export const EditIcon = ({ size = 15 }: { size?: number }) => <Icon size={size}><path d="M4 20h4L19 9l-4-4L4 16v4z" /></Icon>;
export const TrashIcon = ({ size = 15 }: { size?: number }) => <Icon size={size}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></Icon>;
export const CheckIcon = ({ size = 14 }: { size?: number }) => <Icon size={size} width={3}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const CloseIcon = ({ size = 14 }: { size?: number }) => <Icon size={size} width={2.6}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const ChevronDownIcon = ({ size = 14 }: { size?: number }) => <Icon size={size} width={2.6}><path d="M6 9l6 6 6-6" /></Icon>;
export const ChevronUpIcon = ({ size = 14 }: { size?: number }) => <Icon size={size} width={2.6}><path d="M6 15l6-6 6 6" /></Icon>;
export const ArrowRightIcon = ({ size = 44 }: { size?: number }) => <Icon size={size} width={2}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></Icon>;
export const ArrowLeftIcon = ({ size = 16 }: { size?: number }) => <Icon size={size}><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></Icon>;
export const PlusIcon = ({ size = 14 }: { size?: number }) => <Icon size={size} width={2.6}><path d="M12 5v14M5 12h14" /></Icon>;
