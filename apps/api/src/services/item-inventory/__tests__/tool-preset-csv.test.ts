import { describe, expect, it } from 'vitest';

import { parseToolPresetCsv } from '../tool-preset-csv.js';

const CSV = `No.,径,材質,削り方向,型番,在庫数,メーカー
1,φ100,鉄・サス,上面,SOMT140520ER-GM / PR1525,7ケース,京セラ
2,φ20・50・100・125,アルミ,上面・側面,LOGT100408PFR-AM / GW25,1ケース,京セラ
15,φ50,鋳物,上面,LNC?0906R-50S / GH110,1ケース,タンガロイ
`;

describe('parseToolPresetCsv', () => {
  it('maps columns to fields, splits ・ values and keeps model numbers whole', () => {
    const { presets } = parseToolPresetCsv(CSV);
    const of = (field: string) => presets.filter((entry) => entry.field === field).map((entry) => entry.value);

    expect(of('toolSize')).toEqual(['φ100', 'φ20', 'φ50', 'φ125']);
    expect(of('workMaterial')).toEqual(['鉄', 'サス', 'アルミ', '鋳物']);
    expect(of('usage')).toEqual(['上面', '側面']);
    expect(of('model')).toEqual(['SOMT140520ER-GM / PR1525', 'LOGT100408PFR-AM / GW25', 'LNC?0906R-50S / GH110']);
    expect(of('maker')).toEqual(['京セラ', 'タンガロイ']);
  });

  it('warns about unreadable characters and missing columns', () => {
    expect(parseToolPresetCsv(CSV).warnings).toEqual(['4行目 型番「LNC?0906R-50S / GH110」に読めない文字（?）があります']);
    expect(parseToolPresetCsv('No.,径\n1,φ10\n').warnings).toContain('列「メーカー」がありません');
  });
});
