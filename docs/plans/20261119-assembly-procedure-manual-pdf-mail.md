# Send a copy of an assembly procedure manual as a PDF

This living ExecPlan follows `.agent/PLANS.md`. Maintain Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective as work proceeds.

## Purpose / Big Picture

A worker will be able to email a copy of the assembly manual they are viewing in 組立 > 見る. Phase 1 lets an authenticated kiosk call the API to create and send the copy and record the delivery. Phase 2 will connect the kiosk controls, employee tag scan, and confirmation dialog to this contract.

## Progress

- [x] (2026-11-19) Identify the manual sequence, authentication, storage, and Web capture routes.
- [x] (2026-11-19) Implement the API, print page, Gmail media upload, and additive delivery migration.
- [x] (2026-11-19) Run focused static, migration, and port-based checks and finish independent review.
- [ ] Run the two opt-in Chromium checks in a browser-capable environment.
- [ ] Confirm the production company mail domain, permission to send from the existing Gmail account, and whether the production Gmail grant includes a send scope.
- [ ] Phase 2 kiosk controls and integration are pending.

## Surprises & Discoveries

`apps/api/src/services/assembly/procedure-manual.service.ts` builds the 見る sequence with no stored template steps. Today the viewer advances through the selected document's source image pages in `pageIndex` order. The shared crop component also accepts a crop rectangle for the step-based viewer. Legacy assembly documents are represented as their own first revision by the existing document serializer. Separate kiosk PDF documents have no assembly publication or revision state.

The local sandbox denied the Vite loopback listener with `EPERM` and rejected the cached bundled Chromium executable when it registered its macOS Mach port. The renderer and mail sender ports let the focused tests run with synthetic inputs.

## Decision Log

- On 2026-11-19, Codex chose Chromium to assemble the captured JPEGs in a second, JavaScript-disabled context. Inline images and fixed A4 page styles keep the inputs limited to pixels, use the existing dependency, and let the server measure the actual attachment before sending.
- On 2026-11-19, Codex chose one send at a time per API process, with a busy response to overlapping requests. The delivery table records confirmed sends, following the loan report's success-only logging. The server returns a distinct result if the Gmail send succeeds and the database record fails.

## Outcomes & Retrospective

Phase 1 introduces a client-key-only send endpoint and a feature flag in kiosk config. API and Web TypeScript checks, Prisma validate, and SQL generation passed. Individual Vitest runs across five files passed 82 tests. Two opt-in tests cover real PDF output and the print page capture. Both require a browser-capable environment. A second model reviewed the final implementation and found no outstanding major or medium issues.

Production integration is pending confirmation of the domain, sender account, and Gmail authorization. No database migration was applied and no live mail was sent.

## Context and Orientation

`apps/api/src/routes/assembly/procedure-manual-mail.ts` uses the existing client-key lookup to identify the terminal. `apps/api/src/services/assembly/procedure-manual-mail.service.ts` resolves the active employee from their NFC tag, checks the requested revision, expands the document using the same sequence helpers as 見る, and sends through the Gmail factory already used for loan reports. `apps/web/assembly-procedure-print.html` is a dedicated Vite entry. It uses the kiosk crop and overlay components to draw text, image, and shape overlays. The API intercepts references to the selected page and its overlays and reads the bytes from storage.

## Plan of Work

Validate an active, published revision that is the head of its family when sending, including a second check after rendering and after the Gmail client acquires its shared request slot. The submitted recipient prefix must match `^[A-Za-z0-9._-]{1,64}$`, with no leading dot, trailing dot, or consecutive dots. Append the configured domain on the server. With an empty domain, disable sending and hide availability in kiosk config.

Draw each page as A4 portrait or landscape using the original image dimensions. Draw the 8 pt single-line document name, revision/date, and page count on a dark top band. Draw the information timestamp and the output timestamp with employee number, terminal name, and employee name on a light bottom band. Draw the pale diagonal 控え watermark with date and employee number over the content. Use Asia/Tokyo explicitly for the printed timestamps. Chromium captures the bands and watermark in each JPEG. Try smaller JPEG quality and then lower resolution when the assembled PDF exceeds the 12 MB target. Refuse anything over 14,000,000 bytes. The final PDF contains the page images, with no fonts, annotations, links, forms, JavaScript, or embedded files.

Encode the Japanese subject and attachment filename with RFC 2047 and RFC 2231, respectively. Send the MIME message to Gmail as `message/rfc822` using `uploadType=multipart`. Create a delivery record with the employee, terminal, time, document and revision identifiers, recipient, Gmail ID, SHA-256, page count, and byte size.

## Concrete Steps

Run these commands from the repository root. Run each of the changed test files individually with `pnpm --filter @raspi-system/api exec vitest run <file-relative-to-apps/api>`.

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/api exec prisma validate
    pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit
    pnpm --filter @raspi-system/web exec tsc --noEmit -p tsconfig.json
    git show HEAD:apps/api/prisma/schema.prisma > /tmp/procedure-manual-schema-before.prisma
    pnpm --filter @raspi-system/api exec prisma migrate diff --from-schema /tmp/procedure-manual-schema-before.prisma --to-schema prisma/schema.prisma --script

Run `src/routes/assembly/__tests__/procedure-manual-mail.routes.test.ts`, `src/services/assembly/__tests__/procedure-manual-mail.service.test.ts`, `src/services/assembly/__tests__/procedure-manual-gmail-send.test.ts`, `src/services/assembly/__tests__/procedure-manual-pdf.test.ts`, and `src/services/backup/__tests__/gmail-api-client.test.ts`. With bundled Chromium available, set `PROCEDURE_MANUAL_PDF_BROWSER_TEST=1` when running the PDF test to inspect the generated PDF bytes. With a local Vite Web server running, also set `PROCEDURE_MANUAL_PRINT_TEST_BASE_URL` to exercise the print entry with synthetic images.

## Validation and Acceptance

A valid request to the configured API succeeds with a Gmail message ID and a stored delivery. Disabled mail, an invalid recipient, an unknown NFC tag, a superseded revision, and a PDF over the hard limit all fail before Gmail send. Tests substitute the sender and check the PDF render input and audit write. The Chromium check inspects mixed-orientation PDF pages for image objects and for the absence of active or interactive PDF objects.

## Idempotence and Recovery

Schema validation and generating the migration SQL are repeatable. The migration creates one new table and indexes. Applying the migration and sending real mail require the appropriate operating stage. A second send is a new delivery. If Gmail confirms a send and the audit write fails, the API reports that state separately to prevent an automatic duplicate.

## Artifacts and Notes

The generated migration is `apps/api/prisma/migrations/20261119090000_add_procedure_manual_mail_delivery/migration.sql`. Set `assembly_procedure_mail_domain` in Ansible to populate `ASSEMBLY_PROCEDURE_MAIL_DOMAIN`. The production blue and green API slots already receive `SIGNAGE_WEB_CAPTURE_BASE_URL` for their matching Web slots through `infrastructure/docker/docker-compose.phase3.yml`. An environment with only `BUSINESS_HERMES_WEB_BASE_URL` can reuse that URL.

## Interfaces and Dependencies

Call `POST /api/assembly/procedure-manuals/mail` with `x-client-key` and `{ documentId, revisionId, nfcUid, localPart }`. Use the assignment's `assemblyProcedureDocumentId` for the revision family and the viewed `resolvedDocumentId` for `revisionId`. On success the API returns `{ deliveryId, sentAt, gmailMessageId, pageCount, pdfByteSize }`, with `sentAt` in ISO 8601 JST. Read `assemblyProcedureMail.enabled` and `assemblyProcedureMail.domain` from `GET /api/kiosk/config` with the same key. The service accepts a PDF renderer port and a Gmail sender port for local tests.

Updated on 2026-11-19 with the focused verification results and the Chromium environment limitation.
