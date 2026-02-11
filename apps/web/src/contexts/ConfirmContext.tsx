import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { ConfirmDialog } from '../components/ui/ConfirmDialog';

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
};

type ConfirmState = ConfirmOptions & { isOpen: boolean };

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

const initialState: ConfirmState = {
  isOpen: false,
  title: ''
};

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState>(initialState);
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      if (resolver) {
        resolver(false);
      }
      setResolver(() => resolve);
      setState({ ...options, isOpen: true });
    });
  }, [resolver]);

  const handleClose = useCallback((value: boolean) => {
    resolver?.(value);
    setResolver(null);
    setState(initialState);
  }, [resolver]);

  const contextValue = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      <ConfirmDialog
        isOpen={state.isOpen}
        title={state.title}
        description={state.description}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        tone={state.tone}
        onCancel={() => handleClose(false)}
        onConfirm={() => handleClose(true)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return context.confirm;
}
