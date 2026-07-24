import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskAssemblyPage } from './KioskAssemblyPage';

const { ingestMock } = vi.hoisted(() => ({
  ingestMock: vi.fn()
}));

vi.mock('../../api/client', () => ({
  ingestAssemblyProcedureDocumentsFromGmail: ingestMock,
  listAssemblyTemplateSummaries: vi.fn(async () => []),
  retireAssemblyTemplate: vi.fn()
}));

vi.mock('../../features/assembly', () => ({
  AssemblyProcedureLibrarySection: (props: {
    refreshToken?: number;
    onImportClick?: () => void;
    importing?: boolean;
    importMessage?: string | null;
  }) => (
    <section>
      <span data-testid="procedure-refresh-token">{props.refreshToken ?? 0}</span>
      <button type="button" disabled={props.importing} onClick={props.onImportClick}>
        {props.importing ? '取込中…' : '取込'}
      </button>
      {props.importMessage ? <p>{props.importMessage}</p> : null}
    </section>
  ),
  AssemblyProcedureUploadModal: () => null,
  AssemblyTemplateHistoryDialog: () => null,
  AssemblyTemplateLibraryTable: () => null,
  KIOSK_ASSEMBLY_HOME_PATH: '/kiosk/assembly',
  parseAssemblyLibrarySearch: () => ({}),
  readAssemblyApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  useAssemblyLibraryFilterOptions: () => ({
    options: [],
    loading: false,
    error: null
  }),
  useAssemblyTemplateLibrary: () => ({
    filters: {
      q: '',
      modelCode: '',
      procedurePattern: '',
      procedureDocumentName: '',
      includeInactive: false
    },
    templates: [],
    loading: false,
    error: null,
    hasActiveFilters: false,
    setQ: vi.fn(),
    setModelCode: vi.fn(),
    setProcedurePattern: vi.fn(),
    setProcedureDocumentName: vi.fn(),
    setIncludeInactive: vi.fn(),
    reload: vi.fn(),
    resetFilters: vi.fn()
  })
}));

function importResult(overrides: Partial<{
  imported: number;
  duplicates: number;
  failed: number;
  remainingInInbox: number;
  items: Array<{
    messageId: string;
    filename: string | null;
    status: 'imported' | 'duplicate' | 'import_failed' | 'cleanup_failed';
    document: null;
    error: string | null;
  }>;
}> = {}) {
  return {
    query: 'in:inbox is:unread subject:"DocumentASM"',
    scanned: 0,
    exactMatched: 0,
    subjectMismatchSkipped: 0,
    attempted: 0,
    imported: 0,
    duplicates: 0,
    trashed: 0,
    failed: 0,
    remainingInInbox: 0,
    items: [],
    ...overrides
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <KioskAssemblyPage />
    </MemoryRouter>
  );
}

describe('KioskAssemblyPage Gmail procedure import', () => {
  beforeEach(() => {
    ingestMock.mockReset();
  });

  it('disables the action while importing and refreshes the library after a new draft', async () => {
    let resolveImport!: (value: ReturnType<typeof importResult>) => void;
    ingestMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveImport = resolve;
      })
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '取込' }));
    expect(screen.getByRole('button', { name: '取込中…' })).toBeDisabled();

    resolveImport(importResult({ imported: 1 }));
    await waitFor(() => expect(screen.getByTestId('procedure-refresh-token')).toHaveTextContent('1'));
    expect(screen.getByText(/取り込んだ手順書は下書きです/)).toBeInTheDocument();
  });

  it('does not refresh the library when no target mail exists', async () => {
    ingestMock.mockResolvedValueOnce(importResult());
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '取込' }));

    await screen.findByText(/Gmail取込: 新規0件、重複0件、失敗0件/);
    expect(screen.getByTestId('procedure-refresh-token')).toHaveTextContent('0');
  });

  it('shows an actionable per-file reason for a partial failure', async () => {
    ingestMock.mockResolvedValueOnce(
      importResult({
        imported: 1,
        failed: 1,
        remainingInInbox: 1,
        items: [
          {
            messageId: 'message-failed',
            filename: '壊れた手順書.pdf',
            status: 'import_failed',
            document: null,
            error: 'PDF ファイルの形式が不正です'
          }
        ]
      })
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '取込' }));

    expect(
      await screen.findByText(/壊れた手順書\.pdf: PDF ファイルの形式が不正です/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('procedure-refresh-token')).toHaveTextContent('1');
  });
});
