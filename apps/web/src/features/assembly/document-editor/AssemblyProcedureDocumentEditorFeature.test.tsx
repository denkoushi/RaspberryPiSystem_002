import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorPage } from './AssemblyProcedureDocumentEditorFeature';

const mocks = vi.hoisted(() => ({ controller: vi.fn() }));
vi.mock('./useAssemblyProcedureDocumentEditorController', () => ({ useAssemblyProcedureDocumentEditorController: mocks.controller }));
vi.mock('./AssemblyProcedureDocumentEditorContext', () => ({ AssemblyProcedureDocumentEditorProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./AssemblyProcedureDocumentEditorScreen', () => ({ AssemblyProcedureDocumentEditorScreen: ({ context, onNavigateToDocument }: { context?: { modelCode: string }; onNavigateToDocument: (id: string) => void }) => <><p>{context?.modelCode ?? '既存の見出し'}</p><button onClick={() => onNavigateToDocument('created-document')}>作成した要領書を開く</button></> }));
function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
function show(state: unknown) {
  render(<MemoryRouter initialEntries={[{ pathname: '/kiosk/assembly/procedure-documents/doc/edit', state }]}><Routes>
    <Route path="/kiosk/assembly/procedure-documents/:documentId/edit" element={<AssemblyProcedureDocumentEditorPage />} />
    <Route path="*" element={<Location />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  mocks.controller.mockImplementation(input => {
    // Expose callbacks without editing the editor's command behavior.
    return input;
  });
});

describe('document-editor workshop entry', () => {
  it('opens the created document on the existing editor route and retains the return path', () => {
    const returnTo = '/kiosk/assembly/manuals/workshop?model=DFD1&process=assembly';
    show({ returnTo });
    fireEvent.click(screen.getByRole('button', { name: '作成した要領書を開く' }));
    const input = mocks.controller.mock.calls.at(-1)![0];
    expect(input.documentId).toBe('created-document');
    act(() => input.onNavigateBack());
    expect(screen.getByText(returnTo)).toBeInTheDocument();
  });

  it.each(['onNavigateBack', 'onNavigateAfterPublish', 'onNavigateAfterDiscard', 'onNavigateAfterDelete'])('returns to the selected workshop after %s', callback => {
    const returnTo = '/kiosk/assembly/manuals/workshop?model=DFD1&process=assembly';
    show({ returnTo, context: { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立', mode: 'fix' } });
    expect(screen.getByText('DFD1')).toBeInTheDocument();
    const input = mocks.controller.mock.calls.at(-1)![0];
    act(() => input[callback]());
    expect(screen.getByText(returnTo)).toBeInTheDocument();
  });

  it.each([undefined, 'https://outside.example', '//outside.example', '/admin', 42, '/kiosk/../admin', '/kiosk/%2e%2e/admin', 'http://['])('uses the existing return path for an invalid returnTo (%s)', returnTo => {
    show({ returnTo });
    expect(screen.getByText('既存の見出し')).toBeInTheDocument();
    const input = mocks.controller.mock.calls.at(-1)![0];
    act(() => input.onNavigateBack());
    expect(screen.getByText('/kiosk/assembly/library?focus=procedures')).toBeInTheDocument();
  });

  it.each(['/kiosk/assembly/../manuals/workshop?model=DFD1#top', `${window.location.origin}/kiosk/manuals/workshop?model=DFD1#top`])('returns to the normalized pathname and search (%s)', returnTo => {
    show({ returnTo });
    act(() => mocks.controller.mock.calls.at(-1)![0].onNavigateBack());
    expect(screen.getByText('/kiosk/manuals/workshop?model=DFD1')).toBeInTheDocument();
  });

  it.each([null, 'invalid', { modelCode: 'DFD1' },
    { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 42, processName: '組立', mode: 'fix' },
    { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立', mode: 'other' }
  ])('uses the legacy heading for invalid or incomplete context (%j)', context => {
    show({ context });
    expect(screen.getByText('既存の見出し')).toBeInTheDocument();
  });

  it('preserves the legacy after-delete destination and assignment error', () => {
    show({ procedureManualAssignmentError: '割り当てに失敗しました' });
    expect(screen.getByRole('alert')).toHaveTextContent('割り当てに失敗しました');
    const input = mocks.controller.mock.calls.at(-1)![0];
    act(() => input.onNavigateAfterDelete());
    expect(screen.getByText('/kiosk/assembly/manuals')).toBeInTheDocument();
  });
});
