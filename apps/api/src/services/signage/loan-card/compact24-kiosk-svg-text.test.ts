import { describe, expect, it } from 'vitest';
import { buildCompact24KioskSvgBody } from './compact24-kiosk-svg-text.js';

describe('buildCompact24KioskSvgBody', () => {
  it('places rigging id on head right and splits name vs location', () => {
    const body = buildCompact24KioskSvgBody(
      {
        headLine: 'RG-9',
        nameLine: '吊具A',
        idNumValue: '501',
      },
      '工場1',
      20,
      24,
      12
    );
    expect(body.headLeft).toContain('RG');
    expect(body.headRight).toMatch(/^501/);
    expect(body.nameLine1).toContain('吊');
    expect(body.locLine1.length).toBeGreaterThan(0);
  });

  it('uses single location row when name spans two lines', () => {
    const longName = 'あ'.repeat(80);
    const body = buildCompact24KioskSvgBody(
      { headLine: 'RG-1', nameLine: longName },
      'LOC',
      14,
      14,
      6
    );
    expect(body.nameLine2.length).toBeGreaterThan(0);
    expect(body.locLine2).toBe('');
  });
});
