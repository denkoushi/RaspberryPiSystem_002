import { describe, expect, it } from 'vitest';

import {
  defaultSignageUploadName,
  detectSignageUploadFileType,
  isSignageImageFilename,
  normalizeSignageUploadFilename,
} from '../signage-upload-file-type.js';

describe('detectSignageUploadFileType', () => {
  it('detects PDF, JPEG and PNG by their leading bytes', () => {
    expect(detectSignageUploadFileType(Buffer.from('%PDF-1.7\n...'))).toBe('pdf');
    expect(detectSignageUploadFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('jpeg');
    expect(detectSignageUploadFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('png');
  });

  it('rejects everything else, including files that only claim to be an image', () => {
    expect(detectSignageUploadFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectSignageUploadFileType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectSignageUploadFileType(Buffer.alloc(0))).toBeNull();
  });
});

describe('filename helpers', () => {
  it('aligns the extension with the detected type', () => {
    expect(normalizeSignageUploadFilename('掲示.PNG', 'png')).toBe('掲示.png');
    expect(normalizeSignageUploadFilename('poster.pdf', 'jpeg')).toBe('poster.jpg');
    expect(normalizeSignageUploadFilename('', 'pdf')).toBe('upload.pdf');
  });

  it('recognises image files and derives a display name', () => {
    expect(isSignageImageFilename('a_1234.jpg')).toBe(true);
    expect(isSignageImageFilename('a_1234.JPEG')).toBe(true);
    expect(isSignageImageFilename('a_1234.pdf')).toBe(false);
    expect(defaultSignageUploadName('安全掲示.png')).toBe('安全掲示');
    expect(defaultSignageUploadName('手順書.pdf')).toBe('手順書');
  });
});
