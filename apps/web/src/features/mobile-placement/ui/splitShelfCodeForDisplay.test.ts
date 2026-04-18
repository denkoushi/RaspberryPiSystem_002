import { describe, expect, it } from 'vitest';

import { splitShelfCodeForDisplay } from './splitShelfCodeForDisplay';

describe('splitShelfCodeForDisplay', () => {
  it('末尾数字を分離する', () => {
    expect(splitShelfCodeForDisplay('西-北-02')).toEqual({ prefix: '西-北-', num: '02' });
  });

  it('数字が無い場合は全文を接頭辞にする', () => {
    expect(splitShelfCodeForDisplay('A-棚')).toEqual({ prefix: 'A-棚', num: '' });
  });

  it('空白をトリムする', () => {
    expect(splitShelfCodeForDisplay('  西-北-01  ')).toEqual({ prefix: '西-北-', num: '01' });
  });
});
