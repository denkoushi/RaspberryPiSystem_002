import type { DraftEntity } from '../model/shelfLayoutTypes';

export type RelocateEmphasis = 'source' | 'target' | null;

export type RelocateFlowGates = {
  statusText: string;
  emphasize: RelocateEmphasis;
  isCellActionable: (entity: DraftEntity | null) => boolean;
  cellsDisabled: boolean;
};

export function getRelocateFlowGates(input: {
  relocateSource: string | null;
  relocatePending: boolean;
}): RelocateFlowGates {
  if (input.relocatePending) {
    return {
      statusText: '処理中…',
      emphasize: null,
      isCellActionable: () => false,
      cellsDisabled: true
    };
  }

  if (!input.relocateSource) {
    return {
      statusText: '移動元の部品置き場をタップ',
      emphasize: 'source',
      isCellActionable: (entity) => entity?.entityKind === 'SHELF' && !!entity.shelfCodeRaw,
      cellsDisabled: false
    };
  }

  return {
    statusText: `移動元: ${input.relocateSource} — 移動先をタップ`,
    emphasize: 'target',
    isCellActionable: (entity) =>
      entity?.entityKind === 'SHELF' &&
      !!entity.shelfCodeRaw &&
      entity.shelfCodeRaw !== input.relocateSource,
    cellsDisabled: false
  };
}
