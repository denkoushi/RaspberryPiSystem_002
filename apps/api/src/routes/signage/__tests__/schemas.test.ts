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

  it('rejects auto self_inspection_machine_board when machineName is set', () => {
    const result = scheduleSchema.safeParse({
      name: 'invalid auto self inspection',
      contentType: 'TOOLS',
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: {
              targetMode: 'auto_from_leaderboard_status',
              machineName: 'L300KP',
              resourceCds: ['RD01'],
            },
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

  it('rejects auto self_inspection_machine_board when deviceScopeKey is missing', () => {
    const result = scheduleSchema.safeParse({
      name: 'invalid auto self inspection without scope',
      contentType: 'TOOLS',
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: {
              targetMode: 'auto_from_leaderboard_status',
              resourceCds: ['RD01'],
            },
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

  it('rejects auto self_inspection_machine_board when resourceCds contains only whitespace', () => {
    const result = scheduleSchema.safeParse({
      name: 'invalid auto self inspection whitespace resourceCds',
      contentType: 'TOOLS',
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: {
              targetMode: 'auto_from_leaderboard_status',
              deviceScopeKey: '第2工場 - kensakuMain',
              resourceCds: ['   '],
            },
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

  it('accepts auto self_inspection_machine_board on FULL layout', () => {
    const result = scheduleSchema.safeParse({
      name: 'valid auto self inspection',
      contentType: 'TOOLS',
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: {
              targetMode: 'auto_from_leaderboard_status',
              deviceScopeKey: '第2工場 - kensakuMain',
              resourceCds: ['RD01'],
              maxAutoMachines: 5,
            },
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

  it('rejects manual self_inspection_machine_board when maxAutoMachines is set', () => {
    const result = scheduleSchema.safeParse({
      name: 'invalid manual self inspection maxAutoMachines',
      contentType: 'TOOLS',
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: {
              machineName: 'L300KP',
              maxAutoMachines: 5,
            },
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

  it('rejects manual self_inspection_machine_board when resourceCds is set', () => {
    const result = scheduleSchema.safeParse({
      name: 'invalid manual self inspection',
      contentType: 'TOOLS',
      layoutConfig: {
        layout: 'FULL',
        slots: [
          {
            position: 'FULL',
            kind: 'self_inspection_machine_board',
            config: {
              machineName: 'L300KP',
              resourceCds: ['RD01'],
            },
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
