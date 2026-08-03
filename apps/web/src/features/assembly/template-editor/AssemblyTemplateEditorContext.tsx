import { createContext, useContext } from 'react';

import type { AssemblyTemplateEditorController } from './useAssemblyTemplateEditorController';
import type { PropsWithChildren, ReactNode } from 'react';

type EditorLink = { children: ReactNode; className: string; to: string };

type AssemblyTemplateEditorContextValue = {
  controller: AssemblyTemplateEditorController;
  renderLink: (link: EditorLink) => ReactNode;
};

const AssemblyTemplateEditorContext =
  createContext<AssemblyTemplateEditorContextValue | null>(null);

export function AssemblyTemplateEditorProvider({
  children,
  renderLink,
  value
}: PropsWithChildren<{
  renderLink: (link: EditorLink) => ReactNode;
  value: AssemblyTemplateEditorController;
}>) {
  return (
    <AssemblyTemplateEditorContext.Provider value={{ controller: value, renderLink }}>
      {children}
    </AssemblyTemplateEditorContext.Provider>
  );
}

export function useAssemblyTemplateEditor() {
  const context = useContext(AssemblyTemplateEditorContext);
  if (!context) {
    throw new Error('AssemblyTemplateEditorProvider is required.');
  }
  return context.controller;
}

export function useAssemblyTemplateEditorNavigation() {
  const context = useContext(AssemblyTemplateEditorContext);
  if (!context) {
    throw new Error('AssemblyTemplateEditorProvider is required.');
  }
  return { renderLink: context.renderLink };
}
