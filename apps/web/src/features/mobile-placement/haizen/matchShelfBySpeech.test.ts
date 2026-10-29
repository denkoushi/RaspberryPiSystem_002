import { describe, expect, it } from 'vitest';

import { matchShelfBySpeech } from './matchShelfBySpeech';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

const shelves: RegisteredShelfEntryDto[] = [
  { shelfCodeRaw: 'DAD-3220 北', machineName: 'ＤＡＤ－３２２０', direction: '北', isStructured: true },
  { shelfCodeRaw: 'DAD-3220 南', machineName: 'DAD-3220', direction: '南', isStructured: true },
  { shelfCodeRaw: '50013_540AP 西', machineName: '50013_540AP', direction: '西', displayLabel: '上段', isStructured: true }
];
describe('matchShelfBySpeech', () => {
  it.each([
    ['3220 北', [0]], ['3220', [0, 1]], ['ディーエーディー 3220 みなみ', [1]],
    ['50013', [2]], ['前回', [1]], ['ぜんかい', [1]], ['ゼンカイ', [1]], ['さくら', []],
    ['  ｄａｄ＿３２２０　きた  ', [0]], ['でぃーえーでぃー 3220 キタ', [0]],
    ['540ap ニシ 上段', [2]], ['', []], ['　 - _ ', []], ['3220 西', []]
  ])('matches %s', (text, indices) => {
    expect(matchShelfBySpeech([text], shelves, ['DAD-3220 南', 'DAD-3220 北'])?.shelves ?? [])
      .toEqual(indices.map((index) => shelves[index]));
  });

  it('tries candidates in order and keeps the first candidate with any matches', () => {
    expect(matchShelfBySpeech(['さくら', '3220', '3220 北'], shelves, []))
      .toEqual({ text: '3220', shelves: [shelves[0], shelves[1]] });
  });
  it.each([{ codes: [] }, { codes: ['missing', 'DAD-3220 北'] }])('does not fall back to a later previous shelf: %j', ({ codes }) => {
    expect(matchShelfBySpeech(['前回'], shelves, codes)).toBeNull();
  });
  it('matches a spoken direction only against the direction field, with or without a space', () => {
    const labelled = [
      { shelfCodeRaw: 'A-1', machineName: 'DAD-3220', direction: '北', displayLabel: 'ロボドリル01 南 上段', isStructured: true },
      { shelfCodeRaw: 'A-2', machineName: 'DAD-3220', direction: '南', isStructured: true }
    ];
    expect(matchShelfBySpeech(['3220 南'], labelled, [])?.shelves).toEqual([labelled[1]]);
    expect(matchShelfBySpeech(['3220南'], labelled, [])?.shelves).toEqual([labelled[1]]);
  });
  it('matches common alphabet readings and east direction', () => {
    const shelf = { shelfCodeRaw: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 東', isStructured: false };
    expect(matchShelfBySpeech(['エービーシーディーイーエフジーエイチアイジェーケーエルエムエヌオーピーキューアールエスティーユーブイダブリューエックスワイゼット ひがし'], [shelf], [])?.shelves)
      .toEqual([shelf]);
  });
});
