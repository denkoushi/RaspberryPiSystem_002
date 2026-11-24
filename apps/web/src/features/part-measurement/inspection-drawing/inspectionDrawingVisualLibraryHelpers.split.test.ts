import { describe, expect, it } from 'vitest';

import { splitVisualNameIntoPartNumberAndName } from './inspectionDrawingVisualLibraryHelpers';

describe('splitVisualNameIntoPartNumberAndName', () => {
  it.each([
    ['MD005096983 ストッパー台（1）', 'MD005096983', 'ストッパー台（1）'],
    ['3351-MD005281340 ナットホルダー', '3351-MD005281340', 'ナットホルダー'],
    ['MD005279980 共削り加工図（ベース+スタンド） 2版', 'MD005279980', '共削り加工図（ベース+スタンド） 2版'],
    ['MD000000001　全角空白', 'MD000000001', '全角空白'],
    ['  MD000000002   前後の空白  ', 'MD000000002', '前後の空白'],
    ['7161テーブル', '7161テーブル', '']
  ])('%s', (name, partNumber, partName) => {
    expect(splitVisualNameIntoPartNumberAndName(name)).toEqual({ partNumber, partName });
  });
});
