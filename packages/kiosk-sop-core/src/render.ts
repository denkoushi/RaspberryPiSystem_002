import type { KioskSopDefinition, KioskSopStep } from './types.js';
import { validateKioskSopDefinition } from './validate.js';

export const KIOSK_SOP_TOKENS = Object.freeze({
  required: { color: '#C2410C', background: '#FFF7ED', width: 3, dash: '' },
  optional: { color: '#64748B', background: '#F8FAFC', width: 2, dash: '8 6' }
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] ?? character);
}

function renderStep(step: KioskSopStep, index: number): string {
  const label = step.necessity === 'required' ? '必須' : '任意';
  return `<button class="step-item ${step.necessity}" type="button" data-step="${index + 1}" data-target="${escapeHtml(step.targetId)}"><span class="step-number">${index + 1}</span><span class="step-copy"><span class="necessity">${label}</span><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.description)}</small></span></button>`;
}

export function renderKioskSopHtml(input: KioskSopDefinition): string {
  const definition = validateKioskSopDefinition(input);
  const sheets = definition.scenarios.flatMap((scenario) => scenario.sheets).map((sheet, sheetIndex, allSheets) => {
    const lines = sheet.steps.map((step, index) => {
      const token = KIOSK_SOP_TOKENS[step.necessity];
      return `<line data-line="${index + 1}" x1="18%" y1="${12 + index * Math.min(10, 70 / sheet.steps.length)}%" x2="${step.target.x * 100}%" y2="${step.target.y * 100}%" stroke="${token.color}" stroke-width="${token.width}" stroke-dasharray="${token.dash}"/>`;
    }).join('');
    return `<main class="sheet" data-sheet="${sheet.id}"><header class="sheet-head"><div><p>${escapeHtml(definition.title)}</p><h1>${escapeHtml(sheet.title)}</h1><span>${escapeHtml(sheet.summary)}</span></div><b>${sheetIndex + 1} / ${allSheets.length}</b></header><section class="body"><nav class="step-rail">${sheet.steps.map(renderStep).join('')}</nav><div class="stage"><img alt="${escapeHtml(sheet.title)}の実画面" src="${sheet.screenImageDataUrl}"><svg class="leader-layer" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>${sheet.steps.map((step, index) => `<span class="pin ${step.necessity}" data-pin="${index + 1}" style="left:${step.target.x * 100}%;top:${step.target.y * 100}%">${index + 1}</span>`).join('')}</div></section></main>`;
  }).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(definition.title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#0f172a;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif}.bar{padding:12px;color:white}.sheet{width:1280px;height:720px;margin:24px auto;background:white;display:grid;grid-template-rows:82px 1fr;overflow:hidden}.sheet-head{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:#172554;color:white}.sheet-head p,.sheet-head h1,.sheet-head span{margin:0}.sheet-head p{font-size:12px;color:#bfdbfe}.sheet-head h1{font-size:24px}.sheet-head span{font-size:13px;color:#dbeafe}.sheet-head b{font-size:18px}.body{display:grid;grid-template-columns:330px 1fr;min-height:0}.step-rail{padding:10px;display:flex;flex-direction:column;gap:7px;overflow:auto;background:#f8fafc;border-right:1px solid #cbd5e1}.step-item{min-height:54px;text-align:left;display:flex;gap:9px;align-items:center;border-radius:8px;padding:7px;background:white;cursor:pointer}.step-item.required{border:2px solid ${KIOSK_SOP_TOKENS.required.color};background:${KIOSK_SOP_TOKENS.required.background}}.step-item.optional{border:1.5px solid #94A3B8;background:${KIOSK_SOP_TOKENS.optional.background}}.step-number{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#0f172a;color:white;font-weight:800;flex:none}.step-copy{display:grid;grid-template-columns:auto 1fr;column-gap:6px;align-items:center}.step-copy small{grid-column:1/-1;color:#475569}.necessity{font-size:10px;font-weight:800;border:1px solid currentColor;border-radius:4px;padding:1px 4px}.required .necessity{color:#9A3412}.optional .necessity{color:#64748B}.stage{position:relative;overflow:hidden;background:#e2e8f0}.stage>img{width:100%;height:100%;object-fit:contain;display:block}.leader-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.leader-layer line{opacity:.28;vector-effect:non-scaling-stroke}.step-item:focus-visible{outline:3px solid #2563eb;outline-offset:1px}.sheet:has(.step-item:hover) .leader-layer line,.sheet:has(.step-item:focus) .leader-layer line{opacity:.08}.sheet:has(.step-item[data-step="1"]:hover) [data-line="1"],.sheet:has(.step-item[data-step="1"]:focus) [data-line="1"],.sheet:has(.step-item[data-step="2"]:hover) [data-line="2"],.sheet:has(.step-item[data-step="2"]:focus) [data-line="2"],.sheet:has(.step-item[data-step="3"]:hover) [data-line="3"],.sheet:has(.step-item[data-step="3"]:focus) [data-line="3"],.sheet:has(.step-item[data-step="4"]:hover) [data-line="4"],.sheet:has(.step-item[data-step="4"]:focus) [data-line="4"],.sheet:has(.step-item[data-step="5"]:hover) [data-line="5"],.sheet:has(.step-item[data-step="5"]:focus) [data-line="5"],.sheet:has(.step-item[data-step="6"]:hover) [data-line="6"],.sheet:has(.step-item[data-step="6"]:focus) [data-line="6"],.sheet:has(.step-item[data-step="7"]:hover) [data-line="7"],.sheet:has(.step-item[data-step="7"]:focus) [data-line="7"],.sheet:has(.step-item[data-step="8"]:hover) [data-line="8"],.sheet:has(.step-item[data-step="8"]:focus) [data-line="8"]{opacity:1}.pin{position:absolute;transform:translate(-50%,-50%);width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:white;font-weight:800;box-shadow:0 1px 4px #0008}.pin.required{background:${KIOSK_SOP_TOKENS.required.color}}.pin.optional{background:${KIOSK_SOP_TOKENS.optional.color};opacity:.82}@media print{.leader-layer{display:none}.sheet{margin:0;break-after:page}}
</style></head><body><div class="bar">生成済み取説 — 編集禁止</div>${sheets}</body></html>`;
}
