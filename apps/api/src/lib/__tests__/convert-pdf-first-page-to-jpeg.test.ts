import { describe, expect, it } from 'vitest';

import { buildPdftoppmFirstPageArgs } from '../convert-pdf-first-page-to-jpeg.js';

describe('buildPdftoppmFirstPageArgs', () => {
  it('fixes first page singlefile jpeg contract', () => {
    expect(
      buildPdftoppmFirstPageArgs('/tmp/in.pdf', '/tmp/out/page', 144, 85)
    ).toEqual([
      '-f',
      '1',
      '-l',
      '1',
      '-singlefile',
      '-jpeg',
      '-r',
      '144',
      '-jpegopt',
      'quality=85',
      '/tmp/in.pdf',
      '/tmp/out/page'
    ]);
  });
});
