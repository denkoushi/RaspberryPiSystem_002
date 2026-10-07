import { describe, expect, it } from 'vitest';

import { isOperationGuideQuestion } from './questionMatcher';

describe('conservative authoring question detection', () => {
  it.each(['手順書の作り方', '手順書はどうやって作るの?', '手順書を編集したい', '組立の手順書を登録したい', '手順書の編集方法を教えて', ' 手順書の作成方法？ ', '手順書ってどうやって編集するの？'])('handles %s locally', text => {
    expect(isOperationGuideQuestion(text)).toBe(true);
  });
  it.each(['品番ABCの不適合は?', '手順書ABCの不適合は?', '手順書を編集したい。不適合も調べて', '手順書の作り方に不適合がある', '品番ABCの手順書の作り方', '手順書を検索したい', '加工の手順書を編集したい', '白紙から要領書を作りたい', '公開済み手順書の内容は?', '', '作り方を教えて'])('keeps %s on the existing route', text => {
    expect(isOperationGuideQuestion(text)).toBe(false);
  });
});
