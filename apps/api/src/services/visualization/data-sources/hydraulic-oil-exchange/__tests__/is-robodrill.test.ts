import { describe, expect, it } from 'vitest';
import { isRobodrill } from '../is-robodrill.js';

describe('isRobodrill', () => {
  it.each(['ROBODRIL', 'robodril', 'ROBODRILL', 'ROBO-DRILL', 'ROBO_DRIL', 'robo drill', 'ＲＯＢＯ－ＤＲＩＬ', 'ロボドリル', 'ﾛﾎﾞﾄﾞﾘﾙ', 'FANUC ROBODRIL α'])('excludes %s', (name) => {
    expect(isRobodrill(name)).toBe(true);
  });
  it('keeps INTEGREX_1500U and empty names', () => {
    expect(isRobodrill('INTEGREX_1500U', null, undefined, '')).toBe(false);
  });
  it('checks all supplied names', () => {
    expect(isRobodrill('other', 'ROBODRIL')).toBe(true);
  });
});
