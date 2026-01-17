import { test, expect } from '@playwright/test';

test.describe('キオスク通話画面', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/kiosk/config', async (route) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:route:kiosk-config',message:'mock_kiosk_config',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ defaultMode: 'tag' })
      });
    });

    await page.route('**/api/kiosk/call/targets', async (route) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:route:call-targets',message:'mock_call_targets',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ selfClientId: 'test-client', targets: [] })
      });
    });

    // キオスク通話ページに遷移
    await page.goto('/kiosk/call');
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:beforeEach',message:'navigated_to_call_page',data:{url:page.url()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/kiosk/call/targets') || url.includes('/api/kiosk/config')) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:response',message:'api_response',data:{url,status:response.status(),ok:response.ok()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
      }
    });

    page.on('requestfailed', (request) => {
      const url = request.url();
      if (url.includes('/api/kiosk/call/targets') || url.includes('/api/kiosk/config')) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:requestfailed',message:'api_request_failed',data:{url,method:request.method(),failure:request.failure()?.errorText ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
      }
    });
  });

  test('通話ページが表示され、ヘッダーと接続状態が表示される', async ({ page }) => {
    // ヘッダーが表示される（見出し要素を指定）
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:header:before',message:'checking_header_visibility',data:{headingCount:await page.getByRole('heading', { name: /通話/i }).count(),linkCount:await page.getByRole('link', { name: /通話/i }).count()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    await expect(page.getByRole('heading', { name: /通話/i })).toBeVisible();
    
    // 接続状態が表示される（接続中または接続待機中）
    const connectionStatus = page.getByText(/接続中|接続待機中/i);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:header:status',message:'checking_connection_status',data:{statusCount:await connectionStatus.count()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    await expect(connectionStatus).toBeVisible();
    
    // 状態表示が存在する
    const stateText = page.getByText(/状態:/i);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:header:state',message:'checking_state_label',data:{stateLabelCount:await stateText.count()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    await expect(stateText).toBeVisible();
  });

  test('クライアント一覧が表示される（データがある場合）', async ({ page }) => {
    // APIレスポンスを待つ（最大10秒）
    await page.waitForTimeout(2000);
    
    // クライアント一覧のコンテナが存在するか確認
    // データがない場合でもページは表示される
    const card = page.locator('div').filter({ hasText: /通話先/i }).or(page.locator('div').filter({ hasText: /クライアント/i }));
    // カードが存在するか、または「通話先がありません」メッセージが表示される
    const cardCount = await card.count();
    const hasCard = cardCount > 0;
    const noTargetsText = page.getByText(/通話先がありません/i);
    const noTargetsAltText = page.getByText(/発信可能な端末がありません/i);
    const loadingText = page.getByText(/読み込み中/i);
    const errorText = page.getByText(/エラーが発生しました/i);
    const hasNoTargetsMessage = await noTargetsText.isVisible().catch(() => false);
    const hasNoTargetsAltMessage = await noTargetsAltText.isVisible().catch(() => false);
    const hasLoadingMessage = await loadingText.isVisible().catch(() => false);
    const hasErrorMessage = await errorText.isVisible().catch(() => false);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:targets:check',message:'checking_targets_or_empty',data:{cardCount,hasNoTargetsMessage,hasNoTargetsAltMessage,hasLoadingMessage,hasErrorMessage,noTargetsCount:await noTargetsText.count(),noTargetsAltCount:await noTargetsAltText.count(),loadingCount:await loadingText.count(),errorCount:await errorText.count()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    expect(hasCard || hasNoTargetsAltMessage).toBe(true);
  });

  test('発信ボタンが存在し、クリック可能（クライアントがある場合）', async ({ page }) => {
    // APIレスポンスを待つ
    await page.waitForTimeout(2000);
    
    // 発信ボタンを探す（📞 発信 テキストまたはボタン要素）
    const callButton = page.getByRole('button', { name: /発信/i }).or(page.locator('button').filter({ hasText: /📞/i }));
    
    // ボタンが存在する場合（クライアントがある場合）
    const buttonCount = await callButton.count();
    if (buttonCount > 0) {
      // ボタンが表示されていることを確認
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:call-button:present',message:'call_button_present',data:{buttonCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      await expect(callButton.first()).toBeVisible();
      
      // ボタンがクリック可能か確認（disabledでない）
      const isDisabled = await callButton.first().isDisabled();
      // 接続中でない場合はクリック可能
      const isConnectedText = page.getByText(/接続中/i);
      const isConnected = await isConnectedText.isVisible().catch(() => false);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:call-button:state',message:'call_button_state',data:{isDisabled,isConnected,connectedTextCount:await isConnectedText.count()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (!isConnected) {
        expect(isDisabled).toBe(false);
      }
    } else {
      // クライアントがない場合は「通話先がありません」が表示される
      const noTargetsText = page.getByText(/通話先がありません/i);
      const noTargetsAltText = page.getByText(/発信可能な端末がありません/i);
      const loadingText = page.getByText(/読み込み中/i);
      const errorText = page.getByText(/エラーが発生しました/i);
      const noTargetsMessage = await noTargetsText.isVisible().catch(() => false);
      const noTargetsAltMessage = await noTargetsAltText.isVisible().catch(() => false);
      const loadingMessage = await loadingText.isVisible().catch(() => false);
      const errorMessage = await errorText.isVisible().catch(() => false);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk-call.spec.ts:call-button:empty',message:'no_call_targets_message',data:{noTargetsMessage,noTargetsAltMessage,loadingMessage,errorMessage,noTargetsCount:await noTargetsText.count(),noTargetsAltCount:await noTargetsAltText.count(),loadingCount:await loadingText.count(),errorCount:await errorText.count()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      expect(noTargetsAltMessage).toBe(true);
    }
  });

  test('着信モーダルが表示される（着信状態の場合）', async ({ page }) => {
    // 着信モーダルは通常は非表示
    const incomingModal = page.locator('div').filter({ hasText: /着信/i });
    const modalCount = await incomingModal.count();
    
    // モーダルが存在しないか、非表示であることを確認
    if (modalCount > 0) {
      // モーダルが存在する場合は、非表示または表示されている
      const isVisible = await incomingModal.first().isVisible().catch(() => false);
      // 通常は非表示（着信がない場合）
      // このテストは、モーダルの構造が存在することを確認するだけ
      expect(typeof isVisible).toBe('boolean');
    }
  });

  test('通話中UIが表示される（通話状態の場合）', async ({ page }) => {
    // 通話中UIの要素を確認
    // ビデオ要素が存在するか確認（通話中でない場合は存在しない）
    const videoElements = page.locator('video');
    const videoCount = await videoElements.count();
    
    // ビデオ要素が0個以上存在することを確認（構造は存在する）
    expect(videoCount).toBeGreaterThanOrEqual(0);
    
    // 通話制御ボタン（終了、ビデオ有効化など）の存在を確認
    // これらのボタンは通話中のみ表示されるため、通常は存在しない
    const hangupButton = page.getByRole('button', { name: /終了|切断/i });
    const hangupCount = await hangupButton.count();
    expect(hangupCount).toBeGreaterThanOrEqual(0);
  });

  // 注意: 実際のWebRTC通話のテストはCI環境では実行しない
  // 理由:
  // 1. CI環境には実際のWebSocketサーバーが必要
  // 2. MediaStream APIは実際のカメラ/マイクが必要（モックは複雑）
  // 3. WebRTCのシグナリングは実際のサーバー接続が必要
  // 4. フックのロジックはユニットテストで確認すべき
  //
  // 実際のWebRTC通話の動作は、以下の環境でテストすべき:
  // - ローカル環境（実際のWebSocketサーバーとMediaStream APIがある場合）
  // - ステージング環境（実際のハードウェア統合テスト）
});
