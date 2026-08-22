import { createContext, useContext, type PropsWithChildren } from 'react';

import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

const Context = createContext<AssemblyProcedureDocumentEditorController | null>(null);

export function AssemblyProcedureDocumentEditorProvider({
  value,
  children
}: PropsWithChildren<{ value: AssemblyProcedureDocumentEditorController }>) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAssemblyProcedureDocumentEditor(): AssemblyProcedureDocumentEditorController {
  const value = useContext(Context);
  if (!value) throw new Error('AssemblyProcedureDocumentEditorProvider is required.');
  return value;
}
