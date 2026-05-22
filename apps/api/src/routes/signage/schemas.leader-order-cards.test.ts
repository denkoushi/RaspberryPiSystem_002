import { describe, expect, it } from 'vitest';
import { scheduleSchema } from './schemas.js';

const baseSchedule = {
  name: 'Leader order cards schema test',
  contentType: 'TOOLS' as const,
  dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startTime: '00:00',
  endTime: '23:59',
  priority: 1,
  enabled: true,
};

describe('scheduleSchema kiosk_leader_order_cards cardsPerPage', () => {
  it('accepts cardsPerPage 8', () => {
    const parsed = scheduleSchema.parse({
      ...baseSchedule,
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'kiosk_leader_order_cards',
            config: {
              deviceScopeKey: 'scope-a',
              resourceCds: ['RC1'],
              slideIntervalSeconds: 30,
              cardsPerPage: 8,
            },
          },
        ],
      },
    });
    expect(parsed.layoutConfig?.slots[0]).toMatchObject({
      kind: 'kiosk_leader_order_cards',
      config: expect.objectContaining({ cardsPerPage: 8 }),
    });
  });

  it('rejects cardsPerPage 9', () => {
    expect(() =>
      scheduleSchema.parse({
        ...baseSchedule,
        layoutConfig: {
          layout: 'FULL',
          slots: [
            {
              position: 'FULL',
              kind: 'kiosk_leader_order_cards',
              config: {
                deviceScopeKey: 'scope-a',
                resourceCds: ['RC1'],
                cardsPerPage: 9,
              },
            },
          ],
        },
      }),
    ).toThrow();
  });
});
