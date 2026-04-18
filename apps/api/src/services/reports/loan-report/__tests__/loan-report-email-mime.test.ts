import { describe, expect, it } from 'vitest';

import { buildLoanReportMultipartMime } from '../loan-report-email-mime.js';

describe('loan-report-email-mime', () => {
  it('builds MIME with wrapped base64 attachment lines', () => {
    const html = '<html><body>' + 'a'.repeat(300) + '</body></html>';
    const mime = buildLoanReportMultipartMime({
      to: 'qa@example.com',
      subject: '貸出レポート',
      textBody: 'text body',
      htmlBody: '<p>html body</p>',
      attachmentName: 'loan-report.html',
      attachmentHtml: html,
    });

    expect(mime).toContain('Content-Type: multipart/mixed;');
    expect(mime).toContain('Content-Disposition: attachment; filename="loan-report.html"');

    const attachmentStart = mime.indexOf('Content-Disposition: attachment; filename="loan-report.html"');
    const attachmentBody = mime.slice(attachmentStart).split('\r\n\r\n')[1]?.split('\r\n--')[0] ?? '';
    const encodedLines = attachmentBody.split('\r\n').filter(Boolean);

    expect(encodedLines.length).toBeGreaterThan(1);
    expect(encodedLines.every((line) => line.length <= 76)).toBe(true);
  });
});
