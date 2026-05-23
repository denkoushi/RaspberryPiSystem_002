import type { ShelfLayoutEntityDto } from '../../../../api/client';

/** レイアウト編集ドラフト（保存前。id は既存行のみ） */
export type DraftEntity = Omit<ShelfLayoutEntityDto, 'id'> & { id?: string };

export type LayoutDraftSnapshot = {
  gridSize: 3 | 4;
  entities: DraftEntity[];
};
