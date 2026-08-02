export const KIOSK_SOP_CLOSE_MESSAGE = 'raspi:kiosk-sop:close';
export const KIOSK_SOP_FOCUS_CLOSE_MESSAGE = 'raspi:kiosk-sop:focus-close';

const SHEET_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const EMBED_STYLE_ID = 'kiosk-sop-embed-style';
const EMBED_SCRIPT_ID = 'kiosk-sop-embed-script';

function assertEmbeddableSource(sourceHtml: string, sheetId: string): void {
  if (!SHEET_ID_PATTERN.test(sheetId)) {
    throw new Error(`Invalid kiosk SOP sheet id: ${sheetId}`);
  }
  if (!sourceHtml.includes('</head>')) {
    throw new Error('Kiosk SOP source must contain </head>.');
  }
  if (!sourceHtml.includes('</body>')) {
    throw new Error('Kiosk SOP source must contain </body>.');
  }
  if (!sourceHtml.includes(`data-sheet="${sheetId}"`)) {
    throw new Error(`Kiosk SOP source does not contain sheet: ${sheetId}`);
  }
}

/**
 * Adapts the immutable print-oriented SOP source for one isolated kiosk view.
 * The sheet id is restricted before it is interpolated into CSS or selectors.
 */
export function buildKioskSopSrcDoc(sourceHtml: string, sheetId: string): string {
  assertEmbeddableSource(sourceHtml, sheetId);

  const embedStyle = `
<style id="${EMBED_STYLE_ID}">
  html,
  body {
    width: 100%;
    height: 100%;
    min-height: 0 !important;
    overflow: hidden !important;
    background: #0f172a !important;
  }
  body {
    display: grid !important;
    place-items: center !important;
    gap: 0 !important;
    padding: 0 !important;
  }
  .bar {
    display: none !important;
  }
  .sheet {
    display: none !important;
    width: 100dvw !important;
    height: 100dvh !important;
    max-width: none !important;
    margin: 0 !important;
    box-shadow: none !important;
  }
  .sheet[data-sheet="${sheetId}"] {
    display: grid !important;
  }
  .stage button,
  .stage input,
  .stage select,
  .stage textarea,
  .stage a {
    pointer-events: none !important;
  }
</style>`;

  const embedScript = `
<script id="${EMBED_SCRIPT_ID}">
(() => {
  const selectedSheet = document.querySelector('.sheet[data-sheet="${sheetId}"]');
  if (!selectedSheet) return;

  selectedSheet
    .querySelectorAll('.stage button, .stage input, .stage select, .stage textarea, .stage a')
    .forEach((element) => element.setAttribute('tabindex', '-1'));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      parent.postMessage('${KIOSK_SOP_CLOSE_MESSAGE}', '*');
      return;
    }
    if (event.key !== 'Tab') return;

    const steps = Array.from(selectedSheet.querySelectorAll('.step-item'));
    const first = steps[0];
    const last = steps[steps.length - 1];
    const leavingBackward = event.shiftKey && event.target === first;
    const leavingForward = !event.shiftKey && event.target === last;
    if (!leavingBackward && !leavingForward) return;

    event.preventDefault();
    parent.postMessage('${KIOSK_SOP_FOCUS_CLOSE_MESSAGE}', '*');
  });
})();
</script>`;

  return sourceHtml
    .replace('</head>', `${embedStyle}\n</head>`)
    .replace('</body>', `${embedScript}\n</body>`);
}
