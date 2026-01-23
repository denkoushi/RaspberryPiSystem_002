import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'child_process';
import { ImportAlertService } from '../import-alert.service.js';

// execFileをモック
vi.mock('child_process', () => ({
  execFile: vi.fn()
}));

describe('ImportAlertService', () => {
  let service: ImportAlertService;
  const originalProjectRoot = process.env.PROJECT_ROOT;

  beforeEach(() => {
    // テスト用のプロジェクトルートを設定
    process.env.PROJECT_ROOT = '/tmp/test-project';
    service = new ImportAlertService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalProjectRoot) {
      process.env.PROJECT_ROOT = originalProjectRoot;
    } else {
      delete process.env.PROJECT_ROOT;
    }
  });

  describe('generateFailureAlert', () => {
    it('should generate failure alert', async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((file: any, args: any, optionsOrCallback: any, callback?: any) => {
        // promisifyは最後の引数がコールバックであることを期待
        const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        if (cb) {
          setImmediate(() => cb(null, Buffer.from(''), Buffer.from('')));
        }
        return {} as any;
      });

      await service.generateFailureAlert({
        scheduleId: 'test-1',
        scheduleName: 'Test Schedule',
        errorMessage: 'Test error'
      });

      expect(mockExecFile).toHaveBeenCalled();
      const callArgs = mockExecFile.mock.calls[0];
      expect(callArgs[0]).toBe('bash');
      expect(Array.isArray(callArgs[1])).toBe(true);
      const args = callArgs[1] as string[];
      expect(args[0]).toContain('generate-alert.sh');
      expect(args[1]).toBe('csv-import-failure');
    });

    it('should handle execFile errors gracefully', async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((file: any, args: any, optionsOrCallback: any, callback?: any) => {
        const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        if (cb) {
          setImmediate(() => cb(new Error('ExecFile failed'), Buffer.from(''), Buffer.from('')));
        }
        return {} as any;
      });

      // エラーが発生しても例外を投げないことを確認
      await expect(
        service.generateFailureAlert({
          scheduleId: 'test-1',
          errorMessage: 'Test error'
        })
      ).resolves.not.toThrow();
    });
  });

  describe('generateConsecutiveFailureAlert', () => {
    it('should generate consecutive failure alert', async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((file: any, args: any, optionsOrCallback: any, callback?: any) => {
        const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        if (cb) {
          setImmediate(() => cb(null, Buffer.from(''), Buffer.from('')));
        }
        return {} as any;
      });

      await service.generateConsecutiveFailureAlert({
        scheduleId: 'test-1',
        scheduleName: 'Test Schedule',
        failureCount: 3,
        lastError: 'Test error'
      });

      expect(mockExecFile).toHaveBeenCalled();
      const callArgs = mockExecFile.mock.calls[0];
      expect(callArgs[0]).toBe('bash');
      const args = callArgs[1] as string[];
      expect(args[1]).toBe('csv-import-consecutive-failure');
      expect(args[2]).toContain('3回連続で失敗');
    });
  });

  describe('escapeShellArg', () => {
    it('should escape shell arguments correctly', async () => {
      const service = new ImportAlertService();
      
      // execFileは引数配列として渡すため、シェルエスケープは不要
      // 実際の動作で確認
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((file: any, args: any, optionsOrCallback: any, callback?: any) => {
        const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        if (cb) {
          setImmediate(() => cb(null, Buffer.from(''), Buffer.from('')));
        }
        return {} as any;
      });

      await service.generateFailureAlert({
        scheduleId: 'test-1',
        errorMessage: "test'with'quotes"
      });

      const callArgs = mockExecFile.mock.calls[0];
      // execFileが呼ばれていることを確認（引数配列として渡される）
      expect(callArgs[0]).toBe('bash');
      expect(Array.isArray(callArgs[1])).toBe(true);
    });
  });
});
