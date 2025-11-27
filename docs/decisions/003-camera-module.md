---
title: ADR 003: カメラ機能のモジュール化
tags: [設計決定, カメラ, モジュール化, 拡張性]
audience: [開発者, アーキテクト]
last-verified: 2025-11-27
related: [../requirements/system-requirements.md, ../modules/tools/README.md]
category: decisions
update-frequency: low
---

# ADR 003: カメラ機能のモジュール化

## 状況

写真撮影持出機能（FR-009）を実装するにあたり、カメラ機能を他の追加機能でも再利用可能にする必要があった。また、カメラの仕様と接続方法（Raspberry Pi Camera Module、USBカメラなど）はまだ検討中であり、将来的に異なるカメラタイプに対応できる設計が必要だった。

## 決定

カメラ機能をモジュール化し、以下の3層構造で実装する：

1. **共通カメラサービス層** (`services/camera/`)
2. **カメラドライバー抽象化層** (`services/camera/drivers/`)
3. **設定ファイルによるカメラタイプ指定**

## 構造

```
services/camera/
  ├── index.ts                    # CameraService エクスポート
  ├── camera.service.ts          # 共通カメラサービス（撮影、リサイズ、サムネイル生成）
  ├── drivers/
  │   ├── index.ts               # ドライバーインターフェース
  │   ├── camera-driver.interface.ts  # CameraDriver インターフェース
  │   ├── raspberry-pi-camera.driver.ts  # Raspberry Pi Camera Module 実装
  │   ├── usb-camera.driver.ts   # USBカメラ実装
  │   └── mock-camera.driver.ts  # モック実装（テスト用）
  └── config/
      └── camera.config.ts       # カメラ設定（環境変数から読み込み）
```

## 理由

1. **再利用性**: 写真撮影持出機能以外でもカメラ機能を利用可能（例: 返却時の写真撮影、在庫確認時の写真撮影など）
2. **拡張性**: 新しいカメラタイプを追加する際は、`CameraDriver`インターフェースを実装するだけ
3. **テスト容易性**: モックドライバーを使用してテスト可能
4. **設定の柔軟性**: 環境変数や設定ファイルでカメラタイプを指定可能

## インターフェース設計

### CameraDriver インターフェース

```typescript
interface CameraDriver {
  /**
   * カメラを初期化する
   */
  initialize(): Promise<void>;

  /**
   * 写真を撮影する
   * @returns 撮影した画像のBuffer
   */
  capture(): Promise<Buffer>;

  /**
   * カメラを解放する
   */
  release(): Promise<void>;

  /**
   * カメラが利用可能かどうかを確認する
   */
  isAvailable(): Promise<boolean>;
}
```

### CameraService クラス

```typescript
class CameraService {
  /**
   * 写真を撮影し、リサイズ・サムネイル生成を行う
   * @param options 撮影オプション（解像度、品質など）
   * @returns 元画像とサムネイルのBuffer
   */
  async captureAndProcess(options?: CaptureOptions): Promise<{
    original: Buffer;
    thumbnail: Buffer;
  }>;

  /**
   * 画像をリサイズする
   */
  async resizeImage(image: Buffer, width: number, height: number, quality: number): Promise<Buffer>;

  /**
   * サムネイルを生成する
   */
  async generateThumbnail(image: Buffer): Promise<Buffer>;
}
```

## 設定方法

環境変数または設定ファイルでカメラタイプを指定：

```typescript
// apps/api/src/config/camera.config.ts
export const cameraConfig = {
  type: process.env.CAMERA_TYPE || 'raspberry-pi-camera', // 'raspberry-pi-camera' | 'usb-camera' | 'mock'
  device: process.env.CAMERA_DEVICE || '/dev/video0', // USBカメラの場合のデバイスパス
  resolution: {
    width: parseInt(process.env.CAMERA_WIDTH || '800'),
    height: parseInt(process.env.CAMERA_HEIGHT || '600'),
  },
  quality: parseInt(process.env.CAMERA_QUALITY || '80'), // JPEG品質 (0-100)
  thumbnail: {
    width: parseInt(process.env.THUMBNAIL_WIDTH || '150'),
    height: parseInt(process.env.THUMBNAIL_HEIGHT || '150'),
    quality: parseInt(process.env.THUMBNAIL_QUALITY || '70'),
  },
};
```

## 影響

- **新規機能**: 写真撮影持出機能（FR-009）でカメラ機能を利用
- **将来の機能**: 返却時の写真撮影、在庫確認時の写真撮影などでもカメラ機能を再利用可能
- **テスト**: モックドライバーを使用してテスト可能
- **パフォーマンス**: ドライバーの抽象化によるオーバーヘッドは最小限

## 実装方針

1. **Phase 1**: カメラドライバーインターフェースとモック実装を作成 ✅ 予定
2. **Phase 2**: 共通カメラサービスを実装 ✅ 予定
3. **Phase 3**: Raspberry Pi Camera Module ドライバーを実装（カメラ仕様確定後）⏳ 予定
4. **Phase 4**: USBカメラドライバーを実装（必要に応じて）⏳ 予定

## 日付

2025-11-27（決定）

