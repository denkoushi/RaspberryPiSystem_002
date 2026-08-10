import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureUploadModal } from './AssemblyProcedureUploadModal';

const { previewMock, uploadMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  uploadMock: vi.fn()
}));

vi.mock('../../api/client', () => ({
  previewAssemblyProcedureDocument: previewMock,
  uploadAssemblyProcedureDocument: uploadMock
}));

const document = {
  id: 'doc-1',
  name: '手順書',
  imageRelativePath: '/page-1.png',
  status: 'draft' as const,
  publishedAt: null,
  isActive: true,
  pages: [{ pageIndex: 0, imageRelativePath: '/page-1.png' }],
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z'
};

describe('AssemblyProcedureUploadModal', () => {
  beforeEach(() => {
    previewMock.mockReset();
    uploadMock.mockReset();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn()
    });
  });

  it('opens the parent all-page confirmation immediately after registration', async () => {
    previewMock.mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
    uploadMock.mockResolvedValue(document);
    const onSuccess = vi.fn();
    render(<AssemblyProcedureUploadModal isOpen onClose={vi.fn()} onSuccess={onSuccess} />);

    const file = new File(['pdf'], 'assembly-guide.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('ファイル'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '先頭ページを確認' }));
    await screen.findByAltText('手順書の先頭ページプレビュー');
    fireEvent.click(screen.getByRole('button', { name: '下書きとして登録' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(document));
    expect(screen.queryByRole('button', { name: 'ライブラリへ' })).not.toBeInTheDocument();
  });
});
