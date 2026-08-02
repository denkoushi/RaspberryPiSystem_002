import { renderKioskSopRuntimeScript } from './runtime.js';
import { renderKioskSopStyles } from './styles.js';
import { KIOSK_SOP_TOKENS } from './tokens.js';
import type { KioskSopDefinition, KioskSopStep } from './types.js';
import { validateKioskSopDefinition } from './validate.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] ?? character);
}

function renderStep(step: KioskSopStep, index: number): string {
  const label = step.necessity === 'required' ? '必須' : '任意';
  return `<button class="step-item ${step.necessity}" type="button" aria-pressed="false" data-step="${index + 1}" data-target="${escapeHtml(step.targetId)}"><span class="step-number">${index + 1}</span><span class="step-copy"><span class="necessity">${label}</span><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.description)}</small></span></button>`;
}

export function renderKioskSopHtml(input: KioskSopDefinition): string {
  const definition = validateKioskSopDefinition(input);
  const sheetRows = definition.scenarios.flatMap((scenario) =>
    scenario.sheets.map((sheet) => ({ sheet, viewport: scenario.viewport }))
  );
  const sheets = sheetRows.map(({ sheet, viewport }, sheetIndex) => {
    const lines = sheet.steps.map((step, index) => {
      const token = KIOSK_SOP_TOKENS[step.necessity];
      return `<line class="${step.necessity}" data-line="${index + 1}" x1="0" y1="0" x2="0" y2="0" stroke="${token.color}" stroke-width="${token.width}" stroke-dasharray="${token.dash}"/>`;
    }).join('');
    const pins = sheet.steps.map((step, index) =>
      `<span class="pin ${step.necessity}" data-pin="${index + 1}" data-target-x="${step.target.x}" data-target-y="${step.target.y}">${index + 1}</span>`
    ).join('');
    return `<main class="sheet" data-sheet="${sheet.id}"><header class="sheet-head"><div><p>${escapeHtml(definition.title)}</p><h1>${escapeHtml(sheet.title)}</h1><span>${escapeHtml(sheet.summary)}</span></div><b>${sheetIndex + 1} / ${sheetRows.length}</b></header><section class="body"><nav class="step-rail">${sheet.steps.map(renderStep).join('')}</nav><div class="stage" data-screen-width="${viewport.width}" data-screen-height="${viewport.height}"><img alt="${escapeHtml(sheet.title)}の実画面" src="${sheet.screenImageDataUrl}">${pins}</div><svg class="leader-layer" aria-hidden="true" preserveAspectRatio="none">${lines}</svg></section></main>`;
  }).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(definition.title)}</title>${renderKioskSopStyles()}</head><body><div class="bar">生成済み取説 — 編集禁止</div>${sheets}${renderKioskSopRuntimeScript()}</body></html>`;
}

export { KIOSK_SOP_TOKENS } from './tokens.js';
