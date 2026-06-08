import { describe, expect, it } from 'vitest';

import { scheduleSchema } from '../../../routes/signage/schemas.js';

describe('signage scheduleSchema layoutConfig', () => {
  it('rejects self_inspection_machine_board on SPLIT LEFT pane', () => {
    const result = scheduleSchema.safeParse({
      name: 'invalid split self inspection',
      contentType: 'SPLIT',
      layoutConfig: {
        layout: 'SPLIT',
        slots: [
          {
            position: 'LEFT',
            kind: 'self_inspection_machine_board',
            config: { machineName: 'L300KP' },
          },
          {
            position: 'RIGHT',
            kind: 'loans',
            config: {},
          },
        ],
      },
      dayOfWeek: [0],
      startTime: '00:00',
      endTime: '23:59',
      priority: 1,
    });

    expect(result.success).toBe(false);
  });

  it('accepts self_inspection_machine_board on FULL layout', () => {
    const result = scheduleSchema.safeParse({
      name: 'valid full self inspection',
      contentType: 'TOOLS',
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: { machineName: 'L300KP' },
          },
        ],
      },
      dayOfWeek: [0],
      startTime: '00:00',
      endTime: '23:59',
      priority: 1,
    });

    expect(result.success).toBe(true);
  });

  it('rejects self_inspection_machine_board with FULL position on SPLIT layout', () => {
    const result = scheduleSchema.safeParse({
      name: 'invalid split full position self inspection',
      contentType: 'SPLIT',
      layoutConfig: {
        layout: 'SPLIT',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: { machineName: 'L300KP' },
          },
          {
            position: 'LEFT',
            kind: 'loans',
            config: {},
          },
          {
            position: 'RIGHT',
            kind: 'loans',
            config: {},
          },
        ],
      },
      dayOfWeek: [0],
      startTime: '00:00',
      endTime: '23:59',
      priority: 1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects FULL layout when a slot uses LEFT position', () => {
    const result = scheduleSchema.safeParse({
      name: 'invalid full layout left slot',
      contentType: 'TOOLS',
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'LEFT',
            kind: 'loans',
            config: {},
          },
        ],
      },
      dayOfWeek: [0],
      startTime: '00:00',
      endTime: '23:59',
      priority: 1,
    });

    expect(result.success).toBe(false);
  });
});
