import { createHash } from 'node:crypto';
import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { ProcedureManualMailService, formatProcedureManualMailTime } from '../procedure-manual-mail.service.js';
import { ApiError } from '../../../lib/errors.js';
import { isProcedureManualMailLocalPart, procedureManualMailDomainSchema } from '../procedure-manual-mail-address.js';

const documentId = 'c6d95b85-7035-4a35-900a-f15061444366';
const revisionId = 'f4602499-11ac-4686-a073-b1668a70d2c2';
const request = { documentId, revisionId, nfcUid: 'employee-tag', localPart: 'worker.001' };
const client = { id: 'client-1', name: '組立キオスク' };
const now = new Date('2026-11-18T15:07:08.009Z');
const path1 = '/api/storage/assembly-procedure-images/page1.png';
const path2 = '/api/storage/assembly-procedure-images/page2.png';
const document = {
  id: revisionId,
  name: '部品組立',
  isActive: true,
  status: 'PUBLISHED',
  revisionMetadata: { revisionRootId: documentId, revisionNumber: 2, isRevisionHead: true },
  publishedAt: new Date('2026-11-13T15:01:00Z'),
  createdAt: new Date('2026-11-12T01:00:00Z'),
  updatedAt: new Date('2026-11-13T15:01:00Z'),
  pages: [{ pageIndex: 0, imageRelativePath: path1 }, { pageIndex: 1, imageRelativePath: path2 }],
  imageRelativePath: path1,
  overlayElements: [],
};
const employee = {
  id: 'employee-1', employeeCode: '00042', displayName: '山田 花子', nfcTagUid: 'employee-tag', status: 'ACTIVE',
};
const pdf = Buffer.from('%PDF-test');

function setup() {
  const render = vi.fn().mockResolvedValue(pdf);
  const assertAvailable = vi.fn(async () => undefined);
  const send = vi.fn().mockResolvedValue({ id: 'gmail-message-1' });
  const db = {
    assemblyProcedureDocument: { findFirst: vi.fn().mockResolvedValue(null) },
    assemblyProcedureDocumentRevision: { findFirst: vi.fn().mockResolvedValue({ document }) },
    employee: { findFirst: vi.fn().mockResolvedValue(employee) },
    procedureManualMailDelivery: {
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'delivery-1', ...data })),
    },
  };
  const getDomain = vi.fn<() => string | undefined>(() => 'example.com');
  const service = new ProcedureManualMailService(
    { render }, { assertAvailable, send: async (mail, beforeSend) => { await beforeSend(); return send(mail); } },
    db as unknown as ConstructorParameters<typeof ProcedureManualMailService>[2],
    getDomain, () => now,
  );
  return { service, db, getDomain, render, send, assertAvailable };
}

describe('procedure manual mail address', () => {
  it.each(['', 'a'.repeat(65), '.ab', 'ab.', 'a..b', 'ab@example.com', '日本語', 'a+b', 'a b', 'a\r', 'a\n', 'a\0'])(
    'rejects an invalid local part %j', (value) => expect(isProcedureManualMailLocalPart(value)).toBe(false),
  );

  it('accepts permitted characters and exactly 64 characters', () => {
    expect(isProcedureManualMailLocalPart('A_1-b.c')).toBe(true);
    expect(isProcedureManualMailLocalPart('a'.repeat(64))).toBe(true);
    fc.assert(fc.property(
      fc.stringMatching(/^[A-Za-z0-9_-]{1,21}(\.[A-Za-z0-9_-]{1,20}){0,2}$/),
      (value) => isProcedureManualMailLocalPart(value) && !isProcedureManualMailLocalPart(`${value}\r\n`),
    ));
  });

  it('treats a blank domain as disabled and validates DNS labels', () => {
    expect(procedureManualMailDomainSchema.parse('  ')).toBeUndefined();
    expect(procedureManualMailDomainSchema.parse(' EXAMPLE.com ')).toBe('example.com');
    expect(procedureManualMailDomainSchema.safeParse('example.com\r\nBcc: foo.example').success).toBe(false);
  });
});

describe('ProcedureManualMailService', () => {
  it('rejects a disabled feature before any lookup or work', async () => {
    const { service, getDomain, db, render, send } = setup();
    getDomain.mockReturnValue(undefined);
    await expect(service.send(request, client)).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_DISABLED' });
    expect(db.assemblyProcedureDocumentRevision.findFirst).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects an invalid local part before looking up a document', async () => {
    const { service, db } = setup();
    await expect(service.send({ ...request, localPart: 'worker@example.net' }, client))
      .rejects.toMatchObject({ code: 'PROCEDURE_MAIL_INVALID_LOCAL_PART' });
    expect(db.assemblyProcedureDocumentRevision.findFirst).not.toHaveBeenCalled();
  });

  it.each([null, { document: { ...document, id: 'newer-revision' } }])(
    'rejects a missing or superseded published revision %#', async (resolved) => {
      const { service, db, render, send } = setup();
      db.assemblyProcedureDocumentRevision.findFirst.mockResolvedValue(resolved);
      await expect(service.send(request, client)).rejects.toMatchObject({
        code: 'PROCEDURE_MAIL_REVISION_NOT_CURRENT', statusCode: 409,
      });
      expect(render).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('sends the latest active publication even when a newer draft is the revision head', async () => {
    const { service, db, send } = setup();
    const revisions = [
      { document: { ...document, id: 'draft', status: 'DRAFT', revisionMetadata: { ...document.revisionMetadata, revisionNumber: 3 } } },
      { document: { ...document, revisionMetadata: { ...document.revisionMetadata, isRevisionHead: false } } },
    ];
    db.assemblyProcedureDocumentRevision.findFirst.mockImplementation(async ({ where }) => revisions.find(({ document: candidate }) =>
      candidate.status === where.document.status && candidate.isActive === where.document.isActive
      && candidate.revisionMetadata.revisionRootId === where.revisionRootId
    ));
    await expect(service.send(request, client)).resolves.toMatchObject({ deliveryId: 'delivery-1' });
    expect(db.assemblyProcedureDocumentRevision.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { revisionNumber: 'desc' },
    }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, 'PROCEDURE_MAIL_NFC_NOT_FOUND'],
    [{ ...employee, status: 'INACTIVE' }, 'PROCEDURE_MAIL_NFC_INACTIVE'],
  ])('rejects unknown or inactive NFC %#', async (record, code) => {
    const { service, db, render, send } = setup();
    db.employee.findFirst.mockResolvedValue(record);
    await expect(service.send(request, client)).rejects.toMatchObject({ code });
    expect(db.employee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { nfcTagUid: request.nfcUid } }));
    expect(render).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('renders the viewed document in sequence, uses Tokyo time and saves the sent PDF digest', async () => {
    const { service, db, render, send } = setup();
    expect(formatProcedureManualMailTime(now)).toBe('2026-11-19 00:07');
    await expect(service.send(request, client)).resolves.toEqual({
      deliveryId: 'delivery-1', sentAt: '2026-11-19T00:07:08.009+09:00',
      gmailMessageId: 'gmail-message-1', pageCount: 2, pdfByteSize: pdf.length,
    });
    expect(render).toHaveBeenCalledWith([
      expect.objectContaining({
        title: '部品組立', pageLabel: '1 / 2', revisionLabel: '第2版(改版 2026-11-14)',
        pageUrl: path1, crop: null,
        informationLabel: '2026-11-19 00:07 時点の情報です。最新版はキオスクで確認してください。',
        outputLabel: '出力 2026-11-19 00:07 社員番号 00042 組立キオスク 山田 花子',
        watermark: '控え 2026-11-19 社員番号 00042',
      }),
      expect.objectContaining({ pageUrl: path2, pageLabel: '2 / 2' }),
    ], { quality: 90, scale: 2 });
    expect(send).toHaveBeenCalledWith({
      to: 'worker.001@example.com', subject: '要領書の控え 部品組立 第2版', filename: '部品組立 第2版.pdf', pdf,
    });
    expect(db.procedureManualMailDelivery.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        documentId, revisionId, revisionNumber: 2, employeeId: employee.id, employeeCode: employee.employeeCode,
        employeeName: employee.displayName, clientDeviceId: client.id, clientDeviceName: client.name, sentAt: now,
        recipient: 'worker.001@example.com', gmailMessageId: 'gmail-message-1', pageCount: 2, pdfByteSize: pdf.length,
        pdfSha256: createHash('sha256').update(pdf).digest('hex'),
      },
    }));
  });

  it('accepts a legacy published first revision and uses its first image fallback', async () => {
    const { service, db, render } = setup();
    db.assemblyProcedureDocumentRevision.findFirst.mockResolvedValue(null);
    db.assemblyProcedureDocument.findFirst.mockResolvedValue({ ...document, id: documentId, revisionMetadata: null, pages: [] });
    await service.send({ ...request, revisionId: documentId }, client);
    expect(render).toHaveBeenCalledWith([
      expect.objectContaining({ pageUrl: path1, pageLabel: '1 / 1', revisionLabel: '第1版(改版 2026-11-14)' }),
    ], expect.anything());
  });

  it.each([null, { ...document, updatedAt: now }])('rechecks the published snapshot after rendering %#', async (head) => {
    const { service, db, send } = setup();
    db.assemblyProcedureDocumentRevision.findFirst.mockResolvedValueOnce({ document }).mockResolvedValueOnce(head && { document: head });
    await expect(service.send(request, client)).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_REVISION_NOT_CURRENT' });
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a published manual with no page image', async () => {
    const { service, db, render } = setup();
    db.assemblyProcedureDocumentRevision.findFirst.mockResolvedValue({ document: { ...document, pages: [], imageRelativePath: '' } });
    await expect(service.send(request, client)).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_NO_PAGES' });
    expect(render).not.toHaveBeenCalled();
  });

  it.each([25, 26])('enforces the page limit before rendering (%i pages)', async (pageCount) => {
    const { service, db, render, send } = setup();
    const pages = Array.from({ length: pageCount }, (_, pageIndex) => ({ pageIndex, imageRelativePath: path1 }));
    db.assemblyProcedureDocumentRevision.findFirst.mockResolvedValue({ document: { ...document, pages } });
    const delivery = service.send(request, client);
    if (pageCount === 25) {
      await expect(delivery).resolves.toMatchObject({ pageCount });
      expect(render).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledOnce();
    } else {
      await expect(delivery).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_TOO_MANY_PAGES', statusCode: 413 });
      expect(render).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('rejects a known Gmail cooldown before starting Chromium', async () => {
    const { service, assertAvailable, render, send } = setup();
    const deferred = new ApiError(503, 'Cooldown', undefined, 'PROCEDURE_MAIL_GMAIL_DEFERRED');
    assertAvailable.mockRejectedValueOnce(deferred);
    await expect(service.send(request, client)).rejects.toBe(deferred);
    expect(render).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('shares the deadline across render attempts and does not send an earlier acceptable PDF', async () => {
    vi.useFakeTimers();
    try {
      const { service, render, send, db } = setup();
      let finishRender!: (pdf: Buffer) => void;
      render.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(Buffer.alloc(13_000_000)), 50_000)))
        .mockImplementationOnce(() => new Promise<Buffer>(resolve => { finishRender = resolve; }));
      const result = expect(service.send(request, client)).rejects.toMatchObject({
        code: 'PROCEDURE_MAIL_RENDER_TIMEOUT', statusCode: 504,
      });
      await vi.advanceTimersByTimeAsync(74_999);
      expect(render).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await result;
      await expect(service.send(request, client)).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_BUSY' });
      finishRender(pdf);
      await vi.advanceTimersByTimeAsync(0);
      expect(send).not.toHaveBeenCalled();
      expect(db.procedureManualMailDelivery.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lowers JPEG quality to reach the target using the final PDF byte count', async () => {
    const { service, render, send } = setup();
    const reduced = Buffer.alloc(12_000_000);
    render.mockResolvedValueOnce(Buffer.alloc(14_000_001)).mockResolvedValueOnce(reduced);
    await service.send(request, client);
    expect(render.mock.calls.map(([, profile]) => profile)).toEqual([{ quality: 90, scale: 2 }, { quality: 75, scale: 2 }]);
    expect(send.mock.calls[0]?.[0].pdf).toBe(reduced);
  });

  it('accepts exactly the hard byte limit if no profile reaches the target', async () => {
    const { service, render, send } = setup();
    const limit = Buffer.alloc(14_000_000);
    render.mockResolvedValueOnce(limit).mockResolvedValue(Buffer.alloc(14_000_001));
    await service.send(request, client);
    expect(send.mock.calls[0]?.[0].pdf).toBe(limit);
  });

  it('reduces resolution and rejects a PDF that remains too large', async () => {
    const { service, db, render, send } = setup();
    render.mockResolvedValue(Buffer.alloc(30_000_000));
    await expect(service.send(request, client)).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_PDF_TOO_LARGE', statusCode: 413 });
    expect(render.mock.calls.map(([, profile]) => profile)).toEqual([
      { quality: 90, scale: 2 }, { quality: 60, scale: 1.5 }, { quality: 45, scale: 1.25 },
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(db.procedureManualMailDelivery.create).not.toHaveBeenCalled();
  });

  it('refuses another send while Chromium is occupied and unlocks on failure', async () => {
    const { service, render } = setup();
    render.mockRejectedValueOnce(new Error('Chromium failed'));
    const first = service.send(request, client);
    await Promise.all([
      expect(first).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_RENDER_FAILED' }),
      expect(service.send(request, client)).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_BUSY' }),
    ]);
    await expect(service.send(request, client)).resolves.toMatchObject({ deliveryId: 'delivery-1' });
  });

  it('only records successful Gmail sends', async () => {
    const { service, db, send } = setup();
    send.mockRejectedValueOnce(new Error('Gmail failed'));
    await expect(service.send(request, client)).rejects.toThrow('Gmail failed');
    expect(db.procedureManualMailDelivery.create).not.toHaveBeenCalled();
  });

  it('identifies an audit failure after sending so the caller can avoid a duplicate', async () => {
    const { service, db, send } = setup();
    db.procedureManualMailDelivery.create.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(service.send(request, client)).rejects.toMatchObject({ code: 'PROCEDURE_MAIL_RECORD_FAILED' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
