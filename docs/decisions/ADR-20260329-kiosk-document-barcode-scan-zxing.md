# ADR-20260329: キオスク要領書のバーコード検索に ZXing（npm バンドル）を採用

- **Status**: accepted
- **Date**: 2026-03-29

## Context

- 要領書検索で FIHNCD・製造 order 番号などを、**Web カメラ**から読み取って検索欄へ入力したい。
- 端末は **Raspberry Pi 4 上の Firefox キオスク**。写真持出と同様、**カメラ常時 ON は避ける**（負荷・安定性）。
- **オフラインに近い運用**のため、デコードライブラリは **ビルド成果物に同梱**したい。
- ブラウザ標準 **`BarcodeDetector`** は Firefox（特に Linux/ARM）で当てにしにくい。

## Decision

- デコードに **`@zxing/library`** を用い、**アプリにバンドル**する。
- UI は **スキャンボタンで短いセッション**のみカメラ ON。成功時は **trim 済み文字列で即検索**しモーダルを閉じる。キャンセル／30 秒タイムアウト／エラー後は **検索欄を空にする**（仕様）。カメラエラー文言は **短文のみ**。
- 要領書画面の形式は **`BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL`**（QR 等を除外）。他画面向けに **`BARCODE_FORMAT_PRESET_ALL_COMMON`** を別途用意し再利用可能にする。

## Alternatives

- **`BarcodeDetector` のみ**: 環境依存が強く Firefox キオスクでは不採用。
- **CDN 読み込み**: 外部依存・到達性のリスク。同梱方針と不一致。
- **html5-qrcode 等**: コミュニティ実装として有力だが、本件は ZXing で形式ヒントと実績のバランスが取りやすい。

## Consequences

- **良い**: Pi4 Firefox でも同一コードパスを維持しやすい。オフライン同梱に合う。
- **悪い**: 連続デコードは CPU 負荷が出るため、**間引き・セッション制御**が必須。読取速度は **端末・照明・コード品質に強く依存**し、秒単位 SLA はコードだけでは保証できない。

## References

- 実装: `apps/web/src/features/barcode-scan/`
- ナレッジ: [KB-313](../knowledge-base/KB-313-kiosk-documents.md)
- Runbook: [kiosk-documents.md](../runbooks/kiosk-documents.md)
