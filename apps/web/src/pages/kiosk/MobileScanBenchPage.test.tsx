import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import appSource from '../../App.tsx?raw';
import { NATIVE_FORMATS } from '../../features/scan-bench/helpers';

import { MobileScanBenchPage } from './MobileScanBenchPage';

import type { NativeBarcode } from '../../features/scan-bench/barcodeDetector';

const zxing = vi.hoisted(() => ({ decodeContinuously: vi.fn(), stopContinuousDecode: vi.fn() }));
vi.mock('../../features/barcode-scan/zxingVideoReader', () => ({ createBrowserMultiFormatReader: () => zxing }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function mockCamera() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia }, vibrate: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLVideoElement) {
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  return { stop, getUserMedia, stream };
}

async function startCamera() {
  fireEvent.click(screen.getByRole('button', { name: 'カメラ開始' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '読む' })).toBeEnabled());
}

describe('MobileScanBenchPage', () => {
  it('shows unavailable native reader without requiring auth or starting camera', async () => {
    const camera = mockCamera();
    vi.stubGlobal('BarcodeDetector', undefined);
    render(<MobileScanBenchPage />);
    expect(await screen.findByText('この端末では高速読取が使えません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '高速読取' })).toBeDisabled();
    expect(camera.getUserMedia).not.toHaveBeenCalled();
  });

  it('lists partial format support and disables the native engine', async () => {
    mockCamera();
    vi.stubGlobal('BarcodeDetector', { getSupportedFormats: async () => ['qr_code'] });
    render(<MobileScanBenchPage />);
    expect(await screen.findByText('対応形式: qr_code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '高速読取' })).toBeDisabled();
  });

  it('keeps the camera across engine switches and reads, stops on hide, and restarts only by tap', async () => {
    const camera = mockCamera();
    const detect = vi.fn().mockResolvedValue([{ rawValue: '123', format: 'code_128' }]);
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => NATIVE_FORMATS;
      detect = detect;
    });
    const view = render(<MobileScanBenchPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '高速読取' })).toBeEnabled());
    await startCamera();
    expect(camera.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment', width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 } }, audio: false });
    fireEvent.click(screen.getByRole('button', { name: '高速読取' }));
    fireEvent.click(screen.getByRole('button', { name: '読む' }));
    await screen.findByRole('button', { name: '次を読む' });
    expect(navigator.vibrate).toHaveBeenCalledWith(80);
    fireEvent.click(screen.getByRole('button', { name: '今の読み方' }));
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    expect(camera.stop).not.toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(camera.stop).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(camera.getUserMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'カメラ開始' }));
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(camera.stop).toHaveBeenCalledTimes(2);
  });

  it('records a timeout and drains an outstanding native detect before the next measurement', async () => {
    mockCamera();
    let resolveDetection!: (value: NativeBarcode[]) => void;
    const detect = vi.fn().mockImplementation(() => new Promise<NativeBarcode[]>((resolve) => { resolveDetection = resolve; }));
    vi.stubGlobal('BarcodeDetector', class {
      static getSupportedFormats = async () => NATIVE_FORMATS;
      detect = detect;
    });
    render(<MobileScanBenchPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '高速読取' })).toBeEnabled());
    await startCamera();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '高速読取' }));
    fireEvent.click(screen.getByRole('button', { name: '読む' }));
    expect(detect).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(15000); });
    expect(screen.getByRole('button', { name: '次を読む' })).toBeEnabled();
    expect(screen.getAllByText('読めず').length).toBeGreaterThan(2);
    fireEvent.click(screen.getByRole('button', { name: '次を読む' }));
    expect(detect).toHaveBeenCalledTimes(1);
    await act(async () => { resolveDetection([{ rawValue: 'stale', format: 'qr_code' }]); });
    expect(detect).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    await act(async () => { resolveDetection([{ rawValue: 'fresh', format: 'qr_code' }]); });
    expect(screen.getAllByText('fresh')).toHaveLength(2);
  });

  it('declares the lazy mobile route inside the sync provider and KioskLayout', () => {
    const source = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found = false;
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'Route' && node.attributes.properties.some((attr) =>
        ts.isJsxAttribute(attr) && attr.name.getText(source) === 'path' && attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === '/kiosk/mobile-placement/scan-bench')) {
        found = true;
        expect(ts.isJsxElement(node.parent) && node.parent.openingElement.getText(source)).toContain('MobileSyncProvider');
        expect(ts.isJsxElement(node.parent.parent) && node.parent.parent.openingElement.getText(source)).toContain('KioskLayout');
        expect(node.getText(source)).toContain('lazyRouteElement(<MobileScanBenchPage />)');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(found).toBe(true);
    expect(appSource).toContain('const MobileScanBenchPage = lazy(');
  });
});
