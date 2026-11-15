import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentEditorMaterials } from './DocumentEditorMaterials';

import type { ProcedureMaterialDto } from '../procedure-manuals/procedure-material-types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), thumbnail: vi.fn(async () => new Blob()) }));
vi.mock('../../../api/client', () => ({ listProcedureMaterials: mocks.list, getProcedureMaterialThumbnail: mocks.thumbnail }));
const material = { id: 'text', kind: 'TEXT', text: '未配置の文章', placedAt: null, discardedAt: null, documentId: null } as ProcedureMaterialDto;
beforeEach(() => vi.clearAllMocks());
describe('DocumentEditorMaterials', () => {
  it('loads only the normal unplaced shelf and excludes PDF, placed and discarded materials', async () => {
    mocks.list.mockResolvedValue([material, { ...material, id: 'pdf', kind: 'PDF' }, { ...material, id: 'placed', placedAt: 'now' }, { ...material, id: 'discarded', discardedAt: 'now' }]);
    const drag = { onClick: vi.fn(), onPointerDown: vi.fn() };
    const view = render(<DocumentEditorMaterials revision={0} disabled={false} drag={drag} />);
    const card = await screen.findByRole('button', { name: '素材を置く: 未配置の文章' });
    expect(card.style.touchAction).toBe('pan-y');
    expect(card.style.userSelect).toBe('none');
    expect(fireEvent.contextMenu(card)).toBe(false);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ state: 'unplaced', limit: 500 });
    fireEvent.click(card);
    expect(drag.onClick).toHaveBeenCalledExactlyOnceWith(material);
    view.rerender(<DocumentEditorMaterials revision={1} disabled drag={drag} />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(card).toBeDisabled();
  });
  it('reports list failures near the material cards', async () => {
    mocks.list.mockRejectedValue(new Error('offline'));
    render(<DocumentEditorMaterials revision={0} disabled={false} drag={{ onClick: vi.fn(), onPointerDown: vi.fn() }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('素材を取得できませんでした。');
  });
});
