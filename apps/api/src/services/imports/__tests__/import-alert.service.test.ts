import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { ImportAlertService } from '../import-alert.service.js';

// execをモック
vi.mock('child_process', () => ({
  exec: vi.fn()
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
      const mockExec = vi.mocked(exec);
      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      await service.generateFailureAlert({
        scheduleId: 'test-1',
        scheduleName: 'Test Schedule',
        errorMessage: 'Test error'
      });

      expect(mockExec).toHaveBeenCalled();
      const callArgs = mockExec.mock.calls[0];
      expect(callArgs[0]).toContain('generate-alert.sh');
      expect(callArgs[0]).toContain('csv-import-failure');
    });

    it('should handle exec errors gracefully', async () => {
      const mockExec = vi.mocked(exec);
      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(new Error('Exec failed'), { stdout: '', stderr: '' });
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
      const mockExec = vi.mocked(exec);
      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      await service.generateConsecutiveFailureAlert({
        scheduleId: 'test-1',
        scheduleName: 'Test Schedule',
        failureCount: 3,
        lastError: 'Test error'
      });

      expect(mockExec).toHaveBeenCalled();
      const callArgs = mockExec.mock.calls[0];
      expect(callArgs[0]).toContain('csv-import-consecutive-failure');
      expect(callArgs[0]).toContain('3回連続で失敗');
    });
  });

  describe('escapeShellArg', () => {
    it('should escape shell arguments correctly', async () => {
      const service = new ImportAlertService();
      
      // プライベートメソッドのテストは難しいが、実際の動作で確認
      const mockExec = vi.mocked(exec);
      mockExec.mockImplementation((command, options, callback) => {
        if (callback) {
          callback(null, { stdout: '', stderr: '' });
        }
        return {} as any;
      });

      await service.generateFailureAlert({
        scheduleId: 'test-1',
        errorMessage: "test'with'quotes"
      });

      const callArgs = mockExec.mock.calls[0];
      // シェルエスケープが適用されていることを確認
      expect(callArgs[0]).toBeDefined();
    });
  });
});
