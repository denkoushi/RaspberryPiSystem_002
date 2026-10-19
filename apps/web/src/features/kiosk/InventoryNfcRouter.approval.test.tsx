import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveInventoryTag, resolveProcedureManualApprover } from '../../api/client';
import { AssemblyProcedureDocumentPublishDialog } from '../assembly/document-editor/AssemblyProcedureDocumentPublishDialog';

import { InventoryNfcRouter } from './InventoryNfcRouter';

vi.mock('../../api/client', () => ({
  resolveInventoryTag: vi.fn(),
  resolveProcedureManualApprover: vi.fn(),
}));

type TestSocket = { close: ReturnType<typeof vi.fn>; onmessage?: (message: MessageEvent) => void };
const sockets: TestSocket[] = [];
const editorPath = '/kiosk/assembly/procedure-documents/document-1/edit';

vi.mock('../../api/hooks/item-inventory', () => ({ useInventoryTags: vi.fn() }));

function Driver() {
  const location = useLocation();
  const [publishOpen, setPublishOpen] = useState(true);
  return <>
    <output data-testid="path">{location.pathname}</output>
    <InventoryNfcRouter />
    {publishOpen ? <AssemblyProcedureDocumentPublishDialog
      busy={false}
      error={null}
      onPublish={async () => true}
      onClose={() => setPublishOpen(false)}
    /> : null}
  </>;
}

function scan(uid: string, eventId: number) {
  sockets[sockets.length - 1].onmessage?.({ data: JSON.stringify({
    uid, eventId, timestamp: new Date(Date.now() + 1000).toISOString(),
  }) } as MessageEvent);
}

describe('InventoryNfcRouter with procedure document approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    sockets.length = 0;
    vi.stubEnv('VITE_AGENT_WS_URL', 'ws://localhost:7071/stream');
    vi.stubEnv('VITE_AGENT_WS_MODE', 'local');
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux armv7l) Chrome/120');
    vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () {
      const socket: TestSocket = { close: vi.fn() };
      sockets.push(socket);
      return socket;
    }));
    vi.mocked(resolveProcedureManualApprover).mockResolvedValue({ displayName: '承認者', positionName: '班長', rank: 'LEADER' });
    vi.mocked(resolveInventoryTag).mockResolvedValue({ uid: 'item-uid', kind: 'ITEM' } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.sessionStorage.clear();
  });

  it('reads the approver tag without calling the inventory classification API', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[editorPath]}><Driver /></MemoryRouter></QueryClientProvider>);

    await act(async () => { scan('employee-private-uid', 100); });

    await waitFor(() => expect(screen.getByText('承認者: 承認者(班長)')).toBeInTheDocument());
    expect(resolveProcedureManualApprover).toHaveBeenCalledExactlyOnceWith('employee-private-uid');
    expect(resolveInventoryTag).not.toHaveBeenCalled();
    expect(screen.getByTestId('path')).toHaveTextContent(editorPath);
  });

  it('resumes inventory classification after closing the approval dialog', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[editorPath]}><Driver /></MemoryRouter></QueryClientProvider>);

    // Closing before the queued scan is processed must not expose the employee UID.
    await act(async () => {
      scan('employee-private-uid', 101);
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(resolveInventoryTag).not.toHaveBeenCalled();

    await act(async () => { scan('item-uid', 102); });

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/kiosk/inventory'));
    expect(resolveInventoryTag).toHaveBeenCalledExactlyOnceWith('item-uid');
  });
});
