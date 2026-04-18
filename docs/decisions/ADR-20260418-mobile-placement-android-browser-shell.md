# ADR-20260418: 配膳スマホの Android ブラウザ殻（キオスク）方針

**Status**: accepted  
**Context**:
- 配膳スマホは **Android 1 台 + ブラウザ** で `/kiosk/mobile-placement*` を運用している（Runbook 前提は **Chrome**）。
- 運用上の不安は主に **一般ブラウザ由来の UI**（アドレスバー・検索 UI・タブ・誤操作で画面が隠れる等）と、**オペレーターへの端末受け渡し時の誤タップ**である。
- 業務上 **移動票・現品票の紙フォーマットは組織都合で変更できない**前提がある（Web/API 側で帳票レイアウトを変えて解決する話ではない）。
- コスト制約により **有償の専用キオスクブラウザ（例: Fully Kiosk）は採用しない**。
- 端末機種を揃えられないため、**ADB 前提の一括プロビジョニングや Ansible で Android 端末群を管理する**方針は主軸にしない（Pi/Linux キオスクの Ansible 資産とは別ライン）。

**Decision**:
- **当面の正**: **現行 Chrome を継続**し、**Web アプリ側の UI/UX 改善**（誤操作を減らす導線・表示・ガード）で運用リスクを下げる。
- **専用キオスクアプリへの載せ替え**（例: OSS の `FreeKiosk` / F-Droid の `Webview Kiosk`）は **即時の必須要件ではなく、将来オプション**として扱う。採用する場合の **合否は端末上で「カメラ2系統」が通るか**（後述）を最優先の実機ゲートとする。
- **Android Enterprise / MDM 一本**や **薄いネイティブ殻の新規開発**は、現時点のスコープ（スマホ 1 台・コスト最小・現場浸透）からは **過剰**とみなし、**ドキュメント上の候補に留める**。

**Alternatives**（検討したが当面採らない／保留）:
- **OSS キオスクブラウザ**（`FreeKiosk` / `Webview Kiosk`）: UI 固定・設定保護の観点では有効だが、**WebView 実装差**により **`getUserMedia`（バーコード）** と **`input[type=file][capture=environment]`（撮影 OCR）** の両方が **Chrome 同等に動く保証は机上では出せない**。また `Webview Kiosk` は **AGPL** のため利用形態の確認が必要。
- **Fully Kiosk（有償）**: 現場導入実績は多いが、**費用制約**により対象外。
- **Ansible + ADB + 端末差分吸収**: 機種が揃わないほど **運用コストが膨らみやすい**ため、当面の主戦術にしない。

**合否ゲート（将来、キオスクアプリを再検討するとき）**:
1. **バーコード**: `navigator.mediaDevices.getUserMedia` が安定して動くか（権限・HTTPS・WebView の `onPermissionRequest` 橋渡し含む）。
2. **現品票撮影 OCR**: `<input type="file" accept="image/*" capture="environment">` が **端末のカメラ撮影フロー**として成立するか。
3. **誤操作**: 目的の業務 URL から **意図せず離れにくいか**（アドレスバー・検索 UI・戻る導線）。

**Consequences**:
- サーバ/API の契約を変えずに済む一方、**ブラウザ殻の問題は Web UI と端末設定（ホーム画面ショートカット・全画面寄せ等）で吸収**する必要がある。
- 将来 IoT 連携（MQTT 等）を端末側で強くしたい場合は、`Webview Kiosk` のように **MQTT を前面に出した OSS** を **別途評価軸**で再検討できる（本 ADR の「当面の正」とは独立した拡張）。

**References**:
- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)（本 ADR 追記後の「Android ブラウザ殻」節）
- 調査ナレッジ: [KB-351](../knowledge-base/KB-351-mobile-placement-android-browser-kiosk-research.md)
- 外部（参考・リンク先は当該プロジェクトの公開情報）:
  - [FreeKiosk](https://freekiosk.app/) / [GitHub `RushB-fr/freekiosk`](https://github.com/RushB-fr/freekiosk)
  - [Webview Kiosk（F-Droid）](https://f-droid.org/en/packages/uk.nktnet.webviewkiosk/) / [GitHub `nktnet1/webview-kiosk`](https://github.com/nktnet1/webview-kiosk)
