/**
 * ドキュメントモジュールのルート登録
 * 将来のPDF/Excelビューワーモジュールで使用
 * 
 * 現在はプレースホルダーのみ。実装時は以下を有効化：
 * 1. DocumentService, DocumentViewerServiceの実装
 * 2. 各ルートハンドラーの実装
 * 3. routes/index.tsでの登録
 */
export async function registerDocumentsRoutes(): Promise<void> {
  // 将来の実装時に有効化
  // await app.register(
  //   async (subApp) => {
  //     registerDocumentFileRoutes(subApp);
  //     registerDocumentViewerRoutes(subApp);
  //   },
  //   { prefix: '/documents' }
  // );
  
  // プレースホルダー: 現在は何もしない
}

