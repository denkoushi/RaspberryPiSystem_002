import { describe, expect, it } from 'vitest';
import { BackupVerifier } from '../backup-verifier.js';
import crypto from 'crypto';

describe('BackupVerifier', () => {
  describe('verify', () => {
    it('should verify valid backup file without expected values', () => {
      const data = Buffer.from('test backup data');
      const result = BackupVerifier.verify(data);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.fileSize).toBe(data.length);
      expect(result.hash).toBeDefined();
    });

    it('should verify backup file with matching expected size', () => {
      const data = Buffer.from('test backup data');
      const result = BackupVerifier.verify(data, data.length);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.fileSize).toBe(data.length);
    });

    it('should fail verification when file size does not match', () => {
      const data = Buffer.from('test backup data');
      const result = BackupVerifier.verify(data, 100);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('File size mismatch'))).toBe(true);
    });

    it('should verify backup file with matching expected hash', () => {
      const data = Buffer.from('test backup data');
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      const result = BackupVerifier.verify(data, undefined, hash);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.hash).toBe(hash);
    });

    it('should fail verification when hash does not match', () => {
      const data = Buffer.from('test backup data');
      const result = BackupVerifier.verify(data, undefined, 'invalid-hash');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Hash mismatch'))).toBe(true);
    });

    it('should fail verification for empty file', () => {
      const data = Buffer.from('');
      const result = BackupVerifier.verify(data);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('File is empty');
    });

    it('should verify backup file with both expected size and hash', () => {
      const data = Buffer.from('test backup data');
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      const result = BackupVerifier.verify(data, data.length, hash);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('calculateHash', () => {
    it('should calculate SHA256 hash correctly', () => {
      const data = Buffer.from('test backup data');
      const hash = BackupVerifier.calculateHash(data);
      const expectedHash = crypto.createHash('sha256').update(data).digest('hex');

      expect(hash).toBe(expectedHash);
      expect(hash).toHaveLength(64); // SHA256 produces 64-character hex string
    });
  });

  describe('verifyFormat', () => {
    it('should verify database backup format', () => {
      const data = Buffer.from('-- PostgreSQL database dump\n-- Version 14');
      const result = BackupVerifier.verifyFormat(data, {
        type: 'database',
        source: 'borrow_return'
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail verification for invalid database backup format', () => {
      const data = Buffer.from('invalid backup data');
      const result = BackupVerifier.verifyFormat(data, {
        type: 'database',
        source: 'borrow_return'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid database backup format'))).toBe(true);
    });

    it('should verify CSV backup format', () => {
      const data = Buffer.from('employeeCode,displayName\n0001,Test');
      const result = BackupVerifier.verifyFormat(data, {
        type: 'csv',
        source: 'employees'
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail verification for invalid CSV format', () => {
      const data = Buffer.from('invalid data without commas or newlines');
      const result = BackupVerifier.verifyFormat(data, {
        type: 'csv',
        source: 'employees'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid CSV format'))).toBe(true);
    });
  });
});
