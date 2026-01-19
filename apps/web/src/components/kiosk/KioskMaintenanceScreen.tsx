export function KioskMaintenanceScreen() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-900 text-white">
      <div className="text-center">
        <div className="mb-8 text-6xl">🔧</div>
        <h1 className="mb-4 text-4xl font-bold">メンテナンス中</h1>
        <p className="text-xl text-white/80">
          システムを更新しています。しばらくお待ちください。
        </p>
        <div className="mt-8">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white"></div>
        </div>
      </div>
    </div>
  );
}
