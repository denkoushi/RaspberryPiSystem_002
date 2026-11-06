import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';
import { buildPlanningBoardGanttLayout } from '../gantt/planningBoardGanttLayout';
import { PlanningBoardGanttView } from '../gantt/PlanningBoardGanttView';

import { productionFixture } from './fixture';

vi.mock('../../../../api/hooks/machine-signal', () => ({
  useMachineSignalResourceUptime: () => ({ data: undefined })
}));

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
  // Captured from the current implementation before row-prop optimizations.
  expect(digests).toEqual({
    "8h-1": "5d978d3ae599f308901a7d5eb538619b000ad32afcf907099f40a66c32cbba90",
    "8h-2": "a213f9574ba9c17b225cf395f513f46fd6c392f524556e92a24646bae300174d",
    "8h-4": "d11baaa6fa9b472665ce16aa7ccd2ee0a7a95d14e4d2209d311ee2367b3ec435",
    "8h-14": "21ac5bf9daec2c9de99594ab5a093c788aa686a6d642cc9649b59d017bd9d500",
    "8h-56": "81405fda77f16d9e96a4abb0dcf4a1a75c1159ee99c6f990d39441ff2f9b52c4",
    "10h-1": "c61c129cd393930da9f857891ec0a9315aba36db63152fa5fab29ec264c9baa4",
    "10h-2": "9701afa0f6f69a36eadcebc858cd902936b9656d1c2f71cb4ba3bbed1feecf07",
    "10h-4": "fdd0ccd17d82d5d97edeb0277f812426fc809a95180a9575b9267a34645a2050",
    "10h-14": "2504e1a289d67fc7cc31e4dc9a2de82a128c19289440bc7af3cf33696f892e01",
    "10h-56": "75c0976b1c757e53750b53eaa9b7d1761d1196ce65735de4c76e429a2d1d0379",
    "24h-1": "39782465c7443823418015fbc71eee4c4d60e42f49f5b83efeb030d71824cef6",
    "24h-2": "63af65d164d88f0a6a77d1df8e3fe8f05a6d97ad57aab8030a955154941128e8",
    "24h-4": "4f02cdc51f8c2da0b69e707f24f2a18692c040da86775ca36fe8068656ff968f",
    "24h-14": "f1ba3fa9479e2c3e69f1e1be6695f050259e94774f7477d500fa759fcabf9492",
    "24h-56": "45c2f71065b2bfa07b9979e1918ec672c81e7b8556e15bcb501f484f6e137a7f"
});
});
