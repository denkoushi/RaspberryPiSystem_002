import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { api } from '../http';

import { scheduleSeibanQueryKey, useScheduleSeibans } from './schedule-seibans';

import type { ScheduleSeibanView } from '../domains/schedule-seibans';
import type { PropsWithChildren } from 'react';

vi.mock('../http', () => ({ api: { get: vi.fn() } }));
afterEach(() => vi.resetAllMocks());

it('passes source/range as API query parameters and keeps each view in its own cache', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  vi.mocked(api.get).mockResolvedValue({ data: { seibans: [], truncated: false } });
  const initial: ScheduleSeibanView = { source: 'both', range: 'all' };
  const next: ScheduleSeibanView = { source: 'general', range: 'excludeOlderThanHalfYear' };
  const hook = renderHook(view => useScheduleSeibans(view), { wrapper, initialProps: initial });
  try {
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenLastCalledWith('/mobile-placement/schedule-seibans', { params: initial });
    hook.rerender(next);
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenLastCalledWith('/mobile-placement/schedule-seibans', { params: next });
    expect(client.getQueryData([...scheduleSeibanQueryKey, initial])).toBeDefined();
    expect(client.getQueryData([...scheduleSeibanQueryKey, next])).toBeDefined();
  } finally { hook.unmount(); client.clear(); }
});
