import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';
import { buildPlanningBoardGanttLayout } from '../gantt/planningBoardGanttLayout';
import { PlanningBoardGanttView } from '../gantt/PlanningBoardGanttView';

import { productionFixture } from './fixture';

it('preserves the original bar, star, now-line, heading and track geometry at every scale', () => {
  const fixture = productionFixture(12, 3);
  const digests: Record<string, string> = {};
  for (const hours of [8, 10, 24] as const) for (const scale of [1, 2, 4, 14, 56]) {
    const layout = buildPlanningBoardGanttLayout({ ...fixture.options, scale,
      dailyHoursByResource: Object.fromEntries(fixture.resources.map((resource) => [resource, hours])) });
    const rows = new Map(fixture.seibans.map((fseiban) => [fseiban, { fseiban, outsourceMarks: [], memo: null,
      surfaceSendOutDates: [{ date: '2026-11-05', note: null }, { date: '2026-11-07', note: null }] }]));
    const view = render(<DScheduleMinutesContext.Provider value={{ dueSource: 'scaw', rows }}>
      <PlanningBoardGanttView layout={layout} scale={scale} dailyHoursByResource={Object.fromEntries(fixture.resources.map((resource) => [resource, hours]))}
        resourceNameMap={{}} capacityPending={false} capacityError={false} onCapacityChange={vi.fn()}
        onToggleItem={vi.fn()} onDueDrop={vi.fn()} disabled={false} dragDisabled={false} selectedItemIds={new Set(['item-0000'])}
        resourceView focusedSeiban={null} onFocusedSeibanChange={vi.fn()} colorBySeiban />
    </DScheduleMinutesContext.Provider>);
    const viewport = view.getByLabelText('ガントの日付と工程');
    const geometry = [...view.container.querySelectorAll<HTMLElement>('[data-gantt-track], [data-gantt-lane-label], [data-testid^="planning-gantt-bar-"], [data-testid="planning-gantt-send-out-star"], [data-testid="planning-gantt-now"], [data-testid^="planning-gantt-due-"], div[title^="2026-"]')]
      .map((node) => ({ testId: node.dataset.testid, title: node.title, style: node.getAttribute('style'), className: node.className,
        aria: node.getAttribute('aria-label'), text: node.textContent }));
    const key = `${hours}h-${scale}`;
    digests[key] = createHash('sha256').update(JSON.stringify({ geometry, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop })).digest('hex');
    if (process.env.PLANNING_BOARD_RENDER_OUTPUT) {
      const directory = process.env.PLANNING_BOARD_RENDER_OUTPUT;
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/${key}.html`, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../planning-board-visual.css"><body style="background:#0f172a">${view.container.innerHTML}<script>document.querySelector('[aria-label="ガントの日付と工程"]').scrollLeft=${viewport.scrollLeft}</script>`);
    }
    view.unmount();
  }
  if (process.env.PLANNING_BOARD_RENDER_BASELINE) writeFileSync(process.env.PLANNING_BOARD_RENDER_BASELINE, JSON.stringify(digests, null, 2));
  // Captured from the implementation before DOM consolidation.
  expect(digests).toEqual({
    "8h-1": "bdf068581ee1b42faf6966448684e79b0d7084973eeb345ad2f81f1aa2fb0a01",
    "8h-2": "77f55e38efe4fe564ab7ff97805b1e5a5bdf257b90bcbe8e06d4e4c4e5ed11ef",
    "8h-4": "58ac3df77a640ebabf6c58562b8b83871e1f328d9a0d947b7d6c106bec2ac031",
    "8h-14": "484fdfbba69d28bdb0fae82bb29c4ea3240f7e269c08cffd2da6ce9538ee17ef",
    "8h-56": "28cfa3508d1f3592ae1dc3543c0328800822f12f93721b3d1345b5bba6c403cc",
    "10h-1": "cffe2002914d960f038f22dd5967efb1326a0c53dfb5806467e64e6a17962ea8",
    "10h-2": "00a6f7d1b96700d9a8285fc57d8d9704de1721b63814daccf0450d2ffe8bdedc",
    "10h-4": "dfbae4ba650dc74af5550eaee512a41880f2b05e64395267472d2dbe90854131",
    "10h-14": "c2639b0fa0f55a6b390b4a7ccf0cb4325ebddaddde421b232fc9c9aa87926192",
    "10h-56": "0fb87be1cda4142c43a7249705c4c54ad9dbbf873dc37e32e09a4deca2d9f7e4",
    "24h-1": "1d9253dae4e2df10a6367bd6632a4f8dc40d1f6912f301b7fe7300dcdb206629",
    "24h-2": "b0864b0e18866a738e85e4c4804d75dd14cb332cf304cf2e566c3622174930ff",
    "24h-4": "db95ff8ae44a5c8575b6da718b6fbdc56f72ea1d75859cd6e20c7eef8b122670",
    "24h-14": "9115a699f920ebfc2ad0965d6091ea20900c1ef072373b3cf115401e2a8fc108",
    "24h-56": "8eb3145213f0c87568c274b1a07de3fa6219da117896f3c97c8fa8ecd0664f8d"
});
});
