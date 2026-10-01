import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickAddDialog } from './QuickAddDialog';

import type { ClientDevice } from '../../../api/client';

const createSchedule = vi.fn();
const createCapture = vi.fn();
const captureNow = vi.fn();
const preview = vi.hoisted(() => vi.fn());

vi.mock('../../../api/hooks', () => ({
  useSignageScheduleMutations: () => ({ create: { mutateAsync: createSchedule } }),
  useSignageWebCaptureMutations: () => ({ create: { mutateAsync: createCapture }, captureNow: { mutate: captureNow } }),
  useSignagePdfMutations: () => ({ upload: { mutateAsync: vi.fn() } }),
}));
vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  previewSignageWebCapture: preview,
}));

const clients = [
  { id: 'c1', name: '現場 Pi3', apiKey: 'key-a' },
  { id: 'c2', name: '事務所 Android', apiKey: 'key-b' },
] as ClientDevice[];

function renderDialog(onDone = vi.fn()) {
  render(
    <QuickAddDialog
      isOpen
      onClose={vi.fn()}
      onDone={onDone}
      onAdvanced={vi.fn()}
      clients={clients}
      defaultClientKey="key-a"
      visualizationDashboards={[]}
      csvDashboards={[]}
    />,
  );
  return { onDone };
}

describe('QuickAddDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSchedule.mockResolvedValue({ id: 'new-schedule' });
    createCapture.mockResolvedValue({ id: 'cap-1' });
    preview.mockResolvedValue({
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      regions: [],
      durationMs: 2400,
      autoHiddenSelectors: ['body > div > header'],
      pageTitle: '生産日程',
    });
  });

  it('puts a board on every screen, always, in three actions', async () => {
    const { onDone } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'ボード' }));
    fireEvent.click(screen.getByRole('button', { name: '持出一覧' }));
    expect(screen.getByLabelText('名前')).toHaveValue('持出一覧');
    fireEvent.click(screen.getByRole('button', { name: '映す' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-schedule'));
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '持出一覧',
        targetClientKeys: [],
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: '00:00',
        endTime: '23:59',
        layoutConfig: { layout: 'FULL', slots: [{ position: 'FULL', kind: 'loans', config: {} }] },
      }),
    );
  });

  it('captures a pasted same-site URL, names it after the page and shows it on the chosen screen', async () => {
    const { onDone } = renderDialog();
    fireEvent.change(screen.getByLabelText(/映したいページの URL/), { target: { value: `${window.location.origin}/kiosk/production-schedule` } });
    fireEvent.click(screen.getByRole('button', { name: '撮る' }));

    await waitFor(() => expect(screen.getByLabelText('名前')).toHaveValue('生産日程'));
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ path: '/kiosk/production-schedule', hideSelectors: [] }), { autoHideLandmarks: true });
    expect(screen.getByText('上部メニュー')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '現場 Pi3' }));
    fireEvent.click(screen.getByRole('button', { name: '映す' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-schedule'));
    expect(createCapture).toHaveBeenCalledWith(
      expect.objectContaining({ name: '生産日程', path: '/kiosk/production-schedule', hideSelectors: ['body > div > header'], refreshIntervalSeconds: 300 }),
    );
    expect(captureNow).toHaveBeenCalledWith('cap-1');
    expect(createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        targetClientKeys: ['key-a'],
        layoutConfig: { layout: 'FULL', slots: [{ position: 'FULL', kind: 'web_page', config: { webCaptureId: 'cap-1' } }] },
      }),
    );
  });

  it('refuses another site and keeps the main button disabled until something is chosen', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: '映す' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/映したいページの URL/), { target: { value: 'https://example.com/page' } });
    fireEvent.click(screen.getByRole('button', { name: '撮る' }));

    expect(screen.getByRole('alert')).toHaveTextContent('ほかのサイトは映せません');
    expect(preview).not.toHaveBeenCalled();
  });
});
