import { expect, test, type Page } from '@playwright/test';

const LINUX_KIOSK_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const employeeId = '11111111-1111-4111-8111-111111111111';
const programId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const profileId = '55555555-5555-4555-8555-555555555555';
const fingerprint = 'training-e2e-fingerprint';

const version = {
  id: versionId,
  version: 1,
  displayName: 'M6 E2E訓練',
  nominalDiameter: 'M6',
  boltLengthMm: '20',
  material: 'SCM435',
  strengthClass: '10.9',
  capabilityGroupId: '66666666-6666-4666-8666-666666666666',
  nominalTorque: '10',
  lowerLimit: '9',
  upperLimit: '11',
  unit: 'N-m',
  jigConditionCode: 'JIG-E2E',
  conditionFingerprint: fingerprint,
  torqueWrenchProfiles: [{ id: profileId, serialNumber: '702902S' }]
};

const program = {
  id: programId,
  code: 'TRAINING-E2E',
  isActive: true,
  currentVersion: 1,
  versions: [version]
};

function session(status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS') {
  const attempts = status === 'COMPLETED'
    ? Array.from({ length: 5 }, (_, index) => ({
        id: `attempt-${index + 1}`,
        attemptNo: index + 1,
        value: '10',
        inputUnit: 'N-m',
        valueNm: '10',
        nominalTorque: '10',
        lowerLimit: '9',
        upperLimit: '11',
        deviationNm: '0',
        deviationPercent: '0',
        absoluteDeviationPercent: '0',
        judgement: 'OK',
        accepted: true,
        ignoredReason: null,
        recordedAt: '2026-08-09T00:00:00.000Z'
      }))
    : [];
  return {
    id: '77777777-7777-4777-8777-777777777777',
    requestId: 'training-e2e-request',
    status,
    employeeCode: 'E2E001',
    employeeName: 'E2E 作業者',
    clientDeviceName: 'E2E kiosk',
    conditionFingerprint: fingerprint,
    targetAttemptCount: 5,
    program: { ...version, code: program.code },
    attempts,
    hasWrenchConfirmation: status !== 'IN_PROGRESS',
    startedAt: '2026-08-09T00:00:00.000Z',
    completedAt: status === 'COMPLETED' ? '2026-08-09T00:05:00.000Z' : null,
    cancelledAt: null,
    cancelReason: null,
    excludedAt: null,
    exclusionReason: null
  };
}

async function installMockNfc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type MockSocket = {
      readyState: number;
      onmessage: ((event: MessageEvent<string>) => void) | null;
    };
    type TestWindow = Window & {
      __emitTrainingNfc?: (uid: string) => void;
      __trainingNfcReady?: boolean;
    };
    const sockets: MockSocket[] = [];
    class MockWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = MockWebSocket.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        sockets.push(this);
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.();
          (window as TestWindow).__trainingNfcReady = true;
        }, 0);
      }
      send() {}
      close() {
        this.readyState = MockWebSocket.CLOSED;
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: MockWebSocket });
    (window as TestWindow).__trainingNfcReady = false;
    (window as TestWindow).__emitTrainingNfc = (uid) => {
      const payload = JSON.stringify({ uid, timestamp: new Date(Date.now() + 10_000).toISOString() });
      for (const socket of sockets) {
        if (socket.readyState === MockWebSocket.OPEN) socket.onmessage?.(new MessageEvent('message', { data: payload }));
      }
    };
  });
}

async function emitNfc(page: Page, uid: string): Promise<void> {
  await page.evaluate((value) => (window as Window & { __emitTrainingNfc?: (nextUid: string) => void }).__emitTrainingNfc?.(value), uid);
}

test.use({ userAgent: LINUX_KIOSK_USER_AGENT });

test('NFCから5回完了、本人情報消去、ADMIN設定復帰を確認する', async ({ page }) => {
  let agentAcquired = false;
  await installMockNfc(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('factory-auth', JSON.stringify({
      token: 'existing-viewer-token',
      user: { id: 'viewer-e2e', username: 'viewer', role: 'VIEWER', mfaEnabled: false },
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }));
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/src/api/')) return route.continue();
    if (path === '/api/kiosk/config') return route.fulfill({ json: { kioskInitialRoute: 'assembly', navTabOrder: [] } });
    if (path === '/api/system/deploy-status') return route.fulfill({ json: { isMaintenance: false } });
    if (path === '/api/torque-training/programs' && request.method() === 'GET') return route.fulfill({ json: { programs: [program] } });
    if (path === '/api/torque-training/operator-context') return route.fulfill({ json: { employee: { id: employeeId, employeeCode: 'E2E001', displayName: 'E2E 作業者' }, currentSession: null, metrics: [] } });
    if (path === '/api/torque-training/sessions' && request.method() === 'POST') return route.fulfill({ status: 201, json: { session: session() } });
    if (path.endsWith(`/sessions/${session().id}`) && request.method() === 'GET') return route.fulfill({ json: { session: session(agentAcquired ? 'COMPLETED' : 'IN_PROGRESS') } });
    if (path.endsWith('/wrench-confirmations') && request.method() === 'POST') return route.fulfill({ status: 201, json: { confirmation: { id: '88888888-8888-4888-8888-888888888888', torqueWrenchProfileId: profileId, serialNumber: '702902S', settingHistoryId: '99999999-9999-4999-8999-999999999999' } } });
    if (path.includes('/admin/torque-training/programs') && request.method() === 'GET') return route.fulfill({ json: { programs: [program] } });
    if (path.includes('/admin/torque-training/results') && request.method() === 'GET') return route.fulfill({ json: { results: [] } });
    if (path === '/api/torque-wrench-capability-groups') return route.fulfill({ json: { capabilityGroups: [] } });
    if (path === '/api/torque-wrenches') return route.fulfill({ json: { torqueWrenches: [] } });
    if (path === '/api/auth/login' && request.method() === 'POST') return route.fulfill({ json: { accessToken: 'e2e-admin-token', refreshToken: 'e2e-refresh-token', user: { id: 'admin-e2e', username: 'admin', role: 'ADMIN', status: 'ACTIVE' } } });
    return route.fulfill({ json: {} });
  });
  await page.route('http://127.0.0.1:7073/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': '*' };
    if (path === '/health') return route.fulfill({ headers, json: { ok: true, ready: true, wrenchSerialNumbers: ['702902S'] } });
    if (path === '/lease/acquire') {
      agentAcquired = true;
      return route.fulfill({ headers, json: { ok: true, ready: true, leaseOwned: true, state: 'owned_by_self', lastError: null } });
    }
    return route.fulfill({ headers, json: { ok: true, ready: true, leaseOwned: false, state: 'available', lastError: null } });
  });

  await page.goto('/kiosk/assembly/training', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __trainingNfcReady?: boolean }).__trainingNfcReady))).toBe(true);
  await emitNfc(page, 'NFC-E2E-TRAINING');
  await expect(page.getByText('E2E 作業者', { exact: true })).toBeVisible();
  await page.getByLabel('対象ボルト・訓練メニュー').selectOption(versionId);
  await page.getByRole('button', { name: '訓練を開始' }).click();
  await expect(page.getByText('締付中は目標値を隠し、入力後に結果を表示します。')).toBeVisible();
  await expect(page.getByText(/目標 10 Nm/)).toHaveCount(0);
  await expect(page.getByText('torque-agent自動検出: 702902S')).toBeVisible();
  await page.getByRole('button', { name: '検出レンチを確認して接続' }).click();
  await expect(page.getByText(/実測 10 Nm \/ 目標 10 Nm/).first()).toBeVisible();
  await expect(page.getByText('訓練が完了しました。次の作業者はNFCタグを読み取ってください。')).toBeVisible();
  await expect(page.getByText('E2E 作業者', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '設定' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('ユーザー名').fill('admin');
  await page.getByLabel('パスワード').fill('password');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL(/\/kiosk\/assembly\/training/);
  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.getByRole('button', { name: '訓練メニュー' })).toBeVisible();
  await expect(page.getByRole('button', { name: '訓練実績' })).toBeVisible();
});
