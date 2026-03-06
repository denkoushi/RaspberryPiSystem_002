import { describe, expect, it } from 'vitest';

import { moveHistoryItemLeft, moveHistoryItemRight } from './historyOrder';

describe('moveHistoryItemLeft', () => {
  it('中央要素を左に1つ移動する', () => {
    const history = ['A', 'B', 'C', 'D'];
    expect(moveHistoryItemLeft(history, 'C')).toEqual(['A', 'C', 'B', 'D']);
  });

  it('先頭の要素は左移動でno-op', () => {
    const history = ['A', 'B', 'C'];
    expect(moveHistoryItemLeft(history, 'A')).toEqual(history);
  });

  it('対象未存在時はno-op', () => {
    const history = ['A', 'B', 'C'];
    expect(moveHistoryItemLeft(history, 'X')).toEqual(history);
  });

  it('配列長1の場合はno-op', () => {
    const history = ['A'];
    expect(moveHistoryItemLeft(history, 'A')).toEqual(history);
  });

  it('2番目の要素を左に移動すると先頭になる', () => {
    const history = ['A', 'B', 'C'];
    expect(moveHistoryItemLeft(history, 'B')).toEqual(['B', 'A', 'C']);
  });
});

describe('moveHistoryItemRight', () => {
  it('中央要素を右に1つ移動する', () => {
    const history = ['A', 'B', 'C', 'D'];
    expect(moveHistoryItemRight(history, 'B')).toEqual(['A', 'C', 'B', 'D']);
  });

  it('末尾の要素は右移動でno-op', () => {
    const history = ['A', 'B', 'C'];
    expect(moveHistoryItemRight(history, 'C')).toEqual(history);
  });

  it('対象未存在時はno-op', () => {
    const history = ['A', 'B', 'C'];
    expect(moveHistoryItemRight(history, 'X')).toEqual(history);
  });

  it('配列長1の場合はno-op', () => {
    const history = ['A'];
    expect(moveHistoryItemRight(history, 'A')).toEqual(history);
  });

  it('末尾の1つ前を右に移動すると末尾になる', () => {
    const history = ['A', 'B', 'C'];
    expect(moveHistoryItemRight(history, 'B')).toEqual(['A', 'C', 'B']);
  });
});
