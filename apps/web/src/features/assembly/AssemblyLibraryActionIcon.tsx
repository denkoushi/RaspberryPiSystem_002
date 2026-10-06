type Action = 'preview' | 'edit' | 'create' | 'unpublish' | 'rename' | 'delete' | 'duplicate' | 'history' | 'retire';

export function AssemblyLibraryActionIcon({ action }: { action: Action }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {action === 'preview' ? <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></> : null}
      {action === 'edit' ? <><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></> : null}
      {action === 'create' ? <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></> : null}
      {action === 'unpublish' ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 12h8" /></> : null}
      {action === 'rename' ? <path d="M4 20h16M4 16 14 6l4 4-10 10Z" /> : null}
      {action === 'delete' ? <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /> : null}
      {action === 'duplicate' ? <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></> : null}
      {action === 'history' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : null}
      {action === 'retire' ? <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></> : null}
    </svg>
  );
}
