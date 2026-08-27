import { expect, test, type Page } from '@playwright/test';

const LINUX_KIOSK_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const employeeId = '11111111-1111-4111-8111-111111111111';
const programId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const profileId = '55555555-5555-4555-8555-555555555555';
const fingerprint = 'training-e2e-fingerprint';
const boltProgramId = '33333333-3333-4333-8333-333333333334';
const boltVersionId = '44444444-4444-4444-8444-444444444445';
const boltProfileId = '55555555-5555-4555-8555-555555555556';
const boltFingerprint = 'training-e2e-bolt-fingerprint';

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
  torqueWrenchProfiles: [{ id: profileId, serialNumber: '702902S', settingVerificationMode: 'REGISTERED_SETTING' }]
};

const program = {
  id: programId,
  code: 'TRAINING-E2E',
  isActive: true,
  currentVersion: 1,
  versions: [version]
};

const boltVersion = {
  ...version,
  id: boltVersionId,
  displayName: 'M6 BOLT条件訓練',
  conditionFingerprint: boltFingerprint,
  torqueWrenchProfiles: [{
    id: boltProfileId,
    serialNumber: '702903S',
    settingVerificationMode: 'BOLT_CONDITION_ONLY'
  }]
};

const boltProgram = {
  ...program,
  id: boltProgramId,
  code: 'TRAINING-BOLT-E2E',
  versions: [{ ...boltVersion, setupState: 'READY', setupStateReason: null }]
};

const menuProgram = {
  ...program,
  versions: Array.from({ length: 14 }, (_, index) => ({
    ...version,
    id: index === 0 ? versionId : `standard-version-${index + 1}`,
    displayName: index === 0 ? version.displayName : `標準メニュー ${index + 1}`,
    setupState: index === 0 ? 'READY' : 'UNASSIGNED',
    setupStateReason: index === 0 ? null : '対応レンチ未登録'
  }))
};

type MockAdminResult = {
  id: string;
  employeeCode: string;
  employeeName: string;
  programCode: string;
  programVersion: number;
  conditionFingerprint: string;
  status: string;
  excludedAt: string | null;
  exclusionReason: string | null;
  completedAt: string | null;
  metrics: {
    attemptCount: number;
    passRate: number;
    meanAbsoluteErrorPercent: number;
    variationPercent: number;
  };
};

const adminResult: MockAdminResult = {
  id: '77777777-7777-4777-8777-777777777777',
  employeeCode: 'E2E001',
  employeeName: 'E2E 作業者',
  programCode: program.code,
  programVersion: 1,
  conditionFingerprint: fingerprint,
  status: 'COMPLETED',
  excludedAt: null,
  exclusionReason: null,
  completedAt: '2026-08-09T00:05:00.000Z',
  metrics: {
    attemptCount: 5,
    passRate: 1,
    meanAbsoluteErrorPercent: 0,
    variationPercent: 0
  }
};

function session(
  status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS',
  attemptCount = status === 'COMPLETED' ? 5 : 0,
  programVersion = version,
  programCode = program.code
) {
  const settingVerificationMode = programVersion.torqueWrenchProfiles[0]?.settingVerificationMode ?? 'REGISTERED_SETTING';
  const attempts = Array.from({ length: attemptCount }, (_, index) => ({
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
    settingVerificationMode,
    judgement: 'OK',
    accepted: true,
    ignoredReason: null,
    recordedAt: '2026-08-09T00:00:00.000Z'
  }));
  return {
    id: '77777777-7777-4777-8777-777777777777',
    requestId: 'training-e2e-request',
    status,
    employeeCode: 'E2E001',
    employeeName: 'E2E 作業者',
    clientDeviceName: 'E2E kiosk',
    conditionFingerprint: programVersion.conditionFingerprint,
    targetAttemptCount: 5,
    program: { ...programVersion, code: programCode },
    attempts,
    hasWrenchConfirmation: attemptCount > 0 || status !== 'IN_PROGRESS',
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
      url: string;
      readyState: number;
      onmessage: ((event: MessageEvent<string>) => void) | null;
    };
    type TestWindow = Window & {
      __emitTrainingNfc?: (uid: string) => void;
      __emitTorqueTrainingCommitted?: (sessionId: string, sourceEventKey: string) => void;
      __trainingNfcReady?: boolean;
    };
    const sockets: MockSocket[] = [];
    class MockWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readonly url: string;
      readyState = MockWebSocket.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string | URL) {
        this.url = String(url);
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
    (window as TestWindow).__emitTorqueTrainingCommitted = (sessionId, sourceEventKey) => {
      const payload = JSON.stringify({
        type: 'torqueRecordCommitted',
        sessionId,
        sourceEventKey,
        acknowledgedAt: new Date().toISOString()
      });
      for (const socket of sockets) {
        if (socket.url === 'ws://127.0.0.1:7073/stream' && socket.readyState === MockWebSocket.OPEN) {
          socket.onmessage?.(new MessageEvent('message', { data: payload }));
        }
      }
    };
  });
}

async function emitNfc(page: Page, uid: string): Promise<void> {
  await page.evaluate((value) => (window as Window & { __emitTrainingNfc?: (nextUid: string) => void }).__emitTrainingNfc?.(value), uid);
}

async function emitTorqueTrainingCommitted(page: Page, sessionId: string, sourceEventKey: string): Promise<void> {
  await page.evaluate(
    ([nextSessionId, nextSourceEventKey]) => (
      window as Window & { __emitTorqueTrainingCommitted?: (id: string, eventKey: string) => void }
    ).__emitTorqueTrainingCommitted?.(nextSessionId, nextSourceEventKey),
    [sessionId, sourceEventKey]
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function expectMaxWidth(locator: ReturnType<Page['locator']>, maxWidth: number): Promise<void> {
  const width = await locator.evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(maxWidth + 1);
}

test.use({ userAgent: LINUX_KIOSK_USER_AGENT });

test('NFCから5回完了、本人情報消去、操作パスワード設定復帰を確認する', async ({ page }) => {
  let agentAcquired = false;
  let leaseAcquireCalls = 0;
  const preparationPayloads: Array<Record<string, unknown>> = [];
  let trainingHeartbeats = 0;
  let trainingSessionGets = 0;
  let committedAttemptCount = 0;
  let settingsSnapshotCalls = 0;
  let adminLoginCalls = 0;
  const trainingHeartbeatPayloads: Array<Record<string, unknown>> = [];
  let adminResults = [adminResult];
  await installMockNfc(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
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
    if (path === '/api/torque-training/programs' && request.method() === 'GET') return route.fulfill({ json: { programs: [menuProgram] } });
    if (path === '/api/torque-training/operator-context') return route.fulfill({ json: { employee: { id: employeeId, employeeCode: 'E2E001', displayName: 'E2E 作業者' }, currentSession: null, metrics: [] } });
    if (path === '/api/torque-training/sessions' && request.method() === 'POST') return route.fulfill({ status: 201, json: { session: session() } });
    if (path.endsWith(`/sessions/${session().id}`) && request.method() === 'GET') {
      trainingSessionGets += 1;
      const status = committedAttemptCount >= 5 ? 'COMPLETED' : 'IN_PROGRESS';
      return route.fulfill({ json: { session: session(status, committedAttemptCount) } });
    }
    if (path.endsWith('/wrench-preparations') && request.method() === 'POST') {
      preparationPayloads.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 201, json: { preparation: { confirmationId: '88888888-8888-4888-8888-888888888888', requestId: preparationPayloads[0].requestId, torqueWrenchProfileId: profileId, serialNumber: '702902S', settingHistoryId: '99999999-9999-4999-8999-999999999999', settingVerificationMode: 'REGISTERED_SETTING', target: { lowerLimit: '9', nominalTorque: '10', upperLimit: '11', unit: 'N-m' }, confirmedAt: '2026-08-09T00:00:00.000Z', duplicate: false } } });
    }
    if (path === '/api/torque-training/settings/snapshot' && request.method() === 'POST') {
      settingsSnapshotCalls += 1;
      const body = request.postDataJSON() as { accessPassword?: string };
      if (body.accessPassword !== '2520') {
        return route.fulfill({ status: 403, json: { message: '操作時パスワードが違います。' } });
      }
      return route.fulfill({ json: { snapshot: {
        programs: [menuProgram],
        results: adminResults,
        capabilityGroups: [],
        wrenchProfiles: []
      } } });
    }
    if (path.includes('/admin/torque-training/sessions/') && path.endsWith('/exclude') && request.method() === 'POST') {
      const sessionId = path.split('/').at(-2);
      const body = request.postDataJSON() as { reason?: string };
      adminResults = adminResults.map((result) => result.id === sessionId
        ? { ...result, excludedAt: '2026-08-09T00:06:00.000Z', exclusionReason: body.reason ?? null }
        : result);
      return route.fulfill({ json: { id: sessionId, excludedAt: '2026-08-09T00:06:00.000Z', exclusionReason: body.reason ?? null } });
    }
    if (path === '/api/torque-wrench-capability-groups') return route.fulfill({ json: { capabilityGroups: [] } });
    if (path === '/api/torque-wrenches') return route.fulfill({ json: { torqueWrenches: [] } });
    if (path === '/api/auth/login' && request.method() === 'POST') {
      adminLoginCalls += 1;
      return route.fulfill({ json: { accessToken: 'e2e-admin-token', refreshToken: 'e2e-refresh-token', user: { id: 'admin-e2e', username: 'admin', role: 'ADMIN', status: 'ACTIVE' } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.route('http://127.0.0.1:7073/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'access-control-allow-origin': '*' };
    if (path === '/health') return route.fulfill({ headers, json: { ok: true, ready: true, wrenchSerialNumbers: ['702902S'] } });
    if (path === '/lease/acquire') {
      leaseAcquireCalls += 1;
      if (leaseAcquireCalls === 1) return route.fulfill({ headers, json: { ok: true, ready: false, leaseOwned: false, state: 'available', lastError: 'agent warming up' } });
      agentAcquired = true;
      return route.fulfill({ headers, json: { ok: true, ready: true, leaseOwned: true, state: 'owned_by_self', lastError: null } });
    }
    if (path === '/heartbeat') {
      trainingHeartbeats += 1;
      trainingHeartbeatPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
      if (trainingHeartbeats >= 5) {
        return route.fulfill({ headers, json: {
          ok: true,
          ready: false,
          owner: null,
          leaseOwned: false,
          bound: false,
          state: 'available',
          bluetoothPowered: false,
          hidExclusive: false,
          lastError: null
        } });
      }
      return route.fulfill({ headers, json: {
        ok: true,
        ready: true,
        owner: null,
        leaseOwned: agentAcquired,
        bound: agentAcquired,
        state: agentAcquired ? 'owned_by_self' : 'available',
        bluetoothPowered: true,
        hidExclusive: true,
        lastError: null
      } });
    }
    return route.fulfill({ headers, json: { ok: true, ready: true, leaseOwned: false, state: 'available', lastError: null } });
  });

  await page.goto('/kiosk/assembly/training', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __trainingNfcReady?: boolean }).__trainingNfcReady))).toBe(true);
  await expectMaxWidth(page.getByTestId('torque-training-preparation'), 576);
  await expectMaxWidth(page.getByTestId('torque-training-nfc-guide'), 448);
  await emitNfc(page, 'NFC-E2E-TRAINING');
  await expect(page.getByText('E2E 作業者', { exact: true })).toBeVisible();
  await expectMaxWidth(page.getByTestId('torque-training-operator-card'), 384);
  const trainingMenu = page.getByLabel('対象ボルト・訓練メニュー');
  await expectMaxWidth(trainingMenu, 576);
  await expect(trainingMenu.locator('option')).toHaveCount(15);
  await expect(trainingMenu.locator('option:disabled')).toHaveCount(13);
  await expect(trainingMenu).toContainText('対応レンチ未登録');
  await expect(page.getByTestId('assembly-work-session-status')).toHaveAttribute('role', 'status');
  await expectNoHorizontalOverflow(page);
  await trainingMenu.selectOption(versionId);
  await page.getByRole('button', { name: '訓練を開始' }).click();
  await expect(page.getByText('締付中は目標値を隠し、入力後に結果を表示します。')).toBeVisible();
  await expectMaxWidth(page.getByTestId('torque-training-target-summary'), 448);
  await expect(page.getByText(/目標 10 Nm/)).toHaveCount(0);
  await expect(page.getByText('torque-agent自動検出: 702902S')).toBeVisible();
  await expect(page.getByTestId('torque-training-wrench-target-values')).toContainText('M6');
  await expect(page.getByTestId('torque-training-wrench-target-values')).toContainText('10 N·m');
  await expect(page.getByTestId('torque-training-wrench-target-values')).toContainText('9 N·m');
  await expect(page.getByTestId('torque-training-wrench-target-values')).toContainText('11 N·m');
  await expectMaxWidth(page.getByTestId('torque-training-wrench-detection'), 448);
  await page.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' }).click();
  await expect(page.getByTestId('torque-training-setting-registered')).toBeVisible();
  await expect(page.getByTestId('torque-training-wrench-target-values')).toBeVisible();
  expect(preparationPayloads).toHaveLength(1);
  expect(preparationPayloads[0]).toEqual(expect.objectContaining({
    uid: 'NFC-E2E-TRAINING',
    torqueWrenchProfileId: profileId,
    requestId: expect.any(String),
    physicalSettingConfirmed: true
  }));
  expect(preparationPayloads[0]).not.toHaveProperty('lowerLimit');
  await page.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' }).click();
  await expectMaxWidth(page.getByTestId('torque-training-wrench-connection'), 512);
  await expect(page.getByTestId('torque-training-wrench-target-values')).toHaveCount(0);
  const attemptHistory = page.getByRole('region', { name: '訓練試行履歴' });
  await expectMaxWidth(attemptHistory, 512);
  await expect.poll(() => trainingHeartbeats, { timeout: 15_000 }).toBeGreaterThanOrEqual(5);
  const sessionGetsBeforeFallback = trainingSessionGets;
  await expect.poll(() => trainingSessionGets, { timeout: 3_000 }).toBeGreaterThan(sessionGetsBeforeFallback);
  committedAttemptCount = 1;
  await emitTorqueTrainingCommitted(page, session().id, 'training-source-event-1');
  await expect(attemptHistory.getByTestId('torque-training-attempt-1')).toContainText('10 Nm', { timeout: 1_000 });
  await expect(attemptHistory.getByTestId('torque-training-attempt-1')).toContainText('OK', { timeout: 1_000 });
  expect(trainingHeartbeatPayloads.slice(0, 5)).toHaveLength(5);
  for (const payload of trainingHeartbeatPayloads.slice(0, 5)) {
    expect(payload).toEqual({
      sessionId: session().id,
      confirmationId: '88888888-8888-4888-8888-888888888888',
      torqueWrenchProfileId: profileId,
      currentTemplateBoltId: null,
      targetKind: 'training'
    });
  }
  committedAttemptCount = 5;
  await emitTorqueTrainingCommitted(page, session().id, 'training-source-event-5');
  await expect(page.getByText('訓練が完了しました。次の作業者はNFCタグを読み取ってください。')).toBeVisible();
  await expect(page.getByText('E2E 作業者', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '設定', exact: true }).click();
  const accessDialog = page.getByRole('dialog', { name: '訓練設定の認証' });
  await expect(accessDialog).toBeVisible();
  await accessDialog.getByLabel('操作時パスワード').fill('0000');
  await accessDialog.getByRole('button', { name: '認証する' }).click();
  await expect(accessDialog.getByRole('alert')).toHaveText('操作時パスワードが違います。');
  await accessDialog.getByLabel('操作時パスワード').fill('2520');
  await accessDialog.getByRole('button', { name: '認証する' }).click();
  await expect(accessDialog).toBeHidden();
  expect(adminLoginCalls).toBe(0);
  expect(settingsSnapshotCalls).toBe(2);
  const settingsButton = page.getByRole('button', { name: '設定', exact: true });

  const settingsDialog = page.getByRole('dialog').last();
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog).toHaveAttribute('aria-modal', 'true');
  await expect(settingsDialog).toHaveCSS('z-index', '80');
  const settingsPanel = settingsDialog.locator(':scope > div').first();
  await expect(settingsPanel).toHaveCSS('background-color', 'rgb(2, 6, 23)');
  await expectMaxWidth(settingsPanel, 768);
  await expectNoHorizontalOverflow(page);

  await expect(settingsDialog.getByRole('tab', { name: '訓練メニュー' })).toBeVisible();
  await expect(settingsDialog.getByRole('tab', { name: '訓練実績' })).toBeVisible();

  // Settings must be a deliberate modal flow: clicking the backdrop cannot
  // discard an in-progress configuration, while Escape is an explicit close.
  await page.mouse.click(2, 2);
  await expect(settingsDialog).toBeVisible();

  await settingsDialog.getByRole('tab', { name: '訓練実績' }).click();
  const resultSearch = settingsDialog.getByPlaceholder('氏名・社員コード・メニューで検索');
  await expect(resultSearch).toBeVisible();
  await expectMaxWidth(resultSearch, 448);
  const exclusionReason = settingsDialog.getByPlaceholder('除外理由');
  await expect(exclusionReason).toBeVisible();
  await expectMaxWidth(exclusionReason, 384);
  await expect(settingsDialog.getByText('E2E 作業者', { exact: false })).toBeVisible();
  await resultSearch.fill('TRAINING-E2E');
  await expect(settingsDialog.getByText('E2E 作業者', { exact: false })).toBeVisible();
  await resultSearch.fill('no-such-training-result');
  await expect(settingsDialog.getByPlaceholder('除外理由')).toHaveCount(0);
  await resultSearch.fill('');
  await expect(settingsDialog.getByPlaceholder('除外理由')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(settingsDialog).toBeHidden();
  await expect(settingsButton).toBeFocused();

  await page.setViewportSize({ width: 1366, height: 768 });
  await expectMaxWidth(page.getByLabel('対象ボルト・訓練メニュー'), 576);
  await settingsButton.click();
  const compactAccessDialog = page.getByRole('dialog', { name: '訓練設定の認証' });
  await compactAccessDialog.getByLabel('操作時パスワード').fill('2520');
  await compactAccessDialog.getByRole('button', { name: '認証する' }).click();
  const compactSettingsDialog = page.getByRole('dialog').last();
  await expect(compactSettingsDialog).toBeVisible();
  await expect(compactSettingsDialog).toHaveCSS('z-index', '80');
  const compactSettingsPanel = compactSettingsDialog.locator(':scope > div').first();
  await expect(compactSettingsPanel).toHaveCSS('background-color', 'rgb(2, 6, 23)');
  await expectMaxWidth(compactSettingsPanel, 768);
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(compactSettingsDialog).toBeHidden();
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
]) {
  test(`BOLT条件のみは設定照合なしで再試行と期限切れ再確認を行う ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    let preparationCalls = 0;
    let acquireCalls = 0;
    let agentAcquired = false;
    const preparationPayloads: Array<Record<string, unknown>> = [];
    await installMockNfc(page);
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.localStorage.setItem('factory-auth', JSON.stringify({
        token: 'bolt-viewer-token',
        user: { id: 'bolt-viewer-e2e', username: 'viewer', role: 'VIEWER', mfaEnabled: false },
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }));
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/src/api/')) return route.continue();
      if (path === '/api/kiosk/config') return route.fulfill({ json: { kioskInitialRoute: 'assembly', navTabOrder: [] } });
      if (path === '/api/system/deploy-status') return route.fulfill({ json: { isMaintenance: false } });
      if (path === '/api/torque-training/programs' && request.method() === 'GET') {
        return route.fulfill({ json: { programs: [boltProgram] } });
      }
      if (path === '/api/torque-training/operator-context') {
        return route.fulfill({ json: {
          employee: { id: employeeId, employeeCode: 'E2E-BOLT', displayName: 'BOLT 作業者' },
          currentSession: null,
          metrics: []
        } });
      }
      if (path === '/api/torque-training/sessions' && request.method() === 'POST') {
        return route.fulfill({ status: 201, json: { session: session('IN_PROGRESS', 0, boltVersion, boltProgram.code) } });
      }
      if (path.endsWith(`/sessions/${session().id}`) && request.method() === 'GET') {
        return route.fulfill({ json: { session: session('IN_PROGRESS', 0, boltVersion, boltProgram.code) } });
      }
      if (path.endsWith('/wrench-preparations') && request.method() === 'POST') {
        preparationCalls += 1;
        preparationPayloads.push(request.postDataJSON() as Record<string, unknown>);
        const body = preparationPayloads.at(-1) ?? {};
        return route.fulfill({ status: 201, json: { preparation: {
          confirmationId: `bolt-confirmation-${preparationCalls}`,
          requestId: body.requestId,
          torqueWrenchProfileId: boltProfileId,
          serialNumber: '702903S',
          settingHistoryId: null,
          settingVerificationMode: 'BOLT_CONDITION_ONLY',
          target: { lowerLimit: '9', nominalTorque: '10', upperLimit: '11', unit: 'N-m' },
          confirmedAt: '2026-08-27T00:00:00.000Z',
          duplicate: false
        } } });
      }
      return route.fulfill({ json: {} });
    });
    await page.route('http://127.0.0.1:7073/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const headers = { 'access-control-allow-origin': '*' };
      const ownedStatus = {
        ok: true,
        ready: false,
        state: 'owned_by_self',
        owner: null,
        bound: true,
        leaseOwned: true,
        bluetoothPowered: true,
        hidExclusive: true,
        lastError: null,
        selfOwnedToken: {
          targetKind: 'training',
          sessionId: session().id,
          torqueWrenchProfileId: boltProfileId,
          leaseId: 'bolt-lease-1',
          generation: 1
        }
      };
      if (path === '/health') {
        return route.fulfill({ headers, json: {
          ok: true,
          ready: true,
          state: 'available',
          owner: null,
          bound: false,
          leaseOwned: false,
          bluetoothPowered: false,
          hidExclusive: false,
          lastError: null,
          wrenchSerialNumbers: ['702903S']
        } });
      }
      if (path === '/lease/acquire') {
        acquireCalls += 1;
        if (acquireCalls === 1) {
          return route.fulfill({ headers, json: {
            ok: true,
            ready: false,
            state: 'available',
            owner: null,
            bound: false,
            leaseOwned: false,
            bluetoothPowered: false,
            hidExclusive: false,
            lastError: 'AGENT_WARMING_UP',
            wrenchSerialNumbers: ['702903S']
          } });
        }
        if (acquireCalls === 2) {
          return route.fulfill({ headers, json: {
            ok: true,
            ready: false,
            state: 'expired',
            owner: null,
            bound: false,
            leaseOwned: false,
            bluetoothPowered: false,
            hidExclusive: false,
            lastError: 'TORQUE_WRENCH_LEASE_EXPIRED',
            wrenchSerialNumbers: ['702903S']
          } });
        }
        agentAcquired = true;
        return route.fulfill({ headers, json: ownedStatus });
      }
      if (path === '/heartbeat') {
        return route.fulfill({ headers, json: agentAcquired ? ownedStatus : {
          ok: true,
          ready: false,
          state: 'available',
          owner: null,
          bound: false,
          leaseOwned: false,
          bluetoothPowered: false,
          hidExclusive: false,
          lastError: null,
          wrenchSerialNumbers: ['702903S']
        } });
      }
      return route.fulfill({ headers, json: { ok: true, ready: false, state: 'available', leaseOwned: false, lastError: null } });
    });

    await page.goto('/kiosk/assembly/training', { waitUntil: 'networkidle' });
    await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __trainingNfcReady?: boolean }).__trainingNfcReady))).toBe(true);
    await emitNfc(page, 'NFC-E2E-BOLT');
    await expect(page.getByText('BOLT 作業者', { exact: true })).toBeVisible();
    await page.getByLabel('対象ボルト・訓練メニュー').selectOption(boltVersionId);
    await page.getByRole('button', { name: '訓練を開始' }).click();
    await expect(page.getByTestId('torque-training-wrench-target-values')).toBeVisible();
    await expect(page.getByText('設定照合対象外')).toBeVisible();
    await expect(page.getByTestId('torque-training-wrench-target-values')).toContainText('702903S');
    await expect(page.getByTestId('torque-training-wrench-target-values')).toContainText('9 N·m');
    await expect(page.getByTestId('torque-training-wrench-target-values')).toContainText('10 N·m');
    await expect(page.getByTestId('torque-training-wrench-target-values')).toContainText('11 N·m');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.locator('input[type="number"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`bolt-target-${viewport.width}x${viewport.height}.png`), fullPage: true });

    const connect = page.getByRole('button', { name: 'レンチ本体を表示値に設定して接続' });
    await expect(connect).toBeEnabled();
    await connect.dblclick();
    await expect(page.getByTestId('torque-training-setting-registered')).toBeVisible();
    expect(preparationCalls).toBe(1);
    expect(preparationPayloads[0]).toEqual(expect.objectContaining({
      uid: 'NFC-E2E-BOLT',
      torqueWrenchProfileId: boltProfileId,
      physicalSettingConfirmed: true,
      requestId: expect.any(String)
    }));
    expect(preparationPayloads[0]).not.toHaveProperty('lowerLimit');
    expect(preparationPayloads[0]).not.toHaveProperty('nominalTorque');
    expect(preparationPayloads[0]).not.toHaveProperty('upperLimit');

    await connect.click();
    await expect(page.getByText('確認状態が古くなりました。訓練対象とレンチを確認して接続し直してください。')).toBeVisible();
    await expect.poll(() => preparationCalls).toBe(1);
    await expect(connect).toBeEnabled();

    await connect.click();
    await expect(page.getByTestId('torque-training-wrench-connection')).toBeVisible();
    await expect(page.getByTestId('torque-training-wrench-target-values')).toHaveCount(0);
    expect(preparationCalls).toBe(2);
    expect(acquireCalls).toBe(3);
    expect(preparationPayloads[1]?.requestId).not.toBe(preparationPayloads[0]?.requestId);
  });
}
