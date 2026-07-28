import { describe, expect, it } from 'vitest';

import { buildKioskSopSrcDoc } from './buildKioskSopSrcDoc';

const SOURCE = `<!doctype html>
<html>
<head><title>SOP</title></head>
<body>
  <div class="bar">print</div>
  <article class="sheet" data-sheet="library"></article>
  <article class="sheet" data-sheet="edit"></article>
</body>
</html>`;

describe('buildKioskSopSrcDoc', () => {
  it('injects one allowlisted sheet selector without mutating the source', () => {
    const before = SOURCE;
    const result = buildKioskSopSrcDoc(SOURCE, 'library');

    expect(SOURCE).toBe(before);
    expect(result).toContain('id="kiosk-sop-embed-style"');
    expect(result).toContain('.sheet[data-sheet="library"]');
    expect(result).toContain('id="kiosk-sop-embed-script"');
    expect(result).toContain("parent.postMessage('raspi:kiosk-sop:close', '*')");
    expect(result).toContain("parent.postMessage('raspi:kiosk-sop:focus-close', '*')");
    expect(result).not.toContain('.sheet[data-sheet="edit"] {\n    display: grid !important;');
  });

  it('rejects unsafe, unknown, and malformed sources', () => {
    expect(() => buildKioskSopSrcDoc(SOURCE, 'library"]{}')).toThrow(
      'Invalid kiosk SOP sheet id'
    );
    expect(() => buildKioskSopSrcDoc(SOURCE, 'missing')).toThrow(
      'does not contain sheet: missing'
    );
    expect(() => buildKioskSopSrcDoc('<html><body></body></html>', 'library')).toThrow(
      'must contain </head>'
    );
    expect(() =>
      buildKioskSopSrcDoc(
        '<html><head></head><article data-sheet="library"></article></html>',
        'library'
      )
    ).toThrow('must contain </body>');
  });
});
