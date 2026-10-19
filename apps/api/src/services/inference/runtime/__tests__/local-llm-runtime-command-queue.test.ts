import { describe, expect, it } from 'vitest';

import {
  enqueueMainLocalLlmRuntimeControl,
  MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES,
  resetMainLocalLlmRuntimeControlQueueForTests,
  resolveMainLocalLlmRuntimeControlPriorityForUseCase,
} from '../local-llm-runtime-command-queue.js';

describe('enqueueMainLocalLlmRuntimeControl', () => {
  it('runs jobs strictly one after another', async () => {
    resetMainLocalLlmRuntimeControlQueueForTests();
    const order: string[] = [];

    await Promise.all([
      enqueueMainLocalLlmRuntimeControl('a', async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 20));
        order.push('a-end');
      }),
      enqueueMainLocalLlmRuntimeControl('b', async () => {
        order.push('b-start');
        order.push('b-end');
      }),
    ]);

    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('continues queue after a rejected job', async () => {
    resetMainLocalLlmRuntimeControlQueueForTests();
    const calls: string[] = [];

    const p1 = enqueueMainLocalLlmRuntimeControl('fail', async () => {
      calls.push('1');
      throw new Error('boom');
    });
    const p2 = enqueueMainLocalLlmRuntimeControl('ok', async () => {
      calls.push('2');
    });

    await expect(p1).rejects.toThrow('boom');
    await p2;

    expect(calls).toEqual(['1', '2']);
  });

  it('runs higher priority jobs first while keeping FIFO inside same priority', async () => {
    resetMainLocalLlmRuntimeControlQueueForTests();
    const order: string[] = [];

    const blocking = enqueueMainLocalLlmRuntimeControl('blocking', async () => {
      order.push('blocking-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('blocking-end');
    }, MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.gatewayControl);

    await new Promise((r) => setTimeout(r, 1));

    const gateway = enqueueMainLocalLlmRuntimeControl(
      'gateway',
      async () => {
        order.push('gateway');
      },
      MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.gatewayControl
    );
    const agent = enqueueMainLocalLlmRuntimeControl(
      'agent',
      async () => {
        order.push('agent');
      },
      MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.agent
    );
    const business = enqueueMainLocalLlmRuntimeControl(
      'business',
      async () => {
        order.push('business');
      },
      MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.business
    );

    await Promise.all([blocking, gateway, agent, business]);

    expect(order).toEqual(['blocking-start', 'blocking-end', 'business', 'agent', 'gateway']);
  });

  it('maps agent_container_task to agent priority tier', () => {
    expect(resolveMainLocalLlmRuntimeControlPriorityForUseCase('agent_container_task')).toBe(
      MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.agent
    );
  });
});
