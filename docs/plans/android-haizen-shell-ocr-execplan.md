# 配膳スマホの製番かざし読み取り（Android 薄型アプリ）

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. It follows `.agent/PLANS.md`.


## Purpose / Big Picture

The 配膳 (parts placement) phone is an AQUOS sense4 lite (Android 12) that runs the business web screen as an installed web app. Workers identify a part by the 製番 (production number, for example `BE1N9321`) printed on the 現品票 / 移動票 (paper slips). The number is printed text only; there is no QR code or barcode on the slip. Today the phone takes a photo and the Pi5 server reads it with tesseract.js, which is slow and often wrong.

After this work, a worker holds the phone over the slip and the 製番 is read on the phone itself within about a second, without taking a photo. This is done by wrapping the existing web screen in a thin Android app (a WebView, i.e. an embedded browser view) that adds on-device text recognition (Google ML Kit, bundled Latin model, works offline) with a live camera (CameraX). The app hands the recognised candidate strings to the web page through a JavaScript bridge, and the existing server-side correction `snapFseiban` in `apps/api/src/services/mobile-placement/genpyo-slip/fseiban-snap.ts` keeps doing the final matching against known 製番. The app also blocks the Android back button, which the web app cannot do.


## Progress

- [x] (2026-10-28) 部品検索のネイティブ音声入力、任意JSブリッジ、候補選択とマイクUI、JVM/Webテストを追加。旧APKではマイクを非表示。共有packages build、Web focused 32件、mobile-placement/kiosk 90ファイル979件、Web `tsc -b`、全体 `lint --max-warnings=0` 成功。
- [x] (2026-10-28) 音声入力の `testDebugUnitTest assembleDebug` が JDK 17 / SDK 34 で成功(JVMテスト合格、debug APK 生成)。
- [ ] (2026-10-28) 音声入力の新APKインストールと実機確認（権限許可・拒否、停止、画面遷移、バックグラウンド化、日本語オフライン音声パック）。
- [x] (2026-10-21) Branch `feat/android-haizen-shell-ocr-spike` and worktree created.
- [x] (2026-10-21) Milestone 1 source, standalone Gradle configuration, and JUnit4 tests added in `apps/android-haizen-shell/`. Static checks only; wrapper JAR generation, Gradle build/tests, installation, and real-slip measurements remain pending.
- [x] (2026-10-21) Milestone 1: measurement spike app builds (12 unit tests pass) and installs on the phone.
- [x] (2026-10-21) Milestone 1: real slips measured; result recorded in Outcomes & Retrospective.
- [x] (2026-10-21) Milestone 2 source implemented: WebView shell with origin-gated native scan, video permission and file chooser support, token endpoint, shared web result handling, and back-button block. Package renamed to `jp.raspisystem.haizen.shell`; token/confirmer logic and tests retained. Japanese shell setup README updated.
- [x] (2026-10-21) Milestone 2 focused web validation: 4 bridge tests, 5 native hook tests, and the existing photo hook test pass (10 distinct tests). Targeted API/web ESLint and `git diff --check` pass. Added API integration cases for exact/corrected/none, optional text, authentication and invalid bodies, plus pure-Kotlin origin tests.
- [ ] Milestone 2 remaining validation: Android build/JUnit/install/device checks (Gradle and downloads prohibited in this task); API integration execution and complete API/web type checks (blocked by missing generated dependencies).


## Surprises & Discoveries

- Milestone 2 validation environment: Prisma Client has not been generated (`.prisma/client/default` missing), so the focused API integration suite stops before running tests. API and web `tsc --noEmit` also report missing Prisma/shared-types artifacts and downstream errors; no diagnostics name the changed production files. Dependencies were not downloaded or generated. Vitest was invoked with environment-file loading disabled; API validation also bypassed the dotenv loader and selected a dedicated test database URL, so no `.env` or secrets were read.

- The phone's camera HAL floods logcat; the default ring buffer rolled over within minutes and the first measurement run was lost. The spike now also appends each result to `files/measurements.jsonl` in app storage (read with `adb shell run-as jp.raspisystem.haizen.ocrspike cat files/measurements.jsonl`) and shows a running summary on screen.
- Kotlin property `mainExecutor` in a `ComponentActivity` clashes with `Context.getMainExecutor()`; it is named `uiExecutor`.
- Homebrew `temurin@17` cask needs an administrator password for its .pkg installer, which a non-interactive agent cannot give. The `openjdk@17` formula is used instead.


## Decision Log

- Decision: 部品の音声入力は Web Speech API を使わず、Android `SpeechRecognizer` と `EXTRA_PREFER_OFFLINE=true`、`ja-JP` を使用する。`RECORD_AUDIO` を実行時要求し、既存のorigin・ページ世代ガードとJSON文字列引用でWebへ返す。オフライン可否は端末の認識サービスと日本語音声パックに依存する。Date: 2026-10-28.
- Decision: native on-device OCR (ML Kit + CameraX) inside a thin WebView app, rather than improving server OCR. Rationale: the slip has no machine-readable code, server round trips with photos are slow, and on-device recognition can run on every camera frame. Date: 2026-10-21.
- Decision: the pass line for the spike, fixed before testing, is "90% or more of real slips are confirmed within 1.5 seconds". Date: 2026-10-21.
- Decision: Milestone 1 is accepted. 6 of 7 timed slips confirmed within 1.5 s; the one miss (2456 ms) took 1.6 s to bring the slip into the frame and then confirmed 850 ms after the 製番 appeared. The user judged it a pass on 2026-10-21 and asked to proceed to Milestone 2.
- Decision: the spike does not use the expected 製番 as a hint, for the same reason `fseiban-snap.ts` does not: biasing toward it could hide a genuinely different number. Date: 2026-10-21.


## Outcomes & Retrospective

Milestone 1 measurement (2026-10-21, AQUOS sense4 lite, 2 consecutive frames, 1280x720 analysis): 8 confirmations, 4 distinct 製番 (BA1S3332 x5, BA1S4340, BA1S4355, BA1S1314). The operator reported every confirmed value matched the slip. The first record is excluded from the reset-based timing because it was not preceded by a "next slip" tap (msSinceReset 63109). Of the remaining 7, time from the "next slip" tap to confirmation was 400, 446, 451, 451, 465, 1002 and 2456 ms: 6 of 7 (86%) within 1.5 s, just under the 90% line. Time from the first 製番-shaped token to confirmation was 200 to 850 ms for all 8 records, so recognition itself was always well under 1.5 s; the one miss came from the slip reaching the frame 1.6 s after the tap. The sample is small (4 distinct slips).


## Context and Orientation

The Android project lives in `apps/android-haizen-shell/`. It is a standalone Gradle project; it is not part of the pnpm workspace and no existing CI job builds it. The existing 製番 text rule is in `apps/api/src/services/mobile-placement/genpyo-slip/genpyo-fseiban-extract.ts`: a 製番 is an uppercase letter followed by 5 to 11 letters or digits. Example: `BE1N9321`.

Build environment on the developer Mac: JDK 17 from Homebrew (`openjdk@17`), Android command line tools from Homebrew (`android-commandlinetools`), SDK packages installed with `sdkmanager`, and `adb` from `android-platform-tools`. The phone is connected by USB with USB debugging allowed. The debug signing key `~/.android/debug.keystore` must be kept, so later builds install as updates of the same app.


## Plan of Work

Milestone 1 is a measurement spike. A single-screen app shows the camera preview with a guide frame. Every analysed frame is cropped to the guide frame and passed to ML Kit text recognition. Each recognised line is normalised (uppercase, spaces, `_` and `-` removed) and tokens matching the 製番 rule are kept. When the same token is seen in N consecutive analysed frames (N = 2 by default, switchable to 3 on screen), it is "confirmed". The screen shows the confirmed value and the milliseconds from the moment a 製番-shaped token first appeared for this slip until confirmation, and also from the "next slip" tap until confirmation. Each result is written to Logcat with the tag `HaizenOcrSpike` as one JSON line, so the measurements can be collected with `adb logcat -s HaizenOcrSpike`. A "next slip" button resets the state for the next slip. The app has no network permission.

Milestone 2 turns the app into the 配膳 shell. It has three parts that ship together.

Android (`apps/android-haizen-shell/`, applicationId changes to `jp.raspisystem.haizen.shell`, label 配膳). `MainActivity` is a full-screen WebView that loads `https://raspberrypi.tail7312a3.ts.net:8443/kiosk/mobile-placement` (the origin is a single BuildConfig constant). Navigation stays on that origin; any other URL opens in the system browser. JavaScript and DOM storage are on. `WebChromeClient.onPermissionRequest` grants only `RESOURCE_VIDEO_CAPTURE` and only to that origin, after the app itself holds the CAMERA permission, so the existing barcode scanner (getUserMedia) keeps working. `onShowFileChooser` is implemented so the existing photo input still works as a fallback. The back key never closes the app: it calls `goBack()` when the WebView can go back and otherwise does nothing. A JavaScript interface named `HaizenNative` is added with `isAvailable(): boolean` and `scanFseiban(): void`. `scanFseiban` starts `ScanActivity`; when it finishes the shell calls `window.__haizenNativeScanResult(json)` with `{"status":"ok","fseiban":"BA1S3332","tokens":[...],"text":"..."}` or `{"status":"cancelled"}`, where `tokens` are the 製番-shaped tokens of the confirming frame and `text` is the full recognised text of that frame (so the server can still find the 10-digit 製造オーダー). `ScanActivity` is the spike's camera screen without the measurement UI: guide frame, live tokens, a cancel button, 2-frame confirmation, a short vibration on success. Debug builds enable WebView remote debugging so the client key can be set once through DevTools.

API. New `POST /api/mobile-placement/snap-fseiban-tokens` in `apps/api/src/routes/mobile-placement/index.ts`, protected by the same `x-client-key` device check as `parse-actual-slip-image`. Body: `{ tokens: string[]; text?: string }` with size limits. It runs `snapFseiban(tokens, await getKnownFseibans())`, extracts the 10-digit 製造オーダー from `text` with the existing extractor in `genpyo-mo-extract.ts`, and returns exactly the response shape of `parse-actual-slip-image` with `engine: "device"`.

Web. In `apps/web`, a small module detects `window.HaizenNative`. When present, the photo button of the 配膳 screen (`MobilePlacementPage.tsx`, `onPhoto`) calls the native scan instead of opening the file input, sends the result to the new endpoint, and feeds the response into the same handling as `parseActualSlipImageFile` in `useMobilePlacementPageState.ts` (refactor the shared part into one function). In a normal browser nothing changes.


## Concrete Steps

From `apps/android-haizen-shell/`:

    ./gradlew assembleDebug
    adb install -r app/build/outputs/apk/debug/app-debug.apk
    adb logcat -c && adb logcat -s HaizenOcrSpike

Expected log line after a slip is confirmed:

    I HaizenOcrSpike: {"value":"BE1N9321","frames":2,"msSinceFirstSeen":420,"msSinceReset":910}


## Validation and Acceptance

Milestone 1 is accepted when the debug APK builds with `./gradlew assembleDebug`, unit tests for the token rule and the consecutive-frame confirmer pass with `./gradlew testDebugUnitTest`, and on real slips 90% or more confirm the correct 製番 within 1.5 seconds measured from the "next slip" tap. A wrong confirmed value counts as a failure.


## Idempotence and Recovery

Building and reinstalling with `adb install -r` can be repeated. Uninstalling the spike (`adb uninstall` with the spike's package id) does not affect the installed 配膳 web app, which is a different package.


## Artifacts and Notes

Measurement results are recorded in Outcomes & Retrospective.


## Interfaces and Dependencies

Android Gradle Plugin with Kotlin, minSdk 26, targetSdk 34 or later. Dependencies: `androidx.camera` (core, camera2, lifecycle, view) and `com.google.mlkit:text-recognition` (bundled Latin model; not the Play Services variant, so no download on first run). Pure Kotlin classes `FseibanTokenRule` (extract normalised 製番-shaped tokens from recognised text) and `ConsecutiveConfirmer` (confirm a value after N consecutive frames, with reset) hold the logic so they can be unit tested without a device.
