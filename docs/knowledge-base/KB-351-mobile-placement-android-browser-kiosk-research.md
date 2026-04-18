---
title: KB-351 配膳スマホ Android キオスクブラウザ調査（Chrome 継続 vs OSS 殻）
tags: [mobile-placement, android, chrome, kiosk, webview, camera]
audience: [開発者, 運用者]
last-verified: 2026-04-18
related: [mobile-placement-smartphone.md, ADR-20260418-mobile-placement-android-browser-shell.md]
category: knowledge-base
update-frequency: low
---

# KB-351: 配膳スマホ Android キオスクブラウザ調査（Chrome 継続 vs OSS 殻）

## Context

配膳スマホは **Android + ブラウザ** で `https://<Pi5>/kiosk/mobile-placement*?clientKey=…` を開く運用である（Runbook 前提ブラウザは **Chrome**）。

現場の不安は次が中心だった。

- 一般ブラウザ UI 由来で **画面が隠れる / 検索 UI が出る / 誤操作しやすい**
- 端末受け渡し時に **オペレーターが迷いやすい**
- **紙の移動票・現品票フォーマットは組織都合で変更できない**
- **有償の専用アプリは採用できない**
- **端末機種は揃えられない**（ADB 一括運用を主軸にしにくい）

## Investigation（要点）

### 1) 本リポジトリ側の依存（カメラ2系統）

配膳スマホ画面は **単なる表示だけではなく**、少なくとも次に依存する。

- **バーコード読取**: Web カメラ API（`getUserMedia`）＋ ZXing 系
- **現品票 OCR**: `<input type="file" … capture="environment">` による **撮影フロー**

したがって「キオスクアプリに載せ替える」場合、**Web/API を変えなくても** **WebView 実装差でここが壊れうる**のが最大リスクになる。

### 2) OSS 候補の位置づけ（机上調査の整理）

| 候補 | 狙い | 注意（この案件での論点） |
|------|------|---------------------------|
| **Chrome 継続 + Web UI/UX 改善** | 互換性・現場浸透・変更コストが小さい | ブラウザ UI 由来の事故は **完全ゼロにはしにくい** |
| **FreeKiosk**（MIT・比較的新しい OSS） | キオスク寄せの機能（設定保護・API 等）が揃いつつある | **プロジェクトは若く**、公開ドキュメントと実装の記述に **食い違いが残ることがある**（例: Play Store 文面と CHANGELOG）。カメラは **修正履歴はあるが、端末差分は実機ゲート必須** |
| **Webview Kiosk**（F-Droid・MQTT 等） | 配布・運用機能の整理、**工場 IoT 連携の文脈では検討余地** | ライセンスは **AGPL**（利用形態の確認が必要）。勝負はやはり **カメラ2系統** |

### 3) 「実績が乏しい OSS か？」について

**FreeKiosk は「枯れた定番」というより「活発だが若い OSS」**に近い。  
一方 **Webview Kiosk は F-Droid 配布の継続・README の整理など、運用上の安心材料が相对的に多い**印象（ただし **業務適合は別**）。

## Root cause（誤解が起きやすいポイント）

- **「リポジトリに Android キオスクの実装が無い」＝「技術的に不可能」ではない**  
  Android 側は **端末の殻**であり、本リポジトリの主戦場（Pi/Linux キオスク）とは別ライン。
- **「OSS を入れる」＝「現場が楽になる」でもない**  
  特に **カメラ2系統**は WebView 差分が残り、**実機確認なしに本命化するのは危険**。

## Fix（採用した方針）

**当面は Chrome 継続 + Web UI/UX 改善を正とする**（意思決定は ADR に記録）。

- ADR: [ADR-20260418](../decisions/ADR-20260418-mobile-placement-android-browser-shell.md)

## Prevention（再発防止 / 次に迷わないためのルール）

- キオスクアプリ載せ替えを検討するときは、必ず **カメラ2系統の実機チェックリスト**を先に回す（ADR の合否ゲート）。
- 「MQTT が付いているから本命」になり得るが、**配膳スマホの主目的が UI 固定である限り、MQTT は加点であって主目的ではない**。

## References

- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
- ADR: [ADR-20260418](../decisions/ADR-20260418-mobile-placement-android-browser-shell.md)
- 外部（プロジェクト公開情報）:
  - [FreeKiosk](https://freekiosk.app/) / [GitHub `RushB-fr/freekiosk`](https://github.com/RushB-fr/freekiosk)
  - [Webview Kiosk（F-Droid）](https://f-droid.org/en/packages/uk.nktnet.webviewkiosk/) / [GitHub `nktnet1/webview-kiosk`](https://github.com/nktnet1/webview-kiosk)
